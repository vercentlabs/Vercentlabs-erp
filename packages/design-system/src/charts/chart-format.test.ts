import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chartSeriesColor,
  chartStateColor,
  formatCompactNumber,
  formatShare,
  isChartEmpty,
  niceTicks,
  toChartNumber,
  truncateLabel,
} from "./chart-format.ts";

test("numeric aggregates delivered as strings plot as numbers; junk plots as 0", () => {
  assert.equal(toChartNumber("250000.00"), 250000);
  assert.equal(toChartNumber(12), 12);
  assert.equal(toChartNumber(null), 0);
  assert.equal(toChartNumber("not a number"), 0);
});

test("compact numbers keep small values exact and shorten large ones", () => {
  assert.equal(formatCompactNumber(12), "12");
  assert.equal(formatCompactNumber(999), "999");
  assert.equal(formatCompactNumber(1500, "en-US"), "1.5K");
  assert.equal(formatCompactNumber(2_500_000, "en-US"), "2.5M");
});

test("shares round to whole percentages and never hide a small non-zero share", () => {
  assert.equal(formatShare(1, 3), "33%");
  assert.equal(formatShare(1, 400), "<1%");
  assert.equal(formatShare(0, 10), "0%");
  assert.equal(formatShare(5, 0), "0%");
});

test("a chart whose every value is zero counts as empty, so it shows its empty message", () => {
  assert.equal(isChartEmpty([], ["value"]), true);
  assert.equal(isChartEmpty([{ value: 0, other: "0" }], ["value", "other"]), true);
  assert.equal(isChartEmpty([{ value: 0, other: "3" }], ["value", "other"]), false);
});

test("long axis labels are shortened with an ellipsis, short ones untouched", () => {
  assert.equal(truncateLabel("Proposal", 12), "Proposal");
  assert.equal(truncateLabel("Negotiation and review", 12), "Negotiation…");
});

test("chart colours come only from design-token CSS variables, never raw hex", () => {
  for (const value of [...Object.values(chartSeriesColor), ...Object.values(chartStateColor)])
    assert.match(value, /^var\(--color-chart-[a-z0-9-]+\)$/);
});

test("value axes use round steps from zero that cover the largest value", () => {
  assert.deepEqual(niceTicks(250000), [0, 100000, 200000, 300000]);
  assert.deepEqual(niceTicks(260000), [0, 100000, 200000, 300000]);
  assert.deepEqual(niceTicks(95), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(3, 4, true), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(7, 4, true), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(0), [0, 1]);
});
