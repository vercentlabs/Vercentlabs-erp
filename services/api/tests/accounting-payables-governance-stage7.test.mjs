import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPayablesGovernanceSummary,
  evaluatePayableHealth,
} from "../src/accounting/payables-governance.js";

const now = new Date("2026-08-02T00:00:00.000Z");
const baseBill = {
  id: "10000000-0000-4000-8000-000000000001",
  bill_type: "bill",
  status: "posted",
  matching_status: "matched",
  supplier_status: "active",
  supplier_invoice_number: "SUP-1001",
  supplier_snapshot: { id: "supplier" },
  payment_term_snapshot: { code: "NET-30" },
  grand_total: "1000.000000",
  outstanding_amount: "1000.000000",
  line_count: 2,
  schedule_count: 1,
  schedule_total: "1000.000000",
  schedule_outstanding: "1000.000000",
  duplicate_supplier_invoice_count: 0,
  source_purchase_order_id: "20000000-0000-4000-8000-000000000001",
  journal_entry_id: "30000000-0000-4000-8000-000000000001",
  due_date: "2026-08-07",
  updated_at: "2026-08-01T00:00:00.000Z",
};

test("payables health blocks duplicate invoices and unresolved matching", () => {
  const result = evaluatePayableHealth(
    {
      ...baseBill,
      matching_status: "exception",
      duplicate_supplier_invoice_count: 1,
    },
    {},
    now,
  );
  assert.equal(result.readiness, "blocked");
  assert.ok(
    result.blockers.some((message) => message.includes("duplicate supplier")),
  );
  assert.ok(
    result.blockers.some((message) => message.includes("Matching exception")),
  );
});

test("matched due-soon vendor bills become payment eligible", () => {
  const result = evaluatePayableHealth(
    baseBill,
    { paymentHorizonDays: 14 },
    now,
  );
  assert.equal(result.paymentEligible, true);
  assert.equal(result.isDueSoon, true);
  assert.equal(result.readiness, "attention");
});

test("payables summary preserves overdue aging and eligible cash demand", () => {
  const rows = [
    baseBill,
    {
      ...baseBill,
      id: "10000000-0000-4000-8000-000000000002",
      due_date: "2026-06-15",
      outstanding_amount: "2500.000000",
      grand_total: "2500.000000",
      schedule_total: "2500.000000",
      schedule_outstanding: "2500.000000",
    },
  ];
  const summary = buildPayablesGovernanceSummary(rows, {}, now);
  assert.equal(summary.total, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.overdueOutstanding, 2500);
  assert.equal(summary.paymentEligible, 2);
  assert.equal(summary.paymentEligibleAmount, 3500);
  assert.equal(summary.aging.days31To60, 2500);
});
