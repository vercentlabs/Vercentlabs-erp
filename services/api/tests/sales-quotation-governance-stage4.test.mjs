import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQuotationGovernanceSummary,
  bulkUpdateQuotations,
  evaluateQuotationHealth,
} from "../src/sales/quotation-governance.js";

test("quotation health blocks expired quotations with incomplete commercial data", () => {
  const health = evaluateQuotationHealth(
    {
      lifecycle_status: "draft",
      approval_status: "not_required",
      acceptance_status: "not_sent",
      valid_until: "2025-01-01",
      updated_at: "2025-01-01",
      grand_total: 0,
      line_count: 0,
      customer_snapshot: {},
      payment_term_snapshot: {},
      billing_address_snapshot: {},
      margin_percent: -2,
      minimum_margin_percent: 5,
      maximum_discount_percent: 20,
      quotation_approval_discount: 10,
    },
    {},
    new Date("2026-01-01T00:00:00Z"),
  );
  assert.equal(health.readiness, "blocked");
  assert.ok(health.blockers.length >= 4);
  assert.ok(
    health.warnings.includes("Margin is below the configured minimum."),
  );
});

test("quotation governance summary calculates active value and attention queues", () => {
  const summary = buildQuotationGovernanceSummary(
    [
      {
        lifecycle_status: "approved",
        approval_status: "approved",
        acceptance_status: "not_sent",
        valid_until: "2026-03-01",
        updated_at: "2026-02-01",
        grand_total: 1000,
        line_count: 1,
        customer_snapshot: { displayName: "Acme" },
        payment_term_snapshot: { code: "NET-30" },
        billing_address_snapshot: { city: "Pune" },
        margin_percent: 20,
        minimum_margin_percent: 5,
        maximum_discount_percent: 2,
        quotation_approval_discount: 10,
      },
    ],
    {},
    new Date("2026-02-15T00:00:00Z"),
  );
  assert.equal(summary.active, 1);
  assert.equal(summary.activeValue, 1000);
  assert.equal(summary.total, 1);
});

test("quotation bulk updates reject an empty selection before database mutation", async () => {
  await assert.rejects(
    () =>
      bulkUpdateQuotations(
        { query: async () => ({ rows: [] }) },
        {
          organizationId: "00000000-0000-4000-8000-000000000001",
          userId: "00000000-0000-4000-8000-000000000002",
          activeCompanyId: null,
          activeBranchId: null,
          allowAllCompanies: true,
          permissions: ["sales.quotation.create"],
          roleSlugs: [],
        },
        { ids: [], changes: { validUntil: "2026-12-31" } },
      ),
    /Select between 1 and 200 quotations/,
  );
});
