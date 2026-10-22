// Registered printable documents. Each renderer loads its record through the
// owning module's authoritative read - the SAME function (and therefore the
// same permission, store scope and margin redaction) the screen uses
// - then builds a plain document model for @vercentlabs/document-engine/pdf.
// A PDF is a presentation of the record, never a new source of truth. There
// is no arbitrary template, HTML, file path or SQL input.
import { unitUqcMap } from "../../core/tax/uqc.js";
import { amountInWords, formatDateTime } from "@vercentlabs/localization";
import { upiPaymentUri } from "@vercentlabs/document-engine/pdf";

import { getCompanyProfile, readCompanyImage } from "../../core/organization/index.js";

import { getPosSaleReceipt } from "../../modules/point-of-sale/transaction-continuity-and-documents/receipts.js";
import { getPosSaleTaxes } from "../../modules/point-of-sale/pos-analytics/taxes.js";
import { getRefundVoucher } from "../../modules/accounting/index.js";
import { getCreditNoteDocument, getDeliveryNote, getOrderConfirmation, getProformaInvoice, getQuotation, getReturnNote, getSalesInvoiceDocument, getSalesOrder } from "../../modules/sales/index.js";
import { getGoodsReceipt, getPurchaseOrderDocument } from "../../modules/procurement/purchase-orders/index.js";
import { getSupplierBill } from "../../modules/procurement/supplier-bills/index.js";
import { getPurchaseReturn } from "../../modules/procurement/purchase-returns/index.js";
import { getSupplierDebitClaim, getVendorCredit } from "../../modules/procurement/vendor-credits/index.js";
import { getSupplierPayment } from "../../modules/procurement/payments/index.js";
import { getPurchaseReturnChallan } from "../../modules/procurement/purchase-returns/index.js";
import { getPurchaseRfq } from "../../modules/procurement/rfqs/index.js";
import { getDealQuote, loadSharedDealQuote, resolveSharedDealQuote } from "../../modules/crm/quotes/index.js";
import { findIndianState } from "@vercentlabs/shared-types";
import { getSalesChallan } from "../../modules/sales/challans.js";
import { getSalesPayment } from "../../modules/sales/payments/index.js";
import { getDebitNoteDocument } from "../../modules/sales/debit-notes/index.js";
import { getCustomerStatementDocument } from "../../modules/sales/outstanding/index.js";

const amount = (value, locale = "en-IN") => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
const date = (value, timeZone) => (value ? formatDateTime(value, { timeZone: timeZone || "UTC" }) : null);
// DATE columns arrive from node-pg as local midnight: format them in the
// server's own zone so the calendar day never shifts.
const day = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00`) : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsed);
};
const addressLines = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return [];
  return [snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postalCode ?? snapshot.postal_code].filter(Boolean).join(", "), snapshot.country ?? snapshot.countryCode]
    .map((line) => (line ? String(line) : ""))
    .filter(Boolean);
};

// Module contexts exactly as each module's own routes build them.
const posContext = (session) => ({ organizationId: session.organizationId, userId: session.userId, roleSlugs: session.roleSlugs, permissions: session.permissions });
const salesContext = (session) => ({
  organizationId: session.organizationId,
  userId: session.userId,
  permissions: session.permissions,
  roleSlugs: session.roleSlugs,
});

async function organizationName(client, organizationId) {
  const { rows } = await client.query(`SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id=$1`, [organizationId]);
  return rows[0]?.name ?? null;
}

// The organization as printed when a document has no company registration stored: name, legal name and tax id.
async function companyDetails(client, organizationId) {
  const { rows } = await client.query(
    `SELECT organization.name, organization.legal_name, organization.tax_id FROM public.organizations organization WHERE organization.id = $1`, [organizationId]);
  const row = rows[0] ?? {};
  return { name: row.legal_name || row.name || null, legalName: row.legal_name && row.legal_name !== row.name ? row.name : null, taxId: row.tax_id ?? null };
}

// The company's letterhead and payment details for layout v2 (Shared Platform plan 4): its logo and the lines under its name
// (address, GSTIN, PAN, CIN, phone, email), the signature for the authorised signatory block, and the default bank account and UPI
// ID printed on invoices. Read once per document; a missing logo or signature simply leaves that part out.
export async function companyLetterhead(client, organizationId, options = {}) {
  const profile = await getCompanyProfile(client, organizationId).catch(() => null);
  if (!profile) return null;
  const image = async (kind) => (await readCompanyImage(client, organizationId, kind, options).catch(() => null))?.body ?? null;
  const address = [profile.address.line1, profile.address.line2, [profile.address.city, profile.address.postalCode].filter(Boolean).join(" "), profile.address.stateName].filter(Boolean).join(", ");
  const bank = profile.bankAccounts.find((account) => account.isDefault && account.showOnDocuments) ?? profile.bankAccounts.find((account) => account.showOnDocuments) ?? null;
  return {
    name: profile.legalName || profile.name,
    lines: [address || null, [profile.gstin ? `GSTIN ${profile.gstin}` : null, profile.pan ? `PAN ${profile.pan}` : null, profile.cin ? `CIN ${profile.cin}` : null].filter(Boolean).join(" · ") || null,
      [profile.phone, profile.email, profile.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") || null].filter(Boolean),
    logo: profile.hasLogo ? await image("logo") : null,
    signature: profile.hasSignature ? await image("signature") : null,
    bankLines: bank ? [`${bank.bankName}${bank.branch ? `, ${bank.branch}` : ""}`, `${bank.accountName} · A/c ${bank.accountNumber}`, `IFSC ${bank.ifsc}`] : [],
    upiId: profile.upiId,
  };
}

// The HSN/SAC-wise tax summary of a GST document: taxable value and each tax per code, with a total row.
// The HSN/SAC summary GSTR-1 asks for: per code and GST unit (UQC), the quantity, taxable value and each tax. `uqcOf` maps a unit code to
// its UQC (unitUqcMap); without it a unit reports OTH.
export function hsnSummaryTable(lines, uqcOf = null) {
  const types = ["cgst", "sgst", "igst", "cess"].filter((type) => lines.some((line) => (line.taxes ?? []).some((tax) => tax.tax_type === type)));
  const label = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };
  const groups = new Map();
  for (const line of lines) {
    const code = line.hsn_sac_code || "—";
    const uqc = line.uqc ?? (line.uom_snapshot && uqcOf ? uqcOf.get(String(line.uom_snapshot).toUpperCase()) : null) ?? "OTH";
    const key = `${code}|${uqc}`;
    const group = groups.get(key) ?? { code, uqc, kind: line.hsn_sac_kind, quantity: 0, taxable: 0, taxes: Object.fromEntries(types.map((type) => [type, 0])) };
    group.taxable += Number(line.net_amount ?? line.taxable_amount ?? 0);
    group.quantity += line.credit_type === "amount" ? 0 : Number(line.quantity ?? 0);
    for (const tax of line.taxes ?? []) if (types.includes(tax.tax_type)) group.taxes[tax.tax_type] += Number(tax.tax_amount ?? 0);
    groups.set(key, group);
  }
  if (!groups.size || !types.length) return null;
  const rows = [...groups.values()];
  const width = `${Math.floor(56 / (types.length + 1))}%`;
  const quantity = (value) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return {
    title: "HSN/SAC summary",
    columns: [{ key: "code", label: "HSN/SAC", width: "20%" }, { key: "uqc", label: "UQC", width: "10%" }, { key: "quantity", label: "Quantity", align: "right", width: "14%" },
      { key: "taxable", label: "Taxable value", align: "right", width }, ...types.map((type) => ({ key: type, label: label[type], align: "right", width }))],
    rows: rows.map((row) => ({ code: row.code, uqc: row.uqc, quantity: row.quantity ? quantity(row.quantity) : "—", taxable: amount(row.taxable),
      ...Object.fromEntries(types.map((type) => [type, amount(row.taxes[type])])) })),
    totalRow: { code: "Total", uqc: "", quantity: "", taxable: amount(rows.reduce((total, row) => total + row.taxable, 0)),
      ...Object.fromEntries(types.map((type) => [type, amount(rows.reduce((total, row) => total + row.taxes[type], 0))])) },
  };
}

// The payment terms as the customer reads them: what the term says (its description) and anything added for this
// document. When payment is due, never where or how to pay, and never internal notes.
// "Batch B12 exp 31-03-2027" for each lot a line issued (Sales plan: FMCG documents print batch and expiry).
const batchText = (batches) => (batches ?? []).map((batch) => `Batch ${batch.batchNumber}${batch.expiresOn ? ` exp ${day(batch.expiresOn)}` : ""}`).join(", ") || null;

const paymentTermNotes = (snapshot) => {
  const text = [snapshot?.description, snapshot?.note].filter(Boolean).join("\n");
  return text ? [{ label: `Payment terms: ${snapshot.name ?? ""}`.trim(), text }] : [];
};

// A quotation as printed (also the base of its proforma invoice).
async function quotationModel(client, session, data) {
  const quote = data.quotation;
  const customer = quote.customer_snapshot || {};
  const company = await companyDetails(client, session.organizationId);
  const currency = String(quote.currency_code || "").trim();
  const status = { draft: "Draft", awaiting_approval: "Draft - awaiting approval", cancelled: "Cancelled", superseded: "Superseded", expired: "Expired" }[quote.status];
  return {
    title: "Quotation",
    documentNumber: quote.quotation_number,
    issuedAt: `Date: ${day(quote.quotation_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      // The company registration the quotation was issued from, as stored with it.
      { label: "From", lines: sellerLines(quote.seller_snapshot, company) },
      { label: "Customer", lines: [customer.displayName ?? customer.display_name ?? customer.name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null, customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
      // The person the offer is addressed to.
      { label: "Attention", lines: [[quote.contact_snapshot?.first_name, quote.contact_snapshot?.last_name].filter(Boolean).join(" "), quote.contact_snapshot?.designation, quote.contact_snapshot?.email].filter(Boolean) },
      { label: "Bill to", lines: addressLines(quote.billing_address_snapshot) },
      { label: "Ship to", lines: addressLines(quote.shipping_address_snapshot) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Quotation date", value: day(quote.quotation_date) ?? "" },
      { label: "Valid until", value: day(quote.valid_until) ?? "" },
      { label: "Your reference", value: quote.customer_reference ?? "" },
      { label: "Revision of", value: quote.revision_of_number ?? "" },
      { label: "Place of supply", value: quote.place_of_supply ? `${quote.place_of_supply_name ?? ""} (${quote.place_of_supply})`.trim() : "" },
      { label: "Payment terms", value: quote.payment_term_snapshot?.name ?? "" },
      { label: "Prices", value: quote.price_list_tax_inclusive ? "Inclusive of tax" : "Exclusive of tax" },
      { label: "Sales person", value: quote.owner_name ?? "" },
    ].filter((field) => field.value),
    table: salesLines(data.lines, currency),
    totals: salesTotals(quote, data.taxLines ?? []),
    notes: [
      ...paymentTermNotes(quote.payment_term_snapshot),
      ...(quote.customer_notes ? [{ label: "Notes", text: quote.customer_notes }] : []),
      ...(quote.terms_and_conditions ? [{ label: "Terms and conditions", text: quote.terms_and_conditions }] : []),
    ],
    footer: quote.quotation_number,
  };
}

// The proforma invoice (CRM plan 4.7): the quotation set out as a request for payment, never a tax invoice.
async function proformaModel(client, session, data) {
  const base = await quotationModel(client, session, data);
  const quote = data.quotation;
  const { number, date, advancePercent, advanceAmount } = data.proforma;
  const currency = String(quote.currency_code || "").trim();
  return {
    ...base,
    title: "Proforma invoice",
    documentNumber: number,
    issuedAt: `Date: ${day(date) ?? ""}`,
    status: "Not a tax invoice",
    fields: [
      { label: "Proforma date", value: day(date) ?? "" },
      { label: "Against quotation", value: quote.quotation_number },
      ...base.fields.filter((field) => !["Quotation date", "Revision of"].includes(field.label)),
    ],
    totals: [
      ...base.totals,
      ...(advancePercent ? [{ label: `Advance requested (${advancePercent}%) (${currency})`, value: amount(advanceAmount), emphasis: true }] : []),
    ],
    notes: [
      { label: "About this document", text: "This is a proforma invoice, not a tax invoice: it cannot be used to claim input tax credit. The tax invoice, with the GST shown here, is issued when the goods or services are supplied. The prices, taxes and terms are those of the quotation it was made from." },
      ...base.notes,
    ],
    footer: `${number} · against ${quote.quotation_number}`,
  };
}

// A CRM quote (CRM audit M1: an organization without Sales quotes from the deal): the quotation or proforma as stored, its lines with
// HSN/SAC and GST, the tax as CGST + SGST or IGST by place of supply, and an HSN summary.
async function crmQuoteModel(client, organizationId, data) {
  const { quote, lines } = data;
  const company = await companyDetails(client, organizationId);
  const currency = quote.currencyCode;
  const proforma = quote.kind === "proforma";
  const intra = !quote.placeOfSupply || quote.placeOfSupply === quote.sellerStateCode;
  const sum = (key) => lines.reduce((total, line) => total + Number(line[key] ?? 0), 0);
  const stateName = (code) => (code ? `${findIndianState({ code })?.name ?? ""} (${code})`.trim() : "");
  const hsnLines = lines.map((line) => ({ hsn_sac_code: line.hsnSac, net_amount: line.taxable, quantity: line.quantity,
    taxes: [...(intra ? [{ tax_type: "cgst", tax_amount: line.cgst }, { tax_type: "sgst", tax_amount: line.sgst }] : [{ tax_type: "igst", tax_amount: line.igst }])] }));
  return {
    title: proforma ? "Proforma invoice" : "Quotation",
    documentNumber: quote.number,
    issuedAt: `Date: ${day(quote.quoteDate) ?? ""}`,
    organizationName: company.name,
    status: proforma ? "Not a tax invoice" : { draft: "Draft", declined: "Declined" }[quote.status] ? `Status: ${{ draft: "Draft", declined: "Declined" }[quote.status]}` : null,
    parties: [
      { label: "From", lines: [company.name, company.legalName, company.taxId ? `GSTIN ${company.taxId}` : null, stateName(quote.sellerStateCode) || null].filter(Boolean) },
      { label: "Customer", lines: [quote.companyName, quote.customerGstin ? `GSTIN ${quote.customerGstin}` : null].filter(Boolean) },
      { label: "Attention", lines: [quote.contactName, quote.contactEmail].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: proforma ? "Proforma date" : "Quotation date", value: day(quote.quoteDate) ?? "" },
      { label: "Valid until", value: day(quote.validUntil) ?? "" },
      { label: "Place of supply", value: stateName(quote.placeOfSupply) },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "34%" },
        { key: "quantity", label: "Qty", align: "right", width: "9%" },
        { key: "price", label: `Price (${currency})`, align: "right", width: "13%" },
        { key: "discount", label: "Discount", align: "right", width: "9%" },
        { key: "taxable", label: "Taxable", align: "right", width: "13%" },
        { key: "tax", label: "GST", align: "right", width: "9%" },
        { key: "total", label: "Amount", align: "right", width: "13%" },
      ],
      rows: lines.map((line) => ({
        item: [line.description, line.hsnSac ? `HSN/SAC ${line.hsnSac}` : null].filter(Boolean).join(" · "),
        quantity: String(Number(line.quantity)),
        price: amount(line.unitPrice),
        discount: Number(line.discountPercent) ? `${Number(line.discountPercent)}%` : "",
        taxable: amount(line.taxable),
        tax: `${Number(line.gstRate)}%`,
        total: amount(line.lineTotal),
      })),
    },
    totals: [
      { label: "Subtotal", value: amount(Number(quote.subtotal) + Number(quote.discountTotal)) },
      ...(Number(quote.discountTotal) ? [{ label: "Discounts", value: `-${amount(quote.discountTotal)}` }, { label: "Taxable value", value: amount(quote.subtotal) }] : []),
      ...(intra ? [{ label: "CGST", value: amount(sum("cgst")) }, { label: "SGST", value: amount(sum("sgst")) }] : [{ label: "IGST", value: amount(sum("igst")) }]),
      { label: `Total (${currency})`, value: amount(quote.grandTotal), emphasis: true },
    ],
    summaryTable: hsnSummaryTable(hsnLines),
    notes: [
      ...(proforma ? [{ label: "About this document", text: "This is a proforma invoice, not a tax invoice: it cannot be used to claim input tax credit. The tax invoice is issued when the goods or services are supplied." }] : []),
      ...(quote.notes ? [{ label: "Notes", text: quote.notes }] : []),
      ...(quote.terms ? [{ label: "Terms and conditions", text: quote.terms }] : []),
    ],
    footer: quote.number,
  };
}

// The customer's PDF of a shared CRM quote (no sign-in): the share token is the credential; nothing when CRM is off.
export async function renderSharedCrmQuote(client, token) {
  const shared = await resolveSharedDealQuote(client, token);
  if (!shared) return null;
  const renderer = getDocumentRenderer("crm.quote");
  const session = { organizationId: shared.organizationId, userId: null, roleSlugs: [], permissions: [] };
  const data = await loadSharedDealQuote(client, shared.organizationId, shared.quoteId);
  const model = await decorateDocument(client, session, renderer, data, await crmQuoteModel(client, shared.organizationId, data));
  const { renderDocumentPdf, safePdfFileName } = await import("@vercentlabs/document-engine/pdf");
  return { fileName: safePdfFileName(renderer.fileName(data)), body: await renderDocumentPdf(model), quote: data.quote, lines: data.lines };
}

// The seller as printed: the registration stored on the document, else the organization.
function sellerLines(seller, company) {
  if (!seller?.name) return [company.legalName, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean);
  return [seller.legalName ?? seller.name, seller.address, seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.stateName ? `${seller.stateName}${seller.stateCode ? ` (${seller.stateCode})` : ""}` : null].filter(Boolean);
}

function salesLines(lines, currency) {
  return {
    columns: [
      { key: "item", label: "Item", width: "32%" },
      { key: "quantity", label: "Qty", align: "right", width: "10%" },
      { key: "price", label: `Price (${currency})`, align: "right", width: "13%" },
      { key: "discount", label: "Discount", align: "right", width: "9%" },
      { key: "taxable", label: "Taxable", align: "right", width: "13%" },
      { key: "tax", label: "Tax", align: "right", width: "10%" },
      { key: "total", label: "Amount", align: "right", width: "13%" },
    ],
    rows: lines.map((line) => ({
      item: [line.item_name_snapshot, line.description_snapshot && line.description_snapshot !== line.item_name_snapshot ? line.description_snapshot : null, line.hsn_sac_snapshot ? `${line.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${line.hsn_sac_snapshot}` : null].filter(Boolean).join(" · "),
      quantity: `${Number(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(),
      price: amount(line.unit_price),
      // As it was entered: a percentage, or a fixed amount.
      discount: !Number(line.discount_amount) ? "" : line.discount_type === "percent" ? `${Number(line.discount_value)}%` : amount(line.discount_amount),
      taxable: amount(line.taxable_amount),
      // The rate the line was taxed at, or why it was not.
      tax: line.tax_treatment && line.tax_treatment !== "taxable" ? String(line.tax_treatment).replace(/_/g, " ") : `${amount(line.tax_amount)} (${Number(line.tax_rate)}%)`,
      total: amount(line.line_total),
    })),
  };
}

// How the amount was arrived at: gross, line discounts, the document
// discount, the taxable value, tax (by component when given) and the total.
function salesTotals(header, taxLines = []) {
  const currency = String(header.currency_code || "").trim();
  const documentDiscount = Number(header.document_discount_amount);
  const lineDiscounts = Number(header.line_discount_total);
  return [
    { label: "Subtotal", value: amount(header.gross_total) },
    ...(lineDiscounts ? [{ label: "Line discounts", value: `-${amount(lineDiscounts)}` }] : []),
    ...(documentDiscount
      ? [{ label: header.document_discount_type === "percent" ? `Additional discount ${Number(header.document_discount_value)}%` : "Additional discount", value: `-${amount(documentDiscount)}` }]
      : []),
    ...(lineDiscounts || documentDiscount ? [{ label: "Taxable value", value: amount(header.taxable_total) }] : []),
    ...(Number(header.charge_total) ? [{ label: "Charges", value: amount(header.charge_total) }] : []),
    ...(taxLines.length
      ? taxLines.map((tax) => ({ label: `${tax.label ?? String(tax.tax_type).toUpperCase()} ${Number(tax.rate)}%`, value: amount(tax.tax_amount) }))
      : [{ label: "Tax", value: amount(header.tax_total) }]),
    ...(Number(header.rounding_adjustment) ? [{ label: "Rounding", value: amount(header.rounding_adjustment) }] : []),
    { label: `Total (${currency})`, value: amount(header.grand_total), emphasis: true },
  ];
}

// What a confirmation PDF says about its revision.
const confirmationMeta = (confirmation) => ({
  version: confirmation.version, confirmedAt: confirmation.confirmed_at, supersededAt: confirmation.superseded_at,
  cancelled: !confirmation.superseded_at && confirmation.order_status === "cancelled",
});
const confirmationFileName = (confirmation, draft) =>
  draft ? `Sales-Order-${confirmation.order_number}-draft` : `Order-Confirmation-${confirmation.order_number}${confirmation.version > 1 ? `-rev${confirmation.version}` : ""}`;

// The Order Confirmation, built only from what was confirmed (the snapshot):
// the customer, addresses, items, prices, discounts, taxes and terms as they
// were, however late it is downloaded. Internal notes, cost and margin are
// not in a snapshot and are never printed. A requested delivery date is shown
// as requested, never as a promise.
function orderConfirmationModel(snapshot, meta) {
  const order = snapshot.order;
  const company = snapshot.company ?? {};
  const customer = order.customer_snapshot || {};
  const contact = order.contact_snapshot || {};
  const status = meta.draft ? "Draft - not confirmed"
    : meta.supersededAt ? `Superseded on ${day(meta.supersededAt)}: replaced by a later revision`
      : meta.cancelled ? "The order was later cancelled" : null;
  return {
    title: meta.draft ? "Sales Order" : "Order Confirmation",
    documentNumber: order.sales_order_number,
    issuedAt: `Order date: ${day(order.order_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: sellerLines(order.seller_snapshot, { legalName: company.name, taxId: company.taxId }) },
      { label: "Customer", lines: [customer.displayName ?? customer.display_name ?? customer.name, customer.legalName && customer.legalName !== customer.displayName ? customer.legalName : null,
        customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null, customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
      { label: "Attention", lines: [[contact.first_name, contact.last_name].filter(Boolean).join(" "), contact.designation, contact.email, contact.phone ?? contact.mobile].filter(Boolean) },
      { label: "Bill to", lines: addressLines(order.billing_address_snapshot) },
      { label: "Ship to", lines: addressLines(order.shipping_address_snapshot) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Sales order", value: order.sales_order_number },
      { label: "Order date", value: day(order.order_date) ?? "" },
      { label: "Confirmation date", value: meta.confirmedAt ? day(meta.confirmedAt) ?? "" : "" },
      { label: "Revision", value: meta.version > 1 ? String(meta.version) : "" },
      { label: "Your PO reference", value: [order.customer_po_number, day(order.customer_po_date)].filter(Boolean).join(" dated ") },
      { label: "Your reference", value: order.customer_reference ?? "" },
      { label: "Our quotation", value: order.source_quotation_number ?? "" },
      { label: "Requested delivery date", value: day(order.requested_delivery_date) ?? "" },
      { label: "Place of supply", value: order.place_of_supply ? `${order.place_of_supply_name ?? ""} (${order.place_of_supply})`.trim() : "" },
      { label: "Payment terms", value: order.payment_term_snapshot?.name ?? "" },
      { label: "Delivery terms", value: order.delivery_terms ?? "" },
      { label: "Sales person", value: order.owner_name ?? "" },
    ].filter((field) => field.value),
    table: salesLines(snapshot.lines ?? [], String(order.currency_code || "").trim()),
    totals: salesTotals(order, snapshot.taxLines ?? []),
    notes: [
      ...paymentTermNotes(order.payment_term_snapshot),
      ...(order.customer_notes ? [{ label: "Notes", text: order.customer_notes }] : []),
      ...(order.terms_and_conditions ? [{ label: "Terms and conditions", text: order.terms_and_conditions }] : []),
    ],
    footer: `${order.sales_order_number}${meta.version > 1 ? ` · revision ${meta.version}` : ""}`,
  };
}

// The Purchase Order the supplier receives, built only from the confirmed
// version's snapshot (or the draft, marked as such): the buying company and
// its registration, the supplier and its GST registration, the contact and
// ordering address, bill-to and ship-to, the lines with HSN/SAC, discounts,
// taxes and totals, expected delivery, payment terms and the notes meant for
// the supplier. Internal notes are never in a snapshot and never printed.
function purchaseOrderModel(data) {
  const { order, lines = [], taxes = [], company = {} } = data.snapshot;
  const currency = String(order.currency_code || "").trim();
  const supplier = order.supplier_snapshot || {};
  const contact = order.contact_snapshot || {};
  const buyer = order.buyer_registration_snapshot;
  const supplierTax = order.supplier_tax_snapshot;
  const status = data.draft ? "Draft - not confirmed, not an order"
    : order.status === "cancelled" ? "Cancelled" : data.superseded ? "Superseded by a later revision" : null;
  const taxLines = [];
  for (const tax of taxes) {
    const existing = taxLines.find((entry) => entry.tax_type === tax.tax_type && Number(entry.rate) === Number(tax.rate));
    if (existing) existing.tax_amount = Number(existing.tax_amount) + Number(tax.tax_amount);
    else taxLines.push({ tax_type: tax.tax_type, label: tax.label, rate: tax.rate, tax_amount: Number(tax.tax_amount) });
  }
  const shipTo = order.ship_to_snapshot ? [order.ship_to_snapshot.name, ...addressLines(order.ship_to_snapshot)].filter(Boolean)
    : order.bill_to_snapshot ? [order.bill_to_snapshot.name, order.bill_to_snapshot.line1].filter(Boolean) : [];
  return {
    title: "Purchase Order",
    documentNumber: order.purchase_order_number,
    issuedAt: `Order date: ${day(order.order_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "Buyer", lines: sellerLines(buyer, { legalName: company.name, taxId: company.taxId }) },
      { label: "Supplier", lines: [supplier.legalName ?? supplier.supplierName, supplier.supplierNumber ? `Supplier no. ${supplier.supplierNumber}` : null,
        supplierTax?.gstin ? `GSTIN ${supplierTax.gstin}` : supplier.gstin ? `GSTIN ${supplier.gstin}` : null, ...addressLines(order.ordering_address_snapshot)].filter(Boolean) },
      { label: "Attention", lines: [contact.name, contact.designation, contact.email, contact.phone].filter(Boolean) },
      { label: "Ship to", lines: shipTo },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Purchase order", value: order.purchase_order_number },
      { label: "Order date", value: day(order.order_date) ?? "" },
      { label: "Revision", value: data.version > 1 ? String(data.version) : "" },
      { label: "Your quotation", value: order.supplier_quotation_reference ?? "" },
      { label: "Your reference", value: order.supplier_reference ?? "" },
      { label: "Expected delivery", value: day(order.expected_delivery_date) ?? "" },
      { label: "Payment terms", value: order.payment_term_snapshot?.name ?? "" },
      { label: "Prices", value: order.price_mode === "inclusive" ? "Inclusive of tax" : "Exclusive of tax" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "30%" },
        { key: "quantity", label: "Qty", align: "right", width: "10%" },
        { key: "price", label: `Rate (${currency})`, align: "right", width: "12%" },
        { key: "discount", label: "Discount", align: "right", width: "10%" },
        { key: "taxable", label: "Taxable", align: "right", width: "13%" },
        { key: "tax", label: "Tax", align: "right", width: "12%" },
        { key: "total", label: "Amount", align: "right", width: "13%" },
      ],
      rows: lines.map((line) => ({
        item: [line.product_snapshot?.code, line.description, line.hsn_sac_code ? `${line.product_type === "service" ? "SAC" : "HSN"} ${line.hsn_sac_code}` : null,
          line.expected_delivery_date ? `Due ${day(line.expected_delivery_date)}` : null].filter(Boolean).join(" · "),
        quantity: `${Number(line.ordered_quantity)} ${line.uom_snapshot?.code ?? ""}`.trim(),
        price: amount(line.unit_price),
        discount: Number(line.line_discount) + Number(line.allocated_document_discount) ? amount(Number(line.line_discount) + Number(line.allocated_document_discount)) : "",
        taxable: amount(line.taxable_amount),
        tax: line.tax_treatment && line.tax_treatment !== "taxable" ? String(line.tax_treatment).replace(/_/g, " ") : `${amount(line.tax_total)} (${Number(line.tax_rate)}%)`,
        total: amount(line.line_total),
      })),
    },
    totals: [
      { label: "Subtotal", value: amount(order.gross_total) },
      ...(Number(order.line_discount_total) ? [{ label: "Line discounts", value: `-${amount(order.line_discount_total)}` }] : []),
      ...(Number(order.document_discount_amount) ? [{ label: "Order discount", value: `-${amount(order.document_discount_amount)}` }] : []),
      { label: "Taxable value", value: amount(order.taxable_total) },
      ...(taxLines.length ? taxLines.map((tax) => ({ label: `${tax.label} ${Number(tax.rate)}%`, value: amount(tax.tax_amount) })) : [{ label: "Tax", value: amount(order.tax_total) }]),
      { label: `Total (${currency})`, value: amount(order.grand_total), emphasis: true },
    ],
    notes: [
      ...paymentTermNotes(order.payment_term_snapshot),
      ...(order.supplier_notes ? [{ label: "Notes", text: order.supplier_notes }] : []),
    ],
    footer: `${order.purchase_order_number}${data.version > 1 ? ` · revision ${data.version}` : ""}`,
  };
}

// The Goods Receipt Note: what was physically received against the purchase
// order, line by line — accepted, held for inspection, damaged and refused —
// with the supplier's challan. No prices: it records custody, not value.
// Return Note: the dispatch document for goods returned to the supplier — from the return's own snapshots. Internal notes are never printed;
// it is not a GST credit note (Finance's debit note and the supplier's credit note are).
function purchaseReturnModel(data, company) {
  const { purchaseReturn: ret, lines } = data;
  const q = (value) => Number(value ?? 0).toString();
  const status = { draft: "Draft - not dispatched", cancelled: "Cancelled", reversed: `Reversed${ret.reversalReason ? `: ${ret.reversalReason}` : ""}` }[ret.status];
  return {
    title: "Purchase Return Note",
    documentNumber: ret.returnNumber,
    issuedAt: `Return date: ${day(ret.returnDate) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: [company.name, ret.warehouseName && `Warehouse: ${ret.warehouseName}`].filter(Boolean) },
      { label: "Return to (supplier)", lines: [ret.supplier?.legalName ?? ret.supplierName, ret.supplier?.gstin ? `GSTIN ${ret.supplier.gstin}` : null, ...addressLines(ret.returnTo)].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Purchase order", value: ret.purchaseOrderNumber },
      { label: "Goods receipts", value: [...new Set(lines.map((line) => line.receiptNumber))].join(", ") },
      { label: "Supplier RMA", value: ret.supplierRmaReference ?? "" },
      { label: "Carrier", value: [ret.carrierReference, ret.trackingReference && `Tracking ${ret.trackingReference}`].filter(Boolean).join(" · ") },
      { label: "Challan / dispatch ref", value: ret.dispatchReference ?? "" },
      { label: "Dispatched", value: ret.dispatchedAt ? date(ret.dispatchedAt) : "" },
      { label: "Prepared by", value: ret.createdByName ?? "" },
      { label: "Posted by", value: ret.postedByName ?? "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "46%" },
        { key: "source", label: "Received on", width: "18%" },
        { key: "quantity", label: "Returned", align: "right", width: "14%" },
        { key: "reason", label: "Reason", width: "22%" },
      ],
      rows: lines.map((line) => ({
        item: [line.product?.code, line.description, line.batchNumber && `Lot ${line.batchNumber}`, line.expiryDate && `Exp ${day(line.expiryDate)}`,
          line.serialNumbers?.length ? `S/N ${line.serialNumbers.join(", ")}` : null].filter(Boolean).join(" · "),
        source: `${line.receiptNumber} / line ${line.receiptLineNumber}`, quantity: `${q(line.quantity)} ${line.uom?.code ?? ""}`.trim(),
        reason: [line.reasonLabel, line.reasonNotes].filter(Boolean).join(": "),
      })),
    },
    totals: [],
    notes: [{ label: "Note", text: "This return note documents goods dispatched back to the supplier. It is not a GST credit or debit note." }],
  };
}

function goodsReceiptModel(data, company) {
  const { receipt, lines } = data;
  const q = (value) => Number(value ?? 0).toString();
  const status = { draft: "Draft - not posted", cancelled: "Cancelled", reversed: `Reversed${receipt.reversalReason ? `: ${receipt.reversalReason}` : ""}` }[receipt.status];
  return {
    title: "Goods Receipt Note",
    documentNumber: receipt.receiptNumber,
    issuedAt: `Received: ${day(receipt.receiptDate) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "Receiving company", lines: [receipt.company?.legalName ?? receipt.company?.name ?? company.name, receipt.company?.gstin ? `GSTIN ${receipt.company.gstin}` : null,
        receipt.warehouseName && `Warehouse: ${receipt.warehouseName}`].filter(Boolean) },
      { label: "Supplier", lines: [receipt.supplierName, ...addressLines(receipt.shipFrom)].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Purchase order", value: receipt.purchaseOrderNumber },
      { label: "Supplier challan", value: [receipt.supplierChallanNumber, day(receipt.supplierChallanDate)].filter(Boolean).join(" dated ") },
      { label: "Receipt date", value: day(receipt.receiptDate) ?? "" },
      { label: "Goods arrived", value: receipt.physicalReceivedAt ? date(receipt.physicalReceivedAt) : "" },
      { label: "Received by", value: receipt.receivedByName ?? "" },
      { label: "Vehicle", value: receipt.vehicleNumber ?? "" },
      { label: "Carrier", value: [receipt.carrierName, receipt.trackingReference && `Ref ${receipt.trackingReference}`].filter(Boolean).join(" · ") },
      { label: "Posted", value: receipt.postedAt ? `${date(receipt.postedAt)}${receipt.postedByName ? ` by ${receipt.postedByName}` : ""}` : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "34%" },
        { key: "received", label: "Received", align: "right", width: "13%" },
        { key: "accepted", label: "Accepted", align: "right", width: "13%" },
        { key: "hold", label: "On hold", align: "right", width: "13%" },
        { key: "damaged", label: "Damaged", align: "right", width: "13%" },
        { key: "refused", label: "Refused", align: "right", width: "14%" },
      ],
      rows: lines.map((line) => ({
        item: [`PO line ${line.orderLineNumber}`, line.product?.code, line.description, line.batchNumber && `Lot ${line.batchNumber}`, line.manufacturedDate && `Mfd ${day(line.manufacturedDate)}`,
          line.expiryDate && `Exp ${day(line.expiryDate)}`, line.serialNumbers?.length ? `S/N ${line.serialNumbers.join(", ")}` : null].filter(Boolean).join(" · "),
        received: `${q(line.receivedQuantity)} ${line.uom?.code ?? ""}`.trim(), accepted: q(line.acceptedQuantity), hold: q(line.inspectionQuantity), damaged: q(line.damagedQuantity),
        refused: q(line.refusedQuantity),
      })),
    },
    totals: [],
    notes: [
      ...data.discrepancies.map((entry) => ({ label: `${entry.label}${entry.lineNumber ? ` (line ${entry.lineNumber})` : ""}${entry.quantity ? ` × ${q(entry.quantity)}` : ""}`, text: entry.notes })),
      ...(receipt.notes ? [{ label: "Receiving notes", text: receipt.notes }] : []),
    ],
    footer: receipt.receiptNumber,
  };
}

// The internal purchase voucher of a supplier bill: Vercentlabs' accounting record of the supplier's claim, from the bill as
// posted (its snapshots). It is never the supplier's tax invoice: that is the original attached to the bill.
function supplierBillModel(data, company) {
  const { bill, lines } = data;
  const m = (value) => (value === null || value === undefined ? "" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const q = (value) => Number(value ?? 0).toString();
  const status = { draft: "Draft - not posted", awaiting_approval: "Awaiting approval - not posted", cancelled: "Cancelled", reversed: `Reversed${bill.reversalReason ? `: ${bill.reversalReason}` : ""}` }[bill.documentStatus];
  return {
    title: "Purchase Voucher (internal record — not the supplier's tax invoice)",
    documentNumber: bill.billNumber,
    issuedAt: `Posting date: ${day(bill.postingDate) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "Supplier", lines: [bill.supplier?.legalName ?? bill.supplierName, bill.supplierTaxRegistration?.gstin ? `GSTIN ${bill.supplierTaxRegistration.gstin}` : bill.supplier?.gstin ? `GSTIN ${bill.supplier.gstin}` : null,
        ...addressLines(bill.supplierAddress)].filter(Boolean) },
      { label: "Buying company", lines: [bill.buyingRegistration?.legalName ?? bill.buyingRegistration?.name ?? company.name, bill.buyingRegistration?.gstin ? `GSTIN ${bill.buyingRegistration.gstin}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Supplier invoice", value: [bill.supplierInvoiceNumber, day(bill.supplierInvoiceDate)].filter(Boolean).join(" dated ") },
      { label: "Purchase order", value: bill.purchaseOrderNumber ?? (bill.sourceType === "direct" ? "Direct expense" : "") },
      { label: "Due date", value: day(bill.dueDate) ?? "" },
      { label: "Place of supply", value: bill.placeOfSupply ?? "" },
      { label: "Currency", value: bill.currencyCode === bill.baseCurrencyCode ? bill.currencyCode : `${bill.currencyCode} @ ${bill.exchangeRate}` },
      { label: "Reverse charge", value: bill.reverseCharge ? "Yes" : "" },
      { label: "Posted", value: bill.postedAt ? `${date(bill.postedAt)}${bill.postedByName ? ` by ${bill.postedByName}` : ""}` : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "36%" }, { key: "quantity", label: "Qty", align: "right", width: "10%" }, { key: "price", label: "Rate", align: "right", width: "12%" },
        { key: "taxable", label: "Taxable", align: "right", width: "14%" }, { key: "tax", label: "Tax", align: "right", width: "14%" }, { key: "total", label: "Total", align: "right", width: "14%" },
      ],
      rows: lines.map((line) => ({
        item: [line.description, line.hsnSacCode && `HSN/SAC ${line.hsnSacCode}`, line.taxes.map((tax) => `${tax.label} ${Number(tax.rate)}%${tax.classification === "reverse_charge" ? " (RCM)" : ""}`).join(", ")].filter(Boolean).join(" · "),
        quantity: `${q(line.quantity)} ${line.uom?.code ?? ""}`.trim(), price: m(line.unitPrice), taxable: m(line.taxableAmount), tax: m(line.taxAmount), total: m(line.lineTotal),
      })),
    },
    totals: [
      { label: "Taxable value", value: m(bill.taxableTotal) }, { label: "Tax", value: m(bill.taxTotal) },
      ...(Number(bill.reverseChargeTaxTotal) > 0 ? [{ label: "Reverse-charge tax (self-assessed, not payable to supplier)", value: m(bill.reverseChargeTaxTotal) }] : []),
      { label: "Invoice total", value: m(bill.invoiceTotal) },
      ...(Number(bill.withholdingTotal) > 0 ? [{ label: `TDS withheld${bill.withholdingSection ? ` (${bill.withholdingSection.code})` : ""}`, value: `- ${m(bill.withholdingTotal)}` }] : []),
      ...(Number(bill.roundingAdjustment) !== 0 ? [{ label: "Rounding", value: m(bill.roundingAdjustment) }] : []),
      { label: "Net payable", value: m(bill.netPayable) },
    ],
    notes: [
      ...(bill.notes ? [{ label: "Notes", text: bill.notes }] : []),
      { label: "This voucher", text: "An internal accounting record. The supplier's original tax invoice is the document attached to this bill." },
    ],
    footer: bill.billNumber,
  };
}

// Debit Note to Supplier: the buyer's commercial claim as issued — what is claimed, on which bills, and why. It is a claim, not a tax document:
// it changes neither the payable nor input tax (the supplier's credit note, recorded as a vendor credit, does).
function debitClaimModel(data, company) {
  const { claim, lines, responses } = data;
  const m = (value) => (value === null || value === undefined ? "" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const status = { draft: "Draft - not issued", closed: `Closed${claim.closeReason ? `: ${claim.closeReason}` : ""}` }[claim.status];
  const latest = responses[responses.length - 1];
  return {
    title: "Debit Note to Supplier",
    documentNumber: claim.claimNumber,
    issuedAt: `Issue date: ${day(claim.issueDate) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: [company.name, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "To (supplier)", lines: [claim.supplier?.legalName ?? claim.supplierName, claim.supplier?.gstin ? `GSTIN ${claim.supplier.gstin}` : null,
        claim.supplier?.supplierNumber ? `Supplier no. ${claim.supplier.supplierNumber}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Reason", value: claim.reason },
      { label: "Bills", value: [...new Set(lines.map((line) => line.billNumber).filter(Boolean))].join(", ") },
      { label: "Supplier reference", value: claim.supplierReference ?? "" },
      { label: "Currency", value: claim.currencyCode },
      { label: "Supplier response", value: latest ? `${latest.decision.replace("_", " ")}${latest.respondedOn ? ` on ${day(latest.respondedOn)}` : ""}` : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Claimed for", width: "46%" }, { key: "source", label: "Bill / line", width: "16%" }, { key: "amount", label: "Amount", align: "right", width: "13%" },
        { key: "tax", label: "Tax (est.)", align: "right", width: "12%" }, { key: "total", label: "Total", align: "right", width: "13%" },
      ],
      rows: lines.map((line) => ({
        item: [line.description, line.reasonLabel, line.basis === "quantity" ? `${Number(line.quantity)} × ${m(line.unitValue)}` : null].filter(Boolean).join(" · "),
        source: line.billNumber ? `${line.billNumber}${line.billLineSequence ? ` / ${line.billLineSequence}` : ""}` : "", amount: m(line.amount), tax: m(line.taxAmount), total: m(line.total),
      })),
    },
    totals: [
      { label: "Amount claimed", value: m(claim.claimedAmount) },
      ...(Number(claim.acceptedAmount) > 0 ? [{ label: "Accepted by supplier", value: m(claim.acceptedAmount) }] : []),
      ...(Number(claim.disputedAmount) > 0 ? [{ label: "Disputed / rejected", value: m(claim.disputedAmount) }] : []),
    ],
    notes: [
      ...(claim.notes ? [{ label: "Notes", text: claim.notes }] : []),
      { label: "This document", text: "A commercial claim to the supplier. Please issue your credit note for the amount accepted; it does not by itself change any amount payable or tax." },
    ],
    footer: claim.claimNumber,
  };
}

// Vendor Credit Voucher: the internal accounting record of a supplier's credit as posted — what it credits, its tax treatment, and how it was
// settled (applied to bills, refunded). It is not the supplier's credit note: that is the document attached to the credit.
function vendorCreditModel(data, company) {
  const { credit, lines, allocations, refunds } = data;
  const m = (value) => (value === null || value === undefined ? "" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const status = { draft: "Draft - not posted", awaiting_approval: "Awaiting approval - not posted", cancelled: "Cancelled", reversed: `Reversed${credit.reversalReason ? `: ${credit.reversalReason}` : ""}` }[credit.status];
  return {
    title: "Vendor Credit Voucher (internal record)",
    documentNumber: credit.number,
    issuedAt: `Posting date: ${day(credit.postingDate) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "Supplier", lines: [credit.supplier?.legalName ?? credit.supplierName, credit.supplierTax?.gstin ? `GSTIN ${credit.supplierTax.gstin}` : credit.supplier?.gstin ? `GSTIN ${credit.supplier.gstin}` : null].filter(Boolean) },
      { label: "Buying company", lines: [credit.buyingRegistration?.legalName ?? credit.buyingRegistration?.name ?? company.name, credit.buyingRegistration?.gstin ? `GSTIN ${credit.buyingRegistration.gstin}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Origin", value: credit.originLabel },
      { label: "Supplier credit note", value: [credit.supplierCreditNoteNumber, day(credit.supplierCreditNoteDate)].filter(Boolean).join(" dated ") },
      { label: "Debit note", value: credit.claim?.number ?? "" },
      { label: "Bills corrected", value: [...new Set(lines.map((line) => line.billNumber).filter(Boolean))].join(", ") },
      { label: "Returns", value: [...new Set(lines.map((line) => line.returnNumber).filter(Boolean))].join(", ") },
      { label: "Tax treatment", value: credit.taxTreatmentLabel },
      { label: "Reason", value: credit.reason ?? "" },
      { label: "Authorised basis", value: credit.authorizationReason ?? "" },
      { label: "Currency", value: credit.currencyCode },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Credited", width: "40%" }, { key: "source", label: "Bill / line", width: "14%" }, { key: "quantity", label: "Qty", align: "right", width: "8%" },
        { key: "taxable", label: "Taxable", align: "right", width: "13%" }, { key: "tax", label: "Tax", align: "right", width: "12%" }, { key: "total", label: "Total", align: "right", width: "13%" },
      ],
      rows: lines.map((line) => ({
        item: [line.description, line.reasonLabel, line.components.map((tax) => `${tax.label} ${Number(tax.rate)}%`).join(", ")].filter(Boolean).join(" · "),
        source: line.billNumber ? `${line.billNumber} / ${line.billLineSequence}` : "On account", quantity: line.basis === "quantity" ? Number(line.quantity).toString() : "",
        taxable: m(line.taxable), tax: m(line.tax), total: m(line.total),
      })),
    },
    totals: [
      { label: "Taxable value", value: m(credit.taxable) }, { label: "Tax", value: m(credit.tax) },
      ...(Number(credit.withholding) > 0 ? [{ label: "TDS adjusted", value: `- ${m(credit.withholding)}` }] : []),
      { label: "Credit to supplier account", value: m(credit.total) },
      ...(Number(credit.applied) > 0 ? [{ label: "Applied to bills", value: m(credit.applied) }] : []),
      ...(Number(credit.refunded) > 0 ? [{ label: "Refunded by supplier", value: m(credit.refunded) }] : []),
      ...(credit.status === "posted" ? [{ label: "Unapplied balance", value: m(credit.available) }] : []),
    ],
    notes: [
      ...allocations.map((entry) => ({ label: `Applied to ${entry.billNumber}`, text: m(entry.amount) })),
      ...refunds.map((entry) => ({ label: `Refund ${entry.refundNumber}${entry.status === "reversed" ? " (reversed)" : ""}`, text: `${m(entry.amount)} on ${day(entry.date)} · ${entry.reference ?? ""}` })),
      { label: "This voucher", text: "An internal accounting record. The supplier's credit note is the document attached to this credit." },
    ],
    footer: credit.number,
  };
}

// The Delivery Note: what left, to whom and how, from the delivery as stored.
// Unit prices only when Sales settings ask for them, and never tax or
// totals. Internal notes are never printed. The receiver signs the printout.
function deliveryNoteModel(data) {
  const { delivery, company } = data;
  const customer = delivery.customer_snapshot || {};
  const contact = delivery.contact_snapshot || {};
  const status = { draft: "Draft - not dispatched", ready: "Ready to dispatch - not dispatched" }[delivery.delivery_status];
  const quantity = (value) => Number(value).toString();
  return {
    title: "Delivery Note",
    documentNumber: delivery.request_number,
    issuedAt: `Dispatch date: ${day(delivery.dispatch_date) ?? "Not dispatched"}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: [company.name, delivery.warehouse_name ? `Dispatched from ${delivery.warehouse_name}` : null, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Customer", lines: [customer.displayName ?? customer.display_name ?? customer.name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null,
        customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
      { label: "Ship to", lines: [delivery.shipping_address_snapshot?.label, ...addressLines(delivery.shipping_address_snapshot)].filter(Boolean) },
      { label: "Contact", lines: [[contact.first_name, contact.last_name].filter(Boolean).join(" "), contact.phone ?? contact.mobile, contact.email].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Delivery no.", value: delivery.request_number },
      { label: "Sales order", value: delivery.sales_order_number ?? "" },
      { label: "Your PO reference", value: delivery.customer_po_number ?? "" },
      { label: "Dispatch date", value: day(delivery.dispatch_date) ?? "" },
      { label: "Expected delivery", value: day(delivery.expected_delivery_date) ?? "" },
      { label: "Carrier", value: delivery.carrier ?? "" },
      { label: "Tracking no.", value: delivery.tracking_number ?? "" },
      { label: "Vehicle", value: delivery.vehicle_reference ?? "" },
      { label: "Packages", value: delivery.package_count != null ? String(delivery.package_count) : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "number", label: "#", width: "5%" },
        { key: "code", label: "Code", width: "14%" },
        { key: "item", label: "Item", width: data.showPrices ? "41%" : "56%" },
        { key: "ordered", label: "Ordered", align: "right", width: "12%" },
        { key: "quantity", label: "Delivered", align: "right", width: "13%" },
        ...(data.showPrices ? [{ key: "price", label: `Unit price${data.currency ? ` (${data.currency})` : ""}`, align: "right", width: "15%" }] : []),
      ],
      rows: data.lines.map((line, index) => ({
        number: index + 1,
        code: line.item_code_snapshot ?? "",
        item: [line.item_name_snapshot, line.description_snapshot && line.description_snapshot !== line.item_name_snapshot ? line.description_snapshot : null, batchText(line.batches)].filter(Boolean).join(" · "),
        ordered: line.ordered_quantity != null ? `${quantity(line.ordered_quantity)} ${line.uom_snapshot ?? ""}`.trim() : "",
        quantity: `${quantity(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(),
        ...(data.showPrices ? { price: line.unit_price != null ? amount(line.unit_price) : "" } : {}),
      })),
    },
    totals: [{ label: "Total quantity", value: quantity(delivery.total_quantity ?? 0) }],
    notes: [
      ...(delivery.delivery_instructions ? [{ label: "Delivery instructions", text: delivery.delivery_instructions }] : []),
      ...(delivery.package_notes ? [{ label: "Packages", text: delivery.package_notes }] : []),
      { label: "Received in good condition", text: "Name: ______________________   Signature: ______________________   Date: ______________   Company stamp" },
    ],
    footer: `${delivery.request_number} · ${delivery.sales_order_number ?? ""}`,
  };
}

// The GST delivery challan (rule 55 of the CGST Rules; Shared Platform plan 4): goods moved without a tax invoice yet — sent before
// the invoice, on approval, or for job work. It names the consignor and consignee with their GSTINs, the place of delivery, each item
// with its quantity and value, and the transport details, in three copies (consignee, transporter, consignor).
function deliveryChallanModel(data) {
  const base = deliveryNoteModel({ ...data, showPrices: true });
  const { delivery, company } = data;
  const customer = delivery.customer_snapshot || {};
  const ship = delivery.shipping_address_snapshot || {};
  const value = data.lines.reduce((total, line) => total + Number(line.quantity) * Number(line.unit_price ?? 0), 0);
  return {
    ...base,
    title: "Delivery Challan",
    issuedAt: `Challan date: ${day(delivery.dispatch_date) ?? day(new Date()) ?? ""}`,
    parties: [
      { label: "Consignor", lines: [company.name, delivery.warehouse_name ? `Dispatched from ${delivery.warehouse_name}` : null, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Consignee", lines: [customer.legalName ?? customer.displayName ?? customer.display_name ?? customer.name, ...addressLines(ship), customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered"].filter(Boolean) },
    ],
    fields: [
      { label: "Challan no.", value: delivery.request_number },
      { label: "Reason for transport", value: delivery.challan_reason ?? "Supply — tax invoice to follow" },
      { label: "Place of delivery", value: [ship.city, ship.state].filter(Boolean).join(", ") },
      { label: "Sales order", value: delivery.sales_order_number ?? "" },
      { label: "Vehicle", value: delivery.vehicle_reference ?? "" },
      { label: "Transporter", value: delivery.carrier ?? "" },
      { label: "LR / tracking no.", value: delivery.tracking_number ?? "" },
      { label: "Packages", value: delivery.package_count != null ? String(delivery.package_count) : "" },
    ].filter((field) => field.value),
    totals: [...base.totals, { label: `Value of goods${data.currency ? ` (${data.currency})` : ""}`, value: amount(value), emphasis: true }],
    notes: base.notes.filter((note) => note.label !== "Received in good condition"),
    declaration: "Certified that the particulars given above are true and correct. The goods are not being supplied against this challan; a tax invoice will follow where the movement is a supply.",
    footer: `Delivery challan ${delivery.request_number}`,
  };
}

// A delivery challan without Stock (Sales audit): consignor, consignee, why the goods move, the goods with HSN and value, the vehicle.
function salesChallanModel(data) {
  const { challan, company } = data;
  const customer = challan.customer ?? {};
  const ship = challan.shipTo ?? {};
  const own = challan.purpose === "branch_transfer";
  return {
    title: "Delivery Challan",
    documentNumber: challan.challanNumber,
    issuedAt: `Challan date: ${challan.challanDate ?? ""}`,
    organizationName: company.name,
    status: challan.status === "draft" ? "Status: Draft - not issued" : challan.status === "cancelled" ? `Status: Cancelled${challan.cancelReason ? `: ${challan.cancelReason}` : ""}` : null,
    parties: [
      { label: "Consignor", lines: [company.name, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Consignee", lines: own ? [company.name, ...addressLines(ship), "Own branch"].filter(Boolean)
        : [customer.legalName ?? customer.displayName, ...addressLines(ship), customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered"].filter(Boolean) },
    ],
    fields: [
      { label: "Challan no.", value: challan.challanNumber },
      { label: "Reason for transport", value: challan.purposeLabel },
      { label: "Sales order", value: challan.salesOrderNumber ?? "" },
      { label: "Place of delivery", value: [ship.city, ship.state].filter(Boolean).join(", ") },
      { label: "Vehicle", value: challan.vehicleNumber ?? "" },
      { label: "Transporter", value: challan.transporterName ?? "" },
      { label: "LR no.", value: challan.lrNumber ?? "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Goods", width: "46%" }, { key: "hsn", label: "HSN", width: "12%" }, { key: "quantity", label: "Qty", align: "right", width: "14%" },
        { key: "rate", label: "Value / unit", align: "right", width: "14%" }, { key: "value", label: "Value", align: "right", width: "14%" },
      ],
      rows: challan.lines.map((line) => ({ item: line.description, hsn: line.hsnSacCode ?? "", quantity: `${line.quantity} ${line.unit ?? ""}`.trim(), rate: amount(line.unitValue), value: amount(line.value) })),
    },
    totals: [{ label: "Value of goods", value: amount(challan.totalValue), emphasis: true }],
    notes: challan.notes ? [{ label: "Notes", text: challan.notes }] : [],
    declaration: "Certified that the particulars given above are true and correct. The goods are not being supplied against this challan unless a tax invoice follows.",
    footer: `Delivery challan ${challan.challanNumber}`,
  };
}

// The (Tax) Invoice, from the invoice's own snapshots: the seller registration,
// the customer and addresses as invoiced, the place of supply, each line with
// its HSN/SAC and tax components, and the totals. Internal notes are never printed.
function salesInvoiceModel(data, uqcOf = null) {
  const { invoice, lines, taxSummary, company } = data;
  const currency = invoice.currency_code;
  const customer = invoice.sales_customer_snapshot || invoice.customer_snapshot || {};
  const contact = invoice.contact_snapshot || {};
  const seller = invoice.seller_snapshot || {};
  const taxed = lines.some((line) => line.taxes.some((tax) => Number(tax.tax_amount) > 0));
  const types = ["cgst", "sgst", "igst", "cess"].filter((type) => lines.some((line) => line.taxes.some((tax) => tax.tax_type === type)));
  const status = { draft: "Draft - not posted", reversed: `Reversed${invoice.reversal_reason ? `: ${invoice.reversal_reason}` : ""}` }[invoice.status];
  const gross = lines.reduce((total, line) => total + Number(line.gross_amount ?? Number(line.quantity) * Number(line.unit_price)), 0);
  const discount = lines.reduce((total, line) => total + Number(line.discount_amount), 0);
  const taxable = lines.reduce((total, line) => total + Number(line.net_amount), 0);
  const label = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };
  // Indian FMCG invoices print the MRP of each unit (Sales audit, should-have).
  const withMrp = lines.some((line) => Number(line.mrp) > 0);
  return {
    title: taxed || seller.gstin ? "Tax Invoice" : "Invoice",
    documentNumber: invoice.invoice_number,
    issuedAt: `Invoice date: ${day(invoice.invoice_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: sellerLines(seller, { legalName: company.name, taxId: company.taxId }) },
      { label: "Bill to", lines: [customer.legalName ?? customer.displayName ?? customer.display_name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null,
        ...addressLines(invoice.billing_address_snapshot), customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
      { label: "Ship to", lines: [invoice.shipping_address_snapshot?.label, ...addressLines(invoice.shipping_address_snapshot)].filter(Boolean) },
      { label: "Contact", lines: [[contact.first_name, contact.last_name].filter(Boolean).join(" "), contact.email, contact.phone ?? contact.mobile].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Invoice no.", value: invoice.invoice_number },
      { label: "Invoice date", value: day(invoice.invoice_date) ?? "" },
      { label: "Due date", value: day(invoice.due_date) ?? "" },
      { label: "Sales order", value: invoice.sales_order_number ?? "" },
      { label: "Delivery", value: data.deliveries.map((delivery) => delivery.delivery_number).join(", ") },
      { label: "Your PO reference", value: invoice.customer_po_number ?? "" },
      { label: "Place of supply", value: invoice.place_of_supply ? `${invoice.place_of_supply_name ?? ""} (${invoice.place_of_supply})`.trim() : "" },
      { label: "Payment terms", value: invoice.payment_term_snapshot?.name ?? "" },
      { label: "IRN", value: invoice.e_invoice_reference ?? "" },
      { label: "Tax payable on reverse charge", value: taxed || seller.gstin ? (invoice.reverse_charge ? "Yes" : "No") : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: types.length > 2 ? (withMrp ? "18%" : "24%") : (withMrp ? "23%" : "30%") },
        { key: "quantity", label: "Qty", align: "right", width: "9%" },
        ...(withMrp ? [{ key: "mrp", label: "MRP", align: "right", width: "8%" }] : []),
        { key: "price", label: `Rate (${currency})`, align: "right", width: "11%" },
        { key: "discount", label: "Discount", align: "right", width: "9%" },
        { key: "taxable", label: "Taxable", align: "right", width: "12%" },
        ...types.map((type) => ({ key: type, label: label[type], align: "right", width: "10%" })),
        { key: "total", label: "Amount", align: "right", width: "12%" },
      ],
      rows: lines.map((line) => ({
        item: [line.item_name_snapshot, line.description_snapshot && line.description_snapshot !== line.item_name_snapshot ? line.description_snapshot : null,
          line.hsn_sac_code ? `${line.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${line.hsn_sac_code}` : null, batchText(line.batches)].filter(Boolean).join(" · "),
        quantity: `${Number(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(),
        ...(withMrp ? { mrp: Number(line.mrp) > 0 ? amount(line.mrp) : "" } : {}),
        price: amount(line.unit_price),
        discount: Number(line.discount_amount) ? amount(line.discount_amount) : "",
        taxable: amount(line.net_amount),
        ...Object.fromEntries(types.map((type) => {
          const tax = line.taxes.find((component) => component.tax_type === type);
          return [type, tax ? `${amount(tax.tax_amount)} (${Number(tax.rate)}%)` : ""];
        })),
        total: amount(line.line_total),
      })),
    },
    totals: [
      { label: "Subtotal", value: amount(gross) },
      ...(discount ? [{ label: "Discounts", value: `-${amount(discount)}` }] : []),
      { label: "Taxable value", value: amount(taxable) },
      ...taxSummary.map((tax) => ({ label: `${label[tax.taxType] ?? tax.label ?? tax.taxType} ${tax.rate}%`, value: amount(tax.taxAmount) })),
      ...(Number(invoice.rounding_adjustment) ? [{ label: "Round off", value: amount(invoice.rounding_adjustment) }] : []),
      { label: `Total (${currency})`, value: amount(invoice.grand_total), emphasis: true },
    ],
    notes: [
      ...paymentTermNotes(invoice.payment_term_snapshot),
      ...(invoice.customer_notes ? [{ label: "Notes", text: invoice.customer_notes }] : []),
      ...(invoice.terms_and_conditions ? [{ label: "Terms and conditions", text: invoice.terms_and_conditions }] : []),
    ],
    summaryTable: taxed ? hsnSummaryTable(lines, uqcOf) : null,
    footer: `${invoice.invoice_number}${invoice.sales_order_number ? ` · ${invoice.sales_order_number}` : ""}`,
  };
}

// The Credit Note: titled CREDIT NOTE, naming the original invoice (number and
// date), the reason, the lines credited with HSN/SAC and their tax components,
// and the totals, all from the credit note's own snapshots. Never internal
// notes, never how the credit was applied.
function creditNoteModel(data, uqcOf = null) {
  const { creditNote, lines, taxSummary, company } = data;
  const currency = creditNote.currency_code;
  const customer = creditNote.sales_customer_snapshot || creditNote.customer_snapshot || {};
  const contact = creditNote.contact_snapshot || {};
  const seller = creditNote.seller_snapshot || {};
  const types = ["cgst", "sgst", "igst", "cess"].filter((type) => lines.some((line) => line.taxes.some((tax) => tax.tax_type === type)));
  const status = { draft: "Draft - not posted", reversed: `Reversed${creditNote.reversal_reason ? `: ${creditNote.reversal_reason}` : ""}` }[creditNote.status];
  const gross = lines.reduce((total, line) => total + Number(line.gross_amount ?? Number(line.quantity) * Number(line.unit_price)), 0);
  const discount = lines.reduce((total, line) => total + Number(line.discount_amount), 0);
  const taxable = lines.reduce((total, line) => total + Number(line.net_amount), 0);
  const label = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };
  return {
    title: "CREDIT NOTE",
    documentNumber: creditNote.invoice_number,
    issuedAt: `Credit note date: ${day(creditNote.invoice_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: sellerLines(seller, { legalName: company.name, taxId: company.taxId }) },
      { label: "Credit to", lines: [customer.legalName ?? customer.displayName ?? customer.display_name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null,
        ...addressLines(creditNote.billing_address_snapshot), customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
      { label: "Contact", lines: [[contact.first_name, contact.last_name].filter(Boolean).join(" "), contact.email, contact.phone ?? contact.mobile].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Credit note no.", value: creditNote.invoice_number },
      { label: "Credit note date", value: day(creditNote.invoice_date) ?? "" },
      { label: "Original invoice", value: creditNote.source_invoice_number ?? "" },
      { label: "Invoice date", value: day(creditNote.source_invoice_date) ?? "" },
      { label: "Reason", value: [creditNote.reasonLabel, creditNote.reason_code === "sales_return" ? null : creditNote.reason_note].filter(Boolean).join(": ") },
      { label: "Sales order", value: creditNote.sales_order_number ?? "" },
      { label: "Return", value: creditNote.return_number ?? "" },
      { label: "Your PO reference", value: creditNote.customer_po_number ?? "" },
      { label: "Place of supply", value: creditNote.place_of_supply ? `${creditNote.place_of_supply_name ?? ""} (${creditNote.place_of_supply})`.trim() : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: types.length > 2 ? "24%" : "30%" },
        { key: "quantity", label: "Qty", align: "right", width: "9%" },
        { key: "price", label: `Rate (${currency})`, align: "right", width: "11%" },
        { key: "discount", label: "Discount", align: "right", width: "9%" },
        { key: "taxable", label: "Taxable", align: "right", width: "12%" },
        ...types.map((type) => ({ key: type, label: label[type], align: "right", width: "10%" })),
        { key: "total", label: "Amount", align: "right", width: "12%" },
      ],
      rows: lines.map((line) => ({
        item: [line.item_name_snapshot, line.credit_type === "amount" ? "Value adjustment" : null,
          line.hsn_sac_code ? `${line.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${line.hsn_sac_code}` : null].filter(Boolean).join(" · "),
        quantity: line.credit_type === "amount" ? "—" : `${Number(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(),
        price: line.credit_type === "amount" ? "—" : amount(line.unit_price),
        discount: line.credit_type !== "amount" && Number(line.discount_amount) ? amount(line.discount_amount) : "",
        taxable: amount(line.net_amount),
        ...Object.fromEntries(types.map((type) => {
          const tax = line.taxes.find((component) => component.tax_type === type);
          return [type, tax ? `${amount(tax.tax_amount)} (${Number(tax.rate)}%)` : ""];
        })),
        total: amount(line.line_total),
      })),
    },
    totals: [
      { label: "Subtotal", value: amount(gross) },
      ...(discount ? [{ label: "Discounts", value: `-${amount(discount)}` }] : []),
      { label: "Taxable value credited", value: amount(taxable) },
      ...taxSummary.map((tax) => ({ label: `${label[tax.taxType] ?? tax.label ?? tax.taxType} ${tax.rate}%`, value: amount(tax.taxAmount) })),
      { label: `Total credit (${currency})`, value: amount(creditNote.grand_total), emphasis: true },
    ],
    notes: [
      ...(creditNote.customer_notes ? [{ label: "Notes", text: creditNote.customer_notes }] : []),
    ],
    summaryTable: hsnSummaryTable(lines, uqcOf),
    footer: `${creditNote.invoice_number} · against invoice ${creditNote.source_invoice_number}`,
  };
}

// The Payment Receipt (Sales plan): what the customer paid, how (UPI, NEFT, cheque with its number and date), and the bills it settled.
// Not a tax document.
function paymentReceiptModel(data, company) {
  const { payment, allocations } = data;
  const currency = payment.currencyCode;
  return {
    title: "Payment Receipt",
    documentNumber: payment.number,
    issuedAt: `Received on: ${day(payment.date) ?? ""}`,
    organizationName: company.name,
    status: payment.reversedAt ? `Status: Reversed${payment.reversalReason ? `: ${payment.reversalReason}` : ""}` : null,
    parties: [
      { label: "Received by", lines: [company.name, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Received from", lines: [payment.customer.legalName ?? payment.customer.name, payment.customer.customerNumber ? `Customer no. ${payment.customer.customerNumber}` : null,
        payment.customer.gstin ? `GSTIN ${payment.customer.gstin}` : null].filter(Boolean) },
    ],
    fields: [
      { label: "Receipt no.", value: payment.number },
      { label: "Date", value: day(payment.date) ?? "" },
      { label: "Paid by", value: payment.methodLabel ?? "" },
      { label: "Cheque no.", value: payment.chequeNumber ?? "" },
      { label: "Cheque date", value: payment.chequeDate ? day(payment.chequeDate) ?? "" : "" },
      { label: "Drawn on", value: payment.draweeBank ?? "" },
      { label: "Reference / UTR", value: payment.reference ?? "" },
      { label: "Into", value: payment.bankAccount ?? "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "bill", label: "Bill", width: "40%" },
        { key: "date", label: "Bill date", width: "20%" },
        { key: "tds", label: "TDS", align: "right", width: "15%" },
        { key: "amount", label: `Settled (${currency})`, align: "right", width: "25%" },
      ],
      rows: [
        ...allocations.map((row) => ({ bill: row.invoiceNumber, date: day(row.invoiceDate) ?? "", tds: row.tds ? `${amount(row.tds)}${row.tdsSection ? ` (${row.tdsSection})` : ""}` : "", amount: amount(row.amount) })),
        ...(payment.unapplied > 0.005 ? [{ bill: "Advance (kept for the next bills)", date: "", tds: "", amount: amount(payment.unapplied) }] : []),
      ],
    },
    totals: [{ label: `Received (${currency})`, value: amount(payment.amount), emphasis: true }],
    notes: [{ label: "", text: "This receipt confirms a payment. It is not a tax document." }],
    footer: payment.number,
  };
}

// The Payment Advice (Procurement plan Phase 1): what was paid to a supplier, how, and the bills it settled with the TDS withheld on each,
// so the supplier can reconcile their ledger and Form 26AS / 16A. Not a tax document.
function paymentAdviceModel(data, company) {
  const { payment, supplier, allocations, planned } = data;
  const currency = payment.currencyCode;
  const settled = allocations.filter((row) => !row.reversed);
  const rows = settled.length ? settled : planned.map((row) => ({ ...row, billTotal: null }));
  return {
    title: "Payment Advice",
    documentNumber: payment.number,
    issuedAt: `Paid on: ${day(payment.date) ?? ""}`,
    organizationName: company.name,
    status: payment.reversedAt ? `Status: Reversed${payment.reversalReason ? `: ${payment.reversalReason}` : ""}`
      : ["draft", "pending_approval", "approved"].includes(payment.status) ? `Status: ${payment.statusLabel}` : null,
    parties: [
      { label: "Paid by", lines: [company.name, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Paid to", lines: [supplier.legalName ?? supplier.name, supplier.number ? `Supplier no. ${supplier.number}` : null, supplier.gstin ? `GSTIN ${supplier.gstin}` : null,
        supplier.pan ? `PAN ${supplier.pan}` : null, supplier.msme?.udyam ? `Udyam ${supplier.msme.udyam}` : null].filter(Boolean) },
    ],
    fields: [
      { label: "Payment no.", value: payment.number },
      { label: "Date", value: day(payment.date) ?? "" },
      { label: "Paid by", value: payment.methodLabel ?? "" },
      { label: "Reference / UTR", value: payment.reference ?? "" },
      { label: "From", value: payment.bankAccount ?? "" },
      { label: "Against order", value: payment.purchaseOrderNumber ?? "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "bill", label: "Our bill", width: "18%" },
        { key: "invoice", label: "Your invoice", width: "20%" },
        { key: "date", label: "Invoice date", width: "14%" },
        { key: "total", label: "Bill amount", align: "right", width: "16%" },
        { key: "tds", label: "TDS withheld", align: "right", width: "14%" },
        { key: "amount", label: `Paid (${currency})`, align: "right", width: "18%" },
      ],
      rows: [
        ...rows.map((row) => ({ bill: row.billNumber ?? "", invoice: row.supplierInvoice ?? "", date: day(row.billDate) ?? "", total: row.billTotal ? amount(row.billTotal) : "",
          tds: Number(row.tds) ? `${amount(row.tds)}${row.tdsSection ? ` (${row.tdsSection})` : ""}` : "", amount: amount(row.amount) })),
        ...(Number(payment.unapplied) > 0.005 && !["draft", "pending_approval", "approved"].includes(payment.status)
          ? [{ bill: "Advance", invoice: "Kept against your next bills", date: "", total: "", tds: "", amount: amount(payment.unapplied) }] : []),
      ],
    },
    totals: [
      ...(Number(payment.tdsWithheld) ? [{ label: "TDS withheld on these bills", value: amount(payment.tdsWithheld) }] : []),
      { label: `Paid (${currency})`, value: amount(payment.amount), emphasis: true },
    ],
    notes: [{ label: "", text: Number(payment.tdsWithheld)
      ? "TDS shown was withheld when each bill was booked and is deposited with the Income Tax Department; it will appear in your Form 26AS. This advice is not a tax document."
      : "This advice confirms a payment. It is not a tax document." }],
    footer: payment.number,
  };
}

// The Request for Quotation a supplier receives (Procurement plan Phase 2): the items and quantities, by when they are needed, and by when to
// reply — addressed to one supplier when asked (?supplierId=). Prices are left for the supplier to fill in.
function rfqModel(data, company) {
  const { rfq, lines, supplier } = data;
  return {
    title: "REQUEST FOR QUOTATION",
    documentNumber: rfq.number,
    issuedAt: `Date: ${day(rfq.sentAt ?? rfq.createdAt) ?? ""}`,
    organizationName: company.name,
    status: rfq.status === "cancelled" ? "Status: Cancelled" : null,
    parties: [
      { label: "From", lines: [company.name, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      ...(supplier ? [{ label: "To", lines: [supplier.supplierName, supplier.gstin ? `GSTIN ${supplier.gstin}` : null, supplier.email].filter(Boolean) }] : []),
    ],
    fields: [
      { label: "RFQ no.", value: rfq.number },
      { label: "Subject", value: rfq.title ?? "" },
      { label: "Please reply by", value: rfq.responseDueDate ? day(rfq.responseDueDate) ?? "" : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "line", label: "#", width: "6%" },
        { key: "item", label: "Item", width: "40%" },
        { key: "quantity", label: "Quantity", align: "right", width: "16%" },
        { key: "needed", label: "Needed by", width: "16%" },
        { key: "price", label: "Your rate (excl. GST)", align: "right", width: "22%" },
      ],
      rows: lines.map((line) => ({ line: String(line.lineNumber), item: `${line.productName}${line.productCode ? ` (${line.productCode})` : ""}${line.description ? ` — ${line.description}` : ""}`,
        quantity: `${Number(line.quantity)} ${line.uomCode ?? ""}`.trim(), needed: line.requiredBy ? day(line.requiredBy) ?? "" : "", price: "" })),
    },
    totals: [],
    notes: [
      { label: "Please quote", text: "Your rate per unit excluding GST, the GST rate, freight and other charges, delivery lead time, payment terms and how long the prices are valid." },
      ...(rfq.notes ? [{ label: "Notes", text: rfq.notes }] : []),
    ],
    footer: `${rfq.number} · request for quotation`,
  };
}

// The delivery challan returned goods travel under (CGST rule 55; Procurement plan Phase 2): consignor and consignee with their GSTINs, the
// place of supply, each item with HSN, quantity, taxable value and GST, the transport and the e-way bill when there is one.
function returnChallanModel(data, company) {
  const { purchaseReturn, movement, bill } = data;
  const inter = Boolean(movement.interState);
  const tax = Number(bill.cgstValue) + Number(bill.sgstValue) + Number(bill.igstValue);
  return {
    title: "DELIVERY CHALLAN",
    documentNumber: purchaseReturn.number,
    issuedAt: `Challan date: ${day(purchaseReturn.date) ?? ""}`,
    organizationName: company.name,
    status: purchaseReturn.status === "draft" ? "Status: Draft - not dispatched" : purchaseReturn.status === "cancelled" ? "Status: Cancelled" : null,
    parties: [
      { label: "Consignor", lines: [movement.seller?.legal_name || movement.seller?.name || company.name, [movement.from.line1, movement.from.city, movement.from.pin].filter(Boolean).join(", "),
        movement.seller?.registration_number ? `GSTIN ${movement.seller.registration_number}` : null].filter(Boolean) },
      { label: "Consignee (supplier)", lines: [movement.to.name, [movement.to.line1, movement.to.city, movement.to.pin].filter(Boolean).join(", "),
        movement.to.gstin && movement.to.gstin !== "URP" ? `GSTIN ${movement.to.gstin}` : "Unregistered"].filter(Boolean) },
    ],
    fields: [
      { label: "Challan no.", value: purchaseReturn.number },
      { label: "Purpose", value: "Return of goods to the supplier" },
      { label: "Place of supply", value: movement.to.state ? String(movement.to.state) : "" },
      { label: "Vehicle", value: purchaseReturn.vehicleNumber ?? "" },
      { label: "Transporter", value: [purchaseReturn.transporterName, purchaseReturn.transporterId].filter(Boolean).join(" · ") },
      { label: "E-way bill", value: purchaseReturn.ewbNumber ? `${purchaseReturn.ewbNumber}${purchaseReturn.ewbValidUntil ? ` (valid till ${day(purchaseReturn.ewbValidUntil) ?? ""})` : ""}` : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "34%" },
        { key: "hsn", label: "HSN", width: "11%" },
        { key: "quantity", label: "Quantity", align: "right", width: "13%" },
        { key: "taxable", label: "Taxable value", align: "right", width: "16%" },
        { key: "rate", label: "GST", align: "right", width: "10%" },
        { key: "tax", label: "Tax", align: "right", width: "16%" },
      ],
      rows: bill.itemList.map((item) => {
        const rate = inter ? Number(item.igstRate) : Number(item.cgstRate) + Number(item.sgstRate);
        return { item: item.productName, hsn: item.hsnCode, quantity: `${item.quantity} ${item.qtyUnit}`, taxable: amount(item.taxableAmount), rate: `${rate}%`,
          tax: amount((Number(item.taxableAmount) * rate) / 100) };
      }),
    },
    totals: [
      { label: "Taxable value", value: amount(bill.totalValue) },
      ...(inter ? [{ label: "IGST", value: amount(bill.igstValue) }] : [{ label: "CGST", value: amount(bill.cgstValue) }, { label: "SGST", value: amount(bill.sgstValue) }]),
      { label: "Value of goods", value: amount(Number(bill.totalValue) + tax), emphasis: true },
    ],
    notes: [{ label: "", text: `Goods returned to the supplier: not a supply for consideration. ${Number(bill.totInvValue) >= 50000 && !purchaseReturn.ewbNumber ? "An e-way bill is needed for this consignment (₹50,000 or more)." : ""}`.trim() }],
    footer: `${purchaseReturn.number} · delivery challan`,
  };
}

// The Debit Note (Sales plan): titled DEBIT NOTE, naming the original invoice and the reason, the amounts added to its lines with
// HSN/SAC and their tax components, and the totals.
function debitNoteModel(data, uqcOf = null) {
  const { debitNote, row, lines, company } = data;
  const currency = debitNote.currencyCode;
  const customer = row.sales_customer_snapshot || row.customer_snapshot || {};
  const seller = row.seller_snapshot || {};
  const types = ["cgst", "sgst", "igst", "cess"].filter((type) => lines.some((line) => line.taxes.some((tax) => tax.tax_type === type)));
  const label = { cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "Cess" };
  const byRate = new Map();
  for (const line of lines) for (const tax of line.taxes) {
    const key = `${tax.tax_type}:${tax.rate}`;
    byRate.set(key, { type: tax.tax_type, rate: tax.rate, amount: (byRate.get(key)?.amount ?? 0) + Number(tax.tax_amount) });
  }
  const status = { draft: "Draft - not posted", cancelled: "Cancelled" }[debitNote.status];
  return {
    title: "DEBIT NOTE",
    documentNumber: debitNote.number,
    issuedAt: `Debit note date: ${day(debitNote.date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: sellerLines(seller, { legalName: company.name, taxId: company.taxId }) },
      { label: "Debit to", lines: [customer.legalName ?? customer.displayName ?? customer.display_name, ...addressLines(row.billing_address_snapshot), customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Debit note no.", value: debitNote.number },
      { label: "Debit note date", value: day(debitNote.date) ?? "" },
      { label: "Original invoice", value: debitNote.sourceInvoice.number ?? "" },
      { label: "Invoice date", value: day(debitNote.sourceInvoice.date) ?? "" },
      { label: "Reason", value: [debitNote.reasonLabel, debitNote.reasonNote].filter(Boolean).join(": ") },
      { label: "Due date", value: day(debitNote.dueDate) ?? "" },
      { label: "Place of supply", value: row.place_of_supply ? `${row.place_of_supply_name ?? ""} (${row.place_of_supply})`.trim() : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "item", label: "Item", width: "36%" },
        { key: "taxable", label: `Taxable (${currency})`, align: "right", width: "16%" },
        ...types.map((type) => ({ key: type, label: label[type], align: "right", width: "12%" })),
        { key: "total", label: "Amount", align: "right", width: "16%" },
      ],
      rows: lines.map((line) => ({
        item: [line.item_name_snapshot, "Value added", line.hsn_sac_code ? `${line.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${line.hsn_sac_code}` : null].filter(Boolean).join(" · "),
        taxable: amount(line.net_amount),
        ...Object.fromEntries(types.map((type) => {
          const tax = line.taxes.find((component) => component.tax_type === type);
          return [type, tax ? `${amount(tax.tax_amount)} (${Number(tax.rate)}%)` : ""];
        })),
        total: amount(line.line_total),
      })),
    },
    totals: [
      { label: "Taxable value added", value: amount(debitNote.subtotal) },
      ...[...byRate.values()].map((tax) => ({ label: `${label[tax.type] ?? tax.type} ${tax.rate}%`, value: amount(tax.amount) })),
      { label: `Total debit (${currency})`, value: amount(debitNote.total), emphasis: true },
    ],
    summaryTable: hsnSummaryTable(lines, uqcOf),
    footer: `${debitNote.number} · against invoice ${debitNote.sourceInvoice.number}`,
  };
}

// The Statement of Account (Sales plan, Flow 4): opening balance, every bill, note, payment and refund with a running balance, the
// closing balance and what is open by age, in the company currency.
function customerStatementModel(data, company) {
  const { statement } = data;
  const aging = statement.aging ?? {};
  return {
    title: "Statement of Account",
    documentNumber: statement.party.code ?? statement.party.name,
    issuedAt: `${day(statement.from) ?? ""} to ${day(statement.to) ?? ""}`,
    organizationName: company.name,
    parties: [
      { label: "From", lines: [statement.company?.name ?? company.name, statement.company?.address, statement.company?.gstin ? `GSTIN ${statement.company.gstin}` : null].filter(Boolean) },
      { label: "Customer", lines: [statement.party.legalName ?? statement.party.name, statement.party.gstin ? `GSTIN ${statement.party.gstin}` : null].filter(Boolean) },
    ],
    fields: [
      { label: "Opening balance", value: amount(statement.opening) },
      { label: "Closing balance", value: amount(statement.closing) },
    ],
    table: {
      columns: [
        { key: "date", label: "Date", width: "13%" },
        { key: "document", label: "Document", width: "17%" },
        { key: "number", label: "Number", width: "18%" },
        { key: "debit", label: "Debit", align: "right", width: "17%" },
        { key: "credit", label: "Credit", align: "right", width: "17%" },
        { key: "balance", label: "Balance", align: "right", width: "18%" },
      ],
      rows: [
        { date: day(statement.from) ?? "", document: "Opening balance", number: "", debit: "", credit: "", balance: amount(statement.opening) },
        ...statement.lines.map((line) => ({ date: day(line.date) ?? "", document: line.document ?? "", number: line.number ?? "", debit: line.increase ? amount(line.increase) : "",
          credit: line.decrease ? amount(line.decrease) : "", balance: amount(line.balance) })),
      ],
    },
    totals: [
      { label: "Not yet due", value: amount(aging.notDue ?? 0) },
      { label: "1–30 days overdue", value: amount(aging.d1_30 ?? 0) },
      { label: "31–60 days overdue", value: amount(aging.d31_60 ?? 0) },
      { label: "61–90 days overdue", value: amount(aging.d61_90 ?? 0) },
      { label: "Over 90 days overdue", value: amount(aging.over90 ?? 0) },
      { label: "Balance due", value: amount(statement.closing), emphasis: true },
    ],
    notes: [{ label: "", text: "Please tell us within 15 days if anything on this statement does not agree with your books." }],
    footer: `Statement ${day(statement.from) ?? ""} to ${day(statement.to) ?? ""}`,
  };
}

// The Refund Voucher: evidence that money was paid back, never a tax document. The refund number and
// date, the customer, the amount, how it was paid and its reference, the credit it settles and the
// reason. No tax, no accounts, no internal notes.
function refundVoucherModel(data) {
  const { refund, source, company } = data;
  const customer = refund.customer_snapshot || {};
  const currency = refund.currency_code;
  const status = { draft: "Draft - not paid", reversed: `Reversed${refund.reversal_reason ? `: ${refund.reversal_reason}` : ""}` }[refund.status];
  return {
    title: "Refund Voucher",
    documentNumber: refund.refund_number,
    issuedAt: `Refund date: ${day(refund.refund_date) ?? ""}`,
    organizationName: company.name,
    status: status ? `Status: ${status}` : null,
    parties: [
      { label: "From", lines: [company.name].filter(Boolean) },
      { label: "Refunded to", lines: [customer.legalName ?? customer.displayName ?? refund.customer_name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Refund no.", value: refund.refund_number },
      { label: "Refund date", value: day(refund.refund_date) ?? "" },
      { label: "Amount", value: `${amount(refund.amount)} ${currency}` },
      { label: "Payment method", value: refund.paymentMethodLabel ?? "" },
      { label: "Transaction reference", value: refund.external_reference ?? "" },
      { label: source.typeLabel, value: source.number ?? "" },
      { label: "Reason", value: [refund.reasonLabel, refund.reason_note].filter(Boolean).join(": ") },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "description", label: "Description", width: "70%" },
        { key: "amount", label: `Amount (${currency})`, align: "right", width: "30%" },
      ],
      rows: [{ description: `Refund of customer credit: ${String(source.typeLabel).toLowerCase()} ${source.number}`, amount: amount(refund.amount) }],
    },
    totals: [{ label: `Refunded (${currency})`, value: amount(refund.amount), emphasis: true }],
    notes: [
      ...(refund.customer_notes ? [{ label: "Notes", text: refund.customer_notes }] : []),
      { label: "", text: "This voucher confirms a payment. It is not a tax document." },
    ],
    footer: `${refund.refund_number} · ${source.number}`,
  };
}

// The Return Note: what came back, from which delivery and order, why, in what
// condition and into which warehouse. Never prices, never internal notes.
function returnNoteModel(data) {
  const { salesReturn, lines, invoices, company } = data;
  const customer = salesReturn.customer_snapshot || {};
  return {
    title: "Return Note",
    documentNumber: salesReturn.return_number,
    issuedAt: `Return date: ${day(salesReturn.return_date) ?? ""}`,
    organizationName: company.name,
    status: salesReturn.status === "draft" ? "Status: Draft - not received" : null,
    parties: [
      { label: "Received by", lines: [company.name, salesReturn.warehouse_name ? `Warehouse: ${salesReturn.warehouse_name}` : null, company.taxId ? `GSTIN ${company.taxId}` : null].filter(Boolean) },
      { label: "Customer", lines: [customer.displayName ?? customer.display_name ?? customer.name, customer.customerNumber ? `Customer no. ${customer.customerNumber}` : null,
        customer.gstin ? `GSTIN ${customer.gstin}` : null].filter(Boolean) },
    ].filter((party) => party.lines.length),
    fields: [
      { label: "Return no.", value: salesReturn.return_number },
      { label: "Sales order", value: salesReturn.sales_order_number ?? "" },
      { label: "Delivery", value: salesReturn.delivery_number ?? "" },
      { label: "Invoice", value: invoices.map((invoice) => invoice.invoice_number).join(", ") },
      { label: "Your PO reference", value: salesReturn.customer_po_number ?? "" },
      { label: "Reason", value: [salesReturn.reasonLabel, salesReturn.reason_note].filter(Boolean).join(": ") },
      { label: "Received", value: salesReturn.received_at ? day(salesReturn.received_at) ?? "" : "" },
    ].filter((field) => field.value),
    table: {
      columns: [
        { key: "number", label: "#", width: "5%" },
        { key: "code", label: "Code", width: "15%" },
        { key: "item", label: "Item", width: "45%" },
        { key: "quantity", label: "Returned", align: "right", width: "15%" },
        { key: "condition", label: "Condition", width: "20%" },
      ],
      rows: lines.map((line, index) => ({
        number: index + 1, code: line.item_code_snapshot ?? "", item: line.item_name_snapshot,
        quantity: `${Number(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(), condition: line.dispositionLabel ?? "",
      })),
    },
    totals: [{ label: "Total quantity", value: String(salesReturn.total_quantity ?? 0) }],
    notes: [
      ...(salesReturn.customer_notes ? [{ label: "Notes", text: salesReturn.customer_notes }] : []),
      { label: "Received in the condition stated", text: "Name: ______________________   Signature: ______________________   Date: ______________" },
    ],
    footer: `${salesReturn.return_number} · ${salesReturn.delivery_number ?? ""}`,
  };
}

export const DOCUMENT_RENDERERS = Object.freeze([
  Object.freeze({
    key: "pos.receipt",
    moduleKey: "point-of-sale",
    permission: "pos.view",
    label: "POS receipt",
    async load(client, session, id) {
      const receipt = await getPosSaleReceipt(client, posContext(session), id);
      return { ...receipt, taxes: await getPosSaleTaxes(client, posContext(session), id) };
    },
    async toModel(client, session, data) {
      const { sale, lines, payments, taxes } = data;
      const currency = String(sale.currency_code || "").trim();
      // The document the sale is (from its own tax snapshot) and what a GST invoice prints: seller and buyer GSTIN, place of supply, HSN/SAC,
      // the rate on each line and the tax by component — never recomputed.
      const title = { tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", invoice_cum_bill_of_supply: "Tax invoice cum bill of supply" }[taxes?.documentType] ?? "Receipt";
      const taxLine = new Map((taxes?.lines ?? []).map((line) => [line.id, line]));
      const classLabel = { nil_rated: "Nil", exempt: "Exempt", non_gst: "Non-GST", zero_rated: "Zero" };
      const seller = taxes?.seller ?? null;
      return {
        title,
        documentNumber: sale.receipt_number,
        issuedAt: date(sale.completed_at || sale.sale_date, sale.store_timezone),
        organizationName: seller?.legalName || await organizationName(client, session.organizationId),
        status: sale.status === "completed" ? null : `Status: ${sale.status}`,
        parties: [
          { label: "Store", lines: [sale.store_name, sale.terminal_name, seller?.gstin ? `GSTIN ${seller.gstin}` : null, seller?.stateName ? `${seller.stateName} (${seller.stateCode})` : null].filter(Boolean) },
          ...(sale.customer_display_name || sale.customer_name || sale.buyer_name_snapshot
            ? [{ label: "Customer", lines: [sale.customer_display_name || sale.customer_name || sale.buyer_name_snapshot, taxes?.buyer?.gstin ? `GSTIN ${taxes.buyer.gstin}` : null].filter(Boolean) }] : []),
        ],
        fields: [
          { label: "Cashier", value: sale.cashier_name ?? "" },
          ...(taxes?.placeOfSupply ? [{ label: "Place of supply", value: `${taxes.placeOfSupply}${taxes.supplyMode === "delivery" ? " (delivery)" : ""}` }] : []),
        ],
        table: {
          columns: [
            { key: "item", label: "Item", width: "34%" },
            { key: "hsn", label: "HSN/SAC", width: "12%" },
            { key: "quantity", label: "Qty", align: "right", width: "8%" },
            { key: "price", label: `Price (${currency})`, align: "right", width: "12%" },
            { key: "discount", label: "Discount", align: "right", width: "11%" },
            { key: "gst", label: "GST", align: "right", width: "9%" },
            { key: "total", label: "Amount", align: "right", width: "14%" },
          ],
          rows: lines.map((line) => {
            const tax = taxLine.get(line.id);
            return { item: line.description, hsn: tax?.hsnSac ?? "", quantity: Number(line.quantity), price: amount(line.unit_price),
              discount: Number(line.discount_amount) ? amount(line.discount_amount) : "",
              gst: tax ? (tax.classification && tax.classification !== "taxable" ? classLabel[tax.classification] ?? tax.classification : `${Number(tax.rate ?? 0)}%`) : "",
              total: amount(line.line_total) };
          }),
        },
        totals: [
          { label: "Subtotal", value: amount(sale.subtotal) },
          ...(Number(sale.discount_total) ? [{ label: "Discount", value: `-${amount(sale.discount_total)}` }] : []),
          ...(taxes?.taxableTotal != null ? [{ label: "Taxable value", value: amount(taxes.taxableTotal) }] : []),
          ...((taxes?.breakdown ?? []).length
            ? taxes.breakdown.map((entry) => ({ label: `${entry.label} ${Number(entry.rate)}%`, value: amount(entry.taxAmount) }))
            : [{ label: "Tax", value: amount(sale.tax_total) }]),
          ...(Number(sale.rounding_adjustment) ? [{ label: "Rounding", value: amount(sale.rounding_adjustment) }] : []),
          { label: `Total (${currency})`, value: amount(sale.grand_total), emphasis: true },
          ...payments.map((payment) => ({ label: `Paid (${String(payment.payment_method ?? "payment").replace(/_/g, " ")})`, value: amount(payment.amount) })),
          ...(Number(sale.change_total) ? [{ label: "Change", value: amount(sale.change_total) }] : []),
        ],
        footer: "Thank you for your purchase",
      };
    },
    fileName: (data) => `receipt-${data.sale.receipt_number}`,
  }),
  Object.freeze({
    key: "sales.quotation",
    moduleKey: "sales",
    permission: "sales.quotation.export",
    label: "Sales quotation",
    async load(client, session, id) {
      return getQuotation(client, salesContext(session), id);
    },
    // Built only from the quotation as stored (its snapshots), so a later
    // change to the customer, a product or a price list never changes it.
    // Internal notes, cost and margin are never printed.
    async toModel(client, session, data) {
      return quotationModel(client, session, data);
    },
    money: (data) => ({ amount: data.quotation.grand_total, currency: data.quotation.currency_code }),
    fileName: (data) => `quotation-${data.quotation.quotation_number}`,
  }),
  Object.freeze({
    key: "sales.proforma",
    moduleKey: "sales",
    permission: "sales.quotation.export",
    label: "Proforma invoice",
    // options.advancePercent: the advance asked for, as a percentage of the total.
    async load(client, session, id, options = {}) {
      return getProformaInvoice(client, salesContext(session), id, { advancePercent: options.advancePercent });
    },
    async toModel(client, session, data) {
      return proformaModel(client, session, data);
    },
    money: (data) => ({ amount: data.proforma.advanceAmount || data.quotation.grand_total, currency: data.quotation.currency_code }),
    collectsPayment: (data) => ({ amount: data.proforma.advanceAmount || data.quotation.grand_total, note: data.proforma.number }),
    fileName: (data) => `proforma-${data.proforma.number}`,
  }),
  Object.freeze({
    key: "crm.quote",
    moduleKey: "crm",
    permission: "crm.opportunities.view",
    label: "CRM quotation",
    async load(client, session, id) {
      return getDealQuote(client, salesContext(session), id);
    },
    async toModel(client, session, data) {
      return crmQuoteModel(client, session.organizationId, data);
    },
    money: (data) => ({ amount: data.quote.grandTotal, currency: data.quote.currencyCode }),
    collectsPayment: (data) => (data.quote.kind === "proforma" ? { amount: data.quote.grandTotal, note: data.quote.number } : null),
    fileName: (data) => `${data.quote.kind === "proforma" ? "proforma" : "quotation"}-${data.quote.number}`,
  }),
  Object.freeze({
    key: "sales.order",
    moduleKey: "sales",
    permission: "sales.order.export",
    label: "Order confirmation",
    // A confirmed order prints its current Order Confirmation, from the
    // snapshot taken when it was confirmed. A draft prints as a draft.
    async load(client, session, id) {
      const context = salesContext(session);
      const confirmation = await getOrderConfirmation(client, context, { orderId: id });
      if (confirmation) return { confirmation };
      const detail = await getSalesOrder(client, context, id);
      return { draft: { order: detail.order, lines: detail.lines, taxLines: detail.taxLines, company: await companyDetails(client, session.organizationId) } };
    },
    async toModel(_client, _session, data) {
      return data.confirmation ? orderConfirmationModel(data.confirmation.snapshot, confirmationMeta(data.confirmation)) : orderConfirmationModel(data.draft, { draft: true });
    },
    fileName: (data) => confirmationFileName(data.confirmation ?? { order_number: data.draft.order.sales_order_number }, Boolean(data.draft)),
  }),
  Object.freeze({
    key: "sales.delivery",
    moduleKey: "sales",
    permission: "sales.delivery.print",
    label: "Delivery note",
    async load(client, session, id) {
      return getDeliveryNote(client, salesContext(session), id);
    },
    async toModel(_client, _session, data) {
      return deliveryNoteModel(data);
    },
    fileName: (data) => `Delivery-Note-${data.delivery.request_number}`,
  }),
  Object.freeze({
    key: "sales.delivery_challan",
    moduleKey: "sales",
    permission: "sales.delivery.print",
    label: "Delivery challan (GST)",
    async load(client, session, id) {
      return getDeliveryNote(client, salesContext(session), id);
    },
    async toModel(_client, _session, data) {
      return deliveryChallanModel(data);
    },
    copies: ["Original for consignee", "Duplicate for transporter", "Triplicate for consignor"],
    fileName: (data) => `Delivery-Challan-${data.delivery.request_number}`,
  }),
  Object.freeze({
    key: "sales.challan",
    moduleKey: "sales",
    permission: "sales.order.view",
    label: "Delivery challan",
    async load(client, session, id) {
      const challan = await getSalesChallan(client, salesContext(session), id);
      const company = (await client.query("SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1", [session.organizationId])).rows[0] ?? {};
      return { challan, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
    },
    async toModel(_client, _session, data) {
      return salesChallanModel(data);
    },
    copies: ["Original for consignee", "Duplicate for transporter", "Triplicate for consignor"],
    fileName: (data) => `Delivery-Challan-${data.challan.challanNumber}`,
  }),
  Object.freeze({
    key: "sales.invoice",
    moduleKey: "sales",
    permission: "sales.invoice.print",
    label: "Sales invoice",
    async load(client, session, id) {
      return getSalesInvoiceDocument(client, salesContext(session), id);
    },
    async toModel(client, session, data) {
      return salesInvoiceModel(data, await unitUqcMap(client, session.organizationId));
    },
    money: (data) => ({ amount: data.invoice.grand_total, currency: data.invoice.currency_code }),
    collectsPayment: (data) => (data.invoice.status === "draft" ? null : { amount: data.invoice.outstanding_amount ?? data.invoice.grand_total, note: data.invoice.invoice_number }),
    copies: ["Original for recipient", "Duplicate for transporter", "Triplicate for supplier"],
    fileName: (data) => `Invoice-${data.invoice.invoice_number}${data.invoice.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "sales.credit_note",
    moduleKey: "sales",
    permission: "sales.credit_note.print",
    label: "Credit note",
    async load(client, session, id) {
      return getCreditNoteDocument(client, salesContext(session), id);
    },
    async toModel(client, session, data) {
      return creditNoteModel(data, await unitUqcMap(client, session.organizationId));
    },
    money: (data) => ({ amount: data.creditNote.grand_total, currency: data.creditNote.currency_code }),
    copies: ["Original for recipient", "Duplicate for supplier"],
    fileName: (data) => `Credit-Note-${data.creditNote.invoice_number}${data.creditNote.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "sales.receipt",
    moduleKey: "sales",
    permission: "sales.invoice.payments.view",
    label: "Payment receipt",
    async load(client, session, id) {
      return { ...(await getSalesPayment(client, salesContext(session), id)), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return paymentReceiptModel(data, data.company);
    },
    money: (data) => ({ amount: data.payment.amount, currency: data.payment.currencyCode }),
    fileName: (data) => `Receipt-${data.payment.number}`,
  }),
  Object.freeze({
    key: "sales.debit_note",
    moduleKey: "sales",
    permission: "sales.credit_note.print",
    label: "Debit note",
    async load(client, session, id) {
      return getDebitNoteDocument(client, salesContext(session), id);
    },
    async toModel(client, session, data) {
      return debitNoteModel(data, await unitUqcMap(client, session.organizationId));
    },
    money: (data) => ({ amount: data.debitNote.total, currency: data.debitNote.currencyCode }),
    collectsPayment: (data) => (data.debitNote.status === "posted" ? { amount: data.debitNote.outstanding, note: data.debitNote.number } : null),
    copies: ["Original for recipient", "Duplicate for supplier"],
    fileName: (data) => `Debit-Note-${data.debitNote.number}${data.debitNote.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "sales.customer_statement",
    moduleKey: "sales",
    permission: "sales.customers.view_financials",
    label: "Statement of account",
    // options: { from?, to? } (the financial year so far by default).
    async load(client, session, id, options = {}) {
      return { ...(await getCustomerStatementDocument(client, salesContext(session), id, { from: options.from, to: options.to })), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return customerStatementModel(data, data.company);
    },
    fileName: (data) => `Statement-${data.statement.party.code ?? data.statement.party.name}-${data.statement.to}`,
  }),
  Object.freeze({
    key: "accounting.customer_refund",
    moduleKey: "accounting",
    permission: "accounting.refund.view",
    label: "Refund voucher",
    async load(client, session, id) {
      return getRefundVoucher(client, salesContext(session), id);
    },
    async toModel(_client, _session, data) {
      return refundVoucherModel(data);
    },
    fileName: (data) => `Refund-${data.refund.refund_number}${data.refund.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "sales.return",
    moduleKey: "sales",
    permission: "sales.return.print",
    label: "Return note",
    async load(client, session, id) {
      return getReturnNote(client, salesContext(session), id);
    },
    async toModel(_client, _session, data) {
      return returnNoteModel(data);
    },
    fileName: (data) => `Return-Note-${data.salesReturn.return_number}`,
  }),
  Object.freeze({
    key: "procurement.purchase_order",
    moduleKey: "procurement",
    permission: "procurement.po.view",
    label: "Purchase order",
    // The current confirmed version (or ?version= an earlier one, through the order's own access rules); a draft prints as a draft.
    async load(client, session, id, options = {}) {
      return getPurchaseOrderDocument(client, salesContext(session), id, { version: options.version ?? null });
    },
    async toModel(_client, _session, data) {
      return purchaseOrderModel(data);
    },
    fileName: (data) => `Purchase-Order-${data.snapshot.order.purchase_order_number}${data.draft ? "-draft" : data.version > 1 ? `-rev${data.version}` : ""}`,
  }),
  Object.freeze({
    key: "procurement.goods_receipt",
    moduleKey: "procurement",
    permission: "procurement.po.view",
    label: "Goods receipt note",
    async load(client, session, id) {
      return { detail: await getGoodsReceipt(client, salesContext(session), id), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return goodsReceiptModel(data.detail, data.company);
    },
    fileName: (data) => `GRN-${data.detail.receipt.receiptNumber}${data.detail.receipt.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "procurement.purchase_return",
    moduleKey: "procurement",
    permission: "procurement.returns.view",
    label: "Purchase return note",
    async load(client, session, id) {
      return { detail: await getPurchaseReturn(client, salesContext(session), id), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return purchaseReturnModel(data.detail, data.company);
    },
    fileName: (data) => `Return-Note-${data.detail.purchaseReturn.returnNumber}${data.detail.purchaseReturn.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "procurement.supplier_bill",
    moduleKey: "procurement",
    permission: "procurement.bills.view",
    label: "Purchase voucher",
    async load(client, session, id) {
      return { detail: await getSupplierBill(client, salesContext(session), id), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return supplierBillModel(data.detail, data.company);
    },
    fileName: (data) => `Purchase-Voucher-${data.detail.bill.billNumber}`,
  }),
  Object.freeze({
    key: "procurement.payment_advice",
    moduleKey: "procurement",
    permission: "procurement.bills.view",
    label: "Payment advice",
    async load(client, session, id) {
      return { ...(await getSupplierPayment(client, salesContext(session), id)), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return paymentAdviceModel(data, data.company);
    },
    money: (data) => ({ amount: data.payment.amount, currency: data.payment.currencyCode }),
    fileName: (data) => `Payment-Advice-${data.payment.number}`,
  }),
  Object.freeze({
    key: "procurement.rfq",
    moduleKey: "procurement",
    permission: "procurement.po.view",
    label: "Request for quotation",
    // options: { supplierId? } — the copy addressed to one supplier on the RFQ.
    async load(client, session, id, options = {}) {
      const detail = await getPurchaseRfq(client, salesContext(session), id);
      return { ...detail, supplier: options.supplierId ? detail.suppliers.find((entry) => entry.supplierId === options.supplierId) ?? null : null,
        company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return rfqModel(data, data.company);
    },
    fileName: (data) => `RFQ-${data.rfq.number}${data.supplier ? `-${String(data.supplier.supplierNumber ?? "").replace(/[^A-Za-z0-9-]/g, "")}` : ""}`,
  }),
  Object.freeze({
    key: "procurement.return_challan",
    moduleKey: "procurement",
    permission: "procurement.returns.view",
    label: "Delivery challan",
    async load(client, session, id) {
      return { ...(await getPurchaseReturnChallan(client, salesContext(session), id)), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return returnChallanModel(data, data.company);
    },
    copies: ["Original for consignee", "Duplicate for transporter", "Triplicate for consignor"],
    fileName: (data) => `Delivery-Challan-${data.purchaseReturn.number}`,
  }),
  Object.freeze({
    key: "procurement.debit_claim",
    moduleKey: "procurement",
    permission: "procurement.claims.view",
    label: "Debit note to supplier",
    async load(client, session, id) {
      return { detail: await getSupplierDebitClaim(client, salesContext(session), id), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return debitClaimModel(data.detail, data.company);
    },
    fileName: (data) => `Debit-Note-${data.detail.claim.claimNumber}${data.detail.claim.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "procurement.vendor_credit",
    moduleKey: "procurement",
    permission: "procurement.bills.view",
    label: "Vendor credit voucher",
    async load(client, session, id) {
      return { detail: await getVendorCredit(client, salesContext(session), id), company: await companyDetails(client, session.organizationId) };
    },
    async toModel(_client, _session, data) {
      return vendorCreditModel(data.detail, data.company);
    },
    fileName: (data) => `Vendor-Credit-${data.detail.credit.number}${data.detail.credit.status === "draft" ? "-draft" : ""}`,
  }),
  Object.freeze({
    key: "sales.order.confirmation",
    moduleKey: "sales",
    permission: "sales.order.export",
    label: "Order confirmation revision",
    // Any revision of an order's confirmation, current or superseded, through the order's own access rules.
    async load(client, session, id) {
      return { confirmation: await getOrderConfirmation(client, salesContext(session), { confirmationId: id }) };
    },
    async toModel(_client, _session, data) {
      return orderConfirmationModel(data.confirmation.snapshot, confirmationMeta(data.confirmation));
    },
    fileName: (data) => confirmationFileName(data.confirmation, false),
  }),
]);

// Layout v2 (Shared Platform plan 4), for every printed document: the company's logo and details in the header and the authorised
// signatory block; for documents with an amount, the amount in words; for invoices and proformas, the bank details and a UPI QR
// for the amount due; and, when asked (options.copies), the statutory copies.
export async function decorateDocument(client, session, renderer, data, model, options = {}) {
  if (renderer.key === "pos.receipt") return model;
  const letterhead = await companyLetterhead(client, session.organizationId, options);
  if (!letterhead) return model;
  const decorated = { ...model, organizationName: model.organizationName || letterhead.name, company: { logo: letterhead.logo, lines: letterhead.lines } };
  decorated.signatory = { companyName: model.organizationName || letterhead.name, image: letterhead.signature };
  const money = renderer.money?.(data);
  if (money && Number.isFinite(Number(money.amount))) decorated.amountInWords = amountInWords(Number(money.amount), String(money.currency || "INR").trim());
  const payable = renderer.collectsPayment?.(data);
  if (payable && (letterhead.bankLines.length || letterhead.upiId)) {
    const inr = !money?.currency || String(money.currency).trim() === "INR";
    decorated.payment = {
      bankLines: letterhead.bankLines,
      upi: letterhead.upiId && inr && Number(payable.amount) > 0
        ? { uri: upiPaymentUri({ vpa: letterhead.upiId, payeeName: letterhead.name, amount: Number(payable.amount), note: payable.note }), label: `Scan to pay ${letterhead.upiId} with any UPI app` }
        : null,
    };
  }
  if (renderer.copies && Number(options.copies) > 1) decorated.copies = renderer.copies.slice(0, Math.min(Number(options.copies), renderer.copies.length));
  // e-invoice (Shared Platform plan 7): a live IRN prints the IRP's signed QR.
  if (renderer.key === "sales.invoice" && data?.invoice?.id) {
    const einvoice = (await client.query(`SELECT irn, ack_number, ack_date, signed_qr FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 AND status = 'generated'`,
      [session.organizationId, data.invoice.id])).rows[0];
    if (einvoice?.signed_qr) {
      decorated.einvoiceQr = einvoice.signed_qr;
      decorated.fields = [...(decorated.fields ?? []).filter((field) => field.label !== "IRN"), { label: "IRN", value: einvoice.irn }, { label: "Ack no.", value: einvoice.ack_number ?? "" }].filter((field) => field.value);
    }
  }
  // Composition scheme (Shared Platform plan 7): the seller collects no GST, so its invoice is a bill of supply and says why.
  if (renderer.key === "sales.invoice") {
    const registrationId = data?.invoice?.seller_registration_id ?? null;
    const regime = (await client.query(
      `SELECT registration_type FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR id = $2) ORDER BY is_default DESC LIMIT 1`,
      [session.organizationId, registrationId])).rows[0];
    if (regime?.registration_type === "composition") {
      decorated.title = "Bill of Supply";
      decorated.declaration = [model.declaration, "Composition taxable person, not eligible to collect tax on supplies."].filter(Boolean).join(" ");
    }
  }
  return decorated;
}

// The A4 receipt model laid out for a till roll: store and seller on top, then each line (quantity × price, HSN, GST), the totals
// and payments, and the thank-you line.
export function toThermalReceipt(model, width) {
  const store = model.parties?.find((party) => party.label === "Store")?.lines ?? [];
  const customer = model.parties?.find((party) => party.label === "Customer")?.lines ?? [];
  const totals = model.totals ?? [];
  const paid = totals.filter((total) => /^Paid|^Change/.test(total.label));
  return {
    width,
    header: [model.organizationName, ...store].filter(Boolean),
    title: model.title,
    meta: [`No. ${model.documentNumber}`, model.issuedAt, ...(model.fields ?? []).map((field) => `${field.label}: ${field.value}`), ...customer.map((line, index) => (index === 0 ? `Customer: ${line}` : line))].filter(Boolean),
    lines: (model.table?.rows ?? []).map((row) => ({
      name: String(row.item ?? ""),
      detail: [`${row.quantity} × ${row.price}`, row.discount ? `less ${row.discount}` : null, row.hsn ? `HSN ${row.hsn}` : null, row.gst ? `GST ${row.gst}` : null].filter(Boolean).join(" · "),
      amount: String(row.total ?? ""),
    })),
    totals: totals.filter((total) => !paid.includes(total)),
    payments: paid.map((total) => `${total.label}: ${total.value}`),
    footer: [model.footer, model.status].filter(Boolean),
  };
}

export function getDocumentRenderer(key) {
  return DOCUMENT_RENDERERS.find((renderer) => renderer.key === key) ?? null;
}

/**
 * Loads (with the module's own authorization), builds and renders one
 * document. The caller has already checked module access and the renderer's
 * permission; the module read re-checks its own permission and scope.
 */
export async function renderAuthorizedDocument(client, session, key, id, options = {}) {
  const renderer = getDocumentRenderer(key);
  if (!renderer) throw Object.assign(new Error("Unknown document."), { status: 404, code: "DOCUMENT_RENDERER_UNKNOWN" });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) throw Object.assign(new Error("Document not found."), { status: 404, code: "DOCUMENT_NOT_FOUND" });
  const data = await renderer.load(client, session, id, options);
  const base = await renderer.toModel(client, session, data);
  const { renderDocumentPdf, renderReceiptPdf, safePdfFileName } = await import("@vercentlabs/document-engine/pdf");
  // A POS receipt for a thermal printer (?width=58 or 80): the same content on a narrow roll.
  if (renderer.key === "pos.receipt" && [58, 80].includes(Number(options.width))) {
    return { fileName: safePdfFileName(`${renderer.fileName(data)}-${Number(options.width)}mm`), body: await renderReceiptPdf(toThermalReceipt(base, Number(options.width))) };
  }
  const model = await decorateDocument(client, session, renderer, data, base, options);
  return { fileName: safePdfFileName(renderer.fileName(data)), body: await renderDocumentPdf(model) };
}
