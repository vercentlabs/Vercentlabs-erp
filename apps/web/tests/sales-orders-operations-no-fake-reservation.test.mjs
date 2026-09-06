import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ordersOperationsRoute = read(
  "src/app/api/sales/orders/operations/route.ts",
);
const pass1OperationsRoute = read("src/app/api/sales/pass1-operations/route.ts");

test("F046: sales orders/operations no longer exposes a bare reserve_lines action (fake, non-Stock-integrated reservation)", () => {
  assert.doesNotMatch(ordersOperationsRoute, /reserve_lines/);
  assert.doesNotMatch(ordersOperationsRoute, /reserveSalesOrderLines/);
});

test("F046: the only reservation entry point left is pass1-operations' Stock-integrated reserve-stock action", () => {
  assert.match(pass1OperationsRoute, /reserve-stock/);
  assert.match(pass1OperationsRoute, /reserveSalesOrderLineFromStock/);
});
