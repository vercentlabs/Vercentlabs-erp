// Registered printable documents. Each renderer loads its record through the
// owning module's authoritative read - the SAME function (and therefore the
// same permission, store scope and margin redaction) the screen uses
// - then builds a plain document model for @vercentlabs/document-engine/pdf.
// A PDF is a presentation of the record, never a new source of truth. There
// is no arbitrary template, HTML, file path or SQL input.
import { formatDateTime } from "@vercentlabs/localization";

import { getPosSaleReceipt } from "../../modules/point-of-sale/transaction-continuity-and-documents/receipts.js";
import { getRefundVoucher } from "../../modules/accounting/index.js";
import { getCreditNoteDocument, getDeliveryNote, getOrderConfirmation, getQuotation, getReturnNote, getSalesInvoiceDocument, getSalesOrder } from "../../modules/sales/index.js";

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

// The payment terms as the customer reads them: what the term says (its description) and anything added for this
// document. When payment is due, never where or how to pay, and never internal notes.
const paymentTermNotes = (snapshot) => {
  const text = [snapshot?.description, snapshot?.note].filter(Boolean).join("\n");
  return text ? [{ label: `Payment terms: ${snapshot.name ?? ""}`.trim(), text }] : [];
};

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
        item: [line.item_name_snapshot, line.description_snapshot && line.description_snapshot !== line.item_name_snapshot ? line.description_snapshot : null].filter(Boolean).join(" · "),
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

// The (Tax) Invoice, from the invoice's own snapshots: the seller registration,
// the customer and addresses as invoiced, the place of supply, each line with
// its HSN/SAC and tax components, and the totals. Internal notes are never printed.
function salesInvoiceModel(data) {
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
        item: [line.item_name_snapshot, line.description_snapshot && line.description_snapshot !== line.item_name_snapshot ? line.description_snapshot : null,
          line.hsn_sac_code ? `${line.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${line.hsn_sac_code}` : null].filter(Boolean).join(" · "),
        quantity: `${Number(line.quantity)} ${line.uom_snapshot ?? ""}`.trim(),
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
    footer: `${invoice.invoice_number}${invoice.sales_order_number ? ` · ${invoice.sales_order_number}` : ""}`,
  };
}

// The Credit Note: titled CREDIT NOTE, naming the original invoice (number and
// date), the reason, the lines credited with HSN/SAC and their tax components,
// and the totals, all from the credit note's own snapshots. Never internal
// notes, never how the credit was applied.
function creditNoteModel(data) {
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
    footer: `${creditNote.invoice_number} · against invoice ${creditNote.source_invoice_number}`,
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
          ...paymentTermNotes(quote.payment_term_snapshot),
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
    key: "sales.invoice",
    moduleKey: "sales",
    permission: "sales.invoice.print",
    label: "Sales invoice",
    async load(client, session, id) {
      return getSalesInvoiceDocument(client, salesContext(session), id);
    },
    async toModel(_client, _session, data) {
      return salesInvoiceModel(data);
    },
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
    async toModel(_client, _session, data) {
      return creditNoteModel(data);
    },
    fileName: (data) => `Credit-Note-${data.creditNote.invoice_number}${data.creditNote.status === "draft" ? "-draft" : ""}`,
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
