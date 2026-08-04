import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateExactAmounts,
  allocateQuotaSeasonality,
  buildRecurringRevenueSchedule,
  calculatePredictiveForecast,
  cloneOpportunityBlueprint,
  evaluateMutualActionPlan,
  summarizeWinLoss,
  validateRevenueSplits,
} from "../src/crm/opportunity-revenue-intelligence.js";

test("recurring revenue preserves exact document totals", () => {
  const rows = buildRecurringRevenueSchedule({
    totalAmount: 100,
    periods: 3,
    interval: "month",
    startDate: "2026-01-01",
  });
  assert.deepEqual(
    rows.map((row) => row.amount),
    [33.34, 33.33, 33.33],
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.amount, 0),
    100,
  );
});

test("revenue splits fail closed unless each split type totals 100", () => {
  assert.throws(
    () =>
      validateRevenueSplits([
        { userId: "a", percent: 80 },
        { userId: "b", percent: 10 },
      ]),
    /exactly 100/,
  );
  assert.equal(
    validateRevenueSplits([
      { userId: "a", percent: 60 },
      { userId: "b", percent: 40 },
    ]).length,
    2,
  );
});

test("mutual action plan exposes overdue and required work", () => {
  const result = evaluateMutualActionPlan(
    {
      milestones: [
        {
          title: "Security",
          status: "planned",
          required: true,
          dueDate: "2026-01-01",
          internalOwnerUserId: "u",
        },
      ],
    },
    new Date("2026-02-01"),
  );
  assert.equal(result.ready, false);
  assert.equal(result.overdue, 1);
  assert.equal(result.requiredIncomplete, 1);
});

test("predictive forecast is deterministic and explainable", () => {
  const result = calculatePredictiveForecast({
    historicalWinRate: 0.4,
    opportunities: [
      { id: "o1", amount: 1000, probability: 50, healthScore: 80, ageDays: 5 },
    ],
  });
  assert.equal(result.opportunityCount, 1);
  assert.ok(result.predictedAmount > 0 && result.predictedAmount < 1000);
  assert.equal(result.rows[0].factors.historicalWinRate, 0.4);
});

test("quota seasonality preserves exact target", () => {
  const result = allocateQuotaSeasonality({
    totalAmount: 1000,
    weights: [
      { periodKey: "Q1", weight: 1 },
      { periodKey: "Q2", weight: 2 },
      { periodKey: "Q3", weight: 3 },
      { periodKey: "Q4", weight: 4 },
    ],
  });
  assert.equal(
    result.reduce((sum, row) => sum + row.targetAmount, 0),
    1000,
  );
  assert.equal(result[3].targetAmount, 400);
});

test("clone blueprint resets governed lifecycle fields", () => {
  const result = cloneOpportunityBlueprint(
    {
      id: "source",
      name: "Expansion",
      amount: 500,
      pipeline_id: "p",
      stage_id: "s",
      custom_data: { region: "west" },
    },
    { code: "OPP-NEW" },
  );
  assert.equal(result.code, "OPP-NEW");
  assert.equal(result.forecastCategory, "pipeline");
  assert.equal(result.customData.clonedFromOpportunityId, "source");
});

test("win-loss insights aggregate reasons and competitors", () => {
  const result = summarizeWinLoss([
    {
      outcome: "won",
      primaryReason: "Product",
      competitorName: "Alpha",
      salesCycleDays: 10,
    },
    {
      outcome: "lost",
      primaryReason: "Price",
      competitorName: "Alpha",
      salesCycleDays: 20,
    },
  ]);
  assert.equal(result.won, 1);
  assert.equal(result.lost, 1);
  assert.equal(result.byCompetitor.Alpha, 2);
  assert.equal(result.averageCycleDays, 15);
});

test("exact allocator is stable for fractional cents", () => {
  assert.deepEqual(allocateExactAmounts(0.05, [1, 1]), [0.03, 0.02]);
});
