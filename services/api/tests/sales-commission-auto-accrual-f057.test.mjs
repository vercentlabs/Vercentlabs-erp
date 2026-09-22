import assert from "node:assert/strict";
import test from "node:test";

import { confirmSalesOrderWithCrmSync } from "../src/orchestration/sales-crm-opportunity-sync.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const partyId = "44444444-4444-4444-8444-444444444444";
const companyId = "55555555-5555-4555-8555-555555555555";
const ownerUserId = "66666666-6666-4666-8666-666666666666";
const ruleId = "77777777-7777-4777-8777-777777777777";

const salesContext = {
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
    company_id: companyId,
    party_id: partyId,
    owner_user_id: ownerUserId,
    current_version_id: versionId,
    lifecycle_status: "approved",
    source_opportunity_id: null,
    subtotal: "1000",
    margin_amount: "300",
    currency_code: "USD",
    grand_total: "1000",
    ...overrides,
  };
}

function accrualClient({ order = orderRow(), hasCommissionRule = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders") && sql.includes("FOR UPDATE") && !sql.includes("version.currency_code"))
        return { rows: [order] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_order_versions") && sql.includes("grand_total,base_currency_total"))
        return { rows: [{ grand_total: "1000", base_currency_total: "1000" }] };
      if (sql.includes("FROM tenant.business_parties") && sql.includes("credit_limit"))
        return { rows: [{ credit_limit: "0" }] };
      if (sql.includes("SELECT COALESCE(sum(version.base_currency_total)"))
        return { rows: [{ exposure: "0" }] };
      if (sql.includes("FROM tenant.accounting_customer_invoices") && sql.includes("ar_outstanding"))
        return { rows: [{ ar_outstanding: "0", unapplied_advances: "0" }] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("lifecycle_status='confirmed'"))
        return { rows: [{ id: orderId }] };
      if (sql.startsWith("UPDATE tenant.sales_order_line_progress")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      // accrueSalesCommission's own order() lookup (joins the version for subtotal/margin_amount)
      if (sql.includes("FROM tenant.sales_orders record") && sql.includes("version.margin_amount,version.subtotal"))
        return { rows: [order] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("users.id"))
        return { rows: [{ id: ownerUserId, full_name: "Owner" }] };
      if (sql.includes("FROM tenant.sales_commission_rules"))
        return {
          rows: hasCommissionRule
            ? [{ id: ruleId, rate_percent: "5", basis: "net_sales" }]
            : [],
        };
      if (sql.includes("INSERT INTO tenant.sales_commission_entries"))
        return { rows: [{ id: "entry-1", commission_amount: values[7] }] };
      return { rows: [] };
    },
  };
}

test("F057: confirming an order with an applicable commission rule accrues commission automatically", async () => {
  const client = accrualClient();
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
  const accrual = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.sales_commission_entries"));
  assert.ok(accrual, "expected accrueSalesCommission to run automatically, without a manual action");
});

test("F057: confirming an order with no applicable commission rule does not block confirmation (best-effort)", async () => {
  const client = accrualClient({ hasCommissionRule: false });
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
  assert.equal(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.sales_commission_entries")), false);
});

test("F057: an order with no owner does not block confirmation (best-effort)", async () => {
  const client = accrualClient({ order: orderRow({ owner_user_id: null }) });
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
  assert.equal(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.sales_commission_entries")), false);
});
