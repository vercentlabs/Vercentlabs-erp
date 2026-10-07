// Builds the purchase order a save would store: the supplier (checked
// usable), what it proposes (currency, payment terms, buyer, contact,
// ordering, billing and ship-from locations, GST registration), the buying
// company registration, bill-to and ship-to, and the priced lines.
//
// Choices made on the order win; otherwise the order keeps what it already
// had for the same supplier; otherwise the supplier's defaults apply. Every
// chosen location and person must be an active one of that supplier.
import { PaymentTermError, purchaseTermSnapshot } from "../../../core/payment-terms/index.js";
import { TaxError, loadTaxContext } from "../../../core/tax/index.js";
import { SupplierError } from "../suppliers/constants.js";
import { registrationSnapshotFor, resolveSupplierTransactionDefaults, supplierDefaultsFor, supplierSelection } from "../suppliers/defaults.js";
import { formatDecimal } from "../../../core/decimal.js";
import { poCan } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, dayOf, fail, has, optionalUuid, readDate, requireUuid, text } from "./constants.js";
import { calculatePurchaseOrderTotals } from "./pricing.js";

// Errors from the masters keep their status and code.
export async function translated(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SupplierError || error instanceof PaymentTermError || error instanceof TaxError)
      throw new PurchaseOrderError(error.status, error.message, error.code, error.details);
    throw error;
  }
}

export async function databaseToday(client) {
  return (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
}

export async function procurementSettings(client, organizationId) {
  const row = (await client.query(`SELECT billing_basis, require_expected_date, default_warehouse_id, bill_held_goods, post_receipt_accrual FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  return { billingBasis: row?.billing_basis ?? "receipt", requireExpectedDate: Boolean(row?.require_expected_date), defaultWarehouseId: row?.default_warehouse_id ?? null,
    billHeldGoods: Boolean(row?.bill_held_goods), postReceiptAccrual: Boolean(row?.post_receipt_accrual) };
}

const ADDRESS_FIELDS = ["name", "line1", "line2", "city", "stateCode", "stateName", "postalCode", "countryCode", "contactName", "phone"];
function readAddress(value, label) {
  if (!value || typeof value !== "object") return null;
  const address = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, text(value[field], 300)]));
  if (address.stateCode && !/^[0-9A-Z]{1,3}$/.test(address.stateCode)) fail(`${label}: choose the state.`, "stateCode");
  if (address.countryCode) address.countryCode = address.countryCode.toUpperCase().slice(0, 2);
  return Object.values(address).some(Boolean) ? address : null;
}

// The company address an order is billed to: the buying registration's, else the organization.
function billToOf(registration, organization) {
  if (registration) {
    return {
      name: registration.legalName ?? registration.name, line1: registration.address ?? null, city: null, stateCode: registration.stateCode, stateName: registration.stateName,
      countryCode: registration.countryCode, gstin: registration.gstin,
    };
  }
  return { name: organization.legal_name || organization.name, line1: null, countryCode: String(organization.country_code ?? "").trim() || null, gstin: organization.tax_id ?? null };
}

async function supplierTaxRegistration(client, organizationId, supplierId, registrationId) {
  const row = (await client.query(
    `SELECT id, gstin, registration_type, state_code, status FROM tenant.procurement_supplier_tax_registrations WHERE organization_id = $1 AND supplier_id = $2 AND id = $3`,
    [organizationId, supplierId, requireUuid(registrationId, "Supplier GST registration")])).rows[0];
  if (!row || row.status !== "active") fail("The supplier GST registration must be an active one of this supplier.", "supplierTaxRegistrationId", "PURCHASE_ORDER_SELECTION_INVALID", 409);
  return { registrationId: row.id, gstin: row.gstin, registrationType: row.registration_type, stateCode: row.state_code };
}

async function activeWarehouse(client, organizationId, warehouseId, label) {
  if (!warehouseId) return null;
  const row = (await client.query(`SELECT id, code, name, status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [organizationId, warehouseId])).rows[0];
  if (!row) fail(`${label} was not found.`, "warehouseId", "PURCHASE_ORDER_WAREHOUSE_INVALID", 409);
  if (row.status !== "active") fail(`${label} ${row.name} is inactive.`, "warehouseId", "PURCHASE_ORDER_WAREHOUSE_INACTIVE", 409);
  return row;
}

// The stored lines of an order, as the inputs a save takes.
export async function linesAsInput(client, organizationId, orderId) {
  const { rows } = await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`, [organizationId, orderId]);
  return rows.map((row) => ({
    lineId: row.id, productId: row.product_id, productType: row.product_type, description: row.description, quantity: formatDecimal(row.ordered_quantity),
    uomId: row.purchase_uom_id, unitPrice: formatDecimal(row.unit_price), zeroPriceReason: row.zero_price_reason, discountType: row.discount_type,
    discountValue: formatDecimal(row.discount_value), warehouseId: row.receiving_warehouse_id, expectedDeliveryDate: dayOf(row.expected_delivery_date),
    taxCategoryId: row.product_id ? undefined : row.tax_category_id, noTax: !row.product_id && !row.tax_category_id, expenseAccountId: row.expense_account_id,
    sourceQuotationLineId: row.source_quotation_line_id, priceSource: row.price_source, hsnSacCode: row.hsn_sac_code,
  }));
}

// input: the order fields (see createPurchaseOrder). order: the stored draft when saving one.
// Returns { header, priced }.
export async function resolveOrderDocument(client, context, input, { order = null, today, allowMissingPrice = false } = {}) {
  const organizationId = context.organizationId;
  const supplierId = requireUuid(input.supplierId ?? order?.supplier_id, "Supplier");
  if (order?.source_quotation_id && supplierId !== order.supplier_id)
    fail("An order made from a supplier quotation keeps that supplier. Create a new order for another supplier.", "supplierId", "PURCHASE_ORDER_SUPPLIER_LOCKED", 409);
  const sameSupplier = order && order.supplier_id === supplierId;
  const defaults = await translated(() => supplierDefaultsFor(client, organizationId, supplierId, { purpose: "a new purchase order" }));
  const supplierRow = (await client.query(`SELECT party_id, assigned_buyer_id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [organizationId, supplierId])).rows[0];

  // Supplier contact and locations: chosen, kept, or the supplier's defaults.
  const choose = async (key, kind, column, fallback, label) => {
    if (has(input, key)) return translated(() => supplierSelection(client, organizationId, supplierId, kind, input[key] || null, label));
    if (sameSupplier && order[column]) return translated(() => supplierSelection(client, organizationId, supplierId, kind, order[column], label));
    return sameSupplier ? null : fallback;
  };
  const billDefaults = await translated(() => resolveSupplierTransactionDefaults(client, organizationId, supplierId, "bill"));
  const contact = await choose("supplierContactId", "contact", "supplier_contact_id", defaults.contact, "The supplier contact");
  const orderingAddress = await choose("supplierAddressId", "address", "supplier_address_id", defaults.address, "The supplier ordering address");
  const billingAddress = await choose("supplierBillingAddressId", "address", "supplier_billing_address_id", billDefaults.address, "The supplier billing address");
  const shipFrom = await choose("supplierShipFromId", "address", "supplier_ship_from_id", defaults.shipFrom, "The supplier ship-from location");
  let supplierTax;
  if (has(input, "supplierTaxRegistrationId") && input.supplierTaxRegistrationId)
    supplierTax = await supplierTaxRegistration(client, organizationId, supplierId, input.supplierTaxRegistrationId);
  else if (!has(input, "supplierTaxRegistrationId") && sameSupplier && order.supplier_tax_registration_id && !has(input, "supplierShipFromId") && !has(input, "supplierAddressId"))
    supplierTax = await supplierTaxRegistration(client, organizationId, supplierId, order.supplier_tax_registration_id);
  else supplierTax = await translated(() => registrationSnapshotFor(client, organizationId, supplierId, shipFrom?.addressId, orderingAddress?.addressId));
  const supplierSnapshot = { ...defaults.supplier, gstin: supplierTax?.gstin ?? defaults.supplier.gstin, gstRegistrationType: supplierTax?.registrationType ?? defaults.supplier.gstRegistrationType };

  // Currency and payment terms: the supplier's unless chosen.
  const currencyCode = (text(input.currencyCode, 3) ?? (sameSupplier ? order.currency_code?.trim() : null) ?? defaults.currencyCode ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) fail("Choose the currency.", "currencyCode");
  const currency = (await client.query(`SELECT code FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, [organizationId, currencyCode])).rows[0];
  if (!currency) fail(`${currencyCode} is not an active currency.`, "currencyCode", "PURCHASE_ORDER_CURRENCY_INVALID", 409);
  const paymentTermId = optionalUuid(input.paymentTermId, "Payment terms") ?? (sameSupplier ? order.payment_term_id : null) ?? defaults.paymentTerm?.id ?? null;
  if (!paymentTermId) fail("Choose the payment terms.", "paymentTermId", "PURCHASE_ORDER_PAYMENT_TERMS_REQUIRED");
  // Terms other than the supplier's (or the company default) or the ones the order already has are a purchasing decision.
  if (paymentTermId !== (defaults.paymentTerm?.id ?? null) && paymentTermId !== (sameSupplier ? order.payment_term_id : null) && !poCan(context, PO_PERMISSIONS.changePaymentTerms))
    throw new PurchaseOrderError(403, "You do not have permission to agree payment terms other than the supplier's.", "PURCHASE_ORDER_PAYMENT_TERMS_PERMISSION", { field: "paymentTermId" });
  const termRegistrationId = has(input, "buyingRegistrationId") ? optionalUuid(input.buyingRegistrationId, "Company registration") : order?.buying_registration_id ?? null;
  const paymentTerm = await translated(() => purchaseTermSnapshot(client, organizationId, paymentTermId, null, { buyingRegistrationId: termRegistrationId }));
  // The advance the order expects: the term's, unless the order says otherwise.
  const termChanged = !order || order.payment_term_id !== paymentTermId;
  const advanceRaw = has(input, "advancePercentage") ? input.advancePercentage : termChanged ? paymentTerm.advancePercentage : order.advance_percentage;
  const advancePercentage = advanceRaw === null || advanceRaw === undefined || advanceRaw === "" ? null : Number(advanceRaw);
  if (advancePercentage !== null && !(advancePercentage > 0 && advancePercentage < 100)) fail("The advance must be a percentage above 0 and below 100.", "advancePercentage", "PURCHASE_ORDER_ADVANCE_INVALID");

  // The buyer responsible: chosen, kept, the supplier's buyer, else whoever creates it.
  const buyerUserId = optionalUuid(input.buyerUserId, "Buyer") ?? order?.buyer_user_id ?? supplierRow.assigned_buyer_id ?? context.userId ?? null;
  if (buyerUserId) {
    const member = (await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [organizationId, buyerUserId])).rows[0];
    if (!member) fail("The buyer must be an active member of the workspace.", "buyerUserId", "PURCHASE_ORDER_BUYER_INVALID", 409);
  }

  // The buying company: its registration, bill-to and ship-to.
  const buyingRegistrationId = has(input, "buyingRegistrationId") ? optionalUuid(input.buyingRegistrationId, "Company registration") : order?.buying_registration_id ?? null;
  const tax = await translated(() => loadTaxContext(client, { organizationId, sellerRegistrationId: buyingRegistrationId }));
  const organization = (await client.query(`SELECT name, legal_name, tax_id, country_code FROM public.organizations WHERE id = $1`, [organizationId])).rows[0];
  const buyerRegistration = tax.registration;
  const billTo = billToOf(buyerRegistration, organization);
  const shipTo = has(input, "shipTo") ? readAddress(input.shipTo, "Ship to") : order?.ship_to_snapshot ?? null;

  const settings = await procurementSettings(client, organizationId);
  const defaultWarehouseId = has(input, "defaultWarehouseId") ? optionalUuid(input.defaultWarehouseId, "Warehouse") : order?.default_warehouse_id ?? settings.defaultWarehouseId;
  const defaultWarehouse = await activeWarehouse(client, organizationId, defaultWarehouseId, "The receiving warehouse");

  const orderDate = readDate(input.orderDate, "Order date") ?? (order ? dayOf(order.order_date) : null) ?? today;
  const expectedDeliveryDate = has(input, "expectedDeliveryDate") ? readDate(input.expectedDeliveryDate, "Expected delivery date")
    : dayOf(order?.expected_delivery_date);
  if (expectedDeliveryDate && expectedDeliveryDate < orderDate) fail("The expected delivery date cannot be before the order date.", "expectedDeliveryDate", "PURCHASE_ORDER_DATE_INVALID");
  const priceMode = (has(input, "priceMode") ? input.priceMode : order?.price_mode) === "inclusive" ? "inclusive" : "exclusive";
  const keep = (key, column, max = 4000) => (has(input, key) ? text(input[key], max) : order?.[column] ?? null);
  const header = {
    supplierId, partyId: supplierRow.party_id, supplierSnapshot, contact, orderingAddress, billingAddress, shipFrom, supplierTax, currencyCode, paymentTermId,
    paymentTerm, buyerUserId, buyingRegistrationId: buyerRegistration?.id ?? null, buyerRegistration, billTo, shipTo, defaultWarehouseId: defaultWarehouse?.id ?? null,
    orderDate, expectedDeliveryDate, priceMode,
    documentDiscountType: has(input, "documentDiscountType") ? input.documentDiscountType || null : order?.document_discount_type ?? null,
    documentDiscountValue: has(input, "documentDiscountValue") ? input.documentDiscountValue ?? "0" : order ? formatDecimal(order.document_discount_value) : "0",
    supplierReference: keep("supplierReference", "supplier_reference", 200),
    supplierQuotationReference: keep("supplierQuotationReference", "supplier_quotation_reference", 200),
    supplierNotes: keep("supplierNotes", "supplier_notes"), internalNotes: keep("internalNotes", "internal_notes"),
    advancePercentage: advancePercentage === null ? null : String(advancePercentage), paymentTermsNote: keep("paymentTermsNote", "payment_terms_note", 1000),
    paymentTermChangeReason: keep("paymentTermChangeReason", "payment_term_change_reason", 1000),
    settings,
  };
  const lines = Array.isArray(input.lines) ? input.lines : order ? await linesAsInput(client, organizationId, order.id) : [];
  for (const [index, line] of lines.entries()) {
    if (line.warehouseId || line.receivingWarehouseId) await activeWarehouse(client, organizationId, line.warehouseId ?? line.receivingWarehouseId, `Line ${index + 1}: the warehouse`);
  }
  const priced = await calculatePurchaseOrderTotals(client, context, {
    supplier: supplierSnapshot, supplierStateCode: supplierTax?.stateCode ?? shipFrom?.stateCode ?? orderingAddress?.stateCode ?? defaults.supplier.registeredStateCode,
    buyerStateCode: shipTo?.stateCode ?? buyerRegistration?.stateCode ?? null, buyingRegistrationId: header.buyingRegistrationId, orderDate,
    currencyCode, priceMode, documentDiscountType: header.documentDiscountType, documentDiscountValue: header.documentDiscountValue,
    defaultWarehouseId: header.defaultWarehouseId, lines,
  }, { allowMissingPrice });
  return { header, priced };
}

// What must hold before an order is committed (confirmPurchaseOrder), beyond what every save checks.
export function validateForConfirmation(header, priced) {
  const issues = [];
  if (!priced.lines.length) issues.push({ field: "lines", message: "Add at least one line." });
  for (const line of priced.lines) {
    if (line.unitPrice === null) issues.push({ field: `lines.${line.lineNumber}.unitPrice`, message: `Line ${line.lineNumber}: enter the agreed price.` });
    if (line.productType === "stock" && !line.warehouseId) issues.push({ field: `lines.${line.lineNumber}.warehouseId`, message: `Line ${line.lineNumber}: choose the receiving warehouse.` });
  }
  const physical = priced.lines.some((line) => line.productType !== "service");
  if (physical && !(header.shipTo?.line1 || header.defaultWarehouseId || header.billTo?.line1))
    issues.push({ field: "shipTo", message: "Enter where the goods are to be delivered." });
  if (header.settings.requireExpectedDate && !header.expectedDeliveryDate) issues.push({ field: "expectedDeliveryDate", message: "Enter the expected delivery date." });
  if (priced.taxContext.enabled && priced.lines.some((line) => line.components.length) && !header.buyerRegistration)
    issues.push({ field: "buyingRegistrationId", message: "Choose the company registration the order is placed from." });
  if (issues.length) throw new PurchaseOrderError(422, issues[0].message, "PURCHASE_ORDER_INCOMPLETE", { issues });
}
