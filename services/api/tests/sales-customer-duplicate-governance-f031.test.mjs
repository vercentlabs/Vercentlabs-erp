import assert from "node:assert/strict";
import test from "node:test";

import { recordAccountDuplicateOverride } from "../src/modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";

const org = "11111111-1111-4111-8111-111111111111";
const partyId = "22222222-2222-4222-8222-222222222222";
const matchedPartyId = "33333333-3333-4333-8333-333333333333";

const context = { organizationId: org, userId: "user-1" };

function trackingClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_duplicate_rules")) return { rows: [{ at: null }] };
      return { rows: [{ id: "override-1" }] };
    },
  };
}

// F031: Sales customer creation now reuses CRM's governed duplicate-override
// ledger instead of a separate table, so overrides created from Sales must
// be attributable to the module that created them.
test("F031: recordAccountDuplicateOverride defaults source_module to 'crm' for existing CRM callers", async () => {
  const client = trackingClient();
  await recordAccountDuplicateOverride(client, context, partyId, [matchedPartyId], "create", "Confirmed with the customer directly, different legal entity.");
  const insert = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.crm_account_duplicate_overrides"));
  assert.ok(insert, "expected an insert into the override ledger");
  assert.match(insert.sql, /source_module/);
  assert.equal(insert.values.at(-1), "crm");
});

test("F031: Sales create/update overrides are written with source_module='sales'", async () => {
  const client = trackingClient();
  await recordAccountDuplicateOverride(client, context, partyId, [matchedPartyId], "create", "Confirmed with the customer directly, different legal entity.", "sales");
  const insert = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.crm_account_duplicate_overrides"));
  assert.equal(insert.values.at(-1), "sales");
  assert.equal(insert.values.includes(partyId), true);
  assert.deepEqual(insert.values[2], [matchedPartyId]);
});
