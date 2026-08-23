import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  currency,
  event,
  loadCompany,
  optionalUuid,
  requirePermission,
  requiredText,
  strictBoolean,
  text,
  uuid,
} from "./core.js";

export async function getAccountingOptions(client, context, companyIdValue = null) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const company = await loadCompany(client, context, companyIdValue || context.activeCompanyId);
  const [ledgers, accounts, journals, parties, bankAccounts, periods, branches, departments, costCenters, currencies, dimensions, dimensionValues] = await Promise.all([
    client.query(`SELECT id,code,name,ledger_type,functional_currency_code FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY ledger_type='primary' DESC,name`, [context.organizationId, company.id]),
    client.query(`SELECT id,ledger_id,parent_id,code,name,account_class,account_type,is_group,allow_manual_posting,currency_code FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY code`, [context.organizationId, company.id]),
    client.query(`SELECT id,ledger_id,code,name,journal_type,approval_required FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY journal_type,name`, [context.organizationId, company.id]),
    client.query(`SELECT id,code,display_name,party_type,currency_code,payment_term_id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY display_name`, [context.organizationId, company.id]),
    client.query(`SELECT id,ledger_id,gl_account_id,code,bank_name,account_name,currency_code,account_type FROM tenant.accounting_bank_accounts WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY bank_name,account_name`, [context.organizationId, company.id]),
    client.query(`SELECT id,name,start_date,end_date,status,period_number,period_type FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 ORDER BY start_date DESC LIMIT 36`, [context.organizationId, company.id]),
    client.query(`SELECT id,name,code FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY name`, [context.organizationId, company.id]),
    client.query(`SELECT id,name,code FROM public.departments WHERE organization_id=$1 AND company_id=$2 ORDER BY name`, [context.organizationId, company.id]),
    client.query(`SELECT id,name,code FROM public.cost_centers WHERE organization_id=$1 AND company_id=$2 ORDER BY name`, [context.organizationId, company.id]),
    client.query(`SELECT code,name,decimal_places FROM tenant.currencies WHERE organization_id=$1 AND status='active' ORDER BY code`, [context.organizationId]),
    client.query(`SELECT id,code,name,source_type,required_for_classes,balancing_dimension FROM tenant.accounting_dimensions WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY code`, [context.organizationId, company.id]),
    client.query(`SELECT value.id,value.dimension_id,value.parent_id,value.code,value.name FROM tenant.accounting_dimension_values value JOIN tenant.accounting_dimensions dimension ON dimension.organization_id=value.organization_id AND dimension.id=value.dimension_id WHERE value.organization_id=$1 AND value.status='active' AND dimension.status='active' AND (dimension.company_id IS NULL OR dimension.company_id=$2) ORDER BY dimension.code,value.code`, [context.organizationId, company.id]),
  ]);
  return { company, ledgers: ledgers.rows, accounts: accounts.rows, journals: journals.rows, parties: parties.rows, bankAccounts: bankAccounts.rows, periods: periods.rows, branches: branches.rows, departments: departments.rows, costCenters: costCenters.rows, currencies: currencies.rows, dimensions: dimensions.rows, dimensionValues: dimensionValues.rows };
}

export async function getAccountingSettings(client, context, companyIdValue = null) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const company = await loadCompany(client, context, companyIdValue || context.activeCompanyId);
  const [settings, ledgers, mappings, dimensions, dimensionValues] = await Promise.all([
    client.query(`SELECT * FROM tenant.accounting_settings WHERE organization_id=$1 AND company_id=$2`, [context.organizationId, company.id]),
    client.query(`SELECT * FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2 ORDER BY ledger_type,name`, [context.organizationId, company.id]),
    client.query(`SELECT mapping.*,account.code AS account_code,account.name AS account_name FROM tenant.accounting_account_mappings mapping JOIN tenant.accounting_accounts account ON account.id=mapping.account_id WHERE mapping.organization_id=$1 AND mapping.company_id=$2 ORDER BY mapping.mapping_key,mapping.priority`, [context.organizationId, company.id]),
    client.query(`SELECT * FROM tenant.accounting_dimensions WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY code`, [context.organizationId, company.id]),
    client.query(`SELECT value.*,dimension.code AS dimension_code,dimension.name AS dimension_name FROM tenant.accounting_dimension_values value JOIN tenant.accounting_dimensions dimension ON dimension.organization_id=value.organization_id AND dimension.id=value.dimension_id WHERE value.organization_id=$1 AND (dimension.company_id IS NULL OR dimension.company_id=$2) ORDER BY dimension.code,value.code`, [context.organizationId, company.id]),
  ]);
  return { company, settings: settings.rows[0] || null, ledgers: ledgers.rows, mappings: mappings.rows, dimensions: dimensions.rows, dimensionValues: dimensionValues.rows };
}


export async function updateAccountingSettings(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const allowed = [
    "defaultLedgerId", "retainedEarningsAccountId", "suspenseAccountId", "roundingAccountId",
    "realizedGainAccountId", "realizedLossAccountId", "unrealizedGainAccountId", "unrealizedLossAccountId",
    "defaultReceivableAccountId", "defaultPayableAccountId", "defaultRevenueAccountId", "defaultExpenseAccountId",
    "defaultOutputTaxAccountId", "defaultInputTaxAccountId", "bankSuspenseAccountId", "writeoffAccountId",
  ];
  const columns = [];
  const values = [context.organizationId, uuid(input.companyId || context.activeCompanyId, "Company")];
  const snake = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  for (const key of allowed) {
    if (!(key in input)) continue;
    values.push(optionalUuid(input[key], key));
    columns.push(`${snake(key)}=$${values.length}`);
  }
  for (const [key, column] of [
    ["cashBasisEnabled", "cash_basis_enabled"],
    ["autoPostSalesInvoices", "auto_post_sales_invoices"],
    ["autoPostVendorBills", "auto_post_vendor_bills"],
    ["hardCloseRequiresAllTasks", "hard_close_requires_all_tasks"],
    ["customerInvoiceApprovalRequired", "customer_invoice_approval_required"],
    ["vendorBillApprovalRequired", "vendor_bill_approval_required"],
    ["vendorPaymentApprovalRequired", "vendor_payment_approval_required"],
  ]) {
    if (!(key in input)) continue;
    values.push(strictBoolean(input[key], key));
    columns.push(`${column}=$${values.length}`);
  }
  for (const [key, column, label] of [
    ["journalApprovalThreshold", "journal_approval_threshold", "Journal approval threshold"],
    ["customerInvoiceApprovalThreshold", "customer_invoice_approval_threshold", "Customer-invoice approval threshold"],
    ["vendorBillApprovalThreshold", "vendor_bill_approval_threshold", "Vendor-bill approval threshold"],
    ["vendorPaymentApprovalThreshold", "vendor_payment_approval_threshold", "Vendor-payment approval threshold"],
  ]) {
    if (!(key in input)) continue;
    const threshold = Number(input[key]);
    if (!Number.isFinite(threshold) || threshold < 0) throw new AccountingError(400, `${label} is invalid.`);
    values.push(String(threshold)); columns.push(`${column}=$${values.length}`);
  }
  if (!columns.length) throw new AccountingError(400, "No accounting settings were supplied.");
  const before = await client.query(
    `SELECT * FROM tenant.accounting_settings WHERE organization_id=$1 AND company_id=$2 FOR UPDATE`,
    values.slice(0, 2),
  );
  if (!before.rows[0]) throw new AccountingError(409, "Accounting settings have not been initialized.");
  values.push(context.userId);
  const result = await client.query(`UPDATE tenant.accounting_settings SET ${columns.join(",")},updated_by=$${values.length},updated_at=now() WHERE organization_id=$1 AND company_id=$2 RETURNING *`, values);
  const updated = result.rows[0];
  await event(
    client,
    context,
    "accounting_settings",
    values[1],
    "accounting.settings.updated",
    null,
    null,
    {
      changedFields: columns.map((column) => column.split("=")[0]),
      before: before.rows[0],
      after: updated,
    },
  );
  return updated;
}

export async function createAccountingAccount(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledgerId = uuid(input.ledgerId, "Ledger");
  const ledger = await client.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`, [context.organizationId, company.id, ledgerId]);
  if (!ledger.rows[0]) throw new AccountingError(409, "Ledger is unavailable for this company.");
  const accountClass = String(input.accountClass || "");
  if (!["asset","liability","equity","revenue","expense","memorandum"].includes(accountClass)) throw new AccountingError(400, "Account class is invalid.");
  const accountType = String(input.accountType || "");
  const allowedTypes = ["group","bank","cash","receivable","payable","inventory","fixed_asset","accumulated_depreciation","tax_input","tax_output","revenue","other_income","cogs","expense","other_expense","equity","retained_earnings","current_asset","non_current_asset","current_liability","non_current_liability","suspense","rounding","fx_gain","fx_loss","intercompany","statistical"];
  if (!allowedTypes.includes(accountType)) throw new AccountingError(400, "Account type is invalid.");
  const result = await client.query(`INSERT INTO tenant.accounting_accounts (organization_id,company_id,ledger_id,parent_id,code,name,account_class,account_type,normal_balance,is_group,allow_manual_posting,reconciliation_required,currency_code,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$14) RETURNING *`, [context.organizationId, company.id, ledgerId, optionalUuid(input.parentId, "Parent account"), requiredText(input.code, "Account code", 50), requiredText(input.name, "Account name", 200), accountClass, accountType, input.normalBalance === "credit" ? "credit" : "debit", strictBoolean(input.isGroup, "Is group", { defaultValue: false }), strictBoolean(input.allowManualPosting, "Allow manual posting", { defaultValue: true }), strictBoolean(input.reconciliationRequired, "Reconciliation required", { defaultValue: false }), input.currencyCode ? currency(input.currencyCode) : null, context.userId]);
  return result.rows[0];
}

export async function upsertAccountMapping(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const result = await client.query(`INSERT INTO tenant.accounting_account_mappings (organization_id,company_id,ledger_id,mapping_key,account_id,branch_id,party_id,item_id,item_group_id,tax_category_id,priority,effective_from,effective_to,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$14) RETURNING *`, [context.organizationId, company.id, uuid(input.ledgerId, "Ledger"), requiredText(input.mappingKey, "Mapping key", 100), uuid(input.accountId, "Account"), optionalUuid(input.branchId, "Branch"), optionalUuid(input.partyId, "Party"), optionalUuid(input.itemId, "Item"), optionalUuid(input.itemGroupId, "Item group"), optionalUuid(input.taxCategoryId, "Tax category"), Math.max(1, Math.min(10000, Number(input.priority || 100))), input.effectiveFrom || null, input.effectiveTo || null, context.userId]);
  return result.rows[0];
}

export async function createAccountingDimension(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const sourceType = String(input.sourceType || "custom");
  if (!["branch", "department", "cost_center", "project", "custom"].includes(sourceType)) {
    throw new AccountingError(400, "Accounting dimension source type is invalid.");
  }
  const requiredForClasses = Array.isArray(input.requiredForClasses)
    ? [...new Set(input.requiredForClasses.map((value) => text(value, 50)).filter(Boolean))]
    : [];
  const allowedClasses = new Set(["asset", "liability", "equity", "revenue", "expense", "memorandum",
    "bank", "cash", "receivable", "payable", "inventory", "fixed_asset", "tax_input", "tax_output",
    "cogs", "intercompany"]);
  if (requiredForClasses.some((value) => !allowedClasses.has(value))) {
    throw new AccountingError(400, "One or more required account classes are invalid.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_dimensions
      (organization_id,company_id,code,name,source_type,required_for_classes,balancing_dimension,status,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,'active',$8,$8) RETURNING *`,
    [context.organizationId, company.id, requiredText(input.code, "Dimension code", 50),
      requiredText(input.name, "Dimension name", 200), sourceType, requiredForClasses,
      strictBoolean(input.balancingDimension, "Balancing dimension", { defaultValue: false }), context.userId],
  );
  return result.rows[0];
}

export async function createAccountingDimensionValue(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.settingsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const dimensionId = uuid(input.dimensionId, "Accounting dimension");
  const dimension = await client.query(
    `SELECT id FROM tenant.accounting_dimensions WHERE organization_id=$1 AND id=$2 AND status='active'
      AND (company_id IS NULL OR company_id=$3)`,
    [context.organizationId, dimensionId, company.id],
  );
  if (!dimension.rows[0]) throw new AccountingError(409, "Accounting dimension is unavailable for this company.");
  const parentId = optionalUuid(input.parentId, "Parent dimension value");
  if (parentId) {
    const parent = await client.query(
      `SELECT id FROM tenant.accounting_dimension_values WHERE organization_id=$1 AND id=$2 AND dimension_id=$3 AND status='active'`,
      [context.organizationId, parentId, dimensionId],
    );
    if (!parent.rows[0]) throw new AccountingError(409, "Parent dimension value is unavailable.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_dimension_values
      (organization_id,dimension_id,parent_id,code,name,source_record_id,status,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$7) RETURNING *`,
    [context.organizationId, dimensionId, parentId, requiredText(input.code, "Dimension value code", 50),
      requiredText(input.name, "Dimension value name", 200), optionalUuid(input.sourceRecordId, "Source record"), context.userId],
  );
  return result.rows[0];
}

export async function getAccountingOrganisationOptions(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const [companies, ledgers, accounts, currencies] = await Promise.all([
    client.query(`SELECT id,name,legal_name,base_currency FROM public.companies WHERE organization_id=$1 ORDER BY name`, [context.organizationId]),
    client.query(`SELECT id,company_id,code,name,ledger_type,functional_currency_code FROM tenant.accounting_ledgers WHERE organization_id=$1 AND status='active' ORDER BY company_id,ledger_type='primary' DESC,name`, [context.organizationId]),
    client.query(`SELECT id,company_id,ledger_id,code,name,account_class,account_type,is_group,allow_manual_posting FROM tenant.accounting_accounts WHERE organization_id=$1 AND status='active' ORDER BY company_id,code`, [context.organizationId]),
    client.query(`SELECT code,name,decimal_places FROM tenant.currencies WHERE organization_id=$1 AND status='active' ORDER BY code`, [context.organizationId]),
  ]);
  return { companies: companies.rows, ledgers: ledgers.rows, accounts: accounts.rows, currencies: currencies.rows };
}
