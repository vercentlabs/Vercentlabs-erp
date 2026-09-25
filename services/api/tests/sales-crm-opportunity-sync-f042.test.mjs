import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmSalesOrderWithCrmSync,
  cancelSalesOrderWithCrmSync,
} from "../src/orchestration/sales-crm-opportunity-sync.js";

const org = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const partyId = "44444444-4444-4444-8444-444444444444";
const opportunityId = "55555555-5555-4555-8555-555555555555";
const pipelineId = "66666666-6666-4666-8666-666666666666";
const wonStageId = "77777777-7777-4777-8777-777777777777";
const openStageId = "88888888-8888-4888-8888-888888888888";
const wonReasonId = "99999999-9999-4999-8999-999999999999";

const salesContext = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.order.confirm", "sales.order.cancel"],
  roleSlugs: [],
};

function orderRow(overrides = {}) {
  return {
    id: orderId,
    organization_id: org,
    company_id: "company-1",
    party_id: partyId,
    current_version_id: versionId,
    lifecycle_status: "approved",
    source_opportunity_id: opportunityId,
    ...overrides,
  };
}

function syncClient({
  order = orderRow(),
  opportunityStatus = "open",
  hasWonStage = true,
  hasWonReason = true,
  hasReopenStage = true,
} = {}) {
  const calls = [];
  let opportunityCurrentStatus = opportunityStatus;
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_orders") && sql.includes("FOR UPDATE"))
        return { rows: [order] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_order_versions"))
        return { rows: [{ grand_total: "1000", base_currency_total: "1000" }] };
      if (sql.includes("FROM tenant.business_parties") && sql.includes("credit_limit"))
        return { rows: [{ credit_limit: "0", display_name: "Customer", status: "active", sales_block: "none" }] };
      if (sql.includes("SELECT COALESCE(sum(version.base_currency_total)"))
        return { rows: [{ exposure: "0" }] };
      if (sql.includes("FROM tenant.accounting_customer_invoices") && sql.includes("ar_outstanding"))
        return { rows: [{ ar_outstanding: "0", unapplied_advances: "0" }] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("lifecycle_status='confirmed'"))
        return { rows: [{ id: orderId }] };
      if (sql.startsWith("UPDATE tenant.sales_orders") && sql.includes("lifecycle_status='cancelled'"))
        return { rows: [] };
      if (sql.startsWith("UPDATE tenant.sales_order_line_progress")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress"))
        return { rows: [{ fulfilled: "0", invoiced: "0" }] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      if (sql.startsWith("SELECT pipeline_id, status FROM tenant.crm_opportunities"))
        return { rows: [{ pipeline_id: pipelineId, status: opportunityCurrentStatus }] };
      if (sql.includes("FROM tenant.crm_pipeline_stages") && sql.includes("is_won=true"))
        return { rows: hasWonStage ? [{ id: wonStageId }] : [] };
      if (sql.includes("FROM tenant.crm_pipeline_stages") && sql.includes("is_won=false"))
        return { rows: hasReopenStage ? [{ id: openStageId }] : [] };
      if (sql.includes("FROM tenant.crm_lost_reasons"))
        return { rows: hasWonReason ? [{ id: wonReasonId, name: "Other", outcome_type: "won" }] : [] };
      if (sql.includes("FROM tenant.crm_opportunities record") && sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: opportunityId,
              organization_id: org,
              stage_id: opportunityCurrentStatus === "won" ? wonStageId : openStageId,
              pipeline_id: pipelineId,
              status: opportunityCurrentStatus,
              updated_at: new Date().toISOString(),
              outcome_reason_id: null,
              lost_reason_id: null,
            },
          ],
        };
      }
      if (sql.includes("crm_pipeline_stages WHERE organization_id = $1 AND id = $2"))
        return { rows: [{ id: values[1], probability: 100, forecast_category: "closed", is_won: values[1] === wonStageId, is_lost: false }] };
      if (sql.startsWith("UPDATE tenant.crm_opportunities")) {
        opportunityCurrentStatus = values[3];
        return { rows: [{ id: opportunityId, status: values[3], stage_id: values[0] }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F042: confirming an order with a source opportunity moves it to the pipeline's won stage via moveOpportunityStage", async () => {
  const client = syncClient();
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
  const opportunityUpdate = client.calls.find((c) => c.sql.startsWith("UPDATE tenant.crm_opportunities"));
  assert.ok(opportunityUpdate, "expected the opportunity to be updated via moveOpportunityStage");
  assert.equal(opportunityUpdate.values[3], "won");
  const history = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"));
  assert.ok(history, "expected a real stage-history row, not a raw bypass");
  assert.equal(
    client.calls.some((c) => c.sql.includes("UPDATE tenant.crm_opportunities opportunity SET status='won'")),
    false,
    "the raw bypass UPDATE must be gone",
  );
});

test("F042: confirming an order with no source opportunity never touches CRM", async () => {
  const client = syncClient({ order: orderRow({ source_opportunity_id: null }) });
  await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(client.calls.some((c) => c.sql.includes("crm_opportunities")), false);
});

test("F042: a pipeline with no won stage configured does not block order confirmation (best-effort)", async () => {
  const client = syncClient({ hasWonStage: false });
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.crm_opportunities")), false);
});

test("F042: no configured won reason does not block order confirmation (best-effort)", async () => {
  const client = syncClient({ hasWonReason: false });
  const result = await confirmSalesOrderWithCrmSync(client, salesContext, orderId);
  assert.equal(result.status, "confirmed");
});

test("F042: cancelling the order that won an opportunity reopens it into a non-terminal stage", async () => {
  const client = syncClient({
    order: orderRow({ lifecycle_status: "confirmed" }),
    opportunityStatus: "won",
  });
  const result = await cancelSalesOrderWithCrmSync(client, salesContext, orderId, "Customer withdrew.");
  assert.equal(result.status, "cancelled");
  const opportunityUpdate = client.calls.find((c) => c.sql.startsWith("UPDATE tenant.crm_opportunities"));
  assert.ok(opportunityUpdate, "expected the opportunity to be reopened");
  assert.equal(opportunityUpdate.values[3], "open");
});

test("F042: cancelling an order whose opportunity is no longer won does not touch it", async () => {
  const client = syncClient({
    order: orderRow({ lifecycle_status: "confirmed" }),
    opportunityStatus: "open",
  });
  const result = await cancelSalesOrderWithCrmSync(client, salesContext, orderId, "Customer withdrew.");
  assert.equal(result.status, "cancelled");
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.crm_opportunities")), false);
});
