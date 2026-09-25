import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { hashPassword } from "../../../services/api/src/core/session.js";
import { fixtures } from "./fixtures";

// Shared Access administration in a real browser against the real database:
//   1. Owner: assign roles, update company/branch scope, invite with multiple
//      roles and scope, toggle a module (restored afterwards).
//   2. Delegated Company Administrator: sees only their company, branch and
//      users; no Modules management; no role definition editing; a direct
//      API call against an out-of-scope user is refused.
// Fixtures are created inside the E2E owner's organization with unique names.

test.describe.configure({ mode: "serial" });

function migrationUrl(): string {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  for (const file of [".env.local", "../../.env"]) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    const line = fs.readFileSync(full, "utf8").split(/\r?\n/).find((entry) => entry.startsWith("MIGRATION_DATABASE_URL="));
    if (line) return line.slice("MIGRATION_DATABASE_URL=".length).trim();
  }
  throw new Error("MIGRATION_DATABASE_URL is required for the Shared Access E2E spec.");
}

const suffix = Date.now().toString().slice(-7);
const adminPassword = `Scoped-Admin-${randomUUID().slice(0, 8)}!9`;
const world = {
  organizationId: "",
  companyA: "",
  companyB: "",
  branchA1: "",
  branchA2: "",
  branchB1: "",
  adminEmail: `e2e-company-admin-${suffix}@crm-e2e-fixture.test`,
  userA: "",
  userAEmail: `e2e-user-a-${suffix}@crm-e2e-fixture.test`,
  userB: "",
  userBEmail: `e2e-user-b-${suffix}@crm-e2e-fixture.test`,
  paidSeatsBefore: 0,
  qualityEnabledBefore: true,
};

let db: Client;

async function user(label: string, email: string, passwordHash: string, roleSlug: string, companyId: string, branchId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES ($1, $2, $3, $4, 'active', now())`, [id, email, label, passwordHash]);
  await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [world.organizationId, id]);
  await db.query(
    `INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status)
     SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
    [world.organizationId, id, roleSlug],
  );
  await db.query(`INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.organizationId, id, companyId]);
  await db.query(`INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3)`, [world.organizationId, id, branchId]);
  return id;
}

test.beforeAll(async () => {
  db = new Client({ connectionString: migrationUrl() });
  await db.connect();
  const owner = await db.query(
    `SELECT membership.organization_id FROM users JOIN organization_memberships membership ON membership.user_id = users.id
      WHERE lower(users.email) = lower($1) AND membership.status = 'active' LIMIT 1`,
    [fixtures.ownerEmail],
  );
  world.organizationId = owner.rows[0].organization_id;
  const seats = await db.query(`SELECT paid_seats FROM organization_subscriptions WHERE organization_id = $1`, [world.organizationId]);
  world.paidSeatsBefore = Number(seats.rows[0]?.paid_seats ?? 0);
  await db.query(`UPDATE organization_subscriptions SET paid_seats = paid_seats + 20 WHERE organization_id = $1`, [world.organizationId]);
  const quality = await db.query(`SELECT status FROM organization_modules WHERE organization_id = $1 AND module_key = 'quality'`, [world.organizationId]);
  world.qualityEnabledBefore = quality.rows[0]?.status === "enabled";

  const company = async (label: string, code: string) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO companies (id, organization_id, name, legal_name, country_code, base_currency, code) VALUES ($1, $2, $3, $3, 'IN', 'INR', $4)`,
      [id, world.organizationId, label, code],
    );
    return id;
  };
  const branch = async (companyId: string, label: string, code: string) => {
    const id = randomUUID();
    await db.query(`INSERT INTO branches (id, organization_id, company_id, name, code, timezone) VALUES ($1, $2, $3, $4, $5, 'Asia/Kolkata')`, [id, world.organizationId, companyId, label, code]);
    return id;
  };
  world.companyA = await company(`E2E Alpha ${suffix}`, `EA${suffix}`);
  world.companyB = await company(`E2E Beta ${suffix}`, `EB${suffix}`);
  world.branchA1 = await branch(world.companyA, `Alpha Pune ${suffix}`, `EAP${suffix}`);
  world.branchA2 = await branch(world.companyA, `Alpha Mumbai ${suffix}`, `EAM${suffix}`);
  world.branchB1 = await branch(world.companyB, `Beta Delhi ${suffix}`, `EBD${suffix}`);

  const disabledPassword = await hashPassword(`unused-${randomUUID()}`);
  const adminId = await user(`E2E Company Admin ${suffix}`, world.adminEmail, await hashPassword(adminPassword), "company_administrator", world.companyA, world.branchA1);
  // The admin administers both Alpha branches, so User A stays in scope after the owner journey grants Alpha Mumbai.
  await db.query(`INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3)`, [world.organizationId, adminId, world.branchA2]);
  world.userA = await user(`E2E User Alpha ${suffix}`, world.userAEmail, disabledPassword, "employee", world.companyA, world.branchA1);
  world.userB = await user(`E2E User Beta ${suffix}`, world.userBEmail, disabledPassword, "employee", world.companyB, world.branchB1);
});

test.afterAll(async () => {
  if (!db) return;
  await db.query(`UPDATE organization_subscriptions SET paid_seats = $2 WHERE organization_id = $1`, [world.organizationId, world.paidSeatsBefore]).catch(() => undefined);
  await db
    .query(`UPDATE organization_modules SET status = $2, updated_at = now() WHERE organization_id = $1 AND module_key = 'quality'`, [world.organizationId, world.qualityEnabledBefore ? "enabled" : "disabled"])
    .catch(() => undefined);
  // Access evidence is immutable by design, so fixture users are disabled
  // rather than deleted; their unique emails never collide with later runs.
  await db.query(`UPDATE organization_memberships SET status = 'disabled' WHERE organization_id = $1 AND user_id IN (SELECT id FROM users WHERE email LIKE $2)`, [world.organizationId, `%-${suffix}@crm-e2e-fixture.test`]).catch(() => undefined);
  await db.query(`UPDATE organization_invitations SET revoked_at = now() WHERE organization_id = $1 AND email LIKE $2 AND accepted_at IS NULL`, [world.organizationId, `%-${suffix}@crm-e2e-fixture.test`]).catch(() => undefined);
  await db.end();
});

// react-aria checkboxes render a visually-hidden native input under a styled
// overlay (see pos-returns.spec.ts), and dialog lists scroll: dispatch the DOM
// click on the input itself, then assert the resulting state.
async function tick(scope: Locator, name: string | RegExp) {
  const checkbox = scope.getByRole("checkbox", { name });
  await checkbox.evaluate((element: HTMLElement) => element.click());
  await expect(checkbox).toBeChecked();
}

function userRow(page: Page, email: string) {
  return page.getByRole("list", { name: "Users" }).locator("li", { hasText: email });
}

test("owner: assign roles, update scope, invite with multiple roles, toggle a module", async ({ page }) => {
  test.setTimeout(240_000);

  // --- Roles ---
  await page.goto("/settings/users", { waitUntil: "networkidle" });
  await userRow(page, world.userAEmail).getByRole("button", { name: "Manage roles" }).click();
  const rolesDialog = page.getByRole("dialog");
  await tick(rolesDialog, /Sales Manager/);
  await expect(rolesDialog.getByRole("region", { name: "Effective access" })).toContainText("Sales");
  await Promise.all([
    page.waitForResponse((res) => res.url().includes(`/api/settings/users/${world.userA}/roles`) && res.status() === 200),
    rolesDialog.getByRole("button", { name: "Save roles" }).click(),
  ]);
  const assigned = await db.query(
    `SELECT role.slug FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id WHERE assignment.user_id = $1 AND assignment.status = 'active'`,
    [world.userA],
  );
  expect(assigned.rows.map((row) => row.slug).sort()).toEqual(["employee", "sales_manager"]);

  // --- Scope: add the second Alpha branch ---
  await userRow(page, world.userAEmail).getByRole("button", { name: "Manage access" }).click();
  const accessDialog = page.getByRole("dialog");
  await tick(accessDialog, `Alpha Mumbai ${suffix}`);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes(`/api/settings/users/${world.userA}/access`) && res.status() === 200),
    accessDialog.getByRole("button", { name: "Save access" }).click(),
  ]);
  const branches = await db.query(`SELECT branch_id FROM membership_branch_access WHERE user_id = $1`, [world.userA]);
  expect(branches.rows.map((row) => row.branch_id).sort()).toEqual([world.branchA1, world.branchA2].sort());

  // --- Invitation with two roles and company/branch scope ---
  const inviteEmail = `e2e-invitee-${suffix}@crm-e2e-fixture.test`;
  await page.goto("/settings/invitations", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Invite someone" }).click();
  const inviteDialog = page.getByRole("dialog");
  await inviteDialog.getByLabel("Email").fill(inviteEmail);
  await tick(inviteDialog, /Sales Manager/);
  await tick(inviteDialog, /Employee/);
  await tick(inviteDialog, `E2E Alpha ${suffix}`);
  await tick(inviteDialog, `Alpha Pune ${suffix}`);
  await Promise.all([
    page.waitForResponse((res) => res.url().endsWith("/api/auth/invitations") && res.request().method() === "POST" && res.status() === 201),
    inviteDialog.getByRole("button", { name: "Send invitation" }).click(),
  ]);
  await expect(page.getByRole("list", { name: "Invitations" }).locator("li", { hasText: inviteEmail })).toBeVisible();
  const invitation = await db.query(
    `SELECT (SELECT count(*)::int FROM organization_invitation_roles r WHERE r.invitation_id = i.id) AS roles,
            (SELECT count(*)::int FROM organization_invitation_roles r WHERE r.invitation_id = i.id AND r.is_primary) AS primaries,
            (SELECT array_agg(company_id) FROM organization_invitation_company_access c WHERE c.invitation_id = i.id) AS companies
       FROM organization_invitations i WHERE i.organization_id = $1 AND i.email = $2`,
    [world.organizationId, inviteEmail],
  );
  expect(invitation.rows[0]).toEqual({ roles: 2, primaries: 1, companies: [world.companyA] });

  // --- Module toggle (restored afterwards) ---
  await page.goto("/settings/modules", { waitUntil: "networkidle" });
  const quality = page.getByRole("list", { name: "Modules" }).getByRole("listitem", { name: "Quality" });
  if (world.qualityEnabledBefore) {
    await quality.getByRole("button", { name: "Disable Quality" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/settings/modules/quality") && res.status() === 200),
      page.getByRole("alertdialog").getByRole("button", { name: "Disable module" }).click(),
    ]);
    await expect(quality.getByText("Disabled").first()).toBeVisible();
    const response = await page.request.get("/api/quality/view/options");
    expect([403, 404]).toContain(response.status());
  }
  await quality.getByRole("button", { name: "Enable Quality" }).click();
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/settings/modules/quality") && res.status() === 200),
    page.getByRole("alertdialog").getByRole("button", { name: "Enable module" }).click(),
  ]);
  await expect(quality.getByText("Enabled").first()).toBeVisible();
});

async function signInAsCompanyAdmin(browser: Browser) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(world.adminEmail);
  await page.getByLabel(/password/i).fill(adminPassword);
  await Promise.all([page.waitForResponse((res) => res.url().includes("/api/auth/login")), page.getByRole("button", { name: /sign in|log in/i }).click()]);
  return { context, page };
}

test("company administrator: only their company, branch and users; no module or role-definition management", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await signInAsCompanyAdmin(browser);
  try {
    await page.goto("/settings/users", { waitUntil: "networkidle" });
    await expect(userRow(page, world.userAEmail)).toBeVisible();
    await expect(page.getByText(world.userBEmail)).toHaveCount(0);

    await userRow(page, world.userAEmail).getByRole("button", { name: "Manage access" }).click();
    const accessDialog = page.getByRole("dialog");
    await expect(accessDialog.getByRole("checkbox", { name: `E2E Alpha ${suffix}` })).toBeVisible();
    await expect(accessDialog.getByText(`E2E Beta ${suffix}`)).toHaveCount(0);
    await expect(accessDialog.getByText(`Beta Delhi ${suffix}`)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Direct API calls against out-of-scope targets are refused server-side.
    const outOfScope = await page.request.put(`/api/settings/users/${world.userB}/access`, {
      data: { companyIds: [world.companyA], branchIds: [] },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(outOfScope.status()).toBe(403);
    const hijackCompany = await page.request.put(`/api/settings/companies/${world.companyB}`, {
      data: { name: "Hijacked" },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(hijackCompany.status()).toBe(404);

    const companies = await page.request.get("/api/settings/companies");
    const companyIds = ((await companies.json()).companies as Array<{ id: string }>).map((entry) => entry.id);
    expect(companyIds).toEqual([world.companyA]);

    await page.goto("/settings/modules", { waitUntil: "networkidle" });
    await expect(page.getByText("You can't manage modules")).toBeVisible();
    await expect(page.getByRole("button", { name: /Disable|Enable/ })).toHaveCount(0);
    expect((await page.request.put("/api/settings/modules/quality", { data: { enabled: false }, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);

    await page.goto("/settings/roles", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "New role" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
