// POS GST Invoice (migration 0098): POS as one source of the shared invoicing (core/invoicing). The sale's own tax snapshot — written by the
// tax engine at completion and never changed — is what the invoice copies; nothing is recalculated here.
//
//  - Before payment: invoiceCheckoutIssues (a malformed customer GSTIN, a B2B supply that needs an IRN, a full or closed series) stops the
//    bill, so a payment is never taken for a document that cannot be issued. previewPosCartInvoice shows the document to come, with no number.
//  - At completion, in the same transaction as the sale: issuePosSaleInvoice takes the next number of the seller registration's series and
//    writes the invoice. If issuing fails the sale does not complete, the captured payment stays on the bill and checkout's finalisation
//    recovery applies; a retry issues the same single invoice (one per sale) — never a second one, never a skipped number.
//  - A return of a sale with a tax invoice issues its credit note (its own series), referencing the original invoice. Nothing edits an
//    issued invoice.
import {
  INVOICE_MESSAGES, InvoiceError, allocateInvoiceNumber, checkInvoiceNumbering, determineRequiredSalesDocument, evaluateEInvoiceApplicability, EINVOICE_PROVIDER_AVAILABLE,
  getGstInvoiceSummary, issueGstInvoice, reconcileGstInvoice, splitComponents, validateGstin,
} from "../../../core/invoicing/index.js";
import { decimal, formatDecimal } from "../../../core/decimal.js";
import { gstStateName } from "../../../core/tax/constants.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export const POS_INVOICE_MESSAGES = INVOICE_MESSAGES;
const asPos = (error) => (error instanceof InvoiceError ? posError(error.status, error.message, error.code) : error);
const money = (value) => (value === null || value === undefined ? null : formatDecimal(decimal(String(value)), 2));

async function buyerOf(client, context, customerId, billingAddressId = null) {
  if (!customerId) return null;
  const party = (await client.query(`SELECT gstin, tax_treatment FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, customerId])).rows[0];
  const billing = (await client.query(
    `SELECT gstin FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active' ORDER BY (id = $3::uuid) DESC, is_default_billing DESC, is_primary DESC, created_at LIMIT 1`,
    [context.organizationId, customerId, billingAddressId])).rows[0];
  const gstin = billing?.gstin || party?.gstin || null;
  return { gstin, registered: Boolean(gstin) && ["registered_regular", "registered_composition", "sez"].includes(party?.tax_treatment ?? "") };
}
const registrationRow = async (client, context, id) => (id
  ? (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id=$1 AND id=$2`, [context.organizationId, id])).rows[0] ?? null : null);

// Problems that would stop the invoice from being issued, found before payment. cart: the bill row; priced: the pricing result.
export async function invoiceCheckoutIssues(client, context, cart, priced) {
  if (!priced?.tax) return [];
  const issues = [];
  const buyer = cart.customer_mode === "registered" ? await buyerOf(client, context, cart.customer_id, cart.billing_address_id) : null;
  if (buyer?.gstin) {
    const check = validateGstin(buyer.gstin);
    if (!check.valid) issues.push({ code: "POS_INVOICE_GSTIN_INVALID", message: `${INVOICE_MESSAGES.POS_INVOICE_GSTIN_INVALID} ${buyer.gstin}: ${check.message} Correct it on the customer record.` });
  }
  const documentType = priced.tax.documentType;
  const decision = determineRequiredSalesDocument({ taxEnabled: priced.tax.taxEnabled, hasRegistration: Boolean(priced.tax.seller), registrationType: priced.tax.seller?.registrationType,
    classifications: priced.lines.map((line) => line.taxClassification) });
  if (decision.unsupported) issues.push({ code: "POS_INVOICE_DOCUMENT_TYPE_UNSUPPORTED", message: INVOICE_MESSAGES.POS_INVOICE_DOCUMENT_TYPE_UNSUPPORTED });
  if (decision.statutory && decision.kind) {
    const registration = await registrationRow(client, context, priced.tax.seller?.id);
    const einvoice = evaluateEInvoiceApplicability({ registration, supplyType: buyer?.registered ? "b2b" : "b2c", documentType, day: priced.tax.taxDate });
    if (einvoice.status === "required" && !EINVOICE_PROVIDER_AVAILABLE) issues.push({ code: "POS_INVOICE_EINVOICE_REQUIRED", message: INVOICE_MESSAGES.POS_INVOICE_EINVOICE_REQUIRED });
    const numbering = await checkInvoiceNumbering(client, context, { registrationId: priced.tax.seller?.id, kind: decision.kind });
    if (numbering) issues.push(numbering);
  }
  return issues;
}

// The document to come, from the bill as priced now: type, seller, buyer, place of supply, lines with HSN and tax, totals by component,
// e-invoice applicability — and no number (it is given when the sale completes).
export async function formatPosInvoicePreview(client, context, cart, priced, issues) {
  if (!priced) return { status: "INVALID", checkoutReady: false, issues, invoiceNumber: null };
  const buyer = cart.customer_mode === "registered" ? await buyerOf(client, context, cart.customer_id, cart.billing_address_id) : null;
  const registration = await registrationRow(client, context, priced.tax.seller?.id);
  const documentType = priced.tax.documentType;
  const supplyType = buyer?.registered ? "b2b" : "b2c";
  const components = {};
  for (const line of priced.lines) for (const component of line.taxComponents ?? []) components[component.type] = (components[component.type] ?? 0n) + decimal(String(component.taxAmount));
  return {
    status: issues.length ? "INVALID" : "VALID", checkoutReady: issues.length === 0, invoiceNumber: null, documentType,
    statutory: documentType !== "receipt",
    seller: priced.tax.seller ? { legalName: priced.tax.seller.legalName ?? priced.tax.seller.name, gstin: priced.tax.seller.gstin, stateCode: priced.tax.seller.stateCode,
      address: priced.tax.seller.address ?? null } : null,
    customerMode: cart.customer_mode === "registered" ? "REGISTERED" : "WALK_IN", supplyType: supplyType.toUpperCase(), buyerGstin: buyer?.gstin ?? null,
    buyerGstinCheck: buyer?.gstin ? validateGstin(buyer.gstin) : null,
    placeOfSupply: priced.tax.placeOfSupply ? { code: priced.tax.placeOfSupply, name: priced.tax.placeOfSupplyName } : null, reverseCharge: false, currency: cart.currency_code ?? "INR",
    lines: priced.lines.map((line) => ({ description: line.description, hsnSac: line.hsnSac ?? null, quantity: formatDecimal(decimal(String(line.quantity)), 3), uom: line.uomCode ?? null,
      taxableAmount: money(line.taxableAmount), classification: line.taxClassification, rate: line.taxRate === null || line.taxRate === undefined ? null : String(line.taxRate),
      taxAmount: money(line.taxAmount), total: money(line.lineTotal) })),
    taxableAmount: money(priced.tax.taxableTotal), taxes: Object.fromEntries(Object.entries(components).map(([type, value]) => [type, formatDecimal(value, 2)])),
    discountTotal: money(priced.totals.discountTotal), roundingAdjustment: money(priced.totals.roundingAdjustment), grandTotal: money(priced.totals.grandTotal),
    einvoiceApplicability: evaluateEInvoiceApplicability({ registration, supplyType, documentType, day: priced.tax.taxDate }).status.toUpperCase(), issues,
    note: "The invoice number and final issue time are given when the sale completes.",
  };
}

const lineFromSale = (line) => ({
  sourceLineId: line.id, itemId: line.item_id, description: line.description, hsnSac: line.hsn_sac_snapshot ?? null, uomCode: line.uom_code ?? null, quantity: line.quantity,
  unitPrice: line.list_unit_price ?? line.unit_price, priceIncludesTax: Boolean(line.price_includes_tax),
  grossAmount: line.gross_amount ?? formatDecimal((decimal(String(line.quantity)) * decimal(String(line.unit_price))) / 1000000n, 6),
  itemDiscount: line.manual_discount_amount ?? 0, promotionDiscount: Number(line.promotion_discount_amount ?? 0) + Number(line.coupon_discount_amount ?? 0), cartDiscount: line.cart_discount_amount ?? 0,
  taxableAmount: line.taxable_amount ?? 0, taxClassification: line.tax_classification ?? null, taxRate: line.tax_rate === null ? null : String(line.tax_rate), lineTotal: line.line_total,
  ...splitComponents(line.tax_components),
});

// Issue the sale's invoice (inside the completing transaction). A non-GST receipt has no statutory invoice: its receipt number is its number.
export async function issuePosSaleInvoice(client, context, saleId) {
  const sale = (await client.query(`SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, saleId])).rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  if (sale.gst_invoice_id) return (await client.query(`SELECT * FROM tenant.gst_invoices WHERE id=$1`, [sale.gst_invoice_id])).rows[0];
  if (!["tax_invoice", "bill_of_supply", "invoice_cum_bill_of_supply"].includes(sale.tax_document_type)) return null;
  const kind = sale.tax_document_type === "bill_of_supply" ? "bill_of_supply" : "tax_invoice";
  const registration = await registrationRow(client, context, sale.seller_tax_registration_id);
  if (!registration) throw posError(409, INVOICE_MESSAGES.POS_INVOICE_SELLER_REGISTRATION_MISSING, "POS_INVOICE_SELLER_REGISTRATION_MISSING");
  const buyerGstin = sale.buyer_tax_details?.gstin ?? null;
  const supplyType = sale.tax_treatment_snapshot === "b2b" && buyerGstin ? "b2b" : "b2c";
  if (supplyType === "b2b" && !validateGstin(buyerGstin).valid) throw posError(409, INVOICE_MESSAGES.POS_INVOICE_GSTIN_INVALID, "POS_INVOICE_GSTIN_INVALID");
  const lines = (await client.query(
    `SELECT line.*, unit.code AS uom_code FROM tenant.pos_sale_lines line LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = line.organization_id AND unit.id = line.uom_id
      WHERE line.organization_id=$1 AND line.sale_id=$2 ORDER BY line.line_number`, [context.organizationId, saleId])).rows;
  if (!lines.length) throw posError(409, INVOICE_MESSAGES.POS_INVOICE_TAX_INVALID, "POS_INVOICE_TAX_INVALID");
  for (const line of lines) if (!line.hsn_sac_snapshot && line.tax_classification !== "non_gst") throw posError(409, `${INVOICE_MESSAGES.POS_INVOICE_HSN_SAC_MISSING} ${line.description}`, "POS_INVOICE_HSN_SAC_MISSING");
  const day = sale.tax_date ? String(sale.tax_date instanceof Date ? sale.tax_date.toISOString() : sale.tax_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const einvoice = evaluateEInvoiceApplicability({ registration, supplyType, documentType: sale.tax_document_type, day });
  if (einvoice.status === "required" && !EINVOICE_PROVIDER_AVAILABLE) throw posError(409, INVOICE_MESSAGES.POS_INVOICE_EINVOICE_REQUIRED, "POS_INVOICE_EINVOICE_REQUIRED");
  try {
    const number = await allocateInvoiceNumber(client, context, { registrationId: registration.id, kind, at: sale.completed_at ?? null });
    const address = sale.billing_address_snapshot ?? null;
    const invoice = await issueGstInvoice(client, context, {
      sourceType: "pos_sale", sourceId: sale.id, storeId: sale.store_id, registrationId: registration.id, seriesId: number.seriesId, documentType: sale.tax_document_type,
      invoiceNumber: number.number, financialYear: number.financialYear, issuedAt: sale.completed_at ?? null, customerMode: sale.customer_mode === "registered" ? "registered" : "walk_in",
      customerId: sale.customer_id, supplyType, buyerGstin: supplyType === "b2b" ? buyerGstin : buyerGstin, seller: sale.seller_tax_snapshot ?? {},
      buyer: { name: sale.buyer_name_snapshot ?? sale.customer_name ?? null, gstin: buyerGstin, address, stateCode: sale.buyer_tax_details?.stateCode ?? address?.stateCode ?? null,
        customerCode: sale.customer_code_snapshot ?? null },
      placeOfSupplyCode: sale.place_of_supply_snapshot ?? null, placeOfSupplyName: gstStateName(sale.place_of_supply_snapshot) ?? null, supplyMode: sale.supply_mode_snapshot ?? null, currency: sale.currency_code ?? "INR",
      subtotal: sale.subtotal, discountTotal: sale.discount_total, taxableTotal: sale.taxable_total ?? 0, taxTotal: sale.tax_total, rounding: sale.rounding_adjustment,
      grandTotal: sale.grand_total, taxHash: sale.tax_calculation_hash ?? null, einvoiceStatus: einvoice.status,
    }, lines.map(lineFromSale));
    await client.query(`UPDATE tenant.pos_sales SET gst_invoice_id=$3, invoice_number=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, sale.id, invoice.id, invoice.invoice_number]);
    await event(client, context, "pos_sale", sale.id, "pos.invoice.issued", { invoiceId: invoice.id, number: invoice.invoice_number, documentType: invoice.document_type, supplyType });
    return invoice;
  } catch (error) { throw asPos(error); }
}

// A return of a sale with a tax invoice: its credit note (own series), referencing the original invoice and reversing exactly the returned
// lines' taxable value and tax as recorded on the return (from the original snapshot).
export async function issuePosReturnCreditNote(client, context, returnId) {
  const ret = (await client.query(`SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2`, [context.organizationId, returnId])).rows[0];
  if (!ret || ret.credit_note_id) return null;
  const original = (await client.query(`SELECT invoice.* FROM tenant.pos_sales sale JOIN tenant.gst_invoices invoice ON invoice.id = sale.gst_invoice_id
     WHERE sale.organization_id=$1 AND sale.id=$2`, [context.organizationId, ret.sale_id])).rows[0];
  if (!original || !["tax_invoice", "invoice_cum_bill_of_supply"].includes(original.document_type)) return null;
  const lines = (await client.query(
    `SELECT rl.*, line.description, line.item_id, line.hsn_sac_snapshot, line.unit_price, line.list_unit_price, line.price_includes_tax, line.tax_classification, line.tax_rate,
            unit.code AS uom_code
       FROM tenant.pos_return_lines rl JOIN tenant.pos_sale_lines line ON line.organization_id = rl.organization_id AND line.id = rl.sale_line_id
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = line.organization_id AND unit.id = line.uom_id
      WHERE rl.organization_id=$1 AND rl.return_id=$2 ORDER BY line.line_number`, [context.organizationId, returnId])).rows;
  if (!lines.length) return null;
  try {
    const number = await allocateInvoiceNumber(client, context, { registrationId: original.seller_registration_id, kind: "credit_note", at: ret.completed_at ?? null });
    const noteLines = lines.map((line) => {
      const unit = decimal(String(line.list_unit_price ?? line.unit_price ?? 0));
      const quantity = decimal(String(line.quantity));
      return {
        sourceLineId: line.id, itemId: line.item_id, description: line.description, hsnSac: line.hsn_sac_snapshot ?? null, uomCode: line.uom_code ?? null, quantity: line.quantity,
        unitPrice: line.list_unit_price ?? line.unit_price, priceIncludesTax: Boolean(line.price_includes_tax), grossAmount: formatDecimal((unit * quantity) / 1000000n, 6),
        itemDiscount: Math.max(0, Number(line.discount_amount ?? 0) - Number(line.cart_discount_amount ?? 0)), promotionDiscount: 0, cartDiscount: line.cart_discount_amount ?? 0,
        taxableAmount: line.taxable_amount ?? 0, taxClassification: line.tax_classification, taxRate: line.tax_rate === null ? null : String(line.tax_rate), lineTotal: line.refund_amount,
        ...splitComponents(line.tax_components),
      };
    });
    const taxable = lines.reduce((sum, line) => sum + decimal(String(line.taxable_amount ?? 0)), 0n);
    const tax = lines.reduce((sum, line) => sum + decimal(String(line.tax_amount ?? 0)), 0n);
    const gross = noteLines.reduce((sum, line) => sum + decimal(String(line.grossAmount)), 0n);
    const note = await issueGstInvoice(client, context, {
      sourceType: "pos_return", sourceId: ret.id, storeId: original.store_id, registrationId: original.seller_registration_id, seriesId: number.seriesId, documentType: "credit_note",
      invoiceNumber: number.number, financialYear: number.financialYear, issuedAt: ret.completed_at ?? null, originalInvoiceId: original.id, reason: ret.reason ?? "Goods returned",
      customerMode: original.customer_mode, customerId: original.customer_id, supplyType: original.supply_type, buyerGstin: original.buyer_gstin, seller: original.seller_snapshot,
      buyer: original.buyer_snapshot, placeOfSupplyCode: original.place_of_supply_code, placeOfSupplyName: original.place_of_supply_name, supplyMode: original.supply_mode,
      currency: original.currency_code, subtotal: formatDecimal(gross, 6), discountTotal: formatDecimal(gross - taxable > 0n ? gross - taxable : 0n, 6), taxableTotal: formatDecimal(taxable, 6),
      taxTotal: formatDecimal(tax, 6), rounding: 0, grandTotal: ret.refund_total, einvoiceStatus: original.einvoice_status,
    }, noteLines);
    await client.query(`UPDATE tenant.pos_returns SET credit_note_id=$3, credit_note_number=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, ret.id, note.id, note.invoice_number]);
    await event(client, context, "pos_return", ret.id, "pos.invoice.credit_note_issued", { invoiceId: note.id, number: note.invoice_number, originalInvoiceId: original.id });
    return note;
  } catch (error) { throw asPos(error); }
}

// ------------------------------------------------------------------ reading

const invoiceView = (row, lines = null) => ({
  id: row.id, sourceType: row.source_type, sourceId: row.source_id, storeId: row.store_id, documentType: row.document_type, invoiceNumber: row.invoice_number,
  financialYear: row.financial_year, issuedAt: row.issued_at, originalInvoiceId: row.original_invoice_id, originalInvoiceNumber: row.original_invoice_number ?? null, reason: row.reason,
  customerMode: row.customer_mode, supplyType: row.supply_type, buyerGstin: row.buyer_gstin, seller: row.seller_snapshot, buyer: row.buyer_snapshot,
  placeOfSupply: row.place_of_supply_code, reverseCharge: row.reverse_charge, currency: row.currency_code, subtotal: money(row.subtotal), discountTotal: money(row.discount_total),
  taxableTotal: money(row.taxable_total), cgst: money(row.cgst_total), sgst: money(row.sgst_total), utgst: money(row.utgst_total), igst: money(row.igst_total), cess: money(row.cess_total),
  taxTotal: money(row.tax_total), roundingAdjustment: money(row.rounding_adjustment), grandTotal: money(row.grand_total), einvoiceStatus: String(row.einvoice_status).toUpperCase(),
  irn: row.irn ?? null, documentStatus: row.document_status, contentHash: row.content_hash, storeName: row.store_name ?? null, saleId: row.sale_id ?? null,
  receiptNumber: row.receipt_number ?? null,
  lines: lines?.map((line) => ({ lineNumber: line.line_number, description: line.description, hsnSac: line.hsn_sac, uom: line.uom_code, quantity: formatDecimal(decimal(String(line.quantity)), 3),
    unitPrice: money(line.unit_price), grossAmount: money(line.gross_amount), itemDiscount: money(line.item_discount), promotionDiscount: money(line.promotion_discount),
    cartDiscount: money(line.cart_discount), taxableAmount: money(line.taxable_amount), classification: line.tax_classification, taxRate: line.tax_rate === null ? null : String(Number(line.tax_rate)),
    cgst: money(line.cgst_amount), sgst: money(line.sgst_amount), utgst: money(line.utgst_amount), igst: money(line.igst_amount), cess: money(line.cess_amount), total: money(line.line_total) })) ?? undefined,
});

const SELECT_INVOICE = `SELECT invoice.*, store.name AS store_name, original.invoice_number AS original_invoice_number,
    CASE WHEN invoice.source_type = 'pos_sale' THEN invoice.source_id ELSE (SELECT ret.sale_id FROM tenant.pos_returns ret WHERE ret.organization_id = invoice.organization_id AND ret.id = invoice.source_id) END AS sale_id,
    (SELECT sale.receipt_number FROM tenant.pos_sales sale WHERE sale.organization_id = invoice.organization_id AND sale.id =
      CASE WHEN invoice.source_type = 'pos_sale' THEN invoice.source_id ELSE (SELECT ret.sale_id FROM tenant.pos_returns ret WHERE ret.organization_id = invoice.organization_id AND ret.id = invoice.source_id) END) AS receipt_number
  FROM tenant.gst_invoices invoice
  LEFT JOIN tenant.pos_stores store ON store.organization_id = invoice.organization_id AND store.id = invoice.store_id
  LEFT JOIN tenant.gst_invoices original ON original.organization_id = invoice.organization_id AND original.id = invoice.original_invoice_id`;

export async function getPosInvoice(client, context, invoiceId) {
  requirePermission(context, "pos.view");
  const row = (await client.query(`${SELECT_INVOICE} WHERE invoice.organization_id=$1 AND invoice.id=$2`, [context.organizationId, invoiceId])).rows[0];
  if (!row) throw posError(404, INVOICE_MESSAGES.POS_INVOICE_NOT_FOUND, "POS_INVOICE_NOT_FOUND");
  if (row.store_id) await assertPosStoreAccess(client, context, row.store_id);
  const lines = (await client.query(`SELECT * FROM tenant.gst_invoice_lines WHERE organization_id=$1 AND invoice_id=$2 ORDER BY line_number`, [context.organizationId, invoiceId])).rows;
  const creditNotes = (await client.query(`SELECT id, invoice_number, issued_at, grand_total FROM tenant.gst_invoices WHERE organization_id=$1 AND original_invoice_id=$2 ORDER BY issued_at`,
    [context.organizationId, invoiceId])).rows.map((note) => ({ id: note.id, number: note.invoice_number, issuedAt: note.issued_at, total: money(note.grand_total) }));
  return { ...invoiceView(row, lines), creditNotes };
}

// The invoice of a sale — or, for a sale with no statutory invoice, why (a non-GST receipt, or a sale completed before invoices were kept).
export async function getPosSaleInvoice(client, context, saleId) {
  requirePermission(context, "pos.view");
  const sale = (await client.query(`SELECT id, store_id, gst_invoice_id, receipt_number, tax_document_type FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, saleId])).rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);
  if (sale.gst_invoice_id) return { invoice: await getPosInvoice(client, context, sale.gst_invoice_id), note: null };
  return { invoice: null, note: sale.tax_document_type === "receipt" || !sale.tax_document_type
    ? "This sale was not a GST supply; its receipt is its document."
    : `This sale was completed before GST invoices were kept separately; its receipt number ${sale.receipt_number} is its invoice number.` };
}

// Invoice history: by number (exact first, then starting with), type, B2B / B2C, dates; at the outlets the person may see.
export async function listPosInvoices(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const where = [];
  const search = String(options.search ?? "").trim();
  let exact = null;
  if (search) {
    values.push(search); exact = values.length;
    values.push(`${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
    where.push(`(invoice.invoice_number = $${exact} OR invoice.invoice_number LIKE $${values.length} OR invoice.buyer_gstin = upper($${exact}))`);
  }
  if (options.documentType) { values.push(options.documentType); where.push(`invoice.document_type = $${values.length}`); }
  if (options.supplyType) { values.push(options.supplyType); where.push(`invoice.supply_type = $${values.length}`); }
  if (options.dateFrom) { values.push(options.dateFrom); where.push(`invoice.issued_at >= $${values.length}::date`); }
  if (options.dateTo) { values.push(options.dateTo); where.push(`invoice.issued_at < $${values.length}::date + 1`); }
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); where.push(`invoice.store_id = ANY($${values.length}::uuid[])`); }
  const filter = where.length ? ` AND ${where.join(" AND ")}` : "";
  const limit = Math.min(Number(options.limit) || 25, 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const total = (await client.query(`SELECT count(*)::int AS n FROM tenant.gst_invoices invoice WHERE invoice.organization_id=$1${filter}`, values)).rows[0].n;
  const rows = (await client.query(`${SELECT_INVOICE} WHERE invoice.organization_id=$1${filter} ORDER BY ${exact ? `(invoice.invoice_number = $${exact}) DESC, ` : ""}invoice.issued_at DESC, invoice.id DESC
     LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { rows: rows.map((row) => invoiceView(row)), total };
}

export async function getPosInvoiceEInvoiceStatus(client, context, invoiceId) {
  const invoice = await getPosInvoice(client, context, invoiceId);
  return { invoiceId: invoice.id, status: invoice.einvoiceStatus, irn: invoice.irn, providerAvailable: EINVOICE_PROVIDER_AVAILABLE,
    message: invoice.einvoiceStatus === "NOT_APPLICABLE" ? "E-invoicing does not apply to this document." : "No e-invoice provider is connected; this document was not registered." };
}

export async function reconcilePosInvoice(client, context, invoiceId) {
  const invoice = await getPosInvoice(client, context, invoiceId);
  const source = invoice.sourceType === "pos_sale"
    ? (await client.query(`SELECT taxable_total, tax_total, grand_total FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [context.organizationId, invoice.sourceId])).rows[0] : null;
  try { return await reconcileGstInvoice(client, context, invoiceId, source); } catch (error) { throw asPos(error); }
}

export async function getPosGstSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") ? input.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? "") ? input.to : today;
  return getGstInvoiceSummary(client, context, { from, to, storeIds: await accessiblePosStoreIds(client, context) });
}
