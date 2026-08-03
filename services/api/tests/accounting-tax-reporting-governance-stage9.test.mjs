import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaxGovernanceSummary,
  evaluateTaxReturnHealth,
} from "../src/accounting/tax-reporting-governance.js";

test("tax governance blocks filing when ledger totals or exceptions are unresolved", () => {
  const health = evaluateTaxReturnHealth(
    {
      status: "review",
      return_type: "GSTR-3B",
      tax_registration: "27ABCDE1234F1Z5",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      filing_due_date: "2026-08-20",
      output_tax: "100.00",
      input_tax_credit: "25.00",
      withholding_tax: "0",
      return_line_total: "120.00",
      line_count: 4,
      open_exception_count: 1,
      failed_compliance_count: 0,
      pending_compliance_count: 0,
      exception_updated_at: "2026-08-01T00:00:00.000Z",
    },
    { reportingTolerance: "0.01", blockOpenExceptions: true },
    new Date("2026-08-03T00:00:00.000Z"),
  );

  assert.equal(health.readiness, "blocked");
  assert.equal(health.filingEligible, false);
  assert.ok(
    health.blockers.some((message) => message.includes("do not reconcile")),
  );
  assert.ok(
    health.blockers.some((message) => message.includes("Open tax exceptions")),
  );
});

test("tax governance warns before a filing due date without blocking a reconciled draft", () => {
  const health = evaluateTaxReturnHealth(
    {
      status: "draft",
      return_type: "GSTR-1",
      tax_registration: "27ABCDE1234F1Z5",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      filing_due_date: "2026-08-07",
      output_tax: "100.00",
      input_tax_credit: "0",
      withholding_tax: "0",
      return_line_total: "100.00",
      line_count: 2,
      open_exception_count: 0,
      failed_compliance_count: 0,
      pending_compliance_count: 1,
    },
    { filingWarningDays: 7 },
    new Date("2026-08-03T00:00:00.000Z"),
  );

  assert.equal(health.readiness, "attention");
  assert.equal(health.reviewEligible, true);
  assert.ok(health.warnings.some((message) => message.includes("due date")));
});

test("tax governance summary preserves filing risk and payable exposure", () => {
  const summary = buildTaxGovernanceSummary(
    [
      {
        status: "filed",
        return_type: "GSTR-1",
        tax_registration: "27ABCDE1234F1Z5",
        external_reference: "ARN-001",
        filed_at: "2026-08-01T00:00:00.000Z",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        filing_due_date: "2026-08-11",
        output_tax: "100.00",
        input_tax_credit: "20.00",
        withholding_tax: "0",
        return_line_total: "120.00",
        line_count: 3,
        open_exception_count: 0,
        failed_compliance_count: 0,
        pending_compliance_count: 0,
        net_tax_payable: "80.00",
      },
      {
        status: "draft",
        return_type: "GSTR-3B",
        period_start: "2026-06-01",
        period_end: "2026-06-30",
        filing_due_date: "2026-07-20",
        output_tax: "50.00",
        input_tax_credit: "10.00",
        withholding_tax: "0",
        return_line_total: "60.00",
        line_count: 2,
        open_exception_count: 0,
        failed_compliance_count: 0,
        pending_compliance_count: 0,
        net_tax_payable: "40.00",
      },
    ],
    {},
    new Date("2026-08-03T00:00:00.000Z"),
  );

  assert.equal(summary.totalReturns, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.highRisk, 1);
  assert.equal(summary.netTaxPayable, 120);
});
