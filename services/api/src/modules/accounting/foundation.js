const ACCOUNT_SEED = Object.freeze([
  ["1000", "Assets", "asset", "group", "debit", true, false, false],
  ["1100", "Cash and bank", "asset", "group", "debit", true, false, false],
  ["1110", "Cash on hand", "asset", "cash", "debit", false, true, true],
  ["1120", "Main bank", "asset", "bank", "debit", false, true, true],
  ["1190", "Bank suspense", "asset", "suspense", "debit", false, true, true],
  // Money between two of the company's accounts on its way (sent one day, received another).
  ["1195", "Funds in transit", "asset", "current_asset", "debit", false, false, true],
  ["1200", "Trade receivables", "asset", "receivable", "debit", false, false, true],
  ["1300", "Inventory", "asset", "inventory", "debit", false, false, true],
  ["1310", "Work in progress", "asset", "inventory", "debit", false, false, true],
  ["1400", "Input tax receivable", "asset", "tax_input", "debit", false, false, true],
  ["1411", "Input CGST", "asset", "tax_input", "debit", false, false, true],
  ["1412", "Input SGST", "asset", "tax_input", "debit", false, false, true],
  ["1413", "Input IGST", "asset", "tax_input", "debit", false, false, true],
  ["1414", "Input GST cess", "asset", "tax_input", "debit", false, false, true],
  ["1419", "Input GST awaiting ITC confirmation", "asset", "tax_input", "debit", false, false, true],
  ["1500", "Fixed assets", "asset", "fixed_asset", "debit", false, false, true],
  ["1590", "Accumulated depreciation", "asset", "accumulated_depreciation", "credit", false, false, true],
  ["1900", "Other current assets", "asset", "current_asset", "debit", false, true, false],
  ["2000", "Liabilities", "liability", "group", "credit", true, false, false],
  ["2100", "Trade payables", "liability", "payable", "credit", false, false, true],
  ["2160", "Goods received not invoiced", "liability", "current_liability", "credit", false, false, true],
  ["2200", "Output tax payable", "liability", "tax_output", "credit", false, false, true],
  ["2211", "Output CGST", "liability", "tax_output", "credit", false, false, true],
  ["2212", "Output SGST", "liability", "tax_output", "credit", false, false, true],
  ["2213", "Output IGST", "liability", "tax_output", "credit", false, false, true],
  ["2214", "Output GST cess", "liability", "tax_output", "credit", false, false, true],
  ["2300", "Withholding taxes payable", "liability", "tax_output", "credit", false, false, true],
  // Payroll liabilities (migration 0196 adds them to existing companies): posted by payroll, settled by payments.
  ["2310", "Salaries payable", "liability", "current_liability", "credit", false, false, true],
  ["2320", "TDS payable", "liability", "current_liability", "credit", false, false, true],
  ["2330", "EPF payable", "liability", "current_liability", "credit", false, false, true],
  ["2340", "ESI payable", "liability", "current_liability", "credit", false, false, true],
  ["2350", "Professional tax payable", "liability", "current_liability", "credit", false, false, true],
  ["2400", "Other current liabilities", "liability", "current_liability", "credit", false, true, false],
  ["2410", "Expense claims payable", "liability", "current_liability", "credit", false, false, true],
  ["2500", "Long-term liabilities", "liability", "non_current_liability", "credit", false, true, false],
  ["2900", "Suspense and clearing", "liability", "suspense", "credit", false, true, true],
  ["3000", "Equity", "equity", "group", "credit", true, false, false],
  ["3100", "Capital", "equity", "equity", "credit", false, true, false],
  ["3200", "Retained earnings", "equity", "retained_earnings", "credit", false, false, false],
  ["3900", "Opening balance equity", "equity", "equity", "credit", false, true, false],
  ["4000", "Revenue", "revenue", "group", "credit", true, false, false],
  ["4100", "Sales revenue", "revenue", "revenue", "credit", false, true, false],
  ["4200", "Service revenue", "revenue", "revenue", "credit", false, true, false],
  ["4900", "Other income", "revenue", "other_income", "credit", false, true, false],
  ["4950", "Purchase discounts and settlement gains", "revenue", "other_income", "credit", false, false, false],
  ["4960", "Inventory adjustment gain", "revenue", "other_income", "credit", false, true, false],
  ["4970", "Gain on disposal of assets", "revenue", "other_income", "credit", false, true, false],
  ["5000", "Cost of sales", "expense", "cogs", "debit", false, true, false],
  ["5100", "Manufacturing variances", "expense", "cogs", "debit", false, false, false],
  ["5110", "Manufacturing labor applied", "expense", "cogs", "credit", false, false, false],
  ["5120", "Manufacturing overhead applied", "expense", "cogs", "credit", false, false, false],
  ["6000", "Operating expenses", "expense", "group", "debit", true, false, false],
  ["6100", "General expense", "expense", "expense", "debit", false, true, false],
  ["6150", "Ineligible input tax", "expense", "expense", "debit", false, false, false],
  ["6200", "Payroll expense", "expense", "expense", "debit", false, true, false],
  ["6210", "Salaries and wages", "expense", "expense", "debit", false, true, false],
  ["6220", "Employer statutory contributions", "expense", "expense", "debit", false, true, false],
  ["6300", "Depreciation expense", "expense", "expense", "debit", false, true, false],
  ["6400", "Bank charges", "expense", "expense", "debit", false, true, false],
  ["6500", "Bad debt and write-off", "expense", "expense", "debit", false, true, false],
  ["6550", "Inventory adjustment loss", "expense", "expense", "debit", false, true, false],
  ["6570", "Loss on disposal of assets", "expense", "other_expense", "debit", false, true, false],
  ["6600", "Rent", "expense", "expense", "debit", false, true, false],
  ["6610", "Utilities", "expense", "expense", "debit", false, true, false],
  ["6620", "Repairs and maintenance", "expense", "expense", "debit", false, true, false],
  ["6630", "Marketing and advertising", "expense", "expense", "debit", false, true, false],
  ["6640", "Travel and conveyance", "expense", "expense", "debit", false, true, false],
  ["6650", "Office supplies and stationery", "expense", "expense", "debit", false, true, false],
  ["6660", "Telephone and internet", "expense", "expense", "debit", false, true, false],
  ["6670", "Professional and legal fees", "expense", "expense", "debit", false, true, false],
  ["6680", "Staff welfare", "expense", "expense", "debit", false, true, false],
  ["6690", "Vehicle and fuel", "expense", "expense", "debit", false, true, false],
  ["6900", "Rounding differences", "expense", "rounding", "debit", false, true, false],
  ["7000", "Foreign exchange", "revenue", "group", "credit", true, false, false],
  ["7100", "Realized FX gain", "revenue", "fx_gain", "credit", false, false, false],
  ["7110", "Unrealized FX gain", "revenue", "fx_gain", "credit", false, false, false],
  ["7200", "Realized FX loss", "expense", "fx_loss", "debit", false, false, false],
  ["7210", "Unrealized FX loss", "expense", "fx_loss", "debit", false, false, false],
]);

// [code, name, description, expense account, usual GST rate (null: varies), receipt required, no receipt needed up to, order]
export const EXPENSE_CATEGORY_SEED = Object.freeze([
  ["RENT", "Rent", "Office, shop or warehouse rent", "6600", 18, true, 0, 10],
  ["UTILITIES", "Electricity and water", "Electricity, water and gas bills", "6610", null, true, 0, 20],
  ["REPAIRS", "Repairs and maintenance", "Repairs to premises and equipment, AMC", "6620", 18, true, 0, 30],
  ["MARKETING", "Marketing and advertising", "Ads, printing of marketing material, events", "6630", 18, true, 0, 40],
  ["TRAVEL", "Travel and conveyance", "Tickets, hotels, cabs and local conveyance", "6640", null, true, 200, 50],
  ["OFFICE", "Office supplies and stationery", "Stationery, printer supplies, small office items", "6650", 18, true, 0, 60],
  ["TELECOM", "Telephone and internet", "Mobile, broadband and landline bills", "6660", 18, true, 0, 70],
  ["PROFESSIONAL", "Professional fees", "CA, legal and consultant fees", "6670", 18, true, 0, 80],
  ["STAFF_WELFARE", "Staff welfare", "Tea, snacks, team meals and celebrations", "6680", null, true, 500, 90],
  ["VEHICLE", "Vehicle and fuel", "Fuel, parking, tolls and vehicle upkeep", "6690", null, true, 200, 100],
  ["BANK_CHARGES", "Bank charges", "Charges and fees the bank deducts", "6400", 18, false, 0, 110],
  ["GENERAL", "Miscellaneous", "Anything that fits no other category", "6100", null, true, 0, 200],
]);

const JOURNAL_SEED = Object.freeze([
  // The general journal follows the company's manual-journal approval policy (accounting_settings.manual_journal_approval).
  ["GEN", "General journal", "general", null, null, false],
  ["SAL", "Sales journal", "sales", "1200", "4100", false],
  ["PUR", "Purchase journal", "purchase", "6100", "2100", false],
  ["BNK", "Bank journal", "bank", "1120", "1190", false],
  ["CSH", "Cash journal", "cash", "1110", "2900", false],
  ["TAX", "Tax journal", "tax", "1400", "2200", true],
  ["AST", "Asset journal", "asset", "1500", "1590", true],
  ["CLS", "Closing journal", "closing", null, null, true],
  ["OPN", "Opening balance journal", "opening", "1300", "3900", false],
]);

const MAPPING_SEED = Object.freeze([
  ["receivable", "1200"], ["payable", "2100"], ["revenue", "4100"],
  ["service_revenue", "4200"], ["expense", "6100"], ["cogs", "5000"],
  ["input_tax", "1400"], ["output_tax", "2200"], ["withholding_tax", "2300"],
  ["cash", "1110"], ["bank", "1120"], ["bank_suspense", "1190"], ["funds_in_transit", "1195"],
  ["suspense", "2900"], ["rounding", "6900"], ["writeoff", "6500"],
  ["purchase_discount", "4950"],
  ["retained_earnings", "3200"], ["realized_fx_gain", "7100"],
  ["unrealized_fx_gain", "7110"], ["realized_fx_loss", "7200"],
  ["unrealized_fx_loss", "7210"],
]);

// Defaults a company's own mappings override (they rank by priority, lowest first): Inventory, the opening-balance counter-account and the
// inventory adjustment gain and loss accounts.
const DEFAULT_MAPPING_SEED = Object.freeze([["inventory", "1300"], ["opening_balance_equity", "3900"], ["inventory_adjustment_gain", "4960"], ["inventory_adjustment_loss", "6550"],
  // The Indian chart's GST accounts, input tax credit awaiting confirmation, goods received not invoiced and expense claims.
  ["output_cgst", "2211"], ["output_sgst", "2212"], ["output_igst", "2213"], ["output_cess", "2214"], ["input_cgst", "1411"], ["input_sgst", "1412"], ["input_igst", "1413"],
  ["input_cess", "1414"], ["input_tax_pending", "1419"], ["itc_ineligible", "6150"], ["grni", "2160"], ["expense_payable", "2410"],
  // Manufacturing: work in progress, and the variance an order closes at completion.
  ["wip", "1310"], ["manufacturing_variance", "5100"], ["manufacturing_labor_applied", "5110"], ["manufacturing_overhead_applied", "5120"],
  // Payroll and asset disposal (migration 0196).
  ["salary_payable", "2310"], ["tds_payable", "2320"], ["epf_payable", "2330"], ["esi_payable", "2340"], ["pt_payable", "2350"],
  ["salary_expense", "6210"], ["employer_contribution_expense", "6220"], ["asset_disposal_gain", "4970"], ["asset_disposal_loss", "6570"]]);

// The accounts a sub-ledger owns (migration 0196): they take postings from their source documents, not from manual journals.
const PAYROLL_CONTROL_CODES = new Set(["2310", "2320", "2330", "2340", "2350"]);
const CONTROL_KIND_BY_TYPE = Object.freeze({ receivable: "receivable", payable: "payable", bank: "bank", cash: "cash", inventory: "inventory", tax_input: "tax", tax_output: "tax" });
export function controlKindOf(code, accountType, isGroup) {
  if (isGroup) return null;
  return PAYROLL_CONTROL_CODES.has(code) ? "payroll" : CONTROL_KIND_BY_TYPE[accountType] ?? null;
}

const PARENT_CODE_BY_PREFIX = Object.freeze([
  ["11", "1100"], ["1", "1000"], ["2", "2000"], ["3", "3000"],
  ["4", "4000"], ["6", "6000"], ["7", "7000"],
]);

/**
 * Seeds a complete, editable accounting foundation for one organisation.
 * The caller must already be inside a transaction with tenant RLS context set.
 */
export async function initializeAccountingOrganization(client, input) {
  const organizationId = String(input.organizationId || "");
  const userId = String(input.userId || "");
  if (!organizationId || !userId) {
    throw new Error("Accounting foundation requires organizationId and userId.");
  }

  const organizationResult = await client.query(
    `SELECT id,base_currency FROM public.organizations WHERE id=$1`,
    [organizationId],
  );
  const organization = organizationResult.rows[0];
  if (!organization) throw new Error("Accounting foundation cannot be created for a missing organisation.");

  const ledgerResult = await client.query(
    `INSERT INTO tenant.accounting_ledgers (
       organization_id,code,name,ledger_type,accounting_standard,
       functional_currency_code,chart_code,created_by,updated_by
     ) VALUES ($1,'PRIMARY','Primary ledger','primary','local_gaap',$2,'OPERATING',$3,$3)
     ON CONFLICT (organization_id,code) DO UPDATE SET
       functional_currency_code=EXCLUDED.functional_currency_code,
       status='active',updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING id`,
    [organizationId, organization.base_currency, userId],
  );
  const ledgerId = ledgerResult.rows[0]?.id;
  if (!ledgerId) throw new Error("Primary accounting ledger could not be initialized.");

  const accountIds = new Map();
  for (const [code, name, accountClass, accountType, normalBalance, isGroup, allowManual, reconcile] of ACCOUNT_SEED) {
    const result = await client.query(
      `INSERT INTO tenant.accounting_accounts (
         organization_id,ledger_id,code,name,account_class,account_type,
         normal_balance,is_group,allow_manual_posting,reconciliation_required,control_kind,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,'active',$11,$11)
       ON CONFLICT (organization_id,ledger_id,code) DO UPDATE SET
         name=EXCLUDED.name,account_class=EXCLUDED.account_class,account_type=EXCLUDED.account_type,
         normal_balance=EXCLUDED.normal_balance,is_group=EXCLUDED.is_group,
         reconciliation_required=EXCLUDED.reconciliation_required,status='active',updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id`,
      [organizationId, ledgerId, code, name, accountClass, accountType, normalBalance, isGroup, allowManual, reconcile, userId, controlKindOf(code, accountType, isGroup)],
    );
    accountIds.set(code, result.rows[0].id);
  }

  // An account sits under the nearest group of its own class (migration 0196's rule): the FX loss accounts (expense) stay top-level
  // rather than under the Foreign exchange group (revenue).
  const classOf = new Map(ACCOUNT_SEED.map(([code, , accountClass]) => [code, accountClass]));
  for (const [code, , accountClass] of ACCOUNT_SEED) {
    const parent = PARENT_CODE_BY_PREFIX.find(([prefix, parentCode]) => code.startsWith(prefix) && code !== parentCode && classOf.get(parentCode) === accountClass);
    if (!parent) continue;
    await client.query(
      `UPDATE tenant.accounting_accounts SET parent_id=$4,updated_by=$5,updated_at=now()
        WHERE organization_id=$1 AND ledger_id=$2 AND code=$3
          AND parent_id IS DISTINCT FROM $4`,
      [organizationId, ledgerId, code, accountIds.get(parent[1]), userId],
    );
  }

  for (const [code, name, journalType, debitCode, creditCode, approvalRequired] of JOURNAL_SEED) {
    await client.query(
      `INSERT INTO tenant.accounting_journals (
         organization_id,ledger_id,code,name,journal_type,
         default_debit_account_id,default_credit_account_id,approval_required,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9)
       ON CONFLICT (organization_id,code) DO UPDATE SET
         name=EXCLUDED.name,journal_type=EXCLUDED.journal_type,
         default_debit_account_id=EXCLUDED.default_debit_account_id,
         default_credit_account_id=EXCLUDED.default_credit_account_id,
         status='active',updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [organizationId, ledgerId, code, name, journalType,
        debitCode ? accountIds.get(debitCode) : null,
        creditCode ? accountIds.get(creditCode) : null,
        approvalRequired, userId],
    );
  }

  for (const [mappingKey, accountCode] of MAPPING_SEED) {
    await client.query(
      `INSERT INTO tenant.accounting_account_mappings (
         organization_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,100,'active',$5,$5)
       ON CONFLICT DO NOTHING`,
      [organizationId, ledgerId, mappingKey, accountIds.get(accountCode), userId],
    );
  }

  for (const [mappingKey, accountCode] of DEFAULT_MAPPING_SEED) {
    await client.query(
      `INSERT INTO tenant.accounting_account_mappings (
         organization_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by
       ) SELECT $1,$2,$3,$4,1000,'active',$5,$5
         WHERE NOT EXISTS (SELECT 1 FROM tenant.accounting_account_mappings WHERE organization_id=$1 AND ledger_id=$2 AND mapping_key=$3 AND priority=1000)`,
      [organizationId, ledgerId, mappingKey, accountIds.get(accountCode), userId],
    );
  }

  // The starting expense categories (Finance MVP F7; migration 0201 gives existing companies the same set).
  for (const [code, name, description, accountCode, rate, receipt, threshold, sort] of EXPENSE_CATEGORY_SEED) {
    if (!accountIds.get(accountCode)) continue;
    await client.query(
      `INSERT INTO tenant.expense_categories (organization_id, code, name, description, account_id, default_gst_rate, receipt_required, receipt_threshold,
         sort_order, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT (organization_id, code) DO NOTHING`,
      [organizationId, code, name, description, accountIds.get(accountCode), rate, receipt, threshold, sort, userId],
    );
  }

  const account = (code) => accountIds.get(code) || null;
  await client.query(
    `INSERT INTO tenant.accounting_settings (
       organization_id,default_ledger_id,retained_earnings_account_id,suspense_account_id,
       rounding_account_id,realized_gain_account_id,realized_loss_account_id,
       unrealized_gain_account_id,unrealized_loss_account_id,default_receivable_account_id,
       default_payable_account_id,default_revenue_account_id,default_expense_account_id,
       default_output_tax_account_id,default_input_tax_account_id,bank_suspense_account_id,
       writeoff_account_id,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
     ON CONFLICT (organization_id) DO UPDATE SET
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
    [organizationId, ledgerId, account("3200"), account("2900"), account("6900"),
      account("7100"), account("7200"), account("7110"), account("7210"), account("1200"),
      account("2100"), account("4100"), account("6100"), account("2200"), account("1400"),
      account("1190"), account("6500"), userId],
  );

  return { ledgerId, accountCount: accountIds.size };
}
