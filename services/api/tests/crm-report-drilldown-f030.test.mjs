import assert from "node:assert/strict";
import test from "node:test";

import { getCrmReport } from "../src/modules/crm/index.js";

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
      return { rows: [] };
    },
  };
}

// F030 Stage A2 §12 — "pipeline"/"sources" report rows previously carried
// only a display name, not a safe filter key, so CrmReportsScreen.tsx
// could not drill into them without approximating a match on name. These
// prove the real id columns are now selected, so the frontend's drill
// link uses an exact, reconciling filter, not a name-based guess.

test("F030: the pipeline report selects the real stage id, not name-only", async () => {
  const client = createClient();
  await getCrmReport(client, context, "pipeline", {});
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_pipeline_stages stage"));
  assert.match(select.sql, /stage\.id AS stage_id/);
});

test("F030: the sources report selects the real source id, not name-only", async () => {
  const client = createClient();
  await getCrmReport(client, context, "sources", {});
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_leads lead"));
  assert.match(select.sql, /source\.id AS source_id/);
  // Grouping must include the id too — grouping by name alone would
  // collapse two distinct sources that happen to share a display name.
  assert.match(select.sql, /GROUP BY source\.id, source\.name/);
});
