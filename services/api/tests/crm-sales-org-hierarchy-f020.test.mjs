import assert from "node:assert/strict";
import test from "node:test";

import { listCrmRecords } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const teamId = "22222222-2222-4222-8222-222222222222";
const territoryId = "33333333-3333-4333-8333-333333333333";

const context = {
  organizationId: org,
  userId: "44444444-4444-4444-8444-444444444444",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

// F020 Tranche D — sales-team-members/territory-assignments are inherently
// parent-scoped; the settings UI's membership/assignment dialogs depend on
// listCrmRecords actually filtering by teamId/territoryId (a bare list
// would leak every organization's memberships/assignments into one team's
// dialog). Confirmed via grep before writing this that buildFilters had no
// such key before this pass.
function createClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ total: 1 }] };
      return { rows: [] };
    },
  };
}

test("F020: listing sales-team-members with teamId scopes the query to that team, not the whole organization", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "sales-team-members", { teamId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_sales_team_members"));
  assert.ok(select.sql.includes("team_id ="), "the SQL must filter on team_id, not just organization_id");
  assert.ok(select.values.includes(teamId), "teamId must be bound as a real parameter");
});

test("F020: listing sales-team-members without teamId does not filter by team (verifies the filter is additive, not always-on)", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "sales-team-members", {});
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_sales_team_members"));
  assert.ok(!select.sql.includes("team_id ="), "no teamId filter supplied means no team_id predicate");
});

test("F020: listing territory-assignments with territoryId scopes the query to that territory, not the whole organization", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "territory-assignments", { territoryId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_territory_assignments"));
  assert.ok(select.sql.includes("territory_id ="), "the SQL must filter on territory_id, not just organization_id");
  assert.ok(select.values.includes(territoryId), "territoryId must be bound as a real parameter");
});

test("F020: a teamId filter has no effect on a resource with no team_id column (e.g. territories)", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "territories", { teamId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_territories"));
  assert.ok(!select.sql.includes("team_id ="), "teamId must only apply to resources that actually declare a team_id field");
});

// F002 Tranche E — the same reasoning applied to account-plans/
// account-stakeholders/communications (each row belongs to exactly one
// Account or account plan).
const partyId = "55555555-5555-4555-8555-555555555555";
const accountPlanId = "66666666-6666-4666-8666-666666666666";

test("F002: listing account-plans with partyId scopes the query to that account, not the whole organization", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "account-plans", { partyId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_account_plans"));
  assert.ok(select.sql.includes("party_id ="), "the SQL must filter on party_id, not just organization_id");
  assert.ok(select.values.includes(partyId), "partyId must be bound as a real parameter");
});

test("F002: listing account-stakeholders with accountPlanId scopes the query to that plan, not the whole organization", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "account-stakeholders", { accountPlanId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_account_stakeholders"));
  assert.ok(select.sql.includes("account_plan_id ="), "the SQL must filter on account_plan_id, not just organization_id");
  assert.ok(select.values.includes(accountPlanId), "accountPlanId must be bound as a real parameter");
});

test("F002: listing communications with partyId scopes the query to that account", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "communications", { partyId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_communications"));
  assert.ok(select.sql.includes("party_id ="), "the SQL must filter on party_id, not just organization_id");
});

test("F002: a partyId filter has no effect on a resource with no party_id column (e.g. sales-teams)", async () => {
  const client = createClient();
  await listCrmRecords(client, context, "sales-teams", { partyId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_sales_teams"));
  assert.ok(!select.sql.includes("party_id ="), "partyId must only apply to resources that actually declare a party_id field");
});

// F003 Tranche F — communications scoped to a Contact rather than an
// Account (tenant.crm_communications has both party_id and contact_id).
test("F003: listing communications with contactId scopes the query to that contact", async () => {
  const client = createClient();
  const contactId = "77777777-7777-4777-8777-777777777777";
  await listCrmRecords(client, context, "communications", { contactId });
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_communications"));
  assert.ok(select.sql.includes("contact_id ="), "the SQL must filter on contact_id, not just organization_id");
  assert.ok(select.values.includes(contactId), "contactId must be bound as a real parameter");
});
