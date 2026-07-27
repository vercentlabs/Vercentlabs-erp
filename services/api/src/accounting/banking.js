import { createHash } from "node:crypto";

import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  event,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  optionalUuid,
  requirePermission,
  requiredText,
  text,
  uuid,
  validateBranch,
} from "./core.js";


function parseCsvRows(csvText, mapping = {}) {
  const rows = [];
  let row = []; let field = ""; let quoted = false;
  const textValue = String(csvText || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index];
    if (quoted && char === '"' && textValue[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ',') { row.push(field); field = ""; continue; }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && textValue[index + 1] === '\n') index += 1;
      row.push(field); field = "";
      if (row.some((value) => String(value).trim() !== "")) rows.push(row);
      row = []; continue;
    }
    field += char;
  }
  row.push(field); if (row.some((value) => String(value).trim() !== "")) rows.push(row);
  if (quoted) throw new AccountingError(400, "CSV statement contains an unterminated quoted field.");
  if (rows.length < 2) throw new AccountingError(400, "CSV statement must contain a header and at least one transaction.");
  const headers = rows[0].map((value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const column = (name, aliases) => {
    const configured = mapping[name] ? String(mapping[name]).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_") : null;
    const candidates = configured ? [configured, ...aliases] : aliases;
    return candidates.map((candidate) => headers.indexOf(candidate)).find((index) => index >= 0) ?? -1;
  };
  const indexes = {
    transactionDate: column("transactionDate", ["transaction_date", "date", "txn_date", "posting_date"]),
    valueDate: column("valueDate", ["value_date"]), externalId: column("externalId", ["external_id", "transaction_id", "txn_id", "utr"]),
    reference: column("reference", ["reference", "ref", "cheque_number"]), description: column("description", ["description", "narration", "memo"]),
    counterpartyName: column("counterpartyName", ["counterparty_name", "payee", "payer", "beneficiary"]),
    counterpartyAccount: column("counterpartyAccount", ["counterparty_account", "account_number"]),
    debitAmount: column("debitAmount", ["debit_amount", "debit", "withdrawal"]), creditAmount: column("creditAmount", ["credit_amount", "credit", "deposit"]),
    amount: column("amount", ["amount"]), type: column("type", ["type", "debit_credit", "dr_cr"]), balance: column("balance", ["balance", "closing_balance"]),
  };
  if (indexes.transactionDate < 0) throw new AccountingError(400, "CSV statement requires a transaction date column.");
  const numeric = (value) => String(value ?? "").replace(/[,$₹£€\s]/g, "").replace(/^\((.*)\)$/, "-$1") || "0";
  return rows.slice(1).map((values, index) => {
    let debit = indexes.debitAmount >= 0 ? numeric(values[indexes.debitAmount]) : "0";
    let credit = indexes.creditAmount >= 0 ? numeric(values[indexes.creditAmount]) : "0";
    if (indexes.amount >= 0 && decimal(debit) === 0n && decimal(credit) === 0n) {
      const amount = decimal(numeric(values[indexes.amount]));
      const type = indexes.type >= 0 ? String(values[indexes.type] || "").trim().toLowerCase() : "";
      const isDebit = type.startsWith("d") || type.includes("withdraw") || amount < 0n;
      debit = asDatabaseDecimal(isDebit ? (amount < 0n ? -amount : amount) : 0);
      credit = asDatabaseDecimal(isDebit ? 0 : amount);
    }
    return {
      transactionDate: String(values[indexes.transactionDate] || "").trim(),
      valueDate: indexes.valueDate >= 0 ? String(values[indexes.valueDate] || "").trim() || null : null,
      externalId: indexes.externalId >= 0 ? String(values[indexes.externalId] || "").trim() || null : null,
      reference: indexes.reference >= 0 ? String(values[indexes.reference] || "").trim() || null : null,
      description: indexes.description >= 0 ? String(values[indexes.description] || "").trim() || null : null,
      counterpartyName: indexes.counterpartyName >= 0 ? String(values[indexes.counterpartyName] || "").trim() || null : null,
      counterpartyAccount: indexes.counterpartyAccount >= 0 ? String(values[indexes.counterpartyAccount] || "").trim() || null : null,
      debitAmount: debit, creditAmount: credit, balance: indexes.balance >= 0 ? numeric(values[indexes.balance]) : null,
      csvRow: index + 2,
    };
  });
}

export async function listBankAccounts(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND bank.company_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 20)); where += ` AND bank.status=$${values.length}`; }
  const result = await client.query(`SELECT bank.*,account.code AS gl_account_code,account.name AS gl_account_name,company.name AS company_name,branch.name AS branch_name FROM tenant.accounting_bank_accounts bank JOIN tenant.accounting_accounts account ON account.id=bank.gl_account_id JOIN public.companies company ON company.id=bank.company_id LEFT JOIN public.branches branch ON branch.id=bank.branch_id WHERE bank.organization_id=$1${where} ORDER BY company.name,bank.code`, values);
  return result.rows;
}

export async function createBankAccount(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const company = await loadCompany(client, context, input.companyId);
  const branch = await validateBranch(client, context, company.id, input.branchId || context.activeBranchId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const glAccountId = uuid(input.glAccountId, "Bank GL account");
  const accountResult = await client.query(`SELECT id,account_type,currency_code,status FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND id=$4`, [context.organizationId, company.id, ledger.id, glAccountId]);
  const account = accountResult.rows[0];
  if (!account || account.status !== "active" || !['bank','cash'].includes(account.account_type)) throw new AccountingError(409, "The GL account must be an active bank or cash account.");
  const result = await client.query(`INSERT INTO tenant.accounting_bank_accounts (organization_id,company_id,branch_id,ledger_id,gl_account_id,code,bank_name,account_name,masked_account_number,ifsc_swift,currency_code,account_type,statement_import_format,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$14) RETURNING *`, [context.organizationId, company.id, branch?.id || null, ledger.id, glAccountId, requiredText(input.code, "Bank code", 30).toUpperCase(), requiredText(input.bankName, "Bank name", 200), requiredText(input.accountName, "Account name", 200), text(input.maskedAccountNumber, 100) || null, text(input.ifscSwift, 50) || null, currency(input.currencyCode || account.currency_code || company.base_currency), ["current","savings","cash","credit_card","loan","virtual","other"].includes(input.accountType) ? input.accountType : "current", ["csv","ofx","mt940","camt053","api","manual"].includes(input.statementImportFormat) ? input.statementImportFormat : "csv", context.userId]);
  await event(client, context, "bank_account", result.rows[0].id, "accounting.bank_account.created", null, "active", {});
  return result.rows[0];
}

export async function importBankStatement(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const bankId = uuid(input.bankAccountId, "Bank account");
  const bankResult = await client.query(`SELECT * FROM tenant.accounting_bank_accounts WHERE organization_id=$1 AND id=$2 AND status='active' FOR UPDATE`, [context.organizationId, bankId]);
  const bank = bankResult.rows[0];
  if (!bank) throw new AccountingError(404, "Bank account not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && bank.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the bank account company before importing a statement.");
  const csvText = typeof input.csvText === "string" ? input.csvText : null;
  const statementLines = Array.isArray(input.lines) && input.lines.length ? input.lines
    : csvText ? parseCsvRows(csvText, input.columnMapping || {}) : [];
  if (!statementLines.length) throw new AccountingError(400, "A bank statement requires transaction lines or CSV content.");
  const importSource = text(input.importSource, 30) || (csvText ? "csv" : "manual");
  if (!["csv", "api", "manual"].includes(importSource) && !Array.isArray(input.lines)) {
    throw new AccountingError(409, `${importSource.toUpperCase()} requires a configured parser adapter; submit normalized lines through the adapter.`);
  }
  const sourceHash = text(input.sourceHash, 128) || (csvText ? createHash("sha256").update(csvText).digest("hex") : null);
  if (sourceHash) {
    const duplicate = await client.query(`SELECT id,statement_number FROM tenant.accounting_bank_statements WHERE organization_id=$1 AND bank_account_id=$2 AND source_hash=$3`, [context.organizationId, bank.id, sourceHash]);
    if (duplicate.rows[0]) return getBankStatement(client, context, duplicate.rows[0].id);
  }
  const statementNumber = input.statementNumber ? requiredText(input.statementNumber, "Statement number", 100) : await allocateNumber(client, context.organizationId, "bank_statement");
  const periodStart = isoDate(input.periodStart, "Statement start date");
  const periodEnd = isoDate(input.periodEnd, "Statement end date");
  if (periodStart > periodEnd) throw new AccountingError(400, "Statement start date cannot be after the end date.");
  const result = await client.query(`INSERT INTO tenant.accounting_bank_statements (organization_id,company_id,bank_account_id,statement_number,statement_date,period_start,period_end,opening_balance,closing_balance,currency_code,import_source,source_file_name,source_hash,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'imported',$14,$14) RETURNING *`, [context.organizationId, bank.company_id, bank.id, statementNumber, isoDate(input.statementDate || periodEnd, "Statement date"), periodStart, periodEnd, asDatabaseDecimal(decimal(input.openingBalance || 0)), asDatabaseDecimal(decimal(input.closingBalance || 0)), currency(input.currencyCode || bank.currency_code), importSource, text(input.sourceFileName, 255) || null, sourceHash, context.userId]);
  const statement = result.rows[0];
  for (let index = 0; index < statementLines.length; index += 1) {
    const line = statementLines[index];
    const debit = decimal(line.debitAmount || 0); const credit = decimal(line.creditAmount || 0);
    if ((debit > 0n) === (credit > 0n)) throw new AccountingError(400, `Bank statement line ${index + 1} must be a debit or credit.`);
    await client.query(`INSERT INTO tenant.accounting_bank_statement_lines (organization_id,bank_statement_id,sequence,transaction_date,value_date,external_id,reference,description,counterparty_name,counterparty_account,debit_amount,credit_amount,balance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [context.organizationId, statement.id, index + 1, isoDate(line.transactionDate, `Line ${index + 1} transaction date`), line.valueDate ? isoDate(line.valueDate, `Line ${index + 1} value date`) : null, text(line.externalId, 200) || null, text(line.reference, 500) || null, text(line.description, 1000) || null, text(line.counterpartyName, 300) || null, text(line.counterpartyAccount, 200) || null, asDatabaseDecimal(debit), asDatabaseDecimal(credit), line.balance === undefined || line.balance === null ? null : asDatabaseDecimal(decimal(line.balance))]);
  }
  await event(client, context, "bank_statement", statement.id, "accounting.bank_statement.imported", null, "imported", { statementNumber, lineCount: statementLines.length, importSource, sourceHash });
  return getBankStatement(client, context, statement.id);
}

export async function listBankStatements(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND statement.company_id=$${values.length}`; }
  if (filters.bankAccountId) { values.push(uuid(filters.bankAccountId, "Bank account")); where += ` AND statement.bank_account_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND statement.status=$${values.length}`; }
  const result = await client.query(`SELECT statement.*,bank.code AS bank_code,bank.bank_name,bank.account_name,COALESCE(sum(CASE WHEN line.match_status='matched' THEN 1 ELSE 0 END),0)::int AS matched_lines,count(line.id)::int AS total_lines FROM tenant.accounting_bank_statements statement JOIN tenant.accounting_bank_accounts bank ON bank.id=statement.bank_account_id LEFT JOIN tenant.accounting_bank_statement_lines line ON line.bank_statement_id=statement.id WHERE statement.organization_id=$1${where} GROUP BY statement.id,bank.code,bank.bank_name,bank.account_name ORDER BY statement.statement_date DESC,statement.created_at DESC LIMIT 200`, values);
  return result.rows;
}

export async function getBankStatement(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(idValue, "Bank statement");
  const result = await client.query(`SELECT statement.*,bank.code AS bank_code,bank.bank_name,bank.account_name,bank.gl_account_id FROM tenant.accounting_bank_statements statement JOIN tenant.accounting_bank_accounts bank ON bank.id=statement.bank_account_id WHERE statement.organization_id=$1 AND statement.id=$2`, [context.organizationId, id]);
  const statement = result.rows[0];
  if (!statement) throw new AccountingError(404, "Bank statement not found.");
  const lines = await client.query(`SELECT line.*,COALESCE(jsonb_agg(jsonb_build_object('id',match.id,'journalLineId',match.journal_line_id,'matchType',match.match_type,'matchedAmount',match.matched_amount,'confidence',match.confidence)) FILTER (WHERE match.id IS NOT NULL),'[]'::jsonb) AS matches FROM tenant.accounting_bank_statement_lines line LEFT JOIN tenant.accounting_reconciliation_matches match ON match.statement_line_id=line.id WHERE line.organization_id=$1 AND line.bank_statement_id=$2 GROUP BY line.id ORDER BY line.sequence`, [context.organizationId, id]);
  return { statement, lines: lines.rows };
}

export async function suggestBankMatches(client, context, statementLineIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const lineId = uuid(statementLineIdValue, "Statement line");
  const lineResult = await client.query(`SELECT line.*,statement.company_id,statement.bank_account_id,bank.gl_account_id FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id=line.bank_statement_id JOIN tenant.accounting_bank_accounts bank ON bank.id=statement.bank_account_id WHERE line.organization_id=$1 AND line.id=$2`, [context.organizationId, lineId]);
  const line = lineResult.rows[0];
  if (!line) throw new AccountingError(404, "Bank statement line not found.");
  const amount = decimal(line.debit_amount) > 0n ? line.debit_amount : line.credit_amount;
  const candidates = await client.query(`SELECT journal_line.id AS journal_line_id,entry.entry_number,entry.accounting_date,entry.reference,entry.description,journal_line.debit_amount,journal_line.credit_amount,journal_line.base_debit_amount,journal_line.base_credit_amount,party.display_name AS party_name,
    CASE WHEN abs((CASE WHEN $5::boolean THEN journal_line.credit_amount ELSE journal_line.debit_amount END)-$4::numeric)<0.01 THEN 100 ELSE 70 END AS confidence
    FROM tenant.accounting_journal_lines journal_line JOIN tenant.accounting_journal_entries entry ON entry.id=journal_line.journal_entry_id LEFT JOIN tenant.business_parties party ON party.id=journal_line.party_id
    WHERE journal_line.organization_id=$1 AND entry.company_id=$2 AND journal_line.account_id=$3 AND entry.status='posted'
      AND abs((CASE WHEN $5::boolean THEN journal_line.credit_amount ELSE journal_line.debit_amount END)-$4::numeric)<=greatest(1,$4::numeric*0.01)
      AND entry.accounting_date BETWEEN $6::date-INTERVAL '10 days' AND $6::date+INTERVAL '10 days'
      AND NOT EXISTS (SELECT 1 FROM tenant.accounting_reconciliation_matches match WHERE match.organization_id=$1 AND match.journal_line_id=journal_line.id)
    ORDER BY confidence DESC,abs(entry.accounting_date-$6::date),entry.created_at DESC LIMIT 20`, [context.organizationId, line.company_id, line.gl_account_id, amount, decimal(line.credit_amount) > 0n, line.transaction_date]);
  return candidates.rows;
}

export async function startBankReconciliation(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const statementId = uuid(input.bankStatementId, "Bank statement");
  const statementResult = await client.query(`SELECT statement.*,bank.gl_account_id FROM tenant.accounting_bank_statements statement JOIN tenant.accounting_bank_accounts bank ON bank.id=statement.bank_account_id WHERE statement.organization_id=$1 AND statement.id=$2 FOR UPDATE`, [context.organizationId, statementId]);
  const statement = statementResult.rows[0];
  if (!statement) throw new AccountingError(404, "Bank statement not found.");
  const ledger = await client.query(`SELECT COALESCE(sum(line.base_debit_amount-line.base_credit_amount),0) AS balance FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id WHERE line.organization_id=$1 AND line.account_id=$2 AND entry.status='posted' AND entry.accounting_date<=$3::date`, [context.organizationId, statement.gl_account_id, statement.period_end]);
  const ledgerBalance = decimal(ledger.rows[0]?.balance || 0);
  const statementBalance = decimal(statement.closing_balance);
  const difference = statementBalance - ledgerBalance;
  const result = await client.query(`INSERT INTO tenant.accounting_reconciliations (organization_id,company_id,bank_account_id,bank_statement_id,reconciliation_date,statement_balance,ledger_balance,difference,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_progress',$9) ON CONFLICT (organization_id,bank_account_id,reconciliation_date) DO UPDATE SET bank_statement_id=EXCLUDED.bank_statement_id,statement_balance=EXCLUDED.statement_balance,ledger_balance=EXCLUDED.ledger_balance,difference=EXCLUDED.difference,status='in_progress' RETURNING *`, [context.organizationId, statement.company_id, statement.bank_account_id, statement.id, statement.period_end, asDatabaseDecimal(statementBalance), asDatabaseDecimal(ledgerBalance), asDatabaseDecimal(difference), context.userId]);
  await client.query(`UPDATE tenant.accounting_bank_statements SET status='reconciling',updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, statement.id, context.userId]);
  return result.rows[0];
}

export async function matchBankStatementLine(client, context, reconciliationIdValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const reconciliationId = uuid(reconciliationIdValue, "Reconciliation");
  const statementLineId = uuid(input.statementLineId, "Statement line");
  const journalLineId = optionalUuid(input.journalLineId, "Journal line");
  const reconciliationResult = await client.query(`SELECT * FROM tenant.accounting_reconciliations WHERE organization_id=$1 AND id=$2 AND status IN ('in_progress','reopened') FOR UPDATE`, [context.organizationId, reconciliationId]);
  const reconciliation = reconciliationResult.rows[0];
  if (!reconciliation) throw new AccountingError(409, "Bank reconciliation is not open.");
  const lineResult = await client.query(`SELECT line.* FROM tenant.accounting_bank_statement_lines line JOIN tenant.accounting_bank_statements statement ON statement.id=line.bank_statement_id WHERE line.organization_id=$1 AND line.id=$2 AND statement.bank_account_id=$3 FOR UPDATE`, [context.organizationId, statementLineId, reconciliation.bank_account_id]);
  const line = lineResult.rows[0];
  if (!line) throw new AccountingError(404, "Statement line is outside this reconciliation.");
  const lineAmount = decimal(line.debit_amount) > 0n ? decimal(line.debit_amount) : decimal(line.credit_amount);
  const existingMatched = await client.query(
    `SELECT COALESCE(sum(matched_amount),0) AS amount FROM tenant.accounting_reconciliation_matches
      WHERE organization_id=$1 AND statement_line_id=$2`,
    [context.organizationId, statementLineId],
  );
  const remainingAmount = lineAmount - decimal(existingMatched.rows[0]?.amount || 0);
  const matchAmount = decimal(input.matchedAmount || remainingAmount);
  if (remainingAmount <= 0n) throw new AccountingError(409, "The statement line is already fully matched.");
  if (matchAmount <= 0n || matchAmount > remainingAmount) throw new AccountingError(400, "Matched amount exceeds the remaining statement amount.");
  if (journalLineId) {
    const journalLine = await client.query(`SELECT line.*,entry.status FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id=line.journal_entry_id JOIN tenant.accounting_bank_accounts bank ON bank.gl_account_id=line.account_id WHERE line.organization_id=$1 AND line.id=$2 AND bank.id=$3`, [context.organizationId, journalLineId, reconciliation.bank_account_id]);
    if (!journalLine.rows[0] || journalLine.rows[0].status !== 'posted') throw new AccountingError(409, "The ledger line is not a posted transaction for this bank account.");
  }
  const result = await client.query(`INSERT INTO tenant.accounting_reconciliation_matches (organization_id,reconciliation_id,statement_line_id,journal_line_id,match_type,matched_amount,confidence,match_note,matched_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [context.organizationId, reconciliation.id, statementLineId, journalLineId, ["exact","rule","manual","writeoff","fee","interest","transfer"].includes(input.matchType) ? input.matchType : "manual", asDatabaseDecimal(matchAmount), input.confidence === undefined ? null : Number(input.confidence), text(input.note, 1000) || null, context.userId]);
  const matched = await client.query(`SELECT COALESCE(sum(matched_amount),0) AS amount FROM tenant.accounting_reconciliation_matches WHERE organization_id=$1 AND statement_line_id=$2`, [context.organizationId, statementLineId]);
  const status = decimal(matched.rows[0].amount) >= lineAmount ? "matched" : "partially_matched";
  await client.query(`UPDATE tenant.accounting_bank_statement_lines SET match_status=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, statementLineId, status]);
  await event(client, context, "bank_reconciliation", reconciliation.id, "accounting.bank_line.matched", null, status, { statementLineId, journalLineId, matchAmount: asDatabaseDecimal(matchAmount) });
  return result.rows[0];
}

export async function completeBankReconciliation(client, context, reconciliationIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const id = uuid(reconciliationIdValue, "Reconciliation");
  const result = await client.query(`SELECT reconciliation.*,statement.id AS statement_id FROM tenant.accounting_reconciliations reconciliation LEFT JOIN tenant.accounting_bank_statements statement ON statement.id=reconciliation.bank_statement_id WHERE reconciliation.organization_id=$1 AND reconciliation.id=$2 FOR UPDATE`, [context.organizationId, id]);
  const reconciliation = result.rows[0];
  if (!reconciliation || !['in_progress','reopened'].includes(reconciliation.status)) throw new AccountingError(409, "Bank reconciliation is not open.");
  const unmatched = await client.query(`SELECT count(*)::int AS count FROM tenant.accounting_bank_statement_lines line WHERE line.organization_id=$1 AND line.bank_statement_id=$2 AND line.match_status NOT IN ('matched','ignored')`, [context.organizationId, reconciliation.statement_id]);
  if (Number(unmatched.rows[0]?.count || 0) > 0) throw new AccountingError(409, "Every statement line must be matched or explicitly ignored.");
  const balances = await client.query(
    `SELECT statement.closing_balance,
      COALESCE(sum(CASE WHEN entry.id IS NOT NULL THEN journal_line.base_debit_amount-journal_line.base_credit_amount ELSE 0 END),0) AS ledger_balance
     FROM tenant.accounting_bank_statements statement
     JOIN tenant.accounting_bank_accounts bank ON bank.id=statement.bank_account_id
     LEFT JOIN tenant.accounting_journal_lines journal_line ON journal_line.organization_id=statement.organization_id AND journal_line.account_id=bank.gl_account_id
     LEFT JOIN tenant.accounting_journal_entries entry ON entry.id=journal_line.journal_entry_id AND entry.status='posted' AND entry.accounting_date<=statement.period_end
     WHERE statement.organization_id=$1 AND statement.id=$2
     GROUP BY statement.closing_balance`,
    [context.organizationId, reconciliation.statement_id],
  );
  const statementBalance = decimal(balances.rows[0]?.closing_balance || 0);
  const ledgerBalance = decimal(balances.rows[0]?.ledger_balance || 0);
  const difference = statementBalance - ledgerBalance;
  if (difference !== 0n) throw new AccountingError(409, `Bank reconciliation is not balanced. Remaining difference: ${asDatabaseDecimal(difference)}.`);
  const updated = await client.query(`UPDATE tenant.accounting_reconciliations SET status='completed',statement_balance=$3,ledger_balance=$4,difference=0,completed_by=$5,completed_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, asDatabaseDecimal(statementBalance), asDatabaseDecimal(ledgerBalance), context.userId]);
  if (reconciliation.statement_id) await client.query(`UPDATE tenant.accounting_bank_statements SET status='reconciled',updated_by=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, reconciliation.statement_id, context.userId]);
  await event(client, context, "bank_reconciliation", id, "accounting.bank_reconciliation.completed", reconciliation.status, "completed", {});
  return updated.rows[0];
}
