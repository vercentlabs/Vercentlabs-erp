import assert from "node:assert/strict";
import test from "node:test";

import { listCrmRecords } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const context = {
  organizationId: org,
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: [],
  permissions: ["crm.view", "crm.records.view_all"],
};

function createClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
}

// F024 Stage A2 §10 — "dwell-breached"/"high-priority" Leads and "stalled"
// Opportunities were dashboard-only counts with no drill-down (the
// dashboard screen's own prior disclosure comment). These prove the new
// list filters reuse getCrmDashboard's EXACT predicates (never a
// semantically different approximation), so a drilled list's count
// always reconciles to the dashboard's own number.

test("F024: leads?dwellBreached=true reuses the dashboard's exact dwell-breach EXISTS predicate", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "leads", { dwellBreached: "true" });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_leads record"));
  assert.match(select.sql, /EXISTS \(\s*SELECT 1 FROM tenant\.crm_lead_stages dwell_stage/);
  assert.match(select.sql, /dwell_stage\.code=record\.status/);
  assert.match(select.sql, /dwell_stage\.dwell_breach_hours IS NOT NULL/);
  assert.match(select.sql, /record\.stage_entered_at <= now\(\) - \(dwell_stage\.dwell_breach_hours \|\| ' hours'\)::interval/);
});

test("F024: leads?highPriority=true reuses the dashboard's exact lead_grade IN ('hot','qualified') predicate", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "leads", { highPriority: "true" });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_leads record"));
  assert.match(select.sql, /record\.lead_grade IN \('hot','qualified'\)/);
});

test("F024: without the filter flags, dwell/high-priority predicates are absent (additive, not always-on)", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "leads", {});
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_leads record"));
  assert.equal(select.sql.includes("dwell_stage"), false);
  assert.equal(select.sql.includes("lead_grade"), false);
});

test("F024: opportunities?stalled=true reuses the dashboard's exact SLA-policy-over-stage-default predicate", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "opportunities", { stalled: "true" });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_opportunities record"));
  assert.match(select.sql, /EXISTS \(/);
  assert.match(select.sql, /crm_opportunity_stage_sla_policies stale_policy/);
  assert.match(select.sql, /COALESCE\(stale_policy\.maximum_days, stale_stage\.stale_after_days\) IS NOT NULL/);
  assert.match(select.sql, /record\.stage_entered_at <= now\(\) - \(COALESCE\(stale_policy\.maximum_days, stale_stage\.stale_after_days\) \|\| ' days'\)::interval/);
});
