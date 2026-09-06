import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const route = read("src/app/api/sales/orders/[id]/actions/route.ts");

test("F042: order confirm/cancel actions route through the CRM-syncing wrappers, not the raw functions", () => {
  assert.match(route, /confirmSalesOrderWithCrmSync/);
  assert.match(route, /cancelSalesOrderWithCrmSync/);
  assert.doesNotMatch(route, /confirmSalesOrder\(/);
  assert.doesNotMatch(route, /cancelSalesOrder\(/);
});
