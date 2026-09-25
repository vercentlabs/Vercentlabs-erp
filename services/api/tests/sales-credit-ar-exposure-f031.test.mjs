import assert from "node:assert/strict";
import test from "node:test";

import { confirmSalesOrder, SalesError } from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const partyId = "44444444-4444-4444-8444-444444444444";

const context = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.order.confirm"],
  roleSlugs: [],
};

function orderRow(overrides = {}) {
  return {
    id: orderId,
    organization_id: org,
    company_id: null,
    party_id: partyId,
    current_version_id: versionId,
    lifecycle_status: "approved",
    ...overrides,
  };
}

// F031: confirmSalesOrder used to compute credit exposure only from other
// open sales orders, so a customer current on orders but delinquent on
// invoices sailed through the gate. It now also reads unpaid/overdue AR
// (net of unapplied advance receipts) within the same transaction.
function creditClient({ creditLimit = "0", openOrdersExposure = "0", arOutstanding = "0", unappliedAdvances = "0" } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders") && sql.includes("FOR UPDATE") && !sql.includes("version.currency_code"))
        return { rows: [orderRow()] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_order_versions") && sql.includes("grand_total,base_currency_total"))
        return { rows: [{ grand_total: "500", base_currency_total: "500" }] };
      if (sql.includes("FROM tenant.business_parties") && sql.includes("credit_limit"))
        return { rows: [{ credit_limit: creditLimit, display_name: "Customer", status: "active", sales_block: "none" }] };
      if (sql.includes("AS exposure"))
        return { rows: [{ exposure: openOrdersExposure }] };
      if (sql.includes("FROM tenant.accounting_customer_invoices") && sql.includes("ar_outstanding"))
        return { rows: [{ ar_outstanding: arOutstanding, unapplied_advances: unappliedAdvances }] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("lifecycle_status='confirmed'"))
        return { rows: [{ id: orderId }] };
      if (sql.startsWith("UPDATE tenant.sales_order_line_progress")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F031: confirmSalesOrder issues an AR-exposure query scoped to the customer, excluding draft/void/paid invoices", async () => {
  const client = creditClient();
  await confirmSalesOrder(client, context, orderId);
  const arCall = client.calls.find((c) => c.sql.includes("FROM tenant.accounting_customer_invoices") && c.sql.includes("ar_outstanding"));
  assert.ok(arCall, "expected an AR-exposure query");
  assert.match(arCall.sql, /status NOT IN \('draft','void','paid'\)/);
  assert.ok(arCall.values.includes(partyId));
});

test("F031: unpaid AR alone (with zero other open sales orders) blocks confirmation once it exceeds the credit limit", async () => {
  const client = creditClient({ creditLimit: "1000", openOrdersExposure: "0", arOutstanding: "5000" });
  await assert.rejects(
    () => confirmSalesOrder(client, context, orderId),
    (error) => error instanceof SalesError && error.code === "SALES_CREDIT_BLOCK",
  );
});

test("F031: unapplied advance receipts net against AR exposure instead of contributing to the block", async () => {
  // AR outstanding (5000) minus unapplied advances (5000) nets to zero, so
  // this should pass even though the raw AR figure alone would exceed the limit.
  const client = creditClient({ creditLimit: "1000", openOrdersExposure: "0", arOutstanding: "5000", unappliedAdvances: "5000" });
  const result = await confirmSalesOrder(client, context, orderId);
  assert.equal(result.status, "confirmed");
  assert.equal(result.creditStatus, "passed");
});

test("F031: with no AR and no other open orders, a small order under the limit still passes", async () => {
  const client = creditClient({ creditLimit: "1000" });
  const result = await confirmSalesOrder(client, context, orderId);
  assert.equal(result.status, "confirmed");
  assert.equal(result.creditStatus, "passed");
});
