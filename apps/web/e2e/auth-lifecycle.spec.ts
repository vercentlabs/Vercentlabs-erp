import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fixtures } from "./fixtures";

// Next's dev server auto-loads .env.local for itself, but the Playwright
// test-runner process is separate and doesn't — load it the same way
// fixtures.ts loads .env.e2e.local, only for the two DB URL keys these
// specs need to talk to Postgres directly.
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

/**
 * Real-browser, real-database proof of the authentication lifecycle work
 * built in Checkpoint B (ERP completion gap audit): email verification,
 * password reset, and organization invitations. This app's own domain
 * functions (services/api/src/core/auth-lifecycle.js) never return a raw
 * token over the API by design — only the mailer sees it — so these specs
 * read the DB directly to recover the token a real email would have
 * carried, exactly the way a real user clicking a real email link would
 * arrive with it in the URL.
 */

function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}
function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function dbClient() {
  const client = new Client({ connectionString: loadDbUrlFromEnvLocal() });
  await client.connect();
  return client;
}

test("password reset: a real reset invalidates the old password and any existing session, and the new password actually works", async ({ browser }) => {
  const db = await dbClient();
  const email = `e2e-reset-${Date.now()}@crm-e2e-fixture.test`;
  const originalPassword = "OriginalP@ssw0rd1";
  const newPassword = "BrandNewP@ssw0rd2";

  // A fresh, unauthenticated context — the "chromium" project's default
  // page fixture carries the shared owner.json storage state, which would
  // make /login redirect away before this test ever gets to it.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    // Create the user with no usable password_hash, then establish a real
    // one through the app's own reset-password flow — resetPasswordWithToken
    // uses the app's real hashPassword() (scrypt), so this avoids
    // duplicating that hashing logic in the test itself just to seed a
    // known password.
    const created = await db.query(
      `INSERT INTO users(id, email, full_name, password_hash, status, email_verified_at)
       VALUES (gen_random_uuid(), $1, 'E2E Reset User', '', 'active', now())
       RETURNING id`,
      [email],
    );
    const userId = created.rows[0].id;

    const firstToken = createOpaqueToken();
    await db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours')`,
      [userId, tokenHash(firstToken)],
    );
    // page.request.post bypasses the browser, so it never sends an Origin
    // header the way a real page's fetch does — assertSameOrigin would
    // reject it. Navigate somewhere same-origin first (any page — /login
    // works before this user has a session) and drive the request from
    // inside the page instead, exactly like a real click-through would.
    await page.goto("/login", { waitUntil: "networkidle" });
    const establishResp = await page.evaluate(
      async ({ token, password }) => {
        const resp = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        });
        return resp.status;
      },
      { token: firstToken, password: originalPassword },
    );
    expect(establishResp).toBe(200);

    // Now log in for real with that established password, in a real page.
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(originalPassword);
    const [loginResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/login")),
      page.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    expect(loginResp.status()).toBe(200);

    // This user has no organization — expect the real onboarding page,
    // not a 404, which is the exact catastrophic-lockout bug this
    // checkpoint's work closes.
    await page.waitForURL(/\/onboarding/, { timeout: 10_000 });
    await expect(page.getByText(/not part of an organization/i)).toBeVisible();

    // A second, real reset — issued while the user has an active session.
    const secondToken = createOpaqueToken();
    await db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours')`,
      [userId, tokenHash(secondToken)],
    );
    await page.goto(`/reset-password?token=${secondToken}`, { waitUntil: "networkidle" });
    // Not exact: true — the required-field indicator ("*") is part of the
    // label's accessible name (e.g. "New password *"), so an exact string
    // match against the bare label text never matches anything. Anchor
    // instead: "New password" alone starts with it, "Confirm new
    // password" does not.
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText(/other signed-in sessions have been signed out/i)).toBeVisible();

    // The pre-reset session must now be dead — a fresh request in the
    // SAME browser context (same cookie) is rejected.
    const revokedCheck = await page.evaluate(async () => {
      const resp = await fetch("/api/notifications");
      return resp.status;
    });
    expect(revokedCheck).toBe(401);

    // And the new password logs in cleanly from a brand-new context.
    const freshContext = await browser.newContext({ storageState: undefined });
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/login", { waitUntil: "networkidle" });
    await freshPage.getByLabel(/email/i).fill(email);
    await freshPage.getByLabel(/password/i).fill(newPassword);
    const [freshLoginResp] = await Promise.all([
      freshPage.waitForResponse((res) => res.url().includes("/api/auth/login")),
      freshPage.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    expect(freshLoginResp.status()).toBe(200);
    await freshContext.close();

    // The old password must no longer work.
    const oldPwContext = await browser.newContext({ storageState: undefined });
    const oldPwPage = await oldPwContext.newPage();
    await oldPwPage.goto("/login", { waitUntil: "networkidle" });
    await oldPwPage.getByLabel(/email/i).fill(email);
    await oldPwPage.getByLabel(/password/i).fill(originalPassword);
    const [oldPwResp] = await Promise.all([
      oldPwPage.waitForResponse((res) => res.url().includes("/api/auth/login")),
      oldPwPage.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    expect(oldPwResp.status()).toBe(401);
    await oldPwContext.close();
  } finally {
    await db.query(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => undefined);
    await db.query(`DELETE FROM password_reset_tokens WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE email = $1`, [email]).catch(() => undefined);
    await db.end();
    await context.close();
  }
});

test("organization invitation: a real invitation can be accepted end-to-end and grants real, working access", async ({ page, browser }) => {
  const db = await dbClient();
  const inviteeEmail = `e2e-invitee-${Date.now()}@crm-e2e-fixture.test`;

  // Issue a real invitation, as the real owner fixture, through the real
  // API — not seeded directly, so this also proves the create-invitation
  // authorization path (requires users.manage) works for the owner.
  await page.goto("/crm", { waitUntil: "networkidle" });
  const ownerOrg = await db.query(
    `SELECT om.organization_id FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = $1 AND om.status = 'active' LIMIT 1`,
    [fixtures.ownerEmail],
  );
  test.skip(!ownerOrg.rows[0], "Could not resolve the owner fixture's organization");
  const organizationRole = await db.query(
    // Excludes organization_owner: createOrganizationInvitation now
    // enforces the same grant-ceiling check role assignment uses
    // (validateRoleSelection), which refuses to let ANY invitation grant
    // ownership — that's the controlled-transfer flow's job, never a
    // bare invite. The fixture org's owner role happens to be its
    // earliest-created role, so an unfiltered "first role" pick would
    // hit that block.
    `SELECT id FROM roles WHERE organization_id = $1 AND status = 'active' AND slug != 'organization_owner' ORDER BY created_at ASC LIMIT 1`,
    [ownerOrg.rows[0]?.organization_id],
  );
  test.skip(!organizationRole.rows[0], "No role exists in the fixture organization to invite with");

  const inviteResp = await page.evaluate(
    async ({ email, roleId }) => {
      const resp = await fetch("/api/auth/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, roleId }),
      });
      return { status: resp.status, body: await resp.json() };
    },
    { email: inviteeEmail, roleId: organizationRole.rows[0].id },
  );
  expect(inviteResp.status, JSON.stringify(inviteResp.body)).toBe(201);

  try {
    const invitationRow = await db.query(
      `SELECT id, organization_id FROM organization_invitations WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 1`,
      [inviteeEmail],
    );
    expect(invitationRow.rows[0]).toBeTruthy();
    const invitationId = invitationRow.rows[0].id;

    const token = createOpaqueToken();
    await db.query(`UPDATE organization_invitations SET token_hash = $2 WHERE id = $1`, [invitationId, tokenHash(token)]);

    const acceptContext = await browser.newContext({ storageState: undefined });
    const acceptPage = await acceptContext.newPage();
    await acceptPage.goto(`/invitations/${token}`, { waitUntil: "networkidle" });
    await expect(acceptPage.getByText(inviteeEmail)).toBeVisible();

    await acceptPage.getByLabel("Full name").fill("E2E Invitee");
    await acceptPage.getByLabel(/^Password/).fill("InviteeRealP@ss1");
    await acceptPage.getByLabel("Confirm password").fill("InviteeRealP@ss1");
    await acceptPage.getByRole("button", { name: "Accept invitation" }).click();

    // Accepting logs the invitee straight into the workspace — a real
    // session, not just a "success" message.
    await acceptPage.waitForURL((url) => !url.pathname.includes("/invitations"), { timeout: 10_000 });
    const meCheck = await acceptPage.evaluate(async () => (await fetch("/api/notifications")).status);
    expect(meCheck).toBe(200);
    await acceptContext.close();

    const membership = await db.query(
      `SELECT om.status FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = $1`,
      [inviteeEmail],
    );
    expect(membership.rows[0]?.status).toBe("active");
  } finally {
    await db
      .query(`DELETE FROM user_role_assignments WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail])
      .catch(() => undefined);
    await db
      .query(`DELETE FROM organization_memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail])
      .catch(() => undefined);
    await db.query(`DELETE FROM organization_invitations WHERE lower(email) = lower($1)`, [inviteeEmail]).catch(() => undefined);
    await db.query(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE email = $1`, [inviteeEmail]).catch(() => undefined);
    await db.end();
  }
});

test("organization invitation: the URL a real invitee would receive by email is followed verbatim, never reconstructed, and completes acceptance", async ({ page, browser }) => {
  // Regression guard for the broken invitation link defect (2A):
  // tokenUrl()'s query-string form (?token=) was being used for
  // invitations too, producing a dead link, while every prior E2E test
  // only ever proved acceptance worked by manually navigating to
  // /invitations/${token} directly — never actually following the URL
  // the mailer generates. This test captures that exact URL via the
  // local test-support capture adapter (apps/web/src/app/api/
  // test-support/email-capture/route.ts, wired in via AUTH_EMAIL_WEBHOOK_URL
  // in .env.local, hard-blocked outside dev/test) and navigates to it
  // character-for-character.
  const db = await dbClient();
  const inviteeEmail = `e2e-url-invitee-${Date.now()}@crm-e2e-fixture.test`;

  await page.goto("/crm", { waitUntil: "networkidle" });
  const ownerOrg = await db.query(
    `SELECT om.organization_id FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = $1 AND om.status = 'active' LIMIT 1`,
    [fixtures.ownerEmail],
  );
  test.skip(!ownerOrg.rows[0], "Could not resolve the owner fixture's organization");
  const organizationRole = await db.query(
    // Excludes organization_owner: createOrganizationInvitation now
    // enforces the same grant-ceiling check role assignment uses
    // (validateRoleSelection), which refuses to let ANY invitation grant
    // ownership — that's the controlled-transfer flow's job, never a
    // bare invite. The fixture org's owner role happens to be its
    // earliest-created role, so an unfiltered "first role" pick would
    // hit that block.
    `SELECT id FROM roles WHERE organization_id = $1 AND status = 'active' AND slug != 'organization_owner' ORDER BY created_at ASC LIMIT 1`,
    [ownerOrg.rows[0]?.organization_id],
  );
  test.skip(!organizationRole.rows[0], "No role exists in the fixture organization to invite with");

  try {
    const inviteResp = await page.evaluate(
      async ({ email, roleId }) => {
        const resp = await fetch("/api/auth/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, roleId }),
        });
        return { status: resp.status, body: await resp.json() };
      },
      { email: inviteeEmail, roleId: organizationRole.rows[0].id },
    );
    expect(inviteResp.status, JSON.stringify(inviteResp.body)).toBe(201);
    test.skip(inviteResp.body.delivered !== true, "the test-support capture adapter is not wired up in this environment (AUTH_EMAIL_WEBHOOK_URL/AUTH_EMAIL_CAPTURE_ENABLED)");

    const capture = await page.evaluate(async (email) => {
      const resp = await fetch(`/api/test-support/email-capture?email=${encodeURIComponent(email)}`);
      return { status: resp.status, body: await resp.json() };
    }, inviteeEmail);
    expect(capture.status, JSON.stringify(capture.body)).toBe(200);
    const capturedUrl = capture.body.message?.url as string | undefined;
    expect(capturedUrl, "the capture adapter must have received the real invitation message").toBeTruthy();
    // The defect this guards against: a query-string url here instead of
    // a path segment. Assert the actual shape, not just "some url".
    expect(capturedUrl).toMatch(/\/invitations\/[A-Za-z0-9_-]+$/);
    expect(capturedUrl).not.toContain("?token=");

    const acceptContext = await browser.newContext({ storageState: undefined });
    const acceptPage = await acceptContext.newPage();
    // The literal captured value, not `/invitations/${token}` rebuilt
    // from a token this test extracted itself.
    await acceptPage.goto(capturedUrl!, { waitUntil: "networkidle" });
    await expect(acceptPage.getByText(inviteeEmail)).toBeVisible();

    await acceptPage.getByLabel("Full name").fill("E2E URL Invitee");
    await acceptPage.getByLabel(/^Password/).fill("InviteeRealP@ss1");
    await acceptPage.getByLabel("Confirm password").fill("InviteeRealP@ss1");
    await acceptPage.getByRole("button", { name: "Accept invitation" }).click();

    await acceptPage.waitForURL((url) => !url.pathname.includes("/invitations"), { timeout: 10_000 });
    const meCheck = await acceptPage.evaluate(async () => (await fetch("/api/notifications")).status);
    expect(meCheck).toBe(200);
    await acceptContext.close();

    const membership = await db.query(
      `SELECT om.status FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = $1`,
      [inviteeEmail],
    );
    expect(membership.rows[0]?.status).toBe("active");
  } finally {
    await db
      .query(`DELETE FROM user_role_assignments WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail])
      .catch(() => undefined);
    await db
      .query(`DELETE FROM organization_memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail])
      .catch(() => undefined);
    await db.query(`DELETE FROM organization_invitations WHERE lower(email) = lower($1)`, [inviteeEmail]).catch(() => undefined);
    await db.query(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [inviteeEmail]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE email = $1`, [inviteeEmail]).catch(() => undefined);
    await db.end();
  }
});
