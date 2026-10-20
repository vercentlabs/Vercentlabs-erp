// GST — input tax credit reversed and reclaimed (GSTR-3B 4(B) and 4(D)(1)): a reversal moves credit out of the claimable input accounts —
// to "Input GST reversed — reclaimable" when it can come back (Rule 37: the supplier was not paid within 180 days), else to ineligible input
// tax (Rules 42 / 43 common credit, s.17(5) blocked credit) — and a reclaim brings a reclaimable reversal back once. Each posts once.
import { randomUUID } from "node:crypto";

import { getAccountMapping, getPrimaryLedger } from "../accounting/core.js";
import { createJournalEntry, postJournalEntry } from "../accounting/journals.js";
import { optionalMapping } from "../accounting/tax.js";
import { GST_PERMISSIONS as P, GstError, monthOf, need, paise, registrationOf, rupees, text, uuid, ymd } from "./gst-common.js";

export const ITC_REVERSAL_REASONS = Object.freeze({
  rule_37_non_payment: { label: "Supplier not paid within 180 days (Rule 37)", reclaimable: true },
  rule_42_43_common_credit: { label: "Common credit for exempt / non-business use (Rules 42, 43)", reclaimable: false },
  section_17_5_blocked: { label: "Blocked credit (s.17(5))", reclaimable: false },
  rule_38: { label: "Banking company / financial institution (Rule 38)", reclaimable: false },
  other: { label: "Other reversal", reclaimable: null },
});
const HEADS = ["igst", "cgst", "sgst", "cess"];

async function journalFor(client, c, ledgerId) {
  const row = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type IN ('tax', 'general') AND status = 'active'
      ORDER BY (journal_type = 'tax') DESC, created_at LIMIT 1`, [c.organizationId, ledgerId])).rows[0];
  if (!row) throw new GstError(409, "A Tax or General journal is required.", "GST_JOURNAL_MISSING");
  return row.id;
}
const lastDayOrToday = (start, end) => { const today = ymd(new Date()); return today < end ? (today < start ? start : today) : end; };

async function post(client, c, { date, lines, description, reference, adjustmentId }) {
  const ledger = await getPrimaryLedger(client, c);
  const journal = await createJournalEntry(client, c, { ledgerId: ledger.id, journalId: await journalFor(client, c, ledger.id), entryDate: date, accountingDate: date, documentDate: date,
    entryType: "subledger", reference, description, lines }, { internal: true, sourceModule: "accounting", sourceType: "gst_itc_adjustment", sourceId: adjustmentId, sourceNumber: reference,
    postingEvent: "gst_itc_adjustment", postingSourceType: "gst_itc_adjustment", postingSourceId: adjustmentId });
  await postJournalEntry(client, c, journal.entry.id, { internal: true, allowDraft: true });
  return { ledger, journal };
}

// input: registrationId, period (the GSTR-3B month), reasonCode, reclaimable (for "other"), igst / cgst / sgst / cess, sourceType + sourceId
// (optional: the supplier invoice), note, date, idempotencyKey
export async function reverseInputTaxCredit(client, c, input = {}) {
  need(c, P.itc, "You do not have permission to reverse input tax credit.");
  const registration = await registrationOf(client, c, input.registrationId);
  const { start, end, month } = monthOf(input.period);
  const reason = ITC_REVERSAL_REASONS[input.reasonCode];
  if (!reason) throw new GstError(400, "Choose why the credit is reversed.", "GST_INVALID");
  const note = text(input.note, 500);
  if (!note) throw new GstError(400, "Describe the reversal (the supplier invoices or the working).", "GST_REASON_REQUIRED");
  const key = text(input.idempotencyKey, 120) || null;
  if (key) {
    const again = (await client.query(`SELECT * FROM tenant.gst_itc_adjustments WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (again) return { ...again, replayed: true };
  }
  const amounts = Object.fromEntries(HEADS.map((h) => [h, paise(input[h])]));
  if (HEADS.some((h) => amounts[h] < 0) || HEADS.every((h) => !amounts[h])) throw new GstError(400, "Enter the credit reversed under at least one head.", "GST_INVALID");
  const reclaimable = reason.reclaimable ?? (input.reclaimable === true || input.reclaimable === "true");
  let source = null;
  if (input.sourceId) {
    source = { type: text(input.sourceType, 40) || "vendor_bill", id: uuid(input.sourceId, "Supplier invoice") };
    const claimed = Object.fromEntries((await client.query(`SELECT tax_type, sum(tax_amount) AS t FROM tenant.accounting_tax_ledger WHERE organization_id = $1 AND source_id = $2 AND direction = 'input'
        AND status <> 'reversed' AND itc_status = 'ELIGIBLE' GROUP BY tax_type`, [c.organizationId, source.id])).rows.map((r) => [r.tax_type === "utgst" ? "sgst" : r.tax_type, paise(r.t)]));
    const before = Object.fromEntries((await client.query(`SELECT sum(igst) AS igst, sum(cgst) AS cgst, sum(sgst) AS sgst, sum(cess) AS cess FROM tenant.gst_itc_adjustments
        WHERE organization_id = $1 AND source_id = $2 AND kind = 'reversal'`, [c.organizationId, source.id])).rows.flatMap((r) => HEADS.map((h) => [h, paise(r[h])])));
    for (const h of HEADS) if (amounts[h] > (claimed[h] ?? 0) - (before[h] ?? 0)) throw new GstError(409, `More ${h.toUpperCase()} than was claimed on that invoice would be reversed.`, "GST_ITC_EXCEEDS_CLAIMED");
  }
  const id = randomUUID();
  const date = text(input.date, 10) || lastDayOrToday(start, end);
  const ledger = await getPrimaryLedger(client, c);
  const target = reclaimable ? (await optionalMapping(client, c, ledger.id, "itc_reversed", { date })) ?? await getAccountMapping(client, c, ledger.id, "itc_ineligible", { date })
    : await getAccountMapping(client, c, ledger.id, "itc_ineligible", { date });
  const lines = [];
  let total = 0;
  for (const h of HEADS) {
    if (!amounts[h]) continue;
    const account = await getAccountMapping(client, c, ledger.id, `input_${h}`, { date });
    lines.push({ accountId: account.account_id, description: `Input ${h.toUpperCase()} reversed · ${reason.label}`, debit: 0, credit: rupees(amounts[h]), referenceType: "gst_itc_adjustment", referenceId: id });
    total += amounts[h];
  }
  lines.unshift({ accountId: target.account_id, description: `Input GST reversed (${reclaimable ? "reclaimable" : "not reclaimable"}) · ${month}`, debit: rupees(total), credit: 0, referenceType: "gst_itc_adjustment", referenceId: id });
  const { journal } = await post(client, c, { date, lines, description: `Input tax credit reversed for ${month} · ${reason.label}`, reference: `ITC-REV ${month}`, adjustmentId: id });
  return (await client.query(`INSERT INTO tenant.gst_itc_adjustments (id, organization_id, registration_id, period, kind, reason_code, reclaimable, source_type, source_id, igst, cgst, sgst, cess, journal_entry_id,
      note, idempotency_key, created_by) VALUES ($1,$2,$3,$4,'reversal',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [id, c.organizationId, registration.id, start, input.reasonCode, reclaimable, source?.type ?? null, source?.id ?? null, rupees(amounts.igst), rupees(amounts.cgst), rupees(amounts.sgst), rupees(amounts.cess),
      journal.entry.id, note, key, c.userId ?? null])).rows[0];
}

// The whole reclaimable reversal comes back in the month given (e.g. once the supplier is paid).
export async function reclaimInputTaxCredit(client, c, reversalId, input = {}) {
  need(c, P.itc, "You do not have permission to reclaim input tax credit.");
  const rev = (await client.query(`SELECT * FROM tenant.gst_itc_adjustments WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(reversalId, "Reversal")])).rows[0];
  if (!rev || rev.kind !== "reversal") throw new GstError(404, "That reversal was not found.", "GST_ITC_NOT_FOUND");
  if (!rev.reclaimable) throw new GstError(409, "This reversal cannot be reclaimed.", "GST_ITC_NOT_RECLAIMABLE");
  if ((await client.query(`SELECT 1 FROM tenant.gst_itc_adjustments WHERE reclaims_id = $1`, [rev.id])).rows.length) throw new GstError(409, "This reversal was already reclaimed.", "GST_ITC_ALREADY_RECLAIMED");
  const { start, end, month } = monthOf(input.period);
  if (start < ymd(rev.period)) throw new GstError(400, "A reclaim is in the reversal's month or later.", "GST_PERIOD_INVALID");
  const note = text(input.note, 500);
  if (!note) throw new GstError(400, "Say why the credit can be reclaimed (e.g. the payment made).", "GST_REASON_REQUIRED");
  const date = text(input.date, 10) || lastDayOrToday(start, end);
  const parked = (await client.query(`SELECT account_id FROM tenant.accounting_journal_lines WHERE organization_id = $1 AND journal_entry_id = $2 AND base_debit_amount > 0 LIMIT 1`, [c.organizationId, rev.journal_entry_id])).rows[0];
  const ledger = await getPrimaryLedger(client, c);
  const id = randomUUID();
  const lines = [];
  let total = 0;
  for (const h of HEADS) {
    const a = paise(rev[h]);
    if (!a) continue;
    const account = await getAccountMapping(client, c, ledger.id, `input_${h}`, { date });
    lines.push({ accountId: account.account_id, description: `Input ${h.toUpperCase()} reclaimed`, debit: rupees(a), credit: 0, referenceType: "gst_itc_adjustment", referenceId: id });
    total += a;
  }
  lines.push({ accountId: parked.account_id, description: `Input GST reversed earlier (${ymd(rev.period).slice(0, 7)}) reclaimed`, debit: 0, credit: rupees(total), referenceType: "gst_itc_adjustment", referenceId: id });
  const { journal } = await post(client, c, { date, lines, description: `Input tax credit reclaimed in ${month}`, reference: `ITC-RCL ${month}`, adjustmentId: id });
  return (await client.query(`INSERT INTO tenant.gst_itc_adjustments (id, organization_id, registration_id, period, kind, reason_code, reclaimable, reclaims_id, source_type, source_id, igst, cgst, sgst, cess,
      journal_entry_id, note, created_by) VALUES ($1,$2,$3,$4,'reclaim','reclaim',false,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [id, c.organizationId, rev.registration_id, start, rev.id, rev.source_type, rev.source_id, rev.igst, rev.cgst, rev.sgst, rev.cess, journal.entry.id, note, c.userId ?? null])).rows[0];
}

export async function listItcAdjustments(client, c, input = {}) {
  need(c, P.view, "You do not have permission to see GST working papers.");
  const registration = await registrationOf(client, c, input.registrationId);
  const rows = (await client.query(`SELECT a.*, to_char(a.period, 'YYYY-MM') AS month, u.full_name AS created_by_name, b.bill_number,
      EXISTS (SELECT 1 FROM tenant.gst_itc_adjustments r WHERE r.reclaims_id = a.id) AS reclaimed
    FROM tenant.gst_itc_adjustments a LEFT JOIN public.users u ON u.id = a.created_by LEFT JOIN tenant.accounting_vendor_bills b ON b.id = a.source_id
    WHERE a.organization_id = $1 AND a.registration_id = $2 ORDER BY a.period DESC, a.created_at DESC LIMIT 500`, [c.organizationId, registration.id])).rows;
  return { rows: rows.map((r) => ({ ...r, reasonLabel: r.kind === "reclaim" ? "Reclaimed" : ITC_REVERSAL_REASONS[r.reason_code]?.label ?? r.reason_code })),
    reasons: Object.entries(ITC_REVERSAL_REASONS).map(([value, v]) => ({ value, label: v.label, reclaimable: v.reclaimable })) };
}
