// Registered printable documents. Each renderer loads its record through the
// owning module's authoritative read - the SAME function (and therefore the
// same permission, store scope and margin redaction) the screen uses
// - then builds a plain document model for @vercentlabs/document-engine/pdf.
// A PDF is a presentation of the record, never a new source of truth. There
// is no arbitrary template, HTML, file path or SQL input.
import { formatDateTime } from "@vercentlabs/localization";

import { getPosSaleReceipt } from "../../modules/point-of-sale/transaction-continuity-and-documents/receipts.js";
import { getOrderConfirmation, getQuotation, getSalesOrder } from "../../modules/sales/index.js";

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
      ...(order.customer_notes ? [{ label: "Notes", text: order.customer_notes }] : []),
      ...(order.terms_and_conditions ? [{ label: "Terms and conditions", text: order.terms_and_conditions }] : []),
    ],
    footer: `${order.sales_order_number}${meta.version > 1 ? ` · revision ${meta.version}` : ""}`,
  };
}

export const DOCUMENT_RENDERERS = Object.freeze([
  Object.freeze({
    key: "pos.receipt",
    moduleKey: "point-of-sale",
    permission: "pos.view",
    label: "POS receipt",
    async load(client, session, id) {
      return getPosSaleReceipt(client, posContext(session), id);
    },
    async toModel(client, session, data) {
      const { sale, lines, payments } = data;
      const currency = String(sale.currency_code || "").trim();
      return {
        title: "Receipt",
        documentNumber: sale.receipt_number,
        issuedAt: date(sale.completed_at || sale.sale_date, sale.store_timezone),
        organizationName: await organizationName(client, session.organizationId),
        status: sale.status === "completed" ? null : `Status: ${sale.status}`,
        parties: [{ label: "Store", lines: [sale.store_name, sale.terminal_name].filter(Boolean) }, ...(sale.customer_display_name || sale.customer_name ? [{ label: "Customer", lines: [sale.customer_display_name || sale.customer_name] }] : [])],
        fields: [{ label: "Cashier", value: sale.cashier_name ?? "" }],
        table: {
          columns: [
            { key: "item", label: "Item", width: "46%" },
            { key: "quantity", label: "Qty", align: "right", width: "12%" },
            { key: "price", label: `Price (${currency})`, align: "right", width: "14%" },
            { key: "discount", label: "Discount", align: "right", width: "14%" },
            { key: "total", label: "Amount", align: "right", width: "14%" },
          ],
          rows: lines.map((line) => ({ item: line.description, quantity: Number(line.quantity), price: amount(line.unit_price), discount: Number(line.discount_amount) ? amount(line.discount_amount) : "", total: amount(line.line_total) })),
        },
        totals: [
          { label: "Subtotal", value: amount(sale.subtotal) },
          ...(Number(sale.discount_total) ? [{ label: "Discount", value: `-${amount(sale.discount_total)}` }] : []),
          { label: "Tax", value: amount(sale.tax_total) },
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
          ...(quote.customer_notes ? [{ label: "Notes", text: quote.customer_notes }] : []),
          ...(quote.terms_and_conditions ? [{ label: "Terms and conditions", text: quote.terms_and_conditions }] : []),
        ],
        footer: quote.quotation_number,
      };
    },
    fileName: (data) => `quotation-${data.quotation.quotation_number}`,
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

export function getDocumentRenderer(key) {
  return DOCUMENT_RENDERERS.find((renderer) => renderer.key === key) ?? null;
}

/**
 * Loads (with the module's own authorization), builds and renders one
 * document. The caller has already checked module access and the renderer's
 * permission; the module read re-checks its own permission and scope.
 */
export async function renderAuthorizedDocument(client, session, key, id) {
  const renderer = getDocumentRenderer(key);
  if (!renderer) throw Object.assign(new Error("Unknown document."), { status: 404, code: "DOCUMENT_RENDERER_UNKNOWN" });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) throw Object.assign(new Error("Document not found."), { status: 404, code: "DOCUMENT_NOT_FOUND" });
  const data = await renderer.load(client, session, id);
  const model = await renderer.toModel(client, session, data);
  const { renderDocumentPdf, safePdfFileName } = await import("@vercentlabs/document-engine/pdf");
  return { fileName: safePdfFileName(renderer.fileName(data)), body: await renderDocumentPdf(model) };
}
