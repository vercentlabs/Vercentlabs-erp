import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  isoDate,
  requirePermission,
  text,
  uuid,
} from "./core.js";

function journalFilters(context, filters = {}) {
  const values = [context.organizationId];
  let where = " AND entry.status='posted'";
  if (filters.from) {
    values.push(isoDate(filters.from, "From date"));
    where += ` AND entry.accounting_date>=$${values.length}::date`;
  }
  if (filters.to) {
    values.push(isoDate(filters.to, "To date"));
    where += ` AND entry.accounting_date<=$${values.length}::date`;
  }
  return { values, where };
}

export async function getAccountingDashboard(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const result = await client.query(
    `SELECT
      (SELECT count(*) FROM tenant.accounting_journal_entries document WHERE document.organization_id=$1 AND document.status='posted')::int AS posted_journals,
      (SELECT count(*) FROM tenant.accounting_journal_entries document WHERE document.organization_id=$1 AND document.status='pending_approval')::int AS pending_approvals,
      (SELECT COALESCE(sum(CASE WHEN document.invoice_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_customer_invoices document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed')) AS receivables,
      (SELECT COALESCE(sum(CASE WHEN document.invoice_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_customer_invoices document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed') AND document.invoice_type<>'credit_note' AND document.due_date<current_date) AS overdue_receivables,
      (SELECT COALESCE(sum(CASE WHEN document.bill_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_vendor_bills document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed')) AS payables,
      (SELECT COALESCE(sum(CASE WHEN document.bill_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_vendor_bills document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed') AND document.bill_type<>'credit_note' AND document.due_date<current_date) AS overdue_payables,
      (SELECT count(*) FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id=line.bank_statement_id WHERE line.organization_id=$1 AND line.match_status IN ('unmatched','suggested','partially_matched'))::int AS unreconciled_bank_lines,
      (SELECT count(*) FROM tenant.fiscal_periods period WHERE period.organization_id=$1 AND period.status='open')::int AS open_periods,
      (SELECT COALESCE(sum(asset.net_book_value),0) FROM tenant.accounting_assets asset WHERE asset.organization_id=$1 AND asset.status IN ('in_service','fully_depreciated','suspended')) AS fixed_asset_net_book_value`,
    values,
  );
  return result.rows[0];
}

export async function getTrialBalance(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  const result = await client.query(
    `SELECT account.id,account.code,account.name,account.account_class,account.account_type,
      COALESCE(sum(line.base_debit_amount),0) AS debit,
      COALESCE(sum(line.base_credit_amount),0) AS credit,
      COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0) AS balance
    FROM tenant.accounting_accounts account
    LEFT JOIN tenant.accounting_journal_lines line
      ON line.organization_id=account.organization_id AND line.account_id=account.id
    LEFT JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    WHERE account.organization_id=$1 AND account.is_group=false${where}
    GROUP BY account.id,account.code,account.name,account.account_class,account.account_type
    HAVING COALESCE(sum(line.base_debit_amount),0)<>0 OR COALESCE(sum(line.base_credit_amount),0)<>0
    ORDER BY account.code`,
    values,
  );
  return result.rows;
}

export async function getGeneralLedger(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  let accountClause = "";
  if (filters.accountId) {
    values.push(uuid(filters.accountId, "Account"));
    accountClause = ` AND line.account_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT entry.entry_number,entry.accounting_date,entry.reference,entry.description AS entry_description,
      account.code AS account_code,account.name AS account_name,line.sequence,line.description,
      line.debit_amount,line.credit_amount,line.base_debit_amount,line.base_credit_amount,
      party.display_name AS party_name,department.name AS department_name,
      cost_center.name AS cost_center_name,line.reference_type,line.reference_id
    FROM tenant.accounting_journal_lines line
    JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    LEFT JOIN tenant.business_parties party ON party.id=line.party_id
    LEFT JOIN public.departments department ON department.id=line.department_id
    LEFT JOIN public.cost_centers cost_center ON cost_center.id=line.cost_center_id
    WHERE line.organization_id=$1${where}${accountClause}
    ORDER BY entry.accounting_date,entry.entry_number,line.sequence`,
    values,
  );
  return result.rows;
}

export async function getJournalRegister(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  const result = await client.query(
    `SELECT entry.id,entry.entry_number,entry.accounting_date,entry.entry_type,entry.reference,entry.description,
      journal.code AS journal_code,journal.name AS journal_name,
      entry.currency_code,
      (SELECT COALESCE(sum(line.debit_amount),0) FROM tenant.accounting_journal_lines line WHERE line.organization_id=entry.organization_id AND line.journal_entry_id=entry.id) AS total_debit,
      (SELECT COALESCE(sum(line.credit_amount),0) FROM tenant.accounting_journal_lines line WHERE line.organization_id=entry.organization_id AND line.journal_entry_id=entry.id) AS total_credit,
      (SELECT COALESCE(sum(line.base_debit_amount),0) FROM tenant.accounting_journal_lines line WHERE line.organization_id=entry.organization_id AND line.journal_entry_id=entry.id) AS base_total_debit,
      entry.source_module,
      entry.source_type,entry.source_number,entry.posted_at,poster.full_name AS posted_by_name
    FROM tenant.accounting_journal_entries entry
    JOIN tenant.accounting_journals journal ON journal.id=entry.journal_id
    LEFT JOIN public.users poster ON poster.id=entry.posted_by
    WHERE entry.organization_id=$1${where}
    ORDER BY entry.accounting_date DESC,entry.entry_number DESC`,
    values,
  );
  return result.rows;
}

export async function getProfitAndLoss(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  const result = await client.query(
    `SELECT account.account_class,account.account_type,account.financial_statement_group,
      account.code,account.name,
      CASE WHEN account.account_class='revenue'
        THEN COALESCE(sum(line.base_credit_amount-line.base_debit_amount),0)
        ELSE COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0)
      END AS amount
    FROM tenant.accounting_journal_lines line
    JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    WHERE line.organization_id=$1${where} AND account.account_class IN ('revenue','expense')
    GROUP BY account.account_class,account.account_type,account.financial_statement_group,account.code,account.name
    ORDER BY account.account_class DESC,account.code`,
    values,
  );
  return result.rows;
}

export async function getBalanceSheet(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  const result = await client.query(
    `SELECT account.account_class,account.account_type,account.financial_statement_group,
      account.code,account.name,
      CASE WHEN account.account_class='asset'
        THEN COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0)
        ELSE COALESCE(sum(line.base_credit_amount-line.base_debit_amount),0)
      END AS amount
    FROM tenant.accounting_journal_lines line
    JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    WHERE line.organization_id=$1${where} AND account.account_class IN ('asset','liability','equity')
    GROUP BY account.account_class,account.account_type,account.financial_statement_group,account.code,account.name
    ORDER BY account.account_class,account.code`,
    values,
  );
  return result.rows;
}

export async function getBankReconciliationReport(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  const result = await client.query(
    `SELECT reconciliation.id,reconciliation.reconciliation_date,reconciliation.statement_balance,
      reconciliation.ledger_balance,reconciliation.difference,reconciliation.status,
      bank.code AS bank_code,bank.bank_name,bank.account_name,bank.currency_code,
      count(line.id) FILTER (WHERE line.match_status NOT IN ('matched','ignored'))::int AS unreconciled_lines
    FROM tenant.accounting_reconciliations reconciliation
    JOIN tenant.accounting_bank_accounts bank ON bank.id=reconciliation.bank_account_id
    LEFT JOIN tenant.accounting_bank_statements statement ON statement.id=reconciliation.bank_statement_id
    LEFT JOIN tenant.accounting_bank_statement_lines line ON line.bank_statement_id=statement.id
    WHERE reconciliation.organization_id=$1
    GROUP BY reconciliation.id,bank.code,bank.bank_name,bank.account_name,bank.currency_code
    ORDER BY reconciliation.reconciliation_date DESC`,
    values,
  );
  return result.rows;
}

export async function getAccountingReport(client, context, reportKey, filters = {}) {
  const key = text(reportKey, 50);
  const reports = {
    "trial-balance": getTrialBalance,
    "general-ledger": getGeneralLedger,
    "journal-register": getJournalRegister,
    "profit-and-loss": getProfitAndLoss,
    "balance-sheet": getBalanceSheet,
    "bank-reconciliation": getBankReconciliationReport,
  };
  if (!reports[key]) throw new AccountingError(404, "Accounting report was not found.");
  return reports[key](client, context, filters);
}
