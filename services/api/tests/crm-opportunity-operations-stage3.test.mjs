import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateOpportunityHealth,
  buildPipelineSummary,
} from "../src/crm/opportunity-operations.js";
test("opportunity health identifies overdue and inactive deals", () => {
  const h = evaluateOpportunityHealth(
    {
      amount: 1000,
      probability: 50,
      status: "open",
      expected_close_date: "2025-01-01",
      updated_at: "2025-01-01",
      next_step: "",
    },
    new Date("2026-01-01"),
  );
  assert.equal(h.healthy, false);
  assert.ok(h.warnings.length >= 2);
});
test("pipeline summary calculates weighted value deterministically", () => {
  const s = buildPipelineSummary(
    [
      {
        amount: 1000,
        probability: 50,
        status: "open",
        stage_name: "Qualify",
        expected_close_date: "2027-01-01",
        updated_at: "2026-01-01",
        next_step: "Call",
      },
    ],
    new Date("2026-02-01"),
  );
  assert.equal(s.weightedAmount, 500);
  assert.equal(s.byStage.Qualify, 1);
});
test("pipeline summary separates open amount", () => {
  const s = buildPipelineSummary([
    {
      amount: 120,
      probability: 100,
      status: "won",
      stage_name: "Won",
      next_step: "Done",
    },
  ]);
  assert.equal(s.openAmount, 0);
});
