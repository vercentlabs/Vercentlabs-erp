import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const completionResources = [
  "engagement-templates",
  "meeting-links",
  "sync-accounts",
  "conversations",
  "conversation-insights",
  "pipeline-inspections",
  "deal-risks",
  "recommendations",
  "buying-committees",
  "buying-committee-members",
  "relationship-edges",
  "account-signals",
  "partner-accounts",
  "partner-deals",
  "report-definitions",
  "dashboards",
  "dashboard-widgets",
  "custom-object-definitions",
  "custom-field-definitions",
  "custom-records",
  "field-visits",
  "enrichment-jobs",
  "ai-predictions",
  "ai-feedback",
];

const tableNames = [
  "crm_engagement_templates",
  "crm_meeting_links",
  "crm_sync_accounts",
  "crm_conversations",
  "crm_conversation_insights",
  "crm_pipeline_inspections",
  "crm_deal_risks",
  "crm_recommendations",
  "crm_buying_committees",
  "crm_buying_committee_members",
  "crm_relationship_edges",
  "crm_account_signals",
  "crm_partner_accounts",
  "crm_partner_deals",
  "crm_report_definitions",
  "crm_dashboards",
  "crm_dashboard_widgets",
  "crm_custom_object_definitions",
  "crm_custom_field_definitions",
  "crm_custom_records",
  "crm_field_visits",
  "crm_enrichment_jobs",
  "crm_ai_predictions",
  "crm_ai_feedback",
];

test("CRM completion resources are shared across contracts, service and UI", () => {
  const shared = read("packages/shared-types/src/crm.js");
  const service = read("services/api/src/crm.js");
  const ui = read("apps/web/src/lib/crm.ts");

  for (const resource of completionResources) {
    assert.match(shared, new RegExp(`"${resource}"`), resource);
    assert.match(service, new RegExp(`"?${resource}"?\\s*:`), resource);
    assert.match(ui, new RegExp(`"?${resource}"?\\s*:`), resource);
  }
});

test("CRM completion migration creates governed tenant tables", () => {
  const migration = read(
    "database/tenant/migrations/005_crm_completion_pack.sql",
  );

  for (const table of tableNames) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS tenant\.${table}`),
      table,
    );
    assert.match(
      migration,
      new RegExp(`['"]${table}['"]`),
      `${table} is included in the RLS provisioning set`,
    );
  }

  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY organization_isolation/);
  assert.ok(
    (migration.match(/FOREIGN KEY \(organization_id, company_id\)/g) || [])
      .length >= 20,
    "company-scoped completion tables need organization-aware foreign keys",
  );
  assert.doesNotMatch(migration, /crm_quotes|crm_sales_orders|crm_invoices/);
});

test("CRM completion keeps cross-module ownership explicit", () => {
  const architecture = read("docs/architecture/crm-completion-pack.md");
  for (const boundary of [
    "Sales module",
    "Service module",
    "Mobile application",
    "provider adapters",
  ]) {
    assert.match(architecture, new RegExp(boundary), boundary);
  }
});

test("CRM completion adds dedicated permissions and advanced reports", () => {
  const permissions = read(
    "database/control-plane/migrations/008_crm_completion_permissions.sql",
  );
  const reports = read("services/api/src/crm.js");

  for (const permission of [
    "crm.analytics.manage",
    "crm.customization.manage",
    "crm.partners.manage",
    "crm.field-sales.manage",
  ]) {
    assert.match(permissions, new RegExp(permission), permission);
  }

  for (const report of [
    "pipeline-intelligence",
    "engagement-intelligence",
    "relationship-coverage",
    "partner-pipeline",
    "ai-governance",
  ]) {
    assert.match(reports, new RegExp(report), report);
  }
});
