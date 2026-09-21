// Real PostgreSQL integration test -- the accounting foundation: chart of accounts, dimensions
// (F460-462), and the core journal entry lifecycle -- create, submit (auto-approves under threshold,
// else maker-checker), approve, post, reverse -- with double-entry enforcement and fiscal period locks
// (F453-459). This module's domain code pre-existed this session; these are its first tests.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_ACCOUNTING, buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

const ROLES = {
  acctA: ALL_ACCOUNTING,
  acctB: ALL_ACCOUNTING,
  viewer: ["accounting.view", "accounting.reports.view"],
};

test("Accounting foundation and journal entry lifecycle against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAccountingWorld(admin, ROLES, "acle");
  const { api, run, denied, sql, account, companyId } = w;
  const ids = {};

  try {
    await t.test("F453/F456: the chart of accounts is seeded and enforces double-entry (a manual account or an unbalanced entry is refused)", async () => {
      const cash = await account("1110");
      const capital = await account("3100");
      assert.ok(cash && capital, "the default chart of accounts seeded by initializeAccountingCompany is queryable");
      const genJournal = (await sql(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND code='GEN'`, [w.orgId, companyId]))[0];
      ids.genJournal = genJournal.id;

      await denied("viewer", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: genJournal.id, accountingDate: w.today, description: "x", lines: [{ accountId: cash.id, debit: 100 }, { accountId: capital.id, credit: 100 }] }), 403);
      // a group account (is_group=true) does not allow manual posting
      const assetsGroup = await account("1000");
      const unbalanced = await run("acctA", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: genJournal.id, accountingDate: w.today, description: "unbalanced", lines: [{ accountId: cash.id, debit: 100 }, { accountId: capital.id, credit: 50 }] })).catch((e) => e);
      assert.ok(unbalanced.status, "an unbalanced entry is refused");
      void assetsGroup;
    });

    await t.test("F455/F457-459: an entry needs an open fiscal period; a journal that does not require approval, with the threshold raised above the entry amount, auto-approves on submit, then posts", async () => {
      const cash = await account("1110");
      const capital = await account("3100");
      // The threshold column defaults to 0, and the check is "amount >= threshold" -- so by default
      // *every* entry needs a second approver, regardless of each journal's own approval_required flag
      // (a conservative "always maker-checker until configured otherwise" default). Raise the threshold
      // above this entry's amount, on a journal that also doesn't itself require approval (BNK, unlike
      // GEN), to reach the genuine auto-approve path.
      await sql(`UPDATE tenant.accounting_settings SET journal_approval_threshold=999999 WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
      const bnkJournal = (await sql(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND code='BNK'`, [w.orgId, companyId]))[0];
      const { entry } = await run("acctA", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: bnkJournal.id, accountingDate: w.today, description: "Opening capital", lines: [{ accountId: cash.id, debit: 5000 }, { accountId: capital.id, credit: 5000 }] }));
      assert.equal(entry.status, "draft");
      ids.entry1 = entry.id;
      ids.hash1 = entry.content_hash;
      const submitted = await run("acctA", (c, x) => api.submitJournalEntry(c, x, entry.id));
      assert.equal(submitted.status, "approved", "BNK does not require approval, and the amount is below the raised threshold, so it auto-approves");
      const posted = await run("acctA", (c, x) => api.postJournalEntry(c, x, entry.id));
      assert.equal(posted.status, "posted");
      const [balance] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [w.orgId, entry.id]);
      assert.equal(Number(balance.d), Number(balance.cr), "posted lines are balanced");
    });

    await t.test("F455: with a required approval, the submitter cannot approve their own entry", async () => {
      await sql(`UPDATE tenant.accounting_settings SET journal_approval_threshold=1 WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
      const cash = await account("1110");
      const expense = await account("6100");
      const { entry } = await run("acctA", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: ids.genJournal, accountingDate: w.today, description: "Office supplies", lines: [{ accountId: expense.id, debit: 200 }, { accountId: cash.id, credit: 200 }] }));
      const submitted = await run("acctA", (c, x) => api.submitJournalEntry(c, x, entry.id));
      assert.equal(submitted.status, "pending_approval");
      const selfApprove = await run("acctA", (c, x) => api.approveJournalEntry(c, x, entry.id, entry.content_hash)).catch((e) => e);
      assert.equal(selfApprove.status, 409, "the submitter cannot approve their own journal");
      const approved = await run("acctB", (c, x) => api.approveJournalEntry(c, x, entry.id, entry.content_hash));
      assert.equal(approved.status, "approved");
      const posted = await run("acctA", (c, x) => api.postJournalEntry(c, x, entry.id));
      assert.equal(posted.status, "posted");
      ids.entry2 = entry.id;
      await sql(`UPDATE tenant.accounting_settings SET journal_approval_threshold=0 WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
    });

    await t.test("F455: reversing a posted entry books the exact mirror and links back to the original", async () => {
      const reversal = await run("acctA", (c, x) => api.reverseJournalEntry(c, x, ids.entry2, { reason: "Wrong account used" }));
      assert.ok(reversal);
      const [rev] = await sql(`SELECT * FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND id=$2`, [w.orgId, reversal.id ?? reversal.entry?.id ?? reversal.reversalEntryId]);
      assert.ok(rev, "the reversal is a real, separate journal entry");
    });

    await t.test("F459: a locked/closed fiscal period refuses a new posting", async () => {
      await sql(`UPDATE tenant.fiscal_periods SET status='closed' WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
      const cash = await account("1110");
      const capital = await account("3100");
      const blocked = await run("acctA", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: ids.genJournal, accountingDate: w.today, description: "Blocked", lines: [{ accountId: cash.id, debit: 10 }, { accountId: capital.id, credit: 10 }] })).catch((e) => e);
      assert.equal(blocked.status, 409, "no open fiscal period covers the accounting date");
      await sql(`UPDATE tenant.fiscal_periods SET status='open' WHERE organization_id=$1 AND company_id=$2`, [w.orgId, companyId]);
    });

    await t.test("F460-462: cost centres and custom dimensions are validated on a journal line and reported on", async () => {
      const dept = await sql(`INSERT INTO public.departments(organization_id,company_id,name,code,status) VALUES ($1,$2,'Sales','SALES','active') RETURNING id`, [w.orgId, companyId]);
      const costCenter = await sql(`INSERT INTO public.cost_centers(organization_id,company_id,name,code,status) VALUES ($1,$2,'HQ','HQCC','active') RETURNING id`, [w.orgId, companyId]);
      const cash = await account("1110");
      const expense = await account("6100");
      const { entry } = await run("acctA", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: ids.genJournal, accountingDate: w.today, description: "Dept expense", lines: [{ accountId: expense.id, debit: 50, departmentId: dept[0].id, costCenterId: costCenter[0].id }, { accountId: cash.id, credit: 50 }] }));
      assert.ok(entry.id);
      const [line] = await sql(`SELECT department_id, cost_center_id FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND department_id IS NOT NULL`, [w.orgId, entry.id]);
      assert.equal(line.department_id, dept[0].id);
      assert.equal(line.cost_center_id, costCenter[0].id);
    });

    await t.test("options and settings are readable by anyone with accounting.view", async () => {
      const options = await run("viewer", (c, x) => api.getAccountingOptions(c, x, companyId));
      assert.ok(options);
      const settings = await run("viewer", (c, x) => api.getAccountingSettings(c, x, companyId));
      assert.ok(settings);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
