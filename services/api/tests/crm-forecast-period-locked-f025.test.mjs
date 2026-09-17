import assert from "node:assert/strict";
import test from "node:test";

import { createCrmRecord, updateCrmRecord } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const periodId = "44444444-4444-4444-8444-444444444444";
const submissionId = "55555555-5555-4555-8555-555555555555";

const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view", "crm.opportunities.manage"] };

function createClient({ periodStatus = "open", submissionRow } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_forecast_periods WHERE")) return { rows: [{ status: periodStatus }] };
      if (sql.startsWith("SELECT record.* FROM tenant.crm_forecast_submissions record WHERE"))
        return { rows: submissionRow ? [submissionRow] : [] };
      if (sql.startsWith("INSERT INTO tenant.crm_forecast_submissions")) return { rows: [{ id: submissionId, organization_id: org, period_id: periodId, owner_user_id: user, status: "draft" }] };
      if (sql.startsWith("UPDATE tenant.crm_forecast_submissions")) return { rows: [{ id: submissionId, organization_id: org, period_id: periodId, owner_user_id: user, status: "draft", updated_at: "2026-01-02T00:00:00.000Z" }] };
      return { rows: [] };
    },
  };
}

// F025 Stage A2 §11 — nothing previously cross-referenced a forecast
// submission against its own period's status, so a submission could be
// created or edited against an already-closed period through the
// generic resource path.

test("F025: creating a forecast submission against a closed period is rejected", async () => {
  const client = createClient({ periodStatus: "closed" });
  await assert.rejects(
    createCrmRecord(client, context, "forecast-submissions", { periodId, pipelineAmount: 1000 }),
    (error) => error.code === "CRM_FORECAST_PERIOD_CLOSED" && error.status === 409,
  );
});

test("F025: creating a forecast submission against an open period succeeds", async () => {
  const client = createClient({ periodStatus: "open" });
  const record = await createCrmRecord(client, context, "forecast-submissions", { periodId, pipelineAmount: 1000 });
  assert.equal(record.id, submissionId);
});

test("F025: creating a forecast submission against a frozen period still succeeds (frozen stays mutable, matching the existing period-picker convention)", async () => {
  const client = createClient({ periodStatus: "frozen" });
  const record = await createCrmRecord(client, context, "forecast-submissions", { periodId, pipelineAmount: 1000 });
  assert.equal(record.id, submissionId);
});

test("F025: updating an existing forecast submission whose period has since closed is rejected", async () => {
  const submissionRow = { id: submissionId, organization_id: org, period_id: periodId, owner_user_id: user, status: "draft", updated_at: "2026-01-01T00:00:00.000Z" };
  const client = createClient({ periodStatus: "closed", submissionRow });
  await assert.rejects(
    updateCrmRecord(client, context, "forecast-submissions", submissionId, { pipelineAmount: 2000 }),
    (error) => error.code === "CRM_FORECAST_PERIOD_CLOSED",
  );
});
