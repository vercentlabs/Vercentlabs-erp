import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { setTenantContext } from "../../../packages/database/src/index.js";
import { hashPassword } from "../../../services/api/src/core/auth/session.js";
import { createCrmRecord, executeReportRun } from "../../../services/api/src/index.js";
// @ts-expect-error -- plain JS domain module without a declaration file; called with the documented shape
import { recordLeadAssignment } from "../../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
import { processOrganizationWebhooks, processOrganizationWorkflows } from "../../../services/worker/src/index.js";
import { FILE_STORAGE_LOCAL_ROOT } from "./platform-services-env";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession } from "./sales-fixtures";

// Shared Platform services in a real browser against a real database: one
// freshly registered organisation, exercised through Settings > Integrations
// (developer API, webhooks, OAuth via the local stand-in), numbering,
// governance pages, automations, reports and CRM attachments. The worker's
// own functions are called in-process where a background step is needed.

test.describe.configure({ mode: "serial" });

process.env.FILE_STORAGE_DRIVER = "local";
process.env.FILE_STORAGE_LOCAL_ROOT = FILE_STORAGE_LOCAL_ROOT;

const db = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
const pool = new pg.Pool({ connectionString: MIGRATION_DATABASE_URL, max: 3 });
const suffix = randomUUID().slice(0, 8);
const password = "PlatformE2E!2026Secure";
const workerConfig = { worker: { leaseMilliseconds: 60_000, batchSize: 10, webhookTimeoutMilliseconds: 5_000, allowPrivateWebhookTargets: false } };
const world = {} as { organizationId: string; companyId: string; branchId: string; ownerId: string; memberId: string; ownerEmail: string; memberEmail: string; leadId: string };

const ownerContext = () => ({
  organizationId: world.organizationId,
  userId: world.ownerId,
  activeCompanyId: world.companyId,
  activeBranchId: world.branchId,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.view", "crm.leads.manage", "crm.leads.view_all"],
});

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

async function createLead(firstName: string) {
  const created = (await tenant((client) => createCrmRecord(client, ownerContext(), "leads", { firstName, lastName: `E2E ${suffix}`, email: `${firstName.toLowerCase()}-${suffix}@example.test` }))) as { id?: string; record?: { id: string } };
  return String(created.record?.id ?? created.id);
}

async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 180_000 });
}

async function owner(browser: import("@playwright/test").Browser) {
  return openSalesSession(browser, { email: world.ownerEmail, password, userId: world.ownerId });
}

test.beforeAll(async () => {
  await db.connect();
  const { registerOrganization } = await import("../../../services/api/src/core/organization/registration.js");
  world.ownerEmail = `platform-owner-${suffix}@crm-e2e-fixture.test`;
  world.memberEmail = `platform-member-${suffix}@crm-e2e-fixture.test`;
  const registered = await registerOrganization(db, { fullName: "Priya Owner", email: world.ownerEmail, password, organizationName: `Platform E2E ${suffix}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata" });
  world.organizationId = registered.organizationId;
  world.ownerId = registered.userId;
  world.memberId = randomUUID();
  world.companyId = randomUUID();
  world.branchId = randomUUID();
  await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [world.ownerId]);
  await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Manoj Member',$3,'active',now())`, [world.memberId, world.memberEmail, await hashPassword(password)]);
  await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [world.organizationId, world.memberId]);
  await db.query(`INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Platform Co','Platform Co','PSE2E','INR','IN',true,'active')`, [world.companyId, world.organizationId]);
  await db.query(`INSERT INTO branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [world.branchId, world.organizationId, world.companyId]);
  for (const userId of [world.ownerId, world.memberId]) {
    await db.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [world.organizationId, userId, world.companyId]);
    await db.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [world.organizationId, userId, world.branchId]);
  }
  await db.query(
    `INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1,'crm','crm','enabled',now())
     ON CONFLICT (organization_id, module_key) DO UPDATE SET status='enabled', enabled_at=now()`,
    [world.organizationId],
  );
});

test.afterAll(async () => {
  if (world.organizationId) {
    await db.query("SET session_replication_role = replica").catch(() => undefined);
    const platformTables = (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' AND table_name <> 'organizations'`)).rows;
    for (const row of platformTables) await db.query(`DELETE FROM public.${row.table_name} WHERE organization_id=$1`, [world.organizationId]).catch(() => undefined);
    const tenantTables = (await db.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
    for (const row of tenantTables) await db.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id=$1`, [world.organizationId]).catch(() => undefined);
    await db.query("SET session_replication_role = DEFAULT").catch(() => undefined);
    await db.query(`DELETE FROM organizations WHERE id=$1`, [world.organizationId]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[world.ownerId, world.memberId]]).catch(() => undefined);
  }
  await pool.end();
  await db.end();
});

test("numbering: a prefix change applies to the next lead number", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/numbering", "Numbering");
  await page.getByRole("button", { name: "Edit Lead numbering" }).click();
  const dialog = page.getByRole("dialog", { name: "Lead numbering" });
  await dialog.getByLabel("Prefix").fill("LD-");
  const saved = page.waitForResponse((response) => response.url().includes("/api/settings/numbering") && response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("LD-00001")).toBeVisible();
  world.leadId = await createLead("Numbered");
  const code = (await db.query(`SELECT code FROM tenant.crm_leads WHERE id=$1`, [world.leadId])).rows[0]?.code;
  expect(code).toBe("LD-00001");
  await context.close();
});

test("developer API: a key is shown once, works against /api/v1, and stops working when revoked", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/integrations?tab=developer-api", "Integrations");
  await page.getByRole("button", { name: "New developer app" }).click();
  await page.getByRole("dialog", { name: "New developer app" }).getByLabel("Name").fill("Warehouse sync");
  await page.getByRole("dialog", { name: "New developer app" }).getByRole("button", { name: "Create app" }).click();
  const app = page.getByRole("region", { name: "Warehouse sync" });
  await app.getByRole("button", { name: "New key" }).click();
  const issue = page.getByRole("dialog", { name: "New key for Warehouse sync" });
  await issue.getByLabel("Key name").fill("Production");
  await issue.getByRole("checkbox", { name: /Read workspace context/ }).check({ force: true });
  await issue.getByRole("button", { name: "Create key" }).click();

  const reveal = page.getByRole("dialog", { name: /API key|key/i }).filter({ has: page.getByTestId("revealed-secret") });
  const token = (await reveal.getByTestId("revealed-secret").textContent())?.trim() ?? "";
  expect(token.length).toBeGreaterThan(20);
  await expect(reveal.getByRole("button", { name: "Done" })).toBeDisabled();
  await reveal.getByRole("checkbox", { name: "I have copied and stored this safely" }).check({ force: true });
  await reveal.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("revealed-secret")).toHaveCount(0);
  await expect(page.getByText(token)).toHaveCount(0);

  const call = () => page.request.get("/api/v1/platform/context", { headers: { Authorization: `Bearer ${token}` } });
  const okResponse = await call();
  expect(okResponse.status()).toBe(200);
  const body = await okResponse.json();
  expect(JSON.stringify(body)).toContain("platform.context.read");
  expect(JSON.stringify(body)).not.toContain(world.ownerEmail);

  await app.getByRole("button", { name: "Revoke Production" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke key" }).click();
  await expect(app.getByText("Revoked")).toBeVisible();
  expect((await call()).status()).toBe(401);
  await context.close();
});

test("webhooks: signed delivery of a registered event and visible health", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/integrations?tab=webhooks", "Integrations");
  await page.getByRole("button", { name: "New webhook" }).click();
  const create = page.getByRole("dialog", { name: "New webhook" });
  await create.getByLabel("Name").fill("Lead sync");
  await create.getByLabel("Endpoint URL").fill("https://hooks.example.com/vercentlabs");
  await create.getByRole("checkbox", { name: /CRM lead created/ }).check({ force: true });
  await create.getByRole("button", { name: "Create webhook" }).click();
  const secret = (await page.getByTestId("revealed-secret").textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(20);
  await page.getByRole("checkbox", { name: "I have copied and stored this safely" }).check({ force: true });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("No deliveries yet")).toBeVisible();

  await createLead("Hooked");
  const sent: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  await processOrganizationWebhooks(pool, `e2e-${suffix}`, workerConfig, world.organizationId, {
    deliver: async (url: string, request: { body: string; headers: Record<string, string> }) => {
      sent.push({ url, ...request });
      return { outcome: "success", statusCode: 204, bodyPreview: "" };
    },
  });
  expect(sent).toHaveLength(1);
  const [delivery] = sent;
  const headers = Object.fromEntries(Object.entries(delivery.headers).map(([key, value]) => [key.toLowerCase(), value]));
  expect(headers["x-vercentlabs-event"]).toBe("crm.leads.created");
  const expected = createHmac("sha256", secret).update(`${headers["x-vercentlabs-delivery-id"]}.${headers["x-vercentlabs-timestamp"]}.${delivery.body}`).digest("hex");
  expect(headers["x-vercentlabs-signature"]).toContain(expected);
  expect(delivery.body).not.toContain("@example.test");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Healthy")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Deliveries" }).click();
  await expect(page.getByRole("dialog").getByText("Delivered")).toBeVisible();
  await context.close();
});

test("connected accounts: connect through the OAuth stand-in, then disconnect", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/integrations?tab=connected-accounts", "Integrations");
  await page.getByRole("button", { name: "Connect" }).first().click();
  await page.waitForURL(/\/settings\/integrations\?.*oauth=connected/, { timeout: 120_000 });
  await expect(page.getByText("Account connected.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "connected.user@example.test" });
  await expect(row.getByText("Connected", { exact: true })).toBeVisible();
  const stored = (await db.query(`SELECT encrypted_credentials::text AS credentials FROM oauth_connections WHERE organization_id=$1`, [world.organizationId])).rows[0];
  expect(stored.credentials).not.toContain("access");
  await row.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("No connected accounts")).toBeVisible();
  await context.close();
});

test("governance pages: configuration, privacy, AI governance and the old CRM privacy address", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/feature-configuration", "Feature configuration");
  const retention = page.getByRole("region", { name: "Keep export files for" });
  await retention.getByRole("button", { name: "Change" }).click();
  const dialog = page.getByRole("dialog", { name: "Keep export files for" });
  await dialog.getByRole("textbox", { name: /Value/ }).fill("48");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(retention.getByTestId("configuration-value")).toHaveText("48 hours");

  await open(page, "/settings/ai-governance", "AI governance");
  await expect(page.getByText("No AI tools are currently registered.", { exact: false })).toBeVisible();

  await page.goto("/crm/settings/privacy", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/settings\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy and retention" })).toBeVisible({ timeout: 180_000 });
  // Retry until hydrated: a click before hydration does not switch tabs.
  const retentionTab = page.getByRole("tab", { name: "Retention" });
  await expect(async () => {
    await retentionTab.click();
    await expect(retentionTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.getByRole("dialog").getByText("Data class")).toBeVisible();
  await context.close();
});

test("automations: a lead assignment notifies the new owner", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/settings/automations", "Automations");
  await page.getByRole("button", { name: "New automation" }).click();
  const builder = page.getByRole("dialog", { name: "New automation" });
  await builder.getByLabel("Name").fill("Tell new owners");
  await builder.getByRole("button", { name: /This happens/ }).click();
  await page.getByRole("option", { name: "CRM lead assigned" }).click();
  await builder.getByRole("button", { name: / To$/ }).click();
  await page.getByRole("option", { name: "New owner" }).click();
  await builder.getByLabel("Title").fill(`A lead is yours ${suffix}`);
  await builder.getByRole("button", { name: "Create automation" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Tell new owners" })).toBeVisible();

  const member = { ...ownerContext(), userId: world.memberId, roleSlugs: [], permissions: ["crm.view", "crm.leads.manage"] };
  await tenant((client) => recordLeadAssignment(client, member, { leadId: world.leadId, previousOwnerUserId: world.memberId, ownerUserId: world.ownerId, leadName: "Numbered Lead" }));
  await processOrganizationWebhooks(pool, `e2e-${suffix}`, workerConfig, world.organizationId, { deliver: async () => ({ outcome: "success", statusCode: 204, bodyPreview: "" }) });
  await processOrganizationWorkflows(pool, world.organizationId);

  await open(page, "/notifications", "Notifications");
  await expect(page.getByText(`A lead is yours ${suffix}`)).toBeVisible();
  await open(page, "/settings/automations", "Automations");
  await page.getByRole("row").filter({ hasText: "Tell new owners" }).getByRole("button", { name: "Runs" }).click();
  await expect(page.getByRole("dialog").getByText("1 notification sent")).toBeVisible();
  await context.close();
});

test("reports: run the CRM leads report in the background and download the CSV", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, "/reports", "Reports");
  const queued = page.waitForResponse((response) => response.url().endsWith("/api/reports/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run report" }).click();
  const response = await queued;
  expect(response.status()).toBe(201);
  const { run } = (await response.json()) as { run: { id: string; jobId: string } };
  const job = (await db.query(`SELECT payload FROM tenant.background_jobs WHERE id=$1`, [run.jobId])).rows[0];
  await tenant((client) => executeReportRun(client, world.organizationId, job.payload));
  await db.query(`UPDATE tenant.background_jobs SET status='completed', completed_at=now() WHERE id=$1`, [run.jobId]).catch(() => undefined);

  const link = page.getByRole("link", { name: "Download CSV" }).first();
  await expect(link).toBeVisible({ timeout: 60_000 });
  const download = await page.request.get(`/api/reports/runs/${run.id}/download`);
  expect(download.status()).toBe(200);
  const csv = await download.text();
  expect(csv).toContain("LD-00001");
  await context.close();
});

test("CRM attachments: upload, download and a new version on the shared file service", async ({ browser }) => {
  const { context, page } = await owner(browser);
  await open(page, `/crm/leads/${world.leadId}`, /Numbered/);
  await page.getByRole("tab", { name: "Attachments" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("first version") });
  await expect(page.getByText("brief.txt")).toBeVisible({ timeout: 60_000 });
  const href = await page.getByRole("link", { name: "Download brief.txt" }).getAttribute("href");
  const first = await page.request.get(href!);
  expect(first.status()).toBe(200);
  expect(await first.text()).toBe("first version");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload a new version of brief.txt" }).click();
  await (await chooser).setFiles({ name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("second version") });
  await expect
    .poll(async () => (await (await page.request.get((await page.getByRole("link", { name: "Download brief.txt" }).getAttribute("href"))!)).text()), { timeout: 60_000 })
    .toBe("second version");
  await page.getByRole("button", { name: "Version history for brief.txt" }).click();
  await expect(page.getByRole("dialog", { name: "Versions of brief.txt" }).getByRole("listitem")).toHaveCount(2);
  const stored = (await db.query(`SELECT storage_mode, content IS NULL AS no_bytes FROM attachments WHERE organization_id=$1 AND file_name='brief.txt'`, [world.organizationId])).rows;
  expect(stored.length).toBe(2);
  expect(stored.every((row: { storage_mode: string; no_bytes: boolean }) => row.storage_mode === "object" && row.no_bytes)).toBe(true);
  await context.close();
});
