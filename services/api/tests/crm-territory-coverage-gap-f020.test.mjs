import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard, listCrmRecords } from "../src/modules/crm/index.js";

// F020 (Territories and sales teams) — LAST PROMPT 1/3 closeout: the
// dossier's required "coverage gap" signal (a territory with nobody
// currently assigned as primary owner) had no detection/reporting
// anywhere. This proves the new uncovered_territories metric (a) flows
// through, (b) only counts the absence of a currently-effective 'primary'
// assignment (an overlay/shared/manager-only assignment still counts as a
// gap), and (c) is scoped by the same company predicate every other
// dashboard metric uses.

const org = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";

const context = {
  organizationId: org,
  userId: owner,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: [],
  permissions: ["crm.view", "crm.records.view_all"],
};

test("F020: getCrmDashboard exposes uncovered_territories, requiring a currently-effective 'primary' assignment specifically", async () => {
  let capturedSql = null;
  const client = {
    async query(sql) {
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) {
        capturedSql = sql;
        return { rows: [{ uncovered_territories: 3 }] };
      }
      return { rows: [] };
    },
  };
  const dashboard = await getCrmDashboard(client, context);
  assert.equal(dashboard.metrics.uncoveredTerritories, 3);
  assert.ok(capturedSql, "expected the metrics query to run");
  assert.match(capturedSql, /AS uncovered_territories/);
  assert.match(capturedSql, /assignment\.assignment_role = 'primary'/);
  assert.match(capturedSql, /NOT EXISTS/);
  assert.match(capturedSql, /assignment\.effective_from <= current_date/);
  assert.match(capturedSql, /assignment\.effective_to IS NULL OR assignment\.effective_to >= current_date/);
});

// F020 Stage A2 §8 closeout: the dashboard-only aggregate count was
// previously the only place coverage state was visible — a manager could
// see "3 uncovered" but not WHICH territories. listCrmRecords("territories")
// now annotates each row with hasPrimaryCoverage, reusing the identical
// predicate the dashboard metric already uses (never a second one).
test("F020: listCrmRecords(\"territories\") annotates each row with hasPrimaryCoverage, using the same predicate as the dashboard metric", async () => {
  const covered = "55555555-5555-4555-8555-555555555555";
  const uncovered = "66666666-6666-4666-8666-666666666666";
  let coverageQuerySql = null;
  let coverageQueryValues = null;
  const client = {
    async query(sql, values = []) {
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ total: 2 }] };
      if (sql.includes("FROM tenant.crm_territories record")) {
        return { rows: [{ id: covered, name: "North", status: "active" }, { id: uncovered, name: "South", status: "active" }] };
      }
      if (sql.includes("FROM tenant.crm_territory_assignments") && sql.includes("assignment_role='primary'")) {
        coverageQuerySql = sql;
        coverageQueryValues = values;
        return { rows: [{ territory_id: covered }] };
      }
      return { rows: [] };
    },
  };
  const result = await listCrmRecords(client, context, "territories", {});
  assert.equal(coverageQueryValues[1].length, 2, "both listed territory ids must be checked in one batched query");
  assert.match(coverageQuerySql, /effective_from<=current_date/);
  assert.match(coverageQuerySql, /effective_to IS NULL OR effective_to>=current_date/);
  const byId = Object.fromEntries(result.rows.map((row) => [row.id, row.hasPrimaryCoverage]));
  assert.equal(byId[covered], true);
  assert.equal(byId[uncovered], false);
});
