import assert from "node:assert/strict";
import test from "node:test";

import { listCrmRecords } from "../src/modules/crm/index.js";

// F025 (Sales forecast) — LAST PROMPT 1/3 closeout: forecast-submissions
// had no ownerField, so recordScope() never restricted visibility by
// owner — any caller with base view/manage permission saw every
// submission company-wide, not just their own (or, for a
// crm.records.view_all holder, everyone's, as intended). This is the same
// faithful-SQL mock pattern crm-record-scope.test.mjs uses for Leads,
// reused here for the newly-scoped resource.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const otherUser = "44444444-4444-4444-8444-444444444444";

function baseContext(userId, permissions) {
  return {
    organizationId: org,
    userId,
    activeCompanyId: company,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: [],
    permissions,
  };
}

const repContext = baseContext(owner, ["crm.view", "crm.revenue.manage"]);
const otherRepContext = baseContext(otherUser, ["crm.view", "crm.revenue.manage"]);
const managerContext = baseContext(otherUser, ["crm.view", "crm.revenue.manage", "crm.records.view_all"]);

const submissionId = "55555555-5555-4555-8555-555555555555";
const ownedSubmission = {
  id: submissionId,
  organization_id: org,
  company_id: company,
  owner_user_id: owner,
  team_id: null,
  territory_id: null,
  status: "draft",
};

function hasRecordWhere(sql, table) {
  return new RegExp(`FROM\\s+tenant\\.${table}\\s+record\\s+WHERE`, "i").test(sql);
}

function forecastClient({ row = ownedSubmission } = {}) {
  function visible(sql, params) {
    const match = sql.match(/owner_user_id = \$(\d+)\)/);
    if (!match) return true;
    const requestingUserId = params[Number(match[1]) - 1];
    return row.owner_user_id == null || row.owner_user_id === requestingUserId;
  }
  return {
    async query(sql, params = []) {
      if (hasRecordWhere(sql, "crm_forecast_submissions") && sql.includes("count(*)::int AS total")) {
        return { rows: [{ total: visible(sql, params) ? 1 : 0 }] };
      }
      if (hasRecordWhere(sql, "crm_forecast_submissions")) {
        return { rows: visible(sql, params) ? [row] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F025: the submission's own owner can see it via list", async () => {
  const result = await listCrmRecords(forecastClient(), repContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, submissionId);
});

test("F025: an unrelated rep with only crm.revenue.manage no longer sees another rep's submission (the gap this pass closes)", async () => {
  const result = await listCrmRecords(forecastClient(), otherRepContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 0);
});

test("F025: crm.records.view_all still sees every submission regardless of owner", async () => {
  const result = await listCrmRecords(forecastClient(), managerContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 1);
});

test("F025: a team-level submission with no individual owner remains visible to the whole company scope", async () => {
  const teamSubmission = { ...ownedSubmission, owner_user_id: null };
  const result = await listCrmRecords(forecastClient({ row: teamSubmission }), otherRepContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 1);
});
