import assert from "node:assert/strict";
import test from "node:test";

import { crmAccountAccessSql, crmContactAccessSql, crmOwnerScopeSql } from "../src/modules/crm/crm-data-operations-and-customization/crm-access-scope.js";
import { listCrmAccounts } from "../src/modules/crm/prospect-and-relationship-master-data/account-operations.js";
import { listCrmContacts } from "../src/modules/crm/prospect-and-relationship-master-data/contact-operations.js";
import { getCustomer360 } from "../src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js";
import { assertCrmExportAllowed, buildCrmLeadExportCsv, enqueueCrmLeadExportJob } from "../src/modules/crm/prospect-and-relationship-master-data/lead-export.js";

// CRM role hierarchy correction — the shared scope helpers and the surfaces
// that previously bypassed them. The same rules run against a real database
// in crm-access-matrix-db.test.mjs.

const org = "11111111-1111-4111-8111-111111111111";
const me = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const rep = { organizationId: org, userId: me, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: ["crm.view", "crm.leads.manage"], roleSlugs: [] };
const viewAll = { ...rep, permissions: ["crm.view", "crm.records.view_all"] };
const binder = () => { const values = []; return { values, bind: (value) => { values.push(value); return `$${values.length}`; } }; };

test("owner scope: view-all adds nothing; everyone else gets own + unassigned + managed team", () => {
  assert.equal(crmOwnerScopeSql(viewAll, binder().bind, "lead.owner_user_id", "lead.organization_id"), "");
  const { values, bind } = binder();
  const sql = crmOwnerScopeSql(rep, bind, "lead.owner_user_id", "lead.organization_id");
  assert.match(sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id = \$1 OR EXISTS \(SELECT 1 FROM tenant\.crm_sales_team_members/);
  assert.match(sql, /managed_team\.status='active' AND managed_team\.manager_user_id=\$1/);
  assert.match(sql, /team_member\.effective_to IS NULL OR team_member\.effective_to>=current_date/, "ended memberships stop granting access");
  assert.deepEqual(values, [me], "the caller is bound once and reused");
  assert.doesNotMatch(crmOwnerScopeSql({ ...viewAll, ownRecordsOnly: true }, binder().bind, "x.owner", "x.organization_id"), /IS NULL|crm_sales_team_members/, "'mine' means mine, even for view-all");
});

test("account access: shared (NULL owner), own, managed team, or an opportunity I/my team own", () => {
  assert.equal(crmAccountAccessSql(viewAll, binder().bind, "account"), "");
  const sql = crmAccountAccessSql(rep, binder().bind, "account");
  assert.match(sql, /account\.owner_user_id IS NULL OR account\.owner_user_id = \$1/);
  assert.match(sql, /FROM tenant\.crm_opportunities account_opportunity[\s\S]*account_opportunity\.party_id=account\.id[\s\S]*account_opportunity\.owner_user_id = \$1/);
  assert.equal((sql.match(/crm_sales_team_members/g) || []).length, 2, "team rule applies to the account owner and to the deal owner");
});

test("contact access inherits the account rule; standalone contacts follow their creator, never everyone", () => {
  const sql = crmContactAccessSql(rep, binder().bind, "contact", "account");
  assert.match(sql, /contact\.party_id IS NOT NULL AND \(account\.owner_user_id IS NULL/);
  assert.match(sql, /contact\.party_id IS NULL AND \(contact\.created_by = \$1\s+OR EXISTS/);
  assert.equal(crmContactAccessSql(viewAll, binder().bind, "contact", "account"), "");
});

function capture(rows = []) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows, rowCount: rows.length }; } };
}

test("account list: count, rows and filter facets all carry the same access scope", async () => {
  const client = capture();
  await listCrmAccounts(client, rep, {});
  const scoped = client.calls.filter((call) => /business_parties account/.test(call.sql));
  assert.equal(scoped.length, 3);
  for (const call of scoped) {
    assert.match(call.sql, /account\.owner_user_id IS NULL OR account\.owner_user_id = \$\d+/);
    assert.equal((call.sql.match(/\$\d+/g) || []).reduce((max, p) => Math.max(max, Number(p.slice(1))), 0), call.params.length, "no orphaned or missing parameters");
  }
});

test("contact list: count and rows both carry the inherited access scope", async () => {
  const client = capture();
  await listCrmContacts(client, rep, {});
  const [count, list] = client.calls;
  for (const call of [count, list]) assert.match(call.sql, /contact\.party_id IS NULL AND \(contact\.created_by = \$\d+/);
});

test("Customer 360 / hierarchy / merge loaders apply company + account access (previously any id in the org)", async () => {
  const companyRep = { ...rep, allowAllCompanies: false, activeCompanyId: "44444444-4444-4444-8444-444444444444" };
  const client = capture();
  await assert.rejects(() => getCustomer360(client, companyRep, account), { code: "CRM_ACCOUNT_NOT_FOUND" });
  assert.match(client.calls[0].sql, /party\.company_id IS NULL OR party\.company_id = \$\d+\)/);
  assert.match(client.calls[0].sql, /party\.owner_user_id IS NULL OR party\.owner_user_id = \$\d+/);
  const noCompany = capture();
  await assert.rejects(() => getCustomer360(noCompany, { ...rep, allowAllCompanies: false }, account), { code: "CRM_ACCOUNT_NOT_FOUND" });
  assert.match(noCompany.calls[0].sql, / AND false/, "no company selected and not multi-company: nothing");
});

test("export needs crm.export — managing leads is not enough — at enqueue and again in the worker", async () => {
  assert.throws(() => assertCrmExportAllowed(rep), { code: "CRM_EXPORT_FORBIDDEN" });
  assert.doesNotThrow(() => assertCrmExportAllowed({ ...rep, permissions: ["crm.export"] }));
  assert.doesNotThrow(() => assertCrmExportAllowed({ ...rep, permissions: [], roleSlugs: ["organization_owner"] }));
  const client = capture();
  await assert.rejects(() => enqueueCrmLeadExportJob(client, rep, {}), { code: "CRM_EXPORT_FORBIDDEN" });
  await assert.rejects(() => buildCrmLeadExportCsv(client, rep, {}), { code: "CRM_EXPORT_FORBIDDEN" });
  assert.equal(client.calls.length, 0, "rejected before any query runs");
});

test("duplicates: an inaccessible match is disclosed only as restricted; visible matches keep sensitive-field projection", async () => {
  const { projectDuplicateMatchesForCaller } = await import("../src/modules/crm/prospect-and-relationship-master-data/duplicate-matching.js");
  const rows = [
    { id: "a1", display_name: "Hidden Co", gstin: "27AAAAA0000A1Z5", classification: "exact", match_score: 100, caller_can_access: false, in_company_scope: true },
    { id: "a2", display_name: "Visible Co", gstin: "27BBBBB0000B1Z5", pan: "BBBBB0000B", classification: "probable", match_score: 60, caller_can_access: true, in_company_scope: true },
  ];
  const [hiddenMatch, visibleMatch] = projectDuplicateMatchesForCaller(rep, "account", rows);
  assert.deepEqual(hiddenMatch, { restricted: true, classification: "exact" }, "no id, name, identifiers or score");
  assert.equal(visibleMatch.id, "a2");
  assert.equal(visibleMatch.gstin, undefined, "GSTIN still needs crm.accounts.view_sensitive");
  assert.equal(visibleMatch.caller_can_access, undefined, "internal flags never leave the server");
  const sensitive = projectDuplicateMatchesForCaller({ ...rep, permissions: ["crm.accounts.view_sensitive"] }, "account", rows)[1];
  assert.equal(sensitive.gstin, "27BBBBB0000B1Z5");
});

test("reports: organisation-wide rollups need view-all; child-record reports are narrowed by the owning record's rule", async () => {
  const { getCrmReport } = await import("../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js");
  for (const report of ["campaigns", "attribution", "partner-pipeline", "ai-governance", "privacy"]) {
    const client = capture();
    await assert.rejects(() => getCrmReport(client, rep, report, {}), { code: "CRM_REPORT_SCOPE_FORBIDDEN" });
    assert.equal(client.calls.length, 0);
  }
  const health = capture();
  await getCrmReport(health, rep, "account-health", {});
  assert.match(health.calls[0].sql, /scoped_account\.owner_user_id IS NULL OR scoped_account\.owner_user_id = \$8/);
  const inspections = capture();
  await getCrmReport(inspections, rep, "pipeline-intelligence", {});
  assert.match(inspections.calls[0].sql, /scoped_opportunity\.id=inspection\.opportunity_id/);
  const coverage = capture();
  await getCrmReport(coverage, rep, "relationship-coverage", {});
  assert.match(coverage.calls[0].sql, /CASE WHEN committee\.opportunity_id IS NOT NULL THEN EXISTS/);
});

test("resource-specific view-all widens only its own resource; relationship grants are SQL branches", async () => {
  const { canViewAllCrmResource, crmOwnerScopeSql: ownerScope, crmAccountAccessSql: accountAccess } = await import("../src/modules/crm/crm-data-operations-and-customization/crm-access-scope.js");
  const marketing = { ...rep, permissions: ["crm.view", "crm.leads.view_all"] };
  assert.equal(canViewAllCrmResource(marketing, "leads"), true);
  assert.equal(canViewAllCrmResource(marketing, "opportunities"), false);
  assert.equal(canViewAllCrmResource(marketing, null), false, "unnamed resource: umbrella only (fail closed)");
  assert.equal(ownerScope(marketing, binder().bind, "lead.owner_user_id", "lead.organization_id", { resource: "leads", alias: "lead" }), "");
  assert.notEqual(ownerScope(marketing, binder().bind, "o.owner_user_id", "o.organization_id", { resource: "opportunities", alias: "o" }), "");
  const partner = { ...rep, permissions: ["crm.view", "crm.partners.manage"] };
  assert.match(ownerScope(partner, binder().bind, "o.owner_user_id", "o.organization_id", { resource: "opportunities", alias: "o" }), /crm_partner_deals partner_deal WHERE[^)]*partner_deal\.opportunity_id=o\.id/);
  assert.match(accountAccess(partner, binder().bind, "a"), /crm_partner_accounts partner_account/);
  const success = { ...rep, permissions: ["crm.view", "crm.customers.view_all"] };
  assert.match(accountAccess(success, binder().bind, "a"), /a\.party_type IN \('customer','both'\)/);
  assert.match(ownerScope(success, binder().bind, "act.assigned_to", "act.organization_id", { resource: "activities", alias: "act" }), /customer_party\.party_type IN \('customer','both'\)/);
  assert.doesNotMatch(ownerScope(success, binder().bind, "l.owner_user_id", "l.organization_id", { resource: "leads", alias: "l" }), /customer_party/, "CS gains nothing on Leads");
});

test("private notes/communications: read breadth is not an override; CRM administration is", async () => {
  const { canOverridePrivateCrmContent } = await import("../src/modules/crm/crm-data-operations-and-customization/crm-access-scope.js");
  assert.equal(canOverridePrivateCrmContent({ permissions: ["crm.records.view_all"], roleSlugs: [] }), false, "Auditor / Read-only");
  assert.equal(canOverridePrivateCrmContent({ permissions: ["crm.records.view_all", "crm.settings.manage"], roleSlugs: [] }), true, "CRM Administrator");
  assert.equal(canOverridePrivateCrmContent({ permissions: [], roleSlugs: ["organization_owner"] }), true);
});

test("Account 360 applies the Sales and Accounting modules' OWN document rules (no CRM bypass)", async () => {
  const { crmChildScopes } = await import("../src/modules/crm/crm-data-operations-and-customization/record-policy.js");
  const noModules = crmChildScopes({ ...rep, allowAllCompanies: false, activeCompanyId: "44444444-4444-4444-8444-444444444444" }, []);
  assert.equal(noModules.sales("quotation"), " AND false", "no sales.view → no quotations/orders");
  assert.equal(noModules.accounting("invoice"), " AND false", "no accounting.view → no invoices/receipts");
  const parameters = [];
  const withModules = crmChildScopes({ ...rep, allowAllCompanies: false, activeCompanyId: "44444444-4444-4444-8444-444444444444", permissions: ["sales.view", "accounting.view"] }, parameters);
  assert.match(withModules.sales("quotation"), /quotation\.company_id=\$1/);
  assert.match(withModules.accounting("invoice"), /invoice\.company_id=\$2/);
  const client = capture([]);
  const { getCustomer360 } = await import("../src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js");
  await assert.rejects(() => getCustomer360(client, rep, account));
});

test("private-content override per built-in role: record breadth and resource view-all never imply it", async () => {
  const { canOverridePrivateCrmContent } = await import("../src/modules/crm/crm-data-operations-and-customization/crm-access-scope.js");
  const { ROLE_TEMPLATE_BY_SLUG } = await import("../../../packages/permissions/src/roles.js");
  const override = (slug) => canOverridePrivateCrmContent({ permissions: [...ROLE_TEMPLATE_BY_SLUG.get(slug).permissions], roleSlugs: [] });
  for (const slug of ["sales_head", "auditor", "read_only", "marketing_manager", "customer_success_manager", "partner_manager", "sales_manager", "sales_representative"])
    assert.equal(override(slug), false, `${slug} must not read others' private notes/communications`);
  for (const slug of ["crm_administrator", "sales_operations", "system_administrator"]) assert.equal(override(slug), true, `${slug} keeps the CRM-administration override`);
});

test("Account 360 inherits the Sales/Accounting multi-company convention (allowAllCompanies spans companies, as in Sales' own lists)", async () => {
  const { salesDocumentVisibilitySql } = await import("../src/modules/sales/index.js");
  const { receivablesDocumentVisibilitySql } = await import("../src/modules/accounting/index.js");
  const bind = () => "$9";
  const owner = { permissions: [], roleSlugs: ["organization_owner"], allowAllCompanies: true, activeCompanyId: "44444444-4444-4444-8444-444444444444" };
  assert.equal(salesDocumentVisibilitySql(owner, bind, "quotation"), "", "same as sales listQuotations for an all-companies caller");
  assert.equal(receivablesDocumentVisibilitySql(owner, bind, "invoice"), "");
  const companyUser = { permissions: ["sales.view", "accounting.view"], roleSlugs: [], allowAllCompanies: false, activeCompanyId: owner.activeCompanyId };
  assert.equal(salesDocumentVisibilitySql(companyUser, bind, "quotation"), " AND quotation.company_id=$9");
  assert.equal(receivablesDocumentVisibilitySql(companyUser, bind, "invoice"), " AND invoice.company_id=$9");
});
