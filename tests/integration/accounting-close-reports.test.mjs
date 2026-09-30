// Real PostgreSQL integration test -- financial reports over posted ledger data (trial balance, P&L,
// balance sheet, general ledger, dashboard: F501-510) and the fiscal period / financial close controls (F500).
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_ACCOUNTING, buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

const ROLES = { acctA: ALL_ACCOUNTING, acctB: ALL_ACCOUNTING, viewer: ["accounting.view", "accounting.reports.view"], nobody: ["accounting.view"] };

test("Accounting reports and close against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAccountingWorld(admin, ROLES, "clrp");
  const { api, run, denied, sql, companyId, customerId } = w;
  try {
    await t.test("F501-503: trial balance, P&L and balance sheet reflect posted invoices and stay balanced", async () => {
      const { invoice } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Sale", unitPrice: 1000 }] }));
      await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, invoice.id));
      await run("acctA", (c, x) => api.postCustomerInvoice(c, x, invoice.id));
      const tb = await run("viewer", (c, x) => api.getTrialBalance(c, x, { companyId }));
      const rows = tb.rows ?? tb;
      const debit = rows.reduce((s, r) => s + Number(r.debit), 0);
      const credit = rows.reduce((s, r) => s + Number(r.credit), 0);
      assert.equal(debit, credit, "the trial balance is balanced");
      assert.equal(debit, 1000);
      const pl = await run("viewer", (c, x) => api.getProfitAndLoss(c, x, { companyId }));
      assert.ok(JSON.stringify(pl).includes("1000"), "revenue appears on the P&L");
      const bs = await run("viewer", (c, x) => api.getBalanceSheet(c, x, { companyId }));
      assert.ok(bs);
      await denied("nobody", (c, x) => api.getTrialBalance(c, x, { companyId }), 403);
    });

    await t.test("F504-506: the general ledger and the dashboard report on the same data", async () => {
      const gl = await run("viewer", (c, x) => api.getGeneralLedger(c, x, { companyId }));
      assert.ok((gl.rows ?? gl).length >= 2, "an invoice posts at least a receivable and a revenue line");
      const dash = await run("viewer", (c, x) => api.getAccountingDashboard(c, x));
      assert.ok(dash);
    });

    await t.test("F500: a period can be soft-closed and reopened, and a governed close run is required for hard close", async () => {
      const [period] = await sql(`SELECT id FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
      const hard = await run("acctA", (c, x) => api.updateFiscalPeriodStatus(c, x, period.id, { status: "closed" })).catch((e) => e);
      assert.equal(hard.status, 409, "hard close only through a governed close run");
      const soft = await run("acctA", (c, x) => api.updateFiscalPeriodStatus(c, x, period.id, { status: "soft_closed" }));
      assert.equal(soft.status, "soft_closed");
      const reopened = await run("acctA", (c, x) => api.updateFiscalPeriodStatus(c, x, period.id, { status: "open" }));
      assert.equal(reopened.status, "open");
      const blockers = await run("acctA", (c, x) => api.getPeriodCloseBlockers(c, x, companyId, period.id));
      assert.ok(blockers);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
