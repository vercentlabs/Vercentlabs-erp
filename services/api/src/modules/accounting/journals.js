import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  event,
  getCurrencyPrecision,
  getExchangeRate,
  getOpenPeriod,
  getPrimaryLedger,
  hashPayload,
  isoDate,
  loadCompany,
  optionalUuid,
  requirePermission,
  requiredText,
  roundMoney,
  text,
  toBaseAmount,
  uuid,
  validateBranch,
} from "./core.js";

async function loadJournal(client, context, companyId, ledgerId, journalIdValue) {
  const journalId = uuid(journalIdValue, "Journal");
  const result = await client.query(
    `SELECT * FROM tenant.accounting_journals
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=$4 AND status='active'`,
    [context.organizationId, companyId, ledgerId, journalId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "The accounting journal is unavailable for this company and ledger.");
  return result.rows[0];
}


async function validateLineScopes(client, context, companyId, input) {
  const collect = (key, fallback = null) => [...new Set(input.lines.map((line) => line[key] || fallback).filter(Boolean).map((value) => uuid(value, key)))];
  const partyIds = collect("partyId");
  const branchIds = collect("branchId", input.branchId || null);
  const departmentIds = collect("departmentId");
  const costCenterIds = collect("costCenterId");
  const checks = [
    [partyIds, `SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='active' AND (company_id IS NULL OR company_id=$3)`, "party"],
    [branchIds, `SELECT id FROM public.branches WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND company_id=$3 AND status='active'`, "branch"],
    [departmentIds, `SELECT id FROM public.departments WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='active' AND (company_id IS NULL OR company_id=$3)`, "department"],
    [costCenterIds, `SELECT id FROM public.cost_centers WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='active' AND (company_id IS NULL OR company_id=$3)`, "cost centre"],
  ];
  for (const [ids, query, label] of checks) {
    if (!ids.length) continue;
    const result = await client.query(query, [context.organizationId, ids, companyId]);
    if (result.rows.length !== ids.length) throw new AccountingError(409, `One or more journal ${label} references are outside the active company scope.`);
  }
}

async function normalizeLines(client, context, company, ledger, input, accountingDate, options = {}) {
  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new AccountingError(400, "A journal entry requires at least two lines.");
  const documentCurrency = currency(input.currencyCode || company.base_currency);
  const functionalCurrency = currency(ledger.functional_currency_code);
  const exchangeRate = await getExchangeRate(client, context, company.id, documentCurrency, functionalCurrency, accountingDate, input.exchangeRate);
  const precision = await getCurrencyPrecision(client, context, documentCurrency);
  const basePrecision = await getCurrencyPrecision(client, context, functionalCurrency);
  const precisionCache = new Map([[documentCurrency, precision], [functionalCurrency, basePrecision]]);
  await validateLineScopes(client, context, company.id, input);
  const accountIds = [...new Set(input.lines.map((line) => uuid(line.accountId, "Account")))];
  const accounts = await client.query(
    `SELECT id,code,name,account_class,account_type,is_group,allow_manual_posting,currency_code,status
       FROM tenant.accounting_accounts
      WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=ANY($4::uuid[])`,
    [context.organizationId, company.id, ledger.id, accountIds],
  );
  if (accounts.rows.length !== accountIds.length) throw new AccountingError(409, "One or more journal accounts are outside the active company ledger.");
  const accountMap = new Map(accounts.rows.map((account) => [account.id, account]));
  const dimensionDefinitions = await client.query(
    `SELECT id,code,name,required_for_classes
       FROM tenant.accounting_dimensions
      WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2)`,
    [context.organizationId, company.id],
  );
  const dimensionDefinitionMap = new Map(dimensionDefinitions.rows.map((dimension) => [dimension.id, dimension]));
  const dimensionValueIds = [...new Set(input.lines.flatMap((line) => Array.isArray(line.dimensions)
    ? line.dimensions.map((allocation) => uuid(allocation.dimensionValueId, "Dimension value")) : []))];
  const dimensionValues = dimensionValueIds.length
    ? await client.query(
      `SELECT value.id,value.dimension_id,value.code,value.name
         FROM tenant.accounting_dimension_values value
         JOIN tenant.accounting_dimensions dimension
           ON dimension.organization_id=value.organization_id AND dimension.id=value.dimension_id
        WHERE value.organization_id=$1 AND value.id=ANY($2::uuid[]) AND value.status='active'
          AND dimension.status='active' AND (dimension.company_id IS NULL OR dimension.company_id=$3)`,
      [context.organizationId, dimensionValueIds, company.id],
    ) : { rows: [] };
  if (dimensionValues.rows.length !== dimensionValueIds.length) {
    throw new AccountingError(409, "One or more journal dimension values are inactive or outside the company scope.");
  }
  const dimensionValueMap = new Map(dimensionValues.rows.map((value) => [value.id, value]));
  let totalDebit = 0n;
  let totalCredit = 0n;
  const lines = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    const source = input.lines[index];
    const accountId = uuid(source.accountId, "Account");
    const account = accountMap.get(accountId);
    if (!account || account.status !== "active" || account.is_group || (!options.internal && !account.allow_manual_posting)) {
      throw new AccountingError(409, `Account ${account?.code || accountId} cannot receive this posting.`);
    }
    const lineCurrency = currency(source.currencyCode || documentCurrency);
    if (account.currency_code && account.currency_code !== lineCurrency) throw new AccountingError(409, `Account ${account.code} only accepts ${account.currency_code}.`);
    const lineRate = lineCurrency === documentCurrency
      ? exchangeRate
      : await getExchangeRate(client, context, company.id, lineCurrency, functionalCurrency, accountingDate, source.exchangeRate);
    let linePrecision = precisionCache.get(lineCurrency);
    if (linePrecision === undefined) {
      linePrecision = await getCurrencyPrecision(client, context, lineCurrency);
      precisionCache.set(lineCurrency, linePrecision);
    }
    const debit = roundMoney(decimal(source.debit || 0), linePrecision);
    const credit = roundMoney(decimal(source.credit || 0), linePrecision);
    if ((debit > 0n) === (credit > 0n)) throw new AccountingError(400, `Line ${index + 1} must have either a debit or a credit.`);
    const baseDebit = debit > 0n ? toBaseAmount(debit, lineRate, basePrecision) : 0n;
    const baseCredit = credit > 0n ? toBaseAmount(credit, lineRate, basePrecision) : 0n;
    const dimensionAllocations = Array.isArray(source.dimensions) ? source.dimensions.map((allocation) => {
      const dimensionId = uuid(allocation.dimensionId, "Dimension");
      const dimensionValueId = uuid(allocation.dimensionValueId, "Dimension value");
      const definition = dimensionDefinitionMap.get(dimensionId);
      const value = dimensionValueMap.get(dimensionValueId);
      if (!definition || !value || value.dimension_id !== dimensionId) {
        throw new AccountingError(409, `Line ${index + 1} contains an invalid accounting dimension allocation.`);
      }
      const allocationPercent = decimal(allocation.allocationPercent ?? 100);
      if (allocationPercent <= 0n || allocationPercent > decimal(100)) {
        throw new AccountingError(400, `Line ${index + 1} dimension allocation must be greater than zero and no more than 100%.`);
      }
      return { dimensionId, dimensionValueId, allocationPercent };
    }) : [];
    const duplicateAllocationKeys = new Set();
    const dimensionTotals = new Map();
    for (const allocation of dimensionAllocations) {
      const key = `${allocation.dimensionId}:${allocation.dimensionValueId}`;
      if (duplicateAllocationKeys.has(key)) throw new AccountingError(409, `Line ${index + 1} repeats a dimension value.`);
      duplicateAllocationKeys.add(key);
      dimensionTotals.set(allocation.dimensionId, (dimensionTotals.get(allocation.dimensionId) || 0n) + allocation.allocationPercent);
    }
    for (const [dimensionId, total] of dimensionTotals) {
      if (total !== decimal(100)) {
        const definition = dimensionDefinitionMap.get(dimensionId);
        throw new AccountingError(409, `Line ${index + 1} allocations for ${definition?.name || "the dimension"} must total exactly 100%.`);
      }
    }
    for (const definition of dimensionDefinitions.rows) {
      const requiredFor = Array.isArray(definition.required_for_classes) ? definition.required_for_classes : [];
      if ((requiredFor.includes(account.account_class) || requiredFor.includes(account.account_type)) && !dimensionTotals.has(definition.id)) {
        throw new AccountingError(409, `Line ${index + 1} requires the ${definition.name} accounting dimension.`);
      }
    }
    totalDebit += baseDebit;
    totalCredit += baseCredit;
    lines.push({
      sequence: index + 1,
      accountId,
      partyId: optionalUuid(source.partyId, "Party"),
      branchId: optionalUuid(source.branchId || input.branchId, "Branch"),
      departmentId: optionalUuid(source.departmentId, "Department"),
      costCenterId: optionalUuid(source.costCenterId, "Cost centre"),
      description: text(source.description, 1000) || null,
      currencyCode: lineCurrency,
      exchangeRate: lineRate,
      debit,
      credit,
      baseDebit,
      baseCredit,
      dueDate: source.dueDate ? isoDate(source.dueDate, "Due date") : null,
      referenceType: text(source.referenceType, 100) || null,
      referenceId: optionalUuid(source.referenceId, "Reference"),
      taxCode: text(source.taxCode, 50) || null,
      taxBaseAmount: decimal(source.taxBaseAmount || 0),
      metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {},
      dimensions: dimensionAllocations,
    });
  }
  if (totalDebit !== totalCredit) throw new AccountingError(409, `Journal is not balanced. Base debit ${asDatabaseDecimal(totalDebit)} does not equal base credit ${asDatabaseDecimal(totalCredit)}.`);
  return { lines, documentCurrency, functionalCurrency, exchangeRate, totalDebit, totalCredit, precision, basePrecision };
}

async function insertJournalLines(client, context, entryId, lines) {
  for (const line of lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.accounting_journal_lines (
        organization_id,journal_entry_id,sequence,account_id,party_id,branch_id,department_id,cost_center_id,
        description,currency_code,exchange_rate,debit_amount,credit_amount,base_debit_amount,base_credit_amount,
        due_date,reference_type,reference_id,tax_code,tax_base_amount,metadata,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
      RETURNING id`,
      [context.organizationId, entryId, line.sequence, line.accountId, line.partyId, line.branchId, line.departmentId,
        line.costCenterId, line.description, line.currencyCode, asDatabaseDecimal(line.exchangeRate),
        asDatabaseDecimal(line.debit), asDatabaseDecimal(line.credit), asDatabaseDecimal(line.baseDebit),
        asDatabaseDecimal(line.baseCredit), line.dueDate, line.referenceType, line.referenceId, line.taxCode,
        asDatabaseDecimal(line.taxBaseAmount), JSON.stringify(line.metadata), context.userId],
    );
    for (const allocation of line.dimensions || []) {
      await client.query(
        `INSERT INTO tenant.accounting_line_dimensions
          (organization_id,journal_line_id,dimension_id,dimension_value_id,allocation_percent)
         VALUES ($1,$2,$3,$4,$5)`,
        [context.organizationId, inserted.rows[0].id, allocation.dimensionId, allocation.dimensionValueId,
          asDatabaseDecimal(allocation.allocationPercent)],
      );
    }
  }
}

export async function createJournalEntry(client, context, input, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const journal = await loadJournal(client, context, company.id, ledger.id, input.journalId);
  const accountingDate = isoDate(input.accountingDate || input.entryDate, "Accounting date");
  const period = await getOpenPeriod(client, context, company.id, accountingDate);
  const normalized = await normalizeLines(client, context, company, ledger, input, accountingDate, options);
  const entryNumber = await allocateNumber(client, context.organizationId, "journal_entry");
  const contentHash = hashPayload({ input, lines: normalized.lines.map((line) => ({ ...line, debit: String(line.debit), credit: String(line.credit) })) });
  const result = await client.query(
    `INSERT INTO tenant.accounting_journal_entries (
      organization_id,company_id,branch_id,ledger_id,journal_id,fiscal_period_id,entry_number,entry_date,
      accounting_date,document_date,entry_type,source_module,source_type,source_id,source_number,reference,
      description,currency_code,functional_currency_code,exchange_rate,status,content_hash,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'draft',$21,$22,$22)
    RETURNING *`,
    [context.organizationId, company.id, branch?.id || null, ledger.id, journal.id, period.id, entryNumber,
      isoDate(input.entryDate || accountingDate, "Entry date"), accountingDate,
      input.documentDate ? isoDate(input.documentDate, "Document date") : null,
      text(input.entryType, 50) || "standard", text(options.sourceModule || input.sourceModule, 50) || "accounting",
      text(options.sourceType || input.sourceType, 100) || null, optionalUuid(options.sourceId || input.sourceId, "Source"),
      text(options.sourceNumber || input.sourceNumber, 100) || null, text(input.reference, 200) || null,
      requiredText(input.description, "Description", 1000), normalized.documentCurrency, normalized.functionalCurrency,
      asDatabaseDecimal(normalized.exchangeRate), contentHash, context.userId],
  );
  const entry = result.rows[0];
  await insertJournalLines(client, context, entry.id, normalized.lines);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.created", null, "draft", { entryNumber });
  return { entry, lines: normalized.lines.map((line) => ({ ...line, debit: asDatabaseDecimal(line.debit), credit: asDatabaseDecimal(line.credit) })) };
}

export async function listJournalEntries(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND entry.company_id=$${values.length}`; }
  if (filters.companyId) { values.push(uuid(filters.companyId, "Company")); where += ` AND entry.company_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND entry.status=$${values.length}`; }
  if (filters.search) { values.push(`%${text(filters.search, 100)}%`); where += ` AND (entry.entry_number ILIKE $${values.length} OR entry.description ILIKE $${values.length} OR entry.reference ILIKE $${values.length})`; }
  const result = await client.query(
    `SELECT entry.id,entry.entry_number,entry.accounting_date,entry.entry_type,entry.description,entry.reference,
            entry.currency_code,entry.functional_currency_code,entry.status,entry.source_module,entry.source_type,
            journal.code AS journal_code,journal.name AS journal_name,company.name AS company_name,
            COALESCE(sum(line.base_debit_amount),0) AS total_debit
       FROM tenant.accounting_journal_entries entry
       JOIN tenant.accounting_journals journal ON journal.id=entry.journal_id
       JOIN public.companies company ON company.id=entry.company_id
       LEFT JOIN tenant.accounting_journal_lines line ON line.journal_entry_id=entry.id
      WHERE entry.organization_id=$1${where}
      GROUP BY entry.id,journal.code,journal.name,company.name
      ORDER BY entry.accounting_date DESC,entry.created_at DESC LIMIT 300`,
    values,
  );
  return result.rows;
}

export async function getJournalEntry(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Journal entry");
  const result = await client.query(
    `SELECT entry.*,journal.code AS journal_code,journal.name AS journal_name,company.name AS company_name,
            period.name AS period_name
       FROM tenant.accounting_journal_entries entry
       JOIN tenant.accounting_journals journal ON journal.id=entry.journal_id
       JOIN public.companies company ON company.id=entry.company_id
       JOIN tenant.fiscal_periods period ON period.id=entry.fiscal_period_id
      WHERE entry.organization_id=$1 AND entry.id=$2`,
    [context.organizationId, id],
  );
  const entry = result.rows[0];
  if (!entry) throw new AccountingError(404, "Journal entry not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && entry.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the journal company to view it.");
  // Sequential, not Promise.all: a single pg client can only run one query at a time (concurrent
  // queries on the same connection are deprecated and will error in pg@9) -- same fix applied
  // to getCustomerInvoice/getVendorBill above.
  const lines = await client.query(
    `SELECT line.*,account.code AS account_code,account.name AS account_name,party.display_name AS party_name,
            branch.name AS branch_name,department.name AS department_name,cost_center.name AS cost_center_name
       FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_accounts account ON account.id=line.account_id
       LEFT JOIN tenant.business_parties party ON party.id=line.party_id
       LEFT JOIN public.branches branch ON branch.id=line.branch_id
       LEFT JOIN public.departments department ON department.id=line.department_id
       LEFT JOIN public.cost_centers cost_center ON cost_center.id=line.cost_center_id
      WHERE line.organization_id=$1 AND line.journal_entry_id=$2 ORDER BY line.sequence`,
    [context.organizationId, id],
  );
  const lineDimensions = await client.query(
    `SELECT allocation.journal_line_id,allocation.dimension_id,allocation.dimension_value_id,allocation.allocation_percent,
            dimension.code AS dimension_code,dimension.name AS dimension_name,
            value.code AS value_code,value.name AS value_name
       FROM tenant.accounting_line_dimensions allocation
       JOIN tenant.accounting_journal_lines line
         ON line.organization_id=allocation.organization_id AND line.id=allocation.journal_line_id
       JOIN tenant.accounting_dimensions dimension
         ON dimension.organization_id=allocation.organization_id AND dimension.id=allocation.dimension_id
       JOIN tenant.accounting_dimension_values value
         ON value.organization_id=allocation.organization_id AND value.id=allocation.dimension_value_id
      WHERE allocation.organization_id=$1 AND line.journal_entry_id=$2
      ORDER BY line.sequence,dimension.code,value.code`,
    [context.organizationId, id],
  );
  const events = await client.query(`SELECT * FROM tenant.accounting_events WHERE organization_id=$1 AND entity_type='journal_entry' AND entity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, id]);
  const dimensionsByLine = new Map();
  for (const allocation of lineDimensions.rows) {
    const current = dimensionsByLine.get(allocation.journal_line_id) || [];
    current.push(allocation);
    dimensionsByLine.set(allocation.journal_line_id, current);
  }
  return { entry, lines: lines.rows.map((line) => ({ ...line, dimensions: dimensionsByLine.get(line.id) || [] })), events: events.rows };
}

async function lockEntry(client, context, idValue) {
  const id = uuid(idValue, "Journal entry");
  const result = await client.query(`SELECT * FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const entry = result.rows[0];
  if (!entry) throw new AccountingError(404, "Journal entry not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && entry.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the journal company before changing it.");
  return entry;
}

export async function submitJournalEntry(client, context, idValue, assignedTo = null) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalSubmit);
  const entry = await lockEntry(client, context, idValue);
  if (entry.status !== "draft" && entry.status !== "rejected") throw new AccountingError(409, "Only a draft or rejected journal can be submitted.");
  const totals = await client.query(`SELECT count(*)::int AS line_count,COALESCE(sum(base_debit_amount),0) AS debit,COALESCE(sum(base_credit_amount),0) AS credit FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [context.organizationId, entry.id]);
  const total = totals.rows[0];
  if (Number(total.line_count) < 2 || decimal(total.debit) !== decimal(total.credit)) throw new AccountingError(409, "Journal must contain at least two balanced lines.");
  const rules = await client.query(
    `SELECT journal.approval_required,settings.journal_approval_threshold
       FROM tenant.accounting_journals journal
       LEFT JOIN tenant.accounting_settings settings ON settings.organization_id=journal.organization_id AND settings.company_id=journal.company_id
      WHERE journal.organization_id=$1 AND journal.id=$2`,
    [context.organizationId, entry.journal_id],
  );
  const approvalRequired = Boolean(rules.rows[0]?.approval_required) || decimal(total.debit) >= decimal(rules.rows[0]?.journal_approval_threshold || 0);
  if (!approvalRequired) {
    await client.query(`UPDATE tenant.accounting_journal_entries SET status='approved',submitted_at=now(),submitted_by=$3,approved_at=now(),approved_by=$3,updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, entry.id, context.userId]);
    await event(client, context, "journal_entry", entry.id, "accounting.journal.auto_approved", entry.status, "approved", {});
    return { status: "approved", approvalRequired: false };
  }
  const approval = await client.query(
    `INSERT INTO public.approval_requests (
      organization_id,entity_type,entity_id,title,status,requested_by,assigned_to,command_key,command_payload
    ) VALUES ($1,'accounting_journal_entry',$2,$3,'pending',$4,$5,'accounting.journal.approve',$6::jsonb)
    RETURNING id,status,version`,
    [context.organizationId, entry.id, `Approve journal ${entry.entry_number}`, context.userId,
      assignedTo ? uuid(assignedTo, "Approver") : null, JSON.stringify({ journalEntryId: entry.id, contentHash: entry.content_hash })],
  );
  await client.query(`UPDATE tenant.accounting_journal_entries SET status='pending_approval',approval_request_id=$3,submitted_at=now(),submitted_by=$4,updated_by=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, entry.id, approval.rows[0].id, context.userId]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.submitted", entry.status, "pending_approval", { approvalRequestId: approval.rows[0].id });
  return { status: "pending_approval", approvalRequired: true, approvalRequest: approval.rows[0] };
}

export async function approveJournalEntry(client, context, idValue, contentHash) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalApprove);
  const entry = await lockEntry(client, context, idValue);
  if (entry.status !== "pending_approval") throw new AccountingError(409, "Journal is not awaiting approval.");
  if (entry.content_hash !== contentHash) throw new AccountingError(409, "Journal content changed after approval was requested.");
  if (entry.submitted_by && entry.submitted_by === context.userId) throw new AccountingError(409, "The submitter cannot approve the same journal.");
  await client.query(`UPDATE tenant.accounting_journal_entries SET status='approved',approved_at=now(),approved_by=$3,updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, entry.id, context.userId]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.approved", entry.status, "approved", {});
  return { id: entry.id, status: "approved" };
}

export async function rejectJournalApproval(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalApprove);
  const entry = await lockEntry(client, context, idValue);
  if (entry.status !== "pending_approval") return { id: entry.id, status: entry.status };
  await client.query(`UPDATE tenant.accounting_journal_entries SET status='rejected',updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, entry.id, context.userId]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.rejected", entry.status, "rejected", {});
  return { id: entry.id, status: "rejected" };
}

export async function postJournalEntry(client, context, idValue, options = {}) {
  if (!options.internal) requirePermission(context, ACCOUNTING_PERMISSIONS.journalPost);
  const entry = await lockEntry(client, context, idValue);
  if (entry.status !== "approved" && !(options.allowDraft && entry.status === "draft")) throw new AccountingError(409, "Only an approved journal can be posted.");
  await getOpenPeriod(client, context, entry.company_id, entry.accounting_date);
  const updated = await client.query(
    `UPDATE tenant.accounting_journal_entries SET status='posted',posted_at=now(),posted_by=$3,updated_by=$3
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, entry.id, context.userId],
  );
  await event(client, context, "journal_entry", entry.id, "accounting.journal.posted", entry.status, "posted", {});
  return updated.rows[0];
}

export async function reverseJournalEntry(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalReverse);
  const original = await lockEntry(client, context, idValue);
  if (original.status !== "posted") throw new AccountingError(409, "Only a posted journal can be reversed.");
  if (original.reversed_by_id) return getJournalEntry(client, context, original.reversed_by_id);
  const detail = await getJournalEntry(client, context, original.id);
  const accountingDate = isoDate(input.accountingDate || new Date().toISOString().slice(0, 10), "Reversal date");
  const reversal = await createJournalEntry(client, context, {
    companyId: original.company_id,
    branchId: original.branch_id,
    ledgerId: original.ledger_id,
    journalId: original.journal_id,
    entryDate: accountingDate,
    accountingDate,
    entryType: "reversal",
    reference: original.entry_number,
    description: `Reversal of ${original.entry_number}: ${requiredText(input.reason, "Reversal reason", 500)}`,
    currencyCode: original.currency_code,
    exchangeRate: original.exchange_rate,
    lines: detail.lines.map((line) => ({
      accountId: line.account_id,
      partyId: line.party_id,
      branchId: line.branch_id,
      departmentId: line.department_id,
      costCenterId: line.cost_center_id,
      description: `Reversal: ${line.description || original.description}`,
      debit: line.credit_amount,
      credit: line.debit_amount,
      currencyCode: line.currency_code,
      exchangeRate: line.exchange_rate,
      referenceType: "journal_entry",
      referenceId: original.id,
      dimensions: Array.isArray(line.dimensions) ? line.dimensions.map((allocation) => ({
        dimensionId: allocation.dimension_id,
        dimensionValueId: allocation.dimension_value_id,
        allocationPercent: allocation.allocation_percent,
      })) : [],
    })),
  }, { internal: true, sourceModule: "accounting", sourceType: "journal_reversal", sourceId: original.id, sourceNumber: original.entry_number });
  await client.query(`UPDATE tenant.accounting_journal_entries SET reversal_of_id=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, reversal.entry.id, original.id]);
  await postJournalEntry(client, context, reversal.entry.id, { internal: true, allowDraft: true });
  await client.query(`UPDATE tenant.accounting_journal_entries SET status='reversed',reversed_by_id=$3,reversal_reason=$4,updated_by=$5 WHERE organization_id=$1 AND id=$2`, [context.organizationId, original.id, reversal.entry.id, text(input.reason, 1000), context.userId]);
  await event(client, context, "journal_entry", original.id, "accounting.journal.reversed", "posted", "reversed", { reversalEntryId: reversal.entry.id });
  return getJournalEntry(client, context, reversal.entry.id);
}
