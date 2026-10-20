// Bank statements (Finance MVP F6): import a bank's CSV or Excel export in two steps.
//
//   preview   the file is read (the heading row is found even below a few lines of account details), each column is mapped (recognised
//             automatically, or as the user maps it), and every row is checked: a readable date (day first, as Indian banks write it, or an
//             Excel date), one amount either in or out. A row already imported in an earlier statement of the account — same date,
//             direction, amount and reference — is a duplicate and is left out (counted, so two genuine identical rows imported once
//             match two of a re-import). A row repeated within the file is kept but flagged, for the user to check. Nothing is saved.
//   import    the same checks run again on the server; a file with a bad row is refused (fix the file or the mapping), duplicates are left
//             out, and the statement's opening + money in − money out must equal its closing balance when the balances are given. The
//             lines are then staged for reconciliation, each with the best match the ledger offers.
import { createHash } from "node:crypto";

import { decimal, formatDecimal } from "../../../core/decimal.js";
import { readXlsxRows } from "../../../core/platform/data-exchange/xlsx.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, allocateNumber, asDatabaseDecimal, event, requirePermission, text, uuid } from "../core.js";
import { suggestForStatement } from "./reconciliation.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const FIELDS = Object.freeze({
  date: ["date", "transaction date", "txn date", "tran date", "posting date", "value date", "trans date"],
  valueDate: ["value date", "value dt"],
  description: ["description", "narration", "particulars", "details", "remarks", "transaction details", "transaction remarks"],
  reference: ["reference", "ref", "ref no", "ref no./cheque no.", "chq/ref no", "cheque no", "cheque number", "chq no", "utr", "utr no", "transaction id", "reference no"],
  debit: ["debit", "withdrawal", "withdrawals", "withdrawal amt", "withdrawal amount", "dr", "debit amount", "paid out"],
  credit: ["credit", "deposit", "deposits", "deposit amt", "deposit amount", "cr", "credit amount", "paid in"],
  amount: ["amount", "transaction amount"],
  direction: ["dr/cr", "cr/dr", "type", "debit/credit"],
  balance: ["balance", "closing balance", "running balance", "available balance"],
});
const LABELS = { date: "Date", valueDate: "Value date", description: "Description", reference: "Reference / UTR / cheque", debit: "Money out (debit)", credit: "Money in (credit)",
  amount: "Amount (signed)", direction: "Dr / Cr", balance: "Balance" };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const blank = (row) => !row.some((value) => String(value ?? "").trim() !== "");
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[_]/g, " ");

// A tolerant CSV reader: quoted fields, any column count, so a few lines of account details above the headings don't break it.
// Blank lines are kept (as empty rows) so a row's number is its line in the file.
function csvRows(textValue) {
  const rows = [];
  let row = []; let field = ""; let quoted = false;
  const source = String(textValue ?? "").replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(field); field = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = ""; rows.push(row); row = []; continue;
    }
    field += char;
  }
  row.push(field); rows.push(row);
  return rows;
}

function readFile({ fileName, fileBase64, csvText }) {
  const name = text(fileName, 255) || "statement.csv";
  if (/\.xlsx$/i.test(name)) {
    if (!fileBase64) fail(400, "Attach the Excel file.", "ACCOUNTING_STATEMENT_FILE_MISSING", "file");
    try {
      return readXlsxRows(Buffer.from(String(fileBase64), "base64"), { maxBytes: 5 * 1024 * 1024, maxRows: 20000 }).map((row) => Array.from(row, (cell) => cell ?? ""));
    } catch (error) {
      fail(error.status ?? 400, error.message || "The Excel file can't be read.", "ACCOUNTING_STATEMENT_FORMAT", "file");
    }
  }
  if (/\.xls$/i.test(name)) fail(400, "Old .xls files can't be read. Open it in Excel and save it as .xlsx or CSV.", "ACCOUNTING_STATEMENT_FORMAT", "file");
  const source = csvText ?? (fileBase64 ? Buffer.from(String(fileBase64), "base64").toString("utf8") : null);
  if (!source) fail(400, "Attach the statement file.", "ACCOUNTING_STATEMENT_FILE_MISSING", "file");
  if (source.length > 5 * 1024 * 1024) fail(413, "The file is larger than 5 MB. Split it into smaller periods.", "ACCOUNTING_STATEMENT_TOO_LARGE", "file");
  return csvRows(source);
}

// The heading row: the first row (of the first 25) with a date heading and at least one amount heading.
function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    if (blank(rows[index])) continue;
    const cells = rows[index].map(norm);
    const has = (field) => cells.some((cell) => FIELDS[field].includes(cell));
    if (has("date") && (has("debit") || has("credit") || has("amount"))) return index;
  }
  return -1;
}

function detectMapping(headers, given = {}) {
  const cells = headers.map(norm);
  const mapping = {};
  for (const field of Object.keys(FIELDS)) {
    if (given[field] !== undefined) { mapping[field] = given[field] === "" || given[field] === null ? null : String(given[field]); continue; }
    const index = cells.findIndex((cell) => FIELDS[field].includes(cell));
    mapping[field] = index >= 0 ? headers[index] : null;
  }
  // A "value date" heading is the value date, not the transaction date, when both exist.
  if (mapping.date && mapping.valueDate && norm(mapping.date) === norm(mapping.valueDate)) {
    const other = headers.find((header) => FIELDS.date.includes(norm(header)) && norm(header) !== norm(mapping.valueDate));
    mapping.date = other ?? mapping.date;
    if (!other) mapping.valueDate = null;
  }
  return mapping;
}

// Day-first dates (21/10/2026, 21-10-26, 21.10.2026, 21-Oct-2026, 21 Oct 2026), ISO dates, and Excel's day numbers.
export function parseStatementDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (serial > 20000 && serial < 80000) { const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000); return date.toISOString().slice(0, 10); }
  }
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y; let m; let d;
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) { [, d, m, y] = match.map(Number); }
  else if ((match = raw.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,4})[A-Za-z]*[\s\-/,]+(\d{2,4})$/))) { d = Number(match[1]); m = MONTHS[match[2].toLowerCase()]; y = Number(match[3]); }
  else return null;
  if (y < 100) y += 2000;
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

// "1,25,000.50", "(500.00)", "-500", "500 Dr" → a positive amount and, when the cell says so, its direction.
function parseAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { amount: 0n, sign: null, ok: true };
  const direction = /\bdr\b/i.test(raw) ? "out" : /\bcr\b/i.test(raw) ? "in" : null;
  let cleaned = raw.replace(/\b(dr|cr)\b/ig, "").replace(/[₹$£€,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) { negative = true; cleaned = cleaned.slice(1, -1); }
  if (cleaned.startsWith("-")) { negative = true; cleaned = cleaned.slice(1); }
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return { amount: 0n, sign: null, ok: false };
  return { amount: decimal(cleaned), sign: direction ?? (negative ? "out" : null), ok: true };
}

export const fingerprintOf = (bankAccountId, date, direction, amount, reference) =>
  [bankAccountId, date, direction === "out" ? "D" : "C", formatDecimal(amount, 2), String(reference ?? "").trim().toLowerCase()].join("|");

// Reads and checks a statement file without saving anything.
// input: { bankAccountId, fileName, fileBase64? | csvText?, mapping? { date, valueDate, description, reference, debit, credit, amount, direction, balance } }
export async function previewBankStatement(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankManage);
  const bank = (await client.query("SELECT id, account_name, currency_code, status FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND id = $2",
    [context.organizationId, uuid(input.bankAccountId, "Bank account")])).rows[0];
  if (!bank || bank.status !== "active") fail(404, "Choose an active bank or cash account.", "ACCOUNTING_BANK_NOT_FOUND", "bankAccountId");
  const rows = readFile(input);
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) fail(400, "No column headings with a date and an amount were found. Check the file is the bank's statement export.", "ACCOUNTING_STATEMENT_NO_HEADINGS", "file");
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const mapping = detectMapping(headers, input.mapping ?? {});
  const col = (field) => (mapping[field] ? headers.findIndex((header) => header === mapping[field]) : -1);
  const missing = [];
  if (col("date") < 0) missing.push("date");
  if (col("debit") < 0 && col("credit") < 0 && col("amount") < 0) missing.push("amounts");
  const parsed = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (blank(cells)) continue;
    const cell = (field) => (col(field) >= 0 ? String(cells[col(field)] ?? "").trim() : "");
    // Footer lines ("Closing balance …", "Total", "*** End of statement") have no amount and no readable date: skipped, not errors.
    if (!cell("debit") && !cell("credit") && !cell("amount") && !parseStatementDate(cell("date"))) continue;
    const errors = [];
    const date = parseStatementDate(cell("date"));
    if (!date) errors.push(cell("date") ? `"${cell("date")}" isn't a date` : "No date");
    let direction = null; let amount = 0n;
    const debit = parseAmount(cell("debit")); const credit = parseAmount(cell("credit"));
    if (!debit.ok || !credit.ok) errors.push("An amount isn't a number");
    if (debit.amount > 0n && credit.amount > 0n) errors.push("Both money in and money out");
    else if (debit.amount > 0n) { direction = "out"; amount = debit.amount; }
    else if (credit.amount > 0n) { direction = "in"; amount = credit.amount; }
    else if (col("amount") >= 0) {
      const signed = parseAmount(cell("amount"));
      const told = norm(cell("direction"));
      if (!signed.ok) errors.push("The amount isn't a number");
      else if (signed.amount > 0n) {
        amount = signed.amount;
        direction = told.startsWith("d") || told.includes("withdraw") ? "out" : told.startsWith("c") || told.includes("deposit") ? "in" : signed.sign ?? "in";
      }
    }
    if (!errors.length && amount <= 0n) {
      // A row with a date but no money (an opening-balance line) is skipped.
      if (/balance|opening|b\/f|brought forward/i.test(cell("description"))) continue;
      errors.push("No amount");
    }
    const reference = cell("reference") || null;
    const balance = cell("balance") ? parseAmount(cell("balance")) : null;
    parsed.push({
      row: index + 1, date, valueDate: parseStatementDate(cell("valueDate")), description: cell("description") || null, reference, direction,
      amount: amount > 0n ? formatDecimal(amount, 2) : null, balance: balance?.ok ? formatDecimal(balance.sign === "out" ? -balance.amount : balance.amount, 2) : null, errors,
      fingerprint: date && direction && amount > 0n ? fingerprintOf(bank.id, date, direction, amount, reference) : null, duplicate: null, repeatOf: null,
    });
  }
  // Duplicates against lines already imported for this account, one for one; then rows repeated within the file (kept, flagged).
  const prints = [...new Set(parsed.filter((line) => line.fingerprint).map((line) => line.fingerprint))];
  if (prints.length) {
    const existing = (await client.query(
      `SELECT line.id, line.line_fingerprint, statement.statement_number FROM tenant.accounting_bank_statement_lines line
         JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id AND statement.status <> 'cancelled'
        WHERE line.organization_id = $1 AND statement.bank_account_id = $2 AND line.line_fingerprint = ANY($3::text[]) ORDER BY statement.created_at, line.sequence`,
      [context.organizationId, bank.id, prints])).rows;
    const byPrint = new Map();
    for (const row of existing) byPrint.set(row.line_fingerprint, [...(byPrint.get(row.line_fingerprint) ?? []), row]);
    for (const line of parsed) {
      const match = line.fingerprint ? byPrint.get(line.fingerprint)?.shift() : null;
      if (match) line.duplicate = { kind: "imported", statement: match.statement_number, lineId: match.id };
    }
  }
  const seen = new Map();
  for (const line of parsed) {
    if (!line.fingerprint || line.duplicate) continue;
    if (seen.has(line.fingerprint)) line.repeatOf = seen.get(line.fingerprint);
    else seen.set(line.fingerprint, line.row);
  }
  const good = parsed.filter((line) => !line.errors.length && !line.duplicate);
  const sum = (direction) => good.filter((line) => line.direction === direction).reduce((total, line) => total + decimal(line.amount), 0n);
  const dates = good.map((line) => line.date).sort();
  return {
    bankAccount: { id: bank.id, name: bank.account_name, currency: String(bank.currency_code).trim() },
    headers, headerRow: headerIndex + 1, mapping, fields: Object.entries(LABELS).map(([key, label]) => ({ key, label })), missing,
    rows: parsed.map(({ fingerprint: _fingerprint, ...line }) => line),
    summary: {
      rows: parsed.length, ready: good.length, invalid: parsed.filter((line) => line.errors.length).length, duplicates: parsed.filter((line) => line.duplicate && !line.errors.length).length,
      repeated: good.filter((line) => line.repeatOf).length,
      moneyIn: formatDecimal(sum("in"), 2), moneyOut: formatDecimal(sum("out"), 2), from: dates[0] ?? null, to: dates.at(-1) ?? null,
      lastBalance: [...good].reverse().find((line) => line.balance !== null)?.balance ?? null,
    },
  };
}

// Imports a previewed file. input: preview's input + { openingBalance?, closingBalance?, statementNumber? }
export async function importBankStatementFile(client, context, input = {}) {
  const preview = await previewBankStatement(client, context, input);
  if (preview.missing.length) fail(400, `Map the ${preview.missing.join(" and ")} column${preview.missing.length > 1 ? "s" : ""} first.`, "ACCOUNTING_STATEMENT_MAPPING", "mapping");
  if (preview.summary.invalid) fail(400, `${preview.summary.invalid} row(s) can't be read. Fix them in the file (or the column mapping) and import again.`, "ACCOUNTING_STATEMENT_INVALID_ROWS");
  const lines = preview.rows.filter((line) => !line.duplicate && !line.errors.length);
  if (!lines.length) fail(409, preview.summary.duplicates ? "Every row was already imported." : "The file has no transactions.", "ACCOUNTING_STATEMENT_NOTHING_NEW");
  const moneyIn = decimal(preview.summary.moneyIn); const moneyOut = decimal(preview.summary.moneyOut);
  const opening = input.openingBalance !== undefined && input.openingBalance !== "" && input.openingBalance !== null ? decimal(input.openingBalance) : null;
  const closing = input.closingBalance !== undefined && input.closingBalance !== "" && input.closingBalance !== null ? decimal(input.closingBalance)
    : preview.summary.lastBalance !== null ? decimal(preview.summary.lastBalance) : null;
  if (opening !== null && closing !== null && opening + moneyIn - moneyOut !== closing)
    fail(409, `The statement doesn't add up: opening ${formatDecimal(opening, 2)} + in ${formatDecimal(moneyIn, 2)} − out ${formatDecimal(moneyOut, 2)} = ${formatDecimal(opening + moneyIn - moneyOut, 2)}, not the closing ${formatDecimal(closing, 2)}.`,
      "ACCOUNTING_STATEMENT_UNBALANCED", "closingBalance");
  const finalClosing = closing ?? (opening !== null ? opening + moneyIn - moneyOut : null);
  const finalOpening = opening ?? (finalClosing !== null ? finalClosing - moneyIn + moneyOut : 0n);
  const sourceHash = createHash("sha256").update(JSON.stringify(lines.map((line) => [line.date, line.direction, line.amount, line.reference]))).digest("hex");
  const number = input.statementNumber ? text(input.statementNumber, 100) : await allocateNumber(client, context.organizationId, "bank_statement");
  const statement = (await client.query(
    `INSERT INTO tenant.accounting_bank_statements (organization_id, bank_account_id, statement_number, statement_date, period_start, period_end, opening_balance, closing_balance,
       currency_code, import_source, source_file_name, source_hash, status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'csv',$10,$11,'imported',$12,$12) RETURNING *`,
    [context.organizationId, preview.bankAccount.id, number, preview.summary.to, preview.summary.from, preview.summary.to, asDatabaseDecimal(finalOpening), asDatabaseDecimal(finalClosing ?? 0n),
      preview.bankAccount.currency, text(input.fileName, 255) || null, sourceHash, context.userId ?? null])).rows[0];
  let sequence = 0;
  for (const line of lines) {
    sequence += 1;
    await client.query(
      `INSERT INTO tenant.accounting_bank_statement_lines (organization_id, bank_statement_id, sequence, transaction_date, value_date, external_id, reference, description, debit_amount, credit_amount,
         balance, line_fingerprint) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11)`,
      [context.organizationId, statement.id, sequence, line.date, line.valueDate, line.reference ? text(line.reference, 500) : null, line.description ? text(line.description, 1000) : null,
        line.direction === "out" ? line.amount : "0", line.direction === "in" ? line.amount : "0", line.balance, fingerprintOf(preview.bankAccount.id, line.date, line.direction, decimal(line.amount), line.reference)]);
  }
  await event(client, context, "bank_statement", statement.id, "accounting.bank_statement.imported", null, "imported",
    { lines: lines.length, skippedDuplicates: preview.summary.duplicates, fileName: text(input.fileName, 255) || null });
  await suggestForStatement(client, context, statement.id);
  return { id: statement.id, number, lines: lines.length, skippedDuplicates: preview.summary.duplicates };
}

export const STATEMENT_FIELDS = LABELS;
