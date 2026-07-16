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
