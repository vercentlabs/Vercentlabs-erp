// Manual journals (Finance MVP F2): the draft → submit → approve (someone else) → post life of a journal written by hand, plus
//   editing a draft (or one sent back), discarding it, reversing a posted one on a chosen date, and "reverse and correct" — the
//   original is reversed and a correction draft is opened with its lines, linked to it (original → reversal → correction).
// A posted entry never changes: the database refuses it (migration 0197); correcting is always a new entry.
import {
  ACCOUNTING_PERMISSIONS, AccountingError, asDatabaseDecimal, event, getOpenPeriod, getPrimaryLedger, hashPayload, isoDate, loadOrganization, requirePermission,
  requiredText, text, uuid,
} from "../core.js";
import { createJournalEntry, getJournalEntry, insertJournalLines, loadAccountingJournal, localToday, normalizeJournalLines, reverseJournalEntry } from "../journals.js";
import { getJournalEntryDetail, postingEventOf } from "../posting-service.js";

const EDITABLE = ["draft", "rejected"];
const fail = (status, message, code, details) => { throw new AccountingError(status, message, code, details); };
const isManual = (entry) => !entry.source_type && entry.entry_type !== "reversal";

async function lockManual(client, context, idValue) {
  const entry = (await client.query("SELECT * FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, uuid(idValue, "Journal entry")])).rows[0];
  if (!entry) fail(404, "Journal entry not found.", "ACCOUNTING_JOURNAL_NOT_FOUND");
  if (entry.entry_type === "reversal") fail(409, "This entry is a reversal; it is never edited or reversed itself.", "ACCOUNTING_JOURNAL_AUTOMATIC");
  if (!isManual(entry)) {
    // An automatic entry is corrected from its document (a credit note, a reversed bill or receipt …) so the two never disagree.
    const posting = (await client.query("SELECT posting_event FROM tenant.accounting_postings WHERE organization_id = $1 AND journal_entry_id = $2 LIMIT 1",
      [context.organizationId, entry.id])).rows[0];
    const source = postingEventOf(posting?.posting_event ?? entry.source_type);
    fail(409, `This entry was recorded automatically from ${source.label.toLowerCase()}${entry.source_number ? ` ${entry.source_number}` : ""}. Correct it from that document, so the document and the accounts stay in step.`,
      "ACCOUNTING_JOURNAL_AUTOMATIC");
  }
  return entry;
}

// The input of a manual journal: header plus lines { accountId, description?, debit | credit, departmentId?, costCenterId?, partyId?, dimensions? }.
function journalInput(input, fallback = {}) {
  return {
    journalId: input.journalId ?? fallback.journalId, accountingDate: input.accountingDate ?? fallback.accountingDate,
    documentDate: input.documentDate === undefined ? fallback.documentDate : input.documentDate || null,
    reference: input.reference === undefined ? fallback.reference : input.reference, description: input.description ?? fallback.description,
    currencyCode: input.currencyCode ?? fallback.currencyCode, exchangeRate: input.exchangeRate ?? fallback.exchangeRate,
    entryType: ["standard", "adjustment", "accrual", "deferral"].includes(input.entryType) ? input.entryType : fallback.entryType ?? "standard",
    lines: Array.isArray(input.lines) ? input.lines.map((line) => ({
      accountId: line.accountId, description: line.description || null, debit: line.debit || "0", credit: line.credit || "0",
      departmentId: line.departmentId || null, costCenterId: line.costCenterId || null, partyId: line.partyId || null,
      dimensions: Array.isArray(line.dimensions) ? line.dimensions.filter((entry) => entry?.dimensionValueId) : [],
    })) : undefined,
  };
}

// A new manual journal, saved as a draft.
export async function createManualJournal(client, context, input = {}) {
  const prepared = journalInput(input, { accountingDate: localToday() });
  if (!prepared.journalId) {
    const ledger = await getPrimaryLedger(client, context);
    prepared.journalId = (await client.query(
      `SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' ORDER BY (journal_type = 'general') DESC, code LIMIT 1`,
      [context.organizationId, ledger.id])).rows[0]?.id;
  }
  const created = await createJournalEntry(client, context, prepared);
  return getJournalRecord(client, context, created.entry.id);
}

// Editing a draft, or one sent back by the approver (it returns to draft). Replaces the header and every line; the stale-copy check keeps
// two people from overwriting each other.
export async function updateManualJournal(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const entry = await lockManual(client, context, idValue);
  if (!EDITABLE.includes(entry.status)) fail(409, "Only a draft, or a journal sent back for changes, can be edited.", "ACCOUNTING_JOURNAL_NOT_EDITABLE");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(entry.updated_at).getTime())
    fail(409, "Someone else changed this journal. Reload it to see their changes.", "ACCOUNTING_JOURNAL_STALE");
  const current = await getJournalEntry(client, context, entry.id);
  const prepared = journalInput(input, {
    journalId: entry.journal_id, accountingDate: isoDate(entry.accounting_date), documentDate: entry.document_date ? isoDate(entry.document_date) : null, reference: entry.reference,
    description: entry.description, currencyCode: entry.currency_code, exchangeRate: entry.exchange_rate, entryType: entry.entry_type,
  });
  if (!prepared.lines) prepared.lines = current.lines.map((line) => ({ accountId: line.account_id, description: line.description, debit: line.debit_amount, credit: line.credit_amount,
    departmentId: line.department_id, costCenterId: line.cost_center_id, partyId: line.party_id,
    dimensions: line.dimensions.map((allocation) => ({ dimensionId: allocation.dimension_id, dimensionValueId: allocation.dimension_value_id, allocationPercent: allocation.allocation_percent })) }));
  const organization = await loadOrganization(client, context);
  const ledger = await getPrimaryLedger(client, context, entry.ledger_id);
  const journal = await loadAccountingJournal(client, context, ledger.id, prepared.journalId);
  const accountingDate = isoDate(prepared.accountingDate, "Posting date");
  const period = await getOpenPeriod(client, context, accountingDate);
  const normalized = await normalizeJournalLines(client, context, organization, ledger, prepared, accountingDate);
  const contentHash = hashPayload({ input: prepared, lines: normalized.lines.map((line) => ({ ...line, debit: String(line.debit), credit: String(line.credit) })) });
  await client.query("DELETE FROM tenant.accounting_line_dimensions WHERE organization_id = $1 AND journal_line_id IN (SELECT id FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND journal_entry_id = $2)",
    [context.organizationId, entry.id]);
  await client.query("DELETE FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND journal_entry_id = $2", [context.organizationId, entry.id]);
  await client.query(
    `UPDATE tenant.accounting_journal_entries
        SET journal_id = $3, fiscal_period_id = $4, entry_date = $5, accounting_date = $5, document_date = $6, reference = $7, description = $8, entry_type = $9,
            currency_code = $10, exchange_rate = $11, content_hash = $12, status = 'draft', approval_request_id = NULL, submitted_at = NULL, submitted_by = NULL,
            approved_at = NULL, approved_by = NULL, updated_by = $13
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, entry.id, journal.id, period.id, accountingDate, prepared.documentDate ? isoDate(prepared.documentDate, "Document date") : null,
      text(prepared.reference, 200) || null, requiredText(prepared.description, "Description", 1000), prepared.entryType, normalized.documentCurrency,
      asDatabaseDecimal(normalized.exchangeRate), contentHash, context.userId ?? null]);
  await insertJournalLines(client, context, entry.id, normalized.lines);
  await client.query(
    `UPDATE tenant.accounting_postings SET amount = $3, currency_code = $4, posting_date = $5, transaction_date = $6, updated_at = now()
      WHERE organization_id = $1 AND journal_entry_id = $2 AND posting_event = 'manual_journal'`,
    [context.organizationId, entry.id, asDatabaseDecimal(normalized.totalDebit), normalized.functionalCurrency, accountingDate, prepared.documentDate || accountingDate]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.updated", entry.status, "draft", {
    before: { total: String(current.lines.reduce((sum, line) => sum + Number(line.base_debit_amount), 0)), date: isoDate(entry.accounting_date), lines: current.lines.length },
    after: { total: asDatabaseDecimal(normalized.totalDebit), date: accountingDate, lines: normalized.lines.length },
  });
  return getJournalRecord(client, context, entry.id);
}

// Discarding a draft (or one sent back): it is kept, marked discarded, and never posts. A journal awaiting approval is sent back first.
export async function discardManualJournal(client, context, idValue, { reason } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const entry = await lockManual(client, context, idValue);
  if (!EDITABLE.includes(entry.status)) fail(409, entry.status === "pending_approval" ? "This journal is awaiting approval; ask the approver to send it back first." : "Only a draft can be discarded.",
    "ACCOUNTING_JOURNAL_NOT_EDITABLE");
  const why = requiredText(reason, "Reason", 500);
  await client.query("UPDATE tenant.accounting_journal_entries SET status = 'cancelled', updated_by = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, entry.id, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.accounting_postings SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4, updated_at = now()
      WHERE organization_id = $1 AND journal_entry_id = $2 AND status IN ('PENDING', 'DRAFT', 'FAILED')`, [context.organizationId, entry.id, context.userId ?? null, why]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.discarded", entry.status, "cancelled", { reason: why });
  return getJournalRecord(client, context, entry.id);
}

// Reversing a posted manual journal on a chosen date (today if not given; never before the original).
export async function reverseManualJournal(client, context, idValue, { reason, accountingDate } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalReverse);
  requiredText(reason, "Reason", 500);
  const entry = await lockManual(client, context, idValue);
  const reversal = await reverseJournalEntry(client, context, entry.id, { reason, accountingDate: accountingDate || undefined });
  return getJournalRecord(client, context, reversal.entry.id);
}

// Reverse and correct: the original is reversed, and a correction draft is opened with the original's lines for the user to fix and post.
export async function correctManualJournal(client, context, idValue, { reason, accountingDate } = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalReverse);
  requirePermission(context, ACCOUNTING_PERMISSIONS.journalCreate);
  const entry = await lockManual(client, context, idValue);
  if (entry.status !== "posted") fail(409, "Only a posted journal is corrected; edit a draft instead.", "ACCOUNTING_JOURNAL_NOT_POSTED");
  const why = requiredText(reason, "Reason", 500);
  const date = accountingDate ? isoDate(accountingDate, "Correction date") : localToday();
  const original = await getJournalEntry(client, context, entry.id);
  await reverseJournalEntry(client, context, entry.id, { reason: why, accountingDate: date });
  const correction = await createJournalEntry(client, context, {
    journalId: entry.journal_id, accountingDate: date, documentDate: entry.document_date ? isoDate(entry.document_date) : null, entryType: entry.entry_type,
    reference: entry.entry_number, description: `Correction of ${entry.entry_number}: ${entry.description}`, currencyCode: entry.currency_code, exchangeRate: entry.exchange_rate,
    lines: original.lines.map((line) => ({ accountId: line.account_id, description: line.description, debit: line.debit_amount, credit: line.credit_amount, departmentId: line.department_id,
      costCenterId: line.cost_center_id, partyId: line.party_id,
      dimensions: line.dimensions.map((allocation) => ({ dimensionId: allocation.dimension_id, dimensionValueId: allocation.dimension_value_id, allocationPercent: allocation.allocation_percent })) })),
  });
  await client.query("UPDATE tenant.accounting_journal_entries SET correction_of_id = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, correction.entry.id, entry.id]);
  await event(client, context, "journal_entry", entry.id, "accounting.journal.correction_opened", "reversed", "reversed", { correctionEntryId: correction.entry.id, reason: why });
  return getJournalRecord(client, context, correction.entry.id);
}

const HISTORY_LABEL = {
  "accounting.journal.created": "Created as a draft", "accounting.journal.updated": "Edited", "accounting.journal.submitted": "Submitted for approval",
  "accounting.journal.auto_approved": "Submitted (no approval needed)", "accounting.journal.approved": "Approved", "accounting.journal.rejected": "Sent back for changes",
  "accounting.journal.posted": "Posted", "accounting.journal.reversed": "Reversed", "accounting.journal.discarded": "Discarded",
  "accounting.journal.correction_opened": "Correction opened",
};

// One journal for its record page: the posting-service detail plus what the manual journal life needs — its audit trail, the correction
// links, whether it can be edited, and the line values in the journal's own currency (for the edit form).
export async function getJournalRecord(client, context, idValue) {
  const detail = await getJournalEntryDetail(client, context, idValue);
  const raw = await getJournalEntry(client, context, detail.id);
  const history = (await client.query(
    `SELECT event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor
       FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'journal_entry' AND event.entity_id = $2 ORDER BY event.occurred_at DESC, event.id DESC`,
    [context.organizationId, detail.id])).rows;
  const links = (await client.query(
    `SELECT corrected.id AS correction_of_id, corrected.entry_number AS correction_of_number, correction.id AS corrected_by_id, correction.entry_number AS corrected_by_number,
            correction.status AS corrected_by_status
       FROM tenant.accounting_journal_entries entry
       LEFT JOIN tenant.accounting_journal_entries corrected ON corrected.id = entry.correction_of_id
       LEFT JOIN tenant.accounting_journal_entries correction ON correction.correction_of_id = entry.id AND correction.status <> 'cancelled'
      WHERE entry.organization_id = $1 AND entry.id = $2 LIMIT 1`, [context.organizationId, detail.id])).rows[0] ?? {};
  const manual = isManual(raw.entry);
  return {
    ...detail,
    journalId: raw.entry.journal_id, entryType: raw.entry.entry_type, updatedAt: raw.entry.updated_at, submittedById: raw.entry.submitted_by ?? null,
    manual, editable: manual && EDITABLE.includes(raw.entry.status),
    correctionOf: links.correction_of_id ? { id: links.correction_of_id, number: links.correction_of_number } : null,
    correctedBy: links.corrected_by_id ? { id: links.corrected_by_id, number: links.corrected_by_number, status: links.corrected_by_status } : null,
    formLines: raw.lines.map((line) => ({
      accountId: line.account_id, description: line.description ?? "", debit: Number(line.debit_amount) ? String(line.debit_amount) : "", credit: Number(line.credit_amount) ? String(line.credit_amount) : "",
      departmentId: line.department_id ?? null, costCenterId: line.cost_center_id ?? null, partyId: line.party_id ?? null,
      dimensions: line.dimensions.map((allocation) => ({ dimensionId: allocation.dimension_id, dimensionValueId: allocation.dimension_value_id })),
    })),
    history: history.map((row) => ({
      label: HISTORY_LABEL[row.event_type] ?? row.event_type.replace(/^accounting\.journal\./, "").replace(/_/g, " "), at: row.occurred_at, actor: row.actor,
      detail: row.metadata?.reason ?? (row.metadata?.after ? `Total ${row.metadata.before?.total} → ${row.metadata.after.total}` : null),
    })),
  };
}

// What the journal form offers: journals, accounts that take manual journals, departments, cost centres, parties, currencies and dimensions.
export async function getJournalFormOptions(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const ledger = await getPrimaryLedger(client, context);
  const organization = await loadOrganization(client, context);
  const q = async (sql, values = [context.organizationId]) => (await client.query(sql, values)).rows;
  const dimensions = await q(`SELECT id, code, name, required_for_classes FROM tenant.accounting_dimensions WHERE organization_id = $1 AND status = 'active' ORDER BY code`);
  const values = await q(`SELECT id, dimension_id, code, name FROM tenant.accounting_dimension_values WHERE organization_id = $1 AND status = 'active' ORDER BY code`);
  const policy = (await q("SELECT COALESCE(manual_journal_approval, true) AS required, COALESCE(journal_approval_threshold, 0)::text AS threshold FROM tenant.accounting_settings WHERE organization_id = $1"))[0];
  return {
    baseCurrency: String(organization.base_currency ?? "INR").trim(),
    today: localToday(),
    approval: { required: policy?.required !== false, threshold: policy?.threshold ?? "0" },
    journals: (await q(`SELECT id, code, name, journal_type, approval_required FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' ORDER BY code`,
      [context.organizationId, ledger.id])).map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.journal_type, approvalRequired: row.approval_required })),
    accounts: (await q(
      `SELECT id, code, name, account_class, account_type, currency_code FROM tenant.accounting_accounts
        WHERE organization_id = $1 AND ledger_id = $2 AND status = 'active' AND NOT is_group AND allow_manual_posting ORDER BY code`, [context.organizationId, ledger.id]))
      .map((row) => ({ id: row.id, code: row.code, name: row.name, accountClass: row.account_class, accountType: row.account_type, currencyCode: row.currency_code?.trim() ?? null })),
    departments: (await q("SELECT id, code, name FROM public.departments WHERE organization_id = $1 AND status = 'active' ORDER BY name")),
    costCenters: (await q("SELECT id, code, name, department_id FROM public.cost_centers WHERE organization_id = $1 AND status = 'active' ORDER BY name"))
      .map((row) => ({ id: row.id, code: row.code, name: row.name, departmentId: row.department_id })),
    parties: (await q("SELECT id, display_name FROM tenant.business_parties WHERE organization_id = $1 AND status = 'active' ORDER BY display_name LIMIT 2000"))
      .map((row) => ({ id: row.id, name: row.display_name })),
    currencies: (await q("SELECT code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY code")).map((row) => ({ code: row.code.trim(), name: row.name })),
    dimensions: dimensions.map((dimension) => ({ id: dimension.id, code: dimension.code, name: dimension.name, requiredFor: dimension.required_for_classes ?? [],
      values: values.filter((value) => value.dimension_id === dimension.id).map((value) => ({ id: value.id, code: value.code, name: value.name })) })),
  };
}

