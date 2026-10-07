// Supplier bills: the supplier's financial claim, recorded once as Finance's Accounts Payable document. Three ways in, one document:
//
//   from a purchase order     eligible order lines, at the agreed price and discounts (partial quantities, several bills per order)
//   from goods receipts       the eligible received lines of one or more posted receipts of one order, allocated receipt line by line
//   direct expense            rent, utilities, professional fees: lines booked to an expense or asset account, never stock
//
// Procurement resolves the supplier, registrations, place of supply, terms and lines, calculates every amount on the server with the shared
// tax engine, matches quantities and prices against the order and its receipts, and checks the supplier's invoice number for duplicates.
// Finance owns everything financial: the draft is Finance's document, posting submits it to Finance's approval policy and Finance posts the
// payable, the input tax, reverse-charge and withholding, exactly once. A bill never moves stock and never changes the order.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { factorOf, resolveItemUnit } from "../../products/uom.js";
import { loadTaxContext } from "../../../core/tax/index.js";
import { PaymentTermError, getSupplierDefaultPaymentTerm, purchaseTermSnapshot, readTermSnapshot } from "../../../core/payment-terms/index.js";
import { generateComplianceDeadlines, validateStatutoryPaymentDeadline, voidComplianceDeadlines } from "../payment-terms/statutory.js";
import {
  AccountingError, applyVendorCreditNote, event as accountingEvent, cancelDraftVendorBill, createVendorBill, getAccountMapping, getPrimaryLedger, postVendorBill, reverseVendorBill, submitSubledgerDocument, supplierInvoiceKey,
  updateDraftVendorBill,
} from "../../accounting/index.js";
import { approveSubledgerDocument } from "../../accounting/subledger-approvals.js";
import { resolvePaymentSchedule } from "../../accounting/schedules.js";
import { grniAccountFor } from "../purchase-orders/accrual.js";
import { loadPurchaseOrder, poCan, requirePoPermission } from "../purchase-orders/access.js";
import { recordPoEvent } from "../purchase-orders/persist.js";
import { loadLineProgress } from "../purchase-orders/progress.js";
import { calculateSupplierBillTotals, currencyPlaces, totalsView } from "./calculate.js";
import { BILL_PERMISSIONS, POSTED_STATUSES, SupplierBillError, dayOf, fail, has, optionalUuid, readDate, requireUuid, text } from "./constants.js";
import { billedOnLines, receiptLineEligibility } from "./sources.js";
import { APPROVABLE_CODES, RECEIPT_CODES, evaluateTwoWayMatch, linesFromCalculated, linesFromStored, persistMatchEvaluation } from "./matching.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;
const ROUNDING_TOLERANCE = decimal(1);

async function finance(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountingError) throw new SupplierBillError(error.status ?? 409, error.message, error.code === "ACCOUNTING_ERROR" ? "SUPPLIER_BILL_FINANCE" : error.code);
    throw error;
  }
}
// Finance reads back what it wrote (getVendorBill): an internal read on the caller's own operation.
export const fin = (context) => ({ ...context, permissions: [...new Set([...(context.permissions ?? []), BILL_PERMISSIONS.financeView])] });
// A draft has no accounting effect: whoever may create bills records and edits it in Finance's document; posting stays with Accounts Payable.
const drafting = (context) => ({ ...fin(context), permissions: [...new Set([...fin(context).permissions, BILL_PERMISSIONS.manage])] });
export function requireBillCreate(context, message = "You do not have permission to record supplier bills.") {
  if (!poCan(context, BILL_PERMISSIONS.create) && !poCan(context, BILL_PERMISSIONS.manage)) throw new SupplierBillError(403, message, "PERMISSION_DENIED");
}
const today = async (client) => (await client.query(`SELECT current_date::text AS today`)).rows[0].today;

export function requireBillAccess(context) {
  if (!poCan(context, BILL_PERMISSIONS.view) && !poCan(context, BILL_PERMISSIONS.manage) && !poCan(context, BILL_PERMISSIONS.approve))
    throw new SupplierBillError(403, "You do not have permission to view supplier bills.", "PERMISSION_DENIED");
}

export async function loadBill(client, context, billId, { lock = false } = {}) {
  requireBillAccess(context);
  const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(billId, "Supplier bill")])).rows[0];
  if (!bill) throw new SupplierBillError(404, "Supplier bill not found.", "SUPPLIER_BILL_NOT_FOUND");
  return bill;
}

// ---------------------------------------------------------------- header

async function supplierOf(client, organizationId, supplierId) {
  const row = (await client.query(
    `SELECT supplier.*, party.display_name, party.legal_name, party.gstin AS party_gstin, party.pan
       FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, requireUuid(supplierId, "Supplier")])).rows[0];
  if (!row) fail("Choose the supplier from the Supplier Master.", "supplierId", "SUPPLIER_BILL_SUPPLIER_INVALID", 404);
  return row;
}

// The supplier's GSTIN for this invoice: the one chosen, else the order's, else the only active one. Several and none chosen: the user must pick.
async function supplierRegistrationFor(client, organizationId, supplierId, chosenId) {
  const rows = (await client.query(`SELECT id, gstin, registration_type, state_code, is_principal, status FROM tenant.procurement_supplier_tax_registrations
     WHERE organization_id = $1 AND supplier_id = $2 ORDER BY is_principal DESC, created_at`, [organizationId, supplierId])).rows;
  const active = rows.filter((row) => row.status === "active");
  if (chosenId) {
    const row = rows.find((entry) => entry.id === chosenId);
    if (!row) fail("The GST registration is not one of this supplier's.", "supplierTaxRegistrationId", "SUPPLIER_BILL_REGISTRATION_INVALID", 409);
    return { registration: row, choices: active.length };
  }
  return { registration: active.length === 1 ? active[0] : null, choices: active.length };
}

async function addressSnapshot(client, organizationId, supplierId, addressId) {
  const row = (await client.query(
    `SELECT * FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active'
        AND ($3::uuid IS NULL OR id = $3) ORDER BY (address_type = 'billing') DESC, (address_type = 'registered') DESC, is_primary DESC, created_at LIMIT 1`,
    [organizationId, supplierId, addressId])).rows[0];
  if (addressId && !row) fail("The address is not an active address of this supplier.", "supplierAddressId", "SUPPLIER_BILL_ADDRESS_INVALID", 409);
  return row ? { addressId: row.id, label: row.label, line1: row.line1, line2: row.line2, city: row.city, state: row.state, stateCode: row.state_code, postalCode: row.postal_code,
    countryCode: row.country_code, gstin: row.gstin } : null;
}

async function withholdingSection(client, organizationId, sectionId) {
  if (!sectionId) return null;
  const row = (await client.query(`SELECT id, code, name, rate, status FROM tenant.withholding_tax_sections WHERE organization_id = $1 AND id = $2`, [organizationId, sectionId])).rows[0];
  if (!row || row.status !== "active") fail("Choose an active TDS / withholding section.", "withholdingSectionId", "SUPPLIER_BILL_WITHHOLDING_INVALID", 409);
  return row;
}

// The header every bill resolves the same way. current: the stored draft (on update); order: the purchase order (order and receipt bills).
async function resolveHeader(client, context, input, { order = null, current = null } = {}) {
  const organizationId = context.organizationId;
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column]);
  // An order bill is the order's supplier's: a different supplier entered is kept and fails matching (it is never silently replaced).
  const supplierId = order ? optionalUuid(keep("supplierId", "supplier_id"), "Supplier") ?? order.supplier_id : optionalUuid(keep("supplierId", "supplier_id"), "Supplier");
  const sameSupplier = !order || supplierId === order.supplier_id;
  if (!supplierId) fail("Choose the supplier.", "supplierId", "SUPPLIER_BILL_SUPPLIER_REQUIRED");
  const supplier = await supplierOf(client, organizationId, supplierId);
  const warnings = [];
  // An existing obligation is recorded whatever the supplier's purchasing status.
  // An existing obligation is recorded whatever the supplier's purchasing status — by Accounts Payable, never just because a draft may be created.
  if (supplier.status !== "active") {
    if (!poCan(context, BILL_PERMISSIONS.manage))
      throw new SupplierBillError(403, `The supplier is ${supplier.status}. Only Accounts Payable records a bill for an existing obligation to it.`, "SUPPLIER_BILL_SUPPLIER_INACTIVE");
    warnings.push(`The supplier is ${supplier.status}${supplier.blocked_reason ? ` (${supplier.blocked_reason})` : ""}; the bill is recorded as an existing obligation. Purchasing restrictions stay.`);
  }
  const organization = (await client.query(`SELECT base_currency, country_code FROM public.organizations WHERE id = $1`, [organizationId])).rows[0];
  const currencyCode = String(order ? order.currency_code : keep("currencyCode", "currency_code") ?? supplier.default_currency ?? organization.base_currency).trim().toUpperCase();
  if (order && has(input, "currencyCode") && String(input.currencyCode).trim().toUpperCase() !== order.currency_code.trim())
    fail(`The order is in ${order.currency_code.trim()}; its bill is in the same currency.`, "currencyCode", "SUPPLIER_BILL_CURRENCY_MISMATCH", 409);
  const chosenRegistration = optionalUuid(keep("supplierTaxRegistrationId", "supplier_tax_registration_id") ?? (sameSupplier ? order?.supplier_tax_registration_id : null), "Supplier registration");
  const { registration, choices } = await supplierRegistrationFor(client, organizationId, supplierId, chosenRegistration);
  const address = (sameSupplier ? order?.billing_address_snapshot : null) ?? await addressSnapshot(client, organizationId, supplierId, optionalUuid(input.supplierAddressId, "Address"));
  let tax;
  try { tax = await loadTaxContext(client, { organizationId, sellerRegistrationId: optionalUuid(keep("buyingRegistrationId", "buying_registration_id") ?? order?.buying_registration_id, "Company registration") }); }
  catch (error) { throw new SupplierBillError(error.status ?? 409, error.message, error.code); }
  const buyer = tax.registration;
  const placeOfSupply = text(keep("placeOfSupply", "place_of_supply"), 10) ?? order?.ship_to_snapshot?.stateCode ?? buyer?.stateCode ?? null;
  const supplierStateCode = registration?.state_code ?? order?.supplier_tax_snapshot?.stateCode ?? address?.stateCode ?? null;
  const sectionId = has(input, "withholdingSectionId") ? optionalUuid(input.withholdingSectionId, "Withholding section") : current ? current.withholding_section_id : supplier.withholding_section_id;
  const section = await withholdingSection(client, organizationId, sectionId);
  const day = await today(client);
  const billDate = readDate(input.supplierInvoiceDate ?? input.billDate, "Supplier invoice date") ?? dayOf(current?.bill_date) ?? day;
  if (billDate > day) fail("The supplier invoice date cannot be in the future.", "supplierInvoiceDate", "SUPPLIER_BILL_DATE_INVALID");
  const receivedOn = readDate(has(input, "invoiceReceivedDate") ? input.invoiceReceivedDate : current?.invoice_received_date, "Invoice received date");
  if (receivedOn && (receivedOn < billDate || receivedOn > day)) fail("The invoice received date is on or after the invoice date, and not in the future.", "invoiceReceivedDate", "SUPPLIER_BILL_DATE_INVALID");
  const postingDate = readDate(input.postingDate ?? input.accountingDate, "Posting date") ?? dayOf(current?.accounting_date) ?? day;
  const reference = has(input, "supplierInvoiceNumber") ? text(input.supplierInvoiceNumber, 100) : current?.supplier_invoice_reference ?? null;
  // The agreed terms: the confirmed order's, else the supplier's own, else the company default. Other terms on this bill are an exception.
  const agreed = order ? { paymentTermId: order.payment_term_id, source: "purchase_order" } : await getSupplierDefaultPaymentTerm(client, organizationId, supplier.id);
  const paymentTermId = optionalUuid(keep("paymentTermId", "payment_term_id") ?? agreed.paymentTermId, "Payment term");
  const paymentTermChangeReason = text(keep("paymentTermChangeReason", "payment_term_change_reason"), 1000);
  let paymentTermSnapshot;
  if (paymentTermId && order && paymentTermId === order.payment_term_id) paymentTermSnapshot = order.payment_term_snapshot;
  else if (paymentTermId && current && paymentTermId === current.payment_term_id && readTermSnapshot(current.payment_term_snapshot)) paymentTermSnapshot = current.payment_term_snapshot;
  else if (paymentTermId) {
    try { paymentTermSnapshot = await purchaseTermSnapshot(client, organizationId, paymentTermId, null, { buyingRegistrationId: optionalUuid(keep("buyingRegistrationId", "buying_registration_id") ?? order?.buying_registration_id, "Company registration") }); }
    catch (error) { if (error instanceof PaymentTermError) throw new SupplierBillError(error.status, error.message, error.code, error.details); throw error; }
  }
  // An order agreed the terms: changing them on its bill is an exception. A direct bill starts from the supplier's (or company) default and Accounts Payable chooses.
  if (order && paymentTermId && agreed.paymentTermId && paymentTermId !== agreed.paymentTermId && !(current && paymentTermId === current.payment_term_id && current.payment_term_change_reason)) {
    requirePoPermission(context, BILL_PERMISSIONS.overridePaymentTerms, "The agreed payment terms are the order's (or the supplier's). Changing them on the bill needs the permission to override them.");
    if (!paymentTermChangeReason || paymentTermChangeReason.length < 5) fail("Give the reason for changing the agreed payment terms.", "paymentTermChangeReason", "SUPPLIER_BILL_TERMS_REASON_REQUIRED");
  }
  const invoiceReceivedDate = readDate(keep("invoiceReceivedDate", "invoice_received_date"), "Invoice received date");
  const acceptanceDate = readDate(keep("acceptanceDate", "acceptance_date"), "Acceptance date");
  const supplierStatedTermId = optionalUuid(keep("supplierStatedTermId", "supplier_stated_term_id"), "Supplier stated terms");
  const supplierStatedTerms = text(keep("supplierStatedTerms", "supplier_stated_terms"), 200);
  if (supplierStatedTermId && paymentTermId && supplierStatedTermId !== paymentTermId) {
    const stated = (await client.query(`SELECT name FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2`, [organizationId, supplierStatedTermId])).rows[0];
    warnings.push(`The supplier's invoice states ${stated?.name ?? "other payment terms"}; the agreed terms are ${readTermSnapshot(paymentTermSnapshot)?.name ?? "different"}. The agreed terms apply unless changed with a reason.`);
  }
  const stated = has(input, "supplierInvoiceTotal") ? input.supplierInvoiceTotal : current?.supplier_stated_total;
  if (stated !== undefined && stated !== null && stated !== "" && !QTY.test(String(stated).trim())) fail("Enter the total shown on the supplier's invoice.", "supplierInvoiceTotal");
  return {
    supplier, partyId: supplier.party_id, currencyCode, exchangeRate: has(input, "exchangeRate") ? input.exchangeRate : current ? formatDecimal(current.exchange_rate) : undefined,
    registration, registrationChoices: choices, address, buyer, placeOfSupply, supplierStateCode, section, billDate, postingDate, reference,
    dueDate: readDate(has(input, "dueDate") ? input.dueDate : current?.due_date_override_reason ? dayOf(current.due_date) : null, "Due date"), paymentTermId, paymentTermSnapshot,
    agreedPaymentTermId: agreed.paymentTermId ?? null, paymentTermChangeReason: order && paymentTermId !== agreed.paymentTermId ? paymentTermChangeReason : null, invoiceReceivedDate, acceptanceDate,
    supplierStatedTermId, supplierStatedTerms,
    priceMode: order ? order.price_mode : (keep("priceMode", "price_mode") === "inclusive" ? "inclusive" : "exclusive"),
    documentDiscountType: order ? null : keep("documentDiscountType", "document_discount_type") ?? null,
    documentDiscountValue: order ? "0" : String(keep("documentDiscountValue", "document_discount_value") ?? "0"),
    statedTotal: stated === undefined || stated === null || stated === "" ? null : decimal(String(stated).trim()),
    notes: has(input, "notes") ? text(input.notes, 2000) : current?.notes ?? null, warnings, organization,
    supplierSnapshot: { supplierId: supplier.id, supplierNumber: supplier.supplier_number, supplierName: supplier.display_name, legalName: text(input.supplierLegalName, 300) ?? supplier.legal_name ?? supplier.display_name,
      gstin: registration?.gstin ?? supplier.party_gstin ?? null, pan: supplier.pan ?? null, registrationType: registration?.registration_type ?? (registration ? null : "unregistered") },
  };
}

// ---------------------------------------------------------------- lines

function readQuantity(value, label) {
  const raw = String(value ?? "").trim();
  if (!QTY.test(raw) || decimal(raw) <= 0n) fail(`${label}: enter the quantity billed.`, "quantity", "SUPPLIER_BILL_QUANTITY_INVALID");
  return decimal(raw);
}

// The lines of a bill against an order — any number of bills per order, each for what the supplier actually invoiced (partial quantities,
// selected lines). receiptScope: only these receipts' lines may be drawn on (a bill from goods receipts).
//
// The invoice is recorded as the supplier issued it — its quantities, prices, discount and unit (converted to the order's unit through the
// item's conversion), and lines or charges the order does not include. 2-Way Matching (matching.js) then compares it with the order: more
// than the order commits, another product, a price or discount difference is a discrepancy that blocks posting — never silently corrected.
// What may be billed NOW follows the receipt policy: under receipt-based matching an invoice that arrives before its goods is kept as a draft,
// pending its receipt (strict, at posting: reported as a shortfall). Fixed-value services bill an amount of their agreed value.
async function orderBillLines(client, context, order, requested, { excludeBillId = null, receiptScope = null, strict = false } = {}) {
  const organizationId = context.organizationId;
  const orderLines = new Map((await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`,
    [organizationId, order.id])).rows.map((row) => [row.id, row]));
  const progress = new Map((await loadLineProgress(client, organizationId, order.id)).map((line) => [line.lineId, line]));
  const billed = await billedOnLines(client, organizationId, order.id, excludeBillId);
  const eligibility = (await receiptLineEligibility(client, organizationId, order.id, excludeBillId)).filter((entry) => !receiptScope || receiptScope.includes(entry.goodsReceiptId));
  const places = await currencyPlaces(client, organizationId, order.currency_code.trim());
  const eligibleOf = (line) => progress.get(line.id).remainingToBill;
  const commitmentOf = (line) => progress.get(line.id).remainingCommitment;
  const receiptBased = (line) => progress.get(line.id).receiptRequired && progress.get(line.id).billingBasis === "receipt";
  const scopeLimit = (line) => eligibility.filter((entry) => entry.purchaseOrderLineId === line.id).reduce((total, entry) => add(total, entry.remaining), 0n);
  const wanted = Array.isArray(requested) && requested.length ? requested
    : [...orderLines.values()].filter((line) => decimal(line.unit_price) > 0n).map((line) => {
      const limit = receiptScope ? scopeLimit(line) : eligibleOf(line);
      const remaining = eligibleOf(line);
      return { purchaseOrderLineId: line.id, quantity: dec(limit < remaining ? limit : remaining) };
    }).filter((entry) => decimal(entry.quantity) > 0n);
  if (!wanted.length) throw new SupplierBillError(409, receiptScope ? "Nothing on these receipts may still be billed." : "Nothing on this order may still be billed.", "SUPPLIER_BILL_NOTHING_TO_BILL");
  const lines = [];
  const warnings = [];
  const shortfalls = [];
  let pending = false;
  const seen = new Set();
  for (const [index, entry] of wanted.entries()) {
    if (!entry.purchaseOrderLineId) { lines.push(await unmatchedOrderBillLine(client, context, entry, index)); continue; }
    const line = orderLines.get(requireUuid(entry.purchaseOrderLineId, "Order line"));
    if (!line) throw new SupplierBillError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    const label = `Order line ${line.line_number}`;
    if (seen.has(line.id)) fail(`${label} is entered twice.`, "purchaseOrderLineId");
    seen.add(line.id);
    if (decimal(line.unit_price) === 0n) fail(`${label} was ordered at no charge; there is nothing to bill.`, "purchaseOrderLineId", "SUPPLIER_BILL_NOTHING_TO_BILL", 409);
    const state = progress.get(line.id);
    const productId = optionalUuid(entry.productId, "Product") ?? line.product_id;
    if (productId && productId !== line.product_id && !(await client.query(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2`, [organizationId, productId])).rows[0])
      fail(`${label}: the product was not found.`, "productId", "SUPPLIER_BILL_PRODUCT_INVALID", 404);
    const amountBasis = entry.billingBasis === "amount" || ((entry.quantity === undefined || entry.quantity === null || entry.quantity === "") && entry.amount !== undefined && entry.amount !== null);
    let quantity; let billedAmount; let uomId = line.purchase_uom_id; let invoiced = null; let uomOk = true;
    let raw = entry.unitPrice === undefined || entry.unitPrice === null || entry.unitPrice === "" || amountBasis ? null : String(entry.unitPrice).trim();
    if (raw !== null && !QTY.test(raw)) fail(`${label}: the price must be zero or more.`, "unitPrice");
    if (amountBasis) {
      if (state.receiptRequired) fail(`${label}: goods are billed by quantity; only a service is billed by amount.`, "billingBasis", "SUPPLIER_BILL_AMOUNT_BASIS_INVALID", 409);
      const value = String(entry.amount ?? "").trim();
      if (!QTY.test(value) || decimal(value) <= 0n) fail(`${label}: enter the amount the supplier billed.`, "amount", "SUPPLIER_BILL_AMOUNT_INVALID");
      billedAmount = roundMoney(decimal(value), places);
      const remainingValue = sub(state.agreedAmount, state.billedAmount);
      // The share of the commitment it consumes; the bill that takes the rest of the value takes the rest of the quantity exactly.
      const remainingQuantity = commitmentOf(line);
      quantity = billedAmount === remainingValue ? remainingQuantity : div(billedAmount, line.unit_price);
      if (billedAmount < remainingValue && quantity >= remainingQuantity) quantity = sub(remainingQuantity, 1n);
      if (quantity <= 0n) quantity = 1n;
    } else {
      quantity = readQuantity(entry.quantity, label);
      // Invoiced in another unit: normalised to the order's unit (quantity and price) for matching; kept as invoiced. No conversion: kept as
      // invoiced and reported as a unit mismatch.
      const invoiceUom = optionalUuid(entry.uomId, "Unit of measure");
      if (invoiceUom && invoiceUom !== line.purchase_uom_id) {
        invoiced = { uomId: invoiceUom, quantity, unitPrice: raw };
        const factor = await invoiceUnitFactor(client, organizationId, line, invoiceUom);
        if (factor) {
          quantity = mul(quantity, factor);
          if (raw !== null) raw = formatDecimal(div(decimal(raw), factor));
        } else { uomId = invoiceUom; uomOk = false; }
      }
      billedAmount = roundMoney(mul(quantity, line.unit_price), places);
    }
    const eligible = eligibleOf(line);
    if (!amountBasis && uomOk && receiptBased(line) && quantity > eligible && quantity <= commitmentOf(line)) {
      const message = eligible === 0n ? `${label}: nothing may be billed yet — the goods are not received (or accepted).`
        : `${label}: only ${dec(eligible)} may be billed now (received and accepted, not yet billed).`;
      if (strict) shortfalls.push(message);
      else warnings.push(`${message} The draft is kept pending its goods receipt and cannot be posted until then.`);
      pending = true;
    }
    // Receipt-based goods: the billed quantity is allocated to the receipt lines it bills — the chosen ones first, then the oldest.
    const allocations = receiptBased(line) && uomOk ? allocateBillLineToGoodsReceipts(eligibility, line.id, quantity, entry) : [];
    const matched = allocations.reduce((total, allocation) => add(total, allocation.quantity), 0n);
    if (receiptBased(line) && uomOk && matched < quantity && quantity <= commitmentOf(line) && !pending) {
      const message = `${label}: only ${dec(matched)} received${receiptScope ? " on the chosen receipts" : ""} may still be billed.`;
      if (strict) shortfalls.push(message); else warnings.push(`${message} The draft is kept pending its goods receipt.`);
      pending = true;
    }
    const others = billed.get(line.id)?.drafts;
    if (others && others.quantity > 0n) warnings.push(`${label}: ${dec(others.quantity)} is also on unposted bill${others.numbers.length === 1 ? "" : "s"} ${others.numbers.join(", ")} — whichever posts first is billed.`);
    // A discount shown on the invoice is the invoice's; none entered: the order's agreed discounts apply.
    const invoiceDiscount = entry.discountType !== undefined && entry.discountType !== null && entry.discountType !== "" && !amountBasis
      ? { type: entry.discountType === "none" ? null : entry.discountType, value: entry.discountValue ?? "0" } : null;
    const own = billed.get(line.id);
    lines.push({
      orderLine: { ...line, previouslyBilled: own?.before ?? { quantity: 0n, taxable: 0n, lineDiscount: 0n, allocated: 0n } }, allocations, quantity,
      unitPrice: raw === null ? formatDecimal(line.unit_price) : raw, taxCategoryId: line.tax_category_id, description: text(entry.description, 1000) ?? line.description,
      productId, productType: line.product_type, productSnapshot: line.product_snapshot, uomId, uomSnapshot: uomOk ? line.uom_snapshot : null,
      hsnSacCode: line.hsn_sac_code, expenseAccountId: line.expense_account_id, noWithholding: Boolean(entry.noWithholding),
      billingBasis: amountBasis ? "amount" : "quantity", billedAmount: amountBasis ? billedAmount : null, commitmentAmount: billedAmount,
      conversionFactor: line.conversion_factor ?? "1", receiptBased: receiptBased(line), invoiceDiscount,
      invoicedUomId: invoiced?.uomId ?? null, invoicedQuantity: invoiced?.quantity ?? null, invoicedUnitPrice: invoiced?.unitPrice ?? null,
    });
  }
  return { lines, warnings, pending, shortfalls };
}

// normalizeMatchingQuantities: how many of the order's unit one invoiced unit is, from the shared conversion service (both through the
// item's base unit: invoiced factor ÷ order factor; the order's factor is its own snapshot), or null when the invoiced unit cannot count
// the item. Quantity and unit price are both normalised with it, so 20 PCS at ₹50 matches 1 BOX of 20 at ₹1,000.
async function invoiceUnitFactor(client, organizationId, orderLine, invoiceUomId) {
  if (!orderLine.product_id) return null;
  const invoiced = await resolveItemUnit(client, organizationId, orderLine.product_id, invoiceUomId, { purpose: "purchase", allowInactive: true });
  if (!invoiced.ok) return null;
  return div(factorOf(invoiced.unit), orderLine.conversion_factor ?? "1");
}

// A line of an order bill that is not on the order: a product the order does not include, or a charge (freight, handling). Recorded as
// invoiced and flagged by matching; a charge may be accepted as an exception, booked to its expense account.
async function unmatchedOrderBillLine(client, context, entry, index) {
  const label = `Line ${index + 1}`;
  const productId = optionalUuid(entry.productId, "Product");
  const item = productId ? (await client.query(`SELECT id, code, name, item_type, track_inventory, uom_id, purchase_uom_id, hsn_sac_code, tax_category_id FROM tenant.items WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, productId])).rows[0] : null;
  if (productId && !item) fail(`${label}: the product was not found.`, "productId", "SUPPLIER_BILL_PRODUCT_INVALID", 404);
  const description = text(entry.description, 1000) ?? item?.name;
  if (!description) fail(`${label}: describe what was charged.`, "description");
  const accountId = optionalUuid(entry.expenseAccountId ?? entry.accountId, "Expense account");
  if (!item && !accountId) fail(`${label}: choose the expense account the charge is booked to.`, "expenseAccountId", "SUPPLIER_BILL_ACCOUNT_REQUIRED");
  const account = accountId ? await validateDirectBillAccount(client, context, accountId, label) : null;
  const quantity = readQuantity(entry.quantity ?? "1", label);
  return {
    orderLine: null, allocations: [], quantity, unitPrice: entry.unitPrice, discountType: entry.discountType, discountValue: entry.discountValue, description, productId: item?.id ?? null,
    productType: item ? (item.item_type === "service" ? "service" : item.track_inventory ? "stock" : "non_stock") : "expense",
    productSnapshot: item ? { id: item.id, code: item.code, name: item.name } : { name: description, charge: true }, uomId: item?.purchase_uom_id ?? item?.uom_id ?? null, uomSnapshot: null,
    hsnSacCode: text(entry.hsnSacCode, 30) ?? item?.hsn_sac_code ?? null, taxCategoryId: entry.noTax ? null : optionalUuid(entry.taxCategoryId, "Tax category") ?? item?.tax_category_id ?? null,
    expenseAccountId: account?.id ?? null, noWithholding: Boolean(entry.noWithholding), billingBasis: "quantity", billedAmount: null, commitmentAmount: null, receiptBased: false,
    invoiceDiscount: null, invoicedUomId: null, invoicedQuantity: null, invoicedUnitPrice: null,
  };
}

// allocateBillLineToGoodsReceipts: a billed quantity of one order line drawn on that line's eligible receipt lines (never another line's, another
// supplier's or another order's) — the receipt lines chosen first, then the oldest. One receipt may be billed by several bills; one bill may
// draw on several receipts. Returns the allocations (possibly short of the quantity: the rest is not received yet).
export function allocateBillLineToGoodsReceipts(eligibility, orderLineId, quantity, entry = {}) {
  const preferred = new Set((Array.isArray(entry.goodsReceiptLineIds) ? entry.goodsReceiptLineIds : entry.goodsReceiptLineId ? [entry.goodsReceiptLineId] : []).map((id) => requireUuid(id, "Receipt line")));
  const candidates = eligibility.filter((candidate) => candidate.purchaseOrderLineId === orderLineId)
    .sort((a, b) => Number(preferred.has(b.goodsReceiptLineId)) - Number(preferred.has(a.goodsReceiptLineId)));
  const allocations = [];
  let left = quantity;
  for (const candidate of candidates) {
    if (left <= 0n) break;
    const take = candidate.remaining < left ? candidate.remaining : left;
    if (take <= 0n) continue;
    allocations.push({ goodsReceiptLineId: candidate.goodsReceiptLineId, goodsReceiptId: candidate.goodsReceiptId, receiptNumber: candidate.receiptNumber, quantity: take });
    candidate.remaining = sub(candidate.remaining, take);
    left = sub(left, take);
  }
  return allocations;
}

// Direct expense lines: an expense (or asset) account each; a catalogue product only when it is a service or non-stock item.
// The accounts a direct bill may post to: expenses, and assets the business buys (fixed assets, prepayments, deposits) — never inventory
// (stock comes through a goods receipt), receivables, cash, bank or tax accounts, which have their own workflows.
const BLOCKED_ASSET_TYPES = new Set(["inventory", "receivable", "cash", "bank", "suspense", "tax_input", "accumulated_depreciation"]);
export async function validateDirectBillAccount(client, context, accountId, label = "Line") {
  const account = (await client.query(`SELECT id, code, name, account_class, account_type, is_group, status FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(accountId, "Expense account")])).rows[0];
  if (!account || account.status !== "active" || account.is_group || !["expense", "asset"].includes(account.account_class))
    fail(`${label}: choose an active expense or asset account (not a group).`, "expenseAccountId", "SUPPLIER_BILL_ACCOUNT_INVALID", 409);
  if (account.account_class === "asset" && BLOCKED_ASSET_TYPES.has(account.account_type))
    fail(`${label}: ${account.code} · ${account.name} is not posted from a supplier bill${account.account_type === "inventory" ? " — stock is received through a purchase order and goods receipt" : ""}.`,
      "expenseAccountId", "SUPPLIER_BILL_ACCOUNT_INVALID", 409);
  if (["cogs", "rounding", "fx_loss"].includes(account.account_type)) fail(`${label}: ${account.code} · ${account.name} is a Finance-controlled account.`, "expenseAccountId", "SUPPLIER_BILL_ACCOUNT_INVALID", 409);
  return account;
}

async function directBillLines(client, context, requested) {
  if (!Array.isArray(requested) || !requested.length) fail("Add at least one line.", "lines", "SUPPLIER_BILL_NO_LINES");
  const lines = [];
  for (const [index, entry] of requested.entries()) {
    const label = `Line ${index + 1}`;
    const productId = optionalUuid(entry.productId, "Product");
    let item = null;
    if (productId) {
      item = (await client.query(`SELECT id, code, name, item_type, track_inventory, uom_id, purchase_uom_id, hsn_sac_code, tax_category_id, status FROM tenant.items WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, productId])).rows[0];
      if (!item) fail(`${label}: the product was not found.`, "productId", "SUPPLIER_BILL_PRODUCT_INVALID", 404);
      // Stock is bought through a purchase order and received on a goods receipt: an expense bill never adds stock.
      if (item.item_type !== "service" && item.track_inventory)
        fail(`${label}: ${item.name} is a stock item. Buy it on a purchase order and receive it, so Inventory records it.`, "productId", "SUPPLIER_BILL_STOCK_WITHOUT_ORDER", 409);
    }
    // An expense category names the cost in plain words and carries its account, tax category and HSN/SAC.
    const categoryId = optionalUuid(entry.expenseCategoryId, "Expense category");
    const category = categoryId ? (await client.query(`SELECT * FROM tenant.expense_categories WHERE organization_id = $1 AND id = $2`, [context.organizationId, categoryId])).rows[0] : null;
    if (categoryId && (!category || category.status !== "active")) fail(`${label}: choose an active expense category.`, "expenseCategoryId", "SUPPLIER_BILL_CATEGORY_INVALID", 409);
    const accountId = optionalUuid(entry.expenseAccountId ?? entry.accountId, "Expense account") ?? category?.account_id ?? null;
    if (!accountId) fail(`${label}: choose the expense category or the expense or asset account it is booked to.`, "expenseAccountId", "SUPPLIER_BILL_ACCOUNT_REQUIRED");
    const account = await validateDirectBillAccount(client, context, accountId, label);
    const costCenterId = optionalUuid(entry.costCenterId, "Cost centre");
    if (costCenterId && !(await client.query(`SELECT 1 FROM public.cost_centers WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, costCenterId])).rows[0])
      fail(`${label}: choose an active cost centre.`, "costCenterId", "SUPPLIER_BILL_COST_CENTER_INVALID", 409);
    const departmentId = optionalUuid(entry.departmentId, "Department");
    if (departmentId && !(await client.query(`SELECT 1 FROM public.departments WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, departmentId])).rows[0])
      fail(`${label}: choose an active department.`, "departmentId", "SUPPLIER_BILL_DEPARTMENT_INVALID", 409);
    const description = text(entry.description, 1000) ?? item?.name;
    if (!description) fail(`${label}: describe what was charged.`, "description");
    const uomId = optionalUuid(entry.uomId, "Unit of measure") ?? item?.purchase_uom_id ?? item?.uom_id ?? null;
    const uom = uomId ? (await client.query(`SELECT id, code, name, decimal_places FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [context.organizationId, uomId])).rows[0] : null;
    if (uomId && !uom) fail(`${label}: the unit of measure was not found.`, "uomId", "SUPPLIER_BILL_UOM_INVALID", 409);
    const quantity = readQuantity(entry.quantity ?? "1", label);
    if (uom && formatDecimal(quantity).split(".")[1]?.replace(/0+$/, "").length > Number(uom.decimal_places ?? 6))
      fail(`${label}: ${uom.code} allows ${uom.decimal_places} decimal places.`, "quantity", "SUPPLIER_BILL_QUANTITY_INVALID");
    lines.push({
      quantity, unitPrice: entry.unitPrice, discountType: entry.discountType, discountValue: entry.discountValue, description, productId: item?.id ?? null,
      productType: item ? (item.item_type === "service" ? "service" : "non_stock") : entry.productType === "service" ? "service" : "expense",
      productSnapshot: item ? { id: item.id, code: item.code, name: item.name } : { name: description, expense: true }, uomId: uom?.id ?? null,
      uomSnapshot: uom ? { id: uom.id, code: uom.code, name: uom.name } : null, hsnSacCode: text(entry.hsnSacCode, 30) ?? item?.hsn_sac_code ?? category?.default_hsn_sac ?? null,
      taxCategoryId: entry.noTax ? null : optionalUuid(entry.taxCategoryId, "Tax category") ?? item?.tax_category_id ?? category?.default_tax_category_id ?? null, expenseAccountId: account.id,
      noWithholding: Boolean(entry.noWithholding), allocations: [], expenseCategoryId: category?.id ?? null, costCenterId, departmentId,
      inputTaxEligibility: entry.inputTaxEligibility === "blocked" ? "blocked" : "eligible",
    });
  }
  return lines;
}

// Everything Finance needs for the document, from the header, the lines and the calculation.
async function financeDocument(client, context, header, source, calculated, { order, receiptIds, matchingStatus, overrideReason }) {
  const ledger = await finance(() => getPrimaryLedger(client, { ...context, permissions: [...(context.permissions ?? []), BILL_PERMISSIONS.financeView] }));
  const lines = [];
  for (const line of calculated.lines) {
    const source = line.input;
    let accountId = source.expenseAccountId ?? undefined;
    let varianceAccountId; let varianceAmount = 0n;
    // Goods whose receipt booked them against GRNI clear GRNI at the accrued value; a price difference goes to purchase price variance.
    const grni = order && source.allocations.length ? await grniAccountFor(client, context, order, source.allocations.map((allocation) => allocation.goodsReceiptLineId)) : null;
    if (grni) {
      accountId = grni;
      if (line.variance !== 0n) {
        varianceAmount = line.variance;
        try { varianceAccountId = (await getAccountMapping(client, context, ledger.id, "purchase_price_variance", {})).account_id; }
        catch { varianceAccountId = (await finance(() => getAccountMapping(client, context, ledger.id, "expense", { itemId: source.productId ?? null }))).account_id; }
      }
    }
    lines.push({
      itemId: source.productId ?? undefined, description: line.description ?? source.description, hsnSacCode: source.hsnSacCode, quantity: dec(line.quantity), uomId: source.uomId ?? undefined,
      unitPrice: dec(line.unitPrice), grossAmount: dec(add(line.taxable, add(line.lineDiscount, line.allocated))), discountAmount: dec(add(line.lineDiscount, line.allocated)),
      netAmount: dec(line.taxable), taxAmount: dec(line.chargedTax), withholdingAmount: dec(line.withholding), reverseChargeTax: dec(line.reverseChargeTax), accountId,
      varianceAccountId, varianceAmount: dec(varianceAmount), productType: source.productType, productSnapshot: source.productSnapshot, uomSnapshot: source.uomSnapshot,
      taxCategoryId: line.taxCategoryId ?? undefined, lineDiscountType: line.order && !source.invoiceDiscount ? line.order.discount_type : line.discount.type, lineDiscountValue: dec(line.discount.value),
      lineDiscountAmount: dec(line.lineDiscount), allocatedDocumentDiscount: dec(line.allocated), reverseCharge: line.reverseCharge, withholdingRate: header.section ? dec(header.section.rate) : "0",
      purchaseOrderLineId: line.order?.id, goodsReceiptLineId: source.allocations.length === 1 ? source.allocations[0].goodsReceiptLineId : undefined,
      orderedUnitPrice: line.order ? dec(line.order.unit_price) : undefined,
      taxDetails: line.reverseCharge ? [] : line.components.map((component) => ({ taxType: component.type, taxableAmount: dec(component.taxableAmount), taxAmount: dec(component.taxAmount),
        recoverableAmount: source.inputTaxEligibility === "blocked" ? "0" : dec(component.taxAmount) })),
      inputTaxEligibility: source.inputTaxEligibility, expenseCategoryId: source.expenseCategoryId ?? undefined, costCenterId: source.costCenterId ?? undefined,
      departmentId: source.departmentId ?? undefined,
      taxComponents: line.components.map((component) => ({ taxType: component.type, label: component.label, rate: dec(component.rate), taxableAmount: dec(component.taxableAmount),
        taxAmount: dec(component.taxAmount), classification: component.classification })),
    });
  }
  // The supplier's stated total is verified: a difference within rounding is booked as rounding; anything more stops posting.
  const roundingAdjustment = header.statedTotal !== null && sub(header.statedTotal, calculated.totals.invoiceTotal) !== 0n
    && (sub(header.statedTotal, calculated.totals.invoiceTotal) < 0n ? -sub(header.statedTotal, calculated.totals.invoiceTotal) : sub(header.statedTotal, calculated.totals.invoiceTotal)) <= ROUNDING_TOLERANCE
    ? sub(header.statedTotal, calculated.totals.invoiceTotal) : 0n;
  return {
    partyId: header.partyId, supplierInvoiceReference: header.reference, billDate: header.billDate, accountingDate: header.postingDate, dueDate: header.dueDate ?? undefined,
    currencyCode: header.currencyCode, exchangeRate: header.exchangeRate, paymentTermId: header.paymentTermId ?? undefined, paymentTermSnapshot: header.paymentTermSnapshot,
    sourcePurchaseOrderId: order?.id, sourceGoodsReceiptId: receiptIds?.length === 1 ? receiptIds[0] : undefined, matchingStatus, notes: header.notes, supplierSnapshot: header.supplierSnapshot,
    roundingAdjustment: dec(roundingAdjustment), lines,
    supplierId: header.supplier.id, sourceType: source, supplierTaxRegistrationId: header.registration?.id ?? null,
    supplierTaxSnapshot: header.registration ? { id: header.registration.id, gstin: header.registration.gstin, stateCode: header.registration.state_code, registrationType: header.registration.registration_type }
      : order?.supplier_tax_snapshot ?? null,
    supplierAddressSnapshot: header.address, buyingRegistrationId: header.buyer?.id ?? null, buyingRegistrationSnapshot: header.buyer, placeOfSupply: header.placeOfSupply,
    supplyNature: calculated.lines.find((line) => line.supplyNature)?.supplyNature ?? null, reverseCharge: calculated.lines.some((line) => line.reverseCharge), priceMode: header.priceMode,
    documentDiscountType: header.documentDiscountType, documentDiscountValue: header.documentDiscountValue, supplierStatedTotal: header.statedTotal === null ? null : dec(header.statedTotal),
    withholdingSectionId: header.section?.id ?? null, matchOverrideReason: overrideReason,
    computedDueDate: header.computedDueDate, dueDateOverrideReason: header.dueDateOverrideReason,
    invoiceReceivedDate: header.invoiceReceivedDate, acceptanceDate: header.acceptanceDate, supplierStatedTerms: header.supplierStatedTerms, supplierStatedTermId: header.supplierStatedTermId,
    paymentTermChangeReason: header.paymentTermChangeReason,
  };
}

async function writeAllocations(client, context, billId, calculated, billLines) {
  await client.query(`DELETE FROM tenant.supplier_bill_receipt_allocations WHERE organization_id = $1 AND vendor_bill_id = $2`, [context.organizationId, billId]);
  for (const [index, line] of calculated.lines.entries()) {
    const billLine = billLines.find((row) => row.sequence === index + 1);
    for (const allocation of line.input.allocations)
      await client.query(
        `INSERT INTO tenant.supplier_bill_receipt_allocations (organization_id, vendor_bill_id, vendor_bill_line_id, purchase_order_line_id, goods_receipt_line_id, quantity, base_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [context.organizationId, billId, billLine.id, line.order.id, allocation.goodsReceiptLineId, dec(allocation.quantity), dec(mul(allocation.quantity, line.input.conversionFactor ?? "1"))]);
  }
}

// Builds (or rebuilds) a bill's content: the source's lines, the calculation, the matching.
// calculateSupplierBillDueDate: the due date the payment terms give from the invoice date. Another date is an override: it needs the permission
// and a reason, both kept on the bill.
export async function calculateSupplierBillDueDate(client, context, { billDate, paymentTermId, paymentTermSnapshot, total = "0", currencyCode = "INR", invoiceReceivedDate = null, postingDate = null }) {
  const places = (await client.query(`SELECT decimal_places FROM tenant.currencies WHERE organization_id = $1 AND code = $2`, [context.organizationId, currencyCode])).rows[0]?.decimal_places ?? 2;
  const schedule = await finance(() => resolvePaymentSchedule(client, fin(context), { documentDate: billDate, explicitDueDate: null, paymentTermId: paymentTermId ?? undefined,
    snapshot: paymentTermSnapshot, total: decimal(total) > 0n ? decimal(total) : decimal(1), precision: Number(places), dates: { invoiceReceivedDate, postingDate } }));
  return schedule.dueDate;
}

async function resolveDueDate(client, context, header, input, calculated, { trusted = false } = {}) {
  header.computedDueDate = await calculateSupplierBillDueDate(client, context, { billDate: header.billDate, paymentTermId: header.paymentTermId,
    paymentTermSnapshot: header.paymentTermSnapshot, total: formatDecimal(calculated.totals.netPayable), currencyCode: header.currencyCode, invoiceReceivedDate: header.invoiceReceivedDate,
    postingDate: header.postingDate });
  header.dueDateOverrideReason = null;
  if (header.dueDate && header.dueDate !== header.computedDueDate) {
    if (!trusted) requirePoPermission(context, BILL_PERMISSIONS.overrideDueDate, `The payment terms give ${header.computedDueDate}. Changing the due date needs the permission to override it.`);
    const reason = text(input.dueDateOverrideReason, 1000);
    if (!reason || reason.length < 5) fail(`The payment terms give ${header.computedDueDate}: give the reason for ${header.dueDate}.`, "dueDateOverrideReason", "SUPPLIER_BILL_DUE_DATE_REASON_REQUIRED");
    if (header.dueDate < header.billDate) fail("The due date cannot be before the invoice date.", "dueDate");
    header.dueDateOverrideReason = reason;
  } else header.dueDate = null;
}

// strict: posting — everything must be billable now. trusted: an internal rebuild that keeps overrides already authorised on the draft.
async function buildBill(client, context, source, input, { order, receiptIds, current, strict = false, trusted = false }) {
  const header = await resolveHeader(client, context, input, { order, current });
  const ordered = source === "direct" ? null
    : await orderBillLines(client, context, order, input.lines, { excludeBillId: current?.id ?? null, receiptScope: source === "goods_receipt" ? receiptIds : null, strict });
  const sourceLines = ordered ? ordered.lines : await directBillLines(client, context, input.lines);
  if (ordered) header.warnings.push(...ordered.warnings);
  const calculated = await calculateSupplierBillTotals(client, context, {
    currencyCode: header.currencyCode, billDate: header.billDate, priceMode: header.priceMode, supplierStateCode: header.supplierStateCode, placeOfSupply: header.placeOfSupply,
    buyingRegistrationId: header.buyer?.id ?? null, supplierRegistrationType: header.supplierSnapshot.registrationType, withholdingRate: header.section?.rate ?? 0,
    documentDiscountType: header.documentDiscountType, documentDiscountValue: header.documentDiscountValue,
    lines: sourceLines.map((line) => ({ ...line, orderLine: line.orderLine })),
  });
  // Calculation lines keep their source (allocations, accounts) as input.
  calculated.lines.forEach((line, index) => { line.input = sourceLines[index]; });
  // 2-Way Matching against the order, every time the bill is built (saved, previewed, rechecked, posted).
  const twoWay = order ? await evaluateTwoWayMatch(client, context, { order, lines: linesFromCalculated(calculated), billId: current?.id ?? null,
    header: { supplierId: header.supplier.id, buyingRegistrationId: header.buyer?.id ?? null, currencyCode: header.currencyCode, statedTotal: header.statedTotal,
      invoiceTotal: calculated.totals.invoiceTotal, places: calculated.places } }) : null;
  const discrepancies = twoWay ? priceDiscrepancies(twoWay) : [];
  const approved = twoWay ? twoWay.discrepancies.filter((entry) => entry.approved && entry.reason) : [];
  const overrideReason = approved.length ? [...new Set(approved.map((entry) => entry.reason))].join(" · ") : null;
  let matchingStatus = "not_required";
  // Only the goods receipt is missing (3-Way): the draft is pending its receipt; anything commercial is an exception.
  const receiptOnly = twoWay?.blocking.length && twoWay.blocking.every((entry) => RECEIPT_CODES.includes(entry.code));
  if (twoWay) matchingStatus = twoWay.result === "mismatch" ? (receiptOnly ? "pending" : "exception") : ordered?.pending ? "pending" : twoWay.result === "approved_exception" ? "overridden" : "matched";
  void trusted;
  // Matching source: against goods-receipt allocations when any line is matched to receipts, else against the order's commitment.
  header.matchingBasis = ordered ? (sourceLines.some((line) => line.receiptBased) ? "goods_receipt" : "purchase_order") : null;
  header.receiptIds = source === "goods_receipt" ? receiptIds : null;
  await resolveDueDate(client, context, header, input, calculated, { trusted });
  const document = await financeDocument(client, context, header, source, calculated, { order, receiptIds, matchingStatus, overrideReason });
  return { header, calculated, discrepancies, matchingStatus, overrideReason, document, twoWay, shortfalls: ordered?.shortfalls ?? [] };
}

// The price and discount discrepancies in the shape the bill screens list them (order price, invoiced price, difference).
function priceDiscrepancies(twoWay) {
  return twoWay.discrepancies.filter((entry) => ["PRICE_MISMATCH", "DISCOUNT_MISMATCH"].includes(entry.code)).map((entry) => {
    const line = twoWay.lines.find((row) => row.sequence === entry.lineSequence);
    return { code: entry.code, lineNumber: line?.orderLineNumber ?? entry.lineSequence, ordered: line?.expectedUnitPrice, billed: line?.actualUnitPrice,
      difference: line ? dec(sub(line.actualUnitPrice, line.expectedUnitPrice)) : null, totalDifference: entry.difference, approved: entry.approved, message: entry.message };
  });
}

async function afterWrite(client, context, billId, built) {
  const billLines = (await client.query(`SELECT id, sequence FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2`, [context.organizationId, billId])).rows;
  await writeAllocations(client, context, billId, built.calculated, billLines);
  await client.query(`UPDATE tenant.accounting_vendor_bills SET match_override_reason = $3, matching_basis = $4, source_goods_receipt_ids = $5, matching_status = $6
     WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, billId, built.matchingStatus === "overridden" ? built.overrideReason : null, built.header.matchingBasis, built.header.receiptIds, built.matchingStatus]);
  // Each order line records how it bills the commitment (by quantity, or by amount of a fixed-value service's agreed value) and what the
  // supplier invoiced as invoiced: another unit, an explicit discount.
  for (const [index, line] of built.calculated.lines.entries()) {
    if (!line.order && !line.input.charge && !built.twoWay) continue;
    const billLine = billLines.find((row) => row.sequence === index + 1);
    const input = line.input;
    await client.query(
      `UPDATE tenant.accounting_vendor_bill_lines SET billing_basis = $3, billed_amount = $4, invoiced_uom_id = $5, invoiced_quantity = $6, invoiced_unit_price = $7,
         invoice_discount_type = $8, invoice_discount_value = $9 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, billLine.id, input.billingBasis ?? "quantity", line.order ? dec(input.commitmentAmount) : null, input.invoicedUomId ?? null,
        input.invoicedQuantity === null || input.invoicedQuantity === undefined ? null : dec(input.invoicedQuantity), input.invoicedUnitPrice ?? null,
        input.invoiceDiscount ? input.invoiceDiscount.type ?? "none" : null, input.invoiceDiscount ? String(input.invoiceDiscount.value ?? "0") : null]);
  }
  // The bill's current 2-Way Matching result (and approvals that no longer fit their line expire); a direct bill is not applicable.
  if (built.twoWay) await persistMatchEvaluation(client, context, billId, { ...built.twoWay, lines: built.twoWay.lines.map((line) => ({ ...line,
    billLineId: billLines.find((row) => row.sequence === line.sequence)?.id ?? null })) });
  else await client.query(`UPDATE tenant.accounting_vendor_bills SET two_way_result = 'not_applicable', two_way_checked_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, billId]);
  // A due date other than the terms give is kept in the bill's history: who, when, from what, to what, why.
  if (built.header.dueDateOverrideReason)
    await accountingEvent(client, fin(context), "vendor_bill", billId, "accounting.vendor_bill.due_date_overridden", null, null,
      { computedDueDate: built.header.computedDueDate, dueDate: built.header.dueDate, reason: built.header.dueDateOverrideReason });
}

// createSupplierBill. input: { sourceType: "purchase_order" | "goods_receipt" | "direct", purchaseOrderId?, goodsReceiptIds?, supplierId? (direct),
//   supplierInvoiceNumber, supplierInvoiceDate, postingDate?, dueDate?, currencyCode?, exchangeRate?, paymentTermId?, supplierTaxRegistrationId?, supplierAddressId?,
//   buyingRegistrationId?, placeOfSupply?, priceMode? (direct), documentDiscountType?/Value? (direct), withholdingSectionId?, supplierInvoiceTotal?, notes?, overrideReason?,
//   lines: order: [{ purchaseOrderLineId, quantity, unitPrice?, goodsReceiptLineIds?, noWithholding? }] · direct: [{ expenseAccountId, productId?, description, quantity,
//   uomId?, unitPrice, discountType?, discountValue?, taxCategoryId?, noTax?, hsnSacCode?, noWithholding? }], idempotencyKey? }
export async function createSupplierBill(client, context, input = {}) {
  requireBillCreate(context);
  const source = ["purchase_order", "goods_receipt", "direct"].includes(input.sourceType) ? input.sourceType : input.purchaseOrderId ? "purchase_order" : input.goodsReceiptIds ? "goods_receipt" : "direct";
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.supplier_bill.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  let order = null;
  let receiptIds = null;
  if (source === "goods_receipt") {
    receiptIds = [...new Set((Array.isArray(input.goodsReceiptIds) ? input.goodsReceiptIds : [input.goodsReceiptIds]).filter(Boolean).map((id) => requireUuid(id, "Goods receipt")))];
    if (!receiptIds.length) fail("Choose the goods receipts the supplier billed.", "goodsReceiptIds", "SUPPLIER_BILL_RECEIPTS_REQUIRED");
    const receipts = (await client.query(`SELECT id, purchase_order_id, receipt_number, status, reversed_at FROM tenant.goods_receipts WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [context.organizationId, receiptIds])).rows;
    if (receipts.length !== receiptIds.length) throw new SupplierBillError(404, "A goods receipt was not found.", "GOODS_RECEIPT_NOT_FOUND");
    if (receipts.some((receipt) => receipt.status !== "posted" || receipt.reversed_at)) fail("Only posted goods receipts are billed.", "goodsReceiptIds", "SUPPLIER_BILL_RECEIPT_INVALID", 409);
    if (new Set(receipts.map((receipt) => receipt.purchase_order_id)).size !== 1) fail("A bill covers the receipts of one purchase order.", "goodsReceiptIds", "SUPPLIER_BILL_RECEIPT_INVALID", 409);
    order = await loadPurchaseOrder(client, context, receipts[0].purchase_order_id, { lock: true });
  } else if (source === "purchase_order") {
    order = await loadPurchaseOrder(client, context, requireUuid(input.purchaseOrderId, "Purchase order"), { lock: true });
  }
  if (order && order.status !== "confirmed")
    throw new SupplierBillError(409, `Bills are recorded against a confirmed order; ${order.purchase_order_number} is ${order.status}.`, "SUPPLIER_BILL_ORDER_NOT_CONFIRMED");
  const built = await buildBill(client, context, source, input, { order, receiptIds, current: null });
  const created = await finance(() => createVendorBill(client, drafting(context), built.document));
  const billId = created.bill.id;
  await afterWrite(client, context, billId, built);
  if (order)
    await recordPoEvent(client, context, order.id, "purchase_order.bill_recorded", `Supplier bill ${created.bill.bill_number} (invoice ${built.header.reference ?? "—"}) drafted for ${
      built.calculated.lines.map((line) => !line.order ? `${line.description ?? "a line not on the order"}` : line.input.billingBasis === "amount" ? `line ${line.order.line_number}: ${dec(line.input.billedAmount)} of its agreed value` : `line ${line.order.line_number} × ${dec(line.quantity)}`).join(", ")}${built.matchingStatus === "exception" ? " — price differs from the order" : built.matchingStatus === "pending" ? " — pending its goods receipt" : ""}`,
    { details: { billId, billNumber: created.bill.bill_number, matchingStatus: built.matchingStatus, discrepancies: built.discrepancies } });
  const duplicates = await checkDuplicateSupplierInvoice(client, context, { partyId: built.header.partyId, reference: built.header.reference, gstin: built.header.supplierSnapshot.gstin,
    billDate: built.header.billDate, excludeBillId: billId });
  const response = { id: billId, billId, billNumber: created.bill.bill_number, status: "draft", matchingStatus: built.matchingStatus, discrepancies: built.discrepancies,
    grandTotal: formatDecimal(created.bill.grand_total), invoiceTotal: dec(built.calculated.totals.invoiceTotal), withholding: dec(built.calculated.totals.withholding),
    twoWay: built.twoWay ? { result: built.twoWay.result, discrepancies: built.twoWay.discrepancies } : { result: "not_applicable", discrepancies: [] },
    warnings: [...built.header.warnings, ...duplicates.map((entry) => `Possible duplicate supplier invoice: ${entry.billNumber} (${entry.status}).`)], duplicates, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "vendor_bill", aggregateId: billId });
  return response;
}
export const createBillFromPurchaseOrder = (client, context, orderId, input = {}) => createSupplierBill(client, context, { ...input, sourceType: "purchase_order", purchaseOrderId: orderId });
export const createBillFromGoodsReceipt = (client, context, receiptIds, input = {}) => createSupplierBill(client, context, { ...input, sourceType: "goods_receipt", goodsReceiptIds: receiptIds });
export const createDirectExpenseBill = (client, context, input = {}) => createSupplierBill(client, context, { ...input, sourceType: "direct" });
// The order's bill in the shape the purchase order screens use.
export const createSupplierBillFromPurchaseOrder = createBillFromPurchaseOrder;

// updateDraftSupplierBill: anything on a draft, rebuilt and recalculated from its source. input as createSupplierBill (lines replace the draft's).
export async function updateDraftSupplierBill(client, context, billId, input = {}) {
  requireBillCreate(context, "You do not have permission to edit supplier bills.");
  const current = await loadBill(client, context, billId, { lock: true });
  if (current.bill_type !== "bill") fail("Vendor credits are changed in Debit Notes & Vendor Credits.", "billType", "SUPPLIER_BILL_LOCKED", 409);
  if (current.status !== "draft") throw new SupplierBillError(409, "Only a draft supplier bill can be changed. Correct a posted bill with a vendor credit or a reversal.", "SUPPLIER_BILL_LOCKED");
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(current.updated_at).getTime())
    throw new SupplierBillError(409, "Someone else changed this draft. Reload it and enter your change again.", "SUPPLIER_BILL_STALE");
  const { built: _built, ...result } = await rebuildDraft(client, context, current, input);
  return result;
}

// Rebuilds a draft from its source and stored lines (or the lines given): amounts recalculated, receipts re-allocated against what posted bills
// left. Posting rebuilds the draft strictly first, so it posts what may be billed at that moment — under the order's lock.
async function rebuildDraft(client, context, current, input, { strict = false, trusted = false } = {}) {
  const source = current.source_type ?? (current.source_purchase_order_id ? "purchase_order" : "direct");
  const order = current.source_purchase_order_id ? await loadPurchaseOrder(client, context, current.source_purchase_order_id, { lock: true }) : null;
  const receiptIds = source === "goods_receipt"
    ? (Array.isArray(input.goodsReceiptIds) && input.goodsReceiptIds.length ? input.goodsReceiptIds.map((id) => requireUuid(id, "Goods receipt"))
      : current.source_goods_receipt_ids?.length ? current.source_goods_receipt_ids : (await client.query(`SELECT DISTINCT receipt_line.goods_receipt_id FROM tenant.supplier_bill_receipt_allocations allocation
           JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
          WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2`, [context.organizationId, current.id])).rows.map((row) => row.goods_receipt_id))
    : null;
  let lines = input.lines;
  const allocated = (await client.query(`SELECT vendor_bill_line_id, goods_receipt_line_id FROM tenant.supplier_bill_receipt_allocations WHERE organization_id = $1 AND vendor_bill_id = $2`,
    [context.organizationId, current.id])).rows;
  if (!Array.isArray(lines)) {
    const stored = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [context.organizationId, current.id])).rows;
    lines = stored.map((line) => source === "direct"
      ? { expenseAccountId: line.expense_account_id, productId: line.item_id, description: line.description, quantity: formatDecimal(line.quantity), uomId: line.uom_id,
        unitPrice: formatDecimal(line.unit_price), discountType: line.line_discount_type, discountValue: formatDecimal(line.line_discount_value), taxCategoryId: line.tax_category_id,
        noTax: !line.tax_category_id, hsnSacCode: line.hsn_sac_code, noWithholding: decimal(line.withholding_amount) === 0n && decimal(line.withholding_rate) > 0n,
        expenseCategoryId: line.expense_category_id, costCenterId: line.cost_center_id, departmentId: line.department_id, inputTaxEligibility: line.input_tax_eligibility }
      : !line.purchase_order_line_id
        ? { description: line.description, productId: line.item_id ?? undefined, quantity: formatDecimal(line.quantity), unitPrice: formatDecimal(line.unit_price),
          discountType: line.line_discount_type ?? undefined, discountValue: line.line_discount_value === null ? undefined : formatDecimal(line.line_discount_value),
          taxCategoryId: line.tax_category_id, noTax: !line.tax_category_id, expenseAccountId: line.expense_account_id ?? undefined, hsnSacCode: line.hsn_sac_code }
        : line.billing_basis === "amount"
          ? { purchaseOrderLineId: line.purchase_order_line_id, billingBasis: "amount", amount: formatDecimal(line.billed_amount), description: line.description }
          : { purchaseOrderLineId: line.purchase_order_line_id, productId: line.item_id ?? undefined, description: line.description,
            quantity: formatDecimal(line.invoiced_quantity ?? line.quantity), uomId: line.invoiced_uom_id ?? undefined,
            unitPrice: formatDecimal(line.invoiced_uom_id ? line.invoiced_unit_price ?? line.unit_price : line.unit_price),
            ...(line.invoice_discount_type ? { discountType: line.invoice_discount_type, discountValue: formatDecimal(line.invoice_discount_value ?? 0) } : {}),
            goodsReceiptLineIds: allocated.filter((row) => row.vendor_bill_line_id === line.id).map((row) => row.goods_receipt_line_id) });
  }
  const built = await buildBill(client, context, source, { ...input, lines }, { order, receiptIds, current, strict, trusted });
  await client.query(`DELETE FROM tenant.supplier_bill_receipt_allocations WHERE organization_id = $1 AND vendor_bill_id = $2`, [context.organizationId, current.id]);
  await finance(() => updateDraftVendorBill(client, drafting(context), current.id, built.document));
  await afterWrite(client, context, current.id, built);
  return { id: current.id, matchingStatus: built.matchingStatus, discrepancies: built.discrepancies, warnings: built.header.warnings,
    twoWay: built.twoWay ? { result: built.twoWay.result, discrepancies: built.twoWay.discrepancies } : { result: "not_applicable", discrepancies: [] }, built };
}

// revalidateMatchBeforePosting: the draft as it will post — rebuilt strictly against the order and posted bills as they are now (amounts,
// receipts, 2-Way Matching), keeping what was authorised on it (approved exceptions that still fit, the due date).
async function refreshForPosting(client, context, bill) {
  if (!bill.source_purchase_order_id || bill.bill_type !== "bill") return { bill, built: null };
  const rebuilt = await rebuildDraft(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), BILL_PERMISSIONS.create])] }, bill,
    { dueDateOverrideReason: bill.due_date_override_reason ?? undefined }, { strict: true, trusted: true });
  return { bill: await loadBill(client, context, bill.id, { lock: true }), built: rebuilt.built };
}

// A bill that does not match is refused with every discrepancy. Only goods not (yet) received or accepted: "not eligible yet" (EXCEEDS_ELIGIBLE).
const matchError = (twoWay) => new SupplierBillError(409,
  `The bill does not match ${twoWay.purchaseOrderNumber}: ${twoWay.blocking.map((entry) => entry.message).join(" ")}`,
  twoWay.blocking.every((entry) => RECEIPT_CODES.includes(entry.code)) ? "SUPPLIER_BILL_EXCEEDS_ELIGIBLE" : "SUPPLIER_BILL_MATCH_MISMATCH",
  { issues: twoWay.blocking.map((entry) => ({ code: entry.code, message: entry.message })), discrepancies: twoWay.blocking });

// The stored bill evaluated against its order (posting after approval, reporting, approving exceptions).
export async function evaluateStoredBill(client, context, bill, order = null) {
  const purchaseOrder = order ?? (await client.query(`SELECT * FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, bill.source_purchase_order_id])).rows[0];
  const rows = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [context.organizationId, bill.id])).rows;
  const places = await currencyPlaces(client, context.organizationId, bill.currency_code.trim());
  return evaluateTwoWayMatch(client, context, { order: purchaseOrder, lines: linesFromStored(rows), billId: bill.id,
    header: { supplierId: bill.supplier_id, buyingRegistrationId: bill.buying_registration_id, currencyCode: bill.currency_code.trim(),
      statedTotal: bill.supplier_stated_total === null ? null : decimal(bill.supplier_stated_total), invoiceTotal: decimal(bill.invoice_total), places } });
}

// checkDuplicateSupplierInvoice: other live bills of the supplier with the same invoice (number without whitespace and case, same GSTIN, same financial year).
export async function checkDuplicateSupplierInvoice(client, context, { partyId, reference, gstin, billDate, excludeBillId = null }) {
  if (!reference) return [];
  const country = (await client.query(`SELECT country_code FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.country_code?.trim() ?? "IN";
  const key = supplierInvoiceKey(reference, gstin, billDate, country);
  const { rows } = await client.query(
    `SELECT id, bill_number, supplier_invoice_reference, bill_date, status, supplier_snapshot, supplier_tax_snapshot FROM tenant.accounting_vendor_bills
      WHERE organization_id = $1 AND party_id = $2 AND bill_type = 'bill' AND status NOT IN ('cancelled', 'reversed') AND id IS DISTINCT FROM $3::uuid
        AND upper(regexp_replace(COALESCE(supplier_invoice_reference, supplier_invoice_number, ''), '\\s+', '', 'g')) = $4`,
    [context.organizationId, partyId, excludeBillId, String(reference).replace(/\s+/g, "").toUpperCase()]);
  return rows.filter((row) => supplierInvoiceKey(row.supplier_invoice_reference, row.supplier_tax_snapshot?.gstin ?? row.supplier_snapshot?.gstin, row.bill_date, country) === key)
    .map((row) => ({ id: row.id, billNumber: row.bill_number, supplierInvoiceNumber: row.supplier_invoice_reference, status: row.status, billDate: dayOf(row.bill_date) }));
}
export const validateSupplierInvoiceNumber = (reference) => {
  const value = text(reference, 100);
  if (!value) fail("Enter the supplier's invoice number.", "supplierInvoiceNumber", "SUPPLIER_BILL_INVOICE_NUMBER_REQUIRED");
  return value;
};

// validateSupplierBillForPosting: everything posting checks, without posting. Returns { ready, issues, warnings, duplicates }.
export async function validateSupplierBillForPosting(client, context, billId, { bill: loaded = null } = {}) {
  const bill = loaded ?? await loadBill(client, context, billId);
  const organizationId = context.organizationId;
  const issues = [];
  const warnings = [];
  if (bill.status !== "draft") issues.push(`The bill is ${bill.status.replace("_", " ")}.`);
  if (!bill.supplier_invoice_reference) issues.push("Enter the supplier's invoice number.");
  if (!bill.bill_date) issues.push("Enter the supplier invoice date.");
  if (!bill.due_date) issues.push("The bill has no due date.");
  const lines = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [organizationId, bill.id])).rows;
  if (!lines.length) issues.push("The bill has no lines.");
  const duplicates = await checkDuplicateSupplierInvoice(client, context, { partyId: bill.party_id, reference: bill.supplier_invoice_reference,
    gstin: bill.supplier_tax_snapshot?.gstin ?? bill.supplier_snapshot?.gstin, billDate: bill.bill_date, excludeBillId: bill.id });
  const recorded = duplicates.filter((entry) => entry.status !== "draft");
  if (recorded.length) issues.push(`Supplier invoice ${bill.supplier_invoice_reference} is already recorded as ${recorded.map((entry) => `${entry.billNumber} (${entry.status.replace("_", " ")})`).join(", ")}.`);
  else if (duplicates.length) warnings.push(`Draft ${duplicates.map((entry) => entry.billNumber).join(", ")} has the same supplier invoice number.`);
  if (bill.two_way_evaluation_id && bill.source_purchase_order_id) {
    const evaluation = (await client.query(`SELECT result, discrepancies FROM tenant.supplier_bill_match_evaluations WHERE organization_id = $1 AND id = $2`,
      [organizationId, bill.two_way_evaluation_id])).rows[0];
    if (evaluation?.result === "mismatch") issues.push(...evaluation.discrepancies.filter((entry) => !entry.approved).map((entry) => entry.message));
  } else if (bill.matching_status === "exception") issues.push("A price differs from the purchase order. Correct the bill, amend the order, or have the variance accepted.");
  // The GSTIN the invoice was issued under must still be active: a commercially matched bill is still refused when its tax identity is not valid.
  if (bill.supplier_tax_registration_id) {
    const registration = (await client.query(`SELECT gstin, status FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND id = $2`,
      [organizationId, bill.supplier_tax_registration_id])).rows[0];
    if (registration && registration.status !== "active") issues.push(`The supplier GSTIN ${registration.gstin} on the bill is ${registration.status}: input tax cannot be recorded against it. Ask the supplier for an invoice under an active registration.`);
  }
  // Multi-location suppliers: the GSTIN that issued the invoice is chosen, never assumed.
  if (bill.supplier_id && !bill.supplier_tax_registration_id && decimal(bill.tax_total) > 0n) {
    const count = Number((await client.query(`SELECT count(*) FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active'`,
      [organizationId, bill.supplier_id])).rows[0].count);
    if (count > 1) issues.push("The supplier has several GST registrations: choose the one on the invoice.");
  }
  if (bill.supplier_stated_total !== null) {
    const difference = sub(bill.supplier_stated_total, bill.invoice_total);
    if ((difference < 0n ? -difference : difference) > ROUNDING_TOLERANCE)
      issues.push(`The calculated total ${dec(bill.invoice_total)} differs from the supplier's invoice total ${dec(bill.supplier_stated_total)}. Check the lines, prices and taxes.`);
  }
  // Payment terms: a rule counting from the date the invoice was received needs that date before the schedule is fixed.
  const terms = readTermSnapshot(bill.payment_term_snapshot);
  if (terms?.needsInvoiceReceivedDate && !bill.invoice_received_date)
    issues.push(`The payment terms ${terms.name} count from the date the supplier's invoice was received: record it before posting.`);
  if (bill.supplier_id && terms) {
    const statutory = await validateStatutoryPaymentDeadline(client, context, { supplierId: bill.supplier_id, termSnapshot: bill.payment_term_snapshot,
      referenceDate: dayOf(bill.acceptance_date ?? bill.invoice_received_date ?? bill.bill_date) });
    if (statutory.exceeds) warnings.push(statutory.message);
  }
  // Order bills: the quantities and amounts are checked again against what posted bills left (receipts reversed, returns, cancellations).
  if (bill.source_purchase_order_id) {
    const order = (await client.query(`SELECT status, purchase_order_number FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [organizationId, bill.source_purchase_order_id])).rows[0];
    if (order.status !== "confirmed") issues.push(`The purchase order ${order.purchase_order_number} is ${order.status}.`);
    issues.push(...await validatePartialBillQuantities(client, context, bill, lines));
  }
  // Finance must be able to post it: the payable, tax and withholding accounts, an open period, a rate for a foreign currency.
  const ledger = await finance(() => getPrimaryLedger(client, { ...context, permissions: [...(context.permissions ?? []), BILL_PERMISSIONS.financeView] }));
  const need = [["payable", "The Accounts Payable account mapping is not configured."]];
  if (decimal(bill.tax_total) > 0n) need.push(["input_tax", "The input tax account mapping is not configured."]);
  if (decimal(bill.withholding_total) > 0n) need.push(["withholding_tax", "The withholding (TDS) account mapping is not configured."]);
  if (decimal(bill.rounding_adjustment) !== 0n) need.push(["rounding", "The rounding account mapping is not configured."]);
  for (const [key, message] of need) {
    try { await getAccountMapping(client, context, ledger.id, key, { partyId: bill.party_id, date: dayOf(bill.accounting_date) }); } catch { issues.push(message); }
  }
  const period = (await client.query(`SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [organizationId, dayOf(bill.accounting_date)])).rows[0];
  if (!period) issues.push(`No accounting period covers the posting date ${dayOf(bill.accounting_date)}.`);
  else if (period.status !== "open") issues.push(`The accounting period ${period.name} is ${period.status}: choose a posting date in an open period.`);
  return { ready: issues.length === 0, issues, warnings, duplicates };
}

// validatePartialBillQuantities / validatePartialBillAmounts: a bill's order lines against what POSTED bills left — the quantity that may be billed
// now (matching policy), the order's remaining commitment, a fixed-value service's remaining value, and each receipt allocation (its receipt line
// billed once, the allocations adding up to the line's quantity). Returns the issues; run under the order's lock when posting.
export async function validatePartialBillQuantities(client, context, bill, lines = null) {
  const organizationId = context.organizationId;
  const billLines = lines ?? (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [organizationId, bill.id])).rows;
  const issues = [];
  const status = (await client.query(`SELECT * FROM tenant.purchase_order_line_status WHERE organization_id = $1 AND purchase_order_id = $2`, [organizationId, bill.source_purchase_order_id])).rows;
  const allocations = (await client.query(
    `SELECT allocation.vendor_bill_line_id, allocation.goods_receipt_line_id, allocation.quantity, billing.billable_quantity, billing.allocated_quantity, billing.receipt_number
       FROM tenant.supplier_bill_receipt_allocations allocation
       LEFT JOIN tenant.goods_receipt_line_billing billing ON billing.organization_id = allocation.organization_id AND billing.goods_receipt_line_id = allocation.goods_receipt_line_id
      WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2`, [organizationId, bill.id])).rows;
  const posted = POSTED_STATUSES.includes(bill.status);
  for (const row of status) {
    const mine = billLines.filter((line) => line.purchase_order_line_id === row.purchase_order_line_id);
    if (!mine.length) continue;
    const quantity = mine.reduce((total, line) => add(total, line.quantity), 0n);
    const amount = mine.reduce((total, line) => add(total, line.billed_amount ?? roundMoney(mul(line.quantity, row.unit_price), 2)), 0n);
    // Before posting the bill is not in the posted figures; once posted it is.
    const before = posted ? sub(row.billed_quantity, quantity) : decimal(row.billed_quantity);
    const label = `Order line ${row.line_number}`;
    if (add(before, quantity) > decimal(row.bill_target_quantity))
      issues.push(`${label}: ${dec(before)} already billed and ${dec(quantity)} on this bill exceed the ${dec(row.bill_target_quantity)} the order commits.`);
    else if (add(before, quantity) > decimal(row.billable_quantity))
      issues.push(`${label}: ${dec(before)} already billed and ${dec(quantity)} on this bill exceed the ${dec(row.billable_quantity)} that may be billed now${row.receipt_required && row.billing_basis === "receipt" ? " (received and accepted)" : ""}.`);
    if (mine.some((line) => line.billing_basis === "amount")) {
      const beforeAmount = posted ? sub(row.billed_amount, amount) : decimal(row.billed_amount);
      if (add(beforeAmount, amount) > decimal(row.agreed_amount)) issues.push(`${label}: ${dec(beforeAmount)} already billed and ${dec(amount)} on this bill exceed the agreed ${dec(row.agreed_amount)}.`);
    }
    if (row.receipt_required && row.billing_basis === "receipt")
      for (const line of mine) {
        const matched = allocations.filter((allocation) => allocation.vendor_bill_line_id === line.id).reduce((total, allocation) => add(total, allocation.quantity), 0n);
        if (matched < decimal(line.quantity)) issues.push(`${label}: only ${dec(matched)} of ${dec(line.quantity)} is matched to posted goods receipts — waiting for the goods (or their acceptance).`);
      }
  }
  for (const row of allocations) {
    if (row.billable_quantity === null) { issues.push("A goods receipt this bill draws on was reversed."); continue; }
    const others = posted ? sub(row.allocated_quantity, row.quantity) : decimal(row.allocated_quantity);
    if (add(others, row.quantity) > decimal(row.billable_quantity)) issues.push(`${row.receipt_number}: its received quantity is already billed by another posted bill.`);
  }
  return [...new Set(issues)];
}
export const validatePartialBillAmounts = validatePartialBillQuantities;

// validatePurchaseOrderPriceMatching: each order line's invoiced price against the agreed one (a difference blocks posting until corrected,
// amended or accepted with a reason).
export async function validatePurchaseOrderPriceMatching(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const lines = (await client.query(
    `SELECT line.sequence, line.unit_price, line.quantity, line.billing_basis, order_line.line_number, order_line.unit_price AS ordered FROM tenant.accounting_vendor_bill_lines line
       JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
      WHERE line.organization_id = $1 AND line.vendor_bill_id = $2 ORDER BY line.sequence`, [context.organizationId, bill.id])).rows;
  const discrepancies = lines.filter((line) => line.billing_basis !== "amount" && decimal(line.unit_price) !== decimal(line.ordered)).map((line) => ({
    lineNumber: line.line_number, ordered: dec(line.ordered), billed: dec(line.unit_price), difference: dec(sub(line.unit_price, line.ordered)),
    totalDifference: dec(roundMoney(mul(sub(line.unit_price, line.ordered), line.quantity), 2)) }));
  return { matchingStatus: bill.matching_status, overrideReason: bill.match_override_reason, discrepancies };
}

// postSupplierBill: validated again under the order's lock, then submitted to Finance's approval policy and — once approved — posted by Finance:
// the payable, input tax, reverse-charge and withholding, exactly once. A retry returns the posted bill. input: { duplicateOverrideReason?, idempotencyKey? }
export async function postSupplierBill(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.manage, "You do not have permission to post supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (["posted", "partially_paid", "paid", "overdue", "disputed"].includes(bill.status)) return { id: bill.id, status: "posted", replayed: true };
  if (bill.status === "pending_approval") return { id: bill.id, status: "awaiting_approval", replayed: true };
  if (bill.bill_type !== "bill") fail("Debit notes are posted from their own screen.", "billType", "SUPPLIER_BILL_LOCKED", 409);
  if (bill.source_purchase_order_id) {
    await loadPurchaseOrder(client, context, bill.source_purchase_order_id, { lock: true });
    await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 FOR UPDATE`, [context.organizationId, bill.source_purchase_order_id]);
  }
  if (bill.status === "draft") {
    const overrideReason = text(input.duplicateOverrideReason, 1000);
    const { bill: refreshed, built } = await refreshForPosting(client, context, bill);
    // Matching first, with every discrepancy; then what is not received yet; then everything else posting needs.
    if (built?.twoWay?.result === "mismatch") throw matchError(built.twoWay);
    if (built?.shortfalls?.length) throw new SupplierBillError(409, built.shortfalls[0], "SUPPLIER_BILL_EXCEEDS_ELIGIBLE", { issues: built.shortfalls.map((message) => ({ message })) });
    const check = await validateSupplierBillForPosting(client, context, bill.id, { bill: refreshed });
    const duplicateIssue = check.issues.find((issue) => issue.startsWith("Supplier invoice "));
    const others = check.issues.filter((issue) => issue !== duplicateIssue);
    if (duplicateIssue && overrideReason) {
      requirePoPermission(context, BILL_PERMISSIONS.overrideDuplicate, "You do not have permission to accept a duplicate supplier invoice.");
      if (overrideReason.length < 10) fail("Explain why this is not a duplicate (at least a sentence).", "duplicateOverrideReason");
      await client.query(`UPDATE tenant.accounting_vendor_bills SET duplicate_override_reason = $3, duplicate_override_by = $4 WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, bill.id, overrideReason, context.userId ?? null]);
    } else if (duplicateIssue) {
      throw new SupplierBillError(409, duplicateIssue, "SUPPLIER_BILL_DUPLICATE_INVOICE", { issues: [{ message: duplicateIssue }], duplicates: check.duplicates });
    }
    if (others.length) throw new SupplierBillError(409, others[0], "SUPPLIER_BILL_NOT_READY", { issues: others.map((message) => ({ message })) });
    const submitted = await finance(() => submitSubledgerDocument(client, fin(context), "vendor_bill", bill.id));
    if (submitted.status === "pending_approval") return { id: bill.id, status: "awaiting_approval", replayed: false };
    return finishPosting(client, context, refreshed);
  }
  return finishPosting(client, context, bill);
}

// Finance posts the approved bill: the payable, input tax, reverse charge and withholding, once.
async function finishPosting(client, context, bill) {
  // The moment it becomes billed: under the order's lock, what other bills posted meanwhile (another user's, one approved first) is respected —
  // the same remaining quantity or receipt is never billed twice.
  if (bill.bill_type === "bill" && bill.source_purchase_order_id) {
    await client.query(`SELECT id FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, bill.source_purchase_order_id]);
    await client.query(`SELECT id FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 FOR UPDATE`, [context.organizationId, bill.source_purchase_order_id]);
    const current = await loadBill(client, context, bill.id);
    const twoWay = await evaluateStoredBill(client, context, current);
    if (twoWay.result === "mismatch") throw matchError(twoWay);
    const issues = await validatePartialBillQuantities(client, context, current);
    if (issues.length) throw new SupplierBillError(409, issues[0], "SUPPLIER_BILL_EXCEEDS_ELIGIBLE", { issues: issues.map((message) => ({ message })) });
    // persistPostingMatchEvidence: the evaluation that authorised this posting, kept unchangeable.
    await persistMatchEvaluation(client, context, bill.id, twoWay, { posted: true });
  }
  const posted = await finance(() => postVendorBill(client, fin(context), bill.id));
  if (bill.bill_type === "bill") await generateComplianceDeadlines(client, context, bill.id);
  if (bill.source_purchase_order_id)
    await recordPoEvent(client, context, bill.source_purchase_order_id, "purchase_order.bill_posted", `Supplier bill ${bill.bill_number} (invoice ${bill.supplier_invoice_reference}) posted to Accounts Payable`,
      { details: { billId: bill.id } });
  return { id: bill.id, status: "posted", journalEntryId: posted.bill.journal_entry_id, replayed: false };
}

// approveSupplierBill: Finance's approver approves a bill awaiting approval (the content approved is the content posted), and it is posted.
export async function approveSupplierBill(client, context, billId) {
  requirePoPermission(context, BILL_PERMISSIONS.approve, "You do not have permission to approve supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  // A vendor credit awaiting approval is approved and posted by its own module (its claim, returns and order are updated with it).
  if (bill.bill_type === "credit_note") return (await import("../vendor-credits/credits.js")).approveVendorCredit(client, context, bill.id);
  if (bill.status !== "pending_approval") throw new SupplierBillError(409, "The bill is not awaiting approval.", "SUPPLIER_BILL_NOT_PENDING");
  await finance(() => approveSubledgerDocument(client, fin(context), "vendor_bill", bill.id, bill.content_hash));
  // Approving is the last control: Finance posts what was approved.
  return finishPosting(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), BILL_PERMISSIONS.manage])] }, bill);
}

// cancelDraftSupplierBill: a draft that will not be posted. It never had an accounting effect, and its receipt allocations no longer count.
export async function cancelDraftSupplierBill(client, context, billId, input = {}) {
  requireBillCreate(context, "You do not have permission to cancel supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (bill.status === "cancelled") return { id: bill.id, status: "cancelled", replayed: true };
  await finance(() => cancelDraftVendorBill(client, drafting(context), bill.id, { reason: input.reason }));
  return { id: bill.id, status: "cancelled", replayed: false };
}

// reverseSupplierBill: a posted bill entered in error, while nothing settled it (no payment or vendor credit). Finance reverses its journals and
// tax entries; its order and receipt quantities become billable again because a reversed bill no longer counts. The bill is kept.
export async function reverseSupplierBill(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.reverse, "You do not have permission to reverse supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (bill.status === "reversed") return { id: bill.id, status: "reversed", replayed: true };
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the reversal.", "reason");
  await finance(() => reverseVendorBill(client, fin(context), bill.id, { reason }));
  await voidComplianceDeadlines(client, context, bill.id);
  if (bill.source_purchase_order_id)
    await recordPoEvent(client, context, bill.source_purchase_order_id, "purchase_order.bill_reversed", `Supplier bill ${bill.bill_number} reversed: ${reason}`, { details: { billId: bill.id } });
  return { id: bill.id, status: "reversed", replayed: false };
}

// previewSupplierBill: what a bill would be — amounts from the server's calculation, matching, duplicates — without recording anything.
// input: as createSupplierBill (with billId? to preview changes to a draft).
export async function previewSupplierBill(client, context, input = {}) {
  requireBillAccess(context);
  const current = input.billId ? await loadBill(client, context, input.billId) : null;
  const source = current?.source_type ?? (["purchase_order", "goods_receipt", "direct"].includes(input.sourceType) ? input.sourceType : input.purchaseOrderId ? "purchase_order" : "direct");
  let order = null;
  let receiptIds = null;
  if (source === "goods_receipt") {
    receiptIds = (Array.isArray(input.goodsReceiptIds) ? input.goodsReceiptIds : []).map((id) => requireUuid(id, "Goods receipt"));
    const first = receiptIds.length ? (await client.query(`SELECT purchase_order_id FROM tenant.goods_receipts WHERE organization_id = $1 AND id = $2`, [context.organizationId, receiptIds[0]])).rows[0] : null;
    if (!first) fail("Choose the goods receipts the supplier billed.", "goodsReceiptIds", "SUPPLIER_BILL_RECEIPTS_REQUIRED");
    order = await loadPurchaseOrder(client, context, first.purchase_order_id);
  } else if (source === "purchase_order") {
    order = await loadPurchaseOrder(client, context, requireUuid(current?.source_purchase_order_id ?? input.purchaseOrderId, "Purchase order"));
  }
  const built = await buildBill(client, context, source, input, { order, receiptIds, current });
  const duplicates = await checkDuplicateSupplierInvoice(client, context, { partyId: built.header.partyId, reference: built.header.reference, gstin: built.header.supplierSnapshot.gstin,
    billDate: built.header.billDate, excludeBillId: current?.id ?? null });
  const view = totalsView(built.calculated);
  return {
    ...view, matchingStatus: built.matchingStatus, discrepancies: built.discrepancies, duplicates, warnings: built.header.warnings,
    twoWay: built.twoWay ? { result: built.twoWay.result, header: built.twoWay.header, lines: built.twoWay.lines, discrepancies: built.twoWay.discrepancies,
      expectedAmount: built.twoWay.expectedAmount, actualAmount: built.twoWay.actualAmount, varianceAmount: built.twoWay.varianceAmount } : { result: "not_applicable" },
    lines: view.lines.map((line, index) => ({ ...line, description: built.calculated.lines[index].description, purchaseOrderLineId: built.calculated.lines[index].order?.id ?? null,
      receipts: built.calculated.lines[index].input.allocations.map((allocation) => ({ receiptNumber: allocation.receiptNumber, quantity: dec(allocation.quantity) })) })),
    header: { supplierName: built.header.supplier.display_name, currencyCode: built.header.currencyCode, supplierGstin: built.header.supplierSnapshot.gstin, registrationChoices: built.header.registrationChoices,
      placeOfSupply: built.header.placeOfSupply, supplierStateCode: built.header.supplierStateCode, computedDueDate: built.header.computedDueDate,
      dueDate: built.header.dueDate ?? built.header.computedDueDate, withholdingSection: built.header.section ? { code: built.header.section.code, rate: dec(built.header.section.rate) } : null },
  };
}

// ---------------------------------------------------------------- 2-Way Matching operations

const evidenceView = async (client, context, evaluationId) => {
  const evaluation = (await client.query(`SELECT * FROM tenant.supplier_bill_match_evaluations WHERE organization_id = $1 AND id = $2`, [context.organizationId, evaluationId])).rows[0];
  if (!evaluation) return null;
  const lines = (await client.query(`SELECT * FROM tenant.supplier_bill_match_line_results WHERE organization_id = $1 AND evaluation_id = $2 ORDER BY line_sequence`,
    [context.organizationId, evaluationId])).rows;
  return {
    id: evaluation.id, result: evaluation.result, purchaseOrderRevision: evaluation.purchase_order_revision, evaluatedAt: evaluation.evaluated_at, postedEvidence: evaluation.posted_evidence,
    matchingType: evaluation.match_scope, receiptBasis: evaluation.receipt_eligibility_basis,
    expectedAmount: dec(evaluation.expected_amount), actualAmount: dec(evaluation.actual_amount), varianceAmount: dec(evaluation.variance_amount),
    header: evaluation.header_checks, discrepancies: evaluation.discrepancies,
    lines: lines.map((line) => ({
      sequence: line.line_sequence, purchaseOrderLineId: line.purchase_order_line_id, orderLineNumber: line.details?.orderLineNumber ?? null, description: line.details?.description ?? null,
      billingBasis: line.billing_basis, ordered: dec(line.po_ordered_quantity), cancelled: dec(line.po_cancelled_quantity), previouslyBilled: dec(line.previously_billed_quantity),
      remaining: dec(line.remaining_eligible_quantity), quantity: dec(line.bill_quantity), invoicedQuantity: line.details?.invoicedQuantity ?? null, agreedAmount: dec(line.agreed_amount),
      previouslyBilledAmount: dec(line.previously_billed_amount), remainingAmount: dec(line.remaining_eligible_amount), billedAmount: line.details?.billedAmount ?? null,
      expectedUnitPrice: dec(line.expected_unit_price), expectedNetUnitPrice: line.details?.expectedNetUnitPrice ?? null, actualUnitPrice: dec(line.actual_unit_price),
      expectedNet: dec(line.expected_net_amount), actualNet: dec(line.actual_net_amount), variance: dec(line.variance_amount), expectedTax: dec(line.expected_tax_amount),
      actualTax: dec(line.actual_tax_amount), codes: line.discrepancy_codes, result: line.result, matchingBasis: line.matching_basis, received: dec(line.valid_received_quantity),
      eligibleReceipt: dec(line.eligible_receipt_quantity), previouslyAllocated: dec(line.previously_allocated_quantity), currentlyEligible: dec(line.currently_eligible_quantity),
      receiptRemaining: line.details?.receiptRemaining ?? null, allocations: line.details?.allocations ?? [],
    })),
  };
};

// getSupplierBillMatchingResult: a draft is evaluated now against the order as it is (not saved: Recheck saves it); a posted bill shows the
// evaluation that authorised its posting — never recalculated.
export async function getSupplierBillMatchingResult(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const exceptions = (await client.query(
    `SELECT exception.*, users.full_name AS approved_by_name FROM tenant.supplier_bill_match_exceptions exception LEFT JOIN public.users users ON users.id = exception.approved_by
      WHERE exception.organization_id = $1 AND exception.vendor_bill_id = $2 ORDER BY exception.approved_at`, [context.organizationId, bill.id])).rows.map((row) => ({
    id: row.id, lineSequence: row.line_sequence, code: row.discrepancy_code, expected: dec(row.expected_value), actual: dec(row.actual_value), variance: dec(row.variance_amount),
    reason: row.reason, accountingTreatment: row.accounting_treatment, accountId: row.account_id, status: row.status, approvedBy: row.approved_by_name, approvedAt: row.approved_at,
    expiredAt: row.expired_at }));
  if (!bill.source_purchase_order_id || bill.bill_type !== "bill")
    return { billId: bill.id, result: "not_applicable", evaluation: null, evidence: null, exceptions, actions: { recheck: false, approveException: false } };
  const order = (await client.query(`SELECT * FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [context.organizationId, bill.source_purchase_order_id])).rows[0];
  const draft = ["draft", "pending_approval", "approved"].includes(bill.status);
  const evidenceId = !draft ? (await client.query(`SELECT id FROM tenant.supplier_bill_match_evaluations WHERE organization_id = $1 AND vendor_bill_id = $2 AND posted_evidence
      ORDER BY evaluated_at DESC LIMIT 1`, [context.organizationId, bill.id])).rows[0]?.id : null;
  const evidence = evidenceId ? await evidenceView(client, context, evidenceId) : null;
  const evaluation = draft ? await evaluateStoredBill(client, context, bill, order) : evidence;
  const checkedRevision = bill.two_way_evaluation_id ? (await client.query(`SELECT purchase_order_revision FROM tenant.supplier_bill_match_evaluations WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, bill.two_way_evaluation_id])).rows[0]?.purchase_order_revision : null;
  const stale = draft && (checkedRevision === null || checkedRevision === undefined || Number(checkedRevision) !== Number(order.revision));
  const unapproved = (evaluation?.discrepancies ?? []).filter((entry) => !entry.approved);
  return {
    billId: bill.id, purchaseOrderId: order.id, purchaseOrderNumber: order.purchase_order_number, purchaseOrderRevision: Number(order.revision),
    result: evaluation?.result ?? COALESCE_RESULT(bill), stored: bill.two_way_result, checkedAt: bill.two_way_checked_at, stale, evaluation, evidence, exceptions,
    actions: {
      recheck: bill.status === "draft" && (poCan(context, BILL_PERMISSIONS.create) || poCan(context, BILL_PERMISSIONS.manage)),
      approveException: bill.status === "draft" && poCan(context, BILL_PERMISSIONS.overrideMatch) && bill.created_by !== context.userId && unapproved.length > 0
        && unapproved.every((entry) => APPROVABLE_CODES.includes(entry.code)),
      openOrder: true,
    },
  };
}
const COALESCE_RESULT = (bill) => bill.two_way_result ?? (bill.matching_status === "exception" ? "mismatch" : bill.matching_status === "overridden" ? "approved_exception" : "matched");

// Check Matching / Revalidate on a draft: rebuilt and evaluated against the order and posted bills as they are now; the result is saved.
export async function recheckSupplierBillMatching(client, context, billId) {
  requireBillCreate(context, "You do not have permission to check supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (bill.status !== "draft") throw new SupplierBillError(409, "Only a draft is rechecked; a posted bill keeps the evaluation it was posted with.", "SUPPLIER_BILL_LOCKED");
  if (!bill.source_purchase_order_id) return getSupplierBillMatchingResult(client, context, bill.id);
  await rebuildDraft(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), BILL_PERMISSIONS.create])] }, bill,
    { dueDateOverrideReason: bill.due_date_override_reason ?? undefined }, { trusted: true });
  return getSupplierBillMatchingResult(client, context, bill.id);
}

// approveSupportedMatchException: a commercial variance (price, discount, an extra charge) accepted by someone allowed to — never the bill's
// own creator — with a reason and its accounting treatment: purchase price variance for goods cleared from GRNI, the line's cost otherwise, a
// charge to its expense account. Supplier, company, currency, order, product, unit and quantity problems are never accepted. The approval
// holds while the line stays as approved.
export async function approveSupportedMatchException(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.overrideMatch, "You do not have permission to accept matching variances.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (bill.status !== "draft" || !bill.source_purchase_order_id) throw new SupplierBillError(409, "Variances are accepted on a draft bill of a purchase order.", "SUPPLIER_BILL_LOCKED");
  if (bill.created_by && bill.created_by === context.userId)
    throw new SupplierBillError(403, "Someone other than the bill's creator accepts its variances.", "SUPPLIER_BILL_SELF_APPROVAL");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 10) fail("Explain why the variance is accepted (at least a sentence).", "reason", "SUPPLIER_BILL_REASON_REQUIRED");
  // Internal steps on the approver's behalf: rebuilding the draft reads the order, whoever approves.
  const trusted = { ...context, permissions: [...new Set([...(context.permissions ?? []), BILL_PERMISSIONS.create, "procurement.po.view", "procurement.po.view_all"])] };
  const fresh = (await rebuildDraft(client, trusted, bill, { dueDateOverrideReason: bill.due_date_override_reason ?? undefined }, { trusted: true })).built.twoWay;
  const open = fresh.discrepancies.filter((entry) => !entry.approved);
  const blocked = open.filter((entry) => !APPROVABLE_CODES.includes(entry.code));
  if (blocked.length)
    throw new SupplierBillError(409, `These cannot be accepted as an exception: ${blocked.map((entry) => entry.message).join(" ")}`, "SUPPLIER_BILL_MATCH_NOT_APPROVABLE",
      { issues: blocked.map((entry) => ({ code: entry.code, message: entry.message })) });
  if (!open.length) throw new SupplierBillError(409, "There is no variance to accept: the bill matches.", "SUPPLIER_BILL_NOTHING_TO_APPROVE");
  const lines = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2`, [context.organizationId, bill.id])).rows;
  const settings = (await client.query(`SELECT post_receipt_accrual FROM tenant.procurement_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  const ledger = await finance(() => getPrimaryLedger(client, fin(context)));
  for (const entry of open) {
    const line = lines.find((row) => row.sequence === entry.lineSequence);
    const allocated = line ? Number((await client.query(`SELECT count(*) FROM tenant.supplier_bill_receipt_allocations WHERE organization_id = $1 AND vendor_bill_line_id = $2`,
      [context.organizationId, line.id])).rows[0].count) : 0;
    let treatment = entry.code === "UNAUTHORIZED_CHARGE" ? "charge_expense" : "line_cost";
    let accountId = line?.expense_account_id ?? null;
    if (treatment === "line_cost" && allocated && settings?.post_receipt_accrual) {
      treatment = "purchase_price_variance";
      try { accountId = (await getAccountMapping(client, context, ledger.id, "purchase_price_variance", {})).account_id; }
      catch { fail("Goods cleared from GRNI need the purchase price variance account mapping before a price variance can be accepted.", "accountMapping", "SUPPLIER_BILL_VARIANCE_ACCOUNT_REQUIRED", 409); }
    }
    await client.query(
      `INSERT INTO tenant.supplier_bill_match_exceptions (organization_id, vendor_bill_id, evaluation_id, line_sequence, purchase_order_line_id, discrepancy_code, expected_value,
         actual_value, variance_amount, fingerprint, reason, accounting_treatment, account_id, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [context.organizationId, bill.id, bill.two_way_evaluation_id, entry.lineSequence, entry.purchaseOrderLineId ?? null, entry.code, entry.expected ?? null, entry.actual ?? null,
        entry.difference ?? null, entry.fingerprint, reason, treatment, accountId, context.userId ?? null]);
    await accountingEvent(client, fin(context), "vendor_bill", bill.id, "accounting.vendor_bill.match_exception_approved", null, null,
      { code: entry.code, lineSequence: entry.lineSequence, expected: entry.expected, actual: entry.actual, difference: entry.difference, reason, treatment });
  }
  await recordPoEvent(client, context, bill.source_purchase_order_id, "purchase_order.bill_variance_accepted",
    `Supplier bill ${bill.bill_number}: ${open.map((entry) => entry.label).join(", ")} accepted — ${reason}`, { details: { billId: bill.id, codes: open.map((entry) => entry.code) } });
  await rebuildDraft(client, trusted, await loadBill(client, context, bill.id, { lock: true }), { dueDateOverrideReason: bill.due_date_override_reason ?? undefined }, { trusted: true });
  return getSupplierBillMatchingResult(client, context, bill.id);
}
