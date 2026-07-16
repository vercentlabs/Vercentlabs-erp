import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root = path.resolve(process.cwd(), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
test("CRM tenant schema covers the full customer lifecycle", () => {
  const sql = read("database/tenant/migrations/002_crm_module.sql");
  for (const table of [
    "crm_leads",
    "crm_opportunities",
    "crm_activities",
    "crm_campaigns",
    "crm_communications",
    "crm_sequences",
    "crm_capture_forms",
    "crm_automation_rules",
    "crm_conversion_records",
    "crm_forecast_targets",
    "crm_integrations",
    "crm_outbox_events",
  ])
    assert.match(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
    );
  assert.ok((sql.match(/FORCE ROW LEVEL SECURITY/g) || []).length >= 1);
});
test("CRM web includes dashboard, list, detail, pipeline, reports and settings surfaces", () => {
  for (const file of [
    "apps/web/src/app/(app)/crm/page.tsx",
    "apps/web/src/app/(app)/crm/[resource]/page.tsx",
    "apps/web/src/app/(app)/crm/leads/[id]/page.tsx",
    "apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx",
    "apps/web/src/app/(app)/crm/pipeline/page.tsx",
    "apps/web/src/app/(app)/crm/reports/page.tsx",
    "apps/web/src/app/(app)/crm/settings/page.tsx",
  ])
    assert.equal(exists(file), true, file);
});
test("CRM service owns scoring assignment conversion automation capture and reporting", () => {
  const service = read("services/api/src/crm.js");
  for (const marker of [
    "calculateLeadScore",
    "resolveLeadOwner",
    "convertCrmLead",
    "mergeCrmLead",
    "moveOpportunityStage",
    "runCrmAutomation",
    "captureCrmLead",
    "getCrmDashboard",
    "getCrmReport",
  ])
    assert.ok(service.includes(marker), marker);
});
test("CRM public capture remains rate limited and origin aware", () => {
  const service = read("services/api/src/crm.js");
  assert.ok(service.includes("allowed_origins"));
  assert.ok(service.includes("crm_capture_rate_limits"));
  assert.ok(service.includes("companyWebsiteHidden"));
});
test("CRM permissions and provider-neutral integration contracts are present", () => {
  const permissions = read(
    "database/control-plane/migrations/004_crm_permissions.sql",
  );
  for (const key of [
    "crm.view",
    "crm.leads.manage",
    "crm.opportunities.manage",
    "crm.activities.manage",
    "crm.campaigns.manage",
    "crm.communications.manage",
    "crm.automation.manage",
    "crm.capture.manage",
    "crm.import",
    "crm.export",
    "crm.reports.view",
    "crm.settings.manage",
  ])
    assert.ok(permissions.includes(key));
  const sql = read("database/tenant/migrations/002_crm_module.sql");
  assert.ok(sql.includes("credential_reference"));
  assert.ok(sql.includes("secret_reference"));
  assert.ok(sql.includes("crm_outbox_events"));
});
test("transaction-scoped CRM queries execute sequentially", () => {
  for (const file of [
    "services/api/src/crm.js",
    "apps/web/src/app/(app)/crm/leads/[id]/page.tsx",
    "apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx",
    "apps/web/src/app/(app)/crm/reports/page.tsx",
  ]) {
    assert.doesNotMatch(read(file), /Promise\.all/, file);
  }
});


test("enterprise CRM core includes revenue operations, account strategy, playbooks, privacy and data quality", () => {
  const sql = read("database/tenant/migrations/003_crm_enterprise_core.sql");
  for (const table of [
    "crm_sales_teams",
    "crm_sales_team_members",
    "crm_territories",
    "crm_territory_assignments",
    "crm_quota_plans",
    "crm_forecast_periods",
    "crm_forecast_submissions",
    "crm_forecast_snapshots",
    "crm_account_plans",
    "crm_account_stakeholders",
    "crm_playbooks",
    "crm_playbook_questions",
    "crm_playbook_responses",
    "crm_consent_events",
    "crm_privacy_requests",
    "crm_data_quality_scores",
  ])
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS tenant\.${table}`));
  assert.ok(sql.includes("FORCE ROW LEVEL SECURITY"));
  assert.ok(sql.includes("blocks_stage_exit"));
});

test("enterprise CRM permissions separate revenue, account, playbook, privacy and data-quality administration", () => {
  const permissions = read(
    "database/control-plane/migrations/006_crm_enterprise_permissions.sql",
  );
  for (const key of [
    "crm.revenue.manage",
    "crm.accounts.manage",
    "crm.playbooks.manage",
    "crm.privacy.manage",
    "crm.data-quality.manage",
    "crm.integrations.manage",
    "crm.ai.manage",
  ])
    assert.ok(permissions.includes(key), key);
});

test("revenue operations, account health and privacy reports are exposed", () => {
  const service = read("services/api/src/crm.js");
  const page = read("apps/web/src/app/(app)/crm/reports/page.tsx");
  for (const report of ["revenue-operations", "account-health", "privacy"]) {
    assert.ok(service.includes(`report === "${report}"`), report);
    assert.ok(page.includes(`"${report}"`), report);
  }
});

test("enterprise CRM routes enforce resource-specific access for sensitive data", () => {
  const helper = read("apps/web/src/lib/crm-api.ts");
  const collectionRoute = read("apps/web/src/app/api/crm/[resource]/route.ts");
  const importRoute = read("apps/web/src/app/api/crm/[resource]/import/route.ts");
  const exportRoute = read("apps/web/src/app/api/crm/[resource]/export/route.ts");
  assert.ok(helper.includes("restrictedResources"));
  assert.ok(helper.includes("requireCrmResourceView"));
  assert.ok(helper.includes("requireCrmReportView"));
  assert.ok(collectionRoute.includes("requireCrmResourceView(session, resource)"));
  assert.ok(importRoute.includes("requireCrmManage(session, resource)"));
  assert.ok(exportRoute.includes("requireCrmResourceView(session, resource)"));
});

test("sales-team, territory and playbook child records are manageable resources", () => {
  const resources = read("packages/shared-types/src/crm.js");
  const service = read("services/api/src/crm.js");
  const ui = read("apps/web/src/lib/crm.ts");
  for (const key of [
    "sales-team-members",
    "territory-assignments",
    "playbook-questions",
    "playbook-responses",
  ]) {
    assert.ok(resources.includes(`"${key}"`), key);
    assert.ok(service.includes(`"${key}"`), key);
    assert.ok(ui.includes(`"${key}"`), key);
  }
});
