import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Real-browser, real-database proof of journey #13 ("Expired subscription:
// authorized reading works, prohibited business writes fail"). Runs
// against this suite's OWN isolated Next.js server (spawned by
// playwright.config.billing-enforce.ts on a dedicated port with
// BILLING_ENFORCEMENT_MODE=enforce set) rather than the shared dev server
// most other specs use -- billingEnforcementMode() defaults to "observe"
// (never blocks) everywhere except NODE_ENV=production, so exercising the
// real enforce-mode UI behavior requires a server actually running with
// enforcement on. The policy itself (requireBillingWriteAccess) is already
// exhaustively proven at the integration-test level
// (billing-entitlement-sp011.test.mjs, billing-mutation-wiring-sp011.test.mjs)
// against a real database in enforce mode -- this spec's job is
// specifically to prove the real UI surfaces that denial with a clear,
// non-broken message rather than a raw error or a silent failure, and that
// reads are genuinely unaffected.

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

test("journey #13: an expired subscription blocks a real CRM write but never blocks reading", async ({ browser }) => {
  // Fresh, unauthenticated context -- the chromium project's default
  // storageState is the shared e2e-owner session (see auth.setup.ts);
  // this test logs in as its OWN dedicated fresh user, so it must not
  // start already authenticated as someone else.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const db = await dbClient();
  const email = `e2e-expired-${Date.now()}@crm-e2e-fixture.test`;
  const password = "ExpiredOrgP@ssw0rd1";
  const userId = randomUUID();
  const orgId = randomUUID();
  const planId = randomUUID();
  const priceId = randomUUID();
  const subId = randomUUID();

  try {
    await db.query(
      `INSERT INTO users(id, email, full_name, password_hash, status, email_verified_at)
       VALUES ($1, $2, 'E2E Expired-Org Owner', '', 'active', now())`,
      [userId, email],
    );
    await db.query(
      `INSERT INTO organizations(id, name, slug, country_code, timezone, base_currency, created_by)
       VALUES ($1, 'E2E Expired Org', $2, 'IN', 'Asia/Kolkata', 'INR', $3)`,
      [orgId, `e2e-expired-org-${orgId}`, userId],
    );
    await db.query(
      `INSERT INTO organization_memberships(organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [orgId, userId],
    );
    // organizations_ensure_subscription already provisioned a real trial --
    // overwrite it with a genuinely EXPIRED status on a plan that includes
    // CRM (so the module-access gate lets the request through, and the
    // denial we observe is specifically requireBillingWriteAccess, not a
    // different, earlier gate).
    await db.query(`INSERT INTO billing_plans(id,code,name,trial_days,modules) VALUES($1,$2,'E2E Expired Plan',0,'["crm"]'::jsonb)`, [planId, `e2e-expired-plan-${planId}`]);
    await db.query(`INSERT INTO billing_plan_prices(id,plan_id,billing_period,amount_paise) VALUES($1,$2,'monthly',100000)`, [priceId, planId]);
    await db.query(
      `INSERT INTO organization_subscriptions(organization_id,plan_price_id,status,billing_period,modules_snapshot)
       VALUES($1,$2,'expired','monthly','["crm"]'::jsonb)
       ON CONFLICT (organization_id) DO UPDATE SET id=$3, plan_price_id=EXCLUDED.plan_price_id, status='expired', billing_period='monthly', modules_snapshot=EXCLUDED.modules_snapshot`,
      [orgId, priceId, subId],
    );
    await db.query(`INSERT INTO organization_modules(organization_id,module_key,name,status,enabled_at) VALUES ($1,'crm','CRM','enabled',now()) ON CONFLICT (organization_id,module_key) DO UPDATE SET status='enabled', enabled_at=now()`, [orgId]);
    // organization_owner role, same minimal setup as mfa-sp007.spec.ts.
    const roleId = randomUUID();
    await db.query(
      `INSERT INTO roles(id,organization_id,name,slug,is_system,status,module_key,assignable,risk_level,version) VALUES($1,$2,'Organization Owner','organization_owner',true,'active','platform',true,'privileged',1)`,
      [roleId, orgId],
    );
    const permRows = await db.query(`SELECT key FROM permissions`);
    for (const row of permRows.rows) {
      await db.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [roleId, row.key]);
    }
    await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES($1,$2,$3,true,'active')`, [orgId, userId, roleId]);

    // Establish a known password through the real reset-password flow.
    const resetToken = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours')`,
      [userId, createHash("sha256").update(resetToken).digest("hex")],
    );
    await page.goto("/login", { waitUntil: "networkidle" });
    const establishStatus = await page.evaluate(
      async ({ token, newPassword }) => {
        const resp = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: newPassword }) });
        return resp.status;
      },
      { token: resetToken, newPassword: password },
    );
    expect(establishStatus).toBe(200);

    // Log in for real as this expired-subscription org's owner.
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/login")),
      page.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });

    // READ must work -- the leads list loads with zero errors.
    await page.goto("/crm/leads", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/subscription|billing|entitle/i)).not.toBeVisible();

    // WRITE must be blocked, with a clear, real error message -- not a
    // silent failure, not a raw stack trace/500.
    await page.goto("/crm/leads/new", { waitUntil: "networkidle" });
    await page.getByLabel(/first name/i).fill("Expired");
    await page.getByLabel(/last name/i).fill("OrgTest");
    const emailField = page.getByLabel(/^email/i).first();
    if (await emailField.count()) await emailField.fill(`expired-lead-${Date.now()}@example.test`);
    const response = page.waitForResponse((res) => res.url().includes("/api/crm/leads") && res.request().method() === "POST");
    await page.getByRole("button", { name: /^(create|save)/i }).first().click();
    const res = await response;
    expect(res.status()).toBe(402);
    await expect(page.getByText(/subscription is not active|renew|billing/i)).toBeVisible({ timeout: 10_000 });
  } finally {
    await db.query(`DELETE FROM user_role_assignments WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM roles WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM organization_modules WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]).catch(() => undefined);
    await db.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM billing_plan_prices WHERE id=$1`, [priceId]).catch(() => undefined);
    await db.query(`DELETE FROM billing_plans WHERE id=$1`, [planId]).catch(() => undefined);
    await db.query(`DELETE FROM password_reset_tokens WHERE user_id=$1`, [userId]).catch(() => undefined);
    await db.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => undefined);
    await db.end();
    await context.close();
  }
});
