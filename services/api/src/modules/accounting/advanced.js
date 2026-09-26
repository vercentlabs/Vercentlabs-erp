import { randomUUID } from "node:crypto";
import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  event,
  getAccountMapping,
  getExchangeRate,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  mul,
  optionalUuid,
  requirePermission,
  requiredText,
  strictBoolean,
  text,
  uuid,
  validateBranch,
} from "./core.js";
import { createApprovalRequest, finalizeApprovalRequest } from "../../core/platform/approvals/index.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";
import { div } from "./money.js";

function nextRecurringDate(dateValue, frequency, intervalCount) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const interval = Math.max(1, Number(intervalCount || 1));
  if (frequency === "monthly") date.setUTCMonth(date.getUTCMonth() + interval);
  else if (frequency === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3 * interval);
  else if (frequency === "half_yearly") date.setUTCMonth(date.getUTCMonth() + 6 * interval);
  else date.setUTCFullYear(date.getUTCFullYear() + interval);
  return date.toISOString().slice(0, 10);
}

export async function createRecurringTemplate(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.recurringManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const journalId = uuid(input.journalId, "Journal");
  const journal = await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=$4 AND status='active'`,
    [context.organizationId, company.id, ledger.id, journalId],
  );
  if (!journal.rows[0]) throw new AccountingError(409, "Recurring journal is unavailable.");
  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new AccountingError(400, "A recurring template requires balanced journal lines.");
  let debit = 0n;
  let credit = 0n;
  const lines = input.lines.map((line, index) => {
    const lineDebit = decimal(line.debit || 0);
    const lineCredit = decimal(line.credit || 0);
    if ((lineDebit > 0n) === (lineCredit > 0n)) throw new AccountingError(400, `Recurring line ${index + 1} must contain one debit or credit.`);
    debit += lineDebit;
    credit += lineCredit;
    return {
      sequence: index + 1,
      accountId: uuid(line.accountId, "Account"),
      partyId: optionalUuid(line.partyId, "Party"),
      branchId: optionalUuid(line.branchId, "Branch"),
      departmentId: optionalUuid(line.departmentId, "Department"),
      costCenterId: optionalUuid(line.costCenterId, "Cost centre"),
      description: text(line.description, 1000) || null,
      debit: lineDebit,
      credit: lineCredit,
    };
  });
  if (debit !== credit) throw new AccountingError(409, "Recurring template is not balanced.");
  const frequency = ["monthly", "quarterly", "half_yearly", "yearly", "custom"].includes(input.frequency)
    ? input.frequency
    : "monthly";
  const result = await client.query(
    `INSERT INTO tenant.accounting_recurring_templates (
      organization_id,company_id,ledger_id,journal_id,code,name,frequency,interval_count,next_run_date,end_date,
      auto_post,description,currency_code,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$14) RETURNING *`,
    [context.organizationId, company.id, ledger.id, journalId, requiredText(input.code, "Template code", 50),
      requiredText(input.name, "Template name", 200), frequency, Math.max(1, Number(input.intervalCount || 1)),
      isoDate(input.nextRunDate, "Next run date"), input.endDate ? isoDate(input.endDate, "End date") : null,
      strictBoolean(input.autoPost, "Auto post", { defaultValue: false }), requiredText(input.description, "Description", 1000),
      currency(input.currencyCode || company.base_currency), context.userId],
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO tenant.accounting_recurring_template_lines (
        organization_id,template_id,sequence,account_id,party_id,branch_id,department_id,cost_center_id,
        description,debit_amount,credit_amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [context.organizationId, result.rows[0].id, line.sequence, line.accountId, line.partyId, line.branchId,
        line.departmentId, line.costCenterId, line.description, asDatabaseDecimal(line.debit), asDatabaseDecimal(line.credit)],
    );
  }
  return result.rows[0];
}

export async function listRecurringTemplates(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND template.company_id=$${values.length}`;
  }
  if (filters.status && filters.status !== "all") {
    values.push(text(filters.status, 30));
    where += ` AND template.status=$${values.length}`;
  }
  const result = await client.query(
    `SELECT template.*,journal.code AS journal_code,journal.name AS journal_name,company.name AS company_name
    FROM tenant.accounting_recurring_templates template
    JOIN tenant.accounting_journals journal ON journal.id=template.journal_id
    JOIN public.companies company ON company.id=template.company_id
    WHERE template.organization_id=$1${where}
    ORDER BY template.next_run_date,template.code`,
    values,
  );
  return result.rows;
}

export async function runDueRecurringTemplates(client, context, runDateValue = null) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.recurringManage);
  const runDate = isoDate(runDateValue || new Date().toISOString().slice(0, 10), "Run date");
  const templates = await client.query(
    `SELECT * FROM tenant.accounting_recurring_templates
    WHERE organization_id=$1 AND status='active' AND next_run_date<=$2::date
      AND (end_date IS NULL OR next_run_date<=end_date)
    ORDER BY next_run_date,id FOR UPDATE SKIP LOCKED`,
    [context.organizationId, runDate],
  );
  const output = [];
  for (const template of templates.rows) {
    const existing = await client.query(
      `SELECT * FROM tenant.accounting_recurring_executions
      WHERE organization_id=$1 AND template_id=$2 AND scheduled_date=$3`,
      [context.organizationId, template.id, template.next_run_date],
    );
    if (existing.rows[0]) { output.push(existing.rows[0]); continue; }
    try {
      const lines = await client.query(
        `SELECT * FROM tenant.accounting_recurring_template_lines
        WHERE organization_id=$1 AND template_id=$2 ORDER BY sequence`,
        [context.organizationId, template.id],
      );
      const journal = await createJournalEntry(client, context, {
        companyId: template.company_id,
        ledgerId: template.ledger_id,
        journalId: template.journal_id,
        entryDate: template.next_run_date,
        accountingDate: template.next_run_date,
        entryType: "recurring",
        reference: template.code,
        description: template.description,
        currencyCode: template.currency_code,
        lines: lines.rows.map((line) => ({
          accountId: line.account_id,
          partyId: line.party_id,
          branchId: line.branch_id,
          departmentId: line.department_id,
          costCenterId: line.cost_center_id,
          description: line.description,
          debit: line.debit_amount,
          credit: line.credit_amount,
          referenceType: "recurring_template",
          referenceId: template.id,
        })),
      }, { internal: true, sourceModule: "accounting", sourceType: "recurring_template", sourceId: template.id, sourceNumber: template.code });
      let status = "created";
      if (template.auto_post) {
        await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
        status = "posted";
      }
      const execution = await client.query(
        `INSERT INTO tenant.accounting_recurring_executions (
          organization_id,template_id,scheduled_date,journal_entry_id,status,executed_by
        ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [context.organizationId, template.id, template.next_run_date, journal.entry.id, status, context.userId],
      );
      const nextDate = nextRecurringDate(template.next_run_date, template.frequency, template.interval_count);
      const completed = template.end_date && nextDate > String(template.end_date).slice(0, 10);
      await client.query(
        `UPDATE tenant.accounting_recurring_templates SET next_run_date=$3,status=$4,updated_by=$5
        WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, template.id, nextDate, completed ? "completed" : "active", context.userId],
      );
      output.push(execution.rows[0]);
    } catch (error) {
      const failed = await client.query(
        `INSERT INTO tenant.accounting_recurring_executions (
          organization_id,template_id,scheduled_date,status,error_message,executed_by
        ) VALUES ($1,$2,$3,'failed',$4,$5)
        ON CONFLICT (organization_id,template_id,scheduled_date)
        DO UPDATE SET status='failed',error_message=EXCLUDED.error_message,executed_by=EXCLUDED.executed_by,executed_at=now()
        RETURNING *`,
        [context.organizationId, template.id, template.next_run_date, String(error?.message || error).slice(0, 1000), context.userId],
      );
      output.push(failed.rows[0]);
    }
  }
  return output;
}

export async function createBudget(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  if (!Array.isArray(input.lines) || !input.lines.length) throw new AccountingError(400, "Budget requires at least one line.");
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const accountIds = [...new Set(input.lines.map((line) => uuid(line.accountId, "Budget account")))];
  const accounts = await client.query(
    `SELECT id FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=ANY($4::uuid[])
        AND is_group=false AND status='active'`,
    [context.organizationId, company.id, ledger.id, accountIds],
  );
  if (accounts.rows.length !== accountIds.length) {
    throw new AccountingError(409, "Every budget account must be an active posting account in the company ledger.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_budgets (
      organization_id,company_id,code,name,fiscal_year,version_number,scenario,currency_code,control_mode,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$10) RETURNING *`,
    [context.organizationId, company.id, requiredText(input.code, "Budget code", 50), requiredText(input.name, "Budget name", 200),
      requiredText(input.fiscalYear, "Fiscal year", 20), Math.max(1, Number(input.versionNumber || 1)),
      ["budget", "forecast", "reforecast", "plan"].includes(input.scenario) ? input.scenario : "budget",
      currency(input.currencyCode || company.base_currency), ["none", "warning", "block"].includes(input.controlMode) ? input.controlMode : "warning",
      context.userId],
  );
  for (const line of input.lines) {
    await client.query(
      `INSERT INTO tenant.accounting_budget_lines (
        organization_id,budget_id,account_id,branch_id,department_id,cost_center_id,period_number,amount
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [context.organizationId, result.rows[0].id, uuid(line.accountId, "Budget account"),
        optionalUuid(line.branchId, "Branch"), optionalUuid(line.departmentId, "Department"),
        optionalUuid(line.costCenterId, "Cost centre"), Math.max(1, Math.min(14, Number(line.periodNumber))),
        asDatabaseDecimal(decimal(line.amount || 0))],
    );
  }
  return result.rows[0];
}

export async function listBudgets(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where = ` AND budget.company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT budget.*,company.name AS company_name,COALESCE(sum(line.amount),0) AS total_amount
    FROM tenant.accounting_budgets budget
    JOIN public.companies company ON company.id=budget.company_id
    LEFT JOIN tenant.accounting_budget_lines line ON line.budget_id=budget.id
    WHERE budget.organization_id=$1${where}
    GROUP BY budget.id,company.name ORDER BY budget.fiscal_year DESC,budget.code,budget.version_number DESC`,
    values,
  );
  return result.rows;
}

export async function submitBudget(client, context, budgetIdValue, assignedTo = null) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const budgetId = uuid(budgetIdValue, "Budget");
  const result = await client.query(`SELECT * FROM tenant.accounting_budgets WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, budgetId]);
  const budget = result.rows[0];
  if (!budget || budget.status !== "draft") throw new AccountingError(409, "Only a draft budget can be submitted.");
  const approval = await createApprovalRequest(client, {
    organizationId: context.organizationId,
    commandKey: "accounting.budget.approve",
    entityId: budget.id,
    title: `Approve budget ${budget.code} version ${budget.version_number}`,
    requestedBy: context.userId,
    assignedTo: assignedTo ? uuid(assignedTo, "Approver") : null,
    payload: { budgetId: budget.id },
  });
  await client.query(`UPDATE tenant.accounting_budgets SET status='pending_approval',approval_request_id=$3,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, budget.id, approval.id, context.userId]);
  return { id: approval.id, status: approval.status, version: approval.version };
}

export async function approveBudget(client, context, budgetIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const budgetId = uuid(budgetIdValue, "Budget");
  const result = await client.query(`SELECT * FROM tenant.accounting_budgets WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, budgetId]);
  const budget = result.rows[0];
  if (!budget || budget.status !== "pending_approval") throw new AccountingError(409, "Budget is not awaiting approval.");
  if (budget.created_by === context.userId) throw new AccountingError(409, "The budget creator cannot approve the same budget.");
  await client.query(`UPDATE tenant.accounting_budgets SET status='approved',updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, budget.id, context.userId]);
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "accounting.budget.approve", entityId: budget.id,
    approvalRequestId: budget.approval_request_id, decision: "approved", actorUserId: context.userId,
  });
  return { id: budget.id, status: "approved" };
}

export async function rejectBudgetApproval(client, context, budgetIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const budgetId = uuid(budgetIdValue, "Budget");
  const result = await client.query(`UPDATE tenant.accounting_budgets SET status='draft',approval_request_id=NULL,updated_by=$3 WHERE organization_id=$1 AND id=$2 AND status='pending_approval' RETURNING id,status`, [context.organizationId, budgetId, context.userId]);
  if (result.rows[0]) {
    await finalizeApprovalRequest(client, {
      organizationId: context.organizationId, commandKey: "accounting.budget.approve", entityId: budgetId, decision: "rejected", actorUserId: context.userId,
    });
  }
  return result.rows[0] || { id: budgetId, status: "draft" };
}

export async function activateBudget(client, context, budgetIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const budgetId = uuid(budgetIdValue, "Budget");
  const result = await client.query(`SELECT * FROM tenant.accounting_budgets WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, budgetId]);
  const budget = result.rows[0];
  if (!budget || budget.status !== "approved") throw new AccountingError(409, "Only an approved budget can be activated.");
  await client.query(`UPDATE tenant.accounting_budgets SET status='superseded',updated_by=$4 WHERE organization_id=$1 AND company_id=$2 AND fiscal_year=$3 AND status='active'`, [context.organizationId, budget.company_id, budget.fiscal_year, context.userId]);
  const updated = await client.query(`UPDATE tenant.accounting_budgets SET status='active',updated_by=$3 WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, budget.id, context.userId]);
  return updated.rows[0];
}

export async function calculateRevaluation(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.fxManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const valuationDate = isoDate(input.valuationDate || new Date().toISOString().slice(0, 10), "Valuation date");
  const sourceCurrency = currency(input.sourceCurrencyCode);
  if (sourceCurrency === company.base_currency) throw new AccountingError(400, "Revaluation currency must differ from functional currency.");
  const rate = await getExchangeRate(client, context, company.id, sourceCurrency, company.base_currency, valuationDate, input.rate);
  const number = await allocateNumber(client, context.organizationId, "accounting_revaluation_run");
  const run = await client.query(
    `INSERT INTO tenant.accounting_revaluation_runs (
      organization_id,company_id,ledger_id,run_number,valuation_date,source_currency_code,functional_currency_code,rate,status,created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
    ON CONFLICT (organization_id,company_id,ledger_id,valuation_date,source_currency_code)
    DO UPDATE SET rate=EXCLUDED.rate,status='draft',journal_entry_id=NULL,reversal_entry_id=NULL,created_by=EXCLUDED.created_by
    RETURNING *`,
    [context.organizationId, company.id, ledger.id, number, valuationDate, sourceCurrency, company.base_currency, asDatabaseDecimal(rate), context.userId],
  );
  await client.query(`DELETE FROM tenant.accounting_revaluation_lines WHERE organization_id=$1 AND revaluation_run_id=$2`, [context.organizationId, run.rows[0].id]);
  const exposures = await client.query(
    `SELECT 'receivable' AS exposure_type,invoice.party_id,array_agg(invoice.id) AS source_ids,
      sum(CASE WHEN invoice.invoice_type='credit_note' THEN -invoice.outstanding_amount ELSE invoice.outstanding_amount END) AS foreign_balance,
      sum((CASE WHEN invoice.invoice_type='credit_note' THEN -invoice.outstanding_amount ELSE invoice.outstanding_amount END)*invoice.exchange_rate) AS existing_base_balance
    FROM tenant.accounting_customer_invoices invoice
    WHERE invoice.organization_id=$1 AND invoice.company_id=$2 AND invoice.currency_code=$3
      AND invoice.status IN ('posted','partially_paid','overdue','disputed') AND invoice.accounting_date<=$4::date
    GROUP BY invoice.party_id
    UNION ALL
    SELECT 'payable',bill.party_id,array_agg(bill.id),
      sum(CASE WHEN bill.bill_type='credit_note' THEN -bill.outstanding_amount ELSE bill.outstanding_amount END),
      sum((CASE WHEN bill.bill_type='credit_note' THEN -bill.outstanding_amount ELSE bill.outstanding_amount END)*bill.exchange_rate)
    FROM tenant.accounting_vendor_bills bill
    WHERE bill.organization_id=$1 AND bill.company_id=$2 AND bill.currency_code=$3
      AND bill.status IN ('posted','partially_paid','overdue','disputed') AND bill.accounting_date<=$4::date
    GROUP BY bill.party_id`,
    [context.organizationId, company.id, sourceCurrency, valuationDate],
  );
  let gainTotal = 0n;
  let lossTotal = 0n;
  for (const exposure of exposures.rows) {
    const account = await getAccountMapping(client, context, company.id, ledger.id,
      exposure.exposure_type === "receivable" ? "receivable" : "payable",
      { partyId: exposure.party_id, date: valuationDate });
    const revalued = mul(decimal(exposure.foreign_balance), decimal(rate));
    let difference = revalued - decimal(exposure.existing_base_balance);
    if (exposure.exposure_type === "payable") difference = -difference;
    if (difference > 0n) gainTotal += difference;
    else lossTotal += -difference;
    await client.query(
      `INSERT INTO tenant.accounting_revaluation_lines (
        organization_id,revaluation_run_id,account_id,party_id,foreign_balance,existing_base_balance,
        revalued_base_balance,gain_loss_amount,exposure_type,foreign_currency_code,source_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [context.organizationId, run.rows[0].id, account.account_id, exposure.party_id, exposure.foreign_balance,
        exposure.existing_base_balance, asDatabaseDecimal(revalued), asDatabaseDecimal(difference),
        exposure.exposure_type, sourceCurrency, exposure.source_ids],
    );
  }
  const updated = await client.query(
    `UPDATE tenant.accounting_revaluation_runs SET status='calculated',gain_total=$3,loss_total=$4
    WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, run.rows[0].id, asDatabaseDecimal(gainTotal), asDatabaseDecimal(lossTotal)],
  );
  return updated.rows[0];
}

export async function postRevaluation(client, context, runIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.fxManage);
  const runId = uuid(runIdValue, "Revaluation run");
  const result = await client.query(`SELECT * FROM tenant.accounting_revaluation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, runId]);
  const run = result.rows[0];
  if (!run || run.status !== "calculated") throw new AccountingError(409, "Revaluation must be calculated before posting.");
  const linesResult = await client.query(`SELECT * FROM tenant.accounting_revaluation_lines WHERE organization_id=$1 AND revaluation_run_id=$2 ORDER BY exposure_type,party_id`, [context.organizationId, run.id]);
  if (!linesResult.rows.length) throw new AccountingError(409, "Revaluation has no foreign-currency exposure.");
  const journalResult = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='general' AND status='active' ORDER BY created_at LIMIT 1`, [context.organizationId, run.company_id, run.ledger_id]);
  if (!journalResult.rows[0]) throw new AccountingError(409, "General journal is not configured.");
  const gain = await getAccountMapping(client, context, run.company_id, run.ledger_id, "unrealized_fx_gain", { date: run.valuation_date });
  const loss = await getAccountMapping(client, context, run.company_id, run.ledger_id, "unrealized_fx_loss", { date: run.valuation_date });
  const lines = [];
  for (const exposure of linesResult.rows) {
    const difference = decimal(exposure.gain_loss_amount);
    if (difference === 0n) continue;
    const accountDebit = exposure.exposure_type === "receivable" ? difference > 0n : difference < 0n;
    const amount = difference > 0n ? difference : -difference;
    lines.push({ accountId: exposure.account_id, partyId: exposure.party_id, debit: accountDebit ? asDatabaseDecimal(amount) : 0, credit: accountDebit ? 0 : asDatabaseDecimal(amount), referenceType: "accounting_revaluation", referenceId: run.id, description: `${exposure.exposure_type} revaluation ${run.source_currency_code}` });
    const gainEffect = difference > 0n;
    lines.push({ accountId: gainEffect ? gain.account_id : loss.account_id, debit: gainEffect ? 0 : asDatabaseDecimal(amount), credit: gainEffect ? asDatabaseDecimal(amount) : 0, referenceType: "accounting_revaluation", referenceId: run.id, description: `${gainEffect ? "Unrealized gain" : "Unrealized loss"} ${run.source_currency_code}` });
  }
  const journal = await createJournalEntry(client, context, {
    companyId: run.company_id, ledgerId: run.ledger_id, journalId: journalResult.rows[0].id,
    entryDate: run.valuation_date, accountingDate: run.valuation_date, entryType: "revaluation",
    reference: run.run_number, description: `Foreign-currency revaluation ${run.run_number}`,
    currencyCode: run.functional_currency_code, lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "foreign_currency_revaluation", sourceId: run.id, sourceNumber: run.run_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const updated = await client.query(`UPDATE tenant.accounting_revaluation_runs SET status='posted',journal_entry_id=$3,posted_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, run.id, journal.entry.id]);
  return updated.rows[0];
}

export async function createIntercompanyRule(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.intercompanyManage);
  const fromCompany = await loadCompany(client, context, input.fromCompanyId);
  const toCompany = await loadCompany(client, { ...context, allowAllCompanies: true }, input.toCompanyId);
  if (fromCompany.id === toCompany.id) throw new AccountingError(400, "Intercompany companies must differ.");
  const fromLedger = await getPrimaryLedger(client, { ...context, allowAllCompanies: true }, fromCompany.id, input.fromLedgerId);
  const toLedger = await getPrimaryLedger(client, { ...context, allowAllCompanies: true }, toCompany.id, input.toLedgerId);
  const dueFromAccountId = uuid(input.dueFromAccountId, "Due-from account");
  const dueToAccountId = uuid(input.dueToAccountId, "Due-to account");
  const eliminationAccountId = optionalUuid(input.eliminationAccountId, "Elimination account");
  const accounts = await client.query(
    `SELECT id,company_id,ledger_id FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND is_group=false AND status='active'`,
    [context.organizationId, [dueFromAccountId, dueToAccountId, ...(eliminationAccountId ? [eliminationAccountId] : [])]],
  );
  const byId = new Map(accounts.rows.map((row) => [row.id, row]));
  if (byId.get(dueToAccountId)?.company_id !== fromCompany.id || byId.get(dueToAccountId)?.ledger_id !== fromLedger.id) {
    throw new AccountingError(409, "Due-to account must belong to the originating company ledger.");
  }
  if (byId.get(dueFromAccountId)?.company_id !== toCompany.id || byId.get(dueFromAccountId)?.ledger_id !== toLedger.id) {
    throw new AccountingError(409, "Due-from account must belong to the counterparty company ledger.");
  }
  if (eliminationAccountId && !byId.has(eliminationAccountId)) {
    throw new AccountingError(409, "Elimination account is unavailable.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_intercompany_rules (
      organization_id,from_company_id,to_company_id,due_from_account_id,due_to_account_id,elimination_account_id,status,created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
    ON CONFLICT (organization_id,from_company_id,to_company_id)
    DO UPDATE SET due_from_account_id=EXCLUDED.due_from_account_id,due_to_account_id=EXCLUDED.due_to_account_id,
      elimination_account_id=EXCLUDED.elimination_account_id,status='active'
    RETURNING *`,
    [context.organizationId, fromCompany.id, toCompany.id, dueFromAccountId, dueToAccountId, eliminationAccountId, context.userId],
  );
  return result.rows[0];
}

export async function createIntercompanyJournal(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.intercompanyManage);
  const ruleResult = await client.query(
    `SELECT * FROM tenant.accounting_intercompany_rules WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, uuid(input.ruleId, "Intercompany rule")],
  );
  const rule = ruleResult.rows[0];
  if (!rule) throw new AccountingError(409, "Intercompany rule is unavailable.");
  const elevatedContext = { ...context, allowAllCompanies: true };
  const fromLedger = await getPrimaryLedger(client, elevatedContext, rule.from_company_id, input.fromLedgerId);
  const toLedger = await getPrimaryLedger(client, elevatedContext, rule.to_company_id, input.toLedgerId);
  const fromJournal = await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='intercompany' AND status='active' LIMIT 1`,
    [context.organizationId, rule.from_company_id, fromLedger.id],
  );
  const toJournal = await client.query(
    `SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='intercompany' AND status='active' LIMIT 1`,
    [context.organizationId, rule.to_company_id, toLedger.id],
  );
  if (!fromJournal.rows[0] || !toJournal.rows[0]) throw new AccountingError(409, "Both companies require an active intercompany journal.");
  const accountingDate = isoDate(input.accountingDate || new Date().toISOString().slice(0, 10), "Accounting date");
  const amount = decimal(input.amount);
  if (amount <= 0n) throw new AccountingError(400, "Intercompany amount must be positive.");
  const fromOperationalAccountId = uuid(input.fromExpenseOrAssetAccountId, "Originating account");
  const toOperationalAccountId = uuid(input.toRevenueOrLiabilityAccountId, "Counterparty account");
  const operationalAccounts = await client.query(
    `SELECT id,company_id,ledger_id FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND is_group=false AND status='active'`,
    [context.organizationId, [fromOperationalAccountId, toOperationalAccountId]],
  );
  const byId = new Map(operationalAccounts.rows.map((row) => [row.id, row]));
  if (byId.get(fromOperationalAccountId)?.company_id !== rule.from_company_id || byId.get(fromOperationalAccountId)?.ledger_id !== fromLedger.id) {
    throw new AccountingError(409, "Originating account does not belong to the originating company ledger.");
  }
  if (byId.get(toOperationalAccountId)?.company_id !== rule.to_company_id || byId.get(toOperationalAccountId)?.ledger_id !== toLedger.id) {
    throw new AccountingError(409, "Counterparty account does not belong to the counterparty company ledger.");
  }
  const conversionRate = fromLedger.functional_currency_code === toLedger.functional_currency_code
    ? decimal(1)
    : await getExchangeRate(
        client,
        elevatedContext,
        rule.from_company_id,
        fromLedger.functional_currency_code,
        toLedger.functional_currency_code,
        accountingDate,
        input.exchangeRate,
      );
  const toAmount = mul(amount, conversionRate);
  const correlationId = randomUUID();
  const description = requiredText(input.description, "Description", 1000);
  const fromEntry = await createJournalEntry(client, elevatedContext, {
    companyId: rule.from_company_id, ledgerId: fromLedger.id, journalId: fromJournal.rows[0].id,
    accountingDate, entryDate: accountingDate, entryType: "intercompany", reference: correlationId,
    description, currencyCode: fromLedger.functional_currency_code,
    lines: [
      { accountId: fromOperationalAccountId, debit: asDatabaseDecimal(amount), credit: 0, referenceType: "intercompany", referenceId: rule.id, metadata: { correlationId, counterpartyCompanyId: rule.to_company_id } },
      { accountId: rule.due_to_account_id, debit: 0, credit: asDatabaseDecimal(amount), referenceType: "intercompany", referenceId: rule.id, metadata: { correlationId, counterpartyCompanyId: rule.to_company_id } },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "intercompany", sourceId: rule.id, sourceNumber: correlationId });
  const toEntry = await createJournalEntry(client, elevatedContext, {
    companyId: rule.to_company_id, ledgerId: toLedger.id, journalId: toJournal.rows[0].id,
    accountingDate, entryDate: accountingDate, entryType: "intercompany", reference: correlationId,
    description, currencyCode: toLedger.functional_currency_code,
    lines: [
      { accountId: rule.due_from_account_id, debit: asDatabaseDecimal(toAmount), credit: 0, referenceType: "intercompany", referenceId: rule.id, metadata: { correlationId, counterpartyCompanyId: rule.from_company_id, sourceAmount: asDatabaseDecimal(amount), exchangeRate: asDatabaseDecimal(conversionRate) } },
      { accountId: toOperationalAccountId, debit: 0, credit: asDatabaseDecimal(toAmount), referenceType: "intercompany", referenceId: rule.id, metadata: { correlationId, counterpartyCompanyId: rule.from_company_id, sourceAmount: asDatabaseDecimal(amount), exchangeRate: asDatabaseDecimal(conversionRate) } },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "intercompany", sourceId: rule.id, sourceNumber: correlationId });
  if (input.postImmediately) {
    await postJournalEntry(client, elevatedContext, fromEntry.entry.id, { internal: true, allowDraft: true });
    await postJournalEntry(client, elevatedContext, toEntry.entry.id, { internal: true, allowDraft: true });
  }
  return { correlationId, exchangeRate: asDatabaseDecimal(conversionRate), fromEntry, toEntry };
}

export async function calculateConsolidation(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.consolidationManage);
  const groupId = uuid(input.groupId, "Consolidation group");
  const periodEnd = isoDate(input.periodEnd, "Period end");
  const groupResult = await client.query(`SELECT * FROM tenant.accounting_consolidation_groups WHERE organization_id=$1 AND id=$2 AND status='active'`, [context.organizationId, groupId]);
  const group = groupResult.rows[0];
  if (!group) throw new AccountingError(404, "Consolidation group was not found.");
  const run = await client.query(
    `INSERT INTO tenant.accounting_consolidation_runs (organization_id,group_id,period_end,reporting_currency_code,status,created_by)
    VALUES ($1,$2,$3,$4,'draft',$5)
    ON CONFLICT (organization_id,group_id,period_end)
    DO UPDATE SET status='draft',reporting_currency_code=EXCLUDED.reporting_currency_code,created_by=EXCLUDED.created_by
    RETURNING *`,
    [context.organizationId, group.id, periodEnd, group.reporting_currency_code, context.userId],
  );
  await client.query(`DELETE FROM tenant.accounting_consolidation_balances WHERE organization_id=$1 AND consolidation_run_id=$2`, [context.organizationId, run.rows[0].id]);
  const members = await client.query(`SELECT member.*,ledger.functional_currency_code FROM tenant.accounting_consolidation_members member JOIN tenant.accounting_ledgers ledger ON ledger.id=member.ledger_id WHERE member.organization_id=$1 AND member.group_id=$2 AND member.status='active'`, [context.organizationId, group.id]);
  for (const member of members.rows) {
    const rate = member.functional_currency_code === group.reporting_currency_code
      ? decimal(1)
      : await getExchangeRate(client, { ...context, allowAllCompanies: true }, member.company_id, member.functional_currency_code, group.reporting_currency_code, periodEnd, null);
    const balances = await client.query(
      `SELECT account.code,account.name,account.account_class,
        CASE WHEN account.account_class='asset' OR account.account_class='expense'
          THEN sum(line.base_debit_amount-line.base_credit_amount)
          ELSE sum(line.base_credit_amount-line.base_debit_amount)
        END AS balance
      FROM tenant.accounting_journal_lines line
      JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
      JOIN tenant.accounting_accounts account ON account.id=line.account_id
      WHERE line.organization_id=$1 AND entry.company_id=$2 AND entry.ledger_id=$3 AND entry.status='posted'
        AND entry.accounting_date<=$4::date
      GROUP BY account.code,account.name,account.account_class
      HAVING sum(line.base_debit_amount-line.base_credit_amount)<>0`,
      [context.organizationId, member.company_id, member.ledger_id, periodEnd],
    );
    for (const balance of balances.rows) {
      const local = decimal(balance.balance || 0);
      const translated = mul(local, decimal(rate));
      const reporting = member.consolidation_method === "full"
        ? translated
        : div(mul(translated, decimal(member.ownership_percent || 100)), 100);
      await client.query(
        `INSERT INTO tenant.accounting_consolidation_balances (
          organization_id,consolidation_run_id,company_id,account_code,account_name,account_class,
          local_currency_code,local_balance,translation_rate,reporting_balance,consolidated_balance
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [context.organizationId, run.rows[0].id, member.company_id, balance.code, balance.name, balance.account_class,
          member.functional_currency_code, asDatabaseDecimal(local), asDatabaseDecimal(rate), asDatabaseDecimal(reporting)],
      );
    }
  }
  const updated = await client.query(`UPDATE tenant.accounting_consolidation_runs SET status='calculated' WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, run.rows[0].id]);
  return updated.rows[0];
}

export async function addConsolidationAdjustment(client, context, runIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.consolidationManage);
  const runId = uuid(runIdValue, "Consolidation run");
  const debit = decimal(input.debitAmount || 0);
  const credit = decimal(input.creditAmount || 0);
  if ((debit > 0n) === (credit > 0n)) throw new AccountingError(400, "Adjustment requires one debit or credit amount.");
  const result = await client.query(
    `INSERT INTO tenant.accounting_consolidation_adjustments (
      organization_id,consolidation_run_id,adjustment_type,account_code,company_id,debit_amount,credit_amount,description,created_by
    ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
      FROM tenant.accounting_consolidation_runs run
      WHERE run.organization_id=$1 AND run.id=$2 AND run.status IN ('calculated','review')
      RETURNING *`,
    [context.organizationId, runId, ["elimination", "translation", "reclassification", "minority_interest", "manual"].includes(input.adjustmentType) ? input.adjustmentType : "manual",
      requiredText(input.accountCode, "Account code", 50), optionalUuid(input.companyId, "Company"), asDatabaseDecimal(debit), asDatabaseDecimal(credit),
      requiredText(input.description, "Description", 1000), context.userId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "Consolidation run is not open for adjustment.");
  return result.rows[0];
}

export async function runDunning(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.collectionsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const runDate = isoDate(input.runDate || new Date().toISOString().slice(0, 10), "Dunning date");
  const minimumDays = Math.max(0, Number(input.minimumDaysOverdue || 1));
  const minimumAmount = decimal(input.minimumAmount || 0);
  const run = await client.query(
    `INSERT INTO tenant.accounting_dunning_runs (organization_id,company_id,run_date,minimum_days_overdue,minimum_amount,status,created_by)
    VALUES ($1,$2,$3,$4,$5,'draft',$6)
    ON CONFLICT (organization_id,company_id,run_date)
    DO UPDATE SET minimum_days_overdue=EXCLUDED.minimum_days_overdue,minimum_amount=EXCLUDED.minimum_amount,status='draft',created_by=EXCLUDED.created_by
    RETURNING *`,
    [context.organizationId, company.id, runDate, minimumDays, asDatabaseDecimal(minimumAmount), context.userId],
  );
  await client.query(`DELETE FROM tenant.accounting_dunning_actions WHERE organization_id=$1 AND dunning_run_id=$2`, [context.organizationId, run.rows[0].id]);
  await client.query(
    `INSERT INTO tenant.accounting_dunning_actions (
      organization_id,dunning_run_id,party_id,invoice_id,level,overdue_amount,action_type,status
    ) SELECT invoice.organization_id,$2,invoice.party_id,invoice.id,
      CASE WHEN $3::date-invoice.due_date>90 THEN 4 WHEN $3::date-invoice.due_date>60 THEN 3 WHEN $3::date-invoice.due_date>30 THEN 2 ELSE 1 END,
      invoice.outstanding_amount,
      CASE WHEN $3::date-invoice.due_date>90 THEN 'legal' WHEN $3::date-invoice.due_date>60 THEN 'hold' WHEN $3::date-invoice.due_date>30 THEN 'call' ELSE 'notice' END,
      'planned'
    FROM tenant.accounting_customer_invoices invoice
    WHERE invoice.organization_id=$1 AND invoice.company_id=$4
      AND invoice.status IN ('posted','partially_paid','overdue','disputed')
      AND $3::date-invoice.due_date>=$5 AND invoice.outstanding_amount>=$6`,
    [context.organizationId, run.rows[0].id, runDate, company.id, minimumDays, asDatabaseDecimal(minimumAmount)],
  );
  const updated = await client.query(`UPDATE tenant.accounting_dunning_runs SET status='calculated' WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, run.rows[0].id]);
  await event(client, context, "dunning_run", run.rows[0].id, "accounting.dunning.calculated", "draft", "calculated", {});
  return updated.rows[0];
}


export async function listRevaluationRuns(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND run.company_id=$${values.length}`;
  }
  if (filters.status && filters.status !== "all") {
    values.push(text(filters.status, 30));
    where += ` AND run.status=$${values.length}`;
  }
  const result = await client.query(
    `SELECT run.*,company.name AS company_name,ledger.name AS ledger_name
       FROM tenant.accounting_revaluation_runs run
       JOIN public.companies company ON company.id=run.company_id
       JOIN tenant.accounting_ledgers ledger ON ledger.id=run.ledger_id
      WHERE run.organization_id=$1${where}
      ORDER BY run.valuation_date DESC,run.run_number DESC`,
    values,
  );
  return result.rows;
}

export async function listIntercompanyRules(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const result = await client.query(
    `SELECT rule.*,origin.name AS from_company_name,counterparty.name AS to_company_name,
      due_from.code AS due_from_account_code,due_to.code AS due_to_account_code
     FROM tenant.accounting_intercompany_rules rule
     JOIN public.companies origin ON origin.id=rule.from_company_id
     JOIN public.companies counterparty ON counterparty.id=rule.to_company_id
     JOIN tenant.accounting_accounts due_from ON due_from.id=rule.due_from_account_id
     JOIN tenant.accounting_accounts due_to ON due_to.id=rule.due_to_account_id
     WHERE rule.organization_id=$1 ORDER BY origin.name,counterparty.name`,
    [context.organizationId],
  );
  return result.rows;
}

export async function listDunningRuns(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where = ` AND run.company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT run.*,company.name AS company_name,count(action.id)::int AS action_count,
      COALESCE(sum(action.overdue_amount),0) AS overdue_amount
     FROM tenant.accounting_dunning_runs run
     JOIN public.companies company ON company.id=run.company_id
     LEFT JOIN tenant.accounting_dunning_actions action ON action.dunning_run_id=run.id
     WHERE run.organization_id=$1${where}
     GROUP BY run.id,company.name ORDER BY run.run_date DESC`,
    values,
  );
  return result.rows;
}

export async function createConsolidationGroup(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.consolidationManage);
  if (!Array.isArray(input.members) || !input.members.length) {
    throw new AccountingError(400, "A consolidation group requires at least one company ledger.");
  }
  const reportingCurrency = currency(input.reportingCurrencyCode);
  const group = await client.query(
    `INSERT INTO tenant.accounting_consolidation_groups (
      organization_id,code,name,reporting_currency_code,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,'active',$5,$5)
    ON CONFLICT (organization_id,code)
    DO UPDATE SET name=EXCLUDED.name,reporting_currency_code=EXCLUDED.reporting_currency_code,status='active',updated_by=EXCLUDED.updated_by
    RETURNING *`,
    [context.organizationId, requiredText(input.code, "Group code", 50), requiredText(input.name, "Group name", 200), reportingCurrency, context.userId],
  );
  await client.query(
    `DELETE FROM tenant.accounting_consolidation_members WHERE organization_id=$1 AND group_id=$2`,
    [context.organizationId, group.rows[0].id],
  );
  for (const member of input.members) {
    const company = await loadCompany(client, { ...context, allowAllCompanies: true }, member.companyId);
    const ledger = await getPrimaryLedger(client, { ...context, allowAllCompanies: true }, company.id, member.ledgerId);
    const ownership = Number(member.ownershipPercent ?? 100);
    if (!Number.isFinite(ownership) || ownership <= 0 || ownership > 100) {
      throw new AccountingError(400, "Ownership percentage must be greater than zero and no more than 100.");
    }
    const method = ["full", "proportionate", "equity"].includes(member.consolidationMethod)
      ? member.consolidationMethod
      : "full";
    await client.query(
      `INSERT INTO tenant.accounting_consolidation_members (
        organization_id,group_id,company_id,ledger_id,ownership_percent,consolidation_method,status
      ) VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [context.organizationId, group.rows[0].id, company.id, ledger.id, ownership, method],
    );
  }
  return group.rows[0];
}

export async function listConsolidationGroups(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const result = await client.query(
    `SELECT group_record.*,count(member.id)::int AS member_count
     FROM tenant.accounting_consolidation_groups group_record
     LEFT JOIN tenant.accounting_consolidation_members member ON member.group_id=group_record.id AND member.status='active'
     WHERE group_record.organization_id=$1
     GROUP BY group_record.id ORDER BY group_record.code`,
    [context.organizationId],
  );
  return result.rows;
}

export async function listConsolidationRuns(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (filters.groupId) {
    values.push(uuid(filters.groupId, "Consolidation group"));
    where = ` AND run.group_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT run.*,group_record.code AS group_code,group_record.name AS group_name,
      count(balance.id)::int AS balance_count,COALESCE(sum(balance.consolidated_balance),0) AS net_balance
     FROM tenant.accounting_consolidation_runs run
     JOIN tenant.accounting_consolidation_groups group_record ON group_record.id=run.group_id
     LEFT JOIN tenant.accounting_consolidation_balances balance ON balance.consolidation_run_id=run.id
     WHERE run.organization_id=$1${where}
     GROUP BY run.id,group_record.code,group_record.name ORDER BY run.period_end DESC`,
    values,
  );
  return result.rows;
}

export async function finalizeConsolidationRun(client, context, runIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.consolidationManage);
  const runId = uuid(runIdValue, "Consolidation run");
  const result = await client.query(
    `SELECT * FROM tenant.accounting_consolidation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, runId],
  );
  const run = result.rows[0];
  if (!run || !["calculated", "review", "reopened"].includes(run.status)) {
    throw new AccountingError(409, "Consolidation run is not ready to finalize.");
  }
  const adjustment = await client.query(
    `SELECT COALESCE(sum(debit_amount),0) AS debit,COALESCE(sum(credit_amount),0) AS credit
       FROM tenant.accounting_consolidation_adjustments
      WHERE organization_id=$1 AND consolidation_run_id=$2`,
    [context.organizationId, run.id],
  );
  if (decimal(adjustment.rows[0].debit) !== decimal(adjustment.rows[0].credit)) {
    throw new AccountingError(409, "Consolidation adjustments must balance before finalization.");
  }
  const updated = await client.query(
    `UPDATE tenant.accounting_consolidation_runs SET status='finalized',finalized_by=$3,finalized_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, run.id, context.userId],
  );
  return updated.rows[0];
}
