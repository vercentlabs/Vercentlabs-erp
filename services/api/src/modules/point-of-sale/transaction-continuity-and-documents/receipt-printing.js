// POS Receipt Printing (migration 0096). A completed sale or return has one finalized document: its content is frozen the first time it is
// issued (seller, outlet, buyer, lines, tax, discounts, totals, payments or refunds — exactly as the sale recorded them, never recalculated)
// and kept with a content hash. Preview and print come from that same snapshot, rendered here for an 80 mm or 58 mm thermal roll or A4 —
// the browser never computes a price, a tax or a total. Printing has its own lifecycle (print jobs) and can never change the sale, the
// payment, the stock or the invoice number: a print failure is a print failure. A browser cannot tell whether paper came out, so a job sent
// to the browser's print dialog is DISPATCHED, never "printed"; a second print of a document is a COPY (RECEIPT_REPRINT); an automatic print
// happens once per document version, whatever the number of retries. All text is escaped: item names, buyer names and footer text are data.
import { createHash } from "node:crypto";

import { decimal, formatDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { assertPosAction } from "../permissions/index.js";
import { event } from "../shared/audit.js";

export const POS_RECEIPT_MESSAGES = Object.freeze({
  POS_RECEIPT_SALE_NOT_FINALIZED: "Complete the sale before printing the receipt.",
  POS_RECEIPT_DOCUMENT_NOT_FOUND: "Transaction could not be found.",
  POS_RECEIPT_DOCUMENT_INVALID: "Original receipt is unavailable. Ask an administrator to recover the document — it is never rebuilt from today's prices or tax.",
  POS_RECEIPT_PERMISSION_DENIED: "You do not have permission to print this receipt.",
  POS_RECEIPT_REPRINT_PERMISSION_DENIED: "You do not have permission to reprint this receipt.",
  POS_RECEIPT_PRINTER_NOT_CONFIGURED: "No receipt printer is configured.",
  POS_RECEIPT_PRINTER_ACCESS_DENIED: "This printer is not available for your counter.",
  POS_RECEIPT_BRIDGE_UNAVAILABLE: "Printer connection is unavailable. Use browser printing.",
  POS_RECEIPT_OUTCOME_UNKNOWN: "Check whether the receipt printed before trying again.",
  POS_RECEIPT_PRINT_JOB_DUPLICATE: "This print request has already been submitted.",
  POS_RECEIPT_UNSUPPORTED_WIDTH: "The selected printer does not support this paper size.",
  POS_RECEIPT_VERSION_CONFLICT: "This document version is no longer the requested version.",
  POS_RECEIPT_PRINTER_INVALID: "The printer settings are not valid.",
  // Receipt Reprinting (0097)
  POS_RECEIPT_REPRINT_DOCUMENT_NOT_FINALIZED: "This receipt is not finalized.",
  POS_RECEIPT_REPRINT_DOCUMENT_SUPERSEDED: "This document has been replaced. Review its status.",
  POS_RECEIPT_REPRINT_OUTLET_DENIED: "This transaction is not available for your outlet.",
  POS_RECEIPT_REPRINT_DISPATCH_FAILED: "Receipt could not be sent to the printer.",
  POS_RECEIPT_REPRINT_IDEMPOTENCY_CONFLICT: "This request conflicts with an earlier print request.",
  POS_RECEIPT_REPRINT_REASON_REQUIRED: "Select a reason for this reprint.",
  POS_RECEIPT_REPRINT_DOCUMENT_VERSION_INVALID: "The requested document version is not available.",
});
const receiptError = (status, code, message = POS_RECEIPT_MESSAGES[code]) => posError(status, message, code);
const RENDER_VERSION = "receipt-html-1";
const FINAL_SALE_STATUSES = ["completed", "partially_returned", "returned"];
const posAdministrator = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");
const money = (value) => (value === null || value === undefined ? null : formatDecimal(decimal(String(value)), 2));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lookupReferenceFor = (organizationId, sourceId) => `POSR${createHash("sha256").update(`${organizationId}:${sourceId}`).digest("hex").slice(0, 10).toUpperCase()}`;
const DOCUMENT_TITLE = { tax_invoice: "TAX INVOICE", bill_of_supply: "BILL OF SUPPLY", invoice_cum_bill_of_supply: "TAX INVOICE CUM BILL OF SUPPLY", sale_receipt: "SALE RECEIPT",
  return_receipt: "RETURN RECEIPT", credit_note: "CREDIT NOTE" };

async function storeOf(client, context, storeId) {
  return (await client.query(
    `SELECT store.*, registration.legal_name AS registration_legal_name, registration.registration_number AS registration_gstin, registration.state_name AS registration_state
       FROM tenant.pos_stores store LEFT JOIN tenant.tax_registrations registration ON registration.organization_id = store.organization_id AND registration.id = store.tax_registration_id
      WHERE store.organization_id=$1 AND store.id=$2`, [context.organizationId, storeId])).rows[0];
}
const outletBlock = (store) => ({
  name: store.name, address: [store.address_line1, store.address_line2, store.city, store.state, store.postal_code].filter(Boolean).join(", ") || null,
  phone: store.phone ?? null, email: store.email ?? null,
});
function sellerBlock(sale, store) {
  const snapshot = sale.seller_tax_snapshot ?? {};
  return {
    legalName: snapshot.legalName ?? snapshot.legal_name ?? store.registration_legal_name ?? null,
    gstin: snapshot.registrationNumber ?? snapshot.registration_number ?? snapshot.gstin ?? store.registration_gstin ?? null,
    state: snapshot.stateName ?? snapshot.state_name ?? store.registration_state ?? null,
    stateCode: snapshot.stateCode ?? null,
    // The supplier's registered address (GST Invoice, 0098), as the registration held it when the sale was made.
    address: snapshot.address ?? null,
  };
}

// The sale's document as finalized: built once from the sale's own records and kept; later reads return the same snapshot.
async function buildSaleContent(client, context, sale, store) {
  const lines = (await client.query(
    `SELECT line.*, unit.code AS uom_code FROM tenant.pos_sale_lines line LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = line.organization_id AND unit.id = line.uom_id
      WHERE line.organization_id=$1 AND line.sale_id=$2 ORDER BY line.line_number`, [context.organizationId, sale.id])).rows;
  const payments = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND status NOT IN ('failed', 'voided') ORDER BY captured_at NULLS LAST, initiated_at`,
    [context.organizationId, sale.id])).rows;
  const cashier = (await client.query(`SELECT full_name FROM public.users WHERE id=$1`, [sale.created_by])).rows[0]?.full_name ?? null;
  const terminal = (await client.query(`SELECT name, code FROM tenant.pos_terminals WHERE organization_id=$1 AND id=$2`, [context.organizationId, sale.terminal_id])).rows[0];
  const buyerAddress = sale.billing_address_snapshot ?? null;
  const sum = (key) => money(lines.reduce((total, line) => total + Number(line[key] ?? 0), 0));
  return {
    seller: sellerBlock(sale, store), outlet: outletBlock(store), cashier, terminal: terminal ? `${terminal.code ?? ""} ${terminal.name ?? ""}`.trim() : null,
    buyer: {
      mode: sale.customer_mode === "registered" ? "registered" : "walk_in", name: sale.buyer_name_snapshot ?? sale.customer_name ?? null,
      gstin: sale.buyer_tax_details?.gstin ?? sale.buyer_tax_details?.registrationNumber ?? null,
      address: buyerAddress ? [buyerAddress.line1, buyerAddress.line2, buyerAddress.city, buyerAddress.state, buyerAddress.postalCode ?? buyerAddress.postal_code].filter(Boolean).join(", ") : null,
      placeOfSupply: sale.place_of_supply_snapshot ?? null,
    },
    lines: lines.map((line) => ({
      description: line.description, sku: line.sku ?? null, hsn: line.hsn_sac_snapshot ?? null, quantity: formatDecimal(decimal(String(line.quantity)), 3).replace(/\.?0+$/, ""),
      uom: line.uom_code ?? null, rate: money(line.list_unit_price ?? line.unit_price), gross: money(line.gross_amount ?? Number(line.quantity) * Number(line.unit_price)),
      itemDiscount: money(line.manual_discount_amount), promotion: money(line.promotion_discount_amount), cartDiscount: money(line.cart_discount_amount ?? 0),
      itemDiscountLabel: line.manual_discount_type === "percent" && line.manual_discount_value ? `${Number(line.manual_discount_value)}%` : null,
      taxable: money(line.taxable_amount), taxRate: line.tax_rate === null ? null : String(Number(line.tax_rate)), tax: money(line.tax_amount), total: money(line.line_total),
      pricesIncludeTax: Boolean(line.price_includes_tax),
    })),
    totals: {
      subtotal: money(sale.subtotal), itemDiscounts: sum("manual_discount_amount"), promotions: sum("promotion_discount_amount"), cartDiscount: money(sale.cart_discount_amount ?? 0),
      cartDiscountLabel: sale.cart_discount_type === "percent" && sale.cart_discount_value ? `${Number(sale.cart_discount_value)}%` : null,
      discountTotal: money(sale.discount_total), taxable: money(sale.taxable_total), tax: money(sale.tax_total), rounding: money(sale.rounding_adjustment), grandTotal: money(sale.grand_total),
      paid: money(sale.paid_total), change: money(sale.change_total), currency: sale.currency_code ?? "INR",
    },
    taxBreakdown: Array.isArray(sale.tax_breakdown) ? sale.tax_breakdown.map((entry) => ({ type: entry.type, rate: String(Number(entry.rate)), taxable: money(entry.taxableAmount), tax: money(entry.taxAmount) })) : [],
    payments: payments.map((payment) => ({
      method: payment.payment_method, amount: money(payment.amount),
      cashReceived: payment.payment_method === "cash" ? money(payment.cash_received_amount) : null, change: payment.payment_method === "cash" ? money(payment.change_given_amount) : null,
      card: payment.card_last_four ? `${payment.card_network ?? "Card"} **** ${payment.card_last_four}` : null,
      reference: payment.provider_transaction_reference ? `UTR ${payment.provider_transaction_reference}` : payment.external_reference ? `Ref ${payment.external_reference}`
        : payment.provider_reference ? `Ref …${String(payment.provider_reference).slice(-8)}` : null,
      attested: payment.verification_status === "externally_attested",
    })),
    status: "PAID",
    footer: { message: store.receipt_message ?? null, returnPolicy: store.receipt_return_policy ?? null, support: store.receipt_support_text ?? null },
    showReferenceCode: store.receipt_reference_code_enabled !== false,
  };
}

async function buildReturnContent(client, context, ret, sale, store) {
  const lines = (await client.query(
    `SELECT rl.*, line.description, line.hsn_sac_snapshot, line.unit_price, line.tax_rate FROM tenant.pos_return_lines rl
       JOIN tenant.pos_sale_lines line ON line.organization_id = rl.organization_id AND line.id = rl.sale_line_id
      WHERE rl.organization_id=$1 AND rl.return_id=$2 ORDER BY line.line_number`, [context.organizationId, ret.id])).rows;
  const refunds = (await client.query(
    `SELECT component.refund_method AS payment_method, component.allocated_amount AS refund_amount, component.provider_refund_id AS provider_reference,
            CASE component.status WHEN 'succeeded' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS refund_status,
            CASE WHEN component.execution = 'manual' THEN NULL WHEN component.status IN ('submitted','processing') THEN 'processing' WHEN component.status = 'unknown' THEN 'unknown' END AS card_status
       FROM tenant.payment_refunds refund JOIN tenant.payment_refund_components component ON component.organization_id = refund.organization_id AND component.refund_id = refund.id
      WHERE refund.organization_id=$1 AND refund.source_type='pos_return' AND refund.source_id=$2 AND refund.status <> 'cancelled' AND component.status <> 'cancelled'
     UNION ALL
     SELECT legacy.payment_method, legacy.refund_amount, legacy.provider_reference, legacy.status, NULL FROM tenant.pos_return_payment_refunds legacy
      WHERE legacy.organization_id=$1 AND legacy.return_id=$2 AND legacy.refund_component_id IS NULL`, [context.organizationId, ret.id])).rows;
  return {
    seller: sellerBlock(sale, store), outlet: outletBlock(store), originalDocument: sale.receipt_number, reason: ret.reason ?? null,
    buyer: { mode: sale.customer_mode === "registered" ? "registered" : "walk_in", name: sale.buyer_name_snapshot ?? sale.customer_name ?? null, gstin: sale.buyer_tax_details?.gstin ?? null },
    lines: lines.map((line) => ({ description: line.description, hsn: line.hsn_sac_snapshot ?? null, quantity: String(Number(line.quantity)), rate: money(line.unit_price),
      taxable: money(line.taxable_amount), tax: money(line.tax_amount), total: money(line.refund_amount), discountReturned: money(line.discount_amount ?? 0) })),
    totals: { refund: money(ret.refund_total), tax: money(lines.reduce((sum, line) => sum + Number(line.tax_amount ?? 0), 0)), currency: sale.currency_code ?? "INR" },
    refunds: refunds.map((refund) => {
      const cardStatus = refund.card_status;
      // The refund as it stood when the return was posted (Returns, 0099): never "refunded" before it is.
      const status = refund.refund_status === "failed" || cardStatus === "failed" ? "Refund failed — the store will retry"
        : refund.payment_method === "cash" ? (refund.refund_status === "completed" ? "Refunded in cash" : "Cash refund to be paid at the counter")
        : refund.refund_status === "completed" || cardStatus === "succeeded" ? "Refunded"
        : ["requested", "processing", "unknown", "reconciliation_required"].includes(cardStatus) ? "Refund initiated — processing" : "Refund to be made by the store";
      return { method: refund.payment_method, amount: money(refund.refund_amount), status, reference: refund.provider_reference ? `Ref …${String(refund.provider_reference).slice(-8)}` : null };
    }),
    footer: { message: store.receipt_message ?? null, returnPolicy: store.receipt_return_policy ?? null, support: store.receipt_support_text ?? null },
    showReferenceCode: store.receipt_reference_code_enabled !== false,
  };
}

// The finalized document of a sale (pos_sale) or a return (pos_return): the existing snapshot, or — the first time — built and frozen.
// options.version: a specific issued version (a reprint copies the version asked for, never a newer one). options.atCompletion: issued by the
// sale or return completing — the receipt as issued at the counter; otherwise the snapshot is kept from the sale record the first time it is
// asked for (sales completed before receipts were kept), and says so. A document's lifecycle status (finalized / superseded) never hides it.
export async function resolvePosDocument(client, context, sourceType, sourceId, options = {}) {
  requirePermission(context, "pos.view");
  if (!["pos_sale", "pos_return"].includes(sourceType)) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
  if (options.version !== undefined && options.version !== null) {
    const exact = (await client.query(`SELECT * FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND source_type=$2 AND source_id=$3 AND document_version=$4`,
      [context.organizationId, sourceType, sourceId, Number(options.version)])).rows[0];
    if (!exact) throw receiptError(404, "POS_RECEIPT_REPRINT_DOCUMENT_VERSION_INVALID");
    await assertPosStoreAccess(client, context, exact.store_id);
    return exact;
  }
  const existing = (await client.query(
    `SELECT * FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY (status = 'finalized') DESC, document_version DESC LIMIT 1`,
    [context.organizationId, sourceType, sourceId])).rows[0];
  if (existing) { await assertPosStoreAccess(client, context, existing.store_id); return existing; }
  let content, store, documentType, documentNumber, issuedAt;
  if (sourceType === "pos_sale") {
    const sale = (await client.query(`SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, sourceId])).rows[0];
    if (!sale) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
    await assertPosStoreAccess(client, context, sale.store_id);
    if (!FINAL_SALE_STATUSES.includes(sale.status)) throw receiptError(409, sale.status === "voided" ? "POS_RECEIPT_REPRINT_DOCUMENT_SUPERSEDED" : "POS_RECEIPT_SALE_NOT_FINALIZED");
    store = await storeOf(client, context, sale.store_id);
    content = await buildSaleContent(client, context, sale, store);
    documentType = ["tax_invoice", "bill_of_supply", "invoice_cum_bill_of_supply"].includes(sale.tax_document_type) ? sale.tax_document_type : "sale_receipt";
    documentNumber = sale.invoice_number ?? sale.receipt_number;
    issuedAt = sale.completed_at ?? sale.created_at;
    content.invoice = await invoiceBlock(client, context, sale.gst_invoice_id, sale.receipt_number);
  } else {
    const ret = (await client.query(`SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2`, [context.organizationId, sourceId])).rows[0];
    if (!ret) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
    if (ret.status !== "completed") throw receiptError(409, "POS_RECEIPT_SALE_NOT_FINALIZED", "Complete the return before printing its receipt.");
    const sale = (await client.query(`SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, ret.sale_id])).rows[0];
    await assertPosStoreAccess(client, context, sale.store_id);
    store = await storeOf(client, context, sale.store_id);
    content = await buildReturnContent(client, context, ret, sale, store);
    // A return of a sale with a tax invoice is documented by its credit note (GST Invoice, 0098); otherwise by a return receipt.
    documentType = ret.credit_note_number ? "credit_note" : "return_receipt";
    documentNumber = ret.credit_note_number ?? ret.return_number;
    content.originalDocument = sale.invoice_number ?? sale.receipt_number;
    content.originalDocumentDate = sale.completed_at ?? sale.created_at;
    content.invoice = ret.credit_note_id ? await invoiceBlock(client, context, ret.credit_note_id, ret.return_number) : null;
    issuedAt = ret.completed_at ?? ret.created_at;
  }
  if (!documentNumber || !content.lines.length) throw receiptError(409, "POS_RECEIPT_DOCUMENT_INVALID");
  content.provenance = options.atCompletion ? "issued" : "sale_record";
  const reference = lookupReferenceFor(context.organizationId, sourceId);
  const inserted = (await client.query(
    `INSERT INTO tenant.pos_document_snapshots (organization_id, store_id, source_type, source_id, document_type, document_number, lookup_reference, issued_at, timezone, content, content_hash, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT (organization_id, source_type, source_id, document_version) DO NOTHING RETURNING *`,
    [context.organizationId, store.id, sourceType, sourceId, documentType, documentNumber, reference, issuedAt, store.timezone || "Asia/Kolkata", JSON.stringify(content), hash(content), context.userId])).rows[0];
  return inserted ?? (await client.query(`SELECT * FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY document_version DESC LIMIT 1`,
    [context.organizationId, sourceType, sourceId])).rows[0];
}

// The statutory particulars of an issued invoice / credit note, for the printed document.
async function invoiceBlock(client, context, invoiceId, reference) {
  if (!invoiceId) return null;
  const invoice = (await client.query(`SELECT * FROM tenant.gst_invoices WHERE organization_id=$1 AND id=$2`, [context.organizationId, invoiceId])).rows[0];
  if (!invoice) return null;
  const hsn = (await client.query(
    `SELECT COALESCE(hsn_sac, '—') AS hsn, tax_rate::text AS rate, sum(taxable_amount)::text AS taxable, sum(cgst_amount)::text AS cgst, sum(sgst_amount + utgst_amount)::text AS sgst,
            sum(igst_amount)::text AS igst, sum(cess_amount)::text AS cess
       FROM tenant.gst_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 GROUP BY 1, 2 ORDER BY 1, 2`, [context.organizationId, invoiceId])).rows;
  return {
    number: invoice.invoice_number, reference, financialYear: invoice.financial_year, supplyType: invoice.supply_type, reverseCharge: invoice.reverse_charge,
    placeOfSupplyCode: invoice.place_of_supply_code, placeOfSupplyName: invoice.place_of_supply_name, einvoiceStatus: invoice.einvoice_status, irn: invoice.irn ?? null,
    totals: { cgst: money(invoice.cgst_total), sgst: money(invoice.sgst_total), utgst: money(invoice.utgst_total), igst: money(invoice.igst_total), cess: money(invoice.cess_total) },
    hsnSummary: hsn.map((row) => ({ hsn: row.hsn, rate: row.rate === null ? null : String(Number(row.rate)), taxable: money(row.taxable), cgst: money(row.cgst), sgst: money(row.sgst),
      igst: money(row.igst), cess: money(row.cess) })),
  };
}

// Issue the document as the sale or return completes, so the receipt is frozen at the counter. It never stops the sale: a failure here is
// recorded and the receipt is kept from the sale record when first asked for.
export async function issuePosDocument(client, context, sourceType, sourceId) {
  await client.query("SAVEPOINT pos_document_issue");
  try {
    await resolvePosDocument(client, context, sourceType, sourceId, { atCompletion: true });
    await client.query("RELEASE SAVEPOINT pos_document_issue");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_document_issue");
    await event(client, context, sourceType, sourceId, "pos.receipt.issue_failed", { code: error?.code ?? null }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ rendering (one renderer for preview and print)

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const rupee = (value, currency = "INR") => (value === null || value === undefined ? "" : `${currency === "INR" ? "₹" : `${currency} `}${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const METHOD_LABEL = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet", bank_transfer: "Bank transfer", store_credit: "Store credit" };

// Code 128 (set B) for the receipt reference, drawn as SVG: scanned at the counter to find the sale for a return. Never a payment code.
const CODE128 = ["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323",
  "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113",
  "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232"];
const CODE128_STOP = "2331112";
export function code128Svg(text, { height = 40, module = 1.4 } = {}) {
  const values = [...String(text)].map((char) => char.charCodeAt(0) - 32);
  if (values.some((value) => value < 0 || value > 94)) throw new Error("Code 128 B supports printable ASCII only.");
  const checksum = (104 + values.reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;
  const widths = [CODE128[104], ...values.map((value) => CODE128[value]), CODE128[checksum], CODE128_STOP].join("");
  let x = 10 * module;
  let bars = "";
  [...widths].forEach((width, index) => {
    const w = Number(width) * module;
    if (index % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`;
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(x + 10 * module).toFixed(2)} ${height}" width="100%" height="${height}" role="img" aria-label="${escapeHtml(text)}">${bars}</svg>`;
}

function renderBody(document, copyLabel, reprintedAt = null) {
  const c = document.content;
  const currency = c.totals?.currency ?? "INR";
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: document.timezone || "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(document.issued_at));
  const row = (label, value, strong = false) => `<div class="row${strong ? " strong" : ""}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  const parts = [];
  if (copyLabel === "copy") parts.push(`<div class="copy">COPY — REPRINTED</div>`);
  if (copyLabel === "merchant_copy") parts.push(`<div class="copy">MERCHANT COPY</div>`);
  parts.push(`<div class="center strong big">${escapeHtml(c.outlet.name)}</div>`);
  if (c.seller.legalName && c.seller.legalName !== c.outlet.name) parts.push(`<div class="center">${escapeHtml(c.seller.legalName)}</div>`);
  if (c.outlet.address) parts.push(`<div class="center small">${escapeHtml(c.outlet.address)}</div>`);
  if (c.invoice && c.seller.address && c.seller.address !== c.outlet.address)
    parts.push(`<div class="center small">Regd. ${escapeHtml(c.seller.address)}${c.seller.state ? `, ${escapeHtml(c.seller.state)}` : ""}</div>`);
  if (c.outlet.phone) parts.push(`<div class="center small">Tel ${escapeHtml(c.outlet.phone)}</div>`);
  if (c.seller.gstin) parts.push(`<div class="center small">GSTIN ${escapeHtml(c.seller.gstin)}</div>`);
  parts.push(`<div class="center strong title">${escapeHtml(DOCUMENT_TITLE[document.document_type] ?? document.document_type)}</div>`);
  const numberLabel = { tax_invoice: "Invoice No", invoice_cum_bill_of_supply: "Invoice No", bill_of_supply: "Bill No", credit_note: "Credit note No", return_receipt: "Return" }[document.document_type] ?? "Receipt No";
  parts.push(row(numberLabel, document.document_number));
  if (c.invoice?.reference && c.invoice.reference !== document.document_number) parts.push(row(document.source_type === "pos_return" ? "Return ref" : "Sale ref", c.invoice.reference));
  if (c.originalDocument) parts.push(row(document.document_type === "credit_note" ? "Against invoice" : "Original invoice", c.originalDocument));
  if (document.document_type === "credit_note" && c.originalDocumentDate)
    parts.push(row("Invoice date", new Intl.DateTimeFormat("en-IN", { timeZone: document.timezone || "Asia/Kolkata", dateStyle: "medium" }).format(new Date(c.originalDocumentDate))));
  if (document.document_type === "credit_note" && c.reason) parts.push(row("Reason", c.reason));
  parts.push(row(copyLabel === "copy" ? "Original date" : "Date", when));
  if (copyLabel === "copy" && reprintedAt)
    parts.push(row("Reprinted", new Intl.DateTimeFormat("en-IN", { timeZone: document.timezone || "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(reprintedAt))));
  if (c.cashier) parts.push(row("Cashier", c.cashier));
  if (c.terminal) parts.push(row("Counter", c.terminal));
  if (c.buyer?.name || c.buyer?.gstin) {
    parts.push(`<div class="rule"></div>`);
    if (c.buyer.name) parts.push(row("Customer", c.buyer.name));
    if (c.buyer.gstin) parts.push(row("Customer GSTIN", c.buyer.gstin));
    if (c.buyer.address) parts.push(`<div class="small">${escapeHtml(c.buyer.address)}</div>`);
    if (c.buyer.placeOfSupply && !c.invoice) parts.push(row("Place of supply", c.buyer.placeOfSupply));
  }
  if (c.invoice) {
    parts.push(row("Place of supply", c.invoice.placeOfSupplyName ? `${c.invoice.placeOfSupplyName} (${c.invoice.placeOfSupplyCode})` : c.invoice.placeOfSupplyCode ?? "—"));
    parts.push(row("Reverse charge", c.invoice.reverseCharge ? "Yes" : "No"));
    if (c.invoice.irn) parts.push(row("IRN", c.invoice.irn));
  }
  parts.push(`<div class="rule"></div>`);
  for (const line of c.lines) {
    parts.push(`<div class="item"><div class="name">${escapeHtml(line.description)}</div>`);
    const detail = [line.hsn ? `HSN ${line.hsn}` : null, line.taxRate ? `GST ${line.taxRate}%` : null].filter(Boolean).join(" · ");
    parts.push(row(`${line.quantity}${line.uom ? ` ${line.uom}` : ""} × ${rupee(line.rate, currency)}`, rupee(line.gross ?? line.total, currency)));
    if (Number(line.itemDiscount) > 0) parts.push(row(`  Item discount${line.itemDiscountLabel ? ` (${line.itemDiscountLabel})` : ""}`, `−${rupee(line.itemDiscount, currency)}`));
    if (Number(line.promotion) > 0) parts.push(row("  Offer", `−${rupee(line.promotion, currency)}`));
    if (Number(line.discountReturned) > 0) parts.push(row("  Discount on returned item", `−${rupee(line.discountReturned, currency)}`));
    if (detail) parts.push(`<div class="small muted">${escapeHtml(detail)}</div>`);
    parts.push(`</div>`);
  }
  parts.push(`<div class="rule"></div>`);
  const t = c.totals;
  if (document.source_type === "pos_return") {
    parts.push(row("Tax reversed", rupee(t.tax, currency)));
    parts.push(row("Refund total", rupee(t.refund, currency), true));
    parts.push(`<div class="rule"></div>`);
    for (const refund of c.refunds) {
      parts.push(row(`${METHOD_LABEL[refund.method] ?? refund.method}`, rupee(refund.amount, currency)));
      parts.push(`<div class="small">${escapeHtml(refund.status)}${refund.reference ? ` · ${escapeHtml(refund.reference)}` : ""}</div>`);
    }
  } else {
    parts.push(row("Subtotal", rupee(t.subtotal, currency)));
    if (Number(t.itemDiscounts) > 0) parts.push(row("Item discounts", `−${rupee(t.itemDiscounts, currency)}`));
    if (Number(t.promotions) > 0) parts.push(row("Offers", `−${rupee(t.promotions, currency)}`));
    if (Number(t.cartDiscount) > 0) parts.push(row(`Cart discount${t.cartDiscountLabel ? ` (${t.cartDiscountLabel})` : ""}`, `−${rupee(t.cartDiscount, currency)}`));
    parts.push(row("Taxable value", rupee(t.taxable, currency)));
    for (const tax of c.taxBreakdown) parts.push(row(`${tax.type} ${tax.rate}% on ${rupee(tax.taxable, currency)}`, rupee(tax.tax, currency)));
    if (Number(t.rounding) !== 0) parts.push(row("Rounding", rupee(t.rounding, currency)));
    parts.push(row("Grand total", rupee(t.grandTotal, currency), true));
    parts.push(`<div class="rule"></div><div class="strong">Payment details</div>`);
    for (const payment of c.payments) {
      parts.push(row(METHOD_LABEL[payment.method] ?? payment.method, rupee(payment.amount, currency)));
      if (payment.cashReceived && Number(payment.change) > 0) parts.push(`<div class="small">Cash received ${escapeHtml(rupee(payment.cashReceived, currency))} · change ${escapeHtml(rupee(payment.change, currency))}</div>`);
      const extra = [payment.card, payment.reference, payment.attested ? "recorded at the counter" : null].filter(Boolean).join(" · ");
      if (extra) parts.push(`<div class="small">${escapeHtml(extra)}</div>`);
    }
    parts.push(`<div class="center strong status">${escapeHtml(c.status)}</div>`);
  }
  if (c.invoice?.hsnSummary?.length && document.wide) {
    parts.push(`<div class="rule"></div><table class="hsn"><thead><tr><th>HSN/SAC</th><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST/UTGST</th><th>IGST</th><th>Cess</th></tr></thead><tbody>`);
    for (const entry of c.invoice.hsnSummary)
      parts.push(`<tr><td>${escapeHtml(entry.hsn)}</td><td>${escapeHtml(entry.rate ?? "—")}%</td><td>${escapeHtml(rupee(entry.taxable, currency))}</td><td>${escapeHtml(rupee(entry.cgst, currency))}</td><td>${escapeHtml(rupee(entry.sgst, currency))}</td><td>${escapeHtml(rupee(entry.igst, currency))}</td><td>${escapeHtml(rupee(entry.cess, currency))}</td></tr>`);
    parts.push(`</tbody></table>`);
  }
  if (c.invoice) {
    parts.push(`<div class="small center">This is a computer-generated ${document.document_type === "credit_note" ? "credit note" : "invoice"}.</div>`);
    parts.push(`<div class="small" style="text-align:right">For ${escapeHtml(c.seller.legalName ?? c.outlet.name)}<br>Authorised signatory</div>`);
  }
  if (c.footer?.message) parts.push(`<div class="center">${escapeHtml(c.footer.message)}</div>`);
  if (c.footer?.returnPolicy) parts.push(`<div class="small center">${escapeHtml(c.footer.returnPolicy)}</div>`);
  if (c.footer?.support) parts.push(`<div class="small center">${escapeHtml(c.footer.support)}</div>`);
  if (c.showReferenceCode) parts.push(`<div class="code">${code128Svg(document.lookup_reference)}<div class="center small">${escapeHtml(document.lookup_reference)}</div></div>`);
  return `<section class="receipt">${parts.join("")}</section>`;
}

// A complete, self-contained HTML page for the browser's print dialog (or a print bridge): no script, no external resource.
export function renderReceiptHtml(document, { width = 80, copies = ["original"], reprintedAt = null } = {}) {
  const pageWidth = width === 210 ? "210mm" : `${width}mm`;
  const contentWidth = width === 58 ? "48mm" : width === 80 ? "72mm" : "180mm";
  const fontSize = width === 58 ? "10px" : width === 80 ? "11.5px" : "12px";
  const body = copies.map((label) => renderBody({ ...document, wide: width === 210 }, label, reprintedAt)).join(`<div class="cut"></div>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(document.document_number)}</title><style>
@page { size: ${width === 210 ? "A4" : `${pageWidth} auto`}; margin: ${width === 210 ? "12mm" : "2mm"}; }
* { box-sizing: border-box; } body { margin: 0; font-family: "Courier New", ui-monospace, monospace; font-size: ${fontSize}; color: #000; background: #fff; }
.receipt { width: ${contentWidth}; margin: 0 auto; padding: 2mm 0; } .row { display: flex; justify-content: space-between; gap: 6px; } .row span:last-child { text-align: right; white-space: nowrap; }
.row span:first-child { overflow-wrap: anywhere; } .center { text-align: center; } .strong { font-weight: 700; } .big { font-size: 1.25em; } .title { margin: 4px 0; letter-spacing: 1px; }
.small { font-size: 0.85em; } .muted { color: #333; } .rule { border-top: 1px dashed #000; margin: 4px 0; } .item { margin: 2px 0; } .name { overflow-wrap: anywhere; font-weight: 600; }
.status { margin: 6px 0; font-size: 1.2em; letter-spacing: 2px; } .copy { text-align: center; border: 1px solid #000; font-weight: 700; margin-bottom: 4px; }
.hsn { width: 100%; border-collapse: collapse; font-size: 0.85em; } .hsn th, .hsn td { border: 1px solid #000; padding: 2px 4px; text-align: right; } .hsn th:first-child, .hsn td:first-child { text-align: left; }
.code { margin-top: 6px; } .code svg { display: block; max-height: 40px; fill: #000; } .cut { page-break-after: always; border-top: 1px dotted #999; margin: 6mm 0; }
</style></head><body>${body}</body></html>`;
}

// ------------------------------------------------------------------ print jobs

const REPRINT_REASONS = Object.freeze({
  customer_request: "Customer requested a copy", receipt_lost: "Original receipt lost", printer_failed: "Printer failed", receipt_damaged: "Original receipt damaged",
  finance_verification: "Finance verification", audit_request: "Audit / compliance request", other: "Other",
});
export const POS_RECEIPT_REPRINT_REASONS = REPRINT_REASONS;

const jobView = (job, document = null) => ({
  id: job.id, status: String(job.status).toUpperCase(), requestType: job.request_type, copyLabel: job.copy_label, paperWidthMm: job.paper_width_mm, attempts: job.attempt_count,
  lastErrorCode: job.last_error_code ?? null, printerId: job.printer_id ?? null, terminalId: job.terminal_id ?? null, documentId: job.document_id ?? null,
  documentNumber: document?.document_number ?? null, documentVersion: job.document_version, reasonCode: job.reason_code ?? null, reasonNote: job.reason_note ?? null,
  originalPrintJobId: job.original_print_job_id ?? null, createdAt: job.created_at, dispatchedAt: job.dispatched_at ?? null, resolvedAt: job.resolved_at ?? null,
  originalDocumentPreserved: true,
  message: job.status === "ready" ? "Receipt is ready to print." : job.status === "dispatched" ? "Sent to the print dialog. Check the paper — the browser cannot confirm it printed."
    : job.status === "failed" ? POS_RECEIPT_MESSAGES[job.last_error_code] ?? "Receipt could not be printed." : job.status === "outcome_unknown" ? POS_RECEIPT_MESSAGES.POS_RECEIPT_OUTCOME_UNKNOWN : null,
});

async function defaultPrinter(client, context, terminalId) {
  if (!terminalId) return null;
  return (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND terminal_id=$2 AND default_for_terminal AND enabled`, [context.organizationId, terminalId])).rows[0] ?? null;
}

async function sourceOf(client, context, document) {
  return document.source_type === "pos_sale"
    ? (await client.query(`SELECT created_by, terminal_id, shift_id, status FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, document.source_id])).rows[0]
    : (await client.query(`SELECT ret.requested_by AS created_by, ret.terminal_id, ret.shift_id, ret.status FROM tenant.pos_returns ret WHERE ret.organization_id=$1 AND ret.id=$2`,
      [context.organizationId, document.source_id])).rows[0];
}

// What the person may do with this document. A receipt of the sale they just made is RECEIPT_PRINT; anything else — a copy, an older sale,
// another cashier's sale, any return — is a reprint: RECEIPT_REPRINT plus TRANSACTION_LOOKUP at the document's outlet.
async function mayPrint(client, context, document, { reprint }) {
  if (posAdministrator(context)) return true;
  try {
    if (!reprint) await assertPosAction(client, context, { permission: "RECEIPT_PRINT", outletId: document.store_id });
    else {
      await assertPosAction(client, context, { permission: "RECEIPT_REPRINT", outletId: document.store_id });
      await assertPosAction(client, context, { permission: "TRANSACTION_LOOKUP", outletId: document.store_id });
    }
    return true;
  } catch { return false; }
}
async function mayLookUp(client, context, document, source) {
  if (posAdministrator(context) || source?.created_by === context.userId) return true;
  try { await assertPosAction(client, context, { permission: "TRANSACTION_LOOKUP", outletId: document.store_id }); return true; } catch { return false; }
}
const printedCount = async (client, context, documentId) => (await client.query(
  `SELECT count(*)::int AS n FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND document_id=$2 AND request_type <> 'test' AND status NOT IN ('failed', 'cancelled')`,
  [context.organizationId, documentId])).rows[0].n;

// The original is printed once, by the cashier who made the sale, while their session is still open. Everything else is a copy.
async function isFreshPrint(client, context, document, source, printed) {
  if (document.source_type !== "pos_sale" || printed > 0 || source?.created_by !== context.userId || !source?.shift_id) return false;
  return Boolean((await client.query(`SELECT 1 FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2 AND status='open'`, [context.organizationId, source.shift_id])).rows[0]);
}

async function addAttempt(client, context, job, { adapter, status, errorCode = null, confirmedNotPrinted = false }) {
  await client.query(
    `INSERT INTO tenant.pos_receipt_print_attempts (organization_id, print_job_id, attempt_number, adapter, status, error_code, confirmed_not_printed, completed_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5 IN ('failed','cancelled') THEN now() END,$8) ON CONFLICT (organization_id, print_job_id, attempt_number) DO NOTHING`,
    [context.organizationId, job.id, job.attempt_count, adapter, status, errorCode, confirmedNotPrinted, context.userId]);
}

// A preview: the finalized document rendered for a width (58 / 80 / 210 mm), changing nothing. asCopy shows it as a reprint would print.
// Looking at another cashier's or an older sale is a transaction lookup and is recorded.
export async function previewPosReceipt(client, context, sourceType, sourceId, input = {}) {
  const document = await resolvePosDocument(client, context, sourceType, sourceId, { version: input.version });
  const source = await sourceOf(client, context, document);
  if (!(await mayLookUp(client, context, document, source))) throw receiptError(403, "POS_RECEIPT_REPRINT_OUTLET_DENIED");
  const width = [58, 80, 210].includes(Number(input.width)) ? Number(input.width) : 80;
  if (source?.created_by !== context.userId) await event(client, context, sourceType, sourceId, "pos.receipt.previewed", { documentId: document.id, version: document.document_version });
  return { document: documentSummary(document), lifecycle: await lifecycleOf(client, context, document, source), width,
    html: renderReceiptHtml(document, { width, copies: [input.asCopy ? "copy" : "original"], reprintedAt: input.asCopy ? new Date() : null }) };
}
const documentSummary = (document) => ({ id: document.id, type: document.document_type, number: document.document_number, version: document.document_version, issuedAt: document.issued_at,
  lookupReference: document.lookup_reference, hash: document.content_hash, status: document.status, sourceType: document.source_type, sourceId: document.source_id,
  provenance: document.content?.provenance ?? "sale_record" });

// The document's standing today, shown before a copy is shared: cancelled / superseded documents, a sale later returned, and receipts
// rebuilt from the sale record (issued before receipts were kept) are all called out — never silently presented as current.
async function lifecycleOf(client, context, document, source) {
  const warnings = [];
  if (document.status === "superseded" || source?.status === "voided")
    warnings.push({ code: "POS_RECEIPT_REPRINT_DOCUMENT_SUPERSEDED", message: "This document was subsequently cancelled/superseded. Review its status before sharing a copy." });
  if (document.source_type === "pos_sale" && ["partially_returned", "returned"].includes(source?.status))
    warnings.push({ code: "POS_RECEIPT_SALE_RETURNED", message: "Items from this sale were later returned. This copy shows the original sale; the return has its own receipt." });
  if ((document.content?.provenance ?? "sale_record") === "sale_record")
    warnings.push({ code: "POS_RECEIPT_REBUILT_FROM_SALE", message: "This receipt was kept from the sale record (it was not issued at the counter). Lines, prices, tax and payments are the sale's; the outlet header is as it was when first kept." });
  return { documentStatus: document.status, sourceStatus: source?.status ?? null, warnings };
}

// Whether this person may print or reprint this document now, the printers they may use, and whether a reason is needed.
export async function getPosReceiptReprintEligibility(client, context, sourceType, sourceId, input = {}) {
  const document = await resolvePosDocument(client, context, sourceType, sourceId);
  const source = await sourceOf(client, context, document);
  const printed = await printedCount(client, context, document.id);
  const fresh = await isFreshPrint(client, context, document, source, printed);
  const settings = (await client.query(`SELECT receipt_reprint_reason_required FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0];
  const printers = (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND store_id=$2 AND enabled ORDER BY default_for_terminal DESC, display_name`,
    [context.organizationId, document.store_id])).rows.map(printerView);
  const terminalId = input.terminalId ?? null;
  return {
    document: documentSummary(document), lifecycle: await lifecycleOf(client, context, document, source), timesPrinted: printed,
    nextPrint: fresh ? "original" : "copy", canPrintOriginal: fresh && (await mayPrint(client, context, document, { reprint: false })),
    canReprint: await mayPrint(client, context, document, { reprint: true }), reasonRequired: Boolean(settings?.receipt_reprint_reason_required),
    reasons: Object.entries(REPRINT_REASONS).map(([code, label]) => ({ code, label })), printers,
    defaultPrinterId: printers.find((printer) => printer.terminalId === terminalId && printer.isDefault)?.id ?? null,
  };
}

// Ask to print a document. input: printerId (optional: the terminal's default; none = browser), terminalId (the counter printing now — may
// differ from the one that sold), width, requestType ("auto", "manual", or "reprint" — any print after the first is a reprint anyway),
// documentVersion (the issued version to copy), reasonCode / reasonNote (a reprint's reason; required when the company says so),
// idempotencyKey (one per deliberate action: the same key and request returns the same job; the same key with a different request is
// refused). The answer carries the print-ready HTML. Nothing about the sale, its payments, stock or accounting changes.
export async function createPosReceiptPrintJob(client, context, sourceType, sourceId, input = {}) {
  requirePermission(context, "pos.view");
  const document = await resolvePosDocument(client, context, sourceType, sourceId, { version: input.documentVersion });
  const source = await sourceOf(client, context, document);
  const terminalId = input.terminalId ?? source?.terminal_id ?? null;
  const auto = input.requestType === "auto";
  const key = auto ? `${sourceId}:${document.id}:${document.document_version}:AUTO_PRINT` : String(input.idempotencyKey ?? "");
  if (!auto && key.length < 8) throw posError(400, "An idempotency key is required.", "IDEMPOTENCY_KEY_REQUIRED");
  const reasonCode = input.reasonCode ?? null;
  const reasonNote = input.reasonNote ? String(input.reasonNote).trim().slice(0, 200) || null : null;
  const fingerprint = hash({ sourceType, sourceId, version: input.documentVersion ?? null, printerId: input.printerId ?? null, terminalId: input.terminalId ?? null,
    width: input.width ? Number(input.width) : null, requestType: input.requestType ?? "manual", reasonCode, reasonNote });
  const replay = (await client.query(`SELECT * FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, key])).rows[0];
  if (replay) {
    if (!auto && replay.request_fingerprint && (replay.request_fingerprint !== fingerprint || replay.document_id !== document.id)) throw receiptError(409, "POS_RECEIPT_REPRINT_IDEMPOTENCY_CONFLICT");
    // Content is handed out again only to someone allowed to print it now.
    if (!(await mayPrint(client, context, document, { reprint: replay.copy_label === "copy" }))) throw receiptError(403, "POS_RECEIPT_REPRINT_PERMISSION_DENIED");
    return { job: jobView(replay, document), html: renderReceiptHtml(document, { width: replay.paper_width_mm, copies: copiesFor(replay), reprintedAt: replay.copy_label === "copy" ? replay.created_at : null }),
      replayed: true, lifecycle: await lifecycleOf(client, context, document, source) };
  }

  let printer = null;
  if (input.printerId) {
    printer = (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND id=$2 AND enabled`, [context.organizationId, input.printerId])).rows[0];
    if (!printer || printer.store_id !== document.store_id) throw receiptError(403, "POS_RECEIPT_PRINTER_ACCESS_DENIED");
  } else printer = await defaultPrinter(client, context, terminalId);
  if (auto && !(printer?.auto_print_enabled)) return { job: null, html: null, skipped: "Automatic printing is not set up for this counter." };
  const earlier = await printedCount(client, context, document.id);
  const reprint = !auto && (input.requestType === "reprint" || !(await isFreshPrint(client, context, document, source, earlier)));
  if (!(await mayPrint(client, context, document, { reprint }))) throw receiptError(403, reprint ? "POS_RECEIPT_REPRINT_PERMISSION_DENIED" : "POS_RECEIPT_PERMISSION_DENIED");
  if (reasonCode && !REPRINT_REASONS[reasonCode]) throw posError(400, "Choose one of the listed reasons.", "POS_RECEIPT_REPRINT_REASON_INVALID");
  if (reasonCode === "other" && !reasonNote) throw posError(400, "Describe the reason for this reprint.", "POS_RECEIPT_REPRINT_REASON_REQUIRED");
  if (reprint && !reasonCode) {
    const required = (await client.query(`SELECT receipt_reprint_reason_required FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.receipt_reprint_reason_required;
    if (required) throw receiptError(400, "POS_RECEIPT_REPRINT_REASON_REQUIRED");
  }
  const width = [58, 80, 210].includes(Number(input.width)) ? Number(input.width) : printer?.paper_width_mm ?? 80;
  if (printer && printer.paper_width_mm !== width && printer.printer_profile !== "a4_document" && width !== 210 && input.width) throw receiptError(409, "POS_RECEIPT_UNSUPPORTED_WIDTH");
  const bridge = printer && printer.connection_mode !== "browser";
  const original = reprint ? (await client.query(
    `SELECT id FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND document_id=$2 AND copy_label='original' AND request_type <> 'test' ORDER BY created_at LIMIT 1`,
    [context.organizationId, document.id])).rows[0]?.id ?? null : null;
  const copyLabel = reprint ? "copy" : "original";
  const now = new Date();
  const copies = copiesFor({ copies: printer?.copies ?? 1, merchant_copy: printer?.merchant_copy, copy_label: copyLabel });
  const html = renderReceiptHtml(document, { width, copies, reprintedAt: reprint ? now : null });
  const job = (await client.query(
    `INSERT INTO tenant.pos_receipt_print_jobs (organization_id, store_id, document_id, document_version, printer_id, terminal_id, request_type, copy_label, status, render_version,
       paper_width_mm, document_hash, idempotency_key, attempt_count, last_error_code, requested_by, resolved_at, reason_code, reason_note, original_print_job_id, request_fingerprint,
       render_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,CASE WHEN $9='failed' THEN now() END,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [context.organizationId, document.store_id, document.id, document.document_version, printer?.id ?? null, terminalId, auto ? "auto" : reprint ? "reprint" : "manual",
      copyLabel, bridge ? "failed" : "ready", RENDER_VERSION, width, document.content_hash, key, bridge ? "POS_RECEIPT_BRIDGE_UNAVAILABLE" : null, context.userId,
      reprint ? reasonCode : null, reprint ? reasonNote : null, original, fingerprint, createHash("sha256").update(html).digest("hex"), now])).rows[0];
  await addAttempt(client, context, job, { adapter: printer?.connection_mode ?? "browser", status: job.status, errorCode: job.last_error_code });
  await event(client, context, sourceType, sourceId, reprint ? "pos.receipt.reprint_requested" : "pos.receipt.print_job", { jobId: job.id, documentId: document.id,
    version: document.document_version, requestType: job.request_type, copy: copyLabel, printerId: printer?.id ?? null, terminalId, reasonCode: job.reason_code });
  return { job: jobView(job, document), html, fallback: bridge ? "browser" : null, lifecycle: await lifecycleOf(client, context, document, source) };
}
function copiesFor(job) {
  const base = Array.from({ length: Math.max(1, Number(job.copies ?? 1)) }, () => job.copy_label);
  return job.merchant_copy ? [...base, "merchant_copy"] : base;
}

// What happened in the browser: the print dialog opened (DISPATCHED — not proof of paper), it was cancelled, or it failed.
export async function reportPosReceiptPrintJob(client, context, jobId, input = {}) {
  requirePermission(context, "pos.view");
  const job = (await client.query(`SELECT * FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, jobId])).rows[0];
  if (!job) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND", "Print job not found.");
  await assertPosStoreAccess(client, context, job.store_id);
  const next = { dialog_opened: "dispatched", cancelled: "cancelled", failed: "failed", unknown: "outcome_unknown" }[input.outcome];
  if (!next) throw posError(400, "Report dialog_opened, cancelled, failed or unknown.", "POS_RECEIPT_OUTCOME_INVALID");
  const errorCode = next === "failed" ? String(input.errorCode ?? "POS_RECEIPT_REPRINT_DISPATCH_FAILED").slice(0, 60) : null;
  const saved = (await client.query(
    `UPDATE tenant.pos_receipt_print_jobs SET status=$3, dispatched_at=CASE WHEN $3='dispatched' THEN COALESCE(dispatched_at, now()) ELSE dispatched_at END,
            resolved_at=CASE WHEN $3 IN ('cancelled','failed') THEN now() ELSE resolved_at END, last_error_code=CASE WHEN $3='failed' THEN $4 ELSE last_error_code END,
            updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, jobId, next, errorCode])).rows[0];
  await client.query(
    `UPDATE tenant.pos_receipt_print_attempts SET status=$4, error_code=COALESCE($5, error_code), completed_at=CASE WHEN $4 IN ('dispatched','failed','cancelled','outcome_unknown') THEN now() END
      WHERE organization_id=$1 AND print_job_id=$2 AND attempt_number=$3`, [context.organizationId, jobId, saved.attempt_count, next, errorCode]);
  const document = job.document_id ? (await client.query(`SELECT source_type, source_id FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND id=$2`, [context.organizationId, job.document_id])).rows[0] : null;
  if (document && job.copy_label === "copy")
    await event(client, context, document.source_type, document.source_id, { dispatched: "pos.receipt.reprint_dispatched", failed: "pos.receipt.reprint_failed",
      outcome_unknown: "pos.receipt.reprint_outcome_unknown", cancelled: "pos.receipt.reprint_cancelled" }[next], { jobId, attempt: saved.attempt_count });
  return jobView(saved);
}

// Print a job again. If it may already have printed (dispatched / unknown), the cashier must say it did not (confirmNotPrinted) — a copy
// may already exist. The same document version, the same copy marking; a new attempt, never a new job, sale or payment.
export async function retryPosReceiptPrintJob(client, context, jobId, input = {}) {
  requirePermission(context, "pos.view");
  const job = (await client.query(`SELECT * FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, jobId])).rows[0];
  if (!job || !job.document_id) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND", "Print job not found.");
  await assertPosStoreAccess(client, context, job.store_id);
  if (["dispatched", "outcome_unknown", "acknowledged"].includes(job.status) && input.confirmNotPrinted !== true) throw receiptError(409, "POS_RECEIPT_OUTCOME_UNKNOWN");
  const document = (await client.query(`SELECT * FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND id=$2`, [context.organizationId, job.document_id])).rows[0];
  if (!document) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
  if (input.expectedDocumentVersion && Number(input.expectedDocumentVersion) !== Number(document.document_version)) throw receiptError(409, "POS_RECEIPT_VERSION_CONFLICT");
  if (!(await mayPrint(client, context, document, { reprint: job.copy_label === "copy" || job.requested_by !== context.userId })))
    throw receiptError(403, "POS_RECEIPT_REPRINT_PERMISSION_DENIED");
  const saved = (await client.query(
    `UPDATE tenant.pos_receipt_print_jobs SET status='ready', attempt_count=attempt_count+1, last_error_code=NULL, resolved_at=NULL, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, jobId])).rows[0];
  const printer = saved.printer_id ? (await client.query(`SELECT connection_mode FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND id=$2`, [context.organizationId, saved.printer_id])).rows[0] : null;
  await addAttempt(client, context, saved, { adapter: printer?.connection_mode ?? "browser", status: "ready", confirmedNotPrinted: Boolean(input.confirmNotPrinted) });
  await event(client, context, document.source_type, document.source_id, job.copy_label === "copy" ? "pos.receipt.reprint_retried" : "pos.receipt.print_retry",
    { jobId, attempt: saved.attempt_count, confirmedNotPrinted: Boolean(input.confirmNotPrinted) });
  return { job: jobView(saved, document), html: renderReceiptHtml(document, { width: saved.paper_width_mm, copies: [saved.copy_label], reprintedAt: saved.copy_label === "copy" ? saved.created_at : null }) };
}

export async function getPosReceiptPrintJob(client, context, jobId) {
  requirePermission(context, "pos.view");
  const job = (await client.query(`SELECT * FROM tenant.pos_receipt_print_jobs WHERE organization_id=$1 AND id=$2`, [context.organizationId, jobId])).rows[0];
  if (!job) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND", "Print job not found.");
  await assertPosStoreAccess(client, context, job.store_id);
  const attempts = (await client.query(`SELECT attempt_number, adapter, status, error_code, confirmed_not_printed, started_at, completed_at FROM tenant.pos_receipt_print_attempts
     WHERE organization_id=$1 AND print_job_id=$2 ORDER BY attempt_number`, [context.organizationId, jobId])).rows;
  return { ...jobView(job), attemptHistory: attempts.map((row) => ({ attempt: row.attempt_number, adapter: row.adapter, status: String(row.status).toUpperCase(), errorCode: row.error_code,
    confirmedNotPrinted: row.confirmed_not_printed, startedAt: row.started_at, completedAt: row.completed_at })) };
}

// Every print of a document: who, when, where, original or copy, why, how it ended — for people who may look the transaction up.
export async function listPosReceiptPrintHistory(client, context, sourceType, sourceId) {
  const document = await resolvePosDocument(client, context, sourceType, sourceId);
  const source = await sourceOf(client, context, document);
  if (!(await mayLookUp(client, context, document, source))) throw receiptError(403, "POS_RECEIPT_REPRINT_OUTLET_DENIED");
  const rows = (await client.query(
    `SELECT job.*, person.full_name AS requested_by_name, printer.display_name AS printer_name, terminal.code AS terminal_code FROM tenant.pos_receipt_print_jobs job
       LEFT JOIN public.users person ON person.id = job.requested_by LEFT JOIN tenant.pos_receipt_printers printer ON printer.organization_id = job.organization_id AND printer.id = job.printer_id
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = job.organization_id AND terminal.id = job.terminal_id
      WHERE job.organization_id=$1 AND job.document_id=$2 ORDER BY job.created_at DESC`, [context.organizationId, document.id])).rows;
  return { document: { id: document.id, number: document.document_number, type: document.document_type, version: document.document_version, lookupReference: document.lookup_reference },
    jobs: rows.map((row) => ({ ...jobView(row, document), requestedBy: row.requested_by_name, printerName: row.printer_name ?? "Browser", terminalCode: row.terminal_code ?? null,
      reasonLabel: row.reason_code ? REPRINT_REASONS[row.reason_code] : null })) };
}

// The sale (or return) a scanned receipt reference belongs to — only for people who may look transactions up at that outlet.
export async function resolvePosReceiptFromCode(client, context, code) {
  requirePermission(context, "pos.view");
  const reference = String(code ?? "").trim().toUpperCase();
  if (!/^POSR[0-9A-F]{10}$/.test(reference)) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
  const document = (await client.query(`SELECT * FROM tenant.pos_document_snapshots WHERE organization_id=$1 AND lookup_reference=$2 ORDER BY document_version DESC LIMIT 1`,
    [context.organizationId, reference])).rows[0];
  if (!document) throw receiptError(404, "POS_RECEIPT_DOCUMENT_NOT_FOUND");
  await assertPosStoreAccess(client, context, document.store_id);
  if (!posAdministrator(context)) await assertPosAction(client, context, { permission: "TRANSACTION_LOOKUP", outletId: document.store_id });
  const saleId = document.source_type === "pos_sale" ? document.source_id
    : (await client.query(`SELECT sale_id FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2`, [context.organizationId, document.source_id])).rows[0]?.sale_id ?? null;
  return { sourceType: document.source_type, sourceId: document.source_id, saleId, documentNumber: document.document_number, documentType: document.document_type };
}

// Reprint activity over a period: how many copies, by whom, why, how they ended, and documents copied again and again.
export async function getPosReprintSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") ? input.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? "") ? input.to : today;
  const outlets = await accessiblePosStoreIds(client, context);
  const values = [context.organizationId, from, to, outlets];
  const scope = `job.organization_id=$1 AND job.request_type='reprint' AND job.created_at >= $2::date AND job.created_at < $3::date + 1 AND ($4::uuid[] IS NULL OR job.store_id = ANY($4::uuid[]))`;
  const totals = (await client.query(
    `SELECT count(*)::int AS reprints, count(DISTINCT job.document_id)::int AS documents, count(*) FILTER (WHERE job.status='failed')::int AS failed,
            count(*) FILTER (WHERE job.status='outcome_unknown')::int AS unknown, count(*) FILTER (WHERE job.status='dispatched')::int AS dispatched
       FROM tenant.pos_receipt_print_jobs job WHERE ${scope}`, values)).rows[0];
  const byUser = (await client.query(
    `SELECT COALESCE(person.full_name, 'Unknown') AS name, count(*)::int AS reprints FROM tenant.pos_receipt_print_jobs job LEFT JOIN public.users person ON person.id = job.requested_by
      WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, values)).rows;
  const byReason = (await client.query(
    `SELECT COALESCE(job.reason_code, 'none') AS reason, count(*)::int AS reprints FROM tenant.pos_receipt_print_jobs job WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC`, values)).rows
    .map((row) => ({ ...row, label: REPRINT_REASONS[row.reason] ?? "No reason given" }));
  const frequent = (await client.query(
    `SELECT document.document_number AS number, document.source_type, document.source_id, count(*)::int AS reprints FROM tenant.pos_receipt_print_jobs job
       JOIN tenant.pos_document_snapshots document ON document.organization_id = job.organization_id AND document.id = job.document_id
      WHERE ${scope} GROUP BY 1, 2, 3 HAVING count(*) >= 3 ORDER BY 4 DESC LIMIT 10`, values)).rows;
  return { from, to, totals, byUser, byReason, frequent };
}

// ------------------------------------------------------------------ printers and branding (administrators)

const printerView = (row) => ({
  id: row.id, storeId: row.store_id, terminalId: row.terminal_id, name: row.display_name, connectionMode: row.connection_mode, profile: row.printer_profile, paperWidthMm: row.paper_width_mm,
  isDefault: row.default_for_terminal, autoPrint: row.auto_print_enabled, copies: row.copies, merchantCopy: row.merchant_copy, cutPaper: row.cut_paper, encoding: row.character_encoding,
  bridgeDeviceReference: row.bridge_device_reference, enabled: row.enabled, version: row.version,
  // A saved printer is not a connected printer: only a bridge could report that, and none is connected.
  connectionStatus: row.connection_mode === "browser" ? "browser" : "unknown",
});

export async function listPosReceiptPrinters(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  let filter = "";
  if (input.terminalId) { values.push(input.terminalId); filter = ` AND terminal_id=$${values.length}`; }
  const rows = (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1${filter} ORDER BY default_for_terminal DESC, display_name`, values)).rows;
  const allowed = [];
  for (const row of rows) { try { await assertPosStoreAccess(client, context, row.store_id); allowed.push(printerView(row)); } catch { /* another outlet */ } }
  return allowed;
}

// input: id (to change), terminalId, name, connectionMode, profile, paperWidthMm, isDefault, autoPrint, copies, merchantCopy, cutPaper,
// encoding, bridgeDeviceReference (a device name, never a URL or a path), enabled, expectedVersion.
export async function savePosReceiptPrinter(client, context, input = {}) {
  requirePermission(context, "pos.settings.manage");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 80) throw receiptError(400, "POS_RECEIPT_PRINTER_INVALID", "A printer needs a name (80 characters at most).");
  const mode = ["browser", "print_agent", "network_bridge"].includes(input.connectionMode) ? input.connectionMode : "browser";
  const width = [58, 80, 210].includes(Number(input.paperWidthMm)) ? Number(input.paperWidthMm) : 80;
  const bridge = input.bridgeDeviceReference ? String(input.bridgeDeviceReference).trim() : null;
  if (bridge && !/^[A-Za-z0-9._:-]{1,80}$/.test(bridge)) throw receiptError(400, "POS_RECEIPT_PRINTER_INVALID", "The bridge device reference is a device name (letters, digits, . _ : -), never a URL or a path.");
  if (mode !== "browser" && !bridge) throw receiptError(400, "POS_RECEIPT_PRINTER_INVALID", "A print agent or bridge printer needs its device reference.");
  const copies = Number.isInteger(Number(input.copies)) && Number(input.copies) >= 1 && Number(input.copies) <= 3 ? Number(input.copies) : 1;
  const profile = width === 210 ? "a4_document" : ["thermal_generic", "escpos"].includes(input.profile) ? input.profile : "thermal_generic";
  const encoding = ["utf-8", "cp437", "cp858"].includes(input.encoding) ? input.encoding : "utf-8";
  let row;
  if (input.id) {
    const existing = (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, input.id])).rows[0];
    if (!existing) throw receiptError(404, "POS_RECEIPT_PRINTER_NOT_CONFIGURED");
    await assertPosStoreAccess(client, context, existing.store_id);
    if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== existing.version) throw receiptError(409, "POS_RECEIPT_VERSION_CONFLICT", "This printer changed. Refresh and try again.");
    if (input.isDefault) await client.query(`UPDATE tenant.pos_receipt_printers SET default_for_terminal=false WHERE organization_id=$1 AND terminal_id=$2 AND id <> $3`, [context.organizationId, existing.terminal_id, existing.id]);
    row = (await client.query(
      `UPDATE tenant.pos_receipt_printers SET display_name=$3, connection_mode=$4, printer_profile=$5, paper_width_mm=$6, default_for_terminal=$7, auto_print_enabled=$8, copies=$9, merchant_copy=$10,
              cut_paper=$11, character_encoding=$12, bridge_device_reference=$13, enabled=$14, version=version+1, updated_by=$15, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, existing.id, name, mode, profile, width, Boolean(input.isDefault ?? existing.default_for_terminal), Boolean(input.autoPrint ?? existing.auto_print_enabled), copies,
        Boolean(input.merchantCopy ?? existing.merchant_copy), Boolean(input.cutPaper ?? existing.cut_paper), encoding, bridge, input.enabled ?? existing.enabled, context.userId])).rows[0];
  } else {
    const terminal = (await client.query(`SELECT id, store_id FROM tenant.pos_terminals WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.terminalId ?? null])).rows[0];
    if (!terminal) throw receiptError(404, "POS_RECEIPT_PRINTER_INVALID", "Choose the counter (POS terminal) this printer belongs to.");
    await assertPosStoreAccess(client, context, terminal.store_id);
    const first = !(await defaultPrinter(client, context, terminal.id));
    if (input.isDefault && !first) await client.query(`UPDATE tenant.pos_receipt_printers SET default_for_terminal=false WHERE organization_id=$1 AND terminal_id=$2`, [context.organizationId, terminal.id]);
    row = (await client.query(
      `INSERT INTO tenant.pos_receipt_printers (organization_id, store_id, terminal_id, display_name, connection_mode, printer_profile, paper_width_mm, default_for_terminal, auto_print_enabled, copies,
         merchant_copy, cut_paper, character_encoding, bridge_device_reference, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [context.organizationId, terminal.store_id, terminal.id, name, mode, profile, width, Boolean(input.isDefault ?? first), Boolean(input.autoPrint), copies, Boolean(input.merchantCopy),
        input.cutPaper !== false, encoding, bridge, context.userId])).rows[0];
  }
  await event(client, context, "receipt_printer", row.id, "pos.receipt_printer.saved", { name, mode, width, isDefault: row.default_for_terminal, autoPrint: row.auto_print_enabled });
  return printerView(row);
}

// A test page for a printer: clearly not a tax invoice, never a sale or a document number.
export async function testPosReceiptPrinter(client, context, printerId) {
  requirePermission(context, "pos.settings.manage");
  const printer = (await client.query(`SELECT * FROM tenant.pos_receipt_printers WHERE organization_id=$1 AND id=$2`, [context.organizationId, printerId])).rows[0];
  if (!printer) throw receiptError(404, "POS_RECEIPT_PRINTER_NOT_CONFIGURED");
  await assertPosStoreAccess(client, context, printer.store_id);
  const job = (await client.query(
    `INSERT INTO tenant.pos_receipt_print_jobs (organization_id, store_id, printer_id, terminal_id, request_type, copy_label, status, paper_width_mm, idempotency_key, attempt_count, requested_by)
     VALUES ($1,$2,$3,$4,'test','test',$5,$6,$7,1,$8) RETURNING *`,
    [context.organizationId, printer.store_id, printer.id, printer.terminal_id, printer.connection_mode === "browser" ? "ready" : "failed", printer.paper_width_mm, `test:${printer.id}:${Date.now()}`,
      context.userId])).rows[0];
  const width = printer.paper_width_mm;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Printer test</title><style>@page { size: ${width === 210 ? "A4" : `${width}mm auto`}; margin: 2mm; }
body { font-family: "Courier New", monospace; font-size: 11px; width: ${width === 58 ? "48mm" : width === 80 ? "72mm" : "180mm"}; margin: 0 auto; } .c { text-align: center; font-weight: 700; } .r { border-top: 1px dashed #000; margin: 4px 0; }</style></head>
<body><div class="c">VERCENTLABS ERP — PRINTER TEST</div><div class="c">NOT A TAX INVOICE</div><div class="r"></div><div>Printer: ${escapeHtml(printer.display_name)}</div><div>Paper: ${width === 210 ? "A4" : `${width} mm`}</div>
<div>Time: ${escapeHtml(new Date().toISOString())}</div><div class="r"></div><div>1234567890123456789012345678901234567890123456</div><div>The quick brown fox jumps over the lazy dog.</div><div>₹ 1,23,456.78</div>
<div class="r"></div>${code128Svg("TEST1234")}</body></html>`;
  return { job: jobView(job), html };
}

// The outlet's receipt branding: the message, the return policy, support text, and whether the scannable reference is printed.
export async function updatePosReceiptBranding(client, context, storeId, input = {}) {
  requirePermission(context, "pos.settings.manage");
  await assertPosStoreAccess(client, context, storeId);
  const clean = (value, max) => (value === undefined ? undefined : value === null ? null : String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) || null);
  const row = (await client.query(
    `UPDATE tenant.pos_stores SET receipt_message=CASE WHEN $9::boolean THEN $3 ELSE receipt_message END, receipt_return_policy=CASE WHEN $4::boolean THEN $5 ELSE receipt_return_policy END,
            receipt_support_text=CASE WHEN $6::boolean THEN $7 ELSE receipt_support_text END, receipt_reference_code_enabled=COALESCE($8, receipt_reference_code_enabled), updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING id, name, receipt_message, receipt_return_policy, receipt_support_text, receipt_reference_code_enabled`,
    [context.organizationId, storeId, clean(input.receiptMessage, 200) ?? null, input.returnPolicy !== undefined, clean(input.returnPolicy, 500) ?? null, input.supportText !== undefined,
      clean(input.supportText, 200) ?? null, input.referenceCodeEnabled ?? null, input.receiptMessage !== undefined])).rows[0];
  if (!row) throw posError(404, "Outlet not found.", "POS_STORE_NOT_FOUND");
  await event(client, context, "store", storeId, "pos.receipt_branding.updated", {});
  return { storeId: row.id, name: row.name, receiptMessage: row.receipt_message, returnPolicy: row.receipt_return_policy, supportText: row.receipt_support_text,
    referenceCodeEnabled: row.receipt_reference_code_enabled };
}

export async function getPosReceiptBranding(client, context, storeId) {
  requirePermission(context, "pos.view");
  await assertPosStoreAccess(client, context, storeId);
  const row = (await client.query(`SELECT id, name, receipt_message, receipt_return_policy, receipt_support_text, receipt_reference_code_enabled FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, storeId])).rows[0];
  if (!row) throw posError(404, "Outlet not found.", "POS_STORE_NOT_FOUND");
  return { storeId: row.id, name: row.name, receiptMessage: row.receipt_message, returnPolicy: row.receipt_return_policy, supportText: row.receipt_support_text,
    referenceCodeEnabled: row.receipt_reference_code_enabled };
}
