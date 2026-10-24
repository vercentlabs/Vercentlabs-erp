// What a purchase order costs, calculated on the server only.
//
//   ordered quantity × agreed unit price           = gross
//   − line discount (percent or amount)            = net
//   − its share of the document discount           = taxable base
//   shared tax engine (supplier state → buyer)     = tax components
//
// The agreed price is always the one entered (or carried from a supplier
// quotation): a product's purchase cost is only a suggestion and a missing
// price is never treated as zero. A zero price needs a reason and the
// override permission. All amounts use decimal arithmetic and are rounded to
// the currency.
import { add, decimal, div, mul, percent, roundMoney, sub, formatDecimal } from "../../../core/decimal.js";
import { TaxError, computeTax, loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { poCan } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, fail, optionalUuid, readDate, text } from "./constants.js";
import { stockOn } from "../../../core/products/tracking.js";
import { contractOverdraw, contractRatesFor, oneOffContractKey } from "../rate-contracts/index.js";
import { supplierRateFor } from "../supplier-rates/index.js";
import { purchaseWarningsFor } from "../warnings.js";
import { databaseToday } from "../org-day.js";

export const dec = (value) => formatDecimal(value);
const QTY = /^\d+(?:\.\d{1,6})?$/;
const MONEY = /^\d+(?:\.\d{1,6})?$/;

// The order line's cost centre (report Phase 3): an active one of the company, or none.
async function costCenterOf(client, organizationId, value, label) {
  const id = optionalUuid(value, `${label} cost centre`);
  if (!id) return null;
  if (!(await client.query(`SELECT 1 FROM public.cost_centers WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, id])).rowCount)
    fail(`${label}: choose an active cost centre.`, "costCenterId", "PURCHASE_ORDER_COST_CENTER_INVALID", 409);
  return id;
}

export async function currencyPlaces(client, organizationId, code) {
  const row = (await client.query(`SELECT decimal_places FROM tenant.currencies WHERE organization_id = $1 AND code = $2`, [organizationId, code])).rows[0];
  return row ? Number(row.decimal_places) : 2;
}

// The supplier's GST position decides whether GST is charged at all: a
// composition, unregistered or overseas supplier charges none on the order.
export function supplyTypeForSupplier(registrationType) {
  return ["registered_regular", "sez", "deemed_export", null, undefined, ""].includes(registrationType) ? "domestic" : "non_gst";
}

// What the order's unit refuses, as the order's own error codes.
const UOM_CODES = { no_conversion: "PURCHASE_ORDER_UOM_CONVERSION_MISSING", unit_not_found: "PURCHASE_ORDER_UOM_INVALID", unit_inactive: "PURCHASE_ORDER_UOM_INVALID",
  not_enabled: "PURCHASE_ORDER_UOM_INVALID", precision: "PURCHASE_ORDER_QUANTITY_INVALID", base_precision: "PURCHASE_ORDER_QUANTITY_INVALID", serial_fraction: "PURCHASE_ORDER_QUANTITY_INVALID",
  conversion_loss: "PURCHASE_ORDER_QUANTITY_INVALID", quantity_invalid: "PURCHASE_ORDER_QUANTITY_INVALID" };

async function uomOf(client, organizationId, uomId) {
  if (!uomId) return null;
  return (await client.query(`SELECT id, code, name, decimal_places, status FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [organizationId, uomId])).rows[0] ?? null;
}

export function productTypeOf(item) {
  if (item.item_type === "service") return "service";
  return item.track_inventory ? "stock" : "non_stock";
}

function readQuantity(value, label) {
  const raw = String(value ?? "").trim();
  if (!QTY.test(raw) || decimal(raw) <= 0n) fail(`${label}: the quantity must be greater than zero.`, "quantity", "PURCHASE_ORDER_QUANTITY_INVALID");
  return decimal(raw);
}

function readDiscount(type, value, label) {
  if (!type || type === "none") return { type: null, value: decimal(0) };
  if (!["percent", "amount"].includes(type)) fail(`${label}: choose a percentage or an amount discount.`, "discountType");
  const raw = String(value ?? "0").trim();
  if (!MONEY.test(raw)) fail(`${label}: the discount must be zero or more.`, "discountValue", "PURCHASE_ORDER_DISCOUNT_INVALID");
  const amount = decimal(raw);
  if (type === "percent" && amount > decimal(100)) fail(`${label}: a discount cannot exceed 100%.`, "discountValue", "PURCHASE_ORDER_DISCOUNT_INVALID");
  return { type, value: amount };
}

// document: { supplier (snapshot with gstRegistrationType), supplierStateCode, buyerStateCode, buyingRegistrationId, orderDate, currencyCode,
//   priceMode, documentDiscountType, documentDiscountValue, lines[] }
// options: { allowMissingPrice } (a preview reports a missing price instead of refusing).
// Returns { lines, totals, taxContext, warnings }.
export async function calculatePurchaseOrderTotals(client, context, document, { allowMissingPrice = false } = {}) {
  const organizationId = context.organizationId;
  const places = await currencyPlaces(client, organizationId, document.currencyCode);
  const lines = Array.isArray(document.lines) ? document.lines : [];
  if (!lines.length && !allowMissingPrice) fail("Add at least one line.", "lines", "PURCHASE_ORDER_NO_LINES");
  let tax;
  try {
    tax = await loadTaxContext(client, { organizationId, sellerRegistrationId: document.buyingRegistrationId ?? null , purchase: true });
  } catch (error) {
    if (error instanceof TaxError) throw new PurchaseOrderError(error.status, error.message, error.code);
    throw error;
  }
  const supplyType = supplyTypeForSupplier(document.supplier?.gstRegistrationType);
  const inclusive = document.priceMode === "inclusive";
  const warnings = [];
  // The supplier's active rate contracts on the order date (Procurement plan Phase 3): a contracted item's price defaults to the contract rate.
  const priceDate = document.orderDate ?? (await databaseToday(client, organizationId));
  const contracts = await contractRatesFor(client, organizationId, { supplierId: document.supplierId, date: priceDate, currencyCode: document.currencyCode ?? null });
  const priced = [];
  // Without the Stock app nothing bought is kept in stock: products are non-stock lines with no receiving warehouse.
  const keepsStock = await stockOn(client, context);
  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index] ?? {};
    const label = `Line ${index + 1}`;
    const productId = optionalUuid(input.productId ?? input.itemId, "Product");
    let item = null;
    let productType;
    let uomId = optionalUuid(input.uomId, "Unit of measure");
    let taxCategoryId;
    let description = text(input.description, 2000);
    let expenseAccountId = optionalUuid(input.expenseAccountId, "Expense account");
    if (productId) {
      item = (await client.query(
        `SELECT id, code, name, description, purchase_description, item_type, track_inventory, tracking_type, uom_id, purchase_uom_id, hsn_sac_code, tax_category_id, status,
                is_purchasable FROM tenant.items WHERE organization_id = $1 AND id = $2`, [organizationId, productId])).rows[0];
      if (!item) fail(`${label}: the product was not found.`, "productId", "PURCHASE_ORDER_PRODUCT_INVALID", 409);
      if (item.status !== "active" && !input.carried) fail(`${label}: ${item.name} is inactive.`, "productId", "PURCHASE_ORDER_PRODUCT_INACTIVE", 409);
      if (item.is_purchasable === false && !input.carried) fail(`${label}: ${item.name} is not set up to be purchased.`, "productId", "PURCHASE_ORDER_PRODUCT_NOT_PURCHASABLE", 409);
      productType = keepsStock || item.item_type === "service" ? productTypeOf(item) : "non_stock";
      uomId = uomId ?? item.purchase_uom_id ?? item.uom_id;
      taxCategoryId = input.carriedTaxCategoryId !== undefined ? input.carriedTaxCategoryId : item.tax_category_id;
      description = description ?? item.purchase_description ?? item.name;
    } else {
      // A one-off line outside the catalogue: never stock, and fully classified.
      if (!poCan(context, PO_PERMISSIONS.descriptiveLines) && !input.carried)
        throw new PurchaseOrderError(403, `${label}: you may only order products from the catalogue.`, "PERMISSION_DENIED");
      productType = input.productType === "service" ? "service" : input.productType === "non_stock" ? "non_stock" : fail(`${label}: choose whether it is a service or a non-stock item.`, "productType");
      if (!description) fail(`${label}: describe what is being bought.`, "description");
      if (!uomId) fail(`${label}: choose the unit of measure.`, "uomId");
      taxCategoryId = optionalUuid(input.taxCategoryId, "Tax category");
      if (!taxCategoryId && input.noTax !== true) fail(`${label}: choose the tax category, or mark the line as not taxed.`, "taxCategoryId");
      if (!expenseAccountId) fail(`${label}: choose the expense account it is booked to.`, "expenseAccountId");
      const account = (await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, expenseAccountId])).rows[0];
      if (!account) fail(`${label}: the expense account was not found.`, "expenseAccountId", "PURCHASE_ORDER_ACCOUNT_INVALID", 409);
    }
    if (!uomId) fail(`${label}: the product has no unit of measure.`, "uomId");
    const uom = await uomOf(client, organizationId, uomId);
    if (!uom) fail(`${label}: the unit of measure was not found.`, "uomId", "PURCHASE_ORDER_UOM_INVALID", 409);
    const quantity = readQuantity(input.quantity ?? input.orderedQuantity, label);
    // The item's unit (purchase-enabled; a carried line keeps the unit it was agreed in) and its conversion to the base, from the shared
    // conversion service: base quantity = quantity × factor, checked against both units' precision.
    let factor = decimal(1);
    if (item) {
      const unit = await normalizeQuantityToBase(client, organizationId, item.id, uom.id, quantity, { purpose: "purchase", allowInactive: Boolean(input.carried) });
      if (!unit.ok) fail(`${label}: ${unit.message}`, unit.reason === "no_conversion" || unit.reason === "not_enabled" || unit.reason === "unit_inactive" ? "uomId" : "quantity",
        UOM_CODES[unit.reason] ?? "PURCHASE_ORDER_UOM_INVALID", unit.reason === "no_conversion" ? 409 : 400);
      factor = unit.factor;
    } else {
      const decimals = Number(uom.decimal_places ?? 6);
      if (roundMoney(quantity, decimals) !== quantity) fail(`${label}: ${uom.code} allows ${decimals} decimal place${decimals === 1 ? "" : "s"}.`, "quantity", "PURCHASE_ORDER_QUANTITY_INVALID");
    }

    const contract = item ? contracts.get(`${item.id}:${uom.id}`) ?? null : contracts.get(oneOffContractKey(description, uom.id)) ?? null;
    let rawPrice = input.unitPrice === undefined || input.unitPrice === null ? "" : String(input.unitPrice).trim();
    if (rawPrice === "" && contract) rawPrice = contract.rate;
    // Without a contract, the supplier's price list (Supplier Rates) for this unit, currency and quantity.
    if (rawPrice === "" && !contract && item) {
      const listed = await supplierRateFor(client, organizationId, { supplierId: document.supplierId, itemId: item.id, uomId: uom.id, quantity, date: priceDate, currencyCode: document.currencyCode ?? null });
      if (listed) rawPrice = listed.rate;
    }
    if (contract && rawPrice !== "" && MONEY.test(rawPrice) && decimal(rawPrice) !== decimal(contract.rate))
      warnings.push({ line: index + 1, code: "CONTRACT_RATE_DIFFERS", message: `${label}: rate contract ${contract.contractNumber} agrees ${contract.rate}.` });
    let unitPrice = null;
    if (rawPrice === "") {
      if (!allowMissingPrice) fail(`${label}: enter the agreed purchase price.`, "unitPrice", "PURCHASE_ORDER_PRICE_MISSING");
      warnings.push({ line: index + 1, code: "PRICE_MISSING", message: `${label} has no price yet.` });
    } else {
      if (!MONEY.test(rawPrice)) fail(`${label}: the price must be zero or more.`, "unitPrice", "PURCHASE_ORDER_PRICE_INVALID");
      unitPrice = decimal(rawPrice);
    }
    const zeroPriceReason = text(input.zeroPriceReason, 500);
    if (unitPrice === 0n) {
      if (!zeroPriceReason) fail(`${label}: a free line needs a reason (sample, replacement, promotion).`, "zeroPriceReason", "PURCHASE_ORDER_ZERO_PRICE");
      if (!input.carried && !poCan(context, PO_PERMISSIONS.overridePrice))
        throw new PurchaseOrderError(403, `${label}: you may not order at no charge.`, "PERMISSION_DENIED");
    }
    const discount = readDiscount(input.discountType, input.discountValue, label);
    const gross = unitPrice === null ? decimal(0) : roundMoney(mul(quantity, unitPrice), places);
    const lineDiscount = discount.type === "percent" ? roundMoney(percent(gross, discount.value), places) : roundMoney(discount.value, places);
    if (lineDiscount > gross) fail(`${label}: the discount is more than the line value.`, "discountValue", "PURCHASE_ORDER_DISCOUNT_INVALID");
    priced.push({
      input, item, productType, productId, uom, factor, quantity, unitPrice, zeroPriceReason, discount, gross, lineDiscount, net: sub(gross, lineDiscount), description,
      taxCategoryId: taxCategoryId ?? null, expenseAccountId, label,
      warehouseId: productType === "service" || !keepsStock ? null : optionalUuid(input.warehouseId ?? input.receivingWarehouseId ?? document.defaultWarehouseId, "Warehouse"),
      expectedDeliveryDate: readDate(input.expectedDeliveryDate, `${label} expected date`),
      costCenterId: await costCenterOf(client, organizationId, input.costCenterId, label), costCenterGiven: input.costCenterId !== undefined,
      sourceQuotationLineId: optionalUuid(input.sourceQuotationLineId, "Quotation line"),
      // The indent line this order line buys for (Procurement plan Phase 2); checked against the indent below.
      sourceIndentLineId: optionalUuid(input.sourceIndentLineId, "Indent line"),
      // The rate contract line it draws from, when bought at the contract rate.
      contract: contract && rawPrice !== "" && decimal(rawPrice) === decimal(contract.rate) ? contract : null,
      priceSource: input.priceSource === "quotation" ? "quotation" : input.priceSource === "product_cost" ? "product_cost" : "manual",
    });
  }

  // A contract with a quantity or value cap: drawing more than is left is warned about (the rest is bought at the price entered).
  for (const [index, line] of priced.entries()) if (line.contract)
    for (const issue of contractOverdraw(line.contract, line.quantity, line.net))
      warnings.push({ line: index + 1, code: "CONTRACT_OVERDRAWN", message: `${line.label}: ${issue}.` });
  // Purchase warnings on the supplier and items; a blocked item cannot go on a new line.
  warnings.push(...(await purchaseWarningsFor(client, organizationId, { supplierId: document.supplierId,
    lines: priced.map((line) => ({ itemId: line.item?.id ?? null, label: line.label, carried: Boolean(line.input?.carried || line.sourceQuotationLineId) })) })));

  // An order line bought for an indent line names an approved indent's open line for the same item.
  const indentLineIds = priced.map((line) => line.sourceIndentLineId).filter(Boolean);
  if (indentLineIds.length) {
    const found = new Map((await client.query(
      `SELECT line.id, line.item_id FROM tenant.purchase_indent_lines line JOIN tenant.purchase_indents indent ON indent.organization_id = line.organization_id AND indent.id = line.indent_id
        WHERE line.organization_id = $1 AND line.id = ANY($2::uuid[]) AND indent.status IN ('approved', 'closed') AND line.status = 'open'`, [context.organizationId, indentLineIds])).rows.map((row) => [row.id, row]));
    for (const line of priced) if (line.sourceIndentLineId && found.get(line.sourceIndentLineId)?.item_id !== line.productId)
      fail(`${line.label}: the indent line is not an approved, open line for this product.`, "sourceIndentLineId", "PURCHASE_ORDER_INDENT_LINE_INVALID", 409);
  }

  // The document discount, shared over the lines in proportion to their value.
  const docDiscount = readDiscount(document.documentDiscountType, document.documentDiscountValue, "Order discount");
  const netTotal = priced.reduce((total, line) => add(total, line.net), decimal(0));
  const documentDiscountAmount = docDiscount.type === "percent" ? roundMoney(percent(netTotal, docDiscount.value), places) : roundMoney(docDiscount.value, places);
  if (documentDiscountAmount > netTotal) fail("The order discount is more than the order value.", "documentDiscountValue", "PURCHASE_ORDER_DISCOUNT_INVALID");
  const eligible = priced.filter((line) => line.net > 0n);
  let allocated = decimal(0);
  eligible.forEach((line, index) => {
    const share = index === eligible.length - 1 ? sub(documentDiscountAmount, allocated) : roundMoney(div(mul(documentDiscountAmount, line.net), netTotal), places);
    line.allocated = share;
    allocated = add(allocated, share);
  });

  let gross = decimal(0); let lineDiscountTotal = decimal(0); let taxableTotal = decimal(0); let taxTotal = decimal(0); let grandTotal = decimal(0);
  const result = [];
  for (const [index, line] of priced.entries()) {
    const base = sub(line.net, line.allocated ?? 0n);
    if (base < 0n) fail(`${line.label}: discounts take the value below zero.`, "discountValue", "PURCHASE_ORDER_DISCOUNT_INVALID");
    let resolved;
    try {
      resolved = await resolveLineTax(client, tax, {
        taxCategoryId: line.taxCategoryId, date: document.orderDate, sellerStateCode: document.supplierStateCode, placeOfSupply: document.buyerStateCode, supplyType,
        allowInactive: Boolean(line.input.carried),
      });
    } catch (error) {
      if (error instanceof TaxError) throw new PurchaseOrderError(error.status, `${line.label}: ${error.message}`, error.code);
      throw error;
    }
    const computed = computeTax({ base, inclusive, components: resolved.components, decimalPlaces: places });
    const lineTotal = inclusive ? base : add(computed.taxableAmount, computed.taxAmount);
    gross = add(gross, line.gross); lineDiscountTotal = add(lineDiscountTotal, line.lineDiscount); taxableTotal = add(taxableTotal, computed.taxableAmount);
    taxTotal = add(taxTotal, computed.taxAmount); grandTotal = add(grandTotal, lineTotal);
    result.push({
      lineNumber: index + 1, lineId: line.input.lineId ?? null, productId: line.productId, productType: line.productType, item: line.item, description: line.description,
      hsnSacCode: line.item?.hsn_sac_code ?? text(line.input.hsnSacCode, 30), quantity: line.quantity, uom: line.uom, conversionFactor: line.factor,
      baseUomId: line.item?.uom_id ?? line.uom.id, baseQuantity: roundMoney(mul(line.quantity, line.factor), 6), unitPrice: line.unitPrice, priceSource: line.priceSource,
      zeroPriceReason: line.unitPrice === 0n ? line.zeroPriceReason : null, discountType: line.discount.type, discountValue: line.discount.value, gross: line.gross,
      lineDiscount: line.lineDiscount, allocatedDocumentDiscount: line.allocated ?? decimal(0), taxableAmount: computed.taxableAmount, taxCategoryId: line.taxCategoryId,
      taxTreatment: resolved.treatment, taxRate: resolved.rate, taxTotal: computed.taxAmount, lineTotal, components: computed.components,
      warehouseId: line.warehouseId, expectedDeliveryDate: line.expectedDeliveryDate, costCenterId: line.costCenterId ?? null, costCenterGiven: Boolean(line.costCenterGiven), sourceQuotationLineId: line.sourceQuotationLineId, sourceIndentLineId: line.sourceIndentLineId ?? null, sourceRateContractLineId: line.contract?.lineId ?? null,
      expenseAccountId: line.expenseAccountId,
      productSnapshot: line.item
        ? { id: line.item.id, code: line.item.code, name: line.item.name, type: line.productType, itemType: line.item.item_type, trackingType: line.item.tracking_type, hsnSacCode: line.item.hsn_sac_code }
        : { id: null, code: null, name: line.description, type: line.productType, descriptive: true },
      uomSnapshot: { id: line.uom.id, code: line.uom.code, name: line.uom.name, conversionFactor: dec(line.factor), baseUomId: line.item?.uom_id ?? line.uom.id },
    });
  }
  return {
    lines: result,
    warnings,
    places,
    supplyType,
    taxContext: tax,
    totals: { grossTotal: gross, lineDiscountTotal, documentDiscountType: docDiscount.type, documentDiscountValue: docDiscount.value, documentDiscountAmount, taxableTotal, taxTotal, grandTotal },
  };
}

// Plain JSON for the screen.
export function pricedView(priced) {
  return {
    warnings: priced.warnings,
    supplyType: priced.supplyType,
    totals: Object.fromEntries(Object.entries(priced.totals).map(([key, value]) => [key, typeof value === "bigint" ? dec(value) : value])),
    lines: priced.lines.map((line) => ({
      lineNumber: line.lineNumber, productId: line.productId, productType: line.productType, description: line.description, quantity: dec(line.quantity), uomCode: line.uom.code,
      baseQuantity: dec(line.baseQuantity), unitPrice: line.unitPrice === null ? null : dec(line.unitPrice), gross: dec(line.gross), lineDiscount: dec(line.lineDiscount),
      allocatedDocumentDiscount: dec(line.allocatedDocumentDiscount), taxableAmount: dec(line.taxableAmount), taxTreatment: line.taxTreatment, taxRate: dec(line.taxRate),
      taxTotal: dec(line.taxTotal), lineTotal: dec(line.lineTotal),
      components: line.components.map((component) => ({ type: component.type, label: component.label, rate: dec(component.rate), taxAmount: dec(component.taxAmount) })),
    })),
  };
}
