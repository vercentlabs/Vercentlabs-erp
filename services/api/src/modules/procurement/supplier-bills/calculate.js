// What a supplier bill charges, calculated on the server only (calculateSupplierBillTotals).
//
//   quantity × invoiced unit price                 = gross
//   − line discount                                = net
//   − its share of the document discount           = taxable value
//   shared tax engine (supplier state → place of supply) = tax components
//   taxable + tax charged                          = invoice total
//   − withholding (TDS) on the taxable value       = net payable to the supplier
//
// calculatePartialBillDiscounts: billing part of a purchase order line at its agreed price uses the order's own
// discounts in proportion to the quantity (the last bill of the line takes
// what is left, so partial bills add up to the order exactly). A different
// price is recorded as a price variance against the order; the order itself is
// never repriced. Reverse-charge tax is calculated but not charged: the buyer
// self-assesses it. Amounts use decimal arithmetic, rounded to the currency.
import { add, decimal, div, formatDecimal, mul, percent, roundMoney, sub } from "../../../core/decimal.js";
import { TaxError, computeTax, loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
import { SupplierBillError, fail, optionalUuid, text } from "./constants.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const QTY = /^\d+(?:\.\d{1,6})?$/;

export async function currencyPlaces(client, organizationId, code) {
  const row = (await client.query(`SELECT decimal_places FROM tenant.currencies WHERE organization_id = $1 AND code = $2`, [organizationId, code])).rows[0];
  return row ? Number(row.decimal_places) : 2;
}

// A composition, unregistered or overseas supplier charges no GST; reverse-charge services are taxed on the buyer whatever the supplier's position.
const supplyTypeFor = (registrationType) => (["registered_regular", "sez", "deemed_export", null, undefined, ""].includes(registrationType) ? "domestic" : "non_gst");

function readAmount(value, label, field) {
  const raw = String(value ?? "").trim();
  if (!QTY.test(raw)) fail(`${label} must be zero or more.`, field, "SUPPLIER_BILL_AMOUNT_INVALID");
  return decimal(raw);
}
function readDiscount(type, value, label) {
  if (!type || type === "none") return { type: null, value: 0n };
  if (!["percent", "amount"].includes(type)) fail(`${label}: choose a percentage or an amount discount.`, "discountType");
  const amount = readAmount(value ?? "0", `${label} discount`, "discountValue");
  if (type === "percent" && amount > decimal(100)) fail(`${label}: a discount cannot exceed 100%.`, "discountValue", "SUPPLIER_BILL_DISCOUNT_INVALID");
  return { type, value: amount };
}

// document: { currencyCode, billDate, priceMode, supplierStateCode, placeOfSupply, buyingRegistrationId, supplierRegistrationType, withholdingRate,
//   documentDiscountType, documentDiscountValue, lines: [{ quantity, unitPrice, discountType?, discountValue?, taxCategoryId, description, noWithholding?,
//   orderLine? (the purchase order line, with previouslyBilled { quantity, taxable, lineDiscount, allocated } of posted bills), billingBasis?, billedAmount? }] }
export async function calculateSupplierBillTotals(client, context, document) {
  const organizationId = context.organizationId;
  const places = await currencyPlaces(client, organizationId, document.currencyCode);
  let tax;
  try {
    tax = await loadTaxContext(client, { organizationId, sellerRegistrationId: document.buyingRegistrationId ?? null });
  } catch (error) {
    if (error instanceof TaxError) throw new SupplierBillError(error.status, error.message, error.code);
    throw error;
  }
  const inclusive = document.priceMode === "inclusive";
  const supplyType = supplyTypeFor(document.supplierRegistrationType);
  const withholdingRate = decimal(document.withholdingRate ?? 0);
  const lines = document.lines ?? [];
  if (!lines.length) fail("Add at least one line.", "lines", "SUPPLIER_BILL_NO_LINES");
  const priced = [];
  for (const [index, input] of lines.entries()) {
    const label = `Line ${index + 1}`;
    const quantity = decimal(input.quantity);
    if (quantity <= 0n) fail(`${label}: the quantity must be greater than zero.`, "quantity", "SUPPLIER_BILL_QUANTITY_INVALID");
    const unitPrice = readAmount(input.unitPrice, `${label} unit price`, "unitPrice");
    if (unitPrice <= 0n) fail(`${label}: enter the price the supplier charged.`, "unitPrice", "SUPPLIER_BILL_PRICE_INVALID");
    // A fixed-value service billed by amount: the amount is the gross (its quantity is only the share of the commitment it consumes).
    const gross = input.billingBasis === "amount" && input.billedAmount !== null && input.billedAmount !== undefined ? roundMoney(decimal(input.billedAmount), places) : roundMoney(mul(quantity, unitPrice), places);
    const order = input.orderLine ?? null;
    let lineDiscount; let allocated = 0n; let discount = { type: null, value: 0n }; let orderShare = null;
    if (order) {
      // The order's discounts, in proportion to the quantity billed; the final bill of a line takes the remainder.
      const ordered = decimal(order.ordered_quantity);
      const before = order.previouslyBilled ?? { quantity: 0n, taxable: 0n, lineDiscount: 0n, allocated: 0n };
      const final = add(before.quantity, quantity) === ordered;
      const share = (amount, already) => (final ? sub(decimal(amount), already) : roundMoney(div(mul(amount, quantity), ordered), places));
      orderShare = { taxable: share(order.taxable_amount, before.taxable), lineDiscount: share(order.line_discount, before.lineDiscount), allocated: share(order.allocated_document_discount, before.allocated) };
      discount = { type: order.discount_type, value: decimal(order.discount_value ?? 0) };
      if (input.invoiceDiscount) {
        // The discount the supplier's invoice shows replaces the agreed ones (matching then compares the net value with the agreed net).
        discount = readDiscount(input.invoiceDiscount.type, input.invoiceDiscount.value, label);
        lineDiscount = discount.type === "percent" ? roundMoney(percent(gross, discount.value), places) : roundMoney(discount.value, places);
        allocated = 0n;
      } else if (unitPrice === decimal(order.unit_price)) {
        lineDiscount = orderShare.lineDiscount;
        allocated = orderShare.allocated;
      } else {
        lineDiscount = order.discount_type === "percent" ? roundMoney(percent(gross, decimal(order.discount_value)), places) : orderShare.lineDiscount;
        allocated = orderShare.allocated;
      }
    } else {
      discount = readDiscount(input.discountType, input.discountValue, label);
      lineDiscount = discount.type === "percent" ? roundMoney(percent(gross, discount.value), places) : roundMoney(discount.value, places);
    }
    if (lineDiscount > gross) fail(`${label}: the discount is more than the line value.`, "discountValue", "SUPPLIER_BILL_DISCOUNT_INVALID");
    priced.push({ input, label, quantity, unitPrice, gross, lineDiscount, allocated, discount, order, orderShare, net: sub(gross, lineDiscount) });
  }
  // A document discount on a direct bill, shared over its lines by value (a purchase order's own discount is already in its lines).
  const docDiscount = readDiscount(document.documentDiscountType, document.documentDiscountValue, "Bill discount");
  if (docDiscount.type && priced.some((line) => line.order)) fail("A bill from a purchase order carries the order's own discounts.", "documentDiscountType");
  const netTotal = priced.reduce((total, line) => add(total, line.net), 0n);
  const documentDiscountAmount = docDiscount.type === "percent" ? roundMoney(percent(netTotal, docDiscount.value), places) : roundMoney(docDiscount.value, places);
  if (documentDiscountAmount > netTotal) fail("The bill discount is more than the bill value.", "documentDiscountValue", "SUPPLIER_BILL_DISCOUNT_INVALID");
  if (documentDiscountAmount > 0n) {
    const eligible = priced.filter((line) => line.net > 0n);
    let given = 0n;
    eligible.forEach((line, index) => {
      line.allocated = index === eligible.length - 1 ? sub(documentDiscountAmount, given) : roundMoney(div(mul(documentDiscountAmount, line.net), netTotal), places);
      given = add(given, line.allocated);
    });
  }

  const result = [];
  const totals = { gross: 0n, lineDiscount: 0n, documentDiscount: 0n, taxable: 0n, tax: 0n, reverseChargeTax: 0n, withholding: 0n, invoiceTotal: 0n, netPayable: 0n, variance: 0n };
  for (const line of priced) {
    const value = sub(line.net, line.allocated);
    if (value <= 0n) fail(`${line.label}: discounts take the value to zero or below.`, "discountValue", "SUPPLIER_BILL_DISCOUNT_INVALID");
    const taxCategoryId = optionalUuid(line.input.taxCategoryId, "Tax category");
    const category = taxCategoryId
      ? (await client.query(`SELECT reverse_charge FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2`, [organizationId, taxCategoryId])).rows[0] : null;
    let resolved;
    try {
      resolved = await resolveLineTax(client, tax, { taxCategoryId, date: document.billDate, sellerStateCode: document.supplierStateCode, placeOfSupply: document.placeOfSupply,
        supplyType: category?.reverse_charge ? "domestic" : supplyType, allowInactive: Boolean(line.order) });
    } catch (error) {
      if (error instanceof TaxError) throw new SupplierBillError(error.status, `${line.label}: ${error.message}`, error.code);
      throw error;
    }
    if (resolved.needsPlaceOfSupply) fail(`${line.label}: the supplier's state and the place of supply are needed to work out GST.`, "placeOfSupply", "SUPPLIER_BILL_PLACE_OF_SUPPLY_REQUIRED", 409);
    const reverseCharge = Boolean(resolved.reverseCharge && resolved.components.length);
    // The supplier of a reverse-charge supply charges no tax: the value is the taxable value.
    const computed = computeTax({ base: value, inclusive: inclusive && !reverseCharge, components: resolved.components, decimalPlaces: places });
    const taxable = computed.taxableAmount;
    const chargedTax = reverseCharge ? 0n : computed.taxAmount;
    const reverseChargeTax = reverseCharge ? computed.taxAmount : 0n;
    const withholding = withholdingRate > 0n && !line.input.noWithholding ? roundMoney(percent(taxable, withholdingRate), places) : 0n;
    const variance = line.orderShare ? sub(taxable, line.orderShare.taxable) : 0n;
    const invoiceLine = add(taxable, chargedTax);
    totals.gross = add(totals.gross, line.gross); totals.lineDiscount = add(totals.lineDiscount, line.lineDiscount); totals.documentDiscount = add(totals.documentDiscount, line.allocated);
    totals.taxable = add(totals.taxable, taxable); totals.tax = add(totals.tax, chargedTax); totals.reverseChargeTax = add(totals.reverseChargeTax, reverseChargeTax);
    totals.withholding = add(totals.withholding, withholding); totals.invoiceTotal = add(totals.invoiceTotal, invoiceLine); totals.variance = add(totals.variance, variance);
    result.push({
      ...line, taxCategoryId, treatment: resolved.treatment, rate: resolved.rate, supplyNature: resolved.supplyNature, reverseCharge, taxable, chargedTax, reverseChargeTax,
      components: computed.components.map((component) => ({ ...component, classification: reverseCharge ? "reverse_charge" : "input" })), withholding, variance,
      lineTotal: invoiceLine, description: text(line.input.description, 1000),
    });
  }
  totals.netPayable = sub(totals.invoiceTotal, totals.withholding);
  return { lines: result, totals, places, supplyType, documentDiscountAmount };
}

// Plain JSON for the screen.
export function totalsView(calculated) {
  return {
    totals: Object.fromEntries(Object.entries(calculated.totals).map(([key, value]) => [key, dec(value)])),
    lines: calculated.lines.map((line) => ({
      quantity: dec(line.quantity), unitPrice: dec(line.unitPrice), gross: dec(line.gross), lineDiscount: dec(line.lineDiscount), allocatedDocumentDiscount: dec(line.allocated),
      taxableAmount: dec(line.taxable), taxAmount: dec(line.chargedTax), reverseChargeTax: dec(line.reverseChargeTax), withholding: dec(line.withholding), lineTotal: dec(line.lineTotal),
      variance: dec(line.variance), reverseCharge: line.reverseCharge, treatment: line.treatment, rate: dec(line.rate),
      components: line.components.map((component) => ({ type: component.type, label: component.label, rate: dec(component.rate), taxAmount: dec(component.taxAmount), classification: component.classification })),
    })),
  };
}
