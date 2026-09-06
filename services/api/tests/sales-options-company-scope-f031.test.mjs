import assert from "node:assert/strict";
import test from "node:test";

import { getSalesOptions, getSalesReport } from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const companyA = "22222222-2222-4222-8222-222222222222";

function contextFor({ allowAllCompanies, activeCompanyId = null }) {
  return {
    organizationId: org,
    userId: "user-1",
    activeCompanyId,
    activeBranchId: null,
    allowAllCompanies,
    permissions: ["sales.view", "sales.reports.view", "sales.margin.view"],
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

const OPTIONS_QUERY_EXPECTATIONS = [
  { name: "parties", match: "FROM tenant.business_parties", column: "company_id" },
  { name: "contacts", match: "FROM tenant.contacts", column: "party.company_id" },
  { name: "addresses", match: "FROM tenant.addresses", column: "party.company_id" },
  { name: "items", match: "FROM tenant.items", column: "company_id" },
  { name: "warehouses", match: "FROM tenant.warehouses", column: "company_id" },
  { name: "opportunities", match: "FROM tenant.crm_opportunities", column: "company_id" },
];

test("F031: getSalesOptions scopes every company-owned lookup to the active company", async () => {
  const client = trackingClient();
  await getSalesOptions(client, contextFor({ allowAllCompanies: false, activeCompanyId: companyA }));
  for (const expectation of OPTIONS_QUERY_EXPECTATIONS) {
    const call = client.calls.find((c) => c.sql.includes(expectation.match));
    assert.ok(call, `expected a query against ${expectation.match}`);
    assert.match(
      call.sql,
      new RegExp(`${expectation.column.replace(".", "\\.")} IS NULL OR ${expectation.column.replace(".", "\\.")}=\\$2`),
      `${expectation.name} query must scope by company`,
    );
    assert.ok(call.values.includes(companyA), `${expectation.name} query must bind the active company id`);
  }
});

test("F031: getSalesOptions with allowAllCompanies bypasses the company filter entirely", async () => {
  const client = trackingClient();
  await getSalesOptions(client, contextFor({ allowAllCompanies: true }));
  for (const expectation of OPTIONS_QUERY_EXPECTATIONS) {
    const call = client.calls.find((c) => c.sql.includes(expectation.match));
    assert.ok(call);
    assert.doesNotMatch(call.sql, /AND \(.*company_id/);
    assert.deepEqual(call.values, [org]);
  }
});

test("F031: getSalesOptions fails closed (returns nothing company-scoped) when there is no active company", async () => {
  const client = trackingClient();
  await getSalesOptions(client, contextFor({ allowAllCompanies: false, activeCompanyId: null }));
  for (const expectation of OPTIONS_QUERY_EXPECTATIONS) {
    const call = client.calls.find((c) => c.sql.includes(expectation.match));
    assert.ok(call);
    assert.match(call.sql, /AND false/);
  }
});

test("F031: getSalesReport scopes quotation/order-backed reports to the active company", async () => {
  const client = trackingClient();
  const context = contextFor({ allowAllCompanies: false, activeCompanyId: companyA });
  for (const key of [
    "quotation-conversion",
    "order-intake",
    "expiring-quotations",
    "pending-approvals",
    "active-holds",
    "fulfillment",
    "billing-readiness",
    "customer-performance",
    "margin",
  ]) {
    client.calls.length = 0;
    await getSalesReport(client, context, key);
    assert.equal(client.calls.length, 1);
    const [call] = client.calls;
    assert.match(call.sql, /company_id=\$2/, `${key} report must scope by company`);
    assert.deepEqual(call.values, [org, companyA]);
  }
});

test("F031: getSalesReport with allowAllCompanies sees every company", async () => {
  const client = trackingClient();
  await getSalesReport(client, contextFor({ allowAllCompanies: true }), "margin");
  const [call] = client.calls;
  assert.doesNotMatch(call.sql, /company_id=\$2/);
  assert.deepEqual(call.values, [org]);
});

test("F031: getSalesReport fails closed with no active company", async () => {
  const client = trackingClient();
  await getSalesReport(client, contextFor({ allowAllCompanies: false, activeCompanyId: null }), "fulfillment");
  const [call] = client.calls;
  assert.match(call.sql, /AND false/);
});

function itemsClient() {
  return {
    async query(sql) {
      if (sql.includes("FROM tenant.items"))
        return {
          rows: [
            {
              id: "item-1",
              company_id: null,
              code: "SKU1",
              name: "Widget",
              item_type: "goods",
              uom_id: "uom-1",
              sales_price: "10.00",
              standard_cost: "6.00",
              tax_category_id: null,
            },
          ],
        };
      return { rows: [] };
    },
  };
}

test("F031: getSalesOptions hides item cost from a caller without sales.margin.view", async () => {
  const context = contextFor({ allowAllCompanies: true });
  context.permissions = ["sales.view"];
  const options = await getSalesOptions(itemsClient(), context);
  assert.equal(options.items[0].standard_cost, undefined);
  assert.equal(options.items[0].sales_price, "10.00");
});

test("F031: getSalesOptions still exposes item cost to a caller with sales.margin.view", async () => {
  const context = contextFor({ allowAllCompanies: true });
  context.permissions = ["sales.view", "sales.margin.view"];
  const options = await getSalesOptions(itemsClient(), context);
  assert.equal(options.items[0].standard_cost, "6.00");
});
