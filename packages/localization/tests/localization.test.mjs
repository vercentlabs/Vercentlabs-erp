import assert from "node:assert/strict";
import test from "node:test";
import { fiscalYearFor, formatMoney, normalizeCurrency } from "../src/index.js";

test("currency formatting is organization-configurable", () => {
  assert.match(formatMoney(1250, { currency: "USD", locale: "en-US" }), /1,250/);
  assert.equal(normalizeCurrency("inr"), "INR");
});

test("Indian fiscal years start in April by default", () => {
  assert.deepEqual(fiscalYearFor(new Date("2026-03-01T00:00:00Z")), { startYear: 2025, endYear: 2026, label: "2025-26" });
});
