// Assets — Asset Sale / Scrap: the execution of an approved SALE or SCRAP disposal, inside the same case and lines — the buyer, agreed price and
// currency (revised only by an authorized person), the scrap method, recycler and evidence, dispatch through a carrier, the disposal-linked
// Sales Invoice (generated once, through Sales), the proceeds of each asset allocated from it deterministically, and the execution queue.
// Nothing here posts a journal or marks an asset disposed: completion stays the Disposal workflow's, after Finance's derecognition.
import { has, text, uuid } from "../common.js";
import { EXECUTING, dxError, fromPaise, toPaise } from "./dx-rules.js";

export const SX = Object.freeze({ sale: "assets.disposal.manage_sale", scrap: "assets.disposal.manage_scrap", evidence: "assets.disposal.record_evidence" });
export const RECEIVABLES = "accounting.receivables.manage";
export const SCRAP_METHODS = Object.freeze({ RECYCLER_COLLECTION: "Recycler collection", SUPERVISED_DESTRUCTION: "Supervised destruction", SCRAP_DEALER_SALE: "Sold to a scrap dealer" });
export const MILESTONES = Object.freeze({ NOT_STARTED: "Not started", SALE_DOCUMENT_PENDING: "Sales document pending", READY_FOR_HANDOVER: "Ready for handover", IN_TRANSIT: "In transit",
  PHYSICAL_EXIT_CONFIRMED: "Physical exit confirmed", FINANCE_PENDING: "Finance pending", COMPLETED: "Completed", EXCEPTION: "Exception" });
export const LIVE_INVOICE = ["posted", "partially_paid", "paid", "overdue", "disputed"];
const SALE_CODES = Object.freeze({
  ASSET_SALE_DISPOSAL_NOT_APPROVED: "Approve the disposal before selling this asset.", ASSET_SALE_BUYER_INVALID: "Select a valid buyer.", ASSET_SALE_PRICE_INVALID: "Review the agreed selling price.",
  ASSET_SALE_INVOICE_REQUIRED: "Create or link the required Sales Invoice.", ASSET_SALE_INVOICE_DUPLICATE: "This asset is already linked to a sale invoice.",
  ASSET_SALE_TAX_REVIEW_REQUIRED: "Finance must review the tax treatment.", ASSET_SALE_HANDOVER_PENDING: "Confirm the physical handover.", ASSET_SCRAP_EVIDENCE_REQUIRED: "Add the required scrap/destruction evidence.",
  ASSET_SCRAP_RECYCLER_INVALID: "Select an eligible recycler or record the approved disposal method.", ASSET_DISPOSAL_PROCEEDS_MISMATCH: "The asset proceeds do not reconcile to the sales document.",
});
export const SALE_MESSAGES = SALE_CODES;
const sxError = (status, code, message, details) => dxError(status, code, message ?? SALE_CODES[code], details);
const today = () => new Date().toISOString().slice(0, 10);

async function loadCase(client, c, caseId) {
  let id;
  try { id = uuid(caseId, "Disposal"); } catch { throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND"); }
  const k = (await client.query(`SELECT * FROM tenant.asset_disposal_cases WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!k) throw dxError(404, "ASSET_DISPOSAL_NOT_FOUND");
  return k;
}
const linesOf = async (client, caseId) => (await client.query(`SELECT l.*, a.asset_number, a.name AS asset_name, a.serial_number, a.category_id, a.capitalization_class FROM tenant.asset_disposal_lines l
    JOIN tenant.assets a ON a.id = l.asset_id WHERE l.case_id = $1 ORDER BY l.line_number FOR UPDATE OF l`, [caseId])).rows;
const executing = (lines) => lines.filter((l) => EXECUTING.includes(l.line_status) && l.line_status !== "POSTING");
async function event(client, c, refs, action, details = {}, reason = null, commandId = null) {
  await client.query(`INSERT INTO tenant.asset_disposal_events (organization_id, case_id, line_id, asset_id, action, details, reason, actor_user_id, command_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [c.organizationId, refs.caseId, refs.lineId ?? null, refs.assetId ?? null, action, JSON.stringify(details), reason, c.userId ?? null, commandId]);
}
const replayed = async (client, c, commandId) => commandId && (await client.query(`SELECT details FROM tenant.asset_disposal_events WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, commandId])).rows[0];
const posted = async (client, lineId) => (await client.query(`SELECT 1 FROM tenant.asset_disposal_accounting_intents WHERE line_id = $1 AND status IN ('POSTING', 'POSTED', 'RECOVERY_REQUIRED')`, [lineId])).rows[0] !== undefined;
function approvedOf(k, lines) {
  if (!["SALE", "SCRAP"].includes(k.disposal_type)) throw sxError(409, "ASSET_DISPOSAL_INVALID", "Only a sale or a scrap disposal is executed here.");
  const live = executing(lines);
  if (!live.length) throw sxError(409, lines.some((l) => ["DRAFT", "PENDING_APPROVAL"].includes(l.line_status)) ? "ASSET_SALE_DISPOSAL_NOT_APPROVED" : "ASSET_DISPOSAL_ALREADY_COMPLETED");
  return live;
}
const priceOf = (l) => (l.agreed_price !== null && l.agreed_price !== undefined ? toPaise(l.agreed_price) : toPaise(l.proposed_proceeds ?? 0));
async function customer(client, c, partyId) {
  let id;
  try { id = uuid(partyId, "Buyer"); } catch { throw sxError(400, "ASSET_SALE_BUYER_INVALID"); }
  const p = (await client.query(`SELECT id, party_type FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!p || !["customer", "both"].includes(p.party_type)) throw sxError(400, "ASSET_SALE_BUYER_INVALID", "Choose a customer of this Company as the buyer.");
  return id;
}
async function setPrices(client, c, k, live, entries, { revisionReason }) {
  for (const e of entries) {
    const l = live.find((x) => x.id === e.lineId);
    if (!l) throw sxError(400, "ASSET_DISPOSAL_INVALID", "That asset is not pending in this disposal.");
    const price = toPaise(String(e.agreedPrice ?? ""));
    if (price < 0n) throw sxError(400, "ASSET_SALE_PRICE_INVALID");
    if (await posted(client, l.id)) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED");
    if (l.sale_invoice_id) throw sxError(409, "ASSET_SALE_INVOICE_DUPLICATE", "The price of an invoiced asset changes through Sales (a credit note or a new invoice), not here.");
    const was = l.agreed_price;
    // A revision of an agreed price is an authorized decision: an approver other than the requester, with a reason.
    if (was !== null && was !== undefined && toPaise(was) !== price) {
      if (!has(c, "assets.disposal.approve") || c.userId === k.requested_by) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "An approver other than the requester revises an agreed price.");
      if (text(revisionReason, 1000).length < 5) throw sxError(400, "ASSET_SALE_PRICE_INVALID", "Give the reason for the price revision.", { field: "reason" });
      await client.query(`UPDATE tenant.asset_disposal_lines SET agreed_price = $2, price_revised_by = $3, price_revised_at = clock_timestamp(), price_revision_reason = $4, row_version = row_version + 1 WHERE id = $1`,
        [l.id, fromPaise(price), c.userId, text(revisionReason, 1000)]);
      await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "PRICE_REVISED", { from: String(was), to: fromPaise(price) }, text(revisionReason, 1000));
    } else if (was === null || was === undefined) {
      await client.query(`UPDATE tenant.asset_disposal_lines SET agreed_price = $2, row_version = row_version + 1 WHERE id = $1`, [l.id, fromPaise(price)]);
      await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "PRICE_AGREED", { price: fromPaise(price) });
    }
  }
}
const currencyOf = async (client, c, v) => {
  const base = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId]).catch(() => ({ rows: [] }))).rows[0]?.base_currency ?? "INR";
  if (v === undefined || v === null || v === "") return base;
  const code = String(v).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw sxError(400, "ASSET_SALE_PRICE_INVALID", "Choose a valid currency.", { field: "currency" });
  return code;
};
// input: { buyerPartyId?, currency?, lines: [{ lineId, agreedPrice }], reason? } — the sale terms of an approved sale.
export async function configureAssetSale(client, c, caseId, input = {}) {
  if (!has(c, SX.sale)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  if (k.disposal_type !== "SALE") throw sxError(409, "ASSET_DISPOSAL_INVALID", "This is not a sale.");
  const live = approvedOf(k, await linesOf(client, k.id));
  const currency = await currencyOf(client, c, input.currency ?? k.sale_currency);
  if (input.buyerPartyId !== undefined) {
    const buyer = await customer(client, c, input.buyerPartyId);
    if (buyer !== k.buyer_party_id && live.some((l) => l.sale_invoice_id)) throw sxError(409, "ASSET_SALE_INVOICE_DUPLICATE", "The buyer of an invoiced sale changes through Sales.");
    await client.query(`UPDATE tenant.asset_disposal_cases SET buyer_party_id = $2 WHERE id = $1`, [k.id, buyer]);
  }
  if (!k.buyer_party_id && input.buyerPartyId === undefined) throw sxError(400, "ASSET_SALE_BUYER_INVALID");
  await client.query(`UPDATE tenant.asset_disposal_cases SET sale_currency = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [k.id, currency]);
  await client.query(`UPDATE tenant.asset_disposal_lines SET agreed_currency = $2 WHERE case_id = $1`, [k.id, currency]);
  const entries = Array.isArray(input.lines) ? input.lines : [];
  // Every price is checked before anything is written: a sale's price is above zero.
  for (const e of entries) { const p = /^\d+(\.\d+)?$/.test(String(e.agreedPrice ?? "").trim()) ? toPaise(String(e.agreedPrice).trim()) : -1n; if (p <= 0n) throw sxError(400, "ASSET_SALE_PRICE_INVALID", "Agree a selling price above zero."); }
  for (const l of live) { const e = entries.find((x) => x.lineId === l.id); if (!e && priceOf(l) <= 0n) throw sxError(400, "ASSET_SALE_PRICE_INVALID", `Agree a selling price above zero for ${l.asset_number}.`); }
  await setPrices(client, c, k, live, entries, { revisionReason: input.reason });
  return { caseId: k.id, currency };
}
// input: { scrapMethod, recyclerSupplierId?, buyerPartyId? (a scrap dealer), lines?: [{ lineId, agreedPrice }] } — how an approved scrap leaves; scrap value is
// zero unless a dealer pays for it, and evidence is required by method or by the asset's category.
export async function configureAssetScrap(client, c, caseId, input = {}) {
  if (!has(c, SX.scrap)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  if (k.disposal_type !== "SCRAP") throw sxError(409, "ASSET_DISPOSAL_INVALID", "This is not a scrap disposal.");
  const live = approvedOf(k, await linesOf(client, k.id));
  const method = String(input.scrapMethod ?? k.scrap_method ?? "").toUpperCase();
  if (!SCRAP_METHODS[method]) throw sxError(400, "ASSET_SCRAP_RECYCLER_INVALID", "Choose how the asset is scrapped.", { field: "scrapMethod" });
  let recycler = k.recycler_supplier_id;
  if (input.recyclerSupplierId !== undefined) {
    try { recycler = input.recyclerSupplierId ? uuid(input.recyclerSupplierId, "Recycler") : null; } catch { throw sxError(400, "ASSET_SCRAP_RECYCLER_INVALID"); }
    if (recycler && !(await client.query(`SELECT 1 FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, recycler])).rows[0]) throw sxError(400, "ASSET_SCRAP_RECYCLER_INVALID");
  }
  if (method === "RECYCLER_COLLECTION" && !recycler) throw sxError(400, "ASSET_SCRAP_RECYCLER_INVALID", "Name the recycler collecting the asset.", { field: "recyclerSupplierId" });
  let buyer = k.buyer_party_id;
  if (input.buyerPartyId !== undefined) buyer = input.buyerPartyId ? await customer(client, c, input.buyerPartyId) : null;
  if (method === "SCRAP_DEALER_SALE" && !buyer) throw sxError(400, "ASSET_SALE_BUYER_INVALID", "Name the scrap dealer buying it.", { field: "buyerPartyId" });
  await client.query(`UPDATE tenant.asset_disposal_cases SET scrap_method = $2, recycler_supplier_id = $3, buyer_party_id = $4, sale_currency = COALESCE(sale_currency, $5), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
    [k.id, method, recycler, buyer, await currencyOf(client, c, null)]);
  for (const l of live) {
    const flagged = (await client.query(`SELECT scrap_evidence_required FROM tenant.asset_categories WHERE id = $1`, [l.category_id])).rows[0]?.scrap_evidence_required === true;
    await client.query(`UPDATE tenant.asset_disposal_lines SET scrap_method = $2, certificate_required = $3, row_version = row_version + 1 WHERE id = $1`, [l.id, method, flagged || method === "RECYCLER_COLLECTION"]);
  }
  if (method === "SCRAP_DEALER_SALE") await setPrices(client, c, k, live, Array.isArray(input.lines) ? input.lines : [], { revisionReason: input.reason });
  await event(client, c, { caseId: k.id }, "SCRAP_CONFIGURED", { method, recycler, buyer });
  return { caseId: k.id, scrapMethod: method };
}
// input: { lineId, certificateNumber?, issuer?, certificateDate?, references? } — the recycler's certificate or the destruction record (it never certifies legal compliance).
export async function recordScrapEvidence(client, c, caseId, input = {}) {
  if (!has(c, SX.evidence)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  if (!["SCRAP", "WRITE_OFF_DAMAGED"].includes(k.disposal_type)) throw sxError(409, "ASSET_DISPOSAL_INVALID", "Scrap evidence belongs to a scrap or destruction.");
  const l = (await linesOf(client, k.id)).find((x) => x.id === input.lineId);
  if (!l || !EXECUTING.includes(l.line_status)) throw sxError(409, "ASSET_DISPOSAL_INVALID", "Record evidence for an asset being scrapped.");
  const number = text(input.certificateNumber, 200); const refs = text(input.references, 2000);
  if (!number && !refs) throw sxError(400, "ASSET_SCRAP_EVIDENCE_REQUIRED", "Enter the certificate number or the evidence references.");
  const date = input.certificateDate ? String(input.certificateDate).slice(0, 10) : null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today())) throw sxError(400, "ASSET_SCRAP_EVIDENCE_REQUIRED", "Enter a valid certificate date.");
  await client.query(`UPDATE tenant.asset_disposal_lines SET certificate_number = $2, certificate_issuer = $3, certificate_date = $4, evidence_references = $5, evidence_recorded_by = $6, evidence_recorded_at = clock_timestamp(),
      row_version = row_version + 1 WHERE id = $1`, [l.id, number || null, text(input.issuer, 200) || null, date, refs || null, c.userId]);
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "SCRAP_EVIDENCE_RECORDED", { certificate: number || null, issuer: text(input.issuer, 200) || null });
  return { caseId: k.id, lineId: l.id };
}
// input: { lineId, identifier, carrier, reference?, condition? } — the asset left with a carrier; it is in transit until the buyer's receipt is confirmed.
export async function dispatchDisposalAsset(client, c, caseId, input = {}) {
  if (!has(c, "assets.disposal.confirm_handover")) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  const l = (await linesOf(client, k.id)).find((x) => x.id === input.lineId);
  if (!l) throw sxError(400, "ASSET_DISPOSAL_INVALID", "Choose the asset in this case.");
  if (l.line_status !== "PENDING_HANDOVER") throw sxError(409, ["DRAFT", "PENDING_APPROVAL"].includes(l.line_status) ? "ASSET_SALE_DISPOSAL_NOT_APPROVED" : "ASSET_DISPOSAL_INVALID", ["DRAFT", "PENDING_APPROVAL"].includes(l.line_status) ? undefined : "This asset has already left.");
  if (l.dispatched_at) return { caseId: k.id, lineId: l.id, replayed: true };
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
  const { identifies } = await import("../asset-transfers/tr-commands.js");
  if (!text(input.identifier, 200) || !(await identifies(client, c, a, text(input.identifier, 200)))) throw dxError(409, "ASSET_DISPOSAL_HANDOVER_REQUIRED", `Scan or type ${a.asset_number}'s code, serial or tag as it leaves.`);
  const holder = (await client.query(`SELECT custodian_type FROM tenant.asset_custody_assignments WHERE asset_id = $1 AND status = 'ACTIVE'`, [a.id])).rows[0];
  if (holder && ["EMPLOYEE", "DEPARTMENT"].includes(holder.custodian_type) && !l.custody_exception_reason) throw dxError(409, "ASSET_DISPOSAL_CUSTODY_UNRESOLVED");
  if (k.disposal_type === "SALE" && !k.buyer_party_id) throw sxError(409, "ASSET_SALE_BUYER_INVALID");
  const carrier = text(input.carrier, 200);
  if (carrier.length < 2) throw sxError(400, "ASSET_DISPOSAL_INVALID", "Name the carrier.", { field: "carrier" });
  await client.query(`UPDATE tenant.asset_disposal_lines SET dispatched_at = clock_timestamp(), dispatched_by = $2, carrier = $3, dispatch_reference = $4, condition_at_disposal = COALESCE($5, condition_at_disposal), row_version = row_version + 1 WHERE id = $1`,
    [l.id, c.userId, carrier, text(input.reference, 200) || null, input.condition ? String(input.condition).toUpperCase() : null]);
  await event(client, c, { caseId: k.id, lineId: l.id, assetId: l.asset_id }, "DISPATCHED", { carrier, reference: text(input.reference, 200) || null });
  return { caseId: k.id, lineId: l.id, milestone: "IN_TRANSIT" };
}

// ------------------------------------------------------------------ the Sales Invoice and the proceeds of each asset
const invoiceNet = (i) => toPaise(i.subtotal) - toPaise(i.discount_total ?? 0) + toPaise(i.charge_total ?? 0);
// Shares of `total` in proportion to `weights` (integers, paise), rounded down, the remainder handed out one paisa at a time by the largest
// fraction then by line order — the same inputs always give the same allocation.
export function proportional(total, weights) {
  const sum = weights.reduce((t, w) => t + w, 0n);
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0n));
  const base = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - base.reduce((t, b) => t + b, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const x of remainders) { if (left <= 0n) break; base[x.i] += 1n; left -= 1n; }
  return base;
}
async function writeAllocations(client, c, k, entries, invoice, basis) {
  for (const e of entries) {
    await client.query(`UPDATE tenant.asset_disposal_proceeds_allocations SET status = 'SUPERSEDED', superseded_at = clock_timestamp() WHERE line_id = $1 AND status = 'ACTIVE'`, [e.line.id]);
    await client.query(`INSERT INTO tenant.asset_disposal_proceeds_allocations (organization_id, case_id, line_id, invoice_id, invoice_line_id, amount, basis, allocated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.organizationId, k.id, e.line.id, invoice.id, e.invoiceLineId ?? null, fromPaise(e.amount), basis, c.userId ?? null]);
    await client.query(`UPDATE tenant.asset_disposal_lines SET sale_invoice_id = $2, sale_invoice_number = $3, sale_proceeds = $4, sale_invoice_line_id = $5, row_version = row_version + 1 WHERE id = $1`,
      [e.line.id, invoice.id, invoice.invoice_number, fromPaise(e.amount), e.invoiceLineId ?? null]);
    await client.query(`UPDATE tenant.asset_disposal_accounting_intents SET status = 'WITHDRAWN', result = 'Proceeds reallocated' WHERE line_id = $1 AND status = 'PREPARED'`, [e.line.id]);
  }
  await event(client, c, { caseId: k.id }, "PROCEEDS_ALLOCATED", { invoice: invoice.invoice_number, basis, lines: entries.map((e) => [e.line.asset_number, fromPaise(e.amount)]) });
}
// input: { invoice (number or id), basis: AGREED_PRICE | EQUAL | MANUAL, lines?: [{ lineId, amount }] (MANUAL), lineIds? } — the invoice's net amount (before GST) shared among the
// case's assets: the allocations add up to it exactly; no asset holds two allocations; an asset already posted keeps its own.
export async function allocateAssetSaleProceeds(client, c, caseId, input = {}) {
  if (!has(c, SX.sale) && !has(c, SX.scrap)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const k = await loadCase(client, c, caseId);
  const all = await linesOf(client, k.id);
  const live = approvedOf(k, all);
  const inv = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND (invoice_number = $2 OR id::text = $2)`, [c.organizationId, text(input.invoice, 100)])).rows[0];
  if (!inv || inv.invoice_type !== "invoice") throw sxError(400, "ASSET_SALE_INVOICE_REQUIRED", "No such Sales Invoice.");
  if (["cancelled", "reversed"].includes(String(inv.status))) throw sxError(409, "ASSET_SALE_INVOICE_REQUIRED", `${inv.invoice_number} is ${inv.status}.`);
  if (k.buyer_party_id && inv.party_id !== k.buyer_party_id) throw dxError(409, "ASSET_DISPOSAL_COMPANY_MISMATCH", `${inv.invoice_number} is to another customer than this disposal's buyer.`);
  const elsewhere = (await client.query(`SELECT DISTINCT k.case_number FROM tenant.asset_disposal_proceeds_allocations x JOIN tenant.asset_disposal_cases k ON k.id = x.case_id WHERE x.invoice_id = $1 AND x.status = 'ACTIVE' AND x.case_id <> $2`, [inv.id, k.id])).rows;
  if (elsewhere.length) throw sxError(409, "ASSET_SALE_INVOICE_DUPLICATE", `${inv.invoice_number} already carries the proceeds of ${elsewhere.map((x) => x.case_number).join(", ")}.`);
  const chosen = Array.isArray(input.lineIds) && input.lineIds.length ? live.filter((l) => input.lineIds.includes(l.id)) : live;
  if (!chosen.length) throw sxError(400, "ASSET_DISPOSAL_INVALID", "Choose the assets this invoice sells.");
  for (const l of chosen) {
    if (await posted(client, l.id)) throw dxError(409, "ASSET_DISPOSAL_ALREADY_POSTED", `${l.asset_number}'s derecognition is already posted with its proceeds.`);
    if (l.sale_invoice_id && l.sale_invoice_id !== inv.id) throw sxError(409, "ASSET_SALE_INVOICE_DUPLICATE", `${l.asset_number} is already linked to ${l.sale_invoice_number}.`);
  }
  // What other assets of this invoice already hold (posted ones keep theirs) is not shared again.
  const kept = (await client.query(`SELECT COALESCE(sum(amount), 0)::text AS t FROM tenant.asset_disposal_proceeds_allocations WHERE invoice_id = $1 AND status = 'ACTIVE' AND line_id <> ALL($2::uuid[])`, [inv.id, chosen.map((l) => l.id)])).rows[0].t;
  const total = invoiceNet(inv) - toPaise(kept);
  if (total < 0n) throw sxError(409, "ASSET_DISPOSAL_PROCEEDS_MISMATCH");
  const basis = String(input.basis ?? "AGREED_PRICE").toUpperCase();
  let amounts;
  if (basis === "MANUAL") {
    const given = Array.isArray(input.lines) ? input.lines : [];
    amounts = chosen.map((l) => { const g = given.find((x) => x.lineId === l.id); if (!g) throw sxError(400, "ASSET_DISPOSAL_PROCEEDS_MISMATCH", `Enter the amount for ${l.asset_number}.`); return toPaise(String(g.amount)); });
    if (amounts.some((x) => x < 0n)) throw sxError(400, "ASSET_DISPOSAL_PROCEEDS_MISMATCH");
    const sum = amounts.reduce((t, x) => t + x, 0n);
    if (sum !== total) throw sxError(409, "ASSET_DISPOSAL_PROCEEDS_MISMATCH", `The amounts add up to ${fromPaise(sum)}; ${inv.invoice_number} has ${fromPaise(total)} to allocate (before GST).`);
  } else if (basis === "EQUAL") amounts = proportional(total, chosen.map(() => 1n));
  else if (basis === "AGREED_PRICE") amounts = proportional(total, chosen.map((l) => priceOf(l)));
  else throw sxError(400, "ASSET_DISPOSAL_INVALID", "Choose how the proceeds are shared.");
  await writeAllocations(client, c, k, chosen.map((line, i) => ({ line, amount: amounts[i] })), inv, basis);
  if (!k.buyer_party_id) await client.query(`UPDATE tenant.asset_disposal_cases SET buyer_party_id = $2 WHERE id = $1`, [k.id, inv.party_id]);
  return { caseId: k.id, invoice: inv.invoice_number, basis, total: fromPaise(total), lines: chosen.map((l, i) => ({ lineId: l.id, asset: l.asset_number, amount: fromPaise(amounts[i]) })) };
}
// input: { invoiceDate?, commandId? } — a draft Sales Invoice to the buyer, one line per asset at its agreed price, revenue on the category's disposal
// proceeds (clearing) account and no tax yet: Sales and Finance set its GST treatment and post it. Created once however often requested.
export async function createDisposalSaleInvoice(client, c, caseId, input = {}) {
  if (!has(c, SX.sale) && !has(c, SX.scrap)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  if (!has(c, RECEIVABLES)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED", "Creating a Sales Invoice needs Sales' own invoicing right as well.");
  const k = await loadCase(client, c, caseId);
  if (k.generated_invoice_id) {
    const inv = (await client.query(`SELECT id, invoice_number, status FROM tenant.accounting_customer_invoices WHERE id = $1`, [k.generated_invoice_id])).rows[0];
    return { caseId: k.id, invoiceId: inv.id, invoiceNumber: inv.invoice_number, status: inv.status, replayed: true };
  }
  if (!(k.disposal_type === "SALE" || (k.disposal_type === "SCRAP" && k.scrap_method === "SCRAP_DEALER_SALE"))) throw sxError(409, "ASSET_DISPOSAL_INVALID", "A Sales Invoice is made for a sale or a scrap sold to a dealer — never for a zero-proceeds scrap.");
  const live = approvedOf(k, await linesOf(client, k.id)).filter((l) => !l.sale_invoice_id);
  if (!live.length) throw sxError(409, "ASSET_SALE_INVOICE_DUPLICATE", "Every asset in this disposal is already invoiced.");
  if (!k.buyer_party_id) throw sxError(409, "ASSET_SALE_BUYER_INVALID");
  const lines = [];
  for (const l of live) {
    const price = priceOf(l);
    if (price <= 0n) throw sxError(409, "ASSET_SALE_PRICE_INVALID", `Agree a price for ${l.asset_number} first.`);
    const account = (await client.query(`SELECT proceeds_account_id FROM tenant.asset_categories WHERE id = $1`, [l.category_id])).rows[0]?.proceeds_account_id;
    if (!account) throw dxError(409, "ASSET_DISPOSAL_GL_MAPPING_MISSING", `Set the disposal proceeds (clearing) account on ${l.asset_number}'s category.`);
    lines.push({ line: l, invoice: { description: `Disposal of ${l.asset_number} · ${l.asset_name}${l.serial_number ? ` (S/N ${l.serial_number})` : ""}`, quantity: "1", unitPrice: fromPaise(price), accountId: account } });
  }
  const { createCustomerInvoice } = await import("../../accounting/index.js");
  const made = await createCustomerInvoice(client, { organizationId: c.organizationId, userId: c.userId, permissions: c.permissions, roleSlugs: c.roleSlugs }, {
    partyId: k.buyer_party_id, invoiceDate: input.invoiceDate, currencyCode: k.sale_currency ?? undefined, lines: lines.map((x) => x.invoice),
    notes: `Asset disposal ${k.case_number}: sale of ${lines.map((x) => x.line.asset_number).join(", ")}. GST treatment to be set by Finance before posting.` }, { returnLineIds: true });
  await client.query(`UPDATE tenant.asset_disposal_cases SET generated_invoice_id = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [k.id, made.id]);
  const inv = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE id = $1`, [made.id])).rows[0];
  const invLines = (await client.query(`SELECT id, sequence, net_amount FROM tenant.accounting_customer_invoice_lines WHERE customer_invoice_id = $1 ORDER BY sequence`, [made.id])).rows;
  await writeAllocations(client, c, k, lines.map((x, i) => ({ line: x.line, amount: toPaise(invLines[i].net_amount), invoiceLineId: invLines[i].id })), inv, "INVOICE_LINE");
  await event(client, c, { caseId: k.id }, "SALE_INVOICE_CREATED", { invoice: inv.invoice_number, assets: lines.length }, null, text(input.commandId, 200) || null);
  return { caseId: k.id, invoiceId: inv.id, invoiceNumber: inv.invoice_number, status: inv.status, net: fromPaise(invoiceNet(inv)) };
}

// ------------------------------------------------------------------ checks the disposal workflow applies, and the execution view
// What still stands between a sale or scrap line and its derecognition (added to the disposal's own financial checks).
export async function executionIssuesOf(client, k, l) {
  const issues = [];
  if (!["SALE", "SCRAP"].includes(k.disposal_type)) return issues;
  if (k.disposal_type === "SALE" && !k.buyer_party_id) issues.push({ code: "ASSET_SALE_BUYER_INVALID", message: "Select the buyer." });
  if (l.certificate_required && !l.certificate_number && !l.evidence_references) issues.push({ code: "ASSET_SCRAP_EVIDENCE_REQUIRED", message: "Record the recycler's certificate or the destruction evidence." });
  if (l.sale_invoice_id) {
    const inv = (await client.query(`SELECT * FROM tenant.accounting_customer_invoices WHERE id = $1`, [l.sale_invoice_id])).rows[0];
    if (inv && ["draft", "pending_approval", "approved"].includes(String(inv.status))) issues.push({ code: "ASSET_SALE_TAX_REVIEW_REQUIRED", message: `${inv.invoice_number} is ${inv.status.replace(/_/g, " ")}: Finance sets its tax treatment and posts it.` });
    if (inv) {
      const alloc = (await client.query(`SELECT * FROM tenant.asset_disposal_proceeds_allocations WHERE line_id = $1 AND status = 'ACTIVE'`, [l.id])).rows[0];
      if (alloc?.invoice_line_id) {
        const il = (await client.query(`SELECT net_amount FROM tenant.accounting_customer_invoice_lines WHERE id = $1`, [alloc.invoice_line_id])).rows[0];
        if (!il || toPaise(il.net_amount) !== toPaise(alloc.amount)) issues.push({ code: "ASSET_DISPOSAL_PROCEEDS_MISMATCH", message: `${inv.invoice_number}'s line for this asset changed; allocate the proceeds again.` });
      } else {
        const sum = toPaise((await client.query(`SELECT COALESCE(sum(amount), 0)::text AS t FROM tenant.asset_disposal_proceeds_allocations WHERE invoice_id = $1 AND status = 'ACTIVE'`, [inv.id])).rows[0].t);
        if (sum > invoiceNet(inv)) issues.push({ code: "ASSET_DISPOSAL_PROCEEDS_MISMATCH", message: `The proceeds allocated from ${inv.invoice_number} exceed its amount.` });
      }
    }
  }
  return issues;
}
export function milestoneOf(k, l, invoice, exceptions = 0) {
  if (["COMPLETED", "REINSTATED"].includes(l.line_status)) return "COMPLETED";
  if (exceptions > 0 || l.line_status === "RECOVERY_REQUIRED") return "EXCEPTION";
  if (["DRAFT", "PENDING_APPROVAL"].includes(l.line_status)) return "NOT_STARTED";
  if (["PENDING_FINANCE", "POSTING"].includes(l.line_status)) return l.handover_at || l.handover_kind === "LOSS_EVIDENCE" ? (l.line_status === "POSTING" ? "FINANCE_PENDING" : "PHYSICAL_EXIT_CONFIRMED") : "FINANCE_PENDING";
  if (l.dispatched_at) return "IN_TRANSIT";
  const needsDoc = k.disposal_type === "SALE" || (k.disposal_type === "SCRAP" && k.scrap_method === "SCRAP_DEALER_SALE");
  if (needsDoc && (!invoice || !LIVE_INVOICE.includes(String(invoice.status)))) return "SALE_DOCUMENT_PENDING";
  if (k.disposal_type === "SCRAP" && !k.scrap_method && !l.scrap_method) return "NOT_STARTED";
  return "READY_FOR_HANDOVER";
}
// filters: { type?: SALE | SCRAP, milestone? } — every approved sale or scrap asset with its execution milestone, payment and figures.
export async function getSaleScrapExecutionQueue(client, c, filters = {}) {
  const { seesDisposals } = await import("./dx-rules.js");
  if (!seesDisposals(c)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED");
  const type = filters.type ? String(filters.type).toUpperCase() : null;
  const fin = has(c, "assets.disposal.view_financials");
  const rows = (await client.query(`SELECT l.*, k.case_number, k.disposal_type, k.scrap_method AS case_scrap, k.buyer_party_id, k.id AS kid, a.asset_number, a.name AS asset_name, bp.display_name AS buyer,
      inv.status AS invoice_status, inv.grand_total, inv.tax_total, inv.outstanding_amount, inv.invoice_number,
      (SELECT count(*)::int FROM tenant.asset_disposal_exceptions x WHERE x.line_id = l.id AND x.status = 'OPEN') AS exceptions
    FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id JOIN tenant.assets a ON a.id = l.asset_id LEFT JOIN tenant.business_parties bp ON bp.id = k.buyer_party_id
      LEFT JOIN tenant.accounting_customer_invoices inv ON inv.id = l.sale_invoice_id
    WHERE l.organization_id = $1 AND k.disposal_type IN ('SALE', 'SCRAP') AND ($2::text IS NULL OR k.disposal_type = $2) AND l.line_status NOT IN ('CANCELLED', 'REJECTED', 'DRAFT')
    ORDER BY k.case_number, l.line_number LIMIT 1000`, [c.organizationId, type])).rows;
  const out = rows.map((l) => {
    const milestone = milestoneOf({ disposal_type: l.disposal_type, scrap_method: l.case_scrap }, l, l.sale_invoice_id ? { status: l.invoice_status } : null, l.exceptions);
    const paid = l.grand_total !== null && l.grand_total !== undefined ? toPaise(l.grand_total) - toPaise(l.outstanding_amount ?? 0) : null;
    return { caseId: l.kid, case: l.case_number, lineId: l.id, type: l.disposal_type, asset: `${l.asset_number} · ${l.asset_name}`, buyer: l.buyer ?? null, scrapMethod: l.scrap_method ? SCRAP_METHODS[l.scrap_method] : null,
      milestone, milestoneLabel: MILESTONES[milestone], agreedPrice: fin ? (l.agreed_price !== null ? fromPaise(toPaise(l.agreed_price)) : toPaise(l.proposed_proceeds ?? 0) > 0n ? fromPaise(toPaise(l.proposed_proceeds)) : null) : null, currency: l.agreed_currency ?? null,
      invoice: l.invoice_number ?? null, invoiceStatus: l.invoice_status ?? null, allocated: fin && l.sale_proceeds !== null ? fromPaise(toPaise(l.sale_proceeds)) : null,
      invoiceTax: fin && l.tax_total !== null && l.tax_total !== undefined ? fromPaise(toPaise(l.tax_total)) : null, invoicePaid: fin && paid !== null ? fromPaise(paid) : null,
      outstanding: fin && l.outstanding_amount !== null && l.outstanding_amount !== undefined ? fromPaise(toPaise(l.outstanding_amount)) : null,
      certificate: l.certificate_number ?? null, certificateRequired: l.certificate_required, dispatchedAt: l.dispatched_at, carrier: l.carrier, handoverAt: l.handover_at, exceptions: l.exceptions, href: `/assets/disposals/${l.kid}` };
  });
  return filters.milestone ? out.filter((x) => x.milestone === filters.milestone) : out;
}
