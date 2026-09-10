import assert from "node:assert/strict";
import test from "node:test";

import { getCrmOptions } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";

// Integrity closeout (Prompts 1-5): a restricted actor, real company scope,
// NOT allowAllCompanies, NOT crm.records.view_all.
const restrictedContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view"],
};

function mockClient() {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: [] };
    },
  };
}

test("getCrmOptions: the leads option list applies the same owner scope as the real Lead list/detail query", async () => {
  const client = mockClient();
  await getCrmOptions(client, restrictedContext);
  const leadsQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_leads lead"));
  assert.ok(leadsQuery, "expected a crm_leads options query");
  assert.match(
    leadsQuery.sql,
    /lead\.owner_user_id IS NULL OR lead\.owner_user_id = \$5/,
    "leads options query must apply owner-scope, not just company/branch scope",
  );
  assert.ok(leadsQuery.values.includes(actorId), "the actor's own user id must be bound for owner-scope comparison");
  assert.equal(leadsQuery.values[5], false, "allowAllCompanies/view-all flag must be bound as false for a restricted actor");
});

test("getCrmOptions: the opportunities option list applies the same owner scope as the real Opportunity list/detail query", async () => {
  const client = mockClient();
  await getCrmOptions(client, restrictedContext);
  const opportunitiesQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_opportunities opportunity"));
  assert.ok(opportunitiesQuery, "expected a crm_opportunities options query");
  assert.match(
    opportunitiesQuery.sql,
    /opportunity\.owner_user_id IS NULL OR opportunity\.owner_user_id = \$5/,
    "opportunities options query must apply owner-scope, not just company/branch scope",
  );
  assert.ok(opportunitiesQuery.values.includes(actorId), "the actor's own user id must be bound for owner-scope comparison");
});

test("getCrmOptions: an actor with crm.records.view_all is not restricted by owner scope (matches recordScope's own allowAllCompanies semantics)", async () => {
  const client = mockClient();
  const viewAllContext = { ...restrictedContext, permissions: ["crm.view", "crm.records.view_all"] };
  await getCrmOptions(client, viewAllContext);
  const leadsQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_leads lead"));
  assert.equal(leadsQuery.values[5], true, "crm.records.view_all must bind the owner-scope bypass flag as true");
});

test("getCrmOptions: reference/config option lists (no ownerField in their resource definition) are unaffected by the owner-scope fix", async () => {
  const client = mockClient();
  await getCrmOptions(client, restrictedContext);
  const pipelinesQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_pipelines pipeline"));
  assert.ok(pipelinesQuery, "expected a pipelines options query");
  assert.doesNotMatch(pipelinesQuery.sql, /owner_user_id/, "pipelines have no ownerField and must not gain an owner clause");
});

// Regression (found via live E2E, invisible to a mock that doesn't enforce
// Postgres bind semantics): the number of $N placeholders a query's SQL
// text actually references must exactly equal the number of bound values
// supplied for it. Postgres's extended query protocol hard-rejects a Bind
// message carrying MORE values than a prepared statement's own placeholder
// count ("bind message supplies N parameters, but prepared statement
// requires M", code 08P01) — a mismatch a mocked client silently accepts,
// which is exactly how the owner-scope fix above widened the shared
// `parameters` array from 4 to 6 elements and broke every one of
// getCrmOptions()'s other ~28 queries (only leads/opportunities reference
// $5/$6) until it was caught by a real database in E2E, not by any unit
// test. This test inspects every query getCrmOptions() actually issues and
// asserts the supplied value count exactly matches the highest $N its own
// SQL text references, so a future accidental re-widening of a shared
// parameters array fails here instead of only in a live E2E run.
test("getCrmOptions: every issued query's bound value count exactly matches its own SQL text's highest referenced placeholder", async () => {
  const client = mockClient();
  await getCrmOptions(client, restrictedContext);
  assert.ok(client.queries.length > 20, "expected getCrmOptions to have issued its full set of option-list queries");
  for (const { sql, values } of client.queries) {
    const placeholderNumbers = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    const highestReferenced = placeholderNumbers.length ? Math.max(...placeholderNumbers) : 0;
    assert.equal(
      values.length,
      highestReferenced,
      `query referencing up to $${highestReferenced} must receive exactly ${highestReferenced} bound value(s), got ${values.length}. SQL: ${sql.slice(0, 160)}...`,
    );
  }
});
