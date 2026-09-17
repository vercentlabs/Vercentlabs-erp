import { test } from "node:test";
import assert from "node:assert/strict";

import { money, toNumber } from "./format.ts";

// Stage A2 §17 numeric-contract sweep. node-postgres returns NUMERIC/
// DECIMAL columns as strings, not numbers. money()/toNumber() are the one
// coercion boundary every dashboard/quota/forecast/report screen in this
// module relies on — this file had no test of its own despite being the
// single point of failure for the exact bug class documented in
// format.ts's own comment: `0 + "5000.00"` is JavaScript STRING
// concatenation, not addition, once a value is a numeric-column string.
test("toNumber coerces a numeric-column string the same way pg would hand it back", () => {
  assert.equal(toNumber("5000.00"), 5000);
  assert.equal(toNumber("0"), 0);
  assert.equal(toNumber(5000), 5000);
});

test("toNumber fails closed (0) for null/undefined/non-numeric, never NaN or a string", () => {
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber("not-a-number"), 0);
});

test("regression: summing two numeric-column strings with toNumber produces real addition, not string concatenation", () => {
  // This is the exact bug class the comment in format.ts documents as a
  // real, live defect once found on the Pipeline board: `0 + "5000.00"`
  // silently becomes the STRING "05000.00", not the number 5000, because
  // string + string (or number + string) is concatenation in JS. Without
  // toNumber(), a reduce() over a page of quota/forecast/opportunity rows
  // whose amount columns are ::numeric would silently corrupt the total
  // instead of summing it.
  const rows = [{ amount: "5000.00" }, { amount: "3000.00" }, { amount: "1250.50" }];
  const total = rows.reduce((sum, row) => sum + toNumber(row.amount), 0);
  assert.equal(total, 9250.5);
  assert.notEqual(String(total), "05000.003000.001250.50");
});

test("money() renders a numeric-column string with locale grouping, not the raw unformatted string", () => {
  // toLocaleString()'s grouping is locale-dependent (en-IN groups as
  // 12,34,567.89; en-US as 1,234,567.89) — assert the coercion happened
  // (a comma appears, the raw ungrouped string does not) rather than one
  // locale's exact separator placement.
  const formatted = money("INR", "1234567.89");
  assert.match(formatted, /^INR /);
  assert.match(formatted, /,/);
  assert.doesNotMatch(formatted, /1234567\.89/);
  assert.equal(money(null, "1000"), (1000).toLocaleString());
});

test("money() does not crash on a genuinely non-numeric value, and does not silently zero it either", () => {
  assert.equal(money("USD", "not-a-number" as unknown as string), "USD not-a-number");
});
