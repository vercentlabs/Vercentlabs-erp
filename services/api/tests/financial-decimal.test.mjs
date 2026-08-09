import assert from "node:assert/strict";
import test from "node:test";

import {
  allocate,
  asDatabaseDecimal,
  decimal,
  div,
  format,
  mul,
  roundMoney,
} from "../src/financial-decimal.js";

test("financial decimals round positive and negative multiplication symmetrically", () => {
  assert.equal(asDatabaseDecimal(mul("1", "0.5")), "0.500000");
  assert.equal(asDatabaseDecimal(mul("-1", "0.5")), "-0.500000");
  assert.equal(asDatabaseDecimal(mul("10.555", "1")), "10.555000");
  assert.equal(asDatabaseDecimal(mul("-10.555", "1")), "-10.555000");
});

test("financial decimals round positive and negative division symmetrically", () => {
  assert.equal(asDatabaseDecimal(div("1", "2")), "0.500000");
  assert.equal(asDatabaseDecimal(div("-1", "2")), "-0.500000");
  assert.equal(asDatabaseDecimal(div("1", "-2")), "-0.500000");
});

test("decimal parsing rounds the seventh decimal digit away from zero", () => {
  assert.equal(asDatabaseDecimal(decimal("1.0000005")), "1.000001");
  assert.equal(asDatabaseDecimal(decimal("-1.0000005")), "-1.000001");
});

test("money formatting and allocation preserve totals", () => {
  assert.equal(format(roundMoney("10.555", 2), 2), "10.56");
  const parts = allocate("10.00", [1, 1, 1]);
  assert.equal(parts.reduce((sum, value) => sum + value, 0n), decimal("10.00"));
});
