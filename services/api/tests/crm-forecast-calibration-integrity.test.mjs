import assert from "node:assert/strict";
import test from "node:test";

import { getForecastCalibration } from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js";

// Integrity closeout (Prompts 1-5): the predictive-forecast model exposed
// model version/confidence/predicted amount (real provenance), but no
// drift/calibration monitoring compared a stored prediction to what
// actually closed — a real F011 dossier requirement. This is a
// deterministic comparison of a real stored snapshot against real closed-
// won revenue for the same period, never a fabricated/AI-invented number.

const org = "11111111-1111-4111-8111-111111111111";
const context = { organizationId: org, userId: "22222222-2222-4222-8222-222222222222" };

function mockClient(rows) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows };
    },
  };
}

test("getForecastCalibration: only queries closed forecast periods", async () => {
  const client = mockClient([]);
  await getForecastCalibration(client, context);
  assert.match(client.queries[0].sql, /period\.status = 'closed'/);
});

test("getForecastCalibration: computes a correctly-signed error amount and percentage from real predicted vs actual figures", async () => {
  const client = mockClient([
    {
      period_id: "p1",
      period_name: "September 2026",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      model_version: "v3",
      predicted_amount: "100000.00",
      confidence_percent: "72.00",
      captured_at: "2026-09-29T00:00:00.000Z",
      actual_won_amount: "115000.00",
    },
  ]);
  const [row] = await getForecastCalibration(client, context);
  assert.equal(row.predictedAmount, 100000);
  assert.equal(row.actualWonAmount, 115000);
  assert.equal(row.errorAmount, 15000);
  assert.equal(row.errorPercent, 15);
});

test("getForecastCalibration: a zero predicted amount does not throw a division error, reports null percent", async () => {
  const client = mockClient([
    {
      period_id: "p2", period_name: "August 2026", period_start: "2026-08-01", period_end: "2026-08-31",
      model_version: "v3", predicted_amount: "0", confidence_percent: "0",
      captured_at: "2026-08-29T00:00:00.000Z", actual_won_amount: "5000.00",
    },
  ]);
  const [row] = await getForecastCalibration(client, context);
  assert.equal(row.errorPercent, null);
});

test("getForecastCalibration: limit is bounded between 1 and 24", async () => {
  const client = mockClient([]);
  await getForecastCalibration(client, context, 999);
  assert.ok(client.queries[0].values.includes(24));
  const client2 = mockClient([]);
  await getForecastCalibration(client2, context, -5);
  assert.ok(client2.queries[0].values.includes(1));
});
