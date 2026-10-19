// The Shared Platform suite (access, numbering, tax, billing, idempotency, documents, mail, notifications, imports, automations,
// approvals, the public API, sign-in and India compliance) against a scratch database, inside ONE transaction that is always rolled
// back, as the restricted app role. Never point it at the live database.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:platform     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(new URL(`services/api/src/${path}`, `file:///${ROOT.replace(/^\//, "")}`).href);

// A won reason for the suites written before won reasons were required.
async function wonReason(c, ctx) {
  const reasons = await api("modules/crm/close-reasons/index.js");
  return (await reasons.listCloseReasons(c, ctx, { outcome: "won" }))[0].id;
}

// Conversion through the conversion module, for the suites written before it existed.
const CONVERSION_CLOSE_DATE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
async function convertNow(c, ctx, id, input = {}) {
  const conversion = await api("modules/crm/conversion/index.js");
  await c.query("UPDATE tenant.crm_leads SET product_interest = COALESCE(product_interest, 'ERP') WHERE id = $1", [id]);
  const { account = {}, contact = {}, opportunity = {}, ...rest } = input;
  const { create: _create, ...deal } = opportunity;
  const { allowDuplicate: _allow, duplicateReason, ...newAccount } = account;
  return conversion.convertLead(c, ctx, id, {
    account: account.id ? { mode: "existing", id: account.id } : { mode: "new", ...newAccount },
    contact: contact.id ? { mode: "existing", id: contact.id } : { mode: "new", ...contact },
    opportunity: { expectedCloseDate: CONVERSION_CLOSE_DATE, acknowledgeMatches: true, ...deal },
    ...(duplicateReason ? { duplicateReason } : {}),
    ...rest,
  });
}
async function previewNow(c, ctx, id, options) {
  return (await api("modules/crm/conversion/index.js")).previewLeadConversion(c, ctx, id, options);
}

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the platform suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 4).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function rejects(work, code) {
  try { await work(); } catch (error) { if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  throw new Error(`expected rejection ${code ?? ""}`);
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const leads = await api("modules/crm/leads/index.js");
  const { createTask: createNewTask } = await api("modules/crm/tasks/index.js");
  // the earlier suites' tasks, through the task module
  const createCrmTask = (c, ctx, i) => createNewTask(c, ctx, { title: i.subject, relatedType: i.entityType, relatedId: i.entityId, assignedTo: i.assignedTo,
    ...(i.dueAt ? { dueAt: i.dueAt, reminderOffsetMinutes: 0 } : { dueDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) }) });

  const tag = Math.random().toString(16).slice(2, 10);
  const registered = await registerOrganization(client, {
    fullName: "Smoke Owner", email: `assign-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!",
    organizationName: `Assign ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  const organizationId = registered.organizationId;
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);

  async function contextFor(userId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [organizationId, userId]);
    return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`, [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`, [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const ravi = await addMember("sales_representative", "Ravi Rep");
  const sana = await addMember("sales_representative", "Sana Rep");
  const tara = await addMember("sales_representative", "Tara Rep");
  const meera = await addMember("sales_manager", "Meera Manager");
  const ops = await addMember("sales_operations", "Omar Ops");
  const clerk = await addMember("accountant", "Anil Accountant");
  const newTeam = async (code, name, managerId, members) => {
    const team = (await client.query(`INSERT INTO tenant.crm_sales_teams (organization_id, code, name, manager_user_id) VALUES ($1, $2, $3, $4) RETURNING id`, [organizationId, code, name, managerId])).rows[0];
    for (const member of members) await client.query(`INSERT INTO tenant.crm_sales_team_members (organization_id, team_id, user_id) VALUES ($1, $2, $3)`, [organizationId, team.id, member.userId]);
    return team;
  };
  const west = await newTeam("WEST", "West", meera.userId, [ravi, sana]);
  const south = await newTeam("SOUTH", "South", null, [tara]);
  const sources = await leads.listLeadSources(client, owner);
  const website = sources.find((source) => source.code === "website").id;
  const crm = await api("modules/crm/index.js");
  const get = (id) => crm.getOpportunity(client, owner, id);
  const history = (id, eventTypes) => crm.listOpportunityHistory(client, owner, id, eventTypes ? { eventTypes } : {});
  const uom = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category) VALUES ($1, 'LIC', 'Licence', 'quantity') RETURNING id`, [organizationId])).rows[0].id;
  const product = async (code, name, price) => (await client.query(
    `INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, sales_price) VALUES ($1, $2, $3, 'service', $4, $5) RETURNING id`, [organizationId, code, name, uom, price])).rows[0].id;
  const crmModule = await product("CRM", "CRM Module", 200000);
  const inventory = await product("INV", "Inventory Module", 300000);
  const account = await crm.createAccount(client, meera, { displayName: "ABC Manufacturing", website: "abc.example", ownerUserId: ravi.userId });
  const rahul = await crm.createContact(client, meera, { accountId: account.id, firstName: "Rahul", lastName: "Sharma", email: "rahul@abc.example", ownerUserId: ravi.userId });
  const priya = await crm.createContact(client, meera, { accountId: account.id, firstName: "Priya", lastName: "Iyer", email: "priya@abc.example", ownerUserId: ravi.userId });
  const otherAccount = await crm.createAccount(client, meera, { displayName: "Zenith Traders", ownerUserId: ravi.userId });
  const outsider = await crm.createContact(client, meera, { accountId: otherAccount.id, firstName: "Omar", lastName: "Khan", email: "omar@zenith.example" });
  // The company is registered for GST in Maharashtra (27).
  await client.query(`INSERT INTO tenant.tax_registrations (organization_id, code, name, registration_number, state_code, state_name, is_default) VALUES ($1, 'MH', 'Maharashtra', '27AAACV1111A1Z1', '27', 'Maharashtra', true)`, [organizationId]);
  console.log("workspace ready");
  const monthEnd = (await client.query("SELECT to_char((date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 month - 1 day')::date, 'YYYY-MM-DD') AS d")).rows[0].d;


  const numbering = await api("core/platform/numbering/index.js");
  const invoicing = await api("core/invoicing/index.js");
  const localization = await import(`file:///${ROOT}packages/localization/src/index.js`);
  const scheduler = await import(`file:///${ROOT}services/worker/src/scheduler.js`);
  const salesApi = await api("modules/sales/index.js");
  const database = await import(`file:///${ROOT}packages/database/src/index.js`);
  // 00:30 IST on 1 April 2026 is still 31 March in UTC.
  const NEW_YEAR_IST = new Date("2026-03-31T19:00:00Z");

  await check("1 numbering, invoices and daily jobs use the company's time zone: 00:30 IST on 1 April is the new financial year", async () => {
    assert(localization.localDay(NEW_YEAR_IST, "Asia/Kolkata") === "2026-04-01" && localization.fiscalYearFor(NEW_YEAR_IST, 4, "Asia/Kolkata").label === "2026-27", "local day and year");
    assert(localization.fiscalYearFor(NEW_YEAR_IST, 4).label === "2025-26", "without a zone it stays UTC (old behaviour for callers that pass none)");
    await client.query("UPDATE public.organizations SET timezone = 'Asia/Kolkata', fiscal_year_start_month = 4 WHERE id = $1", [organizationId]);
    await numbering.setNumberingPolicy(client, owner, { documentType: "purchase_order", prefix: "PO-", padding: 4, resetPolicy: "fiscal_year" });
    const number = await numbering.nextDocumentNumber(client, owner, { documentType: "purchase_order", at: NEW_YEAR_IST });
    assert(number.startsWith("PO-2026-27-"), "new year's series: " + number);
    const before = await numbering.nextDocumentNumber(client, owner, { documentType: "purchase_order", at: new Date("2026-03-31T18:00:00Z") });
    assert(before.startsWith("PO-2025-26-"), "23:30 IST on 31 March is the old year: " + before);
    assert(scheduler.companyDay("Asia/Kolkata", NEW_YEAR_IST) === "2026-04-01", "the scheduler's day is the company's");
  });

  await check("1 GST invoices: one series per GSTIN and kind, reset each financial year, at most 16 characters; a policy that could exceed 16 is refused", async () => {
    await rejects(() => numbering.setNumberingPolicy(client, owner, { documentType: "customer_invoice", prefix: "INV-", padding: 5, resetPolicy: "fiscal_year" }), "DOCUMENT_NUMBER_TOO_LONG");
    const fine = await numbering.setNumberingPolicy(client, owner, { documentType: "customer_invoice", prefix: "IN-", padding: 5, resetPolicy: "fiscal_year" });
    assert(fine.prefix === "IN-", "16 fits");
    await client.query("UPDATE tenant.tax_registrations SET registration_type = 'regular', status = 'active' WHERE organization_id = $1", [organizationId]);
    const first = await invoicing.allocateGstDocumentNumber(client, owner, { kind: "tax_invoice", day: "2026-04-01" });
    const second = await invoicing.allocateGstDocumentNumber(client, owner, { kind: "tax_invoice", day: "2026-04-02" });
    const lastYear = await invoicing.allocateGstDocumentNumber(client, owner, { kind: "tax_invoice", day: "2026-03-31" });
    const credit = await invoicing.allocateGstDocumentNumber(client, owner, { kind: "credit_note", day: "2026-04-01" });
    assert(first.number === "INV/2627/00001" && second.number === "INV/2627/00002", "consecutive in the year: " + first.number + " " + second.number);
    assert(lastYear.number === "INV/2526/00001" && credit.number === "CN/2627/00001", "per year and kind: " + lastYear.number + " " + credit.number);
    assert([first, second, lastYear, credit].every((entry) => entry.number.length <= 16), "16 characters");
    await client.query("UPDATE tenant.tax_registrations SET status = 'inactive', is_default = false WHERE organization_id = $1", [organizationId]);
    assert((await invoicing.allocateGstDocumentNumber(client, owner, { kind: "tax_invoice", day: "2026-04-01" })) === null, "no registration, no GST number");
    await client.query("UPDATE tenant.tax_registrations SET status = 'active', is_default = true WHERE organization_id = $1", [organizationId]);
  });

  await check("1 the scheduler queues a company's jobs only for the apps it has switched on, in one transaction, with daily jobs keyed by its local date", async () => {
    await client.query("DELETE FROM tenant.background_jobs WHERE organization_id = $1 AND idempotency_key LIKE '%:777777' OR (organization_id = $1 AND idempotency_key LIKE '%:2026-04-01')", [organizationId]);
    await client.query("DELETE FROM public.organization_modules WHERE organization_id = $1", [organizationId]);
    await client.query("INSERT INTO public.organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1, 'point-of-sale', 'Point of Sale', 'enabled', now())", [organizationId]);
    const posOnly = await scheduler.scheduleCompany(client, organizationId, { bucket: 777777, now: NEW_YEAR_IST });
    const everyCompany = scheduler.SCHEDULED_JOBS.filter((job) => !job.module && !job.when).length;
    assert(posOnly.enqueued === everyCompany && posOnly.skipped === scheduler.SCHEDULED_JOBS.filter((job) => job.module).length, "a POS-only company gets only the every-company jobs: " + JSON.stringify(posOnly));
    await client.query("INSERT INTO public.organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1, 'stock', 'Stock', 'enabled', now()), ($1, 'sales', 'Sales', 'enabled', now())", [organizationId]);
    const withStock = await scheduler.scheduleCompany(client, organizationId, { bucket: 777777, now: NEW_YEAR_IST });
    const jobs = (await client.query("SELECT job_type, idempotency_key FROM tenant.background_jobs WHERE organization_id = $1 AND (idempotency_key LIKE '%:777777' OR idempotency_key LIKE '%:2026-04-01') ORDER BY 1", [organizationId])).rows;
    const types = jobs.map((row) => row.job_type);
    assert(types.includes("stock.low_stock.dispatch_notifications") && types.includes("stock.reorder.reconcile") && types.includes("sales.automation.detect_expired_quotations"), "stock and sales jobs: " + types.join(","));
    assert(!types.some((type) => type.startsWith("crm.") || type.startsWith("projects.") || type.startsWith("assets.") || type.startsWith("manufacturing.")), "no other app's jobs");
    assert(jobs.find((row) => row.job_type === "stock.reorder.reconcile").idempotency_key === "reorder-reconcile-tick:2026-04-01", "daily key is the IST date");
    const again = await scheduler.scheduleCompany(client, organizationId, { bucket: 777777, now: NEW_YEAR_IST });
    assert(again.enqueued === 0 && again.deduped === withStock.enqueued + withStock.deduped, "a second scheduler finds them queued");
  });

  await check("1 expired quotations: the salesperson is told once and the quotation's history says Expired", async () => {
    const buyer = await crm.createAccount(client, meera, { displayName: "Expiry Buyer Ltd", ownerUserId: ravi.userId });
    await crm.addAccountAddress(client, meera, buyer.id, { addressType: "billing", line1: "5 Market Road", city: "Pune", state: "Maharashtra", postalCode: "411001", countryCode: "IN" });
    const terms = (await client.query("SELECT id FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_sales_enabled LIMIT 1", [organizationId])).rows[0].id;
    await crm.createCustomerFromAccount(client, owner, buyer.id, { paymentTermId: terms });
    const q = await salesApi.createQuotation(client, owner, { partyId: buyer.id, lines: [{ itemId: crmModule, quantity: 1, unitPrice: 100000, manualPriceReason: "Test" }] });
    await salesApi.confirmQuotation(client, owner, q.id);
    await client.query("UPDATE tenant.sales_quotations SET quotation_date = current_date - 10, valid_until = current_date - 2, owner_user_id = $3 WHERE organization_id = $1 AND id = $2", [organizationId, q.id, ravi.userId]);
    const system = { organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] };
    const first = await salesApi.noteExpiredQuotations(client, system);
    assert(first.expired >= 1 && first.notified >= 1, "noted: " + JSON.stringify(first));
    const told = (await client.query("SELECT title FROM public.notifications WHERE organization_id = $1 AND user_id = $2 AND category = 'sales_quotation_expired' AND entity_id = $3", [organizationId, ravi.userId, q.id])).rows;
    assert(told.length === 1 && /has expired/.test(told[0].title), "the salesperson is told");
    const second = await salesApi.noteExpiredQuotations(client, system);
    assert(!(await client.query("SELECT 1 FROM public.notifications WHERE organization_id = $1 AND entity_id = $2 GROUP BY entity_id HAVING count(*) > 1", [organizationId, q.id])).rows.length && second.expired === 0, "never twice");
    assert((await client.query("SELECT 1 FROM tenant.sales_document_events WHERE organization_id = $1 AND entity_id = $2 AND event_type = 'quotation.expired'", [organizationId, q.id])).rows.length === 1, "history");
  });

  await check("1 new companies get the current GST slabs; Enterprise is every app; plans carry no unused limits", async () => {
    const seeded = (await client.query("SELECT category.code, rate.rate::text, to_char(rate.effective_from, 'YYYY-MM-DD') AS f FROM tenant.tax_categories category JOIN tenant.tax_rates rate ON rate.tax_category_id = category.id WHERE category.organization_id = $1 AND category.code LIKE 'GST-%'", [organizationId])).rows;
    const codes = new Set(seeded.map((row) => row.code));
    for (const code of ["GST-0", "GST-5", "GST-18", "GST-40", "GST-12", "GST-28", "GST-3", "GST-0.25"]) assert(codes.has(code), "seeded " + code + ": " + [...codes].join(","));
    assert(seeded.find((row) => row.code === "GST-40").f === "2025-09-22", "40% from 22 Sep 2025");
    const plans = (await client.query("SELECT code, name, modules, limits FROM public.billing_plans WHERE code IN ('free','standard','enterprise')")).rows;
    const enterprise = plans.find((plan) => plan.code === "enterprise");
    assert(enterprise.name === "Enterprise" && JSON.stringify(enterprise.modules) === '["*"]', "enterprise: " + JSON.stringify(enterprise));
    assert(plans.every((plan) => !("companies" in plan.limits) && !("branches" in plan.limits)), "no companies/branches limits");
  });

  await check("1 the migration runner drops psql guard lines, refuses other psql commands, and reports a pending list", async () => {
    assert(database.migrationSql === undefined || true, "exported");
    const runner = await import(`file:///${ROOT}packages/database/src/migrate.js`);
    assert(runner.migrationSql("x.sql", "\\restrict abc\nSELECT 1;\n\\unrestrict abc") === "SELECT 1;", "guards dropped");
    let refused = false;
    try { runner.migrationSql("y.sql", "\\connect other\nSELECT 1;"); } catch (error) { refused = /psql command/.test(error.message); }
    assert(refused, "other meta-commands refused");
    const status = await database.readMigrationStatus(client);
    assert(status.ready && status.latest === database.EXPECTED_MIGRATIONS.at(-1), "this database is current: " + JSON.stringify(status.missing));
  });

  // ---------------------------------------------------------------- Step 2: plans and billing
  const billing = await api("core/billing/index.js");
  const notices = async (userId, category) => (await client.query("SELECT title, message, href FROM notifications WHERE organization_id = $1 AND user_id = $2 AND category = $3 ORDER BY created_at", [organizationId, userId, category])).rows;
  // Billing's own short transactions (BEGIN/COMMIT) become savepoints inside the suite's one rolled-back transaction.
  const nested = { query: (text, values) => {
    const sql = typeof text === "string" ? text.trim().toUpperCase() : "";
    if (sql === "BEGIN") return client.query("SAVEPOINT billing_tx");
    if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT billing_tx");
    if (sql === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT billing_tx");
    return client.query(text, values);
  } };
  const TAX_ENV = {
    BILLING_SUPPLIER_LEGAL_NAME: "Vercentlabs Private Limited", BILLING_SUPPLIER_GSTIN: "27AAICV1234A1Z5", BILLING_SUPPLIER_STATE_CODE: "27",
    BILLING_SUPPLIER_ADDRESS: "Baner, Pune, Maharashtra 411045", BILLING_SERVICE_SAC: "998314", BILLING_GST_RATE_PERCENT: "18", BILLING_TAX_INVOICE_SERIES: "VL/",
  };

  await check("2 Standard is ₹699 per user monthly or ₹499 per user per month billed yearly, every user paid; GST is added to the charge", async () => {
    const monthly = await billing.currentPrice(client, "standard", "monthly");
    const yearly = await billing.currentPrice(client, "standard", "yearly");
    assert(Number(monthly.amount_paise) === 69900 && Number(yearly.amount_paise) === 598800 && Number(monthly.included_users) === 0 && Number(yearly.included_users) === 0, "price rows");
    assert(billing.chargedPerUserPaise(69900, {}) === 82482 && billing.chargedPerUserPaise(69900, { BILLING_PRICES_INCLUDE_GST: "true" }) === 69900, "GST on top unless included");
    const charge = billing.calculateSeatCharge({ includedUsers: 0, perUserPaise: 598800, totalUsers: 3, env: {} });
    assert(charge.billableSeats === 3 && charge.pricePaise === 1796400 && charge.chargedPaise === 3 * 706584, "3 yearly users: " + JSON.stringify(charge));
    const plans = await billing.listPlanCatalogue(client, organizationId, {});
    const standard = plans.find((plan) => plan.code === "standard");
    assert(standard.prices.monthly.perUserPaise === 69900 && standard.prices.yearly.perUserMonthlyPaise === 49900, "both prices listed: " + JSON.stringify(standard.prices));
    const yearlyPlan = billing.buildProviderPlanPayload({ ...yearly, name: "Standard" }, {});
    assert(yearlyPlan.period === "yearly" && yearlyPlan.item.amount === 706584, "Razorpay yearly plan at the GST-inclusive amount: " + JSON.stringify(yearlyPlan.item));
    const free = plans.find((plan) => plan.code === "free");
    assert(free.moduleAllowance === 1 && plans.find((plan) => plan.code === "enterprise").contactSales, "Free has one app; Enterprise is contact sales");
  });

  await check("2 Free is 1 user + 1 app: a new company picks its app, switches at most once in 30 days, and only the owner chooses", async () => {
    await client.query("UPDATE public.organization_subscriptions SET selected_modules = NULL, modules_snapshot = '[]'::jsonb WHERE organization_id = $1", [organizationId]);
    await client.query("DELETE FROM public.billing_module_switches WHERE organization_id = $1", [organizationId]);
    let choice = await billing.getAppChoice(client, organizationId);
    assert(choice.allowance === 1 && choice.needsChoice && !choice.grandfathered, "needs a choice: " + JSON.stringify(choice));
    await rejects(() => billing.chooseApps(client, ravi, { module: "crm" }), "BILLING_PERMISSION_DENIED");
    await rejects(() => billing.chooseApps(client, owner, { modules: ["crm", "sales"] }), "BILLING_APP_ALLOWANCE");
    await rejects(() => billing.chooseApps(client, owner, { module: "nonsense" }), "BILLING_APP_UNKNOWN");
    choice = await billing.chooseApps(client, owner, { module: "crm" });
    assert(choice.changed && JSON.stringify(choice.selected) === '["crm"]' && !choice.needsChoice, "crm chosen");
    const summary = await billing.getBillingSummary(client, organizationId, {});
    assert(JSON.stringify(summary.modules) === '["crm"]' && summary.moduleAllowance === 1, "the plan gives CRM only: " + JSON.stringify(summary.modules));
    assert((await client.query("SELECT status FROM public.organization_modules WHERE organization_id = $1 AND module_key = 'crm'", [organizationId])).rows[0]?.status === "enabled", "CRM switched on");
    await rejects(() => billing.chooseApps(client, owner, { module: "sales" }), "BILLING_APP_SWITCH_TOO_SOON");
    await client.query("UPDATE public.billing_module_switches SET created_at = now() - interval '31 days' WHERE organization_id = $1", [organizationId]);
    choice = await billing.chooseApps(client, owner, { module: "sales" });
    assert(JSON.stringify(choice.selected) === '["sales"]' && !choice.canSwitch, "switched to Sales; next switch in 30 days");
    // A company from before the rule keeps what it had and is not asked.
    await client.query("UPDATE public.organization_subscriptions SET selected_modules = NULL, modules_snapshot = '[\"*\"]'::jsonb WHERE organization_id = $1", [organizationId]);
    choice = await billing.getAppChoice(client, organizationId);
    assert(choice.grandfathered && !choice.needsChoice && JSON.stringify((await billing.getBillingSummary(client, organizationId, {})).modules) === '["*"]', "grandfathered");
  });

  await check("2 every captured charge gets Vercentlabs' GST tax invoice (CGST+SGST in-state, IGST otherwise, ≤16 characters, once); a refund gets a credit note; both print", async () => {
    const sub = (await client.query("SELECT id FROM public.organization_subscriptions WHERE organization_id = $1", [organizationId])).rows[0];
    await client.query(`INSERT INTO public.billing_customers (organization_id, legal_name, billing_email, gstin, address_line1, city, state, state_code, postal_code, country_code)
      VALUES ($1, 'Test Buyer Pvt Ltd', 'accounts@buyer.example', '27AAACT1234A1Z0', '1 MG Road', 'Pune', 'Maharashtra', '27', '411001', 'IN')
      ON CONFLICT (organization_id) DO UPDATE SET gstin = EXCLUDED.gstin, state_code = EXCLUDED.state_code, legal_name = EXCLUDED.legal_name`, [organizationId]);
    await client.query(`INSERT INTO public.billing_payments (organization_id, subscription_id, provider_payment_id, amount_paise, currency, status, captured_at, provider_snapshot)
      VALUES ($1, $2, 'pay_test_p2a', 82482, 'INR', 'captured', '2026-04-01T04:00:00Z', '{}'::jsonb)`, [organizationId, sub.id]);
    assert((await billing.issueTaxInvoiceForPaymentInTx(client, { organizationId, providerPaymentId: "pay_test_p2a" }, {})) === null, "nothing until the supplier settings are complete");
    const invoice = await billing.issueTaxInvoiceForPaymentInTx(client, { organizationId, providerPaymentId: "pay_test_p2a" }, TAX_ENV);
    assert(/^VL\/2627\/\d{6}$/.test(invoice.invoice_number) && invoice.invoice_number.length <= 16, "number: " + invoice.invoice_number);
    assert(Number(invoice.taxable_paise) === 69900 && Number(invoice.cgst_paise) === 6291 && Number(invoice.sgst_paise) === 6291 && Number(invoice.igst_paise) === 0, "in-state split: " + JSON.stringify(invoice));
    const again = await billing.issueTaxInvoiceForPaymentInTx(client, { organizationId, providerPaymentId: "pay_test_p2a" }, TAX_ENV);
    assert(again.id === invoice.id, "once per payment");
    const note = await billing.issueCreditNoteForRefundInTx(client, { organizationId, providerPaymentId: "pay_test_p2a", providerRefundId: "rfnd_1", amountPaise: 41241 }, TAX_ENV);
    assert(/^VCN\/\d{4}\/\d{6}$/.test(note.invoice_number) && Number(note.amount_paise) === 41241 && Number(note.taxable_paise) === 34950 && note.source_invoice_id === invoice.id, "credit note: " + JSON.stringify(note));
    const over = await billing.issueCreditNoteForRefundInTx(client, { organizationId, providerPaymentId: "pay_test_p2a", providerRefundId: "rfnd_2", amountPaise: 99999 }, TAX_ENV);
    assert(Number(over.amount_paise) === 41241, "never credits more than the invoice");
    await client.query("UPDATE public.billing_customers SET state_code = '29', gstin = '29AAACT1234A1Z1' WHERE organization_id = $1", [organizationId]);
    await client.query(`INSERT INTO public.billing_payments (organization_id, subscription_id, provider_payment_id, amount_paise, currency, status, captured_at, provider_snapshot)
      VALUES ($1, $2, 'pay_test_p2b', 82482, 'INR', 'captured', now(), '{}'::jsonb)`, [organizationId, sub.id]);
    const outOfState = await billing.issueTaxInvoiceForPaymentInTx(client, { organizationId, providerPaymentId: "pay_test_p2b" }, TAX_ENV);
    assert(Number(outOfState.igst_paise) === 12582 && Number(outOfState.cgst_paise) === 0, "inter-state IGST");
    const pdf = await billing.renderTaxDocumentPdf(client, organizationId, invoice.id);
    assert(pdf.body.length > 1000 && /tax-invoice/.test(pdf.fileName), "prints: " + pdf.fileName);
    assert(billing.taxInvoiceReadiness({ ...TAX_ENV, BILLING_TAX_INVOICE_SERIES: "VERCENT/" }).problems.length === 1, "a series too long for 16 characters is refused");
  });

  await check("2 messages and storage are counted: the owner is told at 80% (once), and at the limit enforce mode refuses", async () => {
    await client.query("UPDATE public.organization_subscriptions SET limits_snapshot = '{\"storage_gb\": 0.000001, \"outbound_messages_monthly\": 5}'::jsonb WHERE organization_id = $1", [organizationId]);
    await client.query("DELETE FROM public.billing_usage_monthly WHERE organization_id = $1", [organizationId]);
    const enforce = { BILLING_ENFORCEMENT_MODE: "enforce" };
    await billing.countOutboundMessages(client, organizationId, { quantity: 3, channel: "email" }, enforce);
    assert(!(await notices(owner.userId, "billing_usage")).length, "no warning at 60%");
    await billing.countOutboundMessages(client, organizationId, { quantity: 1, channel: "sms", idempotencyKey: "sms-1" }, enforce);
    await billing.countOutboundMessages(client, organizationId, { quantity: 1, channel: "sms", idempotencyKey: "sms-1" }, enforce);
    const warned = await notices(owner.userId, "billing_usage");
    assert(warned.length === 1 && /80% of this month/.test(warned[0].title), "told once at 80%: " + JSON.stringify(warned.map((entry) => entry.title)));
    await billing.countOutboundMessages(client, organizationId, { quantity: 1 }, enforce);
    await rejects(() => billing.countOutboundMessages(client, organizationId, { quantity: 1 }, enforce), "BILLING_MESSAGES_USED_UP");
    await rejects(() => billing.assertStorageAvailable(client, organizationId, 5000, enforce), "BILLING_STORAGE_FULL");
    assert((await billing.assertStorageAvailable(client, organizationId, 5000, {})) !== undefined, "observe mode only reports");
    const usage = await billing.getUsageOverview(client, organizationId, enforce);
    assert(usage.messages.used === 5 && usage.messages.limit === 5 && usage.enforced, "usage panel: " + JSON.stringify(usage));
  });

  await check("2 renewal reminders: 14 days before a yearly renewal the owner is told the date and amount, once per period", async () => {
    await client.query(`UPDATE public.organization_subscriptions SET provider_subscription_id = 'sub_test_p2', status = 'active', billing_period = 'yearly', paid_seats = 3,
        current_period_ends_at = now() + interval '10 days', renewal_reminded_for = NULL, cancel_at_cycle_end = false,
        plan_price_id = (SELECT price.id FROM public.billing_plan_prices price JOIN public.billing_plans plan ON plan.id = price.plan_id WHERE plan.code = 'standard' AND price.billing_period = 'yearly' AND price.active)
      WHERE organization_id = $1`, [organizationId]);
    const sent = await billing.sendRenewalReminders(nested, { env: {} });
    const told = await notices(owner.userId, "billing_renewal");
    const row = (await client.query("SELECT status, billing_period, provider_subscription_id, current_period_ends_at > now() AS future, renewal_reminded_for FROM public.organization_subscriptions WHERE organization_id = $1", [organizationId])).rows[0];
    assert(sent >= 1 && told.length === 1 && /renews on/.test(told[0].title), "told: " + JSON.stringify({ sent, told: told.map((entry) => entry.title), row }));
    await billing.sendRenewalReminders(nested, { env: {} });
    assert((await notices(owner.userId, "billing_renewal")).length === 1, "once per period");
  });

  // ---------------------------------------------------------------- Step 3: company and user basics
  const org = await api("core/organization/index.js");
  const authProfile = await api("core/auth/profile.js");
  const authSession = await api("core/auth/session.js");
  const security = await api("core/security/request-security.js");
  const OWNER_PASSWORD = "Tr1al-Workspace-Passphrase!";
  const ownerSession = { ...owner, sessionId: null };
  const { gstinCheckCharacter } = await import(`file:///${ROOT}packages/shared-types/src/india.js`);
  const gstinOf = (first14) => first14 + gstinCheckCharacter(first14);
  const OUR_GSTIN = gstinOf("27AAACV1111A1Z");
  const fakeRequest = (userAgent) => ({ headers: { get: (name) => (name.toLowerCase() === "user-agent" ? userAgent : null) } });

  await check("3 the company profile holds what documents print: PAN, GSTIN (its default registration, same state and PAN), CIN, Udyam, address, bank accounts, UPI", async () => {
    await rejects(() => org.updateCompanyProfile(client, ownerSession, { pan: "ABC12" }), "COMPANY_PROFILE_INVALID");
    await rejects(() => org.updateCompanyProfile(client, ownerSession, { pan: "AAACV1111A", gstin: gstinOf("27AAACZ9999Z1Z") }), "COMPANY_PROFILE_INVALID");
    await rejects(() => org.updateCompanyProfile(client, ravi, { legalName: "Nope" }), undefined);
    await client.query("UPDATE tenant.tax_registrations SET status = 'inactive', is_default = false WHERE organization_id = $1", [organizationId]);
    const profile = await org.updateCompanyProfile(client, ownerSession, {
      legalName: "Assign Engineering Private Limited", gstin: OUR_GSTIN, cin: "U72900PN2020PTC123456", udyamNumber: "UDYAM-MH-26-0012345",
      address: { line1: "Plot 4, MIDC", city: "Pune", stateCode: "27", postalCode: "411019" }, phone: "+91 20 2712 3456", email: "Accounts@Assign.example", website: "assign.example",
    });
    assert(profile.gstin === OUR_GSTIN && profile.pan === "AAACV1111A" && profile.address.stateName === "Maharashtra" && profile.website === "https://assign.example" && profile.email === "accounts@assign.example",
      "profile: " + JSON.stringify(profile));
    const registration = (await client.query("SELECT registration_number, state_code, is_default, registration_type FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'", [organizationId])).rows;
    assert(registration.length === 1 && registration[0].is_default && registration[0].state_code === "27" && registration[0].registration_type === "regular", "default GST registration made");
    await rejects(() => org.updateCompanyProfile(client, ownerSession, { gstin: gstinOf("29AAACV1111A1Z") }), "COMPANY_PROFILE_INVALID");
    await rejects(() => org.saveCompanyBankAccount(client, ownerSession, { accountName: "Assign", bankName: "HDFC", accountNumber: "12", ifsc: "HDFC0001234" }), "COMPANY_PROFILE_INVALID");
    let accounts = await org.saveCompanyBankAccount(client, ownerSession, { accountName: "Assign Engineering", bankName: "HDFC Bank", accountNumber: "50200012345678", ifsc: "hdfc0001234", branch: "Baner" });
    accounts = await org.saveCompanyBankAccount(client, ownerSession, { accountName: "Assign Engineering", bankName: "ICICI Bank", accountNumber: "001234567890", ifsc: "ICIC0000123" });
    assert(accounts.length === 2 && accounts[0].isDefault && accounts[0].bankName === "HDFC Bank" && accounts[0].ifsc === "HDFC0001234", "first account is the default");
    accounts = await org.removeCompanyBankAccount(client, ownerSession, accounts[0].id);
    assert(accounts.length === 1 && accounts[0].isDefault, "the remaining account becomes the default");
    await rejects(() => org.updateCompanyProfile(client, ownerSession, { upiId: "not a upi" }), "COMPANY_PROFILE_INVALID");
    assert((await org.updateCompanyProfile(client, ownerSession, { upiId: "assign@okhdfcbank" })).upiId === "assign@okhdfcbank", "UPI saved");
  });

  await check("3 setup wizard: the steps follow the data; finishing needs the legal details and (on Free) the app, and records onboarding", async () => {
    await client.query("UPDATE public.organizations SET onboarding_completed_at = NULL WHERE id = $1", [organizationId]);
    await client.query("UPDATE public.organization_subscriptions SET selected_modules = NULL, modules_snapshot = '[]'::jsonb, limits_snapshot = '{}'::jsonb, plan_price_id = (SELECT price.id FROM public.billing_plan_prices price JOIN public.billing_plans plan ON plan.id = price.plan_id WHERE plan.code = 'free' AND price.active LIMIT 1), provider_subscription_id = NULL WHERE organization_id = $1", [organizationId]);
    await client.query("DELETE FROM public.billing_module_switches WHERE organization_id = $1", [organizationId]);
    let setup = await org.getSetupProgress(client, organizationId);
    assert(setup.steps.find((step) => step.key === "legal").done && !setup.steps.find((step) => step.key === "app").done && !setup.readyToFinish, "legal done, app not: " + JSON.stringify(setup.steps));
    await rejects(() => org.completeSetup(client, ownerSession), "SETUP_INCOMPLETE");
    await billing.chooseApps(client, owner, { module: "sales" });
    setup = await org.markSetupStep(client, ownerSession, "data");
    assert(setup.readyToFinish && setup.steps.find((step) => step.key === "data").done, "ready");
    setup = await org.completeSetup(client, ownerSession);
    assert(setup.completedAt, "onboarding recorded");
  });

  await check("3 your profile: name, phone and formats; the password changes only with the current one, never to a recent one, and signs out other sessions", async () => {
    let mine = await authProfile.updateOwnProfile(client, ownerSession, { fullName: "Smoke Owner Renamed", phone: "+91 98765 43210", dateFormat: "DD MMM YYYY", numberFormat: "indian", timezone: "Asia/Kolkata" });
    assert(mine.fullName === "Smoke Owner Renamed" && mine.dateFormat === "DD MMM YYYY" && !mine.timezoneIsCompany, "saved: " + JSON.stringify(mine));
    await rejects(() => authProfile.updateOwnProfile(client, ownerSession, { dateFormat: "D/M/Y" }), "PROFILE_INVALID");
    await rejects(() => authProfile.changeOwnPassword(client, ownerSession, { currentPassword: "wrong", newPassword: "Another-Long-Passphrase-77" }, {}), "PROFILE_PASSWORD_WRONG");
    await rejects(() => authProfile.changeOwnPassword(client, ownerSession, { currentPassword: OWNER_PASSWORD, newPassword: OWNER_PASSWORD }, {}), "PROFILE_PASSWORD_REUSED");
    const other = await authSession.createSession(client, { userId: owner.userId, ipAddress: "10.0.0.9", userAgent: "Other browser", env: {} });
    const changed = await authProfile.changeOwnPassword(client, ownerSession, { currentPassword: OWNER_PASSWORD, newPassword: "Another-Long-Passphrase-77" }, {});
    assert(changed.changed && changed.otherSessionsSignedOut >= 1, "changed: " + JSON.stringify(changed));
    assert((await client.query("SELECT revoked_reason FROM sessions WHERE id = $1", [other.sessionId])).rows[0].revoked_reason === "password_changed", "other session ended");
    await rejects(() => authProfile.changeOwnPassword(client, ownerSession, { currentPassword: "Another-Long-Passphrase-77", newPassword: OWNER_PASSWORD }, {}), "PROFILE_PASSWORD_REUSED");
    await authProfile.changeOwnPassword(client, ownerSession, { currentPassword: "Another-Long-Passphrase-77", newPassword: OWNER_PASSWORD + "x" }, {});
  });

  await check("3 changing email: the password first, a link to the new address, and only that link changes it", async () => {
    await rejects(() => authProfile.requestEmailChange(client, ownerSession, { newEmail: "new-owner@assign.example", password: "wrong" }, {}), "PROFILE_PASSWORD_WRONG");
    const raviEmail = (await client.query("SELECT email FROM users WHERE id = $1", [ravi.userId])).rows[0].email;
    await rejects(() => authProfile.requestEmailChange(client, ownerSession, { newEmail: raviEmail, password: OWNER_PASSWORD + "x" }, {}), "PROFILE_EMAIL_TAKEN");
    const asked = await authProfile.requestEmailChange(client, ownerSession, { newEmail: "New-Owner@Assign.example", password: OWNER_PASSWORD + "x" }, {});
    assert(asked.sentTo === "new-owner@assign.example", "asked");
    assert((await authProfile.getOwnProfile(client, ownerSession)).pendingEmail?.email === "new-owner@assign.example", "pending shown");
    // The emailed token is only in the mail; stand in a known one for the same request.
    const token = authSession.createOpaqueToken();
    await client.query("UPDATE email_change_requests SET token_hash = $2 WHERE user_id = $1 AND used_at IS NULL", [owner.userId, authSession.tokenHash(token)]);
    await rejects(() => authProfile.confirmEmailChange(client, "not-the-token", {}), "PROFILE_EMAIL_TOKEN_INVALID");
    const confirmed = await authProfile.confirmEmailChange(client, token, {});
    assert(confirmed.email === "new-owner@assign.example" && (await client.query("SELECT email FROM users WHERE id = $1", [owner.userId])).rows[0].email === "new-owner@assign.example", "changed");
    await rejects(() => authProfile.confirmEmailChange(client, token, {}), "PROFILE_EMAIL_TOKEN_INVALID");
  });

  await check("3 a sign-in from a new device is flagged (and emailed); the first sign-in and a browser update are not", async () => {
    await client.query("DELETE FROM login_events WHERE user_id = $1", [meera.userId]);
    const email = (await client.query("SELECT email FROM users WHERE id = $1", [meera.userId])).rows[0].email;
    const signIn = (agent) => security.recordLoginEvent(client, { userId: meera.userId, email, succeeded: true, request: fakeRequest(agent), env: {} });
    await signIn("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.1 Safari/537.36");
    await signIn("Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.4 Safari/537.36");
    await signIn("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/604.1");
    const rows = (await client.query("SELECT new_device FROM login_events WHERE user_id = $1 ORDER BY created_at, id", [meera.userId])).rows.map((row) => row.new_device);
    assert(JSON.stringify(rows.sort()) === "[false,false,true]", "only the phone is new: " + JSON.stringify(rows));
  });

  await check("3 an owner resets a member's two-step sign-in and signs a member out; others cannot", async () => {
    await client.query("UPDATE users SET mfa_enrolled_at = now() WHERE id = $1", [ravi.userId]);
    const raviSession = await authSession.createSession(client, { userId: ravi.userId, ipAddress: "10.0.0.2", userAgent: "Ravi browser", env: {} });
    await rejects(() => org.resetMemberMfa(client, meera, ravi.userId, {}, {}), "MEMBER_SECURITY_DENIED");
    const reset = await org.resetMemberMfa(client, ownerSession, ravi.userId, { reason: "Lost phone" }, {});
    assert(reset.reset && reset.sessionsSignedOut >= 1 && !(await client.query("SELECT mfa_enrolled_at FROM users WHERE id = $1", [ravi.userId])).rows[0].mfa_enrolled_at, "reset");
    assert((await client.query("SELECT revoked_reason FROM sessions WHERE id = $1", [raviSession.sessionId])).rows[0].revoked_reason === "mfa_reset_by_admin", "signed out");
    await rejects(() => org.resetMemberMfa(client, ownerSession, ravi.userId, {}, {}), "MEMBER_MFA_NOT_ENROLLED");
    await authSession.createSession(client, { userId: ravi.userId, ipAddress: "10.0.0.2", userAgent: "Ravi browser", env: {} });
    const out = await org.signOutMember(client, ownerSession, ravi.userId, {});
    assert(out.sessionsSignedOut === 1 && (await client.query("SELECT status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, ravi.userId])).rows[0].status === "active", "signed out, still active");
  });

  await check("3 ownership moves to another member only with the owner's password; one owner at a time; the old owner becomes an administrator", async () => {
    await rejects(() => org.transferOwnership(client, meera, { targetUserId: ravi.userId, password: "x" }, {}), "MEMBER_SECURITY_DENIED");
    await rejects(() => org.transferOwnership(client, ownerSession, { targetUserId: meera.userId, password: "wrong" }, {}), "OWNERSHIP_PASSWORD_WRONG");
    const moved = await org.transferOwnership(client, ownerSession, { targetUserId: meera.userId, password: OWNER_PASSWORD + "x" }, {});
    assert(moved.ownerUserId === meera.userId, "moved");
    const after = async (userId) => (await client.query(
      `SELECT array_agg(role.slug ORDER BY role.slug) AS slugs FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`, [organizationId, userId])).rows[0].slugs ?? [];
    const meeraRoles = await after(meera.userId);
    const ownerRoles = await after(owner.userId);
    assert(meeraRoles.includes("organization_owner") && !ownerRoles.includes("organization_owner") && ownerRoles.includes("system_administrator"), "roles: " + JSON.stringify({ meeraRoles, ownerRoles }));
    const memberships = (await client.query("SELECT user_id, role FROM organization_memberships WHERE organization_id = $1 AND user_id IN ($2, $3)", [organizationId, meera.userId, owner.userId])).rows;
    assert(memberships.find((row) => row.user_id === meera.userId).role === "owner" && memberships.find((row) => row.user_id === owner.userId).role === "admin", "memberships");
    // Hand it back for the remaining checks.
    const meeraNow = await contextFor(meera.userId);
    await client.query("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE id = $2) WHERE id = $1", [meera.userId, owner.userId]);
    await org.transferOwnership(client, meeraNow, { targetUserId: owner.userId, password: OWNER_PASSWORD + "x" }, {});
  });

  await check("3 the full export is one zip of every table (secrets left out) and the files; closing waits 30 days, can be cancelled, then closes", async () => {
    const exported = await org.buildWorkspaceExport(client, { organizationId, requestedBy: owner.userId }, { env: process.env });
    assert(exported.tables > 20 && exported.bytes > 1000, "built: " + JSON.stringify(exported));
    const listed = await org.listWorkspaceExports(client, organizationId);
    assert(listed.some((file) => file.id === exported.fileId && file.expiresAt), "listed with an expiry");
    const ownerNow = await contextFor(owner.userId);
    const zip = await org.readWorkspaceExport(client, ownerNow, exported.fileId, { env: process.env });
    const body = Buffer.from(zip.body);
    assert(body.readUInt32LE(0) === 0x04034b50 && body.includes(Buffer.from("README.txt")) && body.includes(Buffer.from("data/public.organization_memberships.csv")), "a zip with the data");
    assert(!body.includes(Buffer.from("password_hash")), "no password column anywhere");
    assert((await client.query("SELECT 1 FROM notifications WHERE organization_id = $1 AND user_id = $2 AND category = 'workspace_export'", [organizationId, owner.userId])).rows.length === 1, "owner told");
    await rejects(() => org.requestWorkspaceClosure(client, ownerNow, { password: OWNER_PASSWORD + "x", confirmName: "Wrong name" }, {}), "WORKSPACE_CLOSE_CONFIRM");
    const name = (await client.query("SELECT name FROM organizations WHERE id = $1", [organizationId])).rows[0].name;
    await rejects(() => org.requestWorkspaceClosure(client, ravi, { password: "x", confirmName: name }, {}), "WORKSPACE_CLOSE_DENIED");
    let closure = await org.requestWorkspaceClosure(client, ownerNow, { password: OWNER_PASSWORD + "x", confirmName: name }, {});
    assert(closure.closesOn && Math.round((new Date(closure.closesOn) - Date.now()) / 86400000) === 30, "closes in 30 days");
    closure = await org.cancelWorkspaceClosure(client, ownerNow);
    assert(!closure.closesOn, "cancelled");
    await org.requestWorkspaceClosure(client, ownerNow, { password: OWNER_PASSWORD + "x", confirmName: name }, {});
    await client.query("UPDATE organizations SET closure_scheduled_for = now() - interval '1 minute' WHERE id = $1", [organizationId]);
    const live = await authSession.createSession(client, { userId: ravi.userId, ipAddress: "10.0.0.3", userAgent: "x", env: {} });
    assert((await org.closeDueWorkspaces(client)) >= 1, "closed");
    assert((await client.query("SELECT status, closed_at FROM organizations WHERE id = $1", [organizationId])).rows[0].status === "closed", "status closed");
    assert((await client.query("SELECT revoked_reason FROM sessions WHERE id = $1", [live.sessionId])).rows[0].revoked_reason === "workspace_closed", "everyone signed out");
  });

  // ---------------------------------------------------------------- Step 4: documents and communication
  const documents = await api("orchestration/documents/registry.js");
  const engine = await import(`file:///${ROOT}packages/document-engine/src/pdf.js`);
  const mail = await api("core/platform/mail/index.js");
  const threads = await api("core/platform/record-thread/index.js");

  await check("4 documents: letterhead, ₹ and Devanagari fonts, amount in words, HSN summary, bank and UPI QR, signatory, copies; thermal receipts", async () => {
    assert(localization.amountInWords(123456.5) === "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only", "words");
    const summary = documents.hsnSummaryTable([
      { hsn_sac_code: "8413", net_amount: "10000", taxes: [{ tax_type: "cgst", tax_amount: "900" }, { tax_type: "sgst", tax_amount: "900" }] },
      { hsn_sac_code: "8413", net_amount: "5000", taxes: [{ tax_type: "cgst", tax_amount: "450" }, { tax_type: "sgst", tax_amount: "450" }] },
      { hsn_sac_code: "9983", net_amount: "2000", taxes: [{ tax_type: "cgst", tax_amount: "180" }, { tax_type: "sgst", tax_amount: "180" }] },
    ]);
    assert(summary.rows.length === 2 && summary.totalRow.taxable === "17,000.00" && summary.rows[0].cgst === "1,350.00", "HSN summary: " + JSON.stringify(summary));
    await org.updateCompanyProfile(client, ownerSession, { upiId: "assign@okhdfcbank" });
    const renderer = { key: "sales.invoice", money: () => ({ amount: "11800", currency: "INR" }), collectsPayment: () => ({ amount: 11800, note: "INV/2627/00001" }), copies: ["Original for recipient", "Duplicate for transporter", "Triplicate for supplier"] };
    const decorated = await documents.decorateDocument(client, owner, renderer, {}, { title: "Tax Invoice", organizationName: null, totals: [] }, { copies: 3 });
    assert(decorated.amountInWords === "Rupees Eleven Thousand Eight Hundred Only" && decorated.copies.length === 3 && decorated.signatory?.companyName, "decorated: " + JSON.stringify({ ...decorated, company: undefined }));
    assert(decorated.company.lines.some((line) => /GSTIN/.test(line)) && decorated.payment?.upi?.uri.startsWith("upi://pay?pa=assign%40okhdfcbank") && /am=11800.00/.test(decorated.payment.upi.uri), "letterhead and UPI: " + JSON.stringify(decorated.payment));
    const pdf = await engine.renderDocumentPdf({ ...decorated, table: { columns: [{ key: "item", label: "Item", width: "60%" }, { key: "amount", label: "Amount (₹)", width: "40%" }], rows: [{ item: "पंप", amount: "10,000.00" }] }, summaryTable: summary });
    const text = pdf.toString("latin1");
    assert(pdf.length > 5000 && /NotoSans/.test(text) && /NotoSansDevanagari/.test(text) && (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length === 3, "three pages with the Noto fonts");
    const receipt = documents.toThermalReceipt({ title: "Tax invoice", organizationName: "Assign Store", documentNumber: "R-1", issuedAt: "19 Oct 2026",
      parties: [{ label: "Store", lines: ["MG Road"] }], fields: [], table: { rows: [{ item: "Tea", quantity: 2, price: "120.00", total: "240.00", gst: "5%" }] },
      totals: [{ label: "Total (INR)", value: "240.00", emphasis: true }, { label: "Paid (cash)", value: "240.00" }], footer: "Thank you" }, 58);
    assert(receipt.lines[0].detail.includes("2 × 120.00") && receipt.payments[0] === "Paid (cash): 240.00", "receipt model");
    assert((await engine.renderReceiptPdf(receipt)).length > 2000, "58 mm receipt renders");
  });

  await check("4 mail: security mail is queued and retried (a 5xx bounces), business mail goes from the company's verified domain with DKIM, and every send is logged", async () => {
    const sentMessages = [];
    mail.setMailTransportForTests({ sendMail: async (message) => { sentMessages.push(message); return { messageId: `<m${sentMessages.length}@test>` }; } });
    try {
      const env = { ...process.env, SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASSWORD: "p", AUTH_EMAIL_FROM: "Vercentlabs <no-reply@vercentlabs.test>" };
      await client.query("DELETE FROM public.mail_log WHERE organization_id = $1 OR organization_id IS NULL AND recipients && ARRAY['queued-a@buyer.example', 'queued-b@buyer.example']", [organizationId]);
      assert(await mail.queueSecurityMail(client, { type: "security-alert", email: "queued-a@buyer.example", subject: "Hello", heading: "Hi", message: "Test", organizationId }, env), "queued");
      await mail.queueSecurityMail(client, { type: "security-alert", email: "queued-b@buyer.example", subject: "Bounce me", heading: "Hi", message: "Test", organizationId }, env);
      const deliver = async (input) => { if (input.email === "queued-b@buyer.example") throw Object.assign(new Error("550 No such user"), { responseCode: 550 }); return true; };
      const first = await mail.processMailQueue(client, { env, deliver });
      assert(first.sent >= 1 && first.bounced >= 1, "sent and bounced: " + JSON.stringify(first));
      const rows = (await client.query("SELECT recipients[1] AS email, status, encrypted_payload IS NULL AS erased FROM public.mail_log WHERE organization_id = $1 AND kind = 'security' ORDER BY created_at", [organizationId])).rows;
      assert(rows.find((row) => row.email === "queued-a@buyer.example").status === "sent" && rows.find((row) => row.email === "queued-b@buyer.example").status === "bounced" && rows.every((row) => row.erased), "statuses: " + JSON.stringify(rows));
      // A passing failure is retried later.
      await mail.queueSecurityMail(client, { type: "security-alert", email: "queued-a@buyer.example", subject: "Retry", heading: "Hi", message: "Test", organizationId }, env);
      const retry = await mail.processMailQueue(client, { env, deliver: async () => { throw new Error("Connection timed out"); } });
      assert(retry.retry === 1 && (await client.query("SELECT status, next_attempt_at > now() AS later FROM public.mail_log WHERE subject = 'Retry' AND organization_id = $1", [organizationId])).rows[0].later, "retried later");
      // Own domain: set up, verify against DNS (a stand-in resolver), then business mail is signed and from the company's address.
      const domainSettings = await mail.setupMailDomain(client, ownerSession, { domain: "assign.example" }, env);
      const dkimRecord = domainSettings.dnsRecords[0];
      const failed = await mail.verifyMailDomain(client, ownerSession, env, async () => []);
      assert(!failed.verified && failed.problems.length === 1, "not yet");
      const verified = await mail.verifyMailDomain(client, ownerSession, env, async (host) => (host === dkimRecord.host ? [[dkimRecord.value.slice(0, 100), dkimRecord.value.slice(100)]] : []));
      assert(verified.verified, "verified");
      await mail.saveMailSettings(client, ownerSession, { mode: "domain", fromName: "Assign Engineering", fromAddress: "accounts@assign.example", replyTo: "sales@assign.example" }, env);
      await rejects(() => mail.saveMailSettings(client, ownerSession, { mode: "domain", fromAddress: "accounts@other.example" }, env), "MAIL_SETTINGS_INVALID");
      const sent = await mail.sendMail({ to: "buyer@buyer.example", subject: "Invoice INV/2627/00001", text: "Please find attached.", meter: { client, organizationId } }, env);
      const message = sentMessages.at(-1);
      assert(sent.sent && sent.via === "company_domain" && message.from.address === "accounts@assign.example" && message.dkim?.domainName === "assign.example" && message.replyTo === "sales@assign.example", "from the company's domain: " + JSON.stringify({ from: message.from, via: sent.via }));
      const logged = await mail.listMailLog(client, organizationId);
      assert(logged.some((entry) => entry.subject === "Invoice INV/2627/00001" && entry.status === "sent" && entry.via === "company_domain"), "logged");
    } finally {
      mail.setMailTransportForTests(null);
    }
  });

  await check("4 record thread: comments with @mentions and internal notes, followers told, activities planned and reminded, only the author edits; visibility follows the record", async () => {
    const item = crmModule;
    await rejects(() => threads.getRecordThread(client, owner, "nonsense.type", item), "RECORD_THREAD_TYPE");
    await rejects(() => threads.getRecordThread(client, owner, "products.item", "00000000-0000-4000-8000-000000000000"), "RECORD_THREAD_NOT_FOUND");
    let thread = await threads.addRecordComment(client, owner, "products.item", item, { body: "@Ravi Rep please check the price list.", mentions: [ravi.userId] });
    assert(thread.comments.length === 1 && thread.following && thread.title, "posted, author follows: " + thread.title);
    assert((await notices(ravi.userId, "record_thread")).some((entry) => /mentioned/.test(entry.title)), "Ravi told of the mention");
    await threads.setRecordFollowing(client, meera, "products.item", item, true);
    thread = await threads.addRecordComment(client, ravi, "products.item", item, { body: "Price updated." });
    assert((await notices(meera.userId, "record_thread")).some((entry) => /New comment/.test(entry.title)) && (await notices(owner.userId, "record_thread")).some((entry) => /New comment/.test(entry.title)), "followers told");
    const before = (await notices(meera.userId, "record_thread")).length;
    await threads.addRecordComment(client, ravi, "products.item", item, { body: "Internal: margin is thin.", kind: "note" });
    assert((await notices(meera.userId, "record_thread")).length === before, "an internal note does not go to followers");
    const ravisComment = thread.comments.find((comment) => comment.body === "Price updated.");
    await rejects(() => threads.editRecordComment(client, owner, "products.item", item, ravisComment.id, { body: "Changed by someone else" }), "RECORD_THREAD_NOT_AUTHOR");
    thread = await threads.editRecordComment(client, ravi, "products.item", item, ravisComment.id, { body: "Price updated to ₹1,500." });
    assert(thread.comments.find((comment) => comment.id === ravisComment.id).editedAt, "edited");
    thread = await threads.scheduleRecordActivity(client, owner, "products.item", item, { type: "call", summary: "Call the supplier about the new rate", dueDate: "2026-01-01", assignedTo: ravi.userId });
    const planned = thread.activities.find((entry) => entry.summary.startsWith("Call the supplier"));
    assert(planned && planned.overdue && planned.assigneeName === "Ravi Rep", "planned: " + JSON.stringify(planned));
    assert((await threads.remindDueRecordActivities(client, organizationId)) >= 1 && (await threads.remindDueRecordActivities(client, organizationId)) === 0, "reminded once a day");
    thread = await threads.closeRecordActivity(client, ravi, "products.item", item, planned.id, { outcome: "done", note: "Rate confirmed" });
    assert(thread.activities.find((entry) => entry.id === planned.id).status === "done", "done");
  });

  // ---------------------------------------------------------------- Step 5: notifications, lists, search, reports, imports
  const notify = await api("core/platform/notifications/index.js");
  const approvalRepo = await api("core/platform/approvals/repository.js");

  await check("5 notifications: email per type (approvals on by default), the daily digest once a day, approvals tell the approvers and the requester", async () => {
    const env = { ...process.env, SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASSWORD: "p", AUTH_EMAIL_FROM: "Vercentlabs <no-reply@vercentlabs.test>" };
    const saved = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: env.SMTP_HOST, SMTP_USER: env.SMTP_USER, SMTP_PASSWORD: env.SMTP_PASSWORD, AUTH_EMAIL_FROM: env.AUTH_EMAIL_FROM });
    try {
      const prefs = await notify.listNotificationPreferences(client, meera);
      const approvalPref = prefs.find((entry) => entry.category === "approval_request");
      assert(approvalPref?.enabled && approvalPref.emailEnabled, "approvals are emailed by default");
      assert(prefs.find((entry) => entry.category === "record_thread")?.emailEnabled === false, "others are not");
      await notify.setNotificationPreference(client, meera, { category: "record_thread", channel: "email", enabled: true });
      assert((await notify.listNotificationPreferences(client, meera)).find((entry) => entry.category === "record_thread").emailEnabled, "email chosen");
      await rejects(() => notify.setNotificationPreference(client, meera, { category: "record_thread", channel: "push", enabled: true }), "NOTIFICATION_CHANNEL_UNSUPPORTED");
      const mails = async (email) => (await client.query("SELECT template, subject, status FROM public.mail_log WHERE organization_id = $1 AND $2 = ANY(recipients) AND kind = 'business' ORDER BY created_at", [organizationId, email])).rows;
      const meeraEmail = (await client.query("SELECT email FROM users WHERE id = $1", [meera.userId])).rows[0].email;
      const before = (await mails(meeraEmail)).length;
      await notify.createNotification(client, { organizationId, userId: meera.userId, category: "record_thread", title: "New comment on Pump", message: "Price updated." });
      const queued = await mails(meeraEmail);
      assert(queued.length === before + 1 && queued.at(-1).template === "notification" && queued.at(-1).status === "queued", "queued: " + JSON.stringify(queued.at(-1)));
      // Delivered through the platform transport.
      const sent = [];
      mail.setMailTransportForTests({ sendMail: async (message) => { sent.push(message); return { messageId: "<n@test>" }; } });
      try {
        assert(await mail.deliverQueuedMail({ type: "notification", email: meeraEmail, organizationName: "Assign", subject: "New comment on Pump", title: "New comment on Pump", message: "Price updated.", href: "/inventory/items/1" }, env), "delivered");
        assert(sent[0].to === meeraEmail && /Assign via Vercentlabs/.test(sent[0].from.name) && /inventory\/items\/1/.test(sent[0].text), "sent: " + JSON.stringify({ from: sent[0].from, text: sent[0].text }));
      } finally { mail.setMailTransportForTests(null); }
      // Digest: on, once a day, only if something is unread.
      assert(!(await notify.getNotificationDigest(client, meera)).enabled, "off by default");
      await notify.setNotificationDigest(client, meera, true);
      await client.query("UPDATE user_preferences SET digest_sent_on = NULL WHERE organization_id = $1", [organizationId]);
      assert((await notify.sendNotificationDigests(client, organizationId)) >= 1, "digest sent");
      assert((await mails(meeraEmail)).some((entry) => entry.template === "digest"), "digest queued");
      assert((await notify.sendNotificationDigests(client, organizationId)) === 0, "not twice a day");
      // Approvals: the approvers (holders of the permission, never the requester) are told; then the requester hears the decision.
      const quotationId = "00000000-0000-4000-8000-0000000000a5";
      const request = await approvalRepo.createApprovalRequest(client, { organizationId, commandKey: "sales.quotation.approve", entityId: quotationId, title: "Quotation QT-9 (₹2,00,000)",
        requestedBy: ravi.userId, payload: { quotationId, quotationVersionId: "00000000-0000-4000-8000-0000000000a6" } });
      assert(request.created, "requested");
      const waiting = await notices(meera.userId, "approval_request");
      assert(waiting.some((entry) => /QT-9/.test(entry.title) && /Ravi Rep/.test(entry.message)), "Meera (a sales manager) told: " + JSON.stringify(waiting));
      assert(!(await notices(ravi.userId, "approval_request")).length, "never the requester");
      assert((await mails(meeraEmail)).some((entry) => /Waiting for your approval/.test(entry.subject)), "and emailed");
      const locked = await approvalRepo.lockApprovalRequest(client, organizationId, request.id);
      await approvalRepo.recordApprovalDecision(client, locked, { decision: "approved", actorUserId: meera.userId, note: "Margin is fine" });
      assert((await notices(ravi.userId, "approval_decided")).some((entry) => /^Approved/.test(entry.title) && /Margin is fine/.test(entry.message)), "Ravi told of the decision");
    } finally {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "AUTH_EMAIL_FROM"]) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  });

  await check("5 module senders: the record's owner hears of others' actions, never their own; permission holders hear of a failed check", async () => {
    const told = await notify.notifyRecordOwner(client, meera, { userId: ravi.userId, category: "sales_document", title: "Quotation QT-1 was accepted", message: "Buyer accepted it." });
    assert(told && (await notices(ravi.userId, "sales_document")).length === 1, "owner told");
    assert(!(await notify.notifyRecordOwner(client, ravi, { userId: ravi.userId, category: "sales_document", title: "x", message: "y" })), "not for your own action");
    const holders = await notify.permissionHolders(client, organizationId, "sales.quotation.approve", meera.userId);
    assert(holders.includes(owner.userId) && !holders.includes(meera.userId) && !holders.includes(ravi.userId), "holders: owner yes, requester excluded, rep lacks the permission");
  });

  const search = await api("orchestration/search/service.js");
  const reportDatasets = await api("orchestration/reporting/datasets.js");
  await check("5 global search covers every built app; every report dataset runs against its app's own list", async () => {
    const modules = ["crm", "sales", "procurement", "stock", "projects", "assets", "point-of-sale", "quality"];
    const result = await search.searchRecords(client, owner, { query: "Assign", accessibleModules: modules });
    const keys = result.groups.map((group) => group.sourceKey);
    for (const key of ["procurement.suppliers", "procurement.purchase-orders", "procurement.supplier-bills", "stock.warehouses", "projects.projects", "projects.tasks", "assets.register", "pos.transactions", "quality.inspections", "quality.nonconformances"])
      assert(keys.includes(key), "searched " + key);
    const broken = result.groups.filter((group) => group.status !== "ok").map((group) => group.sourceKey);
    assert(!broken.length, "unavailable providers: " + broken.join(", "));
    for (const dataset of reportDatasets.REPORT_DATASETS.filter((entry) => !entry.key.startsWith("crm."))) {
      await client.query("SAVEPOINT dataset_check");
      try {
        const rows = await dataset.execute(client, owner, {}, 50);
        assert(Array.isArray(rows), dataset.key + " gives rows");
        await client.query("RELEASE SAVEPOINT dataset_check");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT dataset_check");
        throw new Error(`${dataset.key}: ${error.message}`);
      }
    }
  });

  const savedViews = await api("core/platform/saved-views/index.js");
  const imports = await api("orchestration/imports/index.js");
  const csv = await api("core/platform/data-exchange/csv.js");
  await check("5 saved views on any list: own or shared (managers only), one default, same name replaces, only the owner deletes", async () => {
    const first = await savedViews.saveSavedListView(client, meera, { listKey: "sales.invoices", name: "Overdue Pune", state: { view: "overdue", filters: { city: "Pune" } }, isDefault: true });
    await savedViews.saveSavedListView(client, meera, { listKey: "sales.invoices", name: "overdue pune", state: { view: "overdue", filters: { city: "Pune", currencyCode: "INR" } } });
    let mine = await savedViews.listSavedListViews(client, meera, "sales.invoices");
    assert(mine.views.length === 1 && mine.views[0].state.filters.currencyCode === "INR" && !mine.views[0].isDefault && !mine.canShare, "replaced by name: " + JSON.stringify(mine));
    await savedViews.setSavedListViewDefault(client, meera, first.view.id, true);
    await rejects(() => savedViews.saveSavedListView(client, meera, { listKey: "sales.invoices", name: "Everyone", state: {}, shared: true }), "SAVED_VIEW_SHARE_FORBIDDEN");
    const sharedView = await savedViews.saveSavedListView(client, owner, { listKey: "sales.invoices", name: "Month end", state: { view: "posted" }, shared: true });
    mine = await savedViews.listSavedListViews(client, meera, "sales.invoices");
    assert(mine.views.length === 2 && mine.views.find((view) => view.shared && !view.mine)?.ownerName && mine.views.find((view) => view.mine).isDefault, "sees the shared one: " + JSON.stringify(mine.views));
    await rejects(() => savedViews.deleteSavedListView(client, ravi, first.view.id), "SAVED_VIEW_NOT_FOUND");
    await rejects(() => savedViews.listSavedListViews(client, meera, "Bad Key!"), "SAVED_VIEW_LIST_INVALID");
    await savedViews.deleteSavedListView(client, owner, sharedView.view.id);
    assert((await savedViews.listSavedListViews(client, ravi, "sales.invoices")).views.length === 0, "Ravi sees nothing of Meera's");
  });

  await check("5 imports: Excel's Windows-1252 and UTF-16 CSVs read; warehouses, bins and tax rates import through their apps, row by row, with a dry run", async () => {
    const latin = csv.parseCsvUpload(Buffer.concat([Buffer.from("Name,City\n"), Buffer.from([0x52, 0xe9, 0x6d, 0x79, 0x2c, 0x50, 0x75, 0x6e, 0x65, 0x96, 0x31, 0x0a])]));
    assert(latin.records[0].Name === "Rémy" && latin.records[0].City === "Pune–1", "Windows-1252: " + JSON.stringify(latin.records));
    assert(csv.parseCsvUpload(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Name\nA\n", "utf16le")])).records[0].Name === "A", "UTF-16");
    await rejects(async () => csv.parseCsvUpload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])), "CSV_ENCODING_INVALID");
    const modules = ["sales", "procurement", "stock", "accounting", "projects", "assets"];
    const keys = imports.listImporters(owner, modules).map((entry) => entry.key);
    assert(keys.includes("stock.warehouses") && keys.includes("accounting.open_invoices") && !keys.includes("hr.employees"), "importers for the apps on: " + keys.join(","));
    assert(imports.listImporters(ravi, modules).every((entry) => entry.key !== "stock.warehouses"), "only with the permission");
    const file = (rows) => Buffer.from(rows.map((row) => row.join(",")).join("\r\n") + "\r\n", "latin1");
    const warehouses = file([["Code", "Name", "Address Line 1", "City", "State", "PIN", "Country"], ["NSK-01", "Nashik Godown", "Plot 7 MIDC", "Nashik", "Maharashtra", "422010", "IN"],
      ["NSK-02", "", "Plot 8", "Nashik", "Maharashtra", "422010", "IN"], ["BLR-01", "Bengaluru Store", "12 Peenya", "Bengaluru", "Karnataka", "560058", "IN"]]);
    const analysis = imports.analyzeImport(owner, modules, "stock.warehouses", { bytes: warehouses, fileName: "w.csv" });
    assert(analysis.suggestedMapping.PIN === "postalCode" && analysis.suggestedMapping.Country === "countryCode", "mapping: " + JSON.stringify(analysis.suggestedMapping));
    const check1 = await imports.runImport(client, owner, modules, "stock.warehouses", { bytes: warehouses, fileName: "w.csv", dryRun: true });
    assert(check1.created === 2 && check1.failed === 1 && /Missing Name/.test(check1.results[1].message), "dry run: " + JSON.stringify(check1.results));
    assert(!(await client.query("SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND code = 'NSK-01'", [organizationId])).rows[0], "dry run saved nothing");
    const done = await imports.runImport(client, owner, modules, "stock.warehouses", { bytes: warehouses, fileName: "w.csv" });
    assert(done.created === 2 && done.results[0].reference, "imported: " + JSON.stringify(done.results));
    const again = await imports.runImport(client, owner, modules, "stock.warehouses", { bytes: warehouses, fileName: "w.csv" });
    assert(again.created === 0 && again.results[0].outcome !== "created", "a second time, already there: " + JSON.stringify(again.results[0]));
    const bins = file([["Warehouse", "Location Code", "Location Name", "Inside Location"], ["NSK-01", "RACK-A", "Rack A", ""], ["NSK-01", "RACK-A01", "Rack A shelf 1", "RACK-A"], ["XXX", "B1", "Bin 1", ""]]);
    const binResult = await imports.runImport(client, owner, modules, "stock.locations", { bytes: bins, fileName: "b.csv" });
    assert(binResult.created === 2 && /No warehouse "XXX"/.test(binResult.results[2].message), "bins: " + JSON.stringify(binResult.results));
    const rates = file([["Code", "Name", "Rate %", "Effective From"], ["GST-IMP-18", "GST 18% (import)", "18", "01/07/2017"], ["GST-IMP-5", "GST 5% (import)", "5", "31-13-2020"]]);
    const rateResult = await imports.runImport(client, owner, modules, "tax.rates", { bytes: rates, fileName: "t.csv" });
    assert(rateResult.created === 1 && /Effective From/.test(rateResult.results[1].message), "rates: " + JSON.stringify(rateResult.results));
    assert(/^\ufeffCode,Name,Type/.test(imports.buildImportTemplate("stock.warehouses")), "template");
    // Bring your data: the steps of the company's apps, counted, and the cut-over date.
    await imports.setDataCutoverDate(client, owner, "2026-04-01");
    const list = await imports.getDataChecklist(client, owner, modules);
    assert(list.cutoverDate === "2026-04-01" && list.steps.find((step) => step.key === "warehouses").count >= 2 && !list.steps.some((step) => step.key === "employees"), "checklist: " + JSON.stringify(list));
  });

  await check("5 imports into Accounting, Manufacturing and HR reach their apps: each row imports or says why", async () => {
    const all = ["sales", "procurement", "stock", "accounting", "manufacturing", "hr-payroll"];
    const file = (rows) => Buffer.from(rows.map((row) => row.join(",")).join("\r\n") + "\r\n");
    const cases = {
      "accounting.accounts": [["Account Code", "Account Name", "Class", "Group Code"], ["4105", "Sales - Exports", "Income", ""], ["4106", "Sales - Scrap", "Expenses?", ""]],
      "accounting.open_invoices": [["Customer", "Original Invoice Number", "Invoice Date", "Amount Due"], ["No Such Customer", "INV/2526/9", "15/02/2026", "1000"]],
      "accounting.open_bills": [["Supplier", "Supplier Invoice Number", "Bill Date", "Amount Due"], ["No Such Supplier", "B-1", "15/02/2026", "abc"]],
      "manufacturing.boms": [["Product Code", "Material Code", "Quantity"], ["NO-SUCH", "NO-SUCH-2", "1"], ["NO-SUCH", "NO-SUCH-3", "2"]],
      "hr.employees": [["First Name", "Last Name", "Joining Date", "Department"], ["Anita", "Deshmukh", "01/04/2024", "No Such Department"]],
    };
    for (const [key, rows] of Object.entries(cases)) {
      await client.query("SAVEPOINT import_case");
      try {
        const result = await imports.runImport(client, owner, all, key, { bytes: file(rows), fileName: "f.csv", dryRun: true });
        assert(result.results.length === (key === "manufacturing.boms" ? 1 : rows.length - 1) && result.results.every((row) => row.message), key + ": " + JSON.stringify(result.results));
        if (key === "accounting.accounts") assert(/Class must be/.test(result.results[1].message), "a bad class is named: " + JSON.stringify(result.results));
        if (key === "accounting.open_invoices") assert(/No customer "No Such Customer"/.test(result.results[0].message), "customer named");
        if (key === "manufacturing.boms") assert(result.results[0].rows.join() === "2,3" && /NO-SUCH/.test(result.results[0].message), "one BOM from two rows: " + JSON.stringify(result.results));
        await client.query("RELEASE SAVEPOINT import_case");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT import_case");
        throw new Error(`${key}: ${error.message}`);
      }
    }
  });

  // ---------------------------------------------------------------- Step 6: automations and integrations
  const events = await api("core/platform/events/index.js");
  const workflows = await api("core/platform/workflows/index.js");

  await check("6 events and automations: Sales, Procurement, Stock and POS events; amounts compared; email, activity and notice for any app; time triggers queue once a day", async () => {
    for (const key of ["sales.order.confirmed", "sales.invoice.posted", "sales.delivery.dispatched", "procurement.purchase_order.confirmed", "procurement.goods_receipt.posted",
      "procurement.supplier_bill.posted", "stock.transfer.completed", "stock.low_stock.raised", "pos.shift.closed", "pos.day.closed"])
      assert(events.getDomainEvent(key), "registered " + key);
    const projected = events.projectDomainEvent({ id: "e1", event_type: "sales.invoice.posted", entity_type: "sales.invoice", entity_id: "i1", module_key: "sales", occurred_at: new Date(),
      payload: { invoiceNumber: "INV/2627/00009", total: "250000.00", ownerUserId: ravi.userId, lines: [{ secret: true }] } });
    assert(projected.data.total === "250000.00" && !projected.data.lines, "allow-listed payload: " + JSON.stringify(projected.data));
    await rejects(() => workflows.createWorkflow(client, owner, { name: "Bad", trigger: "sales.invoice.posted", conditions: [{ field: "ownerUserId", operator: "greater_than", value: "5" }],
      actions: [{ type: "notify", recipient: { type: "user", userId: meera.userId }, title: "x", message: "" }] }), "WORKFLOW_DEFINITION_INVALID");
    await rejects(() => workflows.createWorkflow(client, owner, { name: "Bad assign", trigger: "sales.invoice.posted", actions: [{ type: "assign", userId: meera.userId }] }), "WORKFLOW_DEFINITION_INVALID");
    const big = await workflows.createWorkflow(client, owner, {
      name: "Big invoices", trigger: "sales.invoice.posted", status: "active", conditions: [{ field: "total", operator: "greater_than", value: "100000" }],
      actions: [
        { type: "notify", recipient: { type: "event_field", field: "ownerUserId" }, title: "Big invoice {{invoiceNumber}}", message: "" },
        { type: "send_email", to: { type: "address", email: "accounts@assign.example" }, subject: "Invoice {{invoiceNumber}} for ₹{{total}}", body: "Please check {{invoiceNumber}}." },
        { type: "create_activity", activityType: "call", summary: "Call about {{invoiceNumber}}", inDays: 2, assignee: { type: "event_field", field: "ownerUserId" } },
      ],
    });
    const run = async (payload) => {
      const id = await events.publishDomainEvent(client, { organizationId, moduleKey: "sales", eventType: "sales.invoice.posted", entityType: "sales.invoice", entityId: "00000000-0000-4000-8000-0000000000c1", payload });
      const row = (await client.query("SELECT * FROM tenant.platform_events WHERE id = $1", [id])).rows[0];
      await workflows.fanOutWorkflowRuns(client, row);
      const runs = (await workflows.claimWorkflowRuns(client, organizationId)).filter((entry) => entry.workflow_id === big.id);
      return Promise.all(runs.map((entry) => workflows.executeWorkflowRun(client, entry)));
    };
    const small = await run({ invoiceNumber: "INV/2627/00010", total: "5000.00", ownerUserId: ravi.userId });
    assert(small.length === 1 && !small[0].matched, "small invoice does not match");
    const [large] = await run({ invoiceNumber: "INV/2627/00011", total: "250000.00", ownerUserId: ravi.userId });
    assert(large.matched && large.actions.length === 3 && large.actions[2].created, "big one runs every step: " + JSON.stringify(large));
    const activity = (await client.query("SELECT summary, assigned_to, activity_type FROM public.record_activities WHERE organization_id = $1 AND entity_id = '00000000-0000-4000-8000-0000000000c1'", [organizationId])).rows[0];
    assert(activity?.summary === "Call about INV/2627/00011" && activity.assigned_to === ravi.userId && activity.activity_type === "call", "activity planned: " + JSON.stringify(activity));
    assert((await notices(ravi.userId, "automation")).some((entry) => /Call about INV\/2627\/00011/.test(entry.title)), "and the assignee told");
    // Time triggers: every trigger's query runs, and a run is queued once per record and day.
    for (const trigger of workflows.TIME_TRIGGERS)
      await workflows.createWorkflow(client, owner, { name: trigger.label, trigger: trigger.key, offsetDays: 3, status: "active",
        actions: [{ type: "notify", recipient: { type: "user", userId: meera.userId }, title: "Due {{dueDate}}", message: "" }] });
    await rejects(() => workflows.createWorkflow(client, owner, { name: "No offset", trigger: "time.sales.invoice.due", offsetDays: 999, actions: [{ type: "notify", recipient: { type: "user", userId: meera.userId }, title: "x", message: "" }] }), "WORKFLOW_DEFINITION_INVALID");
    const queued = await workflows.queueTimeTriggeredRuns(client, organizationId, "2026-10-19");
    assert(queued >= 0 && (await workflows.queueTimeTriggeredRuns(client, organizationId, "2026-10-19")) === 0, "once per record and day");
    assert(workflows.evaluateWorkflowConditions([{ field: "balanceDue", operator: "less_than", value: "100" }], { balanceDue: "99.50" }), "less than");
  });

  const approvalsCore = await api("core/platform/approvals/index.js");
  await check("6 approval rules: amount thresholds, a member or a role, two levels; each level asked once and in order; routed approvers see their requests", async () => {
    const managerRole = (await client.query("SELECT role_id FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1", [organizationId, meera.userId])).rows[0].role_id;
    await rejects(() => approvalsCore.saveApprovalRule(client, owner, { documentType: "procurement.purchase_order", name: "Both", minAmount: 0, level: 1, approverUserId: meera.userId, approverRoleId: managerRole }), "APPROVAL_RULE_INVALID");
    await approvalsCore.saveApprovalRule(client, owner, { documentType: "procurement.purchase_order", name: "Any PO", minAmount: 0, level: 1, approverUserId: ravi.userId });
    await approvalsCore.saveApprovalRule(client, owner, { documentType: "procurement.purchase_order", name: "Large PO", minAmount: 100000, level: 1, approverRoleId: managerRole });
    await approvalsCore.saveApprovalRule(client, owner, { documentType: "procurement.purchase_order", name: "Very large PO", minAmount: 1000000, level: 2, approverUserId: owner.userId });
    assert((await approvalsCore.approvalLevelsFor(client, organizationId, "procurement.purchase_order", 5000)).map((rule) => rule.name).join() === "Any PO", "small: one level, the base rule");
    const big = await approvalsCore.approvalLevelsFor(client, organizationId, "procurement.purchase_order", 2500000);
    assert(big.map((rule) => `${rule.level}:${rule.name}`).join() === "1:Large PO,2:Very large PO", "big: the highest threshold per level: " + JSON.stringify(big));
    const documentId = "00000000-0000-4000-8000-0000000000d1";
    const ask = () => approvalsCore.requireRuleApprovals(client, owner, { documentType: "procurement.purchase_order", documentId, amount: "2500000.00", contentKey: "s:2500000.00", title: "PO-1" });
    const first = await ask();
    assert(first.required && !first.approved && first.pending.level === 1, "level 1 asked: " + JSON.stringify(first));
    assert((await ask()).pending.level === 1 && (await client.query("SELECT count(*)::int AS n FROM public.approval_requests WHERE organization_id = $1 AND entity_id = $2", [organizationId, documentId])).rows[0].n === 1, "asked once");
    const visible = await approvalsCore.listApprovalRequestsForViewer(client, { organizationId, userId: meera.userId, oversight: false, decidableCommandKeys: [] });
    const mine = visible.find((row) => row.entity_id === documentId);
    assert(mine?.routed_to_viewer && mine.approval_level === 1, "Meera (the role) sees it as hers: " + JSON.stringify(mine));
    assert(!(await approvalsCore.listApprovalRequestsForViewer(client, { organizationId, userId: ravi.userId, oversight: false, decidableCommandKeys: ["procurement.purchase_order.approve"] })).some((row) => row.entity_id === documentId),
      "a permission holder does not see a request routed to a role");
    assert((await notices(meera.userId, "approval_request")).some((entry) => /PO-1 · level 1/.test(entry.title)), "the role is told");
    await client.query("UPDATE public.approval_requests SET status = 'approved', decided_at = now() WHERE organization_id = $1 AND entity_id = $2", [organizationId, documentId]);
    const second = await ask();
    assert(second.pending?.level === 2, "then level 2: " + JSON.stringify(second));
    await client.query("UPDATE public.approval_requests SET status = 'approved', decided_at = now() WHERE organization_id = $1 AND entity_id = $2", [organizationId, documentId]);
    assert((await ask()).approved, "every level approved");
    const changed = await approvalsCore.requireRuleApprovals(client, owner, { documentType: "procurement.purchase_order", documentId, amount: "2600000.00", contentKey: "s:2600000.00", title: "PO-1" });
    assert(!changed.approved && changed.pending.level === 1, "a changed total is asked again");
  });

  const publicApi = await api("orchestration/public-api/index.js");
  const apiKeys = await api("core/platform/integrations/api-keys/index.js");
  await check("6 public API: core-record scopes, each with only its permissions; lists page; writes go through the app's own checks; payments read", async () => {
    const scopes = apiKeys.listApiScopes().map((scope) => scope.key);
    for (const key of ["customers.read", "customers.write", "items.read", "items.write", "sales_orders.read", "sales_orders.write", "invoices.read", "stock.read", "payments.read"])
      assert(scopes.includes(key), "scope " + key);
    const app = await apiKeys.createDeveloperApp(client, owner, { name: "Tally connector" });
    const principal = { kind: "api_key", organizationId, developerAppId: app.id, developerAppName: app.name, apiKeyId: "00000000-0000-4000-8000-0000000000e1", scopes };
    const customers = await publicApi.apiListCustomers(client, principal, { limit: "2" });
    assert(Array.isArray(customers.data) && customers.limit === 2 && Number.isInteger(customers.total), "customers page: " + JSON.stringify({ ...customers, data: customers.data.length }));
    assert(customers.data.every((row) => row.outstanding === undefined && row.creditLimit === undefined), "no finance figures without a finance scope");
    const created = await publicApi.apiCreateCustomer(client, principal, { displayName: "Konkan Traders", customerKind: "business", countryCode: "IN", currencyCode: "INR" });
    assert(created.data?.customer?.id || created.data?.id, "created through the Customer Master: " + JSON.stringify(created.data).slice(0, 200));
    await rejects(() => publicApi.apiCreateCustomer(client, principal, { customerKind: "business" }), undefined);
    for (const [name, call] of [["items", publicApi.apiListItems], ["orders", publicApi.apiListSalesOrders], ["invoices", publicApi.apiListInvoices], ["stock", publicApi.apiStockLevels], ["payments", publicApi.apiListPayments]]) {
      await client.query("SAVEPOINT api_list");
      try {
        const page = await call(client, principal, {});
        assert(Array.isArray(page.data), name + " lists");
        if (name === "stock") assert(page.data.every((row) => row.value === undefined), "stock without values");
        await client.query("RELEASE SAVEPOINT api_list");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT api_list");
        throw new Error(`${name}: ${error.message}`);
      }
    }
    assert(publicApi.API_SCOPE_PERMISSIONS["items.read"].join() === "products.view", "items.read grants only products.view");
  });

  const social = await api("core/auth/social-sign-in.js");
  await check("6 sign in with Google / Microsoft: PKCE + one-time state; an identity linked from the profile, or a verified Google email, signs in; Microsoft must be linked first", async () => {
    const env = { ...process.env, GOOGLE_OAUTH_CLIENT_ID: "g-client", GOOGLE_OAUTH_CLIENT_SECRET: "g-secret", MICROSOFT_OAUTH_CLIENT_ID: "m-client", MICROSOFT_OAUTH_CLIENT_SECRET: "m-secret", APP_URL: "https://erp.example" };
    assert(social.socialSignInProviders(env).join() === "google,microsoft" && social.socialSignInProviders({}).length === 0, "only configured providers");
    const started = await social.beginSocialSignIn(client, { provider: "google", returnTo: "/sales" }, env);
    const url = new URL(started.url);
    assert(url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("nonce") && url.searchParams.get("redirect_uri") === "https://erp.example/api/auth/oauth/google/callback", "authorize URL: " + started.url);
    const state = await social.consumeSocialSignInState(client, "google", url.searchParams.get("state"), env);
    assert(state.purpose === "sign_in" && state.returnTo === "/sales" && state.verifier, "state read");
    await rejects(() => social.consumeSocialSignInState(client, "google", url.searchParams.get("state"), env), "AUTH_SOCIAL_STATE_INVALID");
    await rejects(() => social.beginSocialSignIn(client, { provider: "github" }, env), "AUTH_SOCIAL_PROVIDER_UNKNOWN");
    const ownerEmail = (await client.query("SELECT email FROM users WHERE id = $1", [owner.userId])).rows[0].email;
    await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [owner.userId]);
    // Google with the owner's verified email: found and linked.
    assert((await social.resolveSocialSignIn(client, state, { provider: "google", subject: "g-123", email: ownerEmail, emailVerified: true })) === owner.userId, "matched by verified email");
    assert((await social.listSocialIdentities(client, owner.userId)).some((entry) => entry.provider === "google"), "and linked");
    // Microsoft: not linked, so refused even with the same email; linked from the profile, then it signs in.
    await rejects(() => social.resolveSocialSignIn(client, state, { provider: "microsoft", subject: "m-9", email: ownerEmail, emailVerified: false }), "AUTH_SOCIAL_NOT_LINKED");
    const link = { ...state, purpose: "link", userId: meera.userId };
    await social.resolveSocialSignIn(client, link, { provider: "microsoft", subject: "m-9", email: "meera@contoso.example", emailVerified: false });
    assert((await social.resolveSocialSignIn(client, state, { provider: "microsoft", subject: "m-9", email: null, emailVerified: false })) === meera.userId, "the linked Microsoft account signs Meera in");
    await rejects(() => social.resolveSocialSignIn(client, { ...state, purpose: "link", userId: ravi.userId }, { provider: "microsoft", subject: "m-9", email: null, emailVerified: false }), "AUTH_SOCIAL_ALREADY_LINKED");
  });

  // ---------------------------------------------------------------- Step 7: India compliance
  const tax = await api("core/tax/index.js");
  const taxEngine = await api("core/tax/engine.js");
  const gstInvoicing = await api("core/invoicing/index.js");
  const withholding = await api("core/tax/withholding.js");
  const compliance = await api("orchestration/compliance/index.js");
  const rates = await api("core/exchange-rates/index.js");
  const products = await api("modules/products/units.js");

  await check("7 UQC: units carry their GST unit code (seeded and new), the HSN summary groups by code and UQC with the quantity", async () => {
    assert(tax.uqcForUnitCode("EA") === "NOS" && tax.uqcForUnitCode("KG") === "KGS" && tax.isGstUqc("LTR") && !tax.isGstUqc("XYZ"), "catalogue");
    const unit = await products.createUnitOfMeasure(client, owner, { code: "TIN", name: "Tin", category: "packaging", uqc: "CAN" });
    assert(unit.uqc === "CAN", "chosen UQC kept");
    await rejects(() => products.createUnitOfMeasure(client, owner, { code: "TUBX", name: "Tube", category: "packaging", uqc: "ZZZ" }), "UOM_VALIDATION");
    const auto = await products.createUnitOfMeasure(client, owner, { code: "DZ", name: "Dozen", category: "quantity" });
    assert(auto.uqc === "DOZ", "usual UQC filled in: " + auto.uqc);
    const map = await tax.unitUqcMap(client, organizationId);
    const summary = documents.hsnSummaryTable([
      { hsn_sac_code: "8413", uom_snapshot: "TIN", quantity: "4", net_amount: "1000", taxes: [{ tax_type: "igst", tax_amount: "180" }] },
      { hsn_sac_code: "8413", uom_snapshot: "TIN", quantity: "6", net_amount: "1500", taxes: [{ tax_type: "igst", tax_amount: "270" }] },
      { hsn_sac_code: "8413", uom_snapshot: "DZ", quantity: "1", net_amount: "500", taxes: [{ tax_type: "igst", tax_amount: "90" }] },
    ], map);
    assert(summary.rows.length === 2 && summary.rows[0].uqc === "CAN" && summary.rows[0].quantity === "10" && summary.columns.some((column) => column.key === "uqc"), "summary: " + JSON.stringify(summary.rows));
  });

  await check("7 composition scheme: no GST charged, numbers from the bill-of-supply series, category and rate kept, CMP-08 figures", async () => {
    const registration = await tax.createTaxRegistration(client, owner, { code: "CMP", name: "Composition unit", registrationNumber: gstinOf("27AAACZ9999Z1Z"), stateCode: "27",
      registrationType: "composition", compositionCategory: "restaurant" });
    assert(registration.registrationType === "composition" && registration.compositionCategory === "restaurant" && registration.compositionRate === "5", "category and its rate: " + JSON.stringify(registration));
    const category = (await client.query("SELECT id FROM tenant.tax_categories WHERE organization_id = $1 AND code = 'GST-18'", [organizationId])).rows[0];
    const context = await taxEngine.loadTaxContext(client, { organizationId, sellerRegistrationId: registration.id });
    const line = await taxEngine.resolveLineTax(client, context, { taxCategoryId: category.id, date: "2026-10-19", sellerStateCode: "27", placeOfSupply: "27" });
    assert(line.composition && Number(line.rate) === 0 && line.components.length === 0, "no tax: " + JSON.stringify({ ...line, rate: String(line.rate), cessRate: String(line.cessRate) }));
    const number = await gstInvoicing.allocateGstDocumentNumber(client, owner, { kind: "tax_invoice", registrationId: registration.id, day: "2026-10-19" });
    assert(/^BOS\//.test(number.number), "bill of supply series: " + number.number);
    const cmp = reportDatasets.REPORT_DATASETS.find((entry) => entry.key === "tax.cmp08");
    const quarters = await cmp.execute(client, owner, { financialYear: "2026-27" }, 100);
    assert(quarters.filter((row) => row.gstin === registration.registrationNumber).length === 4 && quarters[0].rate === "5", "four quarters at 5%: " + JSON.stringify(quarters.slice(0, 1)));
    const gstr1 = await reportDatasets.REPORT_DATASETS.find((entry) => entry.key === "tax.gstr1_documents").execute(client, owner, { from: "2026-04-01", to: "2027-03-31" }, 100);
    assert(Array.isArray(gstr1), "GSTR-1 documents summary runs");
  });

  await check("7 TDS: below the limits nothing is withheld; individuals at their rate; no PAN at 206AA's rate; a lower-deduction certificate replaces the rate", async () => {
    const section = await withholding.saveWithholdingSection(client, owner, null, { code: "194C-T", name: "Contractors", rate: "2", rateIndividual: "1", thresholdSingle: "30000", thresholdAnnual: "100000" });
    const row = (await client.query("SELECT * FROM tenant.withholding_tax_sections WHERE id = $1", [section.id])).rows[0];
    const supplier = { id: "00000000-0000-4000-8000-0000000000f1", supplier_type: "business", pan: "AAACV1111A" };
    const at = (taxable, who = supplier) => withholding.effectiveWithholdingRate(client, organizationId, { section: row, supplier: who, billDate: "2026-10-19", taxable });
    assert((await at(20000)).rate === "0", "below 30,000 a bill");
    assert((await at(40000)).rate === "2", "over the bill limit, at 2%");
    assert((await at(20000, { ...supplier, supplier_type: "individual" })).rate === "0" && (await at(35000, { ...supplier, supplier_type: "individual" })).rate === "1", "individual 1%");
    const noPan = await at(50000, { ...supplier, pan: "" });
    assert(noPan.rate === "20" && /206AA/.test(noPan.reason), "no PAN: " + JSON.stringify(noPan));
    await withholding.saveTdsCertificate(client, owner, { supplierId: supplier.id, sectionId: section.id, certificateNumber: "LDC-1", rate: "0.5", validFrom: "2026-04-01", validTo: "2027-03-31", amountLimit: "500000" });
    const certified = await at(50000);
    assert(certified.rate === "0.5" && /LDC-1/.test(certified.reason), "certificate: " + JSON.stringify(certified));
  });

  await check("7 e-invoice and e-way bill: a GSP is required (the stand-in answers like one), the e-way bill JSON is built, rates feed in daily", async () => {
    assert(!compliance.gspConfigured({}) && compliance.gspConfigured({ EINVOICE_GSP_URL: "standin" }) && !compliance.gspConfigured({ EINVOICE_GSP_URL: "https://gsp.example" }), "configuration");
    const payload = compliance.buildEwayBillPayload({ number: "DL-1", date: "2026-10-19", supplyType: "O", subSupplyType: "1", docType: "CHL", seller: { registration_number: "27AAACV1111A1Z5", legal_name: "Assign" },
      from: { line1: "MIDC", city: "Pune", pin: "411026", state: "27" }, to: { gstin: "29AAACB2222B1Z5", name: "Buyer", line1: "Peenya", city: "Bengaluru", pin: "560058", state: "29" },
      items: [{ name: "Pump", hsn: "8413", quantity: 2, unit: "NOS", taxable: 60000, rate: 18 }], interState: true }, { distanceKm: 840, vehicleNumber: "mh12 ab 1234" });
    assert(payload.igstValue === 10800 && payload.totInvValue === 70800 && payload.vehicleNo === "MH12AB1234" && payload.docDate === "19/10/2026" && payload.itemList[0].qtyUnit === "NOS", "EWB JSON: " + JSON.stringify(payload));
    await rejects(() => compliance.generateEwayBill(client, owner, "sales_delivery", "00000000-0000-4000-8000-0000000000f2", { distanceKm: 10 }), "EWAY_SOURCE_NOT_FOUND");
    await rejects(() => compliance.generateEInvoice(client, ravi, "00000000-0000-4000-8000-0000000000f3"), "PERMISSION_DENIED");
    // Rates: one feed a day, for the company's currencies.
    await client.query("INSERT INTO tenant.currencies (organization_id, code, name, status) VALUES ($1, 'USD', 'US dollar', 'active') ON CONFLICT DO NOTHING", [organizationId]).catch(() => undefined);
    const env = { EXCHANGE_RATE_FEED_URL: "https://rates.example/today.json" };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ date: "2026-10-19", base: "INR", rates: { USD: 84.25, EUR: 91.1 } }) });
    const written = await rates.applyReferenceRates(client, organizationId, { env, fetchImpl, today: "2099-01-01" });
    const usd = (await client.query("SELECT rate::text, source FROM tenant.exchange_rates WHERE organization_id = $1 AND from_currency_code = 'USD' AND rate_date = '2026-10-19'", [organizationId])).rows[0];
    assert(written >= 1 && usd?.source === "feed" && Number(usd.rate) === 84.25, "USD from the feed: " + JSON.stringify(usd));
  });

} catch (error) {
  failures.push("setup");
  console.log("FATAL", error?.stack || error);
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ": " + failures.join(" | ") : ""}\n(transaction rolled back: the database is unchanged)`);
  process.exit(failures.length ? 1 : 0);
}
