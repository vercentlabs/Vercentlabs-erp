// GST — the outward supplies of one company registration (GSTIN) over a date range, read from what was actually issued and posted: Finance's
// customer invoices, credit notes and debit notes (sales invoices are these, with the selling registration kept on the sales invoice) and
// POS's GST invoices and credit notes. Each document keeps its own line values and tax split (the snapshot taken when it was issued) — a
// rate changed since is never applied to it. Each line is classified (taxable, nil-rated, exempt, non-GST, zero-rated) and checked.
import { createHash } from "node:crypto";

import { validateGstin } from "../../core/invoicing/index.js";
import { UTGST_TERRITORIES } from "../../core/tax/engine.js";
import { unitUqcMap } from "../../core/tax/uqc.js";
import { HEADS, defaultRegistrationId, paise, stateCodeOf, ymd } from "./gst-common.js";

const STANDARD_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
export const B2CL_LIMIT = 100000_00; // paise: an unregistered inter-state invoice above ₹1 lakh is reported invoice-wise (B2CL)
const CLASSES = { taxable: "taxable", nil_rated: "nil_rated", nil: "nil_rated", exempt: "exempt", non_gst: "non_gst", non_taxable: "non_gst", zero_rated: "zero_rated" };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const snapRate = (r) => {
  const near = STANDARD_RATES.find((s) => Math.abs(s - r) <= 0.06);
  return near ?? Math.round(r * 1000) / 1000;
};

// components: [{ tax_type|taxType, rate?, tax_amount|taxAmount }] → paise by head and the GST rate (without cess)
function split(components, taxablePaise) {
  const heads = { igst: 0, cgst: 0, sgst: 0, utgst: 0, cess: 0 };
  let rate = 0;
  let rated = false;
  for (const comp of components) {
    const type = String(comp.tax_type ?? comp.taxType ?? "").toLowerCase();
    const amount = paise(comp.tax_amount ?? comp.taxAmount ?? 0);
    if (!HEADS.includes(type)) continue;
    heads[type] += amount;
    if (type !== "cess" && comp.rate !== undefined && comp.rate !== null) { rate += Number(comp.rate); rated = true; }
  }
  if (!rated && taxablePaise) rate = ((heads.igst + heads.cgst + heads.sgst + heads.utgst) / taxablePaise) * 100;
  return { heads, rate: snapRate(rate), exact: rated || STANDARD_RATES.some((s) => Math.abs(s - rate) <= 0.06) };
}
function classify({ treatment, supplyType, tax, rate }) {
  const t = CLASSES[String(treatment ?? "").toLowerCase()];
  if (supplyType === "export" || supplyType === "sez") return "zero_rated";
  if (supplyType === "exempt") return "exempt";
  if (supplyType === "non_gst") return "non_gst";
  if (t === "taxable") return tax > 0 || rate > 0 ? "taxable" : "nil_rated";
  if (t) return t;
  return tax > 0 ? "taxable" : null; // a line with no tax and no recorded treatment is not assumed to be anything
}

// What one company registration issued between from and to. Returns { documents, cancelled } where each document is
// { sourceType, sourceId, kind, number, date, recipientGstin, recipientName, pos, nature, supplyType, value, taxTotal, original, einvoice,
//   updatedAt, lines: [{ hsn, description, uqc, quantity, rate, rateExact, classification, taxable, igst, cgst, sgst, utgst, cess, lineTax, goods }], hash }.
export async function collectOutward(client, c, registration, from, to, { sourceIds = null } = {}) {
  const fallback = await defaultRegistrationId(client, c);
  const seller = String(registration.state_code ?? "").trim();
  const uqc = await unitUqcMap(client, c.organizationId);
  const documents = [];
  const ids = sourceIds ? [...sourceIds] : null;

  // ---- Finance customer invoices / credit notes / debit notes
  const inv = (await client.query(`SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.status, i.customer_snapshot, i.place_of_supply, i.supply_type, i.grand_total, i.tax_total,
      i.exchange_rate, i.source_invoice_id, o.invoice_number AS original_number, o.invoice_date AS original_date, i.e_invoice_status, i.e_invoice_reference, i.updated_at,
      si.seller_registration_id
    FROM tenant.accounting_customer_invoices i LEFT JOIN tenant.sales_invoices si ON si.customer_invoice_id = i.id
    LEFT JOIN tenant.accounting_customer_invoices o ON o.id = i.source_invoice_id
    WHERE i.organization_id = $1 AND i.invoice_type IN ('invoice', 'credit_note', 'debit_note') AND i.posted_at IS NOT NULL AND i.status NOT IN ('cancelled', 'reversed')
      AND i.invoice_date BETWEEN $2 AND $3 AND COALESCE(si.seller_registration_id, $5::uuid) = $4 AND ($6::uuid[] IS NULL OR i.id = ANY($6::uuid[]))
    ORDER BY i.invoice_date, i.invoice_number`, [c.organizationId, from, to, registration.id, fallback, ids])).rows;
  const lineRows = inv.length ? (await client.query(`SELECT l.id, l.customer_invoice_id, l.hsn_sac_code, l.description, l.quantity, l.net_amount, l.tax_amount, l.tax_details,
      u.code AS uom_code, sl.tax_rate, sl.tax_treatment, sl.hsn_sac_kind, sl.uom_snapshot
    FROM tenant.accounting_customer_invoice_lines l LEFT JOIN tenant.sales_invoice_lines sl ON sl.customer_invoice_line_id = l.id
    LEFT JOIN tenant.units_of_measure u ON u.id = l.uom_id
    WHERE l.organization_id = $1 AND l.customer_invoice_id = ANY($2::uuid[]) ORDER BY l.customer_invoice_id, l.sequence`, [c.organizationId, inv.map((i) => i.id)])).rows : [];
  const compRows = lineRows.length ? (await client.query(`SELECT customer_invoice_line_id, tax_type, rate, taxable_amount, tax_amount FROM tenant.sales_invoice_line_taxes
    WHERE organization_id = $1 AND customer_invoice_line_id = ANY($2::uuid[])`, [c.organizationId, lineRows.map((l) => l.id)])).rows : [];
  const compsOf = new Map();
  for (const r of compRows) compsOf.set(r.customer_invoice_line_id, [...(compsOf.get(r.customer_invoice_line_id) ?? []), r]);
  for (const i of inv) {
    const fx = Number(i.exchange_rate ?? 1) || 1;
    const lines = lineRows.filter((l) => l.customer_invoice_id === i.id).map((l) => {
      const taxable = Math.round(paise(l.net_amount) * fx);
      const comps = compsOf.get(l.id) ?? (Array.isArray(l.tax_details) ? l.tax_details : []);
      const { heads, rate, exact } = split(comps, taxable);
      for (const k of HEADS) heads[k] = Math.round(heads[k] * fx);
      const lineTax = Math.round(paise(l.tax_amount) * fx);
      const unit = String(l.uom_code ?? l.uom_snapshot?.code ?? "").toUpperCase();
      const hsn = String(l.hsn_sac_code ?? "").replace(/\s/g, "") || null;
      return { hsn, description: l.description, uqc: unit ? uqc.get(unit) ?? "OTH" : "OTH", quantity: Number(l.quantity ?? 0), rate, rateExact: exact,
        classification: classify({ treatment: l.tax_treatment, supplyType: i.supply_type, tax: lineTax, rate: Number(l.tax_rate ?? rate) }), taxable, ...heads, lineTax,
        goods: l.hsn_sac_kind ? l.hsn_sac_kind !== "sac" : !(hsn ?? "").startsWith("99") };
    });
    const pos = stateCodeOf(i.place_of_supply);
    documents.push({ sourceType: "customer_invoice", sourceId: i.id, kind: i.invoice_type, number: i.invoice_number, date: ymd(i.invoice_date),
      recipientGstin: String(i.customer_snapshot?.gstin ?? "").trim().toUpperCase() || null, recipientName: i.customer_snapshot?.legalName ?? i.customer_snapshot?.displayName ?? null,
      pos, nature: pos && seller ? (pos === seller ? "intra" : "inter") : null, supplyType: i.supply_type ?? "domestic", value: Math.round(paise(i.grand_total) * fx),
      taxTotal: Math.round(paise(i.tax_total) * fx), original: i.source_invoice_id ? { number: i.original_number, date: ymd(i.original_date) } : null, linked: Boolean(i.source_invoice_id),
      einvoice: { status: i.e_invoice_status, reference: i.e_invoice_reference }, updatedAt: i.updated_at, lines });
  }

  // ---- POS GST invoices and credit notes
  const tz = (await client.query(`SELECT coalesce(timezone, 'Asia/Kolkata') AS tz FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.tz ?? "Asia/Kolkata";
  const pos = (await client.query(`SELECT g.*, (COALESCE(g.issued_at, g.created_at) AT TIME ZONE $5)::date AS day, o.invoice_number AS original_number,
      (COALESCE(o.issued_at, o.created_at) AT TIME ZONE $5)::date AS original_day
    FROM tenant.gst_invoices g LEFT JOIN tenant.gst_invoices o ON o.id = g.original_invoice_id
    WHERE g.organization_id = $1 AND g.seller_registration_id = $2 AND g.document_status = 'issued' AND g.document_type <> 'receipt'
      AND (COALESCE(g.issued_at, g.created_at) AT TIME ZONE $5)::date BETWEEN $3 AND $4 AND ($6::uuid[] IS NULL OR g.id = ANY($6::uuid[]))
    ORDER BY g.invoice_number`, [c.organizationId, registration.id, from, to, tz, ids])).rows;
  const posLines = pos.length ? (await client.query(`SELECT * FROM tenant.gst_invoice_lines WHERE organization_id = $1 AND invoice_id = ANY($2::uuid[]) ORDER BY invoice_id, line_number`,
    [c.organizationId, pos.map((g) => g.id)])).rows : [];
  for (const g of pos) {
    const kind = g.document_type === "credit_note" ? "credit_note" : g.document_type === "debit_note" ? "debit_note" : "invoice";
    const lines = posLines.filter((l) => l.invoice_id === g.id).map((l) => {
      const heads = { igst: paise(l.igst_amount), cgst: paise(l.cgst_amount), sgst: paise(l.sgst_amount), utgst: paise(l.utgst_amount), cess: paise(l.cess_amount) };
      const lineTax = heads.igst + heads.cgst + heads.sgst + heads.utgst + heads.cess;
      const hsn = String(l.hsn_sac ?? "").replace(/\s/g, "") || null;
      return { hsn, description: l.description, uqc: uqc.get(String(l.uom_code ?? "").toUpperCase()) ?? "OTH", quantity: Number(l.quantity ?? 0), rate: snapRate(Number(l.tax_rate ?? 0)), rateExact: true,
        classification: classify({ treatment: l.tax_classification, supplyType: "domestic", tax: lineTax, rate: Number(l.tax_rate ?? 0) }), taxable: paise(l.taxable_amount), ...heads, lineTax,
        goods: !(hsn ?? "").startsWith("99") };
    });
    const code = stateCodeOf(g.place_of_supply_code ?? g.place_of_supply_name);
    documents.push({ sourceType: "pos_invoice", sourceId: g.id, kind, number: g.invoice_number, date: ymd(g.day), recipientGstin: g.buyer_gstin ? String(g.buyer_gstin).toUpperCase() : null,
      recipientName: g.buyer_snapshot?.legalName ?? g.buyer_snapshot?.name ?? null, pos: code, nature: code && seller ? (code === seller ? "intra" : "inter") : null, supplyType: "domestic",
      value: paise(g.grand_total), taxTotal: paise(g.tax_total), original: g.original_invoice_id ? { number: g.original_number, date: ymd(g.original_day) } : null, linked: kind === "invoice" || Boolean(g.original_invoice_id),
      einvoice: { status: g.einvoice_status, reference: g.irn }, updatedAt: g.created_at, lines });
  }
  for (const d of documents) d.hash = hash({ k: d.kind, n: d.number, dt: d.date, g: d.recipientGstin, p: d.pos, v: d.value, l: d.lines.map((l) => [l.hsn, l.classification, l.rate, l.taxable, l.igst, l.cgst, l.sgst, l.utgst, l.cess]) });

  // ---- what was cancelled or reversed in the period (GSTR-1 Table 13)
  const cancelled = sourceIds ? [] : (await client.query(`SELECT i.invoice_type AS kind, i.invoice_number AS number FROM tenant.accounting_customer_invoices i LEFT JOIN tenant.sales_invoices si ON si.customer_invoice_id = i.id
      WHERE i.organization_id = $1 AND i.invoice_type IN ('invoice', 'credit_note', 'debit_note') AND i.status IN ('cancelled', 'reversed') AND i.invoice_number IS NOT NULL AND i.posted_at IS NOT NULL
        AND i.invoice_date BETWEEN $2 AND $3 AND COALESCE(si.seller_registration_id, $5::uuid) = $4
    UNION ALL SELECT CASE WHEN document_type = 'credit_note' THEN 'credit_note' ELSE 'pos_invoice' END, invoice_number FROM tenant.gst_invoices
      WHERE organization_id = $1 AND seller_registration_id = $4 AND document_status = 'cancelled' AND (COALESCE(issued_at, created_at) AT TIME ZONE $6)::date BETWEEN $2 AND $3`,
    [c.organizationId, from, to, registration.id, fallback, tz])).rows;
  return { documents, cancelled, sellerState: seller, utgstState: UTGST_TERRITORIES.has(seller) };
}

// The checks every outward document must pass before it is reported. Returns [{ code, severity, message }].
export function checkDocument(d, registration, { sellerState }) {
  const out = [];
  const add = (code, severity, message) => out.push({ code, severity, message });
  const taxed = d.lines.some((l) => l.classification === "taxable" || l.classification === "zero_rated");
  if (d.recipientGstin) {
    const v = validateGstin(d.recipientGstin);
    if (!v.valid) add("GSTIN_INVALID", "blocking", `The customer's GSTIN ${d.recipientGstin} is not valid: ${v.message}`);
    else if (d.recipientGstin === String(registration.registration_number).toUpperCase()) add("GSTIN_OWN", "blocking", "The customer's GSTIN is the company's own.");
  }
  if (taxed && d.supplyType === "domestic" && !d.pos) add("POS_MISSING", "blocking", "No place of supply is recorded.");
  for (const [n, l] of d.lines.entries()) {
    const at = `Line ${n + 1}`;
    if (!l.classification) add("LINE_UNCLASSIFIED", "blocking", `${at} carries no tax and no tax treatment (taxable, nil-rated, exempt or non-GST). Reports cannot assume what it is.`);
    if (!l.hsn && l.classification !== "non_gst") add("HSN_MISSING", "blocking", `${at} has no HSN / SAC code.`);
    else if (l.hsn && !/^\d{4,8}$/.test(l.hsn)) add("HSN_INVALID", "blocking", `${at}: HSN / SAC ${l.hsn} must be 4 to 8 digits.`);
    if (!l.rateExact && l.classification === "taxable") add("RATE_UNRECOGNISED", "blocking", `${at}: the tax works out to ${l.rate}% of the taxable value, which is not a GST rate.`);
    const parts = l.igst + l.cgst + l.sgst + l.utgst + l.cess;
    if (Math.abs(parts - l.lineTax) > 1) add("LINE_TAX_MISMATCH", "blocking", `${at}: its tax split (${(parts / 100).toFixed(2)}) does not add up to its tax (${(l.lineTax / 100).toFixed(2)}).`);
    if (d.nature === "intra" && l.igst > 0) add("TAX_HEAD_MISMATCH", "blocking", `${at}: IGST is charged on an intra-state supply.`);
    if (d.nature === "inter" && (l.cgst + l.sgst + l.utgst) > 0) add("TAX_HEAD_MISMATCH", "blocking", `${at}: CGST / SGST is charged on an inter-state supply.`);
    if (d.nature === "intra" && UTGST_TERRITORIES.has(sellerState) && l.sgst > 0) add("UTGST_EXPECTED", "warning", `${at}: SGST is charged in a Union Territory that charges UTGST.`);
  }
  const lineTax = d.lines.reduce((s, l) => s + l.lineTax, 0);
  if (Math.abs(lineTax - d.taxTotal) > 1) add("DOCUMENT_TAX_MISMATCH", "blocking", `The lines' tax (${(lineTax / 100).toFixed(2)}) does not match the document's tax total (${(d.taxTotal / 100).toFixed(2)}).`);
  if (d.kind !== "invoice" && !d.linked) add("NOTE_UNLINKED", "warning", "This note is not linked to the invoice it corrects.");
  if (d.supplyType === "export" || d.supplyType === "sez") add("ZERO_RATED_DETAILS", "warning",
    `${d.supplyType === "export" ? "Export" : "SEZ supply"}: the shipping bill / port code (or the SEZ endorsement) is not captured here. Complete those details on the portal.`);
  const einvoiceDue = registration.einvoice_applicable && (!registration.einvoice_applicable_from || ymd(registration.einvoice_applicable_from) <= d.date)
    && (d.recipientGstin || d.supplyType === "export" || d.supplyType === "sez");
  if (einvoiceDue && !["generated", "registered"].includes(String(d.einvoice?.status ?? "")) && !d.einvoice?.reference) add("EINVOICE_MISSING", "warning",
    "E-invoicing applies to this registration, but no IRN is recorded for this document.");
  return out;
}

// The GSTR-1 section of a document: invoices to registered recipients are B2B; unregistered inter-state invoices above ₹1 lakh B2CL; other
// unregistered B2CS; notes CDNR (registered) or CDNUR (exports, unregistered inter-state above ₹1 lakh) else netted into B2CS; exports EXP.
export function sectionOf(d) {
  const large = d.nature === "inter" && Math.abs(d.value) > B2CL_LIMIT;
  if (d.kind === "invoice") {
    if (d.supplyType === "export") return "exp";
    if (d.recipientGstin) return "b2b";
    return large ? "b2cl" : "b2cs";
  }
  if (d.recipientGstin) return "cdnr";
  if (d.supplyType === "export" || large) return "cdnur";
  return "b2cs";
}
