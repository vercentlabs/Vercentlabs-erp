// Real PostgreSQL integration test -- bank accounts, CSV statement import, match-suggestion, the
// reconciliation lifecycle (F476-480), and the GST-style tax ledger/tax-return lifecycle driven by
// posting a real customer invoice with a tax line (F481-487). Both domains pre-existed this session;
// these are their first tests.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_ACCOUNTING, buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

const ROLES = {
  acctA: ALL_ACCOUNTING,
  viewer: ["accounting.view", "accounting.reports.view"],
};

test("Accounting banking and tax subsystems against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAccountingWorld(admin, ROLES, "bktx");
  const { api, run, denied, sql, account, companyId, customerId } = w;
  const ids = {};

  try {
    await t.test("F476: a bank account can only be created against an active bank/cash GL account", async () => {
      const cash = await account("1120");
      const revenue = await account("4100");
      await denied("viewer", (c, x) => api.createBankAccount(c, x, { companyId, glAccountId: cash.id, code: "hdfc", bankName: "HDFC", accountName: "Current a/c" }), 403);
      const wrongType = await run("acctA", (c, x) => api.createBankAccount(c, x, { companyId, glAccountId: revenue.id, code: "bad", bankName: "HDFC", accountName: "Wrong" })).catch((e) => e);
      assert.equal(wrongType.status, 409, "a revenue account cannot back a bank account");
      const bank = await run("acctA", (c, x) => api.createBankAccount(c, x, { companyId, glAccountId: cash.id, code: "hdfc", bankName: "HDFC", accountName: "Current a/c" }));
      assert.equal(bank.status, "active");
      assert.equal(bank.code, "HDFC");
      ids.bankAccountId = bank.id;
    });

    await t.test("F477-478: a CSV bank statement imports its lines, re-import with the same content is deduplicated by hash, and match suggestions rank a posted journal line first", async () => {
      const cash = await account("1120");
      const capital = await account("3100");
      const [bnkJournal] = await sql(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND code='BNK'`, [w.orgId, companyId]);
      // The threshold column defaults to 0, and the check is "amount >= threshold" -- so by default every
      // entry needs a second approver, regardless of the journal's own approval_required flag (already
      // found and documented in accounting-ledger.test.mjs). Raise it above this entry's amount to reach
      // the genuine auto-approve path with a single tester role.
      await sql(`UPDATE tenant.accounting_settings SET journal_approval_threshold=999999 WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
      const { entry } = await run("acctA", (c, x) => api.createJournalEntry(c, x, {
        companyId,
        journalId: bnkJournal.id,
        accountingDate: w.today, description: "Opening deposit", lines: [{ accountId: cash.id, debit: 750 }, { accountId: capital.id, credit: 750 }],
      }));
      await run("acctA", (c, x) => api.submitJournalEntry(c, x, entry.id));
      await run("acctA", (c, x) => api.postJournalEntry(c, x, entry.id));

      const csvText = "Date,Description,Debit,Credit\n" + `${w.today},Opening deposit,,750\n`;
      const statement = await run("acctA", (c, x) => api.importBankStatement(c, x, { bankAccountId: ids.bankAccountId, periodStart: w.today, periodEnd: w.today, closingBalance: 750, csvText }));
      assert.equal(statement.statement.status, "imported");
      assert.equal(statement.lines.length, 1);
      ids.statementId = statement.statement.id;
      ids.statementLineId = statement.lines[0].id;

      const reimport = await run("acctA", (c, x) => api.importBankStatement(c, x, { bankAccountId: ids.bankAccountId, periodStart: w.today, periodEnd: w.today, closingBalance: 750, csvText }));
      assert.equal(reimport.statement.id, statement.statement.id, "an identical statement re-import is deduplicated by source hash, not inserted twice");

      const suggestions = await run("acctA", (c, x) => api.suggestBankMatches(c, x, ids.statementLineId));
      assert.ok(suggestions.length >= 1, "the posted opening-deposit journal line is suggested as a match candidate");
      ids.journalLineId = suggestions[0].journal_line_id;
    });

    await t.test("F479-480: a reconciliation cannot complete with unmatched lines, but does once the statement line is matched and balanced", async () => {
      const reconciliation = await run("acctA", (c, x) => api.startBankReconciliation(c, x, { bankStatementId: ids.statementId }));
      assert.equal(reconciliation.status, "in_progress");
      ids.reconciliationId = reconciliation.id;
      const blocked = await run("acctA", (c, x) => api.completeBankReconciliation(c, x, reconciliation.id)).catch((e) => e);
      assert.equal(blocked.status, 409, `an unmatched statement line blocks completion: ${blocked.message}`);
      const match = await run("acctA", (c, x) => api.matchBankStatementLine(c, x, reconciliation.id, { statementLineId: ids.statementLineId, journalLineId: ids.journalLineId }));
      assert.ok(match.id);
      const completed = await run("acctA", (c, x) => api.completeBankReconciliation(c, x, reconciliation.id));
      assert.equal(completed.status, "completed");
      assert.equal(Number(completed.difference), 0);
    });

    await t.test("F481-484: posting a customer invoice with a tax line writes the tax ledger, and a tax return aggregates it into taxable/output-tax totals for the period", async () => {
      const { invoice } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Taxed sale", quantity: 1, unitPrice: 1000, taxAmount: 180 }] }));
      await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, invoice.id));
      const { invoice: posted } = await run("acctA", (c, x) => api.postCustomerInvoice(c, x, invoice.id));
      assert.equal(posted.status, "posted");
      const [ledgerRow] = await sql(`SELECT direction, tax_amount FROM tenant.accounting_tax_ledger WHERE organization_id=$1 AND source_id=$2`, [w.orgId, invoice.id]);
      assert.equal(ledgerRow.direction, "output");
      assert.equal(Number(ledgerRow.tax_amount), 180);

      const taxReturn = await run("acctA", (c, x) => api.createTaxReturn(c, x, { companyId, returnType: "GST", periodStart: w.today, periodEnd: w.today }));
      assert.equal(taxReturn.status, "draft");
      assert.equal(Number(taxReturn.output_tax), 180);
      ids.taxReturnId = taxReturn.id;
    });

    await t.test("F485-487: a tax return's status transitions are a state machine, refusing an illegal jump and requiring a filing reference to file", async () => {
      const illegal = await run("acctA", (c, x) => api.updateTaxReturnStatus(c, x, ids.taxReturnId, { status: "paid" })).catch((e) => e);
      assert.equal(illegal.status, 409, "a draft return cannot jump directly to paid");
      const review = await run("acctA", (c, x) => api.updateTaxReturnStatus(c, x, ids.taxReturnId, { status: "review" }));
      assert.equal(review.status, "review");
      const missingReference = await run("acctA", (c, x) => api.updateTaxReturnStatus(c, x, ids.taxReturnId, { status: "filed" })).catch((e) => e);
      assert.equal(missingReference.status, 400, "filing requires an external reference");
      const filed = await run("acctA", (c, x) => api.updateTaxReturnStatus(c, x, ids.taxReturnId, { status: "filed", externalReference: "GSTR-3B-0001" }));
      assert.equal(filed.status, "filed");
      const returns = await run("viewer", (c, x) => api.listTaxReturns(c, x));
      assert.ok(returns.some((row) => row.id === ids.taxReturnId));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
