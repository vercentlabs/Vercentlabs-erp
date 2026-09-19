import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Real-browser, real-database proof of SP007 end to end: enroll MFA
// through the actual Settings > Security screen, log out, log back in,
// land on the real step-up gate, and confirm a wrong code is rejected
// while the real current code (computed the same way an authenticator app
// would from the setup key the UI actually displayed) is accepted and
// reaches the workspace. This is the "successful end-to-end test for the
// complete authentication journey" SP007's own mandatory-testing section
// asks for, not a mocked substitute for it.

function loadDbUrlFromEnvLocal(): string | undefined {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const filePath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return undefined;
  const match = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("MIGRATION_DATABASE_URL="));
  return match?.slice("MIGRATION_DATABASE_URL=".length).trim();
}

async function dbClient() {
  const client = new Client({ connectionString: loadDbUrlFromEnvLocal() });
  await client.connect();
  return client;
}

// Independent, from-scratch TOTP implementation (not importing the app's
// own mfa.js) — computing the expected code the same way a real
// authenticator app would, from nothing but the base32 key the UI
// displayed, is what makes this a real cross-check rather than the app
// testing itself with its own code.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(text: string): Buffer {
  const cleaned = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function totpNow(secretBase32: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test("SP007 end-to-end: enroll MFA through Settings, then a real login requires it", async ({ browser }) => {
  const db = await dbClient();
  const email = `e2e-mfa-${Date.now()}@crm-e2e-fixture.test`;
  const password = "MfaTestP@ssw0rd1";
  const userId = randomUUID();
  const orgId = randomUUID();

  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    // A known password hash needs the app's own scrypt hashPassword(),
    // not duplicated here — establish it through the real reset-password
    // flow, exactly like auth-lifecycle.spec.ts's own pattern, instead of
    // hand-rolling a second hashing implementation just for test setup.
    await db.query(
      `INSERT INTO users(id, email, full_name, password_hash, status, email_verified_at)
       VALUES ($1, $2, 'E2E MFA User', '', 'active', now())`,
      [userId, email],
    );
    await db.query(
      `INSERT INTO organizations(id, name, slug, country_code, timezone, base_currency, created_by)
       VALUES ($1, 'E2E MFA Org', $2, 'IN', 'Asia/Kolkata', 'INR', $3)`,
      [orgId, `e2e-mfa-org-${orgId}`, userId],
    );
    await db.query(
      `INSERT INTO organization_memberships(organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [orgId, userId],
    );

    const { randomBytes, createHash } = await import("node:crypto");
    const resetToken = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours')`,
      [userId, createHash("sha256").update(resetToken).digest("hex")],
    );
    await page.goto("/login", { waitUntil: "networkidle" });
    const establishStatus = await page.evaluate(
      async ({ token, newPassword }) => {
        const resp = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password: newPassword }),
        });
        return resp.status;
      },
      { token: resetToken, newPassword: password },
    );
    expect(establishStatus).toBe(200);

    // --- Log in for real, land in the real workspace (no MFA yet) ---
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/login")),
      page.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
    expect(page.url()).not.toContain("/mfa-verify");

    // --- Enroll MFA through the real Settings > Security screen ---
    await page.goto("/settings/security", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /enable multi-factor authentication/i }).click();
    const setupKeyLocator = page.getByText(/^[A-Z2-7]{32}$/);
    await expect(setupKeyLocator).toBeVisible({ timeout: 10_000 });
    const secretBase32 = (await setupKeyLocator.textContent())!.trim();
    expect(secretBase32).toMatch(/^[A-Z2-7]{32}$/);

    await page.getByLabel(/6-digit code/i).fill(totpNow(secretBase32));
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(page.getByText(/save these recovery codes/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

    // --- Log out, log back in: the real step-up gate must now appear ---
    await page.evaluate(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
    });
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/login")),
      page.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    await page.waitForURL(/\/mfa-verify/, { timeout: 10_000 });

    // A wrong code is rejected and does not grant access.
    await page.getByLabel(/code/i).fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/incorrect or has already been used/i)).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain("/mfa-verify");

    // The real current code succeeds and reaches the workspace.
    await page.getByLabel(/code/i).fill(totpNow(secretBase32));
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/mfa/verify")),
      page.getByRole("button", { name: "Verify" }).click(),
    ]);
    await page.waitForURL((url) => !url.pathname.startsWith("/mfa-verify") && !url.pathname.startsWith("/login"), { timeout: 10_000 });
  } finally {
    await context.close();
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]).catch(() => undefined);
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]).catch(() => undefined);
    await db.query(`DELETE FROM organization_memberships WHERE organization_id = $1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]).catch(() => undefined);
    await db.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await db.end();
  }
});
