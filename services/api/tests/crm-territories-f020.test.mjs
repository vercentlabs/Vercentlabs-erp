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

// Tranche D (Stage A) — the same self-parent/ancestor-cycle guard as
// territories above, mirrored for sales-team hierarchy (parentTeamId),
// which had no such guard before this pass.
const teamId = "55555555-5555-4555-8555-555555555555";
const otherTeamId = "66666666-6666-4666-8666-666666666666";

function salesTeamClient({ cycleExists = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_sales_teams record"))
        return { rows: [{ id: teamId, name: "Enterprise", parent_team_id: null }] };
      if (sql.includes("WITH RECURSIVE ancestors"))
        return { rows: cycleExists ? [{ "?column?": 1 }] : [] };
      if (sql.includes("UPDATE tenant.crm_sales_teams"))
        return { rows: [{ id: teamId, name: "Enterprise", parent_team_id: otherTeamId }] };
      return { rows: [] };
    },
  };
}

test("F020: a sales team cannot be assigned itself as parent", async () => {
  await assert.rejects(
    updateCrmRecord(salesTeamClient(), context, "sales-teams", teamId, {
      parentTeamId: teamId,
    }),
    (error) => error.status === 409 && error.code === "CRM_SALES_TEAM_HIERARCHY_SELF_PARENT",
  );
});

test("F020: assigning a descendant team as parent is rejected as a hierarchy cycle", async () => {
  const client = salesTeamClient({ cycleExists: true });
  await assert.rejects(
    updateCrmRecord(client, context, "sales-teams", teamId, {
      parentTeamId: otherTeamId,
    }),
    (error) => error.status === 409 && error.code === "CRM_SALES_TEAM_HIERARCHY_CYCLE",
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes("WITH RECURSIVE ancestors")),
    true,
  );
});

test("F020: a valid, non-cyclical sales-team parent assignment succeeds", async () => {
  const client = salesTeamClient({ cycleExists: false });
  const updated = await updateCrmRecord(client, context, "sales-teams", teamId, {
    parentTeamId: otherTeamId,
  });
  assert.equal(updated.parentTeamId, otherTeamId);
});

test("F020: clearing a sales team's parent (null) does not run the cycle check", async () => {
  const client = salesTeamClient();
  await updateCrmRecord(client, context, "sales-teams", teamId, {
    parentTeamId: null,
  });
  assert.equal(
    client.calls.some((call) => call.sql.includes("WITH RECURSIVE ancestors")),
    false,
  );
});
