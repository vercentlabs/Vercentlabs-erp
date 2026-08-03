import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBankingGovernanceSummary,
  evaluateBankStatementHealth,
} from "../src/accounting/banking-governance.js";

test("banking governance blocks inconsistent completed reconciliations", () => {
  const health = evaluateBankStatementHealth(
    {
      status: "reconciled",
      reconciliation_status: "completed",
      reconciliation_difference: "10.00",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      line_count: 3,
      matched_line_count: 3,
      unmatched_line_count: 0,
      suggested_line_count: 0,
      partial_line_count: 0,
      source_hash: "abc",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    {},
    new Date("2026-08-02T00:00:00.000Z"),
  );

  assert.equal(health.readiness, "blocked");
  assert.equal(health.closeEligible, false);
  assert.ok(
    health.blockers.some((message) => message.includes("non-zero balance")),
  );
});

test("banking governance identifies aged unmatched statements", () => {
  const health = evaluateBankStatementHealth(
    {
      status: "reconciling",
      reconciliation_status: "in_progress",
      reconciliation_difference: "0",
      period_start: "2026-05-01",
      period_end: "2026-05-31",
      line_count: 10,
      matched_line_count: 8,
      unmatched_line_count: 2,
      suggested_line_count: 0,
      partial_line_count: 0,
      source_hash: "abc",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    { highRiskUnmatchedDays: 30 },
    new Date("2026-08-02T00:00:00.000Z"),
  );

  assert.equal(health.readiness, "attention");
  assert.equal(health.riskBand, "high");
  assert.equal(health.metrics.openLineCount, 2);
});

test("banking governance summary preserves close-ready evidence", () => {
  const summary = buildBankingGovernanceSummary(
    [
      {
        status: "reconciled",
        reconciliation_status: "completed",
        reconciliation_difference: "0",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        line_count: 2,
        matched_line_count: 2,
        unmatched_line_count: 0,
        suggested_line_count: 0,
        partial_line_count: 0,
        source_hash: "abc",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
      {
        status: "imported",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        line_count: 1,
        matched_line_count: 0,
        unmatched_line_count: 1,
        suggested_line_count: 0,
        partial_line_count: 0,
        source_hash: "def",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    {},
    new Date("2026-08-02T00:00:00.000Z"),
  );

  assert.equal(summary.totalStatements, 2);
  assert.equal(summary.closeEligible, 1);
  assert.equal(summary.openLineCount, 1);
});
