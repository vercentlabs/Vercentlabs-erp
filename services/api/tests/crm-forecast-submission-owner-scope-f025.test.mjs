import assert from "node:assert/strict";
import test from "node:test";

import { listCrmRecords } from "../src/modules/crm/index.js";

// F025 (Sales forecast) — LAST PROMPT 1/3 closeout: forecast-submissions
// had no ownerField, so recordScope() never restricted visibility by
// owner — any caller with base view/manage permission saw every
// submission company-wide, not just their own (or, for a
// crm.records.view_all holder, everyone's, as intended).
//
// Stage A2 §11 closeout: extended with the dossier's own named "rep sees
// own -> manager sees team -> exec sees org" rollup, reusing F020's
// crm_sales_teams.manager_user_id/crm_sales_team_members verbatim. The
// mock below actually evaluates the real predicate structure (owner
// match OR NULL OR team-manager EXISTS) rather than approximating it
// with a single regex, so it can tell a real security regression from a
// mock artifact.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const otherUser = "44444444-4444-4444-8444-444444444444";
const managingUser = "55555555-5555-4555-8555-555555555555";
const teamId = "66666666-6666-4666-8666-666666666666";

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
const teamManagerContext = baseContext(managingUser, ["crm.view", "crm.revenue.manage"]);

const submissionId = "77777777-7777-4777-8777-777777777777";
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

// Actually evaluates the real predicate shape recordScope() emits for
// this resource — "record.owner_user_id IS NULL OR record.owner_user_id
// = $requester OR EXISTS(team-manager check)" — against a fixture team
// roster, rather than a brittle single-clause regex.
function forecastClient({ row = ownedSubmission, teamRoster = [] } = {}) {
  function visible(requestingUserId) {
    if (row.owner_user_id == null) return true;
    if (row.owner_user_id === requestingUserId) return true;
    return teamRoster.some(
      (membership) => membership.userId === row.owner_user_id && membership.status === "active" && membership.managerUserId === requestingUserId,
    );
  }
  return {
    async query(sql, params = []) {
      if (!hasRecordWhere(sql, "crm_forecast_submissions")) throw new Error(`Unexpected query: ${sql}`);
      // crm.records.view_all bypasses the ownerField predicate entirely
      // (recordScope's own canViewAllCrmRecords short-circuit) — no
      // owner/team-manager clause appears in that case, and every row is
      // visible.
      const ownerClauseMatch = sql.match(/record\.owner_user_id = \$(\d+) OR EXISTS/);
      let isVisible;
      if (!ownerClauseMatch) {
        assert.ok(!sql.includes("owner_user_id"), "a view_all caller's query must carry no owner predicate at all");
        isVisible = true;
      } else {
        assert.match(sql, /record\.owner_user_id IS NULL OR record\.owner_user_id = \$\d+ OR EXISTS \(/, "must use the real IS-NULL/owner/team-manager predicate, not a narrower one");
        const requestingUserId = params[Number(ownerClauseMatch[1]) - 1];
        isVisible = visible(requestingUserId);
      }
      if (sql.includes("count(*)::int AS total")) return { rows: [{ total: isVisible ? 1 : 0 }] };
      return { rows: isVisible ? [row] : [] };
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

// Stage A2 §11 — the actual new capability: a Sales Team's manager sees
// their reports' submissions without needing crm.records.view_all.
test("F025 Stage A2: a Sales Team manager sees a submission owned by an active member of their team, reusing F020's own team roster", async () => {
  const teamRoster = [{ userId: owner, status: "active", managerUserId: managingUser, teamId }];
  const result = await listCrmRecords(forecastClient({ teamRoster }), teamManagerContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, submissionId);
});

test("F025 Stage A2: a Sales Team manager does NOT see a submission owned by someone outside their team", async () => {
  const teamRoster = [{ userId: otherUser, status: "active", managerUserId: managingUser, teamId }];
  const result = await listCrmRecords(forecastClient({ teamRoster }), teamManagerContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 0);
});

test("F025 Stage A2: an INACTIVE team membership does not grant the manager visibility", async () => {
  const teamRoster = [{ userId: owner, status: "inactive", managerUserId: managingUser, teamId }];
  const result = await listCrmRecords(forecastClient({ teamRoster }), teamManagerContext, "forecast-submissions", {});
  assert.equal(result.rows.length, 0);
});
