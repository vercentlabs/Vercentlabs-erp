const ACCOUNT_SEED = Object.freeze([
  ["1000", "Assets", "asset", "group", "debit", true, false, false],
  ["1100", "Cash and bank", "asset", "group", "debit", true, false, false],
  ["1110", "Cash on hand", "asset", "cash", "debit", false, true, true],
  ["1120", "Main bank", "asset", "bank", "debit", false, true, true],
  ["1190", "Bank suspense", "asset", "suspense", "debit", false, true, true],
  ["1200", "Trade receivables", "asset", "receivable", "debit", false, false, true],
  ["1300", "Inventory", "asset", "inventory", "debit", false, false, true],
  ["1400", "Input tax receivable", "asset", "tax_input", "debit", false, false, true],
  ["1500", "Fixed assets", "asset", "fixed_asset", "debit", false, false, true],
  ["1590", "Accumulated depreciation", "asset", "accumulated_depreciation", "credit", false, false, true],
  ["1900", "Other current assets", "asset", "current_asset", "debit", false, true, false],
  ["2000", "Liabilities", "liability", "group", "credit", true, false, false],
  ["2100", "Trade payables", "liability", "payable", "credit", false, false, true],
  ["2200", "Output tax payable", "liability", "tax_output", "credit", false, false, true],
  ["2300", "Withholding taxes payable", "liability", "tax_output", "credit", false, false, true],
  ["2400", "Other current liabilities", "liability", "current_liability", "credit", false, true, false],
  ["2500", "Long-term liabilities", "liability", "non_current_liability", "credit", false, true, false],
  ["2900", "Suspense and clearing", "liability", "suspense", "credit", false, true, true],
  ["3000", "Equity", "equity", "group", "credit", true, false, false],
  ["3100", "Capital", "equity", "equity", "credit", false, true, false],
  ["3200", "Retained earnings", "equity", "retained_earnings", "credit", false, false, false],
  ["4000", "Revenue", "revenue", "group", "credit", true, false, false],
  ["4100", "Sales revenue", "revenue", "revenue", "credit", false, true, false],
  ["4200", "Service revenue", "revenue", "revenue", "credit", false, true, false],
  ["4900", "Other income", "revenue", "other_income", "credit", false, true, false],
  ["4950", "Purchase discounts and settlement gains", "revenue", "other_income", "credit", false, false, false],
  ["5000", "Cost of sales", "expense", "cogs", "debit", false, true, false],
  ["6000", "Operating expenses", "expense", "group", "debit", true, false, false],
  ["6100", "General expense", "expense", "expense", "debit", false, true, false],
  ["6200", "Payroll expense", "expense", "expense", "debit", false, true, false],
  ["6300", "Depreciation expense", "expense", "expense", "debit", false, true, false],
  ["6400", "Bank charges", "expense", "expense", "debit", false, true, false],
  ["6500", "Bad debt and write-off", "expense", "expense", "debit", false, true, false],
  ["6900", "Rounding differences", "expense", "rounding", "debit", false, true, false],
  ["7000", "Foreign exchange", "revenue", "group", "credit", true, false, false],
  ["7100", "Realized FX gain", "revenue", "fx_gain", "credit", false, false, false],
  ["7110", "Unrealized FX gain", "revenue", "fx_gain", "credit", false, false, false],
  ["7200", "Realized FX loss", "expense", "fx_loss", "debit", false, false, false],
  ["7210", "Unrealized FX loss", "expense", "fx_loss", "debit", false, false, false],
  ["8000", "Intercompany", "asset", "group", "debit", true, false, false],
  ["8100", "Due from related companies", "asset", "intercompany", "debit", false, false, true],
  ["8200", "Due to related companies", "liability", "intercompany", "credit", false, false, true],
]);

const JOURNAL_SEED = Object.freeze([
  ["GEN", "General journal", "general", null, null, true],
  ["SAL", "Sales journal", "sales", "1200", "4100", false],
  ["PUR", "Purchase journal", "purchase", "6100", "2100", false],
  ["BNK", "Bank journal", "bank", "1120", "1190", false],
  ["CSH", "Cash journal", "cash", "1110", "2900", false],
  ["TAX", "Tax journal", "tax", "1400", "2200", true],
  ["AST", "Asset journal", "asset", "1500", "1590", true],
  ["CLS", "Closing journal", "closing", null, null, true],
  ["IC", "Intercompany journal", "intercompany", "8100", "8200", true],
]);

const MAPPING_SEED = Object.freeze([
  ["receivable", "1200"], ["payable", "2100"], ["revenue", "4100"],
  ["service_revenue", "4200"], ["expense", "6100"], ["cogs", "5000"],
  ["input_tax", "1400"], ["output_tax", "2200"], ["withholding_tax", "2300"],
  ["cash", "1110"], ["bank", "1120"], ["bank_suspense", "1190"],
  ["suspense", "2900"], ["rounding", "6900"], ["writeoff", "6500"],
  ["purchase_discount", "4950"],
  ["retained_earnings", "3200"], ["realized_fx_gain", "7100"],
  ["unrealized_fx_gain", "7110"], ["realized_fx_loss", "7200"],
  ["unrealized_fx_loss", "7210"], ["due_from", "8100"], ["due_to", "8200"],
]);

const PARENT_CODE_BY_PREFIX = Object.freeze([
  ["11", "1100"], ["1", "1000"], ["2", "2000"], ["3", "3000"],
  ["4", "4000"], ["6", "6000"], ["7", "7000"], ["8", "8000"],
]);

/**
 * Seeds a complete, editable accounting foundation for one company.
 * The caller must already be inside a transaction with tenant RLS context set.
 */
export async function initializeAccountingCompany(client, input) {
  const organizationId = String(input.organizationId || "");
  const companyId = String(input.companyId || "");
  const userId = String(input.userId || "");
  if (!organizationId || !companyId || !userId) {
    throw new Error("Accounting foundation requires organizationId, companyId and userId.");
  }

  const companyResult = await client.query(
    `SELECT id,base_currency FROM public.companies
      WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [organizationId, companyId],
  );
  const company = companyResult.rows[0];
  if (!company) throw new Error("Accounting company foundation cannot be created for an inactive company.");

  const ledgerResult = await client.query(
    `INSERT INTO tenant.accounting_ledgers (
       organization_id,company_id,code,name,ledger_type,accounting_standard,
       functional_currency_code,chart_code,created_by,updated_by
     ) VALUES ($1,$2,'PRIMARY','Primary ledger','primary','local_gaap',$3,'OPERATING',$4,$4)
     ON CONFLICT (organization_id,company_id,code) DO UPDATE SET
       functional_currency_code=EXCLUDED.functional_currency_code,
       status='active',updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING id`,
    [organizationId, companyId, company.base_currency, userId],
  );
  const ledgerId = ledgerResult.rows[0]?.id;
  if (!ledgerId) throw new Error("Primary accounting ledger could not be initialized.");

  const accountIds = new Map();
  for (const [code, name, accountClass, accountType, normalBalance, isGroup, allowManual, reconcile] of ACCOUNT_SEED) {
    const result = await client.query(
      `INSERT INTO tenant.accounting_accounts (
         organization_id,company_id,ledger_id,code,name,account_class,account_type,
         normal_balance,is_group,allow_manual_posting,reconciliation_required,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$12)
       ON CONFLICT (organization_id,company_id,ledger_id,code) DO UPDATE SET
         name=EXCLUDED.name,account_class=EXCLUDED.account_class,account_type=EXCLUDED.account_type,
         normal_balance=EXCLUDED.normal_balance,is_group=EXCLUDED.is_group,
         reconciliation_required=EXCLUDED.reconciliation_required,status='active',updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id`,
      [organizationId, companyId, ledgerId, code, name, accountClass, accountType, normalBalance, isGroup, allowManual, reconcile, userId],
    );
    accountIds.set(code, result.rows[0].id);
  }

  for (const [code] of ACCOUNT_SEED) {
    const parent = PARENT_CODE_BY_PREFIX.find(([prefix, parentCode]) => code.startsWith(prefix) && code !== parentCode);
    if (!parent) continue;
    await client.query(
      `UPDATE tenant.accounting_accounts SET parent_id=$5,updated_by=$6,updated_at=now()
        WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code=$4
          AND parent_id IS DISTINCT FROM $5`,
      [organizationId, companyId, ledgerId, code, accountIds.get(parent[1]), userId],
    );
  }

  for (const [code, name, journalType, debitCode, creditCode, approvalRequired] of JOURNAL_SEED) {
    await client.query(
      `INSERT INTO tenant.accounting_journals (
         organization_id,company_id,ledger_id,code,name,journal_type,
         default_debit_account_id,default_credit_account_id,approval_required,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10)
       ON CONFLICT (organization_id,company_id,code) DO UPDATE SET
         name=EXCLUDED.name,journal_type=EXCLUDED.journal_type,
         default_debit_account_id=EXCLUDED.default_debit_account_id,
         default_credit_account_id=EXCLUDED.default_credit_account_id,
         status='active',updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [organizationId, companyId, ledgerId, code, name, journalType,
        debitCode ? accountIds.get(debitCode) : null,
        creditCode ? accountIds.get(creditCode) : null,
        approvalRequired, userId],
    );
  }

  for (const [mappingKey, accountCode] of MAPPING_SEED) {
    await client.query(
      `INSERT INTO tenant.accounting_account_mappings (
         organization_id,company_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,100,'active',$6,$6)
       ON CONFLICT DO NOTHING`,
      [organizationId, companyId, ledgerId, mappingKey, accountIds.get(accountCode), userId],
    );
  }

  const account = (code) => accountIds.get(code) || null;
  await client.query(
    `INSERT INTO tenant.accounting_settings (
       organization_id,company_id,default_ledger_id,retained_earnings_account_id,suspense_account_id,
       rounding_account_id,realized_gain_account_id,realized_loss_account_id,
       unrealized_gain_account_id,unrealized_loss_account_id,default_receivable_account_id,
       default_payable_account_id,default_revenue_account_id,default_expense_account_id,
       default_output_tax_account_id,default_input_tax_account_id,bank_suspense_account_id,
       writeoff_account_id,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
     ON CONFLICT (organization_id,company_id) DO UPDATE SET
       default_ledger_id=COALESCE(tenant.accounting_settings.default_ledger_id,EXCLUDED.default_ledger_id),
       retained_earnings_account_id=COALESCE(tenant.accounting_settings.retained_earnings_account_id,EXCLUDED.retained_earnings_account_id),
       suspense_account_id=COALESCE(tenant.accounting_settings.suspense_account_id,EXCLUDED.suspense_account_id),
       rounding_account_id=COALESCE(tenant.accounting_settings.rounding_account_id,EXCLUDED.rounding_account_id),
       realized_gain_account_id=COALESCE(tenant.accounting_settings.realized_gain_account_id,EXCLUDED.realized_gain_account_id),
       realized_loss_account_id=COALESCE(tenant.accounting_settings.realized_loss_account_id,EXCLUDED.realized_loss_account_id),
       unrealized_gain_account_id=COALESCE(tenant.accounting_settings.unrealized_gain_account_id,EXCLUDED.unrealized_gain_account_id),
       unrealized_loss_account_id=COALESCE(tenant.accounting_settings.unrealized_loss_account_id,EXCLUDED.unrealized_loss_account_id),
       default_receivable_account_id=COALESCE(tenant.accounting_settings.default_receivable_account_id,EXCLUDED.default_receivable_account_id),
       default_payable_account_id=COALESCE(tenant.accounting_settings.default_payable_account_id,EXCLUDED.default_payable_account_id),
       default_revenue_account_id=COALESCE(tenant.accounting_settings.default_revenue_account_id,EXCLUDED.default_revenue_account_id),
       default_expense_account_id=COALESCE(tenant.accounting_settings.default_expense_account_id,EXCLUDED.default_expense_account_id),
       default_output_tax_account_id=COALESCE(tenant.accounting_settings.default_output_tax_account_id,EXCLUDED.default_output_tax_account_id),
       default_input_tax_account_id=COALESCE(tenant.accounting_settings.default_input_tax_account_id,EXCLUDED.default_input_tax_account_id),
       bank_suspense_account_id=COALESCE(tenant.accounting_settings.bank_suspense_account_id,EXCLUDED.bank_suspense_account_id),
       writeoff_account_id=COALESCE(tenant.accounting_settings.writeoff_account_id,EXCLUDED.writeoff_account_id),
       updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [organizationId, companyId, ledgerId, account("3200"), account("2900"), account("6900"),
      account("7100"), account("7200"), account("7110"), account("7210"), account("1200"),
      account("2100"), account("4100"), account("6100"), account("2200"), account("1400"),
      account("1190"), account("6500"), userId],
  );

  return { ledgerId, accountCount: accountIds.size };
}
