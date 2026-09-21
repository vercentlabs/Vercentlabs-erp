import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Real-browser, real-database proof of the new self-serve "create your
// account" journey: /register -> real account+organization+role-catalog
// created -> landed in the app but gated at /verify-email (real email
// unverified) -> consume a real verification token (inserted directly the
// same way auth-lifecycle.spec.ts and mfa-sp007.spec.ts already establish
// a known token for a real, hashed-at-rest token column, since the
// plaintext is never recoverable from the database once issued for real)
// -> full workspace access with real, working entitlements.

function loadDbUrlFromEnvLocal(): string | undefined {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const filePath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return undefined;
  const match = fs.readFileSync(filePath, "utf8").split("\n").find((line) => line.startsWith("MIGRATION_DATABASE_URL="));
  return match?.slice("MIGRATION_DATABASE_URL=".length).trim();
}

async function dbClient() {
  const client = new Client({ connectionString: loadDbUrlFromEnvLocal() });
  await client.connect();
  return client;
}

test("self-serve registration: create an account through the real UI, verify email, reach a real working organization", async ({ browser }) => {
  const db = await dbClient();
  const suffix = Date.now();
  const email = `e2e-register-${suffix}@crm-e2e-fixture.test`;
  const password = "RealSignupP@ssw0rd1";
  const organizationName = `E2E Registered Co ${suffix}`;
  let organizationId: string | undefined;
  let userId: string | undefined;

  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.getByLabel("Your name").fill("E2E Registered Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Organization name").fill(organizationName);
    await page.getByLabel("Country code").fill("IN");
    await page.getByLabel("Base currency").fill("INR");
    await page.getByLabel("Timezone").fill("Asia/Kolkata");

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/register") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Create account" }).click(),
    ]);

    // Real account created: confirm directly in the database before
    // trusting anything about the redirected UI state.
    const userRow = await db.query(`SELECT id, email_verified_at FROM users WHERE email = $1`, [email]);
    expect(userRow.rows.length).toBe(1);
    userId = userRow.rows[0].id;
    expect(userRow.rows[0].email_verified_at).toBeNull();

    const orgRow = await db.query(`SELECT id FROM organizations WHERE created_by = $1`, [userId]);
    expect(orgRow.rows.length).toBe(1);
    organizationId = orgRow.rows[0].id;

    // REGRESSION GUARD for the role-bootstrap gap: a brand-new
    // organization must have the full role catalog, not zero rows.
    const roleCount = await db.query(`SELECT count(*)::int AS n FROM roles WHERE organization_id = $1 AND is_system = true`, [organizationId]);
    expect(roleCount.rows[0].n).toBeGreaterThanOrEqual(36);

    const subRow = await db.query(`SELECT status FROM organization_subscriptions WHERE organization_id = $1`, [organizationId]);
    expect(subRow.rows[0].status).toBe("active");

    // Logged in immediately (a real session cookie was set), but gated at
    // the real, existing /verify-email screen -- not full access yet.
    await page.waitForURL(/\/verify-email/, { timeout: 10_000 });

    // Consume a real verification token -- inserted directly with a known
    // plaintext, matching the exact hashing scheme session.js's own
    // tokenHash() uses (sha256 hex), since a real token's plaintext is
    // never recoverable from the database once actually issued.
    const verifyToken = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours')`,
      [userId, createHash("sha256").update(verifyToken).digest("hex")],
    );
    await page.goto(`/verify-email?token=${encodeURIComponent(verifyToken)}`, { waitUntil: "networkidle" });
    await page.waitForURL((url) => !url.pathname.startsWith("/verify-email"), { timeout: 10_000 });

    // Full workspace access: the real Settings > Organization screen shows
    // the exact organization this signup created, with the owner's real
    // name -- proving the whole chain (account, org, roles, membership,
    // subscription) is genuinely usable, not just present in the database.
    await page.goto("/settings/organization", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Organization name")).toHaveValue(organizationName, { timeout: 10_000 });

    await page.goto("/settings/roles", { waitUntil: "networkidle" });
    await expect(page.getByText("Organisation Owner", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "New role" })).toBeVisible();
  } finally {
    if (organizationId && userId) {
      await db.query(`DELETE FROM user_role_assignments WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM roles WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM email_verification_tokens WHERE user_id=$1`, [userId]).catch(() => undefined);
      await db.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]).catch(() => undefined);
      await db.query(`DELETE FROM audit_events WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM organizations WHERE id=$1`, [organizationId]).catch(() => undefined);
      await db.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => undefined);
    }
    await db.end();
    await context.close();
  }
});
