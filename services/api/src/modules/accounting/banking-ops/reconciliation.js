// Bank reconciliation (Finance MVP F6): each statement line is agreed with what the books say.
//
//   states    UNMATCHED → SUGGESTED_MATCH (the books offer a likely entry) → MATCHED (agreed with one or more ledger lines that add up to
//             it) → RECONCILED (the statement is completed). A line that can't be agreed yet is an EXCEPTION, with the reason. A line that
//             is not a transaction of the business (a bank's own reversal pair, say) is IGNORED, with the reason.
//   matching  never on the amount alone: the direction must agree (money in on the statement is a debit to the bank in the books), the
//             amount exactly, and the score weighs how close the dates are, a reference / UTR / cheque number found in the entry, and the
//             party's name. A ledger line is matched once only; a statement line may be split across several ledger lines.
//   entries   a bank charge or interest that is not in the books yet is posted from the line (Dr charges · Cr bank, or Dr bank · Cr
//             income) by someone allowed to post journals, and the line is matched to it — never a plug.
//   complete  every line matched or ignored (no open exception), and the statement continues from the previous one. Ledger entries in the
//             period not on the statement (cheques not yet cleared, deposits in transit) are listed: they clear on a later statement.
import { decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { ACCOUNTING_PERMISSIONS, AccountingError, asDatabaseDecimal, event, getPrimaryLedger, isoDate, requirePermission, requiredText, text, uuid } from "../core.js";
import { createJournalEntry, postJournalEntry } from "../journals.js";

const fail = (status, message, code, field) => { throw new AccountingError(status, message, code, field ? { field } : undefined); };
const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const day = (value) => (value ? isoDate(value) : null);
const daysBetween = (a, b) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));
// Reference tokens: words of 5+ letters/digits (UTRs, cheque numbers, invoice numbers) — short words are too common to prove anything.
const tokens = (...values) => new Set(values.flatMap((value) => String(value ?? "").toUpperCase().match(/[A-Z0-9]{5,}/g) ?? []));

export function lineState(line, statementStatus) {
  if (line.exception_reason && !["matched", "ignored"].includes(line.match_status)) return "EXCEPTION";
  if (line.match_status === "ignored") return "IGNORED";
  if (line.match_status === "matched") return statementStatus === "reconciled" ? "RECONCILED" : "MATCHED";
  if (line.match_status === "partially_matched") return "PARTLY_MATCHED";
  if (line.match_status === "suggested") return "SUGGESTED_MATCH";
  return "UNMATCHED";
}

async function loadLine(client, context, lineIdValue, { lock = false } = {}) {
  const line = (await client.query(
    `SELECT line.*, statement.bank_account_id, statement.status AS statement_status, statement.id AS statement_id, statement.statement_number, bank.gl_account_id, bank.account_name
       FROM tenant.accounting_bank_statement_lines line
       JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id
       JOIN tenant.accounting_bank_accounts bank ON bank.id = statement.bank_account_id
      WHERE line.organization_id = $1 AND line.id = $2${lock ? " FOR UPDATE OF line" : ""}`, [context.organizationId, uuid(lineIdValue, "Statement line")])).rows[0];
  if (!line) fail(404, "Statement line not found.", "ACCOUNTING_BANK_LINE_NOT_FOUND");
  return line;
}
const amountOf = (line) => (decimal(line.debit_amount) > 0n ? decimal(line.debit_amount) : decimal(line.credit_amount));
const directionOf = (line) => (decimal(line.credit_amount) > 0n ? "in" : "out");

// The ledger lines on the bank's account that could be this statement line: same direction, not matched yet, within 30 days, scored.
async function scoredCandidates(client, context, line, { exactOnly = false, limit = 15 } = {}) {
  const amount = amountOf(line);
  const moneyIn = directionOf(line) === "in";
  const rows = (await client.query(
    `SELECT journal_line.id, journal_line.base_debit_amount, journal_line.base_credit_amount, journal_line.description, entry.id AS entry_id, entry.entry_number, entry.accounting_date,
            entry.reference, entry.description AS entry_description, entry.source_number, party.display_name AS party_name
       FROM tenant.accounting_journal_lines journal_line
       JOIN tenant.accounting_journal_entries entry ON entry.id = journal_line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       LEFT JOIN LATERAL (SELECT other.party_id FROM tenant.accounting_journal_lines other WHERE other.journal_entry_id = entry.id AND other.party_id IS NOT NULL LIMIT 1) counter ON true
       LEFT JOIN tenant.business_parties party ON party.id = counter.party_id
      WHERE journal_line.organization_id = $1 AND journal_line.account_id = $2
        AND ${moneyIn ? "journal_line.base_debit_amount" : "journal_line.base_credit_amount"} > 0
        AND ${moneyIn ? "journal_line.base_debit_amount" : "journal_line.base_credit_amount"} ${exactOnly ? "= $3::numeric" : "<= $3::numeric"}
        AND entry.accounting_date BETWEEN $4::date - 30 AND $4::date + 30
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_reconciliation_matches match WHERE match.organization_id = $1 AND match.journal_line_id = journal_line.id)`,
    [context.organizationId, line.gl_account_id, formatDecimal(amount), day(line.transaction_date)])).rows;
  const lineTokens = tokens(line.reference, line.description, line.external_id);
  const words = String(line.description ?? "").toUpperCase();
  return rows.map((row) => {
    const value = decimal(moneyIn ? row.base_debit_amount : row.base_credit_amount);
    const reasons = [];
    let score = 0;
    if (value === amount) { score += 50; reasons.push("Same amount"); } else reasons.push("Part of the amount");
    const gap = daysBetween(day(row.accounting_date), day(line.transaction_date));
    const dateScore = gap === 0 ? 25 : gap <= 3 ? 18 : gap <= 7 ? 10 : gap <= 15 ? 5 : 0;
    score += dateScore;
    reasons.push(gap === 0 ? "Same day" : `${gap} day${gap === 1 ? "" : "s"} apart`);
    const entryTokens = tokens(row.reference, row.entry_description, row.description, row.source_number, row.entry_number);
    if ([...lineTokens].some((token) => entryTokens.has(token))) { score += 25; reasons.push("Reference matches"); }
    const partyWords = String(row.party_name ?? "").toUpperCase().split(/\s+/).filter((word) => word.length >= 4);
    if (partyWords.length && partyWords.some((word) => words.includes(word))) { score += 10; reasons.push(`Mentions ${row.party_name}`); }
    return {
      journalLineId: row.id, entryId: row.entry_id, entryNumber: row.entry_number, date: day(row.accounting_date), amount: money(formatDecimal(value, 2)), description: row.entry_description || row.description,
      reference: row.reference ?? row.source_number ?? null, party: row.party_name ?? null, score: Math.min(score, 100), reasons,
    };
  }).sort((a, b) => b.score - a.score || daysBetween(a.date, day(line.transaction_date)) - daysBetween(b.date, day(line.transaction_date))).slice(0, limit);
}

// Stores the best match for every open line of a statement (when it is clear: same amount, a strong score, and no tie).
export async function suggestForStatement(client, context, statementIdValue) {
  const lines = (await client.query(
    `SELECT line.*, bank.gl_account_id FROM tenant.accounting_bank_statement_lines line
       JOIN tenant.accounting_bank_statements statement ON statement.id = line.bank_statement_id
       JOIN tenant.accounting_bank_accounts bank ON bank.id = statement.bank_account_id
      WHERE line.organization_id = $1 AND line.bank_statement_id = $2 AND line.match_status IN ('unmatched', 'suggested') AND line.exception_reason IS NULL ORDER BY line.sequence`,
    [context.organizationId, uuid(statementIdValue, "Statement")])).rows;
  const claimed = new Set();
  let suggested = 0;
  for (const line of lines) {
    const candidates = (await scoredCandidates(client, context, line, { exactOnly: true, limit: 3 })).filter((candidate) => !claimed.has(candidate.journalLineId));
    const [best, next] = candidates;
    const clear = best && best.score >= 70 && (!next || next.score < best.score);
    if (clear) claimed.add(best.journalLineId);
    if (clear) suggested += 1;
    await client.query(
      `UPDATE tenant.accounting_bank_statement_lines SET match_status = $3, suggested_journal_line_id = $4, suggestion_score = $5, suggestion_reasons = $6::jsonb
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, line.id, clear ? "suggested" : "unmatched", clear ? best.journalLineId : null, clear ? best.score : null, JSON.stringify(clear ? best.reasons : [])]);
  }
  return { lines: lines.length, suggested };
}

async function openReconciliation(client, context, line) {
  const existing = (await client.query("SELECT * FROM tenant.accounting_reconciliations WHERE organization_id = $1 AND bank_statement_id = $2 AND status IN ('in_progress', 'reopened') LIMIT 1",
    [context.organizationId, line.statement_id])).rows[0];
  if (existing) return existing;
  const statement = (await client.query("SELECT period_end, closing_balance FROM tenant.accounting_bank_statements WHERE id = $1", [line.statement_id])).rows[0];
  const row = (await client.query(
    `INSERT INTO tenant.accounting_reconciliations (organization_id, bank_account_id, bank_statement_id, reconciliation_date, statement_balance, ledger_balance, difference, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 0, 0, 'in_progress', $6)
     ON CONFLICT (organization_id, bank_account_id, reconciliation_date) DO UPDATE SET bank_statement_id = EXCLUDED.bank_statement_id, status = 'in_progress' RETURNING *`,
    [context.organizationId, line.bank_account_id, line.statement_id, day(statement.period_end), statement.closing_balance, context.userId ?? null])).rows[0];
  await client.query("UPDATE tenant.accounting_bank_statements SET status = 'reconciling', updated_by = $3 WHERE organization_id = $1 AND id = $2 AND status = 'imported'",
    [context.organizationId, line.statement_id, context.userId ?? null]);
  return row;
}

function assertOpen(line) {
  if (line.statement_status === "reconciled") fail(409, `Statement ${line.statement_number} is reconciled; reopen it to change its lines.`, "ACCOUNTING_STATEMENT_RECONCILED");
}

// Matches a statement line to one or more ledger lines that add up to it exactly.
export async function matchStatementLine(client, context, lineIdValue, { journalLineIds = [], note } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  if (line.match_status === "matched" || line.match_status === "ignored") fail(409, "This line is already settled; undo it first.", "ACCOUNTING_BANK_LINE_SETTLED");
  const ids = [...new Set(journalLineIds.map((id) => uuid(id, "Ledger line")))];
  if (!ids.length) fail(400, "Choose the ledger entry (or entries) this line is.", "ACCOUNTING_BANK_MATCH_EMPTY");
  const moneyIn = directionOf(line) === "in";
  const rows = (await client.query(
    `SELECT journal_line.id, journal_line.account_id, journal_line.base_debit_amount, journal_line.base_credit_amount, entry.status, entry.entry_number,
            EXISTS (SELECT 1 FROM tenant.accounting_reconciliation_matches match WHERE match.organization_id = $1 AND match.journal_line_id = journal_line.id) AS taken
       FROM tenant.accounting_journal_lines journal_line JOIN tenant.accounting_journal_entries entry ON entry.id = journal_line.journal_entry_id
      WHERE journal_line.organization_id = $1 AND journal_line.id = ANY($2::uuid[]) FOR UPDATE OF journal_line`, [context.organizationId, ids])).rows;
  if (rows.length !== ids.length) fail(404, "A ledger line was not found.", "ACCOUNTING_BANK_MATCH_INVALID");
  let total = 0n;
  for (const row of rows) {
    if (row.account_id !== line.gl_account_id) fail(409, `${row.entry_number} is not on ${line.account_name}'s ledger account.`, "ACCOUNTING_BANK_MATCH_INVALID");
    if (!["posted", "reversed"].includes(row.status)) fail(409, `${row.entry_number} is not posted.`, "ACCOUNTING_BANK_MATCH_INVALID");
    if (row.taken) fail(409, `${row.entry_number} is already matched to another statement line.`, "ACCOUNTING_BANK_MATCH_TAKEN");
    const value = decimal(moneyIn ? row.base_debit_amount : row.base_credit_amount);
    if (value <= 0n) fail(409, `${row.entry_number} goes the other way: money ${moneyIn ? "out of" : "into"} the account.`, "ACCOUNTING_BANK_MATCH_DIRECTION");
    total += value;
  }
  if (total !== amountOf(line))
    fail(409, `The chosen entries add up to ${formatDecimal(total, 2)}; the statement line is ${formatDecimal(amountOf(line), 2)}.`, "ACCOUNTING_BANK_MATCH_AMOUNT");
  const reconciliation = await openReconciliation(client, context, line);
  for (const row of rows) {
    await client.query(
      `INSERT INTO tenant.accounting_reconciliation_matches (organization_id, reconciliation_id, statement_line_id, journal_line_id, match_type, matched_amount, confidence, match_note, matched_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [context.organizationId, reconciliation.id, line.id, row.id, rows.length > 1 ? "manual" : line.suggested_journal_line_id === row.id ? "rule" : "manual",
        moneyIn ? row.base_debit_amount : row.base_credit_amount, line.suggested_journal_line_id === row.id ? line.suggestion_score : null, text(note, 1000) || null, context.userId ?? null]);
  }
  await client.query("UPDATE tenant.accounting_bank_statement_lines SET match_status = 'matched', exception_reason = NULL, exception_at = NULL, exception_by = NULL WHERE organization_id = $1 AND id = $2",
    [context.organizationId, line.id]);
  await event(client, context, "bank_statement", line.statement_id, "accounting.bank_line.matched", lineState(line, line.statement_status), "MATCHED",
    { lineId: line.id, entries: rows.map((row) => row.entry_number) });
  return { lineId: line.id };
}

export async function acceptSuggestion(client, context, lineIdValue) {
  const line = await loadLine(client, context, lineIdValue);
  if (line.match_status !== "suggested" || !line.suggested_journal_line_id) fail(409, "There is no suggestion on this line.", "ACCOUNTING_BANK_NO_SUGGESTION");
  return matchStatementLine(client, context, line.id, { journalLineIds: [line.suggested_journal_line_id] });
}

// Undoes a match (or an ignore) while the statement is not yet reconciled.
export async function unmatchStatementLine(client, context, lineIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  await client.query("DELETE FROM tenant.accounting_reconciliation_matches WHERE organization_id = $1 AND statement_line_id = $2", [context.organizationId, line.id]);
  await client.query("UPDATE tenant.accounting_bank_statement_lines SET match_status = 'unmatched', suggested_journal_line_id = NULL, suggestion_score = NULL, suggestion_reasons = '[]' WHERE organization_id = $1 AND id = $2",
    [context.organizationId, line.id]);
  await event(client, context, "bank_statement", line.statement_id, "accounting.bank_line.unmatched", lineState(line, line.statement_status), "UNMATCHED", { lineId: line.id });
  return { lineId: line.id };
}

export async function markLineException(client, context, lineIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const why = requiredText(reason, "Reason", 500);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  if (["matched", "ignored"].includes(line.match_status)) fail(409, "This line is already settled; undo it first.", "ACCOUNTING_BANK_LINE_SETTLED");
  await client.query("UPDATE tenant.accounting_bank_statement_lines SET exception_reason = $3, exception_at = now(), exception_by = $4 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, line.id, why, context.userId ?? null]);
  await event(client, context, "bank_statement", line.statement_id, "accounting.bank_line.exception", lineState(line, line.statement_status), "EXCEPTION", { lineId: line.id, reason: why });
  return { lineId: line.id };
}

export async function clearLineException(client, context, lineIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  await client.query("UPDATE tenant.accounting_bank_statement_lines SET exception_reason = NULL, exception_at = NULL, exception_by = NULL WHERE organization_id = $1 AND id = $2", [context.organizationId, line.id]);
  return { lineId: line.id };
}

// A line that is not a transaction of the business (say, the bank's own reversal pair) is ignored, with the reason.
export async function ignoreStatementLine(client, context, lineIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const why = requiredText(reason, "Reason", 500);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  if (line.match_status === "matched") fail(409, "This line is matched; undo the match first.", "ACCOUNTING_BANK_LINE_SETTLED");
  await client.query("UPDATE tenant.accounting_bank_statement_lines SET match_status = 'ignored', exception_reason = $3, exception_at = now(), exception_by = $4 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, line.id, why, context.userId ?? null]);
  await event(client, context, "bank_statement", line.statement_id, "accounting.bank_line.ignored", lineState(line, line.statement_status), "IGNORED", { lineId: line.id, reason: why });
  return { lineId: line.id };
}

// Posts what the bank did that the books don't have yet (a charge, interest), and matches the line to it.
// input: { accountId (the charge or income account), description }
export async function postEntryForLine(client, context, lineIdValue, { accountId, description } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const line = await loadLine(client, context, lineIdValue, { lock: true });
  assertOpen(line);
  if (["matched", "ignored"].includes(line.match_status)) fail(409, "This line is already settled.", "ACCOUNTING_BANK_LINE_SETTLED");
  const account = (await client.query(
    "SELECT id, code, name, account_class, status, is_group, control_kind FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2", [context.organizationId, uuid(accountId, "Account")])).rows[0];
  const moneyIn = directionOf(line) === "in";
  if (!account || account.status !== "active" || account.is_group || account.control_kind)
    fail(400, "Choose an active account that isn't owned by a sub-ledger (for a customer or supplier payment, record a receipt or payment instead).", "ACCOUNTING_BANK_ENTRY_ACCOUNT", "accountId");
  if (moneyIn ? !["revenue", "liability", "equity", "asset"].includes(account.account_class) : !["expense", "asset", "liability"].includes(account.account_class))
    fail(400, moneyIn ? "Money in goes to an income account (interest, other income) or a balance-sheet account." : "Money out goes to an expense account (bank charges) or a balance-sheet account.",
      "ACCOUNTING_BANK_ENTRY_ACCOUNT", "accountId");
  const ledger = await getPrimaryLedger(client, context);
  const journal = (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'bank' AND status = 'active' LIMIT 1",
    [context.organizationId, ledger.id])).rows[0] ?? (await client.query("SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' LIMIT 1",
    [context.organizationId, ledger.id])).rows[0];
  const amount = formatDecimal(amountOf(line));
  const what = text(description, 300) || line.description || (moneyIn ? "Bank credit" : "Bank charge");
  const date = day(line.transaction_date);
  const created = await createJournalEntry(client, { ...context, permissions: [...(context.permissions ?? []), ACCOUNTING_PERMISSIONS.journalCreate] }, {
    ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: date, entryType: "standard",
    reference: line.reference ?? `${line.statement_number}/${line.sequence}`, description: `${what} (bank statement ${line.statement_number})`,
    lines: moneyIn
      ? [{ accountId: line.gl_account_id, debit: amount, description: what }, { accountId: account.id, credit: amount, description: what }]
      : [{ accountId: account.id, debit: amount, description: what }, { accountId: line.gl_account_id, credit: amount, description: what }],
  }, { internal: true });
  await postJournalEntry(client, context, created.entry.id, { internal: true, allowDraft: true });
  const bankLine = (await client.query("SELECT id FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND journal_entry_id = $2 AND account_id = $3",
    [context.organizationId, created.entry.id, line.gl_account_id])).rows[0];
  await matchStatementLine(client, context, line.id, { journalLineIds: [bankLine.id], note: `Posted from the statement: ${what}` });
  return { lineId: line.id, journalEntryId: created.entry.id };
}

// The reconciliation workspace for one statement: its lines with their state, suggestion and matches; the totals; the ledger entries of
// the period not on the statement; and whether it can be completed.
export async function getReconciliationWorkspace(client, context, statementIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const statement = (await client.query(
    `SELECT statement.*, bank.account_name, bank.gl_account_id, bank.id AS bank_id, bank.account_type, account.code AS gl_code, account.name AS gl_name
       FROM tenant.accounting_bank_statements statement JOIN tenant.accounting_bank_accounts bank ON bank.id = statement.bank_account_id
       JOIN tenant.accounting_accounts account ON account.id = bank.gl_account_id
      WHERE statement.organization_id = $1 AND statement.id = $2`, [context.organizationId, uuid(statementIdValue, "Statement")])).rows[0];
  if (!statement) fail(404, "Statement not found.", "ACCOUNTING_STATEMENT_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.*, suggested.entry_number AS suggested_entry, suggested_entry.accounting_date AS suggested_date, suggested_entry.description AS suggested_description,
            excepted.full_name AS exception_by_name,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('journalLineId', match.journal_line_id, 'entryId', entry.id, 'entryNumber', entry.entry_number, 'date', entry.accounting_date,
                       'amount', match.matched_amount, 'description', entry.description, 'type', match.match_type) ORDER BY entry.accounting_date)
                FROM tenant.accounting_reconciliation_matches match JOIN tenant.accounting_journal_lines journal_line ON journal_line.id = match.journal_line_id
                JOIN tenant.accounting_journal_entries entry ON entry.id = journal_line.journal_entry_id
               WHERE match.organization_id = line.organization_id AND match.statement_line_id = line.id), '[]'::jsonb) AS matches
       FROM tenant.accounting_bank_statement_lines line
       LEFT JOIN tenant.accounting_journal_lines suggested_line ON suggested_line.id = line.suggested_journal_line_id
       LEFT JOIN tenant.accounting_journal_entries suggested_entry ON suggested_entry.id = suggested_line.journal_entry_id
       LEFT JOIN LATERAL (SELECT suggested_entry.entry_number) suggested ON true
       LEFT JOIN public.users excepted ON excepted.id = line.exception_by
      WHERE line.organization_id = $1 AND line.bank_statement_id = $2 ORDER BY line.transaction_date, line.sequence`, [context.organizationId, statement.id])).rows;
  const viewLines = lines.map((line) => ({
    id: line.id, sequence: line.sequence, date: day(line.transaction_date), description: line.description, reference: line.reference, direction: directionOf(line), amount: money(formatDecimal(amountOf(line), 2)),
    balance: line.balance === null ? null : money(line.balance), state: lineState(line, statement.status),
    suggestion: line.suggested_journal_line_id ? { journalLineId: line.suggested_journal_line_id, entryNumber: line.suggested_entry, date: day(line.suggested_date),
      description: line.suggested_description, score: Number(line.suggestion_score ?? 0), reasons: line.suggestion_reasons ?? [] } : null,
    exception: line.exception_reason ? { reason: line.exception_reason, at: line.exception_at, by: line.exception_by_name } : null,
    matches: (line.matches ?? []).map((match) => ({ ...match, date: String(match.date).slice(0, 10), amount: money(match.amount) })),
  }));
  const count = (state) => viewLines.filter((line) => line.state === state).length;
  const uncleared = (await client.query(
    `SELECT journal_line.id, entry.entry_number, entry.accounting_date, entry.description, journal_line.base_debit_amount, journal_line.base_credit_amount
       FROM tenant.accounting_journal_lines journal_line JOIN tenant.accounting_journal_entries entry ON entry.id = journal_line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      WHERE journal_line.organization_id = $1 AND journal_line.account_id = $2 AND entry.accounting_date BETWEEN $3::date AND $4::date
        AND NOT EXISTS (SELECT 1 FROM tenant.accounting_reconciliation_matches match WHERE match.organization_id = $1 AND match.journal_line_id = journal_line.id)
      ORDER BY entry.accounting_date LIMIT 200`, [context.organizationId, statement.gl_account_id, day(statement.period_start), day(statement.period_end)])).rows;
  const previous = (await client.query(
    `SELECT statement_number, closing_balance, period_end FROM tenant.accounting_bank_statements
      WHERE organization_id = $1 AND bank_account_id = $2 AND status <> 'cancelled' AND period_end < $3::date AND id <> $4 ORDER BY period_end DESC LIMIT 1`,
    [context.organizationId, statement.bank_id, day(statement.period_start), statement.id])).rows[0] ?? null;
  const book = money((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS balance FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
      WHERE line.organization_id = $1 AND line.account_id = $2 AND entry.accounting_date <= $3::date`, [context.organizationId, statement.gl_account_id, day(statement.period_end)])).rows[0].balance);
  const continues = !previous || decimal(previous.closing_balance) === decimal(statement.opening_balance);
  const open = count("UNMATCHED") + count("SUGGESTED_MATCH") + count("PARTLY_MATCHED") + count("EXCEPTION");
  return {
    statement: {
      id: statement.id, number: statement.statement_number, status: statement.status, from: day(statement.period_start), to: day(statement.period_end),
      opening: money(statement.opening_balance), closing: money(statement.closing_balance), fileName: statement.source_file_name, currency: String(statement.currency_code).trim(),
      bankAccount: { id: statement.bank_id, name: statement.account_name, ledgerAccount: `${statement.gl_code} · ${statement.gl_name}`, ledgerAccountId: statement.gl_account_id,
        cash: statement.account_type === "cash" },
    },
    lines: viewLines,
    counts: { total: viewLines.length, unmatched: count("UNMATCHED"), suggested: count("SUGGESTED_MATCH"), matched: count("MATCHED") + count("RECONCILED"), exceptions: count("EXCEPTION"),
      ignored: count("IGNORED"), partly: count("PARTLY_MATCHED") },
    moneyIn: money(viewLines.filter((line) => line.direction === "in").reduce((sum, line) => sum + line.amount, 0)),
    moneyOut: money(viewLines.filter((line) => line.direction === "out").reduce((sum, line) => sum + line.amount, 0)),
    bookBalance: book,
    notOnStatement: uncleared.map((row) => ({ journalLineId: row.id, entryNumber: row.entry_number, date: day(row.accounting_date), description: row.description,
      amount: money(Number(row.base_debit_amount) - Number(row.base_credit_amount)) })),
    previous: previous ? { number: previous.statement_number, closing: money(previous.closing_balance), to: day(previous.period_end) } : null,
    continues, canComplete: statement.status !== "reconciled" && open === 0 && continues && viewLines.length > 0,
    blockers: [
      ...(open ? [`${open} line(s) still to match, ignore or resolve`] : []),
      ...(!continues ? [`The opening balance (${formatDecimal(statement.opening_balance, 2)}) doesn't continue from ${previous.statement_number}'s closing balance (${formatDecimal(previous.closing_balance, 2)}).`] : []),
    ],
  };
}

export async function getLineCandidates(client, context, lineIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const line = await loadLine(client, context, lineIdValue);
  return scoredCandidates(client, context, line, { exactOnly: false, limit: 20 });
}

// Completes the reconciliation of a statement: every line settled, and the statement continuing from the previous one.
export async function completeStatementReconciliation(client, context, statementIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const workspace = await getReconciliationWorkspace(client, context, statementIdValue);
  if (workspace.statement.status === "reconciled") fail(409, "This statement is already reconciled.", "ACCOUNTING_STATEMENT_RECONCILED");
  if (!workspace.canComplete) fail(409, workspace.blockers.join(" "), "ACCOUNTING_RECONCILIATION_OPEN");
  const reconciliation = (await client.query(
    `INSERT INTO tenant.accounting_reconciliations (organization_id, bank_account_id, bank_statement_id, reconciliation_date, statement_balance, ledger_balance, difference, status, completed_by, completed_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, now(), $8)
     ON CONFLICT (organization_id, bank_account_id, reconciliation_date) DO UPDATE SET bank_statement_id = EXCLUDED.bank_statement_id, statement_balance = EXCLUDED.statement_balance,
       ledger_balance = EXCLUDED.ledger_balance, difference = EXCLUDED.difference, status = 'completed', completed_by = EXCLUDED.completed_by, completed_at = now() RETURNING id`,
    [context.organizationId, workspace.statement.bankAccount.id, workspace.statement.id, workspace.statement.to, asDatabaseDecimal(decimal(String(workspace.statement.closing))),
      asDatabaseDecimal(decimal(String(workspace.bookBalance))), asDatabaseDecimal(sub(decimal(String(workspace.statement.closing)), decimal(String(workspace.bookBalance)))), context.userId ?? null])).rows[0];
  await client.query("UPDATE tenant.accounting_bank_statements SET status = 'reconciled', updated_by = $3 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, workspace.statement.id, context.userId ?? null]);
  await event(client, context, "bank_statement", workspace.statement.id, "accounting.bank_statement.reconciled", workspace.statement.status, "reconciled",
    { reconciliationId: reconciliation.id, notOnStatement: workspace.notOnStatement.length });
  return getReconciliationWorkspace(client, context, workspace.statement.id);
}

// Reopens a reconciled statement (to correct a match), with a reason.
export async function reopenStatementReconciliation(client, context, statementIdValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const why = requiredText(reason, "Reason", 500);
  const statement = (await client.query("SELECT id, status, bank_account_id FROM tenant.accounting_bank_statements WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, uuid(statementIdValue, "Statement")])).rows[0];
  if (!statement || statement.status !== "reconciled") fail(409, "Only a reconciled statement is reopened.", "ACCOUNTING_STATEMENT_NOT_RECONCILED");
  await client.query("UPDATE tenant.accounting_bank_statements SET status = 'reconciling', updated_by = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, statement.id, context.userId ?? null]);
  await client.query("UPDATE tenant.accounting_reconciliations SET status = 'reopened' WHERE organization_id = $1 AND bank_statement_id = $2 AND status = 'completed'", [context.organizationId, statement.id]);
  await event(client, context, "bank_statement", statement.id, "accounting.bank_statement.reopened", "reconciled", "reconciling", { reason: why });
  return getReconciliationWorkspace(client, context, statement.id);
}

// Statements of an account (or all), newest first, with how far each is reconciled.
export async function listBankStatementsOverview(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "statement.status <> 'cancelled'";
  if (filters.bankAccountId) { values.push(uuid(filters.bankAccountId, "Bank account")); where += ` AND statement.bank_account_id = $${values.length}`; }
  const rows = (await client.query(
    `SELECT statement.id, statement.statement_number, statement.period_start, statement.period_end, statement.opening_balance, statement.closing_balance, statement.status,
            statement.source_file_name, bank.account_name, bank.id AS bank_id,
            count(line.id)::int AS lines, count(line.id) FILTER (WHERE line.match_status IN ('matched', 'ignored'))::int AS settled,
            count(line.id) FILTER (WHERE line.exception_reason IS NOT NULL AND line.match_status NOT IN ('matched', 'ignored'))::int AS exceptions,
            count(line.id) FILTER (WHERE line.match_status = 'suggested')::int AS suggested
       FROM tenant.accounting_bank_statements statement JOIN tenant.accounting_bank_accounts bank ON bank.id = statement.bank_account_id
       LEFT JOIN tenant.accounting_bank_statement_lines line ON line.bank_statement_id = statement.id
      WHERE statement.organization_id = $1 AND ${where}
      GROUP BY statement.id, bank.account_name, bank.id ORDER BY statement.period_end DESC, statement.created_at DESC LIMIT 300`, values)).rows;
  return rows.map((row) => ({
    id: row.id, number: row.statement_number, from: day(row.period_start), to: day(row.period_end), opening: money(row.opening_balance), closing: money(row.closing_balance),
    status: row.status, fileName: row.source_file_name, bankAccount: { id: row.bank_id, name: row.account_name }, lines: row.lines, settled: row.settled, exceptions: row.exceptions,
    suggested: row.suggested,
  }));
}
