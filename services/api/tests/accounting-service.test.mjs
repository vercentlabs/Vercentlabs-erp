import assert from "node:assert/strict";
import test from "node:test";
import { asDatabaseDecimal, decimal, div, mul, roundMoney } from "../src/accounting/money.js";
import { allocateInstallments } from "../src/accounting/schedules.js";
import { ACCOUNTING_REPORT_KEYS } from "@vercentlabs/shared-types";
import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";

test("accounting decimal arithmetic is deterministic", () => {
  assert.equal(asDatabaseDecimal(decimal("0.1") + decimal("0.2")), "0.300000");
  assert.equal(asDatabaseDecimal(mul("125.50", "1.18")), "148.090000");
  assert.equal(asDatabaseDecimal(div("100", "3")), "33.333333");
  assert.equal(asDatabaseDecimal(decimal("1.2345675")), "1.234568");
  assert.equal(asDatabaseDecimal(decimal("-1.2345675")), "-1.234568");
});

test("accounting rounds by currency precision without floating point", () => {
  assert.equal(asDatabaseDecimal(roundMoney("10.555", 2)), "10.560000");
  assert.equal(asDatabaseDecimal(roundMoney("-10.555", 2)), "-10.560000");
  assert.equal(asDatabaseDecimal(roundMoney("10.555", 0)), "11.000000");
});

test("payment terms allocate exact document totals", () => {
  const rows = allocateInstallments("100.00", [
    { sequence: 1, due_days: 0, percentage: "33.33" },
    { sequence: 2, due_days: 30, percentage: "33.33" },
    { sequence: 3, due_days: 60, percentage: "33.34" },
  ], 2);
  assert.deepEqual(rows.map((row) => asDatabaseDecimal(row.amount)), ["33.330000", "33.330000", "33.340000"]);
  assert.equal(asDatabaseDecimal(rows.reduce((total, row) => total + row.amount, 0n)), "100.000000");
});

test("accounting contracts expose financial reports and governed permissions", () => {
  for (const report of ["trial-balance", "profit-and-loss", "balance-sheet", "cash-flow", "cash-flow-forecast", "subledger-reconciliation"]) assert.ok(ACCOUNTING_REPORT_KEYS.includes(report));
  assert.equal(ACCOUNTING_PERMISSIONS.journalPost, "accounting.journal.post");
  assert.equal(ACCOUNTING_PERMISSIONS.receivablesApprove, "accounting.receivables.approve");
  assert.equal(ACCOUNTING_PERMISSIONS.payablesApprove, "accounting.payables.approve");
  assert.equal(ACCOUNTING_PERMISSIONS.paymentsApprove, "accounting.payments.approve");
  assert.equal(ACCOUNTING_PERMISSIONS.consolidationManage, "accounting.consolidation.manage");
});

import { importProcurementMatchAsVendorBill } from "../src/accounting/payables.js";

test("Procurement matches cannot enter payables without Accounting permission", async () => {
  let queried = false;
  const client = { query: async () => { queried = true; return { rows: [] }; } };
  await assert.rejects(
    importProcurementMatchAsVendorBill(
      client,
      { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", permissions: [], roleSlugs: [] },
      "33333333-3333-4333-8333-333333333333",
      {},
    ),
    /permission/i,
  );
  assert.equal(queried, false);
});

test("Procurement match exceptions cannot create vendor bills", async () => {
  const client = {
    query: async () => ({
      rows: [{
        id: "33333333-3333-4333-8333-333333333333",
        status: "exception",
        data: {},
      }],
    }),
  };
  await assert.rejects(
    importProcurementMatchAsVendorBill(
      client,
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        permissions: [ACCOUNTING_PERMISSIONS.payablesManage],
        roleSlugs: [],
      },
      "33333333-3333-4333-8333-333333333333",
      {},
    ),
    /Resolve the Procurement matching exception/,
  );
});
