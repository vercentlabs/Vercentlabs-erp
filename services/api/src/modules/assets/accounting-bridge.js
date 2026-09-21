// The Assets -> Accounting handoff (F266). Assets owns the operational fact; Accounting owns the journal.
// Each financial event (capitalisation, depreciation run, revaluation/impairment, disposal) becomes one
// posted journal entry through Accounting's own internal path, so its balance check, fiscal-period lock
// and audit apply. When the company has no Accounting foundation, or the category has no accounts
// configured, the outcome is reported as 'not_configured' instead of failing the asset operation.
import { getPrimaryLedger } from "../accounting/index.js";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "../accounting/index.js";
import { AssetError, fromCents } from "./common.js";

function accountingContext(c, extra = []) {
  return { organizationId: c.organizationId, userId: c.userId, activeCompanyId: c.companyId, activeBranchId: null, allowAllCompanies: false, permissions: extra, roleSlugs: [] };
}

export async function accountingAvailable(client, c) {
  const ledger = await client.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2 AND ledger_type='primary' AND status='active' LIMIT 1`, [c.organizationId, c.companyId]);
  return Boolean(ledger.rows[0]);
}

// lines: [{ accountId, debitCents, creditCents, description }]. Returns { status, journalEntryId }.
export async function postAssetJournal(client, c, { date, reference, description, sourceType, sourceId, sourceNumber, lines }) {
  if (lines.some((l) => !l.accountId)) return { status: "not_configured", journalEntryId: null };
  if (!(await accountingAvailable(client, c))) return { status: "not_configured", journalEntryId: null };
  const ctx = accountingContext(c);
  const ledger = await getPrimaryLedger(client, ctx, c.companyId, null);
  const journal = await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND journal_type='asset' AND status='active' ORDER BY created_at LIMIT 1`, [c.organizationId, c.companyId, ledger.id]);
  if (!journal.rows[0]) return { status: "not_configured", journalEntryId: null };
  const created = await createJournalEntry(client, ctx, {
    companyId: c.companyId, ledgerId: ledger.id, journalId: journal.rows[0].id, entryDate: date, accountingDate: date,
    entryType: "asset", reference, description,
    lines: lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: fromCents(l.debitCents || 0n), credit: fromCents(l.creditCents || 0n), referenceType: sourceType, referenceId: sourceId })),
  }, { internal: true, sourceModule: "assets", sourceType, sourceId, sourceNumber });
  await postJournalEntry(client, ctx, created.entry.id, { internal: true, allowDraft: true });
  return { status: "posted", journalEntryId: created.entry.id };
}

export async function reverseAssetJournal(client, c, journalEntryId, reason) {
  if (!journalEntryId) return null;
  const ctx = accountingContext(c, ["accounting.journal.reverse", "accounting.view"]);
  try {
    return await reverseJournalEntry(client, ctx, journalEntryId, { reason });
  } catch (error) {
    if (error?.status) throw new AssetError(error.status === 403 ? 409 : error.status, error.message, "ASSET_ACCOUNTING_REJECTED");
    throw error;
  }
}
