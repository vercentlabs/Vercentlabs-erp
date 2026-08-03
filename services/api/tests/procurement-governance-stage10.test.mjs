import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProcurementGovernanceSummary,
  evaluatePurchaseOrderHealth,
  evaluateSourcingHealth,
  evaluateSupplierGovernance,
} from "../src/procurement/governance.js";

test("supplier governance blocks unqualified suppliers with expired evidence", () => {
  const health = evaluateSupplierGovernance(
    {
      status: "submitted",
      legal_name: "Acme Components",
      currency_code: "INR",
      qualification_count: 0,
      certification_count: 1,
      expired_certification_count: 1,
      expiring_certification_count: 0,
      latest_score: 75,
    },
    { blockExpiredCertifications: true, requireQualifiedSupplier: true },
    new Date("2026-08-03T00:00:00Z"),
  );
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.some((message) => message.includes("qualified")));
  assert.ok(health.blockers.some((message) => message.includes("expired")));
});

test("sourcing governance requires competitive bids before award", () => {
  const health = evaluateSourcingHealth(
    {
      status: "awarded",
      data: { title: "Steel RFQ", bidCloseAt: "2026-08-02" },
      invitation_count: 3,
      bid_count: 1,
      evaluation_count: 1,
      award_count: 1,
    },
    { sourcingMinimumBids: 2, requireCompetitiveBids: true },
    new Date("2026-08-03T00:00:00Z"),
  );
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.some((message) => message.includes("At least 2")));
});

test("purchase-order governance reports partial receipt and summary risk", () => {
  const order = {
    status: "acknowledged",
    supplier_id: "00000000-0000-4000-8000-000000000001",
    supplier_status: "active",
    data: { expectedDeliveryDate: "2026-08-01" },
    line_count: 2,
    ordered_quantity: 10,
    received_quantity: 4,
    created_at: "2026-07-20",
  };
  const health = evaluatePurchaseOrderHealth(
    order,
    {},
    new Date("2026-08-03T00:00:00Z"),
  );
  assert.equal(health.readiness, "attention");
  const summary = buildProcurementGovernanceSummary({
    purchaseOrders: [{ health }],
    suppliers: [{ health: { readiness: "ready", riskBand: "low" } }],
  });
  assert.equal(summary.totalRecords, 2);
  assert.equal(summary.attention, 1);
});
