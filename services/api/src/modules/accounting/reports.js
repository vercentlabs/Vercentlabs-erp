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
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND entry.company_id=$${values.length}`;
  }
  if (filters.companyId) {
    values.push(uuid(filters.companyId, "Company"));
    where += ` AND entry.company_id=$${values.length}`;
  }
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

function scopedCompanyWhere(context, filters, alias, values) {
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND ${alias}.company_id=$${values.length}`;
  }
  if (filters.companyId) {
    values.push(uuid(filters.companyId, "Company"));
    where += ` AND ${alias}.company_id=$${values.length}`;
  }
  return where;
}

export async function getAccountingDashboard(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  const companyClause = scopedCompanyWhere(context, {}, "document", values);
  const statementCompanyClause = companyClause.replaceAll("document.company_id", "statement.company_id");
  const periodCompanyClause = companyClause.replaceAll("document.company_id", "period.company_id");
  const assetCompanyClause = companyClause.replaceAll("document.company_id", "asset.company_id");
  const result = await client.query(
    `SELECT
      (SELECT count(*) FROM tenant.accounting_journal_entries document WHERE document.organization_id=$1 AND document.status='posted'${companyClause})::int AS posted_journals,
      (SELECT count(*) FROM tenant.accounting_journal_entries document WHERE document.organization_id=$1 AND document.status='pending_approval'${companyClause})::int AS pending_approvals,
      (SELECT COALESCE(sum(CASE WHEN document.invoice_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_customer_invoices document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed')${companyClause}) AS receivables,
      (SELECT COALESCE(sum(CASE WHEN document.invoice_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_customer_invoices document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed') AND document.invoice_type<>'credit_note' AND document.due_date<current_date${companyClause}) AS overdue_receivables,
      (SELECT COALESCE(sum(CASE WHEN document.bill_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_vendor_bills document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed')${companyClause}) AS payables,
      (SELECT COALESCE(sum(CASE WHEN document.bill_type='credit_note' THEN -document.outstanding_amount ELSE document.outstanding_amount END),0) FROM tenant.accounting_vendor_bills document WHERE document.organization_id=$1 AND document.status IN ('posted','partially_paid','overdue','disputed') AND document.bill_type<>'credit_note' AND document.due_date<current_date${companyClause}) AS overdue_payables,
      (SELECT count(*) FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id=line.bank_statement_id WHERE line.organization_id=$1 AND line.match_status IN ('unmatched','suggested','partially_matched')${statementCompanyClause})::int AS unreconciled_bank_lines,
      (SELECT count(*) FROM tenant.fiscal_periods period WHERE period.organization_id=$1 AND period.status='open'${periodCompanyClause})::int AS open_periods,
      (SELECT COALESCE(sum(asset.net_book_value),0) FROM tenant.accounting_assets asset WHERE asset.organization_id=$1 AND asset.status IN ('in_service','fully_depreciated','suspended')${assetCompanyClause}) AS fixed_asset_net_book_value`,
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
      party.display_name AS party_name,branch.name AS branch_name,department.name AS department_name,
      cost_center.name AS cost_center_name,line.reference_type,line.reference_id
    FROM tenant.accounting_journal_lines line
    JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    LEFT JOIN tenant.business_parties party ON party.id=line.party_id
    LEFT JOIN public.branches branch ON branch.id=line.branch_id
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
      journal.code AS journal_code,journal.name AS journal_name,company.name AS company_name,
      entry.currency_code,entry.total_debit,entry.total_credit,entry.base_total_debit,entry.source_module,
      entry.source_type,entry.source_number,entry.posted_at,poster.full_name AS posted_by_name
    FROM tenant.accounting_journal_entries entry
    JOIN tenant.accounting_journals journal ON journal.id=entry.journal_id
    JOIN public.companies company ON company.id=entry.company_id
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

export async function getCashFlow(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const { values, where } = journalFilters(context, filters);
  const result = await client.query(
    `SELECT COALESCE(account.cash_flow_category,'operating') AS cash_flow_category,
      account.code,account.name,
      COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0) AS amount
    FROM tenant.accounting_journal_lines line
    JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    WHERE line.organization_id=$1${where}
      AND COALESCE(account.cash_flow_category,'operating')<>'non_cash'
    GROUP BY COALESCE(account.cash_flow_category,'operating'),account.code,account.name
    HAVING COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0)<>0
    ORDER BY cash_flow_category,account.code`,
    values,
  );
  return result.rows;
}

async function getAging(client, context, filters, kind) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  const alias = kind === "receivable" ? "invoice" : "bill";
  let where = scopedCompanyWhere(context, filters, alias, values);
  if (filters.asOf) {
    values.push(isoDate(filters.asOf, "Aging date"));
  }
  const asOf = filters.asOf ? `$${values.length}::date` : "current_date";
  const table = kind === "receivable" ? "accounting_customer_invoices" : "accounting_vendor_bills";
  const statuses = "('posted','partially_paid','overdue','disputed')";
  const signedOutstanding = kind === "receivable"
    ? `CASE WHEN ${alias}.invoice_type='credit_note' THEN -${alias}.outstanding_amount ELSE ${alias}.outstanding_amount END`
    : `CASE WHEN ${alias}.bill_type='credit_note' THEN -${alias}.outstanding_amount ELSE ${alias}.outstanding_amount END`;
  const result = await client.query(
    `SELECT party.id AS party_id,party.display_name,
      COALESCE(sum(${signedOutstanding}) FILTER (WHERE ${asOf}<=${alias}.due_date),0) AS current_amount,
      COALESCE(sum(${signedOutstanding}) FILTER (WHERE ${asOf}-${alias}.due_date BETWEEN 1 AND 30),0) AS days_1_30,
      COALESCE(sum(${signedOutstanding}) FILTER (WHERE ${asOf}-${alias}.due_date BETWEEN 31 AND 60),0) AS days_31_60,
      COALESCE(sum(${signedOutstanding}) FILTER (WHERE ${asOf}-${alias}.due_date BETWEEN 61 AND 90),0) AS days_61_90,
      COALESCE(sum(${signedOutstanding}) FILTER (WHERE ${asOf}-${alias}.due_date>90),0) AS over_90,
      COALESCE(sum(${signedOutstanding}),0) AS total
    FROM tenant.${table} ${alias}
    JOIN tenant.business_parties party ON party.id=${alias}.party_id
    WHERE ${alias}.organization_id=$1 AND ${alias}.status IN ${statuses}${where}
    GROUP BY party.id,party.display_name
    HAVING sum(${signedOutstanding})<>0
    ORDER BY total DESC`,
    values,
  );
  return result.rows;
}

export function getAgedReceivables(client, context, filters = {}) {
  return getAging(client, context, filters, "receivable");
}

export function getAgedPayables(client, context, filters = {}) {
  return getAging(client, context, filters, "payable");
}

async function getPartyStatement(client, context, filters, kind) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const partyId = uuid(filters.partyId, kind === "receivable" ? "Customer" : "Supplier");
  const values = [context.organizationId, partyId];
  const alias = kind === "receivable" ? "invoice" : "bill";
  let where = scopedCompanyWhere(context, filters, alias, values);
  if (filters.from) { values.push(isoDate(filters.from, "From date")); where += ` AND ${alias}.accounting_date>=$${values.length}::date`; }
  if (filters.to) { values.push(isoDate(filters.to, "To date")); where += ` AND ${alias}.accounting_date<=$${values.length}::date`; }
  const table = kind === "receivable" ? "accounting_customer_invoices" : "accounting_vendor_bills";
  const number = kind === "receivable" ? "invoice_number" : "bill_number";
  const typeColumn = kind === "receivable" ? "invoice_type" : "bill_type";
  const signedGrandTotal = `CASE WHEN ${alias}.${typeColumn}='credit_note' THEN -${alias}.grand_total ELSE ${alias}.grand_total END`;
  const signedOutstanding = `CASE WHEN ${alias}.${typeColumn}='credit_note' THEN -${alias}.outstanding_amount ELSE ${alias}.outstanding_amount END`;
  const result = await client.query(
    `SELECT ${alias}.id,${alias}.${number} AS document_number,${alias}.${typeColumn} AS document_type,
      ${alias}.accounting_date,${alias}.due_date,${alias}.currency_code,
      ${signedGrandTotal} AS grand_total,${signedOutstanding} AS outstanding_amount,${alias}.status
    FROM tenant.${table} ${alias}
    WHERE ${alias}.organization_id=$1 AND ${alias}.party_id=$2${where}
    ORDER BY ${alias}.accounting_date,${alias}.${number}`,
    values,
  );
  return result.rows;
}

export function getCustomerStatement(client, context, filters = {}) {
  return getPartyStatement(client, context, filters, "receivable");
}

export function getSupplierStatement(client, context, filters = {}) {
  return getPartyStatement(client, context, filters, "payable");
}

// A rolled-up balance, not a document list: getCustomerStatement above
// returns line-item detail, which is what Accounting's own statement view
// needs, but neither Accounting nor Sales (the customer 360 credit tab) had
// a cheap "where does this one customer stand right now" figure. Netting
// unapplied advance receipts against outstanding AR matches how Sales'
// order-confirmation credit gate now computes exposure (see
// confirmSalesOrder in modules/sales/index.js) and how NetSuite's own
// "available credit" already nets deposits/credit memos against balance.
// No internal requirePermission call: this has two legitimate callers with
// two different permission models (Accounting's own reports, gated on
// reportsView; Sales' customer 360, gated on sales.view) -- authorization
// stays the caller's job, same as the shared master-data engine's functions.
export async function getCustomerCreditSummary(client, context, partyId) {
  const id = uuid(partyId, "Customer");
  const values = [context.organizationId, id];
  const invoiceWhere = scopedCompanyWhere(context, {}, "invoice", values);
  const result = await client.query(
    `SELECT
        COALESCE((SELECT sum(outstanding_amount) FROM tenant.accounting_customer_invoices invoice
                   WHERE invoice.organization_id=$1 AND invoice.party_id=$2
                     AND invoice.status NOT IN ('draft','void','paid')${invoiceWhere}), 0) AS ar_outstanding,
        COALESCE((SELECT sum(unapplied_amount) FROM tenant.accounting_customer_receipts receipt
                   WHERE receipt.organization_id=$1 AND receipt.party_id=$2
                     AND receipt.status IN ('posted','partially_applied')), 0) AS unapplied_advances,
        party.credit_limit, party.currency_code
      FROM tenant.business_parties party
      WHERE party.organization_id=$1 AND party.id=$2`,
    values,
  );
  const row = result.rows[0];
  const creditLimit = Number(row?.credit_limit || 0);
  const arOutstanding = Number(row?.ar_outstanding || 0);
  const unappliedAdvances = Number(row?.unapplied_advances || 0);
  const netExposure = Math.max(0, arOutstanding - unappliedAdvances);
  return {
    creditLimit,
    arOutstanding,
    unappliedAdvances,
    netExposure,
    availableCredit: creditLimit > 0 ? creditLimit - netExposure : null,
    overLimit: creditLimit > 0 && netExposure > creditLimit,
    currencyCode: row?.currency_code ?? null,
  };
}

export async function getTaxSummary(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  let where = scopedCompanyWhere(context, filters, "tax", values);
  if (filters.taxPeriod) {
    values.push(text(filters.taxPeriod, 20));
    where += ` AND tax.tax_period=$${values.length}`;
  }
  const result = await client.query(
    `SELECT tax.tax_period,tax.tax_type,tax.direction,
      sum(tax.taxable_amount) AS taxable_amount,sum(tax.tax_amount) AS tax_amount,
      sum(tax.recoverable_amount) AS recoverable_amount
    FROM tenant.accounting_tax_ledger tax
    WHERE tax.organization_id=$1${where}
    GROUP BY tax.tax_period,tax.tax_type,tax.direction
    ORDER BY tax.tax_period DESC,tax.tax_type,tax.direction`,
    values,
  );
  return result.rows;
}

export async function getBankReconciliationReport(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  const where = scopedCompanyWhere(context, filters, "reconciliation", values);
  const result = await client.query(
    `SELECT reconciliation.id,reconciliation.reconciliation_date,reconciliation.statement_balance,
      reconciliation.ledger_balance,reconciliation.difference,reconciliation.status,
      bank.code AS bank_code,bank.bank_name,bank.account_name,bank.currency_code,
      count(line.id) FILTER (WHERE line.match_status NOT IN ('matched','ignored'))::int AS unreconciled_lines
    FROM tenant.accounting_reconciliations reconciliation
    JOIN tenant.accounting_bank_accounts bank ON bank.id=reconciliation.bank_account_id
    LEFT JOIN tenant.accounting_bank_statements statement ON statement.id=reconciliation.bank_statement_id
    LEFT JOIN tenant.accounting_bank_statement_lines line ON line.bank_statement_id=statement.id
    WHERE reconciliation.organization_id=$1${where}
    GROUP BY reconciliation.id,bank.code,bank.bank_name,bank.account_name,bank.currency_code
    ORDER BY reconciliation.reconciliation_date DESC`,
    values,
  );
  return result.rows;
}

export async function getBudgetVsActual(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  let where = scopedCompanyWhere(context, filters, "budget", values);
  if (filters.budgetId) {
    values.push(uuid(filters.budgetId, "Budget"));
    where += ` AND budget.id=$${values.length}`;
  } else {
    where += " AND budget.status IN ('approved','active')";
  }
  const result = await client.query(
    `SELECT budget.id AS budget_id,budget.code AS budget_code,budget.name AS budget_name,
      line.period_number,account.code AS account_code,account.name AS account_name,
      line.amount AS budget_amount,
      COALESCE(actual.amount,0) AS actual_amount,
      line.amount-COALESCE(actual.amount,0) AS variance
    FROM tenant.accounting_budget_lines line
    JOIN tenant.accounting_budgets budget ON budget.id=line.budget_id
    JOIN tenant.accounting_accounts account ON account.id=line.account_id
    LEFT JOIN LATERAL (
      SELECT sum(journal_line.base_debit_amount-journal_line.base_credit_amount) AS amount
      FROM tenant.accounting_journal_lines journal_line
      JOIN tenant.accounting_journal_entries entry ON entry.id=journal_line.journal_entry_id
      JOIN tenant.fiscal_periods period ON period.id=entry.fiscal_period_id
      WHERE journal_line.organization_id=line.organization_id
        AND journal_line.account_id=line.account_id
        AND entry.status='posted'
        AND entry.company_id=budget.company_id
        AND period.period_number=line.period_number
        AND extract(year FROM period.start_date)::text=budget.fiscal_year
        AND (line.branch_id IS NULL OR journal_line.branch_id=line.branch_id)
        AND (line.department_id IS NULL OR journal_line.department_id=line.department_id)
        AND (line.cost_center_id IS NULL OR journal_line.cost_center_id=line.cost_center_id)
    ) actual ON true
    WHERE line.organization_id=$1${where}
    ORDER BY budget.code,line.period_number,account.code`,
    values,
  );
  return result.rows;
}

export async function getCashFlowForecastReport(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const from = filters.from ? isoDate(filters.from, "From date") : new Date().toISOString().slice(0, 10);
  const fallbackTo = new Date(`${from}T00:00:00Z`);
  fallbackTo.setUTCDate(fallbackTo.getUTCDate() + 90);
  const to = filters.to ? isoDate(filters.to, "To date") : fallbackTo.toISOString().slice(0, 10);
  if (from > to) throw new AccountingError(400, "Cash forecast start date must be before the end date.");
  const values = [context.organizationId, from, to];
  let invoiceWhere = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); invoiceWhere += ` AND invoice.company_id=$${values.length}`; }
  if (filters.companyId) { values.push(uuid(filters.companyId, "Company")); invoiceWhere += ` AND invoice.company_id=$${values.length}`; }
  const billWhere = invoiceWhere.replaceAll("invoice.", "bill.");
  const result = await client.query(
    `SELECT schedule.due_date AS forecast_date,'inflow' AS direction,'customer_invoice' AS source_type,
      invoice.id AS source_id,invoice.invoice_number AS document_number,party.display_name AS party_name,
      invoice.currency_code,schedule.outstanding_amount AS amount,
      schedule.outstanding_amount*invoice.exchange_rate AS base_amount,100::numeric AS probability,
      schedule.outstanding_amount*invoice.exchange_rate AS weighted_base_amount
     FROM tenant.accounting_customer_invoice_schedules schedule
     JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id=schedule.organization_id AND invoice.id=schedule.customer_invoice_id
     JOIN tenant.business_parties party ON party.id=invoice.party_id
     WHERE schedule.organization_id=$1 AND schedule.outstanding_amount>0 AND schedule.due_date BETWEEN $2::date AND $3::date
       AND invoice.status IN ('posted','partially_paid','overdue','disputed')${invoiceWhere}
     UNION ALL
     SELECT schedule.due_date,'outflow','vendor_bill',bill.id,bill.bill_number,party.display_name,
      bill.currency_code,schedule.outstanding_amount,schedule.outstanding_amount*bill.exchange_rate,100::numeric,
      schedule.outstanding_amount*bill.exchange_rate
     FROM tenant.accounting_vendor_bill_schedules schedule
     JOIN tenant.accounting_vendor_bills bill ON bill.organization_id=schedule.organization_id AND bill.id=schedule.vendor_bill_id
     JOIN tenant.business_parties party ON party.id=bill.party_id
     WHERE schedule.organization_id=$1 AND schedule.outstanding_amount>0 AND schedule.due_date BETWEEN $2::date AND $3::date
       AND bill.status IN ('posted','partially_paid','overdue','disputed')${billWhere}
     ORDER BY forecast_date,direction,document_number`,
    values,
  );
  return result.rows;
}

export async function getForeignCurrencyExposure(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  const invoiceWhere = scopedCompanyWhere(context, filters, "invoice", values);
  const result = await client.query(
    `SELECT 'receivable' AS exposure_type,invoice.company_id,invoice.party_id,party.display_name,
      invoice.currency_code,invoice.functional_currency_code,
      sum(CASE WHEN invoice.invoice_type='credit_note' THEN -invoice.outstanding_amount ELSE invoice.outstanding_amount END) AS foreign_amount,
      sum((CASE WHEN invoice.invoice_type='credit_note' THEN -invoice.outstanding_amount ELSE invoice.outstanding_amount END)*invoice.exchange_rate) AS booked_base_amount
    FROM tenant.accounting_customer_invoices invoice
    JOIN tenant.business_parties party ON party.id=invoice.party_id
    WHERE invoice.organization_id=$1 AND invoice.currency_code<>invoice.functional_currency_code
      AND invoice.status IN ('posted','partially_paid','overdue','disputed')${invoiceWhere}
    GROUP BY invoice.company_id,invoice.party_id,party.display_name,invoice.currency_code,invoice.functional_currency_code
    UNION ALL
    SELECT 'payable',bill.company_id,bill.party_id,party.display_name,bill.currency_code,bill.functional_currency_code,
      sum(CASE WHEN bill.bill_type='credit_note' THEN -bill.outstanding_amount ELSE bill.outstanding_amount END),sum((CASE WHEN bill.bill_type='credit_note' THEN -bill.outstanding_amount ELSE bill.outstanding_amount END)*bill.exchange_rate)
    FROM tenant.accounting_vendor_bills bill
    JOIN tenant.business_parties party ON party.id=bill.party_id
    WHERE bill.organization_id=$1 AND bill.currency_code<>bill.functional_currency_code
      AND bill.status IN ('posted','partially_paid','overdue','disputed')${invoiceWhere.replaceAll("invoice.", "bill.")}
    GROUP BY bill.company_id,bill.party_id,party.display_name,bill.currency_code,bill.functional_currency_code
    ORDER BY exposure_type,display_name,currency_code`,
    values,
  );
  return result.rows;
}

export async function getCloseStatus(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  const where = scopedCompanyWhere(context, filters, "run", values);
  const result = await client.query(
    `SELECT run.id,run.run_number,run.close_type,run.status,run.completion_percent,run.blocked_reason,
      period.name AS period_name,period.start_date,period.end_date,
      count(task.id)::int AS task_count,
      count(task.id) FILTER (WHERE task.status='completed')::int AS completed_tasks,
      count(task.id) FILTER (WHERE task.blocking AND task.status NOT IN ('completed','waived'))::int AS open_blocking_tasks
    FROM tenant.accounting_close_runs run
    JOIN tenant.fiscal_periods period ON period.id=run.fiscal_period_id
    LEFT JOIN tenant.accounting_close_tasks task ON task.close_run_id=run.id
    WHERE run.organization_id=$1${where}
    GROUP BY run.id,period.name,period.start_date,period.end_date
    ORDER BY period.end_date DESC,run.created_at DESC`,
    values,
  );
  return result.rows;
}

export async function getSubledgerReconciliation(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId];
  let companyWhere = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    companyWhere += ` AND company.id=$${values.length}`;
  }
  if (filters.companyId) {
    values.push(uuid(filters.companyId, "Company"));
    companyWhere += ` AND company.id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT company.id AS company_id,company.name AS company_name,
      COALESCE(ar.subledger_balance,0) AS receivable_subledger,
      COALESCE(ar_gl.gl_balance,0) AS receivable_gl,
      COALESCE(ar.subledger_balance,0)-COALESCE(ar_gl.gl_balance,0) AS receivable_difference,
      COALESCE(ap.subledger_balance,0) AS payable_subledger,
      COALESCE(ap_gl.gl_balance,0) AS payable_gl,
      COALESCE(ap.subledger_balance,0)-COALESCE(ap_gl.gl_balance,0) AS payable_difference
    FROM public.companies company
    LEFT JOIN LATERAL (
      SELECT sum((CASE WHEN invoice.invoice_type='credit_note' THEN -invoice.outstanding_amount ELSE invoice.outstanding_amount END)*invoice.exchange_rate) AS subledger_balance
      FROM tenant.accounting_customer_invoices invoice
      WHERE invoice.organization_id=$1 AND invoice.company_id=company.id
        AND invoice.status IN ('posted','partially_paid','overdue','disputed')
    ) ar ON true
    LEFT JOIN LATERAL (
      SELECT sum(line.base_debit_amount-line.base_credit_amount) AS gl_balance
      FROM tenant.accounting_journal_lines line
      JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
      JOIN tenant.accounting_accounts account ON account.id=line.account_id
      WHERE line.organization_id=$1 AND entry.company_id=company.id AND entry.status='posted'
        AND account.account_type='receivable'
    ) ar_gl ON true
    LEFT JOIN LATERAL (
      SELECT sum((CASE WHEN bill.bill_type='credit_note' THEN -bill.outstanding_amount ELSE bill.outstanding_amount END)*bill.exchange_rate) AS subledger_balance
      FROM tenant.accounting_vendor_bills bill
      WHERE bill.organization_id=$1 AND bill.company_id=company.id
        AND bill.status IN ('posted','partially_paid','overdue','disputed')
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT sum(line.base_credit_amount-line.base_debit_amount) AS gl_balance
      FROM tenant.accounting_journal_lines line
      JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id
      JOIN tenant.accounting_accounts account ON account.id=line.account_id
      WHERE line.organization_id=$1 AND entry.company_id=company.id AND entry.status='posted'
        AND account.account_type='payable'
    ) ap_gl ON true
    WHERE company.organization_id=$1${companyWhere}
    ORDER BY company.name`,
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
    "cash-flow": getCashFlow,
    "aged-receivables": getAgedReceivables,
    "aged-payables": getAgedPayables,
    "customer-statement": getCustomerStatement,
    "supplier-statement": getSupplierStatement,
    "tax-summary": getTaxSummary,
    "bank-reconciliation": getBankReconciliationReport,
    "budget-vs-actual": getBudgetVsActual,
    "cash-flow-forecast": getCashFlowForecastReport,
    "foreign-currency-exposure": getForeignCurrencyExposure,
    "close-status": getCloseStatus,
    "subledger-reconciliation": getSubledgerReconciliation,
  };
  if (!reports[key]) throw new AccountingError(404, "Accounting report was not found.");
  return reports[key](client, context, filters);
}
