import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  event,
  getAccountMapping,
  getCurrencyPrecision,
  getExchangeRate,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  optionalUuid,
  positiveAmount,
  requirePermission,
  requiredText,
  roundMoney,
  text,
  toBaseAmount,
  uuid,
  validateBranch,
} from "./core.js";
import { createJournalEntry, postJournalEntry } from "./journals.js";
import { div, mul } from "./money.js";

function addMonths(dateValue, months) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

async function loadAssetJournal(client, context, companyId, ledgerId) {
  const result = await client.query(
    `SELECT id FROM tenant.accounting_journals
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='asset' AND status='active'
      ORDER BY created_at LIMIT 1`,
    [context.organizationId, companyId, ledgerId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "An active asset journal is not configured.");
  return result.rows[0].id;
}

async function loadCategory(client, context, companyId, ledgerId, categoryIdValue) {
  const categoryId = uuid(categoryIdValue, "Asset category");
  const result = await client.query(
    `SELECT * FROM tenant.accounting_asset_categories
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=$4 AND status='active'`,
    [context.organizationId, companyId, ledgerId, categoryId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "Asset category is unavailable for the selected company ledger.");
  return result.rows[0];
}

async function lockAsset(client, context, assetIdValue) {
  const assetId = uuid(assetIdValue, "Asset");
  const result = await client.query(
    `SELECT asset.*,category.asset_account_id,category.accumulated_depreciation_account_id,
      category.depreciation_expense_account_id,category.disposal_gain_account_id,category.disposal_loss_account_id
    FROM tenant.accounting_assets asset
    JOIN tenant.accounting_asset_categories category ON category.id=asset.category_id
    WHERE asset.organization_id=$1 AND asset.id=$2 FOR UPDATE OF asset`,
    [context.organizationId, assetId],
  );
  const asset = result.rows[0];
  if (!asset) throw new AccountingError(404, "Asset was not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && asset.company_id !== context.activeCompanyId) {
    throw new AccountingError(403, "Switch to the asset company before changing it.");
  }
  return asset;
}

export async function listAssetCategories(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND category.company_id=$${values.length}`;
  }
  if (filters.companyId) {
    values.push(uuid(filters.companyId, "Company"));
    where += ` AND category.company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT category.*,asset.code AS asset_account_code,asset.name AS asset_account_name,
      accumulated.code AS accumulated_account_code,expense.code AS expense_account_code
    FROM tenant.accounting_asset_categories category
    JOIN tenant.accounting_accounts asset ON asset.id=category.asset_account_id
    JOIN tenant.accounting_accounts accumulated ON accumulated.id=category.accumulated_depreciation_account_id
    JOIN tenant.accounting_accounts expense ON expense.id=category.depreciation_expense_account_id
    WHERE category.organization_id=$1${where}
    ORDER BY category.code`,
    values,
  );
  return result.rows;
}

export async function createAssetCategory(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const method = ["straight_line", "declining_balance", "units_of_production", "none"].includes(input.defaultMethod)
    ? input.defaultMethod
    : "straight_line";
  const usefulLife = Math.max(1, Math.min(1200, Number(input.defaultUsefulLifeMonths || 60)));
  const accountIds = [input.assetAccountId, input.accumulatedDepreciationAccountId, input.depreciationExpenseAccountId,
    input.disposalGainAccountId, input.disposalLossAccountId].map((value) => uuid(value, "Asset-category account"));
  const accounts = await client.query(
    `SELECT id FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=ANY($4::uuid[]) AND is_group=false AND status='active'`,
    [context.organizationId, company.id, ledger.id, accountIds],
  );
  if (new Set(accounts.rows.map((row) => row.id)).size !== new Set(accountIds).size) {
    throw new AccountingError(409, "Every asset-category account must belong to the selected company ledger.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_asset_categories (
      organization_id,company_id,ledger_id,code,name,asset_account_id,accumulated_depreciation_account_id,
      depreciation_expense_account_id,disposal_gain_account_id,disposal_loss_account_id,default_method,
      default_useful_life_months,default_declining_rate,capitalization_threshold,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$15)
    RETURNING *`,
    [context.organizationId, company.id, ledger.id, requiredText(input.code, "Category code", 50),
      requiredText(input.name, "Category name", 200), ...accountIds, method, usefulLife,
      input.defaultDecliningRate || null, input.capitalizationThreshold || 0, context.userId],
  );
  return result.rows[0];
}

export async function listAssets(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND asset.company_id=$${values.length}`;
  }
  if (filters.status && filters.status !== "all") {
    values.push(text(filters.status, 30));
    where += ` AND asset.status=$${values.length}`;
  }
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    where += ` AND (asset.asset_number ILIKE $${values.length} OR asset.name ILIKE $${values.length} OR asset.serial_number ILIKE $${values.length})`;
  }
  const result = await client.query(
    `SELECT asset.*,category.code AS category_code,category.name AS category_name,company.name AS company_name,
      branch.name AS branch_name,department.name AS department_name,cost_center.name AS cost_center_name
    FROM tenant.accounting_assets asset
    JOIN tenant.accounting_asset_categories category ON category.id=asset.category_id
    JOIN public.companies company ON company.id=asset.company_id
    LEFT JOIN public.branches branch ON branch.id=asset.branch_id
    LEFT JOIN public.departments department ON department.id=asset.department_id
    LEFT JOIN public.cost_centers cost_center ON cost_center.id=asset.cost_center_id
    WHERE asset.organization_id=$1${where}
    ORDER BY asset.acquisition_date DESC,asset.asset_number DESC LIMIT 500`,
    values,
  );
  return result.rows;
}

export async function getAsset(client, context, assetIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const assetId = uuid(assetIdValue, "Asset");
  const result = await client.query(
    `SELECT asset.*,category.code AS category_code,category.name AS category_name,
      company.name AS company_name,branch.name AS branch_name,department.name AS department_name,
      cost_center.name AS cost_center_name,custodian.full_name AS custodian_name
    FROM tenant.accounting_assets asset
    JOIN tenant.accounting_asset_categories category ON category.id=asset.category_id
    JOIN public.companies company ON company.id=asset.company_id
    LEFT JOIN public.branches branch ON branch.id=asset.branch_id
    LEFT JOIN public.departments department ON department.id=asset.department_id
    LEFT JOIN public.cost_centers cost_center ON cost_center.id=asset.cost_center_id
    LEFT JOIN public.users custodian ON custodian.id=asset.custodian_user_id
    WHERE asset.organization_id=$1 AND asset.id=$2`,
    [context.organizationId, assetId],
  );
  const asset = result.rows[0];
  if (!asset) throw new AccountingError(404, "Asset was not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && asset.company_id !== context.activeCompanyId) {
    throw new AccountingError(403, "Switch to the asset company to view it.");
  }
  const [schedule, transactions, events] = await Promise.all([
    client.query(`SELECT * FROM tenant.accounting_asset_depreciation_schedule WHERE organization_id=$1 AND asset_id=$2 ORDER BY sequence`, [context.organizationId, assetId]),
    client.query(`SELECT * FROM tenant.accounting_asset_transactions WHERE organization_id=$1 AND asset_id=$2 ORDER BY transaction_date DESC,created_at DESC`, [context.organizationId, assetId]),
    client.query(`SELECT * FROM tenant.accounting_events WHERE organization_id=$1 AND entity_type='fixed_asset' AND entity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, assetId]),
  ]);
  return { asset, schedule: schedule.rows, transactions: transactions.rows, events: events.rows };
}

export async function createAsset(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const category = await loadCategory(client, context, company.id, ledger.id, input.categoryId);
  const acquisitionDate = isoDate(input.acquisitionDate || new Date().toISOString().slice(0, 10), "Acquisition date");
  const assetCurrency = currency(input.currencyCode || company.base_currency);
  const rate = await getExchangeRate(client, context, company.id, assetCurrency, company.base_currency, acquisitionDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, assetCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, company.base_currency);
  const acquisitionCost = roundMoney(positiveAmount(input.acquisitionCost, "Acquisition cost"), precision);
  const baseAcquisitionCost = toBaseAmount(acquisitionCost, rate, basePrecision);
  const salvage = roundMoney(decimal(input.salvageValue || 0), precision);
  if (salvage < 0n || salvage >= acquisitionCost) throw new AccountingError(400, "Salvage value must be non-negative and below acquisition cost.");
  const method = ["straight_line", "declining_balance", "units_of_production", "none"].includes(input.depreciationMethod)
    ? input.depreciationMethod
    : category.default_method;
  const usefulLife = Math.max(1, Math.min(1200, Number(input.usefulLifeMonths || category.default_useful_life_months)));
  const assetNumber = await allocateNumber(client, context.organizationId, "fixed_asset");
  const result = await client.query(
    `INSERT INTO tenant.accounting_assets (
      organization_id,company_id,branch_id,ledger_id,asset_number,category_id,name,description,serial_number,
      source_vendor_bill_id,source_vendor_bill_line_id,acquisition_date,currency_code,functional_currency_code,
      exchange_rate,acquisition_cost,base_acquisition_cost,salvage_value,useful_life_months,depreciation_method,
      declining_rate,net_book_value,department_id,cost_center_id,location,custodian_user_id,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$17,$22,$23,$24,$25,'draft',$26,$26)
    RETURNING *`,
    [context.organizationId, company.id, branch?.id || null, ledger.id, assetNumber, category.id,
      requiredText(input.name, "Asset name", 300), text(input.description, 2000) || null,
      text(input.serialNumber, 200) || null, optionalUuid(input.sourceVendorBillId, "Vendor bill"),
      optionalUuid(input.sourceVendorBillLineId, "Vendor bill line"), acquisitionDate, assetCurrency,
      company.base_currency, asDatabaseDecimal(rate), asDatabaseDecimal(acquisitionCost),
      asDatabaseDecimal(baseAcquisitionCost), asDatabaseDecimal(toBaseAmount(salvage, rate, basePrecision)),
      usefulLife, method, input.decliningRate || category.default_declining_rate,
      optionalUuid(input.departmentId, "Department"), optionalUuid(input.costCenterId, "Cost centre"),
      text(input.location, 300) || null, optionalUuid(input.custodianUserId, "Custodian"), context.userId],
  );
  await event(client, context, "fixed_asset", result.rows[0].id, "accounting.asset.created", null, "draft", { assetNumber });
  return getAsset(client, context, result.rows[0].id);
}

async function generateDepreciationSchedule(client, context, asset) {
  if (asset.depreciation_method === "none") return;
  await client.query(`DELETE FROM tenant.accounting_asset_depreciation_schedule WHERE organization_id=$1 AND asset_id=$2 AND status='planned'`, [context.organizationId, asset.id]);
  const depreciable = decimal(asset.base_acquisition_cost) - decimal(asset.salvage_value);
  let opening = decimal(asset.base_acquisition_cost);
  const monthlyStraightLine = div(depreciable, asset.useful_life_months);
  for (let sequence = 1; sequence <= Number(asset.useful_life_months); sequence += 1) {
    let amount;
    if (asset.depreciation_method === "declining_balance") {
      const annualRate = decimal(asset.declining_rate || "0.20");
      amount = div(mul(opening, annualRate), 12);
      const floor = decimal(asset.salvage_value);
      if (opening - amount < floor) amount = opening - floor;
    } else {
      amount = sequence === Number(asset.useful_life_months)
        ? opening - decimal(asset.salvage_value)
        : monthlyStraightLine;
    }
    if (amount < 0n) amount = 0n;
    const closing = opening - amount;
    const date = addMonths(asset.in_service_date, sequence);
    const period = await client.query(
      `SELECT id FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 AND $3::date BETWEEN start_date AND end_date ORDER BY start_date LIMIT 1`,
      [context.organizationId, asset.company_id, date],
    );
    await client.query(
      `INSERT INTO tenant.accounting_asset_depreciation_schedule (
        organization_id,asset_id,sequence,depreciation_date,fiscal_period_id,opening_book_value,depreciation_amount,closing_book_value,status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned')
      ON CONFLICT (organization_id,asset_id,sequence) DO UPDATE SET depreciation_date=EXCLUDED.depreciation_date,
        fiscal_period_id=EXCLUDED.fiscal_period_id,opening_book_value=EXCLUDED.opening_book_value,
        depreciation_amount=EXCLUDED.depreciation_amount,closing_book_value=EXCLUDED.closing_book_value
      WHERE tenant.accounting_asset_depreciation_schedule.status='planned'`,
      [context.organizationId, asset.id, sequence, date, period.rows[0]?.id || null,
        asDatabaseDecimal(opening), asDatabaseDecimal(amount), asDatabaseDecimal(closing)],
    );
    opening = closing;
  }
}

export async function capitalizeAsset(client, context, assetIdValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const asset = await lockAsset(client, context, assetIdValue);
  if (asset.status !== "draft") return getAsset(client, context, asset.id);
  const capitalizationDate = isoDate(input.capitalizationDate || asset.acquisition_date, "Capitalization date");
  const inServiceDate = isoDate(input.inServiceDate || capitalizationDate, "In-service date");
  let offsetAccountId = optionalUuid(input.offsetAccountId, "Offset account");
  if (!offsetAccountId && asset.source_vendor_bill_line_id) {
    const source = await client.query(
      `SELECT line.expense_account_id,bill.status FROM tenant.accounting_vendor_bill_lines line
       JOIN tenant.accounting_vendor_bills bill ON bill.id=line.vendor_bill_id
       WHERE line.organization_id=$1 AND line.id=$2`,
      [context.organizationId, asset.source_vendor_bill_line_id],
    );
    if (!source.rows[0] || !["posted", "partially_paid", "paid", "overdue", "disputed"].includes(source.rows[0].status)) {
      throw new AccountingError(409, "The source vendor bill must be posted before capitalization.");
    }
    offsetAccountId = source.rows[0].expense_account_id;
  }
  if (!offsetAccountId) {
    offsetAccountId = (await getAccountMapping(client, context, asset.company_id, asset.ledger_id, "suspense", { date: capitalizationDate })).account_id;
  }
  const journalId = await loadAssetJournal(client, context, asset.company_id, asset.ledger_id);
  const journal = await createJournalEntry(client, context, {
    companyId: asset.company_id,
    branchId: asset.branch_id,
    ledgerId: asset.ledger_id,
    journalId,
    entryDate: capitalizationDate,
    accountingDate: capitalizationDate,
    entryType: "asset",
    reference: asset.asset_number,
    description: `Capitalization of ${asset.asset_number} · ${asset.name}`,
    currencyCode: asset.functional_currency_code,
    lines: [
      { accountId: asset.asset_account_id, branchId: asset.branch_id, departmentId: asset.department_id, costCenterId: asset.cost_center_id, debit: asset.base_acquisition_cost, credit: 0, referenceType: "fixed_asset", referenceId: asset.id },
      { accountId: offsetAccountId, branchId: asset.branch_id, departmentId: asset.department_id, costCenterId: asset.cost_center_id, debit: 0, credit: asset.base_acquisition_cost, referenceType: "fixed_asset", referenceId: asset.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "fixed_asset_capitalization", sourceId: asset.id, sourceNumber: asset.asset_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const updated = await client.query(
    `UPDATE tenant.accounting_assets SET status='in_service',capitalization_date=$3,in_service_date=$4,
      capitalization_entry_id=$5,updated_by=$6 WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, asset.id, capitalizationDate, inServiceDate, journal.entry.id, context.userId],
  );
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (organization_id,asset_id,transaction_type,transaction_date,amount,journal_entry_id,note,created_by)
     VALUES ($1,$2,'capitalization',$3,$4,$5,$6,$7)`,
    [context.organizationId, asset.id, capitalizationDate, asset.base_acquisition_cost, journal.entry.id,
      text(input.note, 1000) || null, context.userId],
  );
  await generateDepreciationSchedule(client, context, updated.rows[0]);
  await event(client, context, "fixed_asset", asset.id, "accounting.asset.capitalized", "draft", "in_service", { journalEntryId: journal.entry.id });
  return getAsset(client, context, asset.id);
}

export async function postAssetDepreciation(client, context, scheduleIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const scheduleId = uuid(scheduleIdValue, "Depreciation schedule");
  const result = await client.query(
    `SELECT schedule.*,asset.company_id,asset.branch_id,asset.ledger_id,asset.asset_number,asset.name AS asset_name,
      asset.department_id,asset.cost_center_id,asset.status AS asset_status,asset.accumulated_depreciation,
      asset.net_book_value,asset.depreciation_expense_account_id,asset.accumulated_depreciation_account_id,
      asset.functional_currency_code
    FROM tenant.accounting_asset_depreciation_schedule schedule
    JOIN (
      SELECT asset.*,category.depreciation_expense_account_id,category.accumulated_depreciation_account_id
      FROM tenant.accounting_assets asset JOIN tenant.accounting_asset_categories category ON category.id=asset.category_id
    ) asset ON asset.id=schedule.asset_id
    WHERE schedule.organization_id=$1 AND schedule.id=$2 FOR UPDATE OF schedule`,
    [context.organizationId, scheduleId],
  );
  const schedule = result.rows[0];
  if (!schedule) throw new AccountingError(404, "Depreciation schedule was not found.");
  if (schedule.status === "posted") return getAsset(client, context, schedule.asset_id);
  if (schedule.status !== "planned" || schedule.asset_status !== "in_service") throw new AccountingError(409, "Only planned depreciation for an in-service asset can be posted.");
  const journalId = await loadAssetJournal(client, context, schedule.company_id, schedule.ledger_id);
  const journal = await createJournalEntry(client, context, {
    companyId: schedule.company_id,
    branchId: schedule.branch_id,
    ledgerId: schedule.ledger_id,
    journalId,
    entryDate: schedule.depreciation_date,
    accountingDate: schedule.depreciation_date,
    entryType: "asset",
    reference: schedule.asset_number,
    description: `Depreciation ${schedule.asset_number} · ${schedule.asset_name}`,
    currencyCode: schedule.functional_currency_code,
    lines: [
      { accountId: schedule.depreciation_expense_account_id, branchId: schedule.branch_id, departmentId: schedule.department_id, costCenterId: schedule.cost_center_id, debit: schedule.depreciation_amount, credit: 0, referenceType: "fixed_asset", referenceId: schedule.asset_id },
      { accountId: schedule.accumulated_depreciation_account_id, branchId: schedule.branch_id, departmentId: schedule.department_id, costCenterId: schedule.cost_center_id, debit: 0, credit: schedule.depreciation_amount, referenceType: "fixed_asset", referenceId: schedule.asset_id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "asset_depreciation", sourceId: schedule.asset_id, sourceNumber: schedule.asset_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const accumulated = decimal(schedule.accumulated_depreciation) + decimal(schedule.depreciation_amount);
  const netBook = decimal(schedule.net_book_value) - decimal(schedule.depreciation_amount);
  await client.query(
    `UPDATE tenant.accounting_asset_depreciation_schedule SET status='posted',journal_entry_id=$3,posted_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, schedule.id, journal.entry.id],
  );
  await client.query(
    `UPDATE tenant.accounting_assets SET accumulated_depreciation=$3,net_book_value=$4,
      status=CASE WHEN $4::numeric<=salvage_value THEN 'fully_depreciated' ELSE status END,updated_by=$5
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, schedule.asset_id, asDatabaseDecimal(accumulated), asDatabaseDecimal(netBook > 0n ? netBook : 0n), context.userId],
  );
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (organization_id,asset_id,transaction_type,transaction_date,amount,journal_entry_id,created_by)
     VALUES ($1,$2,'depreciation',$3,$4,$5,$6)`,
    [context.organizationId, schedule.asset_id, schedule.depreciation_date, schedule.depreciation_amount, journal.entry.id, context.userId],
  );
  await event(client, context, "fixed_asset", schedule.asset_id, "accounting.asset.depreciation_posted", null, "posted", { scheduleId, journalEntryId: journal.entry.id });
  return getAsset(client, context, schedule.asset_id);
}

export async function disposeAsset(client, context, assetIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const asset = await lockAsset(client, context, assetIdValue);
  if (!["in_service", "fully_depreciated", "suspended"].includes(asset.status)) throw new AccountingError(409, "Asset is not available for disposal.");
  const disposalDate = isoDate(input.disposalDate || new Date().toISOString().slice(0, 10), "Disposal date");
  const proceeds = roundMoney(decimal(input.proceeds || 0), 6);
  if (proceeds < 0n) throw new AccountingError(400, "Disposal proceeds cannot be negative.");
  const netBook = decimal(asset.net_book_value);
  const gainLoss = proceeds - netBook;
  const journalId = await loadAssetJournal(client, context, asset.company_id, asset.ledger_id);
  const proceedsAccountId = proceeds > 0n
    ? (optionalUuid(input.proceedsAccountId, "Proceeds account") || (await getAccountMapping(client, context, asset.company_id, asset.ledger_id, "bank", { date: disposalDate })).account_id)
    : null;
  const lines = [];
  if (proceeds > 0n) lines.push({ accountId: proceedsAccountId, debit: asDatabaseDecimal(proceeds), credit: 0, referenceType: "fixed_asset", referenceId: asset.id, description: `Disposal proceeds ${asset.asset_number}` });
  const accumulatedContra = decimal(asset.accumulated_depreciation) + decimal(asset.impairment_amount);
  if (accumulatedContra > 0n) lines.push({ accountId: asset.accumulated_depreciation_account_id, debit: asDatabaseDecimal(accumulatedContra), credit: 0, referenceType: "fixed_asset", referenceId: asset.id, description: `Remove accumulated depreciation and impairment ${asset.asset_number}` });
  if (gainLoss < 0n) lines.push({ accountId: asset.disposal_loss_account_id, debit: asDatabaseDecimal(-gainLoss), credit: 0, referenceType: "fixed_asset", referenceId: asset.id, description: `Loss on disposal ${asset.asset_number}` });
  if (gainLoss > 0n) lines.push({ accountId: asset.disposal_gain_account_id, debit: 0, credit: asDatabaseDecimal(gainLoss), referenceType: "fixed_asset", referenceId: asset.id, description: `Gain on disposal ${asset.asset_number}` });
  lines.push({ accountId: asset.asset_account_id, debit: 0, credit: asset.base_acquisition_cost, referenceType: "fixed_asset", referenceId: asset.id, description: `Remove asset cost ${asset.asset_number}` });
  const debit = lines.reduce((total, line) => total + decimal(line.debit || 0), 0n);
  const credit = lines.reduce((total, line) => total + decimal(line.credit || 0), 0n);
  if (debit !== credit) throw new AccountingError(409, "Asset disposal journal does not balance.");
  const journal = await createJournalEntry(client, context, {
    companyId: asset.company_id, branchId: asset.branch_id, ledgerId: asset.ledger_id, journalId,
    entryDate: disposalDate, accountingDate: disposalDate, entryType: "asset", reference: asset.asset_number,
    description: `Disposal of ${asset.asset_number} · ${asset.name}`, currencyCode: asset.functional_currency_code, lines,
  }, { internal: true, sourceModule: "accounting", sourceType: "asset_disposal", sourceId: asset.id, sourceNumber: asset.asset_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  await client.query(
    `UPDATE tenant.accounting_assets SET status=$3,disposed_at=$4,disposal_proceeds=$5,disposal_entry_id=$6,
      net_book_value=0,updated_by=$7 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, asset.id, input.writeoff ? "written_off" : "disposed", disposalDate,
      asDatabaseDecimal(proceeds), journal.entry.id, context.userId],
  );
  await client.query(`UPDATE tenant.accounting_asset_depreciation_schedule SET status='skipped' WHERE organization_id=$1 AND asset_id=$2 AND status='planned'`, [context.organizationId, asset.id]);
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (organization_id,asset_id,transaction_type,transaction_date,amount,journal_entry_id,note,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [context.organizationId, asset.id, input.writeoff ? "writeoff" : "disposal", disposalDate,
      asDatabaseDecimal(proceeds), journal.entry.id, text(input.note, 1000) || null, context.userId],
  );
  await event(client, context, "fixed_asset", asset.id, "accounting.asset.disposed", asset.status, input.writeoff ? "written_off" : "disposed", { journalEntryId: journal.entry.id });
  return getAsset(client, context, asset.id);
}

async function validateAssetOrganisationRefs(client, context, companyId, input) {
  const branch = input.branchId ? await validateBranch(client, context, companyId, input.branchId) : null;
  const departmentId = optionalUuid(input.departmentId, "Department");
  const costCenterId = optionalUuid(input.costCenterId, "Cost centre");
  if (departmentId) {
    const result = await client.query(
      `SELECT id FROM public.departments WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`,
      [context.organizationId, departmentId, companyId],
    );
    if (!result.rows[0]) throw new AccountingError(409, "The destination department is outside the asset company.");
  }
  if (costCenterId) {
    const result = await client.query(
      `SELECT id,department_id FROM public.cost_centers WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`,
      [context.organizationId, costCenterId, companyId],
    );
    if (!result.rows[0]) throw new AccountingError(409, "The destination cost centre is outside the asset company.");
    if (departmentId && result.rows[0].department_id && result.rows[0].department_id !== departmentId) {
      throw new AccountingError(409, "The cost centre does not belong to the selected department.");
    }
  }
  return { branchId: branch?.id || null, departmentId, costCenterId };
}

export async function transferAsset(client, context, assetIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const asset = await lockAsset(client, context, assetIdValue);
  if (!["in_service", "fully_depreciated", "suspended"].includes(asset.status)) {
    throw new AccountingError(409, "Only an active capitalized asset can be transferred.");
  }
  const destination = await validateAssetOrganisationRefs(client, context, asset.company_id, input);
  const transactionDate = isoDate(input.transactionDate || new Date().toISOString().slice(0, 10), "Transfer date");
  const location = text(input.location, 300) || null;
  const custodianUserId = optionalUuid(input.custodianUserId, "Custodian");
  if (custodianUserId) {
    const member = await client.query(
      `SELECT user_id FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
      [context.organizationId, custodianUserId],
    );
    if (!member.rows[0]) throw new AccountingError(409, "The custodian is not an active organisation member.");
  }
  await client.query(
    `UPDATE tenant.accounting_assets SET branch_id=$3,department_id=$4,cost_center_id=$5,
      location=COALESCE($6,location),custodian_user_id=COALESCE($7,custodian_user_id),updated_by=$8
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, asset.id, destination.branchId, destination.departmentId, destination.costCenterId,
      location, custodianUserId, context.userId],
  );
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (
      organization_id,asset_id,transaction_type,transaction_date,from_branch_id,to_branch_id,
      from_department_id,to_department_id,from_cost_center_id,to_cost_center_id,note,created_by
     ) VALUES ($1,$2,'transfer',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [context.organizationId, asset.id, transactionDate, asset.branch_id, destination.branchId,
      asset.department_id, destination.departmentId, asset.cost_center_id, destination.costCenterId,
      requiredText(input.reason, "Transfer reason", 1000), context.userId],
  );
  await event(client, context, "fixed_asset", asset.id, "accounting.asset.transferred", asset.status, asset.status, {
    fromBranchId: asset.branch_id, toBranchId: destination.branchId,
    fromDepartmentId: asset.department_id, toDepartmentId: destination.departmentId,
    fromCostCenterId: asset.cost_center_id, toCostCenterId: destination.costCenterId,
  });
  return getAsset(client, context, asset.id);
}

export async function impairAsset(client, context, assetIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const asset = await lockAsset(client, context, assetIdValue);
  if (!["in_service", "suspended"].includes(asset.status)) throw new AccountingError(409, "Only an in-service or suspended asset can be impaired.");
  const impairmentDate = isoDate(input.impairmentDate || new Date().toISOString().slice(0, 10), "Impairment date");
  const precision = await getCurrencyPrecision(client, context, asset.functional_currency_code);
  const amount = roundMoney(positiveAmount(input.amount, "Impairment amount"), precision);
  const maximum = decimal(asset.net_book_value) - decimal(asset.salvage_value);
  if (amount > maximum) throw new AccountingError(409, "Impairment cannot reduce the asset below its salvage value.");
  const expenseAccountId = optionalUuid(input.expenseAccountId, "Impairment expense account") || asset.disposal_loss_account_id;
  const journalId = await loadAssetJournal(client, context, asset.company_id, asset.ledger_id);
  const journal = await createJournalEntry(client, context, {
    companyId: asset.company_id, branchId: asset.branch_id, ledgerId: asset.ledger_id, journalId,
    entryDate: impairmentDate, accountingDate: impairmentDate, entryType: "asset", reference: asset.asset_number,
    description: `Impairment of ${asset.asset_number} · ${asset.name}`, currencyCode: asset.functional_currency_code,
    lines: [
      { accountId: expenseAccountId, branchId: asset.branch_id, departmentId: asset.department_id, costCenterId: asset.cost_center_id, debit: asDatabaseDecimal(amount), credit: 0, referenceType: "fixed_asset", referenceId: asset.id },
      { accountId: asset.accumulated_depreciation_account_id, branchId: asset.branch_id, departmentId: asset.department_id, costCenterId: asset.cost_center_id, debit: 0, credit: asDatabaseDecimal(amount), referenceType: "fixed_asset", referenceId: asset.id },
    ],
  }, { internal: true, sourceModule: "accounting", sourceType: "asset_impairment", sourceId: asset.id, sourceNumber: asset.asset_number });
  await postJournalEntry(client, context, journal.entry.id, { internal: true, allowDraft: true });
  const newImpairment = decimal(asset.impairment_amount) + amount;
  const newNetBook = decimal(asset.net_book_value) - amount;
  await client.query(
    `UPDATE tenant.accounting_assets SET impairment_amount=$3,net_book_value=$4,updated_by=$5 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, asset.id, asDatabaseDecimal(newImpairment), asDatabaseDecimal(newNetBook), context.userId],
  );
  const planned = await client.query(
    `SELECT id,sequence,depreciation_date FROM tenant.accounting_asset_depreciation_schedule
     WHERE organization_id=$1 AND asset_id=$2 AND status='planned' AND depreciation_date>$3::date ORDER BY sequence FOR UPDATE`,
    [context.organizationId, asset.id, impairmentDate],
  );
  if (planned.rows.length) {
    const remainingDepreciable = newNetBook - decimal(asset.salvage_value);
    const monthly = roundMoney(div(remainingDepreciable, planned.rows.length), precision);
    let opening = newNetBook;
    for (let index = 0; index < planned.rows.length; index += 1) {
      const row = planned.rows[index];
      const depreciation = index === planned.rows.length - 1 ? opening - decimal(asset.salvage_value) : monthly;
      const closing = opening - depreciation;
      await client.query(
        `UPDATE tenant.accounting_asset_depreciation_schedule SET opening_book_value=$3,depreciation_amount=$4,
          closing_book_value=$5 WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, row.id, asDatabaseDecimal(opening), asDatabaseDecimal(depreciation), asDatabaseDecimal(closing)],
      );
      opening = closing;
    }
  }
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (organization_id,asset_id,transaction_type,transaction_date,amount,journal_entry_id,note,created_by)
     VALUES ($1,$2,'impairment',$3,$4,$5,$6,$7)`,
    [context.organizationId, asset.id, impairmentDate, asDatabaseDecimal(amount), journal.entry.id,
      requiredText(input.reason, "Impairment reason", 1000), context.userId],
  );
  await event(client, context, "fixed_asset", asset.id, "accounting.asset.impaired", asset.status, asset.status, { amount: asDatabaseDecimal(amount), journalEntryId: journal.entry.id });
  return getAsset(client, context, asset.id);
}

export async function changeAssetSuspension(client, context, assetIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.assetsManage);
  const asset = await lockAsset(client, context, assetIdValue);
  const suspend = strictBoolean(input.suspend, "Suspend");
  const expected = suspend ? "in_service" : "suspended";
  const next = suspend ? "suspended" : "in_service";
  if (asset.status !== expected) throw new AccountingError(409, `Asset must be ${expected.replace("_", " ")} before this action.`);
  const transactionDate = isoDate(input.transactionDate || new Date().toISOString().slice(0, 10), suspend ? "Suspension date" : "Resumption date");
  await client.query(`UPDATE tenant.accounting_assets SET status=$3,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, asset.id, next, context.userId]);
  await client.query(
    `INSERT INTO tenant.accounting_asset_transactions (organization_id,asset_id,transaction_type,transaction_date,note,created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [context.organizationId, asset.id, suspend ? "suspension" : "resumption", transactionDate,
      requiredText(input.reason, suspend ? "Suspension reason" : "Resumption reason", 1000), context.userId],
  );
  await event(client, context, "fixed_asset", asset.id, suspend ? "accounting.asset.suspended" : "accounting.asset.resumed", asset.status, next, {});
  return getAsset(client, context, asset.id);
}
