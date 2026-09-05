import assert from "node:assert/strict";
import test from "node:test";

import { updateCrmRecord } from "../src/modules/crm/index.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

const territoryId = "33333333-3333-4333-8333-333333333333";
const otherTerritoryId = "44444444-4444-4444-8444-444444444444";

function territoryClient({ cycleExists = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_territories record"))
        return { rows: [{ id: territoryId, name: "North", parent_territory_id: null }] };
      if (sql.includes("WITH RECURSIVE ancestors"))
        return { rows: cycleExists ? [{ "?column?": 1 }] : [] };
      if (sql.includes("UPDATE tenant.crm_territories"))
        return { rows: [{ id: territoryId, name: "North", parent_territory_id: otherTerritoryId }] };
      return { rows: [] };
    },
  };
}

test("F020: a territory cannot be assigned itself as parent", async () => {
  await assert.rejects(
    updateCrmRecord(territoryClient(), context, "territories", territoryId, {
      parentTerritoryId: territoryId,
    }),
    (error) => error.status === 409 && error.code === "CRM_TERRITORY_HIERARCHY_SELF_PARENT",
  );
});

test("F020: assigning a descendant as parent is rejected as a hierarchy cycle", async () => {
  const client = territoryClient({ cycleExists: true });
  await assert.rejects(
    updateCrmRecord(client, context, "territories", territoryId, {
      parentTerritoryId: otherTerritoryId,
    }),
    (error) => error.status === 409 && error.code === "CRM_TERRITORY_HIERARCHY_CYCLE",
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes("WITH RECURSIVE ancestors")),
    true,
  );
});

test("F020: a valid, non-cyclical parent assignment succeeds", async () => {
  const client = territoryClient({ cycleExists: false });
  const updated = await updateCrmRecord(client, context, "territories", territoryId, {
    parentTerritoryId: otherTerritoryId,
  });
  assert.equal(updated.parentTerritoryId, otherTerritoryId);
});

test("F020: clearing a parent (null) does not run the cycle check", async () => {
  const client = territoryClient();
  await updateCrmRecord(client, context, "territories", territoryId, {
    parentTerritoryId: null,
  });
  assert.equal(
    client.calls.some((call) => call.sql.includes("WITH RECURSIVE ancestors")),
    false,
  );
});
