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
  if (!["open", "soft_closed"].includes(status)) {
    throw new AccountingError(409, "Closed and locked periods can only be produced by a completed governed close run.");
  }
  if (["closed", "locked"].includes(period.status)) {
    throw new AccountingError(409, "A closed or locked period cannot be reopened through the ordinary period endpoint.");
  }
  const updated = await client.query(`UPDATE tenant.fiscal_periods SET status=$3,soft_closed_at=CASE WHEN $3='soft_closed' THEN now() ELSE NULL END,soft_closed_by=CASE WHEN $3='soft_closed' THEN $4::uuid ELSE NULL END,close_note=$5 WHERE organization_id=$1 AND id=$2 AND status=$6 RETURNING *`, [context.organizationId, id, status, context.userId, text(input.note, 1000) || null, period.status]);
  if (!updated.rows[0]) throw new AccountingError(409, "The fiscal period changed before the update was applied.");
  await event(client, context, "fiscal_period", id, "accounting.period.status_changed", period.status, status, { note: text(input.note, 1000) || null });
  return updated.rows[0];
}

export async function createCloseRun(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const company = await loadCompany(
    client,
    context,
    input.companyId || context.activeCompanyId,
  );
  const ledger = await getPrimaryLedger(
    client,
    context,
    company.id,
    input.ledgerId,
  );
  const periodId = uuid(input.fiscalPeriodId, "Fiscal period");
  const period = await client.query(
    `SELECT *
       FROM tenant.fiscal_periods
      WHERE organization_id=$1 AND company_id=$2 AND id=$3
      FOR UPDATE`,
    [context.organizationId, company.id, periodId],
  );
  const fiscalPeriod = period.rows[0];
  if (!fiscalPeriod) {
    throw new AccountingError(404, "Fiscal period was not found for this company.");
  }
  if (!["open", "soft_closed"].includes(fiscalPeriod.status)) {
    throw new AccountingError(
      409,
      `A close run cannot be created for a ${fiscalPeriod.status} period.`,
    );
  }
  const active = await client.query(
    `SELECT id
       FROM tenant.accounting_close_runs
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3
        AND fiscal_period_id=$4
        AND status IN ('planned','in_progress','blocked')
      FOR UPDATE`,
    [context.organizationId, company.id, ledger.id, periodId],
  );
  if (active.rows[0]) {
    throw new AccountingError(
      409,
      "An active close run already exists for this ledger and period.",
    );
  }
  const runNumber = await allocateNumber(
    client,
    context.organizationId,
    "accounting_close_run",
  );
  const closeType = ["month", "quarter", "year", "soft", "hard"].includes(
    input.closeType,
  )
    ? input.closeType
    : "month";
  const result = await client.query(
    `INSERT INTO tenant.accounting_close_runs (
       organization_id,company_id,ledger_id,fiscal_period_id,run_number,
       close_type,status,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'planned',now())
     RETURNING *`,
    [
      context.organizationId,
      company.id,
      ledger.id,
      periodId,
      runNumber,
      closeType,
    ],
  );
  let previousTaskId = null;
  for (const [sequence, taskKey, name] of DEFAULT_TASKS) {
    const task = await client.query(
      `INSERT INTO tenant.accounting_close_tasks (
         organization_id,close_run_id,sequence,task_key,name,blocking,status,
         depends_on_task_ids
       ) VALUES ($1,$2,$3,$4,$5,true,'pending',$6::uuid[])
       RETURNING id`,
      [
        context.organizationId,
        result.rows[0].id,
        sequence,
        taskKey,
        name,
        previousTaskId ? [previousTaskId] : [],
      ],
    );
    previousTaskId = task.rows[0].id;
  }
  await event(
    client,
    context,
    "close_run",
    result.rows[0].id,
    "accounting.close.created",
    null,
    "planned",
    { runNumber },
  );
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

export async function updateCloseTask(
  client,
  context,
  runIdValue,
  taskIdValue,
  input,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const runId = uuid(runIdValue, "Close run");
  const taskId = uuid(taskIdValue, "Close task");
  const expectedTaskVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
    throw new AccountingError(400, "Expected close-task version is required.");
  }
  const status = String(input.status || "");
  if (!["pending", "in_progress", "completed", "waived", "blocked"].includes(status)) {
    throw new AccountingError(400, "Close task status is invalid.");
  }
  const note = text(input.note, 1000) || null;
  const evidence =
    input.evidence &&
    typeof input.evidence === "object" &&
    !Array.isArray(input.evidence)
      ? input.evidence
      : {};
  if (["completed", "waived"].includes(status)) {
    const evidenceType = text(evidence.type, 80);
    const evidenceReference = text(
      evidence.reference || evidence.documentId || evidence.uri,
      1000,
    );
    if (!evidenceType || !evidenceReference) {
      throw new AccountingError(
        400,
        "Completion and waiver evidence require a type and reference.",
      );
    }
  }
  if (status === "waived") {
    requirePermission(context, ACCOUNTING_PERMISSIONS.closeWaive);
    if (!note) throw new AccountingError(400, "A waiver reason is required.");
  }

  const runRows = await client.query(
    `SELECT * FROM tenant.accounting_close_runs
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, runId],
  );
  const run = runRows.rows[0];
  if (!run) throw new AccountingError(404, "Close run not found.");
  if (!["planned", "in_progress", "blocked"].includes(run.status)) {
    throw new AccountingError(
      409,
      `Tasks cannot be changed after the close run is ${run.status}.`,
    );
  }

  const current = await client.query(
    `SELECT *
       FROM tenant.accounting_close_tasks
      WHERE organization_id=$1 AND close_run_id=$2 AND id=$3
      FOR UPDATE`,
    [context.organizationId, runId, taskId],
  );
  const task = current.rows[0];
  if (!task) throw new AccountingError(404, "Close task not found.");
  if (Number(task.version) !== expectedTaskVersion) {
    throw new AccountingError(
      409,
      "The close task changed after it was loaded.",
    );
  }
  if (["completed", "waived"].includes(status) && task.depends_on_task_ids?.length) {
    const dependencies = await client.query(
      `SELECT id,status
         FROM tenant.accounting_close_tasks
        WHERE organization_id=$1 AND close_run_id=$2
          AND id=ANY($3::uuid[])
        FOR UPDATE`,
      [context.organizationId, runId, task.depends_on_task_ids],
    );
    const incomplete = dependencies.rows.filter(
      (dependency) => !["completed", "waived"].includes(dependency.status),
    );
    if (incomplete.length) {
      throw new AccountingError(
        409,
        "Complete the prerequisite close tasks before finishing this task.",
      );
    }
  }

  const result = await client.query(
    `UPDATE tenant.accounting_close_tasks
        SET status=$4,note=$5,evidence=$6::jsonb,
            completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END,
            completed_by=CASE WHEN $4='completed' THEN $7 ELSE NULL END,
            waived_at=CASE WHEN $4='waived' THEN now() ELSE NULL END,
            waived_by=CASE WHEN $4='waived' THEN $7 ELSE NULL END,
            waiver_reason=CASE WHEN $4='waived' THEN $5 ELSE NULL END,
            version=version+1
      WHERE organization_id=$1 AND close_run_id=$2 AND id=$3
        AND status=$8 AND version=$9
      RETURNING *`,
    [
      context.organizationId,
      runId,
      taskId,
      status,
      note,
      JSON.stringify(evidence),
      context.userId,
      task.status,
      expectedTaskVersion,
    ],
  );
  if (!result.rows[0]) {
    throw new AccountingError(
      409,
      "The close task changed before the update was applied.",
    );
  }
  await event(
    client,
    context,
    "close_task",
    taskId,
    status === "waived"
      ? "accounting.close.task_waived"
      : "accounting.close.task_updated",
    task.status,
    status,
    { runId, note, evidence, version: result.rows[0].version },
  );
  const totals = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status IN ('completed','waived'))::int AS completed,
            count(*) FILTER (WHERE status='blocked')::int AS blocked
       FROM tenant.accounting_close_tasks
      WHERE organization_id=$1 AND close_run_id=$2`,
    [context.organizationId, runId],
  );
  const summary = totals.rows[0];
  const percent = Number(summary.total)
    ? (Number(summary.completed) / Number(summary.total)) * 100
    : 0;
  await client.query(
    `UPDATE tenant.accounting_close_runs
        SET completion_percent=$3,
            status=CASE
              WHEN $4::int>0 THEN 'blocked'
              WHEN $3>0 THEN 'in_progress'
              ELSE status
            END,
            started_at=COALESCE(started_at,now()),
            started_by=COALESCE(started_by,$5),
            version=version+1
      WHERE organization_id=$1 AND id=$2
        AND status IN ('planned','in_progress','blocked')`,
    [
      context.organizationId,
      runId,
      percent.toFixed(2),
      Number(summary.blocked),
      context.userId,
    ],
  );
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

export async function completeCloseRun(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const id = uuid(idValue, "Close run");
  const expectedRunVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedRunVersion) || expectedRunVersion < 1) {
    throw new AccountingError(400, "Expected close-run version is required.");
  }

  const locked = await client.query(
    `SELECT run.*,period.name AS period_name,
            period.start_date AS period_start_date,
            period.end_date AS period_end_date,
            period.status AS period_status,
            company.name AS company_name
       FROM tenant.accounting_close_runs run
       JOIN tenant.fiscal_periods period ON period.id=run.fiscal_period_id
       JOIN public.companies company ON company.id=run.company_id
      WHERE run.organization_id=$1 AND run.id=$2
      FOR UPDATE OF run,period`,
    [context.organizationId, id],
  );
  const run = locked.rows[0];
  if (!run) throw new AccountingError(404, "Close run not found.");
  if (Number(run.version) !== expectedRunVersion) {
    throw new AccountingError(409, "The close run changed after it was loaded.");
  }
  if (!["planned", "in_progress", "blocked"].includes(run.status)) {
    throw new AccountingError(
      409,
      `A ${run.status} close run cannot be completed again.`,
    );
  }

  const tasks = await client.query(
    `SELECT *
       FROM tenant.accounting_close_tasks
      WHERE organization_id=$1 AND close_run_id=$2
      ORDER BY sequence
      FOR UPDATE`,
    [context.organizationId, id],
  );
  const detail = {
    run,
    tasks: tasks.rows,
    blockers: await periodBlockers(client, context, run.company_id, {
      start_date: run.period_start_date,
      end_date: run.period_end_date,
    }),
  };
  const blocking = detail.tasks.filter(
    (task) => task.blocking && !["completed", "waived"].includes(task.status),
  );
  if (blocking.length) {
    throw new AccountingError(
      409,
      `${blocking.length} blocking close tasks remain incomplete.`,
    );
  }
  if (detail.blockers.length) {
    throw new AccountingError(
      409,
      `The period has ${detail.blockers.length} unresolved close blocker categories: ${detail.blockers
        .map((blocker) => blocker.message)
        .join("; ")}.`,
    );
  }

  if (run.close_type === "year") {
    await postYearEndClosingJournal(client, context, detail);
  }
  const periodStatus =
    run.close_type === "hard" || run.close_type === "year"
      ? "locked"
      : "closed";
  const periodUpdated = await client.query(
    `UPDATE tenant.fiscal_periods
        SET status=$3,
            locked_at=CASE WHEN $3='locked' THEN now() ELSE locked_at END,
            locked_by=CASE WHEN $3='locked' THEN $4 ELSE locked_by END,
            close_note=$5
      WHERE organization_id=$1 AND id=$2
        AND status IN ('open','soft_closed')
      RETURNING id`,
    [
      context.organizationId,
      run.fiscal_period_id,
      periodStatus,
      context.userId,
      `Completed by close run ${run.run_number}`,
    ],
  );
  if (!periodUpdated.rows[0]) {
    throw new AccountingError(
      409,
      "The fiscal period changed before close completion.",
    );
  }
  const completed = await client.query(
    `UPDATE tenant.accounting_close_runs
        SET status='completed',completion_percent=100,completed_at=now(),
            completed_by=$3,version=version+1
      WHERE organization_id=$1 AND id=$2
        AND version=$4 AND status IN ('planned','in_progress','blocked')
      RETURNING *`,
    [context.organizationId, id, context.userId, expectedRunVersion],
  );
  if (!completed.rows[0]) {
    throw new AccountingError(
      409,
      "The close run changed before completion was committed.",
    );
  }
  await event(
    client,
    context,
    "close_run",
    id,
    "accounting.close.completed",
    run.status,
    "completed",
    { periodStatus, version: completed.rows[0].version },
  );
  return getCloseRun(client, context, id);
}
