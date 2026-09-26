import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { setTenantContext } from "../../../packages/database/src/index.js";
import { createNotification, NOTIFICATION_CATEGORIES } from "../../../services/api/src/core/platform/notifications/index.js";
import { hashPassword } from "../../../services/api/src/core/auth/session.js";
import { createCrmRecord, createJournalEntry, initializeAccountingCompany, submitJournalEntry } from "../../../services/api/src/index.js";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession } from "./sales-fixtures";

// Shared Runtime in a real browser against a real database: one freshly
// registered organisation (owner + a plain member), exercised through the
// notification, approval, audit, search and background-task screens.

test.describe.configure({ mode: "serial" });

const db = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
const suffix = randomUUID().slice(0, 8);
const password = "RuntimeE2E!2026Secure";
const world = {} as {
  organizationId: string;
  companyId: string;
  ownerId: string;
  memberId: string;
  ownerEmail: string;
  memberEmail: string;
};

async function tenant<T>(work: (client: pg.Client) => Promise<T>) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, world.organizationId);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 180_000 });
}

test.beforeAll(async () => {
  await db.connect();
  const { registerOrganization } = await import("../../../services/api/src/core/organization/registration.js");
  world.ownerEmail = `runtime-owner-${suffix}@crm-e2e-fixture.test`;
  world.memberEmail = `runtime-member-${suffix}@crm-e2e-fixture.test`;
  const registered = await registerOrganization(db, { fullName: "Riya Owner", email: world.ownerEmail, password, organizationName: `Runtime E2E ${suffix}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata" });
  world.organizationId = registered.organizationId;
  world.ownerId = registered.userId;
  world.memberId = randomUUID();
  world.companyId = randomUUID();
  const branchId = randomUUID();
  await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [world.ownerId]);
  await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Meera Member',$3,'active',now())`, [world.memberId, world.memberEmail, await hashPassword(password)]);
  await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [world.organizationId, world.memberId]);
  const employee = (await db.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug='employee'`, [world.organizationId])).rows[0];
  await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [world.organizationId, world.memberId, employee.id]);
  await db.query(`INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Runtime Co','Runtime Co','RTE2E','INR','IN',true,'active')`, [world.companyId, world.organizationId]);
  await db.query(`INSERT INTO branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, world.organizationId, world.companyId]);
  for (const userId of [world.ownerId, world.memberId]) {
    await db.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [world.organizationId, userId, world.companyId]);
    await db.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [world.organizationId, userId, branchId]);
  }
});

test.afterAll(async () => {
  if (world.organizationId) {
    await db.query("SET session_replication_role = replica").catch(() => undefined);
    for (const table of ["notifications", "notification_preferences", "approval_decisions", "approval_requests", "audit_events"]) {
      await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [world.organizationId]).catch(() => undefined);
    }
    const tables = (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
    for (const row of tables) await db.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id=$1`, [world.organizationId]).catch(() => undefined);
    await db.query("SET session_replication_role = DEFAULT").catch(() => undefined);
    await db.query(`DELETE FROM organizations WHERE id=$1`, [world.organizationId]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[world.ownerId, world.memberId]]).catch(() => undefined);
  }
  await db.end();
});

test("notifications: an item appears, is marked read, and a preference stops the category", async ({ browser }) => {
  const created = await createNotification(db, { organizationId: world.organizationId, userId: world.ownerId, category: "crm_assignment", title: "Lead assigned: Asha Rao", message: "Asha Rao was assigned to you." });
  expect(created).toBe(true);
  const owner = await openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
  const page = owner.page;
  await open(page, "/notifications", "Notifications");
  const list = page.getByRole("list", { name: "Notifications" });
  await expect(list.getByText("Lead assigned: Asha Rao")).toBeVisible();
  await expect(page.getByText("1 unread")).toBeVisible();
  await page.getByRole("button", { name: 'Mark "Lead assigned: Asha Rao" read' }).click();
  await expect(page.getByText("You're all caught up.")).toBeVisible();

  await page.getByRole("link", { name: "Notification preferences" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Notification preferences" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("switch", { name: /push|email|sms/i })).toHaveCount(0);
  // One switch per user-configurable category in the registry (the page must not invent or hide any).
  await expect(page.getByRole("switch")).toHaveCount(NOTIFICATION_CATEGORIES.filter((category) => category.userConfigurable).length);
  const toggle = page.getByRole("switch", { name: "Lead assigned to me" });
  await expect(toggle).toBeChecked();
  const saved = page.waitForResponse((response) => response.url().includes("/api/settings/notification-preferences") && response.request().method() === "PUT");
  await toggle.click({ force: true });
  expect((await saved).status()).toBe(200);
  await expect(toggle).not.toBeChecked();
  expect(await createNotification(db, { organizationId: world.organizationId, userId: world.ownerId, category: "crm_assignment", title: "Muted", message: "Muted" })).toBe(false);
  await owner.context.close();
});

test("approvals: the owner approves a member's journal from the inbox; document and request both update", async ({ browser }) => {
  await db.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active') ON CONFLICT DO NOTHING`, [world.organizationId]);
  const year = new Date().getUTCFullYear();
  await db.query(`INSERT INTO tenant.fiscal_periods(organization_id,company_id,name,fiscal_year,start_date,end_date,status) VALUES ($1,$2,'FY Current','FY-CURRENT',$3,$4,'open') ON CONFLICT DO NOTHING`, [world.organizationId, world.companyId, `${year}-01-01`, `${year}-12-31`]);
  const requester = { organizationId: world.organizationId, activeCompanyId: world.companyId, activeBranchId: null, allowAllCompanies: false, userId: world.memberId, roleSlugs: [] as string[], permissions: ["accounting.view", "accounting.journal.create", "accounting.journal.submit"] };
  const { entryId, requestId } = await tenant(async (client) => {
    await initializeAccountingCompany(client, { organizationId: world.organizationId, companyId: world.companyId, userId: world.ownerId });
    const account = async (code: string) => (await client.query(`SELECT a.id FROM tenant.accounting_accounts a JOIN tenant.accounting_ledgers l ON l.id=a.ledger_id WHERE a.organization_id=$1 AND a.company_id=$2 AND l.ledger_type='primary' AND a.code=$3`, [world.organizationId, world.companyId, code])).rows[0].id;
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND code='GEN'`, [world.organizationId, world.companyId])).rows[0];
    await client.query(`UPDATE tenant.accounting_journals SET approval_required=true WHERE organization_id=$1 AND id=$2`, [world.organizationId, journal.id]);
    const { entry } = await createJournalEntry(client, requester, { companyId: world.companyId, journalId: journal.id, accountingDate: new Date().toISOString().slice(0, 10), description: "Owner capital", lines: [{ accountId: await account("1110"), debit: 5000 }, { accountId: await account("3100"), credit: 5000 }] });
    const submitted = (await submitJournalEntry(client, requester, String(entry.id))) as { approvalRequest: { id: string } };
    return { entryId: String(entry.id), requestId: submitted.approvalRequest.id };
  });

  const owner = await openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
  const page = owner.page;
  await open(page, "/approvals", "Approvals");
  const row = page.getByRole("list", { name: "Approvals" }).getByRole("listitem").filter({ hasText: "Journal approval" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Meera Member")).toBeVisible();
  await expect(row).not.toContainText(requestId);
  await expect(row).not.toContainText("accounting.journal.approve");
  await row.getByRole("button", { name: "Approve" }).click();
  const decided = page.waitForResponse((response) => response.url().includes(`/api/approvals/${requestId}/decide`));
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
  expect((await decided).status()).toBe(200);
  await expect(page.getByRole("list", { name: "Approvals" }).getByText("Journal approval")).toHaveCount(0);

  const state = (await db.query(`SELECT r.status, r.decided_by, e.status AS entry_status FROM approval_requests r JOIN tenant.accounting_journal_entries e ON e.id=$2 WHERE r.id=$1`, [requestId, entryId])).rows[0];
  expect(state).toEqual({ status: "approved", decided_by: world.ownerId, entry_status: "approved" });
  await owner.context.close();
});

test("audit: the owner filters the organisation's activity by area", async ({ browser }) => {
  await db.query(`INSERT INTO audit_events(id,organization_id,actor_user_id,event_type,entity_type,metadata) VALUES ($1,$2,$3,'zz_future.thing_happened','mystery','{}'::jsonb)`, [randomUUID(), world.organizationId, world.ownerId]);
  await db.query(`INSERT INTO audit_events(id,organization_id,actor_user_id,event_type,entity_type,entity_id,metadata) VALUES ($1,$2::uuid,$3,'organization.profile.updated','organization',$2::text,'{"password":"never-shown"}'::jsonb)`, [randomUUID(), world.organizationId, world.ownerId]);
  const owner = await openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
  const page = owner.page;
  await open(page, "/settings/audit", "Audit");
  await expect(page.getByText("System activity").first()).toBeVisible();
  await page.getByRole("button", { name: /Area/ }).click();
  await page.getByRole("option", { name: "Organization" }).click();
  await expect(page.getByText("Updated organization details")).toBeVisible();
  await expect(page.getByText("System activity")).toHaveCount(0);
  await owner.context.close();

  const member = await openSalesSession(browser, { email: world.memberEmail, password, userId: world.memberId });
  expect((await member.page.request.get("/api/settings/audit")).status()).toBe(403);
  await member.context.close();
});

test("search: records come from the server; a disabled module disappears from results", async ({ browser }) => {
  await tenant(async (client) => {
    const owner = { organizationId: world.organizationId, userId: world.ownerId, activeCompanyId: world.companyId, activeBranchId: null, allowAllCompanies: true, roleSlugs: ["organization_owner"], permissions: ["crm.view", "crm.leads.manage", "crm.leads.view_all"] };
    await createCrmRecord(client, owner, "leads", { firstName: "Zephyr", lastName: "Lead", email: "zephyr.lead@example.test" });
    await client.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'RT-CUST','customer','Zephyr Traders','active',$4)`, [randomUUID(), world.organizationId, world.companyId, world.ownerId]);
  });
  const owner = await openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
  const page = owner.page;
  await open(page, "/search?q=Zephyr", "Search");
  await expect(page.getByRole("region", { name: "Leads" }).getByText("Zephyr Lead")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Customers" }).getByText("Zephyr Traders")).toBeVisible();
  await expect(page.getByText("zephyr.lead@example.test")).toHaveCount(0);

  await db.query(`UPDATE organization_modules SET status='disabled' WHERE organization_id=$1 AND module_key='sales'`, [world.organizationId]);
  try {
    await open(page, "/search?q=Zephyr", "Search");
    await expect(page.getByRole("region", { name: "Leads" }).getByText("Zephyr Lead")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "Customers" })).toHaveCount(0);
  } finally {
    await db.query(`UPDATE organization_modules SET status='enabled' WHERE organization_id=$1 AND module_key='sales'`, [world.organizationId]);
  }
  await owner.context.close();
});

test("background tasks: a member sees only their own; the owner sees the organisation", async ({ browser }) => {
  const job = (type: string, by: string | null, status = "completed") =>
    db.query(`INSERT INTO tenant.background_jobs (organization_id, job_type, status, requested_by, progress) VALUES ($1,$2,$3,$4,'{"processed":3,"total":3}'::jsonb)`, [world.organizationId, type, status, by]);
  await job("crm.leads.export", world.memberId);
  await job("crm.leads.bulk_update", world.ownerId);
  await job("crm.automation.detect_lead_sla_breaches", null);

  const member = await openSalesSession(browser, { email: world.memberEmail, password, userId: world.memberId });
  await open(member.page, "/jobs", "Background tasks");
  const mine = member.page.getByRole("list", { name: "Background tasks" });
  await expect(mine.getByText("Lead export")).toBeVisible();
  await expect(mine.getByText("3 of 3 processed")).toBeVisible();
  await expect(mine.getByText("Bulk lead update")).toHaveCount(0);
  await expect(mine.getByText("Lead SLA check")).toHaveCount(0);
  await expect(member.page.getByText("crm.leads.export")).toHaveCount(0);
  await member.context.close();

  const owner = await openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
  await open(owner.page, "/jobs", "Background tasks");
  const all = owner.page.getByRole("list", { name: "Background tasks" });
  await expect(all.getByText("Lead export")).toBeVisible();
  await expect(all.getByText("Bulk lead update")).toBeVisible();
  await expect(all.getByText("Lead SLA check")).toBeVisible();
  await expect(all.getByText(/by Meera Member/)).toBeVisible();
  await owner.context.close();
});
