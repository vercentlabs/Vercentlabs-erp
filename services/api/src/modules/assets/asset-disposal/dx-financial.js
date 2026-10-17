// Assets — Gain / Loss on Disposal: the Finance-controlled, versioned calculation inside the disposal case. The consideration before GST (in the
// Company's currency at Finance's rate), source-linked disposal costs (reducing proceeds or kept apart), the carrying amount at the cutoff and the
// result — gain, loss or zero — as preview versions anyone with the financials may run and the version Finance approves; the posted result is
// never edited: a Credit Note after posting is a linked reversal and adjustment. Every figure stays traceable to the asset and its sources.
import { has, text, uuid } from "../common.js";
import { DX, FINANCE_POST, TYPE_LABEL, dayOfDb, dxError, fromPaise, seesDisposals, toPaise } from "./dx-rules.js";

export const GL_CODES = Object.freeze({
  DISPOSAL_GL_COST_MISSING: "Finance has not confirmed the asset's cost.", DISPOSAL_DEPRECIATION_PENDING: "Final depreciation requires review.",
  DISPOSAL_CARRYING_VALUE_UNCONFIRMED: "Finance cannot yet confirm the carrying value.", DISPOSAL_PROCEEDS_UNCONFIRMED: "Confirm the sale consideration.",
  DISPOSAL_COSTS_UNRECONCILED: "Some disposal costs are not reconciled.", DISPOSAL_GAIN_LOSS_STALE: "The financial inputs changed. Recalculate the preview.",
  DISPOSAL_ACCOUNT_MAPPING_MISSING: "Configure the disposal gain/loss accounts.", DISPOSAL_PERIOD_CLOSED: "The disposal period is closed.",
  DISPOSAL_GL_ALREADY_POSTED: "This disposal has already been posted.", DISPOSAL_JOURNAL_UNBALANCED: "Finance journal totals do not balance.",
  DISPOSAL_GL_RECONCILIATION_FAILED: "The financial result does not agree with Finance.", DISPOSAL_BOOK_COMPANY_MISMATCH: "The accounting book or asset belongs to another Company.",
  DISPOSAL_FINANCIAL_ACCESS_DENIED: "You are not permitted to perform this financial action.", DISPOSAL_POSTING_OUTCOME_UNKNOWN: "The posting is being verified. Do not post it again.",
});
export const FINANCIAL_STATE = Object.freeze({ NOT_READY: "Not ready", PREVIEW_READY: "Preview ready", REVIEW_REQUIRED: "Review required", APPROVED: "Approved by Finance", POSTING: "Posting",
  POSTED: "Posted", RECONCILED: "Posted and reconciled", ADJUSTED: "Adjusted after posting", RECOVERY_REQUIRED: "Being verified" });
export const BOOK = "FINANCIAL_REPORTING";
const glError = (status, code, message, details) => dxError(status, code, message ?? GL_CODES[code], details);
const LIVE_BILL = ["posted", "partially_paid", "paid", "overdue", "disputed"];

// A paise amount times a Finance exchange rate (decimal string), rounded half-up — deterministic.
export function convert(paise, rate) {
  const [i, f = ""] = String(rate ?? "1").split(".");
  const scale = 10n ** 10n;
  const r = BigInt(i) * scale + BigInt((f + "0000000000").slice(0, 10));
  const x = paise * r;
  const q = x / scale; const rem = x % scale;
  return rem * 2n >= scale ? q + 1n : q;
}
export const outcomeOf = (gainLoss) => (gainLoss === null || gainLoss === undefined ? null : toPaise(gainLoss) > 0n ? "GAIN" : toPaise(gainLoss) < 0n ? "LOSS" : "ZERO");

// The consideration of a line: its proceeds share before GST, its GST share and gross amount, in the invoice's currency and in the Company's.
export async function considerationOf(client, l, proceedsPaise) {
  if (!l.sale_invoice_id) return { proceeds: proceedsPaise, gross: proceedsPaise, tax: 0n, currency: null, rate: "1", foreign: false };
  const inv = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
  if (!inv) return { proceeds: proceedsPaise, gross: proceedsPaise, tax: 0n, currency: null, rate: "1", foreign: false };
  const net = toPaise(inv.subtotal) - toPaise(inv.discount_total ?? 0) + toPaise(inv.charge_total ?? 0);
  const tax = net > 0n ? (toPaise(inv.tax_total ?? 0) * proceedsPaise) / net : 0n;
  const foreign = inv.currency_code && inv.functional_currency_code && inv.currency_code !== inv.functional_currency_code;
  const rate = foreign ? String(inv.exchange_rate) : "1";
  return { proceeds: foreign ? convert(proceedsPaise, rate) : proceedsPaise, gross: foreign ? convert(proceedsPaise + tax, rate) : proceedsPaise + tax, tax: foreign ? convert(tax, rate) : tax,
    currency: inv.currency_code, rate, foreign, invoiceProceeds: proceedsPaise };
}
// The disposal costs of a line: actual costs linked from posted supplier bills (those reducing proceeds, and those kept as a separate expense),
// or — with none linked yet — the estimate, which only a preview may use.
export async function costsOf(client, l) {
  const links = (await client.query(`SELECT amount, treatment FROM tenant.asset_disposal_cost_links WHERE line_id = $1 AND status = 'ACTIVE'`, [l.id])).rows;
  const sum = (t) => links.filter((x) => x.treatment === t).reduce((s, x) => s + toPaise(x.amount), 0n);
  const estimate = toPaise(l.disposal_costs ?? 0);
  return links.length ? { net: sum("NET_PROCEEDS"), separate: sum("SEPARATE_EXPENSE"), estimated: false, estimate } : { net: estimate, separate: 0n, estimated: estimate > 0n, estimate };
}
export async function basisSourceOf(client, assetId) {
  const b = (await client.query(`SELECT source FROM tenant.asset_depreciation_bases WHERE asset_id = $1 AND status = 'APPROVED' ORDER BY approved_at DESC NULLS LAST LIMIT 1`, [assetId]).catch(() => ({ rows: [] }))).rows[0];
  return b?.source ?? "CAPITALIZATION";
}

async function loadCase(client, c, caseId) {
  let id;
  try { id = uuid(caseId, "Disposal"); } catch { throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND"); }
  const k = (await client.query(`SELECT * FROM tenant.asset_disposal_cases WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!k) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  return k;
}
async function lineOf(client, k, lineId) {
  const lines = (await client.query(`SELECT l.*, a.asset_number, a.capitalization_class FROM tenant.asset_disposal_lines l JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = $1 ORDER BY l.line_number`, [k.id])).rows;
  const l = lineId ? lines.find((x) => x.id === lineId) : lines.filter((x) => !["CANCELLED", "REJECTED"].includes(x.line_status)).length === 1 ? lines.find((x) => !["CANCELLED", "REJECTED"].includes(x.line_status)) : null;
  if (!l) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose the asset in this case.", { field: "lineId" });
  return l;
}
async function event(client, c, refs, action, details = {}, reason = null) {
  await client.query(`INSERT INTO tenant.asset_disposal_events (organization_id, case_id, line_id, asset_id, action, details, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [c.organizationId, refs.caseId, refs.lineId ?? null, refs.assetId ?? null, action, JSON.stringify(details), reason, c.userId ?? null]);
}
const nextVersion = async (client, lineId) => Number((await client.query(`SELECT COALESCE(max(version), 0)::int + 1 AS v FROM tenant.asset_disposal_financial_snapshots WHERE line_id = $1`, [lineId])).rows[0].v);
export async function insertSnapshot(client, c, l, p, kind, extra = {}) {
  const prev = (await client.query(`SELECT id FROM tenant.asset_disposal_financial_snapshots WHERE line_id = $1 ORDER BY version DESC LIMIT 1`, [l.id])).rows[0]?.id ?? null;
  return (await client.query(`INSERT INTO tenant.asset_disposal_financial_snapshots (organization_id, line_id, asset_id, book, effective_date, capitalized_cost, accumulated_depreciation, impairment, carrying_amount,
      net_proceeds, disposal_costs, gain_loss, asset_account_id, accumulated_account_id, proceeds_account_id, gain_loss_account_id, loss_account_id, basis_hash, confirmed_by, kind, version,
      gross_consideration, consideration_tax, consideration_currency, exchange_rate, other_adjustments, separate_costs, costs_estimated, basis_source, supersedes_snapshot_id, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING id, version`,
    [c.organizationId, l.id, l.asset_id, BOOK, p.effective, p.cost ?? "0.00", p.accumulated ?? "0.00", p.impairment ?? "0.00", p.carrying ?? "0.00", p.proceeds, p.costs, p.gainLoss ?? "0.00",
      p.accounts?.asset ?? null, p.accounts?.accumulated ?? null, p.accounts?.proceeds ?? null, p.accounts?.gainLoss ?? null, p.accounts?.loss ?? null, p.basis ?? "tracked-only", c.userId ?? null, kind,
      await nextVersion(client, l.id), p.grossConsideration ?? p.proceeds, p.tax ?? "0.00", p.currency ?? null, p.rate ?? "1", p.otherAdjustments ?? "0.00", p.separateCosts ?? "0.00",
      Boolean(p.costsEstimated), p.basisSource ?? null, extra.supersedes ?? prev, extra.reason ?? null])).rows[0];
}

// input: { lineId?, book? } — a preview version of the calculation (Estimated — not posted); nothing is approved or posted by it.
export async function recalculateDisposalPreview(client, c, caseId, input = {}) {
  if (!has(c, DX.financials)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  if (input.book && String(input.book) !== BOOK) throw glError(409, "DISPOSAL_BOOK_COMPANY_MISMATCH");
  const k = await loadCase(client, c, caseId);
  const l = await lineOf(client, k, input.lineId);
  const { financialPictureOf } = await import("./dx-commands.js");
  const p = await financialPictureOf(client, c, k, l);
  const s = await insertSnapshot(client, c, l, p, "PREVIEW");
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "GAIN_LOSS_PREVIEWED", { version: s.version, gainLoss: p.gainLoss, outcome: outcomeOf(p.gainLoss) });
  return { caseId: k.id, lineId: l.id, snapshotId: s.id, version: s.version, label: "Estimated — not posted", outcome: outcomeOf(p.gainLoss), ...p };
}
// Every calculation version of an asset's disposal, newest first: preview, approved, adjustment; which one Finance posted, which are superseded or stale.
export async function getDisposalFinancialSnapshots(client, c, caseId, input = {}) {
  if (!has(c, DX.financials)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await lineOf(client, k, input.lineId);
  const rows = (await client.query(`SELECT s.*, COALESCE(NULLIF(u.full_name, ''), u.email) AS by_name,
      (SELECT i.status FROM tenant.asset_disposal_accounting_intents i WHERE i.snapshot_id = s.id ORDER BY i.created_at DESC LIMIT 1) AS posting
      FROM tenant.asset_disposal_financial_snapshots s LEFT JOIN public.users u ON u.id = s.confirmed_by WHERE s.line_id = $1 ORDER BY s.version DESC`, [l.id])).rows;
  const { financialPictureOf } = await import("./dx-commands.js");
  const now = l.line_status === "COMPLETED" ? null : await financialPictureOf(client, c, k, l).catch(() => null);
  const latestApproved = rows.find((r) => r.kind !== "PREVIEW")?.id;
  return rows.map((s) => ({ id: s.id, version: s.version, kind: s.kind, by: s.by_name, at: s.confirmed_at, effective: dayOfDb(s.effective_date), cost: fromPaise(toPaise(s.capitalized_cost)),
    accumulated: fromPaise(toPaise(s.accumulated_depreciation)), impairment: fromPaise(toPaise(s.impairment)), carrying: fromPaise(toPaise(s.carrying_amount)), gross: s.gross_consideration !== null ? fromPaise(toPaise(s.gross_consideration)) : null,
    tax: s.consideration_tax !== null ? fromPaise(toPaise(s.consideration_tax)) : null, currency: s.consideration_currency, rate: s.exchange_rate !== null ? String(s.exchange_rate) : null, proceeds: fromPaise(toPaise(s.net_proceeds)),
    costs: fromPaise(toPaise(s.disposal_costs)), separateCosts: fromPaise(toPaise(s.separate_costs)), costsEstimated: s.costs_estimated, gainLoss: fromPaise(toPaise(s.gain_loss)), outcome: outcomeOf(s.gain_loss), basisSource: s.basis_source,
    posting: s.posting ?? null, reason: s.reason, status: s.posting === "POSTED" ? "POSTED" : s.posting === "REVERSED" ? "REVERSED" : s.id !== latestApproved && s.kind !== "PREVIEW" ? "SUPERSEDED"
      : now && s.basis_hash !== now.basis ? "STALE" : s.kind === "PREVIEW" ? "PREVIEW" : "APPROVED" }));
}

// ------------------------------------------------------------------ disposal costs from their sources
// input: { lineId, bill (number or id), amount?, treatment: NET_PROCEEDS | SEPARATE_EXPENSE } — a posted supplier bill's pre-tax amount (or part of it) as
// this asset's direct disposal cost; a bill is never allocated beyond its amount, across every disposal.
export async function linkDisposalCost(client, c, caseId, input = {}) {
  if (!has(c, DX.financeReview) && !has(c, DX.create)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await lineOf(client, k, input.lineId);
  if (!["PENDING_HANDOVER", "PENDING_FINANCE"].includes(l.line_status)) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Costs are linked to an asset whose disposal is under way and not yet posted.");
  if ((await client.query(`SELECT 1 FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('POSTING', 'POSTED', 'RECOVERY_REQUIRED')`, [l.id])).rows[0]) throw glError(409, "DISPOSAL_GL_ALREADY_POSTED");
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND (bill_number = $2 OR id::text = $2)`, [c.organizationId, text(input.bill, 100)])).rows[0];
  if (!bill) throw glError(400, "DISPOSAL_COSTS_UNRECONCILED", "No such supplier bill.");
  if (!LIVE_BILL.includes(String(bill.status))) throw glError(409, "DISPOSAL_COSTS_UNRECONCILED", `${bill.bill_number} is ${String(bill.status).replace(/_/g, " ")}; link it once Finance has posted it.`);
  const net = toPaise(bill.subtotal) - toPaise(bill.discount_total ?? 0) + toPaise(bill.charge_total ?? 0);
  const used = toPaise((await client.query(`SELECT COALESCE(sum(amount), 0)::text AS t FROM tenant.asset_disposal_cost_links WHERE source_id = $1 AND status = 'ACTIVE'`, [bill.id])).rows[0].t);
  const amount = input.amount !== undefined && input.amount !== null && input.amount !== "" ? toPaise(String(input.amount)) : net - used;
  if (amount <= 0n || used + amount > net) throw glError(409, "DISPOSAL_COSTS_UNRECONCILED", `${bill.bill_number} has ${fromPaise(net - used)} not yet allocated; a cost is never counted twice.`);
  const treatment = String(input.treatment ?? "NET_PROCEEDS").toUpperCase();
  if (!["NET_PROCEEDS", "SEPARATE_EXPENSE"].includes(treatment)) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Choose how the cost is treated.");
  const r = (await client.query(`INSERT INTO tenant.asset_disposal_cost_links (organization_id, case_id, line_id, source_id, source_number, amount, treatment, linked_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (line_id, source_id) WHERE status = 'ACTIVE' DO NOTHING RETURNING id`, [c.organizationId, k.id, l.id, bill.id, bill.bill_number, fromPaise(amount), treatment, c.userId])).rows[0];
  if (!r) throw glError(409, "DISPOSAL_COSTS_UNRECONCILED", `${bill.bill_number} is already linked to this asset.`);
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'WITHDRAWN', result = 'Disposal costs changed' WHERE line_id = $1 AND status = 'PREPARED'`, [l.id]);
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "DISPOSAL_COST_LINKED", { bill: bill.bill_number, amount: fromPaise(amount), treatment });
  return { caseId: k.id, lineId: l.id, linkId: r.id, amount: fromPaise(amount), treatment };
}
export async function unlinkDisposalCost(client, c, linkId, input = {}) {
  if (!has(c, DX.financeReview) && !has(c, DX.create)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Give the reason.", { field: "reason" });
  const x = (await client.query(`SELECT * FROM tenant.asset_disposal_cost_links WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`, [c.organizationId, uuid(linkId, "Cost")])).rows[0];
  if (!x) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  if ((await client.query(`SELECT 1 FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('POSTING', 'POSTED', 'RECOVERY_REQUIRED')`, [x.line_id])).rows[0]) throw glError(409, "DISPOSAL_GL_ALREADY_POSTED");
  await client.query(`UPDATE tenant.asset_disposal_cost_links SET status = 'UNLINKED', unlinked_by = $2, unlinked_at = clock_timestamp(), unlink_reason = $3 WHERE id = $1`, [x.id, c.userId, reason]);
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'WITHDRAWN', result = 'Disposal costs changed' WHERE line_id = $1 AND status = 'PREPARED'`, [x.line_id]);
  await event(client, c, { caseId: x.case_id, lineId: x.line_id }, "DISPOSAL_COST_UNLINKED", { bill: x.source_number }, reason);
  return { linkId: x.id, status: "UNLINKED" };
}
// input: { lineId, reference, expectedAmount? } — an insurance claim beside the disposal: kept for Finance, never deducted from the disposal loss.
export async function recordDisposalInsuranceClaim(client, c, caseId, input = {}) {
  if (!has(c, DX.financeReview)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = await lineOf(client, k, input.lineId);
  const ref = text(input.reference, 200);
  if (ref.length < 2) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Enter the claim reference.", { field: "reference" });
  const expected = input.expectedAmount !== undefined && input.expectedAmount !== "" ? fromPaise(toPaise(String(input.expectedAmount))) : null;
  await client.query(`UPDATE tenant.asset_disposal_lines SET insurance_claim_reference = $2, insurance_expected_amount = $3 WHERE id = $1`, [l.id, ref, expected]);
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "INSURANCE_CLAIM_RECORDED", { reference: ref, expected });
  return { caseId: k.id, lineId: l.id, reference: ref, note: "Recorded for Finance; it does not change the disposal result." };
}

// ------------------------------------------------------------------ after posting: a Credit Note adjusts, never edits
// input: { lineId, creditNote (number or id), amount (credited for this asset, before GST), reason } — Finance reverses the original disposal journal and posts
// the adjusted result; both snapshots stay. Needs Finance's posting right.
export async function adjustDisposalResult(client, c, caseId, input = {}) {
  if (!has(c, DX.correct) || !has(c, FINANCE_POST)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED", "A posted result is adjusted by Finance (correction and journal-posting rights).");
  const k = await loadCase(client, c, caseId);
  const l = await lineOf(client, k, input.lineId);
  const reason = text(input.reason, 1000);
  if (reason.length < 5) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Explain the adjustment.", { field: "reason" });
  const intent = (await client.query(`SELECT * FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status = 'POSTED' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [l.id])).rows[0];
  if (!intent || l.line_status !== "COMPLETED") throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a posted, completed disposal is adjusted.");
  if (!l.sale_invoice_id) throw dxError(409, "ASSET_DISPOSAL_INVALID", "Only a sale's consideration is adjusted by a Credit Note.");
  const note = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND (invoice_number = $2 OR id::text = $2) AND invoice_type = 'credit_note' AND source_invoice_id = $3
      AND status = ANY($4::text[])`, [c.organizationId, text(input.creditNote, 100), l.sale_invoice_id, LIVE_BILL])).rows[0];
  if (!note) throw glError(409, "DISPOSAL_PROCEEDS_UNCONFIRMED", "Name the Credit Note Sales posted against this sale's invoice.");
  const noteNet = toPaise(note.subtotal) - toPaise(note.discount_total ?? 0) + toPaise(note.charge_total ?? 0);
  const usedBefore = (await client.query(`SELECT COALESCE(sum((details->>'credited')::numeric), 0)::text AS t FROM tenant.asset_disposal_events WHERE action = 'RESULT_ADJUSTED' AND details->>'creditNoteId' = $1`, [note.id])).rows[0].t;
  const credited = toPaise(String(input.amount ?? ""));
  const original = (await client.query(`SELECT * FROM tenant.asset_disposal_financial_snapshots WHERE id = $1`, [intent.snapshot_id])).rows[0];
  if (credited <= 0n || credited > toPaise(original.net_proceeds) + toPaise(original.disposal_costs) || credited + toPaise(usedBefore) > noteNet) {
    throw glError(409, "DISPOSAL_PROCEEDS_UNCONFIRMED", `The credit for this asset must be above zero, within its proceeds and within what ${note.invoice_number} has not already adjusted.`);
  }
  const { reverseAssetJournal, postAssetJournal } = await import("../accounting-bridge.js");
  const rev = await reverseAssetJournal(client, c, intent.journal_entry_id, `Disposal ${k.case_number} adjusted by ${note.invoice_number}: ${reason}`);
  const reversalId = rev?.entry?.id ?? rev?.id ?? null;
  await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'REVERSED', reversal_journal_entry_id = $2, result = $3 WHERE id = $1`, [intent.id, reversalId, `Adjusted by ${note.invoice_number}`]);
  const proceeds = toPaise(original.net_proceeds) - credited;
  const carrying = toPaise(original.carrying_amount);
  const gain = proceeds - carrying + toPaise(original.other_adjustments ?? 0);
  const p = { effective: dayOfDb(original.effective_date), cost: String(original.capitalized_cost), accumulated: String(original.accumulated_depreciation), impairment: String(original.impairment), carrying: String(original.carrying_amount),
    proceeds: fromPaise(proceeds), costs: String(original.disposal_costs), gainLoss: fromPaise(gain), grossConsideration: original.gross_consideration !== null ? fromPaise(toPaise(original.gross_consideration) - credited) : fromPaise(proceeds),
    tax: original.consideration_tax, currency: original.consideration_currency, rate: original.exchange_rate, otherAdjustments: String(original.other_adjustments ?? 0), separateCosts: String(original.separate_costs ?? 0),
    basisSource: original.basis_source, accounts: { asset: original.asset_account_id, accumulated: original.accumulated_account_id, proceeds: original.proceeds_account_id, gainLoss: original.gain_loss_account_id, loss: original.loss_account_id },
    basis: `${original.basis_hash}:adj:${note.id}` };
  const snap = await insertSnapshot(client, c, l, p, "ADJUSTMENT", { supersedes: original.id, reason });
  const lines = journalLinesOf(p, l, k);
  assertBalanced(lines);
  const a = (await client.query(`SELECT asset_number FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
  const posted = await postAssetJournal(client, c, { date: new Date().toISOString().slice(0, 10), reference: `${k.case_number}-ADJ`, description: `Disposal ${k.case_number} of ${a.asset_number}, adjusted by ${note.invoice_number}`,
    sourceType: "asset_disposal_adjustment", sourceId: snap.id, sourceNumber: `${k.case_number}/${l.line_number}`, lines });
  if (posted.status !== "posted") throw glError(409, "DISPOSAL_ACCOUNT_MAPPING_MISSING");
  await client.query(`INSERT INTO tenant.asset_disposal_accounting_intents (organization_id, line_id, asset_id, snapshot_id, command_id, basis_hash, posting_date, status, journal_entry_id, result, prepared_by, posted_by, kind, adjusts_intent_id)
      VALUES ($1,$2,$3,$4,$5,$6,current_date,'POSTED',$7,'ADJUSTED',$8,$8,'ADJUSTMENT',$9)`, [c.organizationId, l.id, l.asset_id, snap.id, `adjust:${l.id}:${note.id}:${snap.id}`, p.basis, posted.journalEntryId, c.userId, intent.id]);
  await client.query(`UPDATE tenant.asset_disposal_proceeds_allocations SET status = 'SUPERSEDED', superseded_at = clock_timestamp() WHERE line_id = $1 AND status = 'ACTIVE'`, [l.id]);
  await client.query(`INSERT INTO tenant.asset_disposal_proceeds_allocations (organization_id, case_id, line_id, invoice_id, amount, basis, allocated_by) VALUES ($1,$2,$3,$4,$5,'MANUAL',$6)`,
    [c.organizationId, k.id, l.id, l.sale_invoice_id, fromPaise(toPaise(l.sale_proceeds ?? original.net_proceeds) - credited), c.userId]);
  await client.query(`UPDATE tenant.asset_disposal_lines SET sale_proceeds = $2 WHERE id = $1`, [l.id, fromPaise(toPaise(l.sale_proceeds ?? original.net_proceeds) - credited)]);
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "RESULT_ADJUSTED", { creditNoteId: note.id, creditNote: note.invoice_number, credited: fromPaise(credited), from: String(original.gain_loss), to: fromPaise(gain),
    reversalJournalEntryId: reversalId, journalEntryId: posted.journalEntryId }, reason);
  return { caseId: k.id, lineId: l.id, from: fromPaise(toPaise(original.gain_loss)), to: fromPaise(gain), outcome: outcomeOf(fromPaise(gain)), reversalJournalEntryId: reversalId, journalEntryId: posted.journalEntryId };
}

// ------------------------------------------------------------------ the journal and its reconciliation
// The derecognition journal of a picture: credit the cost, debit accumulated depreciation and impairment, debit the proceeds clearing account (net of
// costs), and the gain (credit) or loss (debit) on its own account.
export function journalLinesOf(p, l, k) {
  const cost = toPaise(p.cost); const acc = toPaise(p.accumulated) + toPaise(p.impairment); const net = toPaise(p.proceeds) - toPaise(p.costs); const gain = toPaise(p.gainLoss);
  const tag = l.asset_number ?? "";
  const lines = [{ accountId: p.accounts.asset, creditCents: cost, description: `Derecognize ${tag} (cost)` }];
  if (acc > 0n) lines.push({ accountId: p.accounts.accumulated, debitCents: acc, description: `Clear accumulated depreciation of ${tag}` });
  if (net > 0n) lines.push({ accountId: p.accounts.proceeds, debitCents: net, description: `Disposal proceeds of ${tag}${l.sale_invoice_number ? ` (${l.sale_invoice_number})` : ""}, net of costs` });
  if (net < 0n) lines.push({ accountId: p.accounts.proceeds, creditCents: -net, description: `Disposal costs of ${tag}` });
  if (gain > 0n) lines.push({ accountId: p.accounts.gainLoss, creditCents: gain, description: `Gain on disposal of ${tag}` });
  if (gain < 0n) lines.push({ accountId: p.accounts.loss ?? p.accounts.gainLoss, debitCents: -gain, description: `Loss on disposal of ${tag}` });
  void k;
  return lines;
}
export function assertBalanced(lines) {
  const dr = lines.reduce((t, x) => t + (x.debitCents ?? 0n), 0n); const cr = lines.reduce((t, x) => t + (x.creditCents ?? 0n), 0n);
  if (dr !== cr) throw glError(409, "DISPOSAL_JOURNAL_UNBALANCED", `Debits ${fromPaise(dr)} and credits ${fromPaise(cr)} do not balance.`);
}
// Does Finance's posted journal carry exactly the snapshot's figures, account by account?
export const pictureOfSnapshot = (snap) => ({ cost: String(snap.capitalized_cost), accumulated: String(snap.accumulated_depreciation), impairment: String(snap.impairment), proceeds: String(snap.net_proceeds),
  costs: String(snap.disposal_costs), gainLoss: String(snap.gain_loss), accounts: { asset: snap.asset_account_id, accumulated: snap.accumulated_account_id, proceeds: snap.proceeds_account_id, gainLoss: snap.gain_loss_account_id, loss: snap.loss_account_id } });
export async function journalAgrees(client, intent) {
  if (!intent?.journal_entry_id) return null;
  const snap = (await client.query(`SELECT * FROM tenant.asset_disposal_financial_snapshots WHERE id = $1`, [intent.snapshot_id])).rows[0];
  if (!snap) return null;
  const expected = new Map();
  for (const x of journalLinesOf(pictureOfSnapshot(snap), {}, null)) expected.set(x.accountId, (expected.get(x.accountId) ?? 0n) + (x.debitCents ?? 0n) - (x.creditCents ?? 0n));
  const actual = new Map((await client.query(`SELECT account_id, sum(debit_amount - credit_amount)::text AS net FROM tenant.accounting_journal_lines WHERE journal_entry_id = $1 GROUP BY account_id`, [intent.journal_entry_id])).rows
    .map((r) => [r.account_id, toPaise(r.net)]));
  return [...new Set([...expected.keys(), ...actual.keys()])].every((acct) => (expected.get(acct) ?? 0n) === (actual.get(acct) ?? 0n));
}
export function financialStateOf(l, intent, latest, picture, agrees = null) {
  if (intent?.kind === "ADJUSTMENT" && intent.status === "POSTED") return "ADJUSTED";
  if (intent?.status === "POSTED" || intent?.status === "NOT_REQUIRED") return intent.status === "NOT_REQUIRED" ? "RECONCILED" : agrees === false ? "POSTED" : agrees ? "RECONCILED" : "POSTED";
  if (intent && ["POSTING"].includes(intent.status)) return "POSTING";
  if (intent?.status === "RECOVERY_REQUIRED" || l.line_status === "RECOVERY_REQUIRED") return "RECOVERY_REQUIRED";
  if (intent?.status === "PREPARED") return picture && picture.basis !== intent.basis_hash ? "REVIEW_REQUIRED" : "APPROVED";
  if (!picture) return "NOT_READY";
  const blocking = picture.issues.filter((x) => !["ASSET_SALE_TAX_REVIEW_REQUIRED"].includes(x.code));
  if (blocking.length) return "NOT_READY";
  if (picture.issues.length || picture.costsEstimated) return "REVIEW_REQUIRED";
  return latest ? "PREVIEW_READY" : "PREVIEW_READY";
}

// ------------------------------------------------------------------ reports
export const GAIN_LOSS_REPORTS = Object.freeze(["asset-gain-loss", "monthly-gain-loss", "annual-gain-loss", "gains-by-category", "losses-by-category", "scrap-write-off-losses", "fully-depreciated-sales",
  "gain-loss-by-location", "gain-loss-by-department", "pending-financial-results", "adjusted-results", "disposal-gl-reconciliation"]);
const fyOf = (day) => { if (!day) return "—"; const y = Number(day.slice(0, 4)); const m = Number(day.slice(5, 7)); const start = m >= 4 ? y : y - 1; return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`; };
// filters: { book?, period? (YYYY-MM or FY 2026-27), category?, method?, asset?, result? (GAIN | LOSS | ZERO), status? (RECOGNIZED | ESTIMATED), location?, department? }
export async function getGainLossRows(client, c, filters = {}) {
  if (!seesDisposals(c) || !has(c, DX.financials)) throw glError(403, "DISPOSAL_FINANCIAL_ACCESS_DENIED");
  if (filters.book && String(filters.book) !== BOOK) throw glError(409, "DISPOSAL_BOOK_COMPANY_MISMATCH");
  const rows = (await client.query(`SELECT l.id, l.line_status, l.case_id, k.case_number, k.disposal_type, a.asset_number, a.name AS asset_name, a.id AS asset_id, a.residual_value, cat.name AS category, loc.name AS location, dep.name AS department,
      s.kind, s.version, s.effective_date, s.carrying_amount, s.net_proceeds, s.disposal_costs, s.gain_loss, s.capitalized_cost, s.accumulated_depreciation, s.consideration_tax, s.basis_source,
      i.status AS posting, i.kind AS posting_kind, je.entry_number,
      EXISTS (SELECT 1 FROM tenant.asset_disposal_accounting_intents r WHERE r.line_id = l.id AND r.status = 'REVERSED') AS reversed
    FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id JOIN tenant.assets a ON a.id = l.asset_id
      LEFT JOIN tenant.asset_categories cat ON cat.id = a.category_id LEFT JOIN tenant.asset_locations loc ON loc.id = l.location_snapshot_id
      LEFT JOIN tenant.asset_custody_assignments ks ON ks.id = l.custody_snapshot_id LEFT JOIN public.departments dep ON dep.id = ks.department_id
      LEFT JOIN LATERAL (SELECT * FROM tenant.asset_disposal_financial_snapshots x WHERE x.line_id = l.id ORDER BY (x.kind = 'PREVIEW'), x.version DESC LIMIT 1) s ON true
      LEFT JOIN LATERAL (SELECT * FROM tenant.asset_disposal_accounting_intents y WHERE y.line_id = l.id AND y.status IN ('PREPARED', 'POSTING', 'POSTED', 'RECOVERY_REQUIRED') ORDER BY y.created_at DESC LIMIT 1) i ON true
      LEFT JOIN tenant.accounting_journal_entries je ON je.id = i.journal_entry_id
    WHERE l.organization_id = $1 AND l.line_status NOT IN ('CANCELLED', 'REJECTED', 'DRAFT') AND s.id IS NOT NULL ORDER BY s.effective_date DESC NULLS LAST, k.case_number`, [c.organizationId])).rows;
  const out = rows.map((r) => {
    const recognized = r.posting === "POSTED";
    const day = dayOfDb(r.effective_date);
    return { case: r.case_number, asset: `${r.asset_number} · ${r.asset_name}`, method: TYPE_LABEL[r.disposal_type], type: r.disposal_type, category: r.category ?? "—", location: r.location ?? "—", department: r.department ?? "—",
      date: day, month: day ? day.slice(0, 7) : "—", financialYear: fyOf(day), cost: fromPaise(toPaise(r.capitalized_cost)), accumulated: fromPaise(toPaise(r.accumulated_depreciation)), carrying: fromPaise(toPaise(r.carrying_amount)),
      proceeds: fromPaise(toPaise(r.net_proceeds)), costs: fromPaise(toPaise(r.disposal_costs)), gainLoss: fromPaise(toPaise(r.gain_loss)), result: outcomeOf(r.gain_loss),
      status: recognized ? "RECOGNIZED" : "ESTIMATED", statusLabel: recognized ? (r.posting_kind === "ADJUSTMENT" ? "Recognized (adjusted)" : "Recognized") : "Estimated — not posted", journal: r.entry_number ?? null,
      adjusted: r.posting_kind === "ADJUSTMENT" || r.reversed, fullyDepreciated: toPaise(r.carrying_amount) <= toPaise(r.residual_value ?? 0) && toPaise(r.accumulated_depreciation) > 0n,
      opening: r.basis_source === "OPENING" || r.basis_source === "MIGRATED", href: `/assets/disposals/${r.case_id}` };
  });
  const f = filters;
  return out.filter((r) => (!f.period || r.month === f.period || r.financialYear === f.period) && (!f.category || r.category === f.category) && (!f.method || r.type === String(f.method).toUpperCase())
    && (!f.asset || r.asset.toUpperCase().includes(String(f.asset).toUpperCase())) && (!f.result || r.result === String(f.result).toUpperCase()) && (!f.status || r.status === String(f.status).toUpperCase())
    && (!f.location || r.location === f.location) && (!f.department || r.department === f.department));
}
export async function getGainLossReport(client, c, kind, filters = {}) {
  if (!GAIN_LOSS_REPORTS.includes(kind)) throw dxError(400, "ASSET_DISPOSAL_INVALID", "Unknown report.");
  const rows = await getGainLossRows(client, c, filters);
  const total = (list, key) => fromPaise(list.reduce((t, r) => t + toPaise(r[key]), 0n));
  const group = (list, key) => [...list.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), r]), new Map()).entries()];
  // Totals of recognized results only; estimates are shown, never added into recognized figures.
  const sums = (list) => { const rec = list.filter((r) => r.status === "RECOGNIZED"); return { assets: list.length, recognizedGains: total(rec.filter((r) => r.result === "GAIN"), "gainLoss"),
    recognizedLosses: total(rec.filter((r) => r.result === "LOSS"), "gainLoss"), recognizedNet: total(rec, "gainLoss"), estimatedNet: total(list.filter((r) => r.status === "ESTIMATED"), "gainLoss") }; };
  const asset = (r) => ({ case: r.case, asset: r.asset, method: r.method, date: r.date, carrying: r.carrying, proceeds: r.proceeds, costs: r.costs, gainLoss: r.gainLoss, result: r.result, status: r.statusLabel, journal: r.journal ?? "—", href: r.href });
  switch (kind) {
    case "asset-gain-loss": return rows.map(asset);
    case "monthly-gain-loss": return group(rows, "month").sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([month, list]) => ({ month, ...sums(list) }));
    case "annual-gain-loss": return group(rows, "financialYear").sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([financialYear, list]) => ({ financialYear, ...sums(list) }));
    case "gains-by-category": return group(rows.filter((r) => r.result === "GAIN"), "category").map(([category, list]) => ({ category, ...sums(list) }));
    case "losses-by-category": return group(rows.filter((r) => r.result === "LOSS"), "category").map(([category, list]) => ({ category, ...sums(list) }));
    case "scrap-write-off-losses": return rows.filter((r) => ["SCRAP", "WRITE_OFF_DAMAGED", "WRITE_OFF_LOST"].includes(r.type) && r.result === "LOSS").map(asset);
    case "fully-depreciated-sales": return rows.filter((r) => r.type === "SALE" && r.fullyDepreciated).map(asset);
    case "gain-loss-by-location": return group(rows, "location").map(([location, list]) => ({ location, ...sums(list) }));
    case "gain-loss-by-department": return group(rows, "department").map(([department, list]) => ({ department, ...sums(list) }));
    case "pending-financial-results": return rows.filter((r) => r.status === "ESTIMATED").map(asset);
    case "adjusted-results": return rows.filter((r) => r.adjusted).map(asset);
    case "disposal-gl-reconciliation": {
      const out = [];
      for (const r of rows.filter((x) => x.status === "RECOGNIZED")) {
        const intent = (await client.query(`SELECT i.* FROM tenant.asset_disposal_accounting_intents i JOIN tenant.asset_disposal_lines l ON l.id = i.line_id JOIN tenant.asset_disposal_cases k ON k.id = l.case_id
            WHERE k.case_number = $1 AND i.status = 'POSTED' AND l.organization_id = $2 ORDER BY i.created_at DESC`, [r.case, c.organizationId])).rows.find(() => true);
        out.push({ ...asset(r), agreesWithGL: (await journalAgrees(client, intent)) === false ? "No" : "Yes" });
      }
      return out;
    }
    default: return [];
  }
}
