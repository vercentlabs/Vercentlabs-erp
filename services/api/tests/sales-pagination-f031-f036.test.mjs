import assert from "node:assert/strict";
import test from "node:test";

import {
  getSalesOptions,
  listQuotations,
  listSalesOrders,
} from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const partyId = "22222222-2222-4222-8222-222222222222";

function context() {
  return {
    organizationId: org,
    userId: "user-1",
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["sales.view"],
    roleSlugs: [],
  };
}

function trackingClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
}

test("F031: getSalesOptions bounds every picker query with a LIMIT", async () => {
  const client = trackingClient();
  await getSalesOptions(client, context());
  for (const table of [
    "tenant.business_parties",
    "tenant.contacts",
    "tenant.addresses",
    "tenant.items",
    "tenant.warehouses",
  ]) {
    const call = client.calls.find((c) => c.sql.includes(`FROM ${table}`));
    assert.ok(call, `expected a query against ${table}`);
    assert.match(call.sql, /LIMIT 500/, `${table} query must be bounded`);
  }
});

test("F031: getSalesOptions scopes contacts/addresses to one customer when partyId is given", async () => {
  const client = trackingClient();
  await getSalesOptions(client, context(), null, partyId);
  const contacts = client.calls.find((c) => c.sql.includes("FROM tenant.contacts"));
  const addresses = client.calls.find((c) => c.sql.includes("FROM tenant.addresses"));
  assert.match(contacts.sql, /contact\.party_id=\$/);
  assert.ok(contacts.values.includes(partyId));
  assert.match(addresses.sql, /address\.party_id=\$/);
  assert.ok(addresses.values.includes(partyId));
});

test("F036: listQuotations supports limit/offset beyond the default 200", async () => {
  const client = trackingClient();
  await listQuotations(client, context(), { limit: "50", offset: "100" });
  const [call] = client.calls;
  assert.match(call.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.deepEqual(call.values.slice(-2), [50, 100]);
});

test("F036: listQuotations clamps an out-of-range limit", async () => {
  const client = trackingClient();
  await listQuotations(client, context(), { limit: "5000" });
  const [call] = client.calls;
  assert.deepEqual(call.values.slice(-2), [500, 0]);
});

test("F042: listSalesOrders supports limit/offset beyond the default 200", async () => {
  const client = trackingClient();
  await listSalesOrders(client, context(), { limit: "25", offset: "75" });
  const [call] = client.calls;
  assert.match(call.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.deepEqual(call.values.slice(-2), [25, 75]);
});

// F031: the customer 360 Orders/Quotations tabs used to match on the
// customer's display-name text (ILIKE), which can both miss and over-match
// across similarly-named customers. They now filter by the stable party_id
// FK instead.
test("F031: listSalesOrders filters by party_id when partyId is given", async () => {
  const client = trackingClient();
  await listSalesOrders(client, context(), { partyId });
  const [call] = client.calls;
  assert.match(call.sql, /sales_order\.party_id=\$\d+/);
  assert.ok(call.values.includes(partyId));
});

test("F031: listQuotations filters by party_id when partyId is given", async () => {
  const client = trackingClient();
  await listQuotations(client, context(), { partyId });
  const [call] = client.calls;
  assert.match(call.sql, /quotation\.party_id=\$\d+/);
  assert.ok(call.values.includes(partyId));
});
