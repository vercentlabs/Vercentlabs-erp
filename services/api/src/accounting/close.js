import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  decimal,
  event,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  requirePermission,
  text,
  uuid,
} from "./core.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";

const DEFAULT_TASKS = [
  [10, "subledgers", "Reconcile receivables and payables"],
  [20, "bank", "Complete bank reconciliations"],
  [30, "tax", "Review tax ledger and statutory balances"],
  [40, "accruals", "Post accruals, deferrals and recurring journals"],
  [50, "fx", "Run foreign-currency revaluation"],
  [60, "review", "Review trial balance and exceptions"],
  [70, "lock", "Approve and lock the accounting period"],
];

export async function listFiscalPeriods(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND period.company_id=$${values.length}`; }
  if (filters.companyId) { values.push(uuid(filters.companyId, "Company")); where += ` AND period.company_id=$${values.length}`; }
  const result = await client.query(`SELECT period.*,company.name AS company_name FROM tenant.fiscal_periods period JOIN public.companies company ON company.id=period.company_id WHERE period.organization_id=$1${where} ORDER BY period.start_date DESC`, values);
  return result.rows;
}

async function periodBlockers(client, context, companyId, period) {
  const parameters = [context.organizationId, companyId, period.start_date, period.end_date];
  const result = await client.query(
    `SELECT
      (SELECT count(*) FROM tenant.accounting_journal_entries entry
        WHERE entry.organization_id=$1 AND entry.company_id=$2 AND entry.accounting_date BETWEEN $3 AND $4
          AND entry.status IN ('draft','pending_approval','approved'))::int AS unposted_journals,
      (SELECT count(*) FROM tenant.accounting_reconciliations reconciliation
        WHERE reconciliation.organization_id=$1 AND reconciliation.company_id=$2
          AND reconciliation.reconciliation_date BETWEEN $3 AND $4
          AND reconciliation.status IN ('in_progress','reopened'))::int AS open_bank_reconciliations,
      (SELECT count(*) FROM tenant.accounting_bank_statement_lines line
        JOIN tenant.accounting_bank_statements statement ON statement.id=line.bank_statement_id
        WHERE line.organization_id=$1 AND statement.company_id=$2 AND statement.period_end BETWEEN $3 AND $4
          AND line.match_status NOT IN ('matched','ignored'))::int AS unreconciled_bank_lines,
      (SELECT count(*) FROM tenant.accounting_customer_invoices invoice
        WHERE invoice.organization_id=$1 AND invoice.company_id=$2 AND invoice.accounting_date BETWEEN $3 AND $4
          AND invoice.status IN ('draft','pending_approval','approved'))::int AS unposted_customer_documents,
      (SELECT count(*) FROM tenant.accounting_vendor_bills bill
        WHERE bill.organization_id=$1 AND bill.company_id=$2 AND bill.accounting_date BETWEEN $3 AND $4
          AND bill.status IN ('draft','pending_approval','approved'))::int AS unposted_vendor_documents,
      (SELECT count(*) FROM tenant.accounting_vendor_payments payment
        WHERE payment.organization_id=$1 AND payment.company_id=$2 AND payment.accounting_date BETWEEN $3 AND $4
          AND payment.status IN ('draft','pending_approval','approved'))::int AS unposted_vendor_payments,
      (SELECT count(*) FROM tenant.accounting_vendor_bill_matches match
        JOIN tenant.accounting_vendor_bills bill ON bill.id=match.vendor_bill_id
        WHERE match.organization_id=$1 AND bill.company_id=$2 AND bill.accounting_date BETWEEN $3 AND $4
          AND match.status='exception')::int AS matching_exceptions,
      (SELECT count(*) FROM tenant.sales_invoice_requests request
        JOIN tenant.sales_orders sales_order ON sales_order.id=request.sales_order_id
        WHERE request.organization_id=$1 AND sales_order.company_id=$2
          AND request.requested_at::date BETWEEN $3 AND $4 AND request.status='failed')::int AS failed_sales_invoice_requests,
      (SELECT count(*) FROM tenant.accounting_compliance_requests request
        WHERE request.organization_id=$1 AND request.company_id=$2
          AND request.requested_at::date BETWEEN $3 AND $4 AND request.status='failed')::int AS failed_compliance_requests,
      (SELECT count(*) FROM tenant.accounting_recurring_executions execution
        JOIN tenant.accounting_recurring_templates template ON template.id=execution.template_id
        WHERE execution.organization_id=$1 AND template.company_id=$2
          AND execution.scheduled_date BETWEEN $3 AND $4 AND execution.status='failed')::int AS failed_recurring_executions,
      (SELECT count(*) FROM tenant.accounting_accrual_recognitions recognition
        JOIN tenant.accounting_accrual_schedules schedule ON schedule.id=recognition.schedule_id
        WHERE recognition.organization_id=$1 AND schedule.company_id=$2
          AND recognition.recognition_date BETWEEN $3 AND $4 AND recognition.status='planned')::int AS unposted_accrual_recognitions,
      (SELECT count(*) FROM tenant.accounting_revaluation_runs run
        WHERE run.organization_id=$1 AND run.company_id=$2 AND run.valuation_date BETWEEN $3 AND $4
          AND run.status IN ('draft','calculated'))::int AS unposted_revaluations,
      (SELECT count(*) FROM tenant.accounting_tax_returns tax_return
        WHERE tax_return.organization_id=$1 AND tax_return.company_id=$2
          AND tax_return.period_end BETWEEN $3 AND $4 AND tax_return.status IN ('draft','review'))::int AS unfinished_tax_returns`,
    parameters,
  );
  const counts = result.rows[0] || {};
  return Object.entries(counts)
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key, value]) => ({ key, count: Number(value), message: `${String(key).replaceAll("_", " ")}: ${value}` }));
}

export async function getPeriodCloseBlockers(client, context, companyIdValue, periodIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const company = await loadCompany(client, context, companyIdValue || context.activeCompanyId);
  const periodId = uuid(periodIdValue, "Fiscal period");
  const periodResult = await client.query(`SELECT * FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [context.organizationId, company.id, periodId]);
  if (!periodResult.rows[0]) throw new AccountingError(404, "Fiscal period was not found for this company.");
  return periodBlockers(client, context, company.id, periodResult.rows[0]);
}

export async function updateFiscalPeriodStatus(client, context, idValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.periodManage);
  const id = uuid(idValue, "Fiscal period");
  const result = await client.query(`SELECT * FROM tenant.fiscal_periods WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const period = result.rows[0];
  if (!period) throw new AccountingError(404, "Fiscal period not found.");
  const status = String(input.status || "");
  if (!["open","soft_closed","closed","locked"].includes(status)) throw new AccountingError(400, "Fiscal period status is invalid.");
  if (period.status === "locked" && status !== "locked") throw new AccountingError(409, "A locked period can only be reopened through a governed close run.");
  if (status === "closed" || status === "locked") {
    const blockers = await periodBlockers(client, context, period.company_id, period);
    if (blockers.length) throw new AccountingError(409, `The period has ${blockers.length} unresolved close blocker categories: ${blockers.map((blocker) => blocker.message).join("; ")}.`);
  }
  const updated = await client.query(`UPDATE tenant.fiscal_periods SET status=$3,soft_closed_at=CASE WHEN $3='soft_closed' THEN now() ELSE soft_closed_at END,soft_closed_by=CASE WHEN $3='soft_closed' THEN $4 ELSE soft_closed_by END,locked_at=CASE WHEN $3='locked' THEN now() ELSE locked_at END,locked_by=CASE WHEN $3='locked' THEN $4 ELSE locked_by END,close_note=$5 WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, status, context.userId, text(input.note, 1000) || null]);
  return updated.rows[0];
}

export async function createCloseRun(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const periodId = uuid(input.fiscalPeriodId, "Fiscal period");
  const period = await client.query(`SELECT * FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [context.organizationId, company.id, periodId]);
  if (!period.rows[0]) throw new AccountingError(404, "Fiscal period was not found for this company.");
  const runNumber = await allocateNumber(client, context.organizationId, "accounting_close_run");
  const closeType = ["month","quarter","year","soft","hard"].includes(input.closeType) ? input.closeType : "month";
  const result = await client.query(`INSERT INTO tenant.accounting_close_runs (organization_id,company_id,ledger_id,fiscal_period_id,run_number,close_type,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'planned',now()) RETURNING *`, [context.organizationId, company.id, ledger.id, periodId, runNumber, closeType]);
  for (const [sequence, taskKey, name] of DEFAULT_TASKS) {
    await client.query(`INSERT INTO tenant.accounting_close_tasks (organization_id,close_run_id,sequence,task_key,name,blocking,status) VALUES ($1,$2,$3,$4,$5,true,'pending')`, [context.organizationId, result.rows[0].id, sequence, taskKey, name]);
  }
  await event(client, context, "close_run", result.rows[0].id, "accounting.close.created", null, "planned", { runNumber });
  return getCloseRun(client, context, result.rows[0].id);
}

export async function listCloseRuns(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where = ` AND run.company_id=$2`; }
  const result = await client.query(`SELECT run.*,period.name AS period_name,company.name AS company_name FROM tenant.accounting_close_runs run JOIN tenant.fiscal_periods period ON period.id=run.fiscal_period_id JOIN public.companies company ON company.id=run.company_id WHERE run.organization_id=$1${where} ORDER BY run.created_at DESC`, values);
  return result.rows;
}

export async function getCloseRun(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Close run");
  const run = await client.query(`SELECT run.*,period.name AS period_name,period.start_date AS period_start_date,period.end_date AS period_end_date,period.status AS period_status,company.name AS company_name FROM tenant.accounting_close_runs run JOIN tenant.fiscal_periods period ON period.id=run.fiscal_period_id JOIN public.companies company ON company.id=run.company_id WHERE run.organization_id=$1 AND run.id=$2`, [context.organizationId, id]);
  if (!run.rows[0]) throw new AccountingError(404, "Close run not found.");
  const tasks = await client.query(`SELECT * FROM tenant.accounting_close_tasks WHERE organization_id=$1 AND close_run_id=$2 ORDER BY sequence`, [context.organizationId, id]);
  const blockers = await periodBlockers(client, context, run.rows[0].company_id, { start_date: run.rows[0].period_start_date, end_date: run.rows[0].period_end_date });
  return { run: run.rows[0], tasks: tasks.rows, blockers };
}

export async function updateCloseTask(client, context, runIdValue, taskIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const runId = uuid(runIdValue, "Close run"); const taskId = uuid(taskIdValue, "Close task");
  const status = String(input.status || "");
  if (!["pending","in_progress","completed","waived","blocked"].includes(status)) throw new AccountingError(400, "Close task status is invalid.");
  const result = await client.query(`UPDATE tenant.accounting_close_tasks SET status=$4,note=$5,evidence=$6::jsonb,completed_at=CASE WHEN $4 IN ('completed','waived') THEN now() ELSE NULL END,completed_by=CASE WHEN $4 IN ('completed','waived') THEN $7 ELSE NULL END WHERE organization_id=$1 AND close_run_id=$2 AND id=$3 RETURNING *`, [context.organizationId, runId, taskId, status, text(input.note, 1000) || null, JSON.stringify(input.evidence && typeof input.evidence === "object" ? input.evidence : {}), context.userId]);
  if (!result.rows[0]) throw new AccountingError(404, "Close task not found.");
  const totals = await client.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status IN ('completed','waived'))::int AS completed,count(*) FILTER (WHERE status='blocked')::int AS blocked FROM tenant.accounting_close_tasks WHERE organization_id=$1 AND close_run_id=$2`, [context.organizationId, runId]);
  const summary = totals.rows[0];
  const percent = Number(summary.total) ? (Number(summary.completed) / Number(summary.total)) * 100 : 0;
  await client.query(`UPDATE tenant.accounting_close_runs SET completion_percent=$3,status=CASE WHEN $4::int>0 THEN 'blocked' WHEN $3>0 THEN 'in_progress' ELSE status END,started_at=COALESCE(started_at,now()),started_by=COALESCE(started_by,$5) WHERE organization_id=$1 AND id=$2`, [context.organizationId, runId, percent.toFixed(2), Number(summary.blocked), context.userId]);
  return getCloseRun(client, context, runId);
}

async function postYearEndClosingJournal(client, context, detail) {
  const existing = await client.query(`SELECT id,entry_number,status FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND source_module='accounting' AND source_type='year_end_close' AND source_id=$2 AND entry_type='closing'`, [context.organizationId, detail.run.id]);
  if (existing.rows[0]) return existing.rows[0];
  const balances = await client.query(
    `SELECT account.id,account.code,account.name,account.account_class,
      COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0) AS debit_balance
     FROM tenant.accounting_accounts account
     JOIN tenant.accounting_journal_lines line ON line.organization_id=account.organization_id AND line.account_id=account.id
     JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
     WHERE account.organization_id=$1 AND account.company_id=$2 AND account.ledger_id=$3
       AND account.account_class IN ('revenue','expense') AND entry.status='posted'
       AND entry.accounting_date BETWEEN $4 AND $5
       AND NOT (entry.source_type='year_end_close' AND entry.entry_type='closing')
     GROUP BY account.id,account.code,account.name,account.account_class
     HAVING COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0)<>0
     ORDER BY account.code`,
    [context.organizationId, detail.run.company_id, detail.run.ledger_id, detail.run.period_start_date, detail.run.period_end_date],
  );
  if (!balances.rows.length) return null;
  const setup = await client.query(`SELECT retained_earnings_account_id FROM tenant.accounting_settings WHERE organization_id=$1 AND company_id=$2`, [context.organizationId, detail.run.company_id]);
  const retainedAccountId = setup.rows[0]?.retained_earnings_account_id;
  if (!retainedAccountId) throw new AccountingError(409, "Retained earnings account is not configured.");
  const journal = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='closing' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, detail.run.company_id, detail.run.ledger_id]);
  if (!journal.rows[0]) throw new AccountingError(409, "Closing journal is not configured.");
  const lines = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const account of balances.rows) {
    const debitBalance = decimal(account.debit_balance);
    const amount = debitBalance < 0n ? -debitBalance : debitBalance;
    if (debitBalance > 0n) {
      lines.push({ accountId: account.id, credit: asDatabaseDecimal(amount), debit: 0, description: `Close ${account.code} ${account.name}` });
      totalCredit += amount;
    } else {
      lines.push({ accountId: account.id, debit: asDatabaseDecimal(amount), credit: 0, description: `Close ${account.code} ${account.name}` });
      totalDebit += amount;
    }
  }
  const difference = totalDebit - totalCredit;
  if (difference > 0n) lines.push({ accountId: retainedAccountId, credit: asDatabaseDecimal(difference), debit: 0, description: "Transfer annual profit or loss to retained earnings" });
  else if (difference < 0n) lines.push({ accountId: retainedAccountId, debit: asDatabaseDecimal(-difference), credit: 0, description: "Transfer annual profit or loss to retained earnings" });
  if (lines.length < 2) return null;
  const created = await createJournalEntry(client, context, {
    companyId: detail.run.company_id,
    ledgerId: detail.run.ledger_id,
    journalId: journal.rows[0].id,
    entryDate: detail.run.period_end_date,
    accountingDate: detail.run.period_end_date,
    entryType: "closing",
    reference: detail.run.run_number,
    description: `Year-end closing ${detail.run.run_number}`,
    lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "year_end_close", sourceId: detail.run.id, sourceNumber: detail.run.run_number });
  await postJournalEntry(client, context, created.entry.id, { internal: true, allowDraft: true });
  return created.entry;
}

export async function completeCloseRun(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const id = uuid(idValue, "Close run");
  const detail = await getCloseRun(client, context, id);
  const blocking = detail.tasks.filter((task) => task.blocking && !["completed","waived"].includes(task.status));
  if (blocking.length) throw new AccountingError(409, `${blocking.length} blocking close tasks remain incomplete.`);
  if (detail.blockers.length) throw new AccountingError(409, `The period has ${detail.blockers.length} unresolved close blocker categories: ${detail.blockers.map((blocker) => blocker.message).join("; ")}.`);
  if (detail.run.close_type === "year") await postYearEndClosingJournal(client, context, detail);
  const periodStatus = detail.run.close_type === "hard" || detail.run.close_type === "year" ? "locked" : "closed";
  await client.query(`UPDATE tenant.fiscal_periods SET status=$3,locked_at=CASE WHEN $3='locked' THEN now() ELSE locked_at END,locked_by=CASE WHEN $3='locked' THEN $4 ELSE locked_by END,close_note=$5 WHERE organization_id=$1 AND id=$2`, [context.organizationId, detail.run.fiscal_period_id, periodStatus, context.userId, `Completed by close run ${detail.run.run_number}`]);
  await client.query(`UPDATE tenant.accounting_close_runs SET status='completed',completion_percent=100,completed_at=now(),completed_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, id, context.userId]);
  await event(client, context, "close_run", id, "accounting.close.completed", detail.run.status, "completed", { periodStatus });
  return getCloseRun(client, context, id);
}
