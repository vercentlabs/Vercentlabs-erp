import assert from "node:assert/strict";
import test from "node:test";

import { archiveCrmRecord, createCrmRecord, updateCrmRecord } from "../src/modules/crm/index.js";

// F025 completion: forecast submissions and period lifecycle changes go only
// through the governed forecast service (forecast-service.js), which enforces
// versions, review, reasons and period locks — and the database refuses any
// submission change in a frozen or closed period (migration 187). The
// generic resource path used to let a seller write their own
// manager_adjustment and skip review entirely; it now refuses before any
// query runs. Behaviour of the governed path is proven against PostgreSQL in
// tests/integration/crm/forecast-db.test.mjs.

const org = "11111111-1111-4111-8111-111111111111";
const user = "33333333-3333-4333-8333-333333333333";
const periodId = "44444444-4444-4444-8444-444444444444";
const submissionId = "55555555-5555-4555-8555-555555555555";
const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.view", "crm.forecast.submit", "crm.forecast.manage"] };

function recordingClient() {
  const calls = [];
  return { calls, query: async (sql) => (calls.push(sql), { rows: [] }) };
}
const moved = (error) => error.status === 410 && error.code === "CRM_FORECAST_API_MOVED";

test("F025: forecast submissions cannot be created, edited or archived through the generic path", async () => {
  const client = recordingClient();
  await assert.rejects(createCrmRecord(client, context, "forecast-submissions", { periodId, commitAmount: 100, managerAdjustment: 1e9 }), moved);
  await assert.rejects(updateCrmRecord(client, context, "forecast-submissions", submissionId, { managerAdjustment: 1e9 }), moved);
  await assert.rejects(archiveCrmRecord(client, context, "forecast-submissions", submissionId), moved);
});

test("F025: a period's lifecycle status is changed only by the forecast service", async () => {
  const client = recordingClient();
  await assert.rejects(createCrmRecord(client, context, "forecast-periods", { name: "Q", periodStart: "2026-10-01", periodEnd: "2026-12-31", status: "closed" }), moved);
  await assert.rejects(updateCrmRecord(client, context, "forecast-periods", periodId, { status: "open" }), moved);
  await assert.rejects(archiveCrmRecord(client, context, "forecast-periods", periodId), moved);
});
