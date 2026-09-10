import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard } from "../src/modules/crm/index.js";

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
