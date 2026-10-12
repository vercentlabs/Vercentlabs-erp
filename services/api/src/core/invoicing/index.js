// Shared GST invoicing (migration 0098): the one place that decides which document a sale is, numbers it, and keeps it. It calculates no
// tax — the tax engine's finalized values (on the sale and its lines) are copied as they are. POS is one source; others can use the same
// numbering, records and reporting.
//
//  - determineRequiredSalesDocument: tax invoice, bill of supply, both on one document, or an ordinary (non-GST) receipt — never chosen by a
//    cashier.
//  - evaluateEInvoiceApplicability: whether the transaction needs an IRN. There is no IRP integration, so a transaction that does is blocked
//    before payment; an IRN or a signed QR is never made up.
//  - allocateInvoiceNumber: the next consecutive number of the seller registration's series for the financial year, at most 16 characters,
//    taken inside the caller's transaction (a rolled-back sale gives its number back; concurrent counters queue on the series row).
//  - issueGstInvoice: the immutable invoice header and lines.
//  - validateGstin: format and checksum — a well-formed GSTIN, not proof that it is active.
import { createHash } from "node:crypto";

import { decimal, formatDecimal, add } from "../decimal.js";

export class InvoiceError extends Error {
  constructor(status, message, code, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export const INVOICE_MESSAGES = Object.freeze({
  POS_INVOICE_SELLER_REGISTRATION_MISSING: "GST registration is not configured for this outlet.",
  POS_INVOICE_REGISTRATION_INVALID: "Seller tax registration needs verification.",
  POS_INVOICE_BUYER_DETAILS_REQUIRED: "Enter the required customer invoice details.",
  POS_INVOICE_GSTIN_INVALID: "Check the customer GSTIN.",
  POS_INVOICE_PLACE_OF_SUPPLY_REQUIRED: "Supply location information is missing.",
  POS_INVOICE_HSN_SAC_MISSING: "An item needs a valid tax classification.",
  POS_INVOICE_TAX_INVALID: "Invoice tax calculation could not be verified.",
  POS_INVOICE_NUMBER_SERIES_MISSING: "Invoice numbering is not configured.",
  POS_INVOICE_NUMBER_CONFLICT: "Invoice numbering could not be completed.",
  POS_INVOICE_DOCUMENT_TYPE_UNSUPPORTED: "This transaction needs a document workflow that is not enabled.",
  POS_INVOICE_EINVOICE_REQUIRED: "This transaction requires e-invoice registration, which is not set up. Issue it through your e-invoicing workflow instead of POS.",
  POS_INVOICE_IRP_UNAVAILABLE: "E-invoice service is unavailable.",
  POS_INVOICE_IRN_UNKNOWN: "E-invoice registration is being verified. Do not resubmit blindly.",
  POS_INVOICE_ALREADY_ISSUED: "An invoice already exists for this sale.",
  POS_INVOICE_CHECKOUT_CONFLICT: "The bill changed. Review it before completing payment.",
  POS_INVOICE_ISSUANCE_RECOVERY_REQUIRED: "Payment was recorded, but invoice issuance needs recovery.",
  POS_INVOICE_PERMISSION_DENIED: "You cannot perform this invoice action.",
  POS_INVOICE_NOT_FOUND: "Invoice not found.",
  POS_INVOICE_SERIES_INVALID: "The invoice series is not valid.",
});
export const invoiceError = (status, code, detail = null) => new InvoiceError(status, detail ? `${INVOICE_MESSAGES[code]} ${detail}` : INVOICE_MESSAGES[code], code);

// ------------------------------------------------------------------ GSTIN

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// The GSTIN's 15th character is a mod-36 check digit over the first 14.
export function validateGstin(value) {
  const gstin = String(value ?? "").trim().toUpperCase();
  if (!GSTIN_FORMAT.test(gstin)) return { valid: false, gstin, stateCode: null, message: "A GSTIN is 15 characters: state code, PAN, entity number, Z, check digit." };
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = GSTIN_CHARS.indexOf(gstin[index]) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  if (check !== gstin[14]) return { valid: false, gstin, stateCode: gstin.slice(0, 2), message: "The GSTIN's check digit does not match. Check for a typing mistake." };
  return { valid: true, gstin, stateCode: gstin.slice(0, 2), verified: false, message: "Format and check digit are valid (registration status is not verified here)." };
}

// ------------------------------------------------------------------ financial year

// "2026-27" for a date in the year starting in startMonth (April in India), in the organization's time zone.
export function financialYearOf(day, startMonth = 4) {
  const [year, month] = String(day).slice(0, 10).split("-").map(Number);
  const start = month >= startMonth ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
async function organizationCalendar(client, organizationId, at = null) {
  const row = (await client.query(
    `SELECT COALESCE(fiscal_year_start_month, 4) AS start_month,
            to_char((COALESCE($2::timestamptz, now()) AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS day
       FROM public.organizations WHERE id = $1`, [organizationId, at])).rows[0];
  return { startMonth: Number(row?.start_month ?? 4), day: row?.day ?? new Date().toISOString().slice(0, 10) };
}

// ------------------------------------------------------------------ which document

const STATUTORY_KIND = { tax_invoice: "tax_invoice", invoice_cum_bill_of_supply: "tax_invoice", bill_of_supply: "bill_of_supply", credit_note: "credit_note", debit_note: "debit_note" };
const TAXABLE_CLASSES = ["taxable", "zero_rated"];

// The document the law asks for: no GST registration (or GST off) → an ordinary receipt, not a GST document; a regular registration → a tax
// invoice when every line is taxable, a bill of supply when none is, both on one document otherwise. Other regimes (composition, …) are
// not issued here at all.
export function determineRequiredSalesDocument({ taxEnabled, registrationType = null, hasRegistration = false, classifications = [] }) {
  if (!taxEnabled || !hasRegistration || registrationType === "unregistered") return { documentType: "receipt", statutory: false, kind: null };
  if (registrationType && registrationType !== "regular") return { documentType: null, statutory: true, kind: null, unsupported: true };
  const taxable = classifications.filter((value) => TAXABLE_CLASSES.includes(value)).length;
  const documentType = taxable === classifications.length && taxable > 0 ? "tax_invoice" : taxable === 0 ? "bill_of_supply" : "invoice_cum_bill_of_supply";
  return { documentType, statutory: true, kind: STATUTORY_KIND[documentType] };
}

// Whether the supply needs an IRN: a registration under the mandate (from its date), a B2B supply on a tax document. B2C supplies, bills
// of supply and receipts do not. Returns { status, reason }.
export function evaluateEInvoiceApplicability({ registration, supplyType, documentType, day }) {
  if (!["tax_invoice", "invoice_cum_bill_of_supply", "credit_note", "debit_note"].includes(documentType)) return { status: "not_applicable", reason: "Not a tax document." };
  if (!registration?.einvoice_applicable) return { status: "not_applicable", reason: "The seller registration is not under the e-invoice mandate." };
  const from = registration.einvoice_applicable_from ? String(registration.einvoice_applicable_from instanceof Date ? registration.einvoice_applicable_from.toISOString() : registration.einvoice_applicable_from).slice(0, 10) : null;
  if (from && day < from) return { status: "not_applicable", reason: `E-invoicing applies from ${from}.` };
  if (supplyType !== "b2b") return { status: "not_applicable", reason: "B2C supply — no IRN." };
  return { status: "required", reason: "B2B supply by a registration under the e-invoice mandate." };
}
// No IRP/GSP integration is configured in this installation.
export const EINVOICE_PROVIDER_AVAILABLE = false;

// ------------------------------------------------------------------ numbering

const DEFAULT_PREFIX = { tax_invoice: "INV/", bill_of_supply: "BOS/", credit_note: "CN/", debit_note: "DN/" };
const fyCode = (financialYear) => `${financialYear.slice(2, 4)}${financialYear.slice(5, 7)}`;
export const formatInvoiceNumber = (series, value) => `${series.prefix}${fyCode(series.financial_year)}/${String(value).padStart(series.padding, "0")}`;

async function ensureSeries(client, organizationId, registrationId, kind, financialYear, userId) {
  await client.query(
    `INSERT INTO tenant.invoice_number_series (organization_id, seller_registration_id, document_kind, financial_year, prefix, padding, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,5,$6,$6) ON CONFLICT (organization_id, seller_registration_id, document_kind, financial_year) DO NOTHING`,
    [organizationId, registrationId, kind, financialYear, DEFAULT_PREFIX[kind], userId ?? null]);
}

// The next number of the series. Called inside the issuing transaction: the row lock queues concurrent counters, and a rolled-back sale
// returns its number, so numbers stay consecutive. A series is created with its default format the first time it is needed.
export async function allocateInvoiceNumber(client, context, { registrationId, kind, at = null }) {
  if (!registrationId) throw invoiceError(409, "POS_INVOICE_SELLER_REGISTRATION_MISSING");
  if (!DEFAULT_PREFIX[kind]) throw invoiceError(409, "POS_INVOICE_DOCUMENT_TYPE_UNSUPPORTED");
  const calendar = await organizationCalendar(client, context.organizationId, at);
  const financialYear = financialYearOf(calendar.day, calendar.startMonth);
  await ensureSeries(client, context.organizationId, registrationId, kind, financialYear, context.userId);
  const series = (await client.query(
    `UPDATE tenant.invoice_number_series SET next_number = next_number + 1, updated_at = now()
      WHERE organization_id=$1 AND seller_registration_id=$2 AND document_kind=$3 AND financial_year=$4 AND status='active'
      RETURNING *, next_number - 1 AS allocated`, [context.organizationId, registrationId, kind, financialYear])).rows[0];
  if (!series) throw invoiceError(409, "POS_INVOICE_NUMBER_SERIES_MISSING", `The ${kind.replace(/_/g, " ")} series for ${financialYear} is closed.`);
  const number = formatInvoiceNumber(series, series.allocated);
  if (number.length > 16) throw invoiceError(409, "POS_INVOICE_NUMBER_CONFLICT", `The series ${series.prefix} is full for ${financialYear}; set up a new series.`);
  return { seriesId: series.id, number, financialYear, day: calendar.day };
}

// Would the next number of this series still be a valid number? Checked before payment, so a full series never takes a payment.
export async function checkInvoiceNumbering(client, context, { registrationId, kind }) {
  if (!registrationId || !DEFAULT_PREFIX[kind]) return null;
  const calendar = await organizationCalendar(client, context.organizationId);
  const financialYear = financialYearOf(calendar.day, calendar.startMonth);
  const series = (await client.query(`SELECT * FROM tenant.invoice_number_series WHERE organization_id=$1 AND seller_registration_id=$2 AND document_kind=$3 AND financial_year=$4`,
    [context.organizationId, registrationId, kind, financialYear])).rows[0];
  if (!series) return null;
  if (series.status !== "active") return { code: "POS_INVOICE_NUMBER_SERIES_MISSING", message: `${INVOICE_MESSAGES.POS_INVOICE_NUMBER_SERIES_MISSING} The ${financialYear} series is closed.` };
  if (formatInvoiceNumber(series, series.next_number).length > 16) return { code: "POS_INVOICE_NUMBER_CONFLICT", message: `${INVOICE_MESSAGES.POS_INVOICE_NUMBER_CONFLICT} The series is full.` };
  return null;
}

const administrator = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)) || context.permissions?.includes("pos.settings.manage");

export async function listInvoiceSeries(client, context, { registrationId = null } = {}) {
  const calendar = await organizationCalendar(client, context.organizationId);
  const rows = (await client.query(
    `SELECT series.*, registration.name AS registration_name, registration.registration_number AS gstin FROM tenant.invoice_number_series series
       JOIN tenant.tax_registrations registration ON registration.organization_id = series.organization_id AND registration.id = series.seller_registration_id
      WHERE series.organization_id=$1 AND ($2::uuid IS NULL OR series.seller_registration_id=$2) ORDER BY series.financial_year DESC, registration.name, series.document_kind`,
    [context.organizationId, registrationId])).rows;
  const registrations = (await client.query(
    `SELECT id, name, registration_number, state_code, registration_type, status, einvoice_applicable, einvoice_applicable_from FROM tenant.tax_registrations
      WHERE organization_id=$1 ORDER BY is_default DESC, name`, [context.organizationId])).rows;
  return {
    currentFinancialYear: financialYearOf(calendar.day, calendar.startMonth), defaultPrefixes: DEFAULT_PREFIX, einvoiceProviderAvailable: EINVOICE_PROVIDER_AVAILABLE,
    registrations: registrations.map((row) => ({ id: row.id, name: row.name, gstin: row.registration_number, stateCode: row.state_code, registrationType: row.registration_type,
      status: row.status, einvoiceApplicable: row.einvoice_applicable, einvoiceApplicableFrom: row.einvoice_applicable_from })),
    series: rows.map((row) => ({ id: row.id, registrationId: row.seller_registration_id, registrationName: row.registration_name, gstin: row.gstin, kind: row.document_kind,
      financialYear: row.financial_year, prefix: row.prefix, padding: row.padding, nextNumber: Number(row.next_number), issued: Number(row.next_number) - 1, status: row.status,
      nextFormatted: formatInvoiceNumber(row, row.next_number), version: row.version })),
  };
}

// Set up a series before it is used (or close one). The format of a series that has issued numbers never changes.
export async function saveInvoiceSeries(client, context, input = {}) {
  if (!administrator(context)) throw invoiceError(403, "POS_INVOICE_PERMISSION_DENIED");
  const kind = input.kind;
  if (!DEFAULT_PREFIX[kind]) throw invoiceError(400, "POS_INVOICE_SERIES_INVALID", "Choose tax invoice, bill of supply, credit note or debit note.");
  const prefix = String(input.prefix ?? DEFAULT_PREFIX[kind]).trim();
  const padding = Number(input.padding ?? 5);
  if (!/^[A-Za-z0-9/-]{1,8}$/.test(prefix)) throw invoiceError(400, "POS_INVOICE_SERIES_INVALID", "The prefix is up to 8 letters, digits, / or -.");
  if (!Number.isInteger(padding) || padding < 3 || padding > 8 || prefix.length + 5 + padding > 16) throw invoiceError(400, "POS_INVOICE_SERIES_INVALID", "Prefix, year and number must fit in 16 characters.");
  const calendar = await organizationCalendar(client, context.organizationId);
  const financialYear = input.financialYear ?? financialYearOf(calendar.day, calendar.startMonth);
  if (!/^[0-9]{4}-[0-9]{2}$/.test(financialYear)) throw invoiceError(400, "POS_INVOICE_SERIES_INVALID", "The financial year is written like 2026-27.");
  const registration = (await client.query(`SELECT id FROM tenant.tax_registrations WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.registrationId ?? null])).rows[0];
  if (!registration) throw invoiceError(404, "POS_INVOICE_SELLER_REGISTRATION_MISSING");
  const existing = (await client.query(`SELECT * FROM tenant.invoice_number_series WHERE organization_id=$1 AND seller_registration_id=$2 AND document_kind=$3 AND financial_year=$4 FOR UPDATE`,
    [context.organizationId, registration.id, kind, financialYear])).rows[0];
  if (existing && Number(existing.next_number) > 1 && (existing.prefix !== prefix || existing.padding !== padding))
    throw invoiceError(409, "POS_INVOICE_SERIES_INVALID", "This series has already issued numbers; its format cannot change.");
  const status = input.status === "closed" ? "closed" : "active";
  const row = existing
    ? (await client.query(`UPDATE tenant.invoice_number_series SET prefix=$2, padding=$3, status=$4, version=version+1, updated_by=$5, updated_at=now() WHERE id=$1 RETURNING *`,
      [existing.id, prefix, padding, status, context.userId])).rows[0]
    : (await client.query(`INSERT INTO tenant.invoice_number_series (organization_id, seller_registration_id, document_kind, financial_year, prefix, padding, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`, [context.organizationId, registration.id, kind, financialYear, prefix, padding, status, context.userId])).rows[0];
  return { id: row.id, kind: row.document_kind, financialYear: row.financial_year, prefix: row.prefix, padding: row.padding, nextFormatted: formatInvoiceNumber(row, row.next_number), status: row.status };
}

// Whether a registration is under the e-invoice mandate (the company decides from its turnover and the current notifications).
export async function setEInvoiceApplicability(client, context, registrationId, input = {}) {
  if (!administrator(context)) throw invoiceError(403, "POS_INVOICE_PERMISSION_DENIED");
  const from = input.applicableFrom ? String(input.applicableFrom).slice(0, 10) : null;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw invoiceError(400, "POS_INVOICE_SERIES_INVALID", "Enter the date as YYYY-MM-DD.");
  const row = (await client.query(
    `UPDATE tenant.tax_registrations SET einvoice_applicable=$3, einvoice_applicable_from=$4, updated_by=$5, updated_at=now() WHERE organization_id=$1 AND id=$2
      RETURNING id, name, registration_number, einvoice_applicable, einvoice_applicable_from`, [context.organizationId, registrationId, Boolean(input.applicable), from, context.userId])).rows[0];
  if (!row) throw invoiceError(404, "POS_INVOICE_SELLER_REGISTRATION_MISSING");
  return { registrationId: row.id, name: row.name, gstin: row.registration_number, applicable: row.einvoice_applicable, applicableFrom: row.einvoice_applicable_from,
    providerAvailable: EINVOICE_PROVIDER_AVAILABLE };
}

// ------------------------------------------------------------------ issuing

const COMPONENTS = ["cgst", "sgst", "utgst", "igst", "cess"];
const n = (value) => formatDecimal(decimal(String(value ?? 0)), 6);
export function splitComponents(components) {
  const out = Object.fromEntries(COMPONENTS.flatMap((type) => [[`${type}_rate`, "0"], [`${type}_amount`, "0"]]));
  for (const component of Array.isArray(components) ? components : []) {
    const type = String(component.type ?? "").toLowerCase();
    if (!COMPONENTS.includes(type)) continue;
    out[`${type}_rate`] = String(component.rate ?? 0);
    out[`${type}_amount`] = formatDecimal(add(decimal(out[`${type}_amount`]), decimal(String(component.taxAmount ?? component.tax_amount ?? 0))), 6);
  }
  return out;
}

// Write an invoice: the header (totals by component are the sum of the lines) and its lines, with a content hash over both. One per source.
export async function issueGstInvoice(client, context, header, lines) {
  const totals = Object.fromEntries(COMPONENTS.map((type) => [type, lines.reduce((sum, line) => add(sum, decimal(String(line[`${type}_amount`] ?? 0))), decimal(0))]));
  const content = { header: { ...header, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, formatDecimal(value, 6)])) }, lines };
  const contentHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const row = (await client.query(
    `INSERT INTO tenant.gst_invoices (organization_id, source_type, source_id, store_id, seller_registration_id, series_id, document_type, invoice_number, financial_year, issued_at,
       original_invoice_id, reason, customer_mode, customer_id, supply_type, buyer_gstin, seller_snapshot, buyer_snapshot, place_of_supply_code, place_of_supply_name, supply_mode,
       reverse_charge, currency_code, subtotal, discount_total, taxable_total, cgst_total, sgst_total, utgst_total, igst_total, cess_total, tax_total, rounding_adjustment, grand_total,
       tax_calculation_hash, einvoice_status, content_hash, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now()),$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,false,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
     ON CONFLICT (organization_id, source_type, source_id) DO NOTHING RETURNING *`,
    [context.organizationId, header.sourceType, header.sourceId, header.storeId ?? null, header.registrationId ?? null, header.seriesId ?? null, header.documentType, header.invoiceNumber,
      header.financialYear, header.issuedAt ?? null, header.originalInvoiceId ?? null, header.reason ?? null, header.customerMode ?? "walk_in", header.customerId ?? null,
      header.supplyType ?? "b2c", header.buyerGstin ?? null, JSON.stringify(header.seller ?? {}), JSON.stringify(header.buyer ?? {}), header.placeOfSupplyCode ?? null,
      header.placeOfSupplyName ?? null, header.supplyMode ?? null, header.currency ?? "INR", n(header.subtotal), n(header.discountTotal), n(header.taxableTotal),
      formatDecimal(totals.cgst, 6), formatDecimal(totals.sgst, 6), formatDecimal(totals.utgst, 6), formatDecimal(totals.igst, 6), formatDecimal(totals.cess, 6), n(header.taxTotal),
      n(header.rounding), n(header.grandTotal), header.taxHash ?? null, header.einvoiceStatus ?? "not_applicable", contentHash, context.userId])).rows[0];
  if (!row) throw invoiceError(409, "POS_INVOICE_ALREADY_ISSUED");
  let number = 0;
  for (const line of lines) {
    number += 1;
    await client.query(
      `INSERT INTO tenant.gst_invoice_lines (organization_id, invoice_id, line_number, source_line_id, item_id, description, hsn_sac, uom_code, quantity, unit_price, price_includes_tax,
         gross_amount, item_discount, promotion_discount, cart_discount, taxable_amount, tax_classification, tax_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, utgst_rate,
         utgst_amount, igst_rate, igst_amount, cess_rate, cess_amount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [context.organizationId, row.id, number, line.sourceLineId ?? null, line.itemId ?? null, line.description, line.hsnSac ?? null, line.uomCode ?? null, n(line.quantity),
        n(line.unitPrice), Boolean(line.priceIncludesTax), n(line.grossAmount), n(line.itemDiscount), n(line.promotionDiscount), n(line.cartDiscount), n(line.taxableAmount),
        line.taxClassification ?? null, line.taxRate ?? null, line.cgst_rate, line.cgst_amount, line.sgst_rate, line.sgst_amount, line.utgst_rate, line.utgst_amount, line.igst_rate,
        line.igst_amount, line.cess_rate, line.cess_amount, n(line.lineTotal)]);
  }
  return row;
}

// Do the invoice's lines add up to its header, and the header to its source? { ok, differences }.
export async function reconcileGstInvoice(client, context, invoiceId, source = null) {
  const invoice = (await client.query(`SELECT * FROM tenant.gst_invoices WHERE organization_id=$1 AND id=$2`, [context.organizationId, invoiceId])).rows[0];
  if (!invoice) throw invoiceError(404, "POS_INVOICE_NOT_FOUND");
  const sums = (await client.query(
    `SELECT COALESCE(sum(taxable_amount),0) AS taxable, COALESCE(sum(cgst_amount + sgst_amount + utgst_amount + igst_amount + cess_amount),0) AS tax, COALESCE(sum(line_total),0) AS total
       FROM tenant.gst_invoice_lines WHERE organization_id=$1 AND invoice_id=$2`, [context.organizationId, invoiceId])).rows[0];
  const differences = [];
  const compare = (label, a, b) => { if (decimal(String(a)) !== decimal(String(b))) differences.push({ field: label, invoice: String(a), expected: String(b) }); };
  compare("taxable (lines)", invoice.taxable_total, sums.taxable);
  compare("tax (lines)", invoice.tax_total, sums.tax);
  if (source) {
    compare("taxable (source)", invoice.taxable_total, source.taxable_total);
    compare("tax (source)", invoice.tax_total, source.tax_total);
    compare("grand total (source)", invoice.grand_total, source.grand_total);
  }
  return { ok: differences.length === 0, differences };
}

// ------------------------------------------------------------------ reporting

// GST summary for a period: documents by type, B2B / B2C, rate-wise taxable value and tax, HSN summary, and documents issued per series
// (first and last number, count) — the figures a GST return is prepared from. storeIds limits it to outlets the person may see.
export async function getGstInvoiceSummary(client, context, { from, to, storeIds = null } = {}) {
  const values = [context.organizationId, from, to, storeIds];
  const scope = `invoice.organization_id=$1 AND invoice.issued_at >= $2::date AND invoice.issued_at < $3::date + 1 AND ($4::uuid[] IS NULL OR invoice.store_id = ANY($4::uuid[]))`;
  const byType = (await client.query(
    `SELECT invoice.document_type, invoice.supply_type, count(*)::int AS documents, sum(invoice.taxable_total)::text AS taxable, sum(invoice.cgst_total)::text AS cgst,
            sum(invoice.sgst_total)::text AS sgst, sum(invoice.utgst_total)::text AS utgst, sum(invoice.igst_total)::text AS igst, sum(invoice.cess_total)::text AS cess,
            sum(invoice.grand_total)::text AS total
       FROM tenant.gst_invoices invoice WHERE ${scope} AND invoice.document_status = 'issued' GROUP BY 1, 2 ORDER BY 1, 2`, values)).rows;
  const byRate = (await client.query(
    `SELECT line.tax_rate::text AS rate, CASE WHEN invoice.document_type = 'credit_note' THEN 'credit_note' ELSE 'invoice' END AS side, sum(line.taxable_amount)::text AS taxable,
            sum(line.cgst_amount)::text AS cgst, sum(line.sgst_amount)::text AS sgst, sum(line.utgst_amount)::text AS utgst, sum(line.igst_amount)::text AS igst, sum(line.cess_amount)::text AS cess
       FROM tenant.gst_invoice_lines line JOIN tenant.gst_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.invoice_id
      WHERE ${scope} AND invoice.document_status = 'issued' GROUP BY 1, 2 ORDER BY 2, 1`, values)).rows;
  const hsn = (await client.query(
    `SELECT COALESCE(line.hsn_sac, '—') AS hsn_sac, COALESCE(line.uom_code, '') AS uom, line.tax_rate::text AS rate,
            sum(CASE WHEN invoice.document_type = 'credit_note' THEN -line.quantity ELSE line.quantity END)::text AS quantity,
            sum(CASE WHEN invoice.document_type = 'credit_note' THEN -line.taxable_amount ELSE line.taxable_amount END)::text AS taxable,
            sum(CASE WHEN invoice.document_type = 'credit_note' THEN -(line.cgst_amount + line.sgst_amount + line.utgst_amount + line.igst_amount + line.cess_amount)
                     ELSE line.cgst_amount + line.sgst_amount + line.utgst_amount + line.igst_amount + line.cess_amount END)::text AS tax
       FROM tenant.gst_invoice_lines line JOIN tenant.gst_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.invoice_id
      WHERE ${scope} AND invoice.document_status = 'issued' GROUP BY 1, 2, 3 ORDER BY 1, 3 LIMIT 500`, values)).rows;
  const series = (await client.query(
    `SELECT invoice.document_type, invoice.financial_year, series.prefix, min(invoice.invoice_number) AS first_number, max(invoice.invoice_number) AS last_number,
            count(*)::int AS issued, count(*) FILTER (WHERE invoice.document_status = 'cancelled')::int AS cancelled
       FROM tenant.gst_invoices invoice LEFT JOIN tenant.invoice_number_series series ON series.organization_id = invoice.organization_id AND series.id = invoice.series_id
      WHERE ${scope} GROUP BY 1, 2, 3 ORDER BY 1, 2`, values)).rows;
  return { from, to, byType, byRate, hsn, series };
}
