import assert from "node:assert/strict";
import test from "node:test";
import { asDatabaseDecimal, decimal, div, mul, roundMoney } from "../src/modules/accounting/money.js";
import { allocateInstallments } from "../src/modules/accounting/schedules.js";
import { AccountingError, hashPayload, isoDate } from "../src/modules/accounting/core.js";
import { ACCOUNTING_REPORT_KEYS } from "@vercentlabs/shared-types";
import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";

// Regression for a real production defect found via a browser E2E run
// (tests/e2e/erp-procurement-source-to-pay-journey.spec.ts): postVendorBill
// re-feeds a date it just read back from the database (bill.accounting_date)
// into isoDate() via createJournalEntry. node-postgres returns DATE columns
// as real JS Date objects, not strings, and every existing test used a fake
// DB client that only ever returns the string it was told to -- so nothing
// caught String(new Date(...)) failing the "YYYY-MM-DD" regex until a real
// Postgres round-trip did.
test("isoDate accepts a real Date object the way a pg row returns a DATE column", () => {
  assert.equal(isoDate(new Date("2026-12-10T00:00:00.000Z")), "2026-12-10");
});

test("isoDate still accepts a plain ISO date string", () => {
  assert.equal(isoDate("2026-12-10"), "2026-12-10");
});

test("isoDate still rejects genuinely invalid input", () => {
  assert.throws(() => isoDate("not-a-date"), AccountingError);
  assert.throws(() => isoDate(""), AccountingError);
});

// Regression for a real production defect found via the same browser E2E
// run: createJournalEntry's contentHash computation hashes normalizeLines()'s
// output, which carries several BigInt fields (debit, credit, baseDebit,
// baseCredit, taxBaseAmount, dimension allocationPercent) -- hashPayload's
// stable-stringify fell through to a raw JSON.stringify(bigint), which
// throws for ANY BigInt including 0n. Posting a real vendor bill (or any
// other document that creates a journal entry) always crashed.
test("hashPayload hashes BigInt values instead of crashing on them", () => {
  assert.doesNotThrow(() => hashPayload({ debit: 0n, credit: 100n }));
  assert.equal(hashPayload({ amount: 0n }), hashPayload({ amount: 0n }));
  assert.notEqual(hashPayload({ amount: 0n }), hashPayload({ amount: 1n }));
  assert.notEqual(hashPayload({ amount: 100n }), hashPayload({ amount: "100" }));
});

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

import { importProcurementMatchAsVendorBill } from "../src/modules/accounting/payables.js";

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
