import { finalizeApprovalRequest } from "../../core/platform/approvals/index.js";
import { normalizeQuantityToBase, resolveItemUnit } from "../products/uom.js";
import {
  decimal,
  add,
  sub,
  mul,
  div,
  percent,
  max,
  roundMoney,
  asDatabaseDecimal,
  formatDecimal,
} from "./money.js";
import {
  GST_STATES, SUPPLY_TYPES, TAX_PERMISSIONS, TaxError, computeTax, derivePlaceOfSupply, gstStateName, loadTaxContext, resolveLineTax, summarizeTax, supplyTypeForCustomer, treatmentOfSupply,
} from "../../core/tax/index.js";
import { PaymentTermError, listSalesTermOptions, readTermSnapshot, salesTermSnapshot } from "../../core/payment-terms/index.js";
import { PriceListError } from "./price-lists/constants.js";
import { salesOrderTrackingReport } from "./order-tracking/summary.js";
import { resolveSalesPrice, resolveSalesPriceList } from "./price-lists/resolver.js";
import { allocateDocumentDiscount, checkDiscountRules, discountOptions, readDocumentDiscount } from "./discounts.js";

export class SalesError extends Error {
  constructor(status, message, code = "SALES_ERROR") {
    super(message);
    this.name = "SalesError";
    this.status = status;
    this.code = code;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value, label) {
  if (!uuidPattern.test(String(value || "")))
    throw new SalesError(400, `${label} is invalid.`);
  return String(value);
}
function text(value, maximum = 4000) {
  const result = value == null ? null : String(value).trim();
  return result ? result.slice(0, maximum) : null;
}
function bool(value) {
  return value === true;
}
function date(value, label, required = false) {
  const result = text(value, 10);
  if (!result && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result || ""))
    throw new SalesError(400, `${label} must be a date.`);
  return result;
}
function hasPermission(context, permission) {
  return (
    context.permissions?.includes(permission) ||
    context.roleSlugs?.includes("organization_owner")
  );
}
// The Sales module's canonical document visibility rule (quotations and
// sales orders): sales.view across the organisation. Exported so other
// modules (e.g. CRM Account 360) apply exactly this rule instead of
// re-deriving Sales authorization.
export function salesDocumentVisibilitySql(context, _bind, _alias) {
  if (!hasPermission(context, "sales.view")) return " AND false";
  return "";
}
function requirePermission(context, permission) {
  if (!hasPermission(context, permission))
    throw new SalesError(
      403,
      "You do not have permission to perform this action.",
    );
}

// F041-SEM-04: the person who submitted a document for approval cannot approve
// it themselves. The role split alone does not guarantee this (a manager can also
// author), so it is enforced against the approval request's own requester.
export async function assertNotSelfApproval(client, context, entityType, entityId) {
  const request = (
    await client.query(
      `SELECT requested_by FROM public.approval_requests
        WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3 AND status='pending'
        ORDER BY requested_at DESC LIMIT 1`,
      [context.organizationId, entityType, entityId],
    )
  ).rows[0];
  if (request && request.requested_by && request.requested_by === context.userId)
    throw new SalesError(
      403,
      "You submitted this for approval, so someone else must approve it.",
      "SALES_SELF_APPROVAL_BLOCKED",
    );
}

// The tax context of a document: the company registration that issues it,
// the kind of supply, and the place of supply. Each is worked out from the
// customer and the addresses; changing one needs its own permission and a
// reason. A document carried from a quotation keeps what was quoted.
async function documentTaxContext(client, context, input, { party, billing, shipping }, options) {
  const carried = Boolean(options.carryQuotedPrices);
  let tax;
  try {
    tax = await loadTaxContext(client, { organizationId: context.organizationId, sellerRegistrationId: input.sellerRegistrationId || null });
  } catch (error) {
    // The quoted registration may have been made inactive since; the order falls back to the default one.
    if (!(error instanceof TaxError) || !carried) throw error instanceof TaxError ? new SalesError(error.status, error.message, error.code) : error;
    tax = await loadTaxContext(client, { organizationId: context.organizationId });
  }
  const derivedSupplyType = supplyTypeForCustomer(party.tax_treatment);
  const supplyType = input.supplyType || derivedSupplyType;
  if (!SUPPLY_TYPES.some((entry) => entry.code === supplyType)) throw new SalesError(400, "Choose the supply type.", "SALES_SUPPLY_TYPE_INVALID");
  const supplyOverridden = supplyType !== derivedSupplyType;
  const taxOverrideReason = supplyOverridden ? text(input.taxOverrideReason, 500) : null;
  if (supplyOverridden && !carried) {
    if (!hasPermission(context, TAX_PERMISSIONS.overrideTransaction))
      throw new SalesError(403, "Only an authorised user can change the tax treatment of a document.", "SALES_TAX_OVERRIDE_FORBIDDEN");
    if (!taxOverrideReason) throw new SalesError(422, "Give the reason for changing the tax treatment.", "SALES_TAX_OVERRIDE_REASON_REQUIRED");
  }
  const derived = derivePlaceOfSupply({
    shippingStateCode: shipping.row?.state_code, billingStateCode: billing.row?.state_code, customerPlaceOfSupply: party.place_of_supply, customerStateCode: party.gst_state_code,
  });
  const requested = text(input.placeOfSupply, 10);
  let placeOfSupply = derived ? { ...derived, source: "derived", reason: null } : null;
  if (requested && requested !== derived?.code) {
    if (tax.countryCode === "IN" && !gstStateName(requested)) throw new SalesError(400, "Choose a valid place of supply.", "SALES_PLACE_OF_SUPPLY_INVALID");
    const reason = text(input.placeOfSupplyReason, 500);
    if (!carried) {
      if (!hasPermission(context, TAX_PERMISSIONS.overridePlaceOfSupply))
        throw new SalesError(403, "Only an authorised user can change the place of supply.", "SALES_PLACE_OF_SUPPLY_FORBIDDEN");
      if (!reason) throw new SalesError(422, "Give the reason for changing the place of supply.", "SALES_PLACE_OF_SUPPLY_REASON_REQUIRED");
    }
    placeOfSupply = { code: requested, name: gstStateName(requested), basis: "override", source: "override", reason, derivedCode: derived?.code ?? null };
  }
  const sellerState = String(tax.registration?.stateCode ?? "").trim();
  return {
    tax, supplyType, derivedSupplyType, taxOverrideReason, placeOfSupply,
    supplyNature: sellerState && placeOfSupply?.code ? (sellerState === placeOfSupply.code ? "intra_state" : "inter_state") : null,
  };
}

async function loadDocumentContext(client, context, input, options = {}) {
  const partyId = uuid(input.partyId, "Customer");
  const ownerUserId = uuid(input.ownerUserId || context.userId, "Owner");
  const currencyCode = String(input.currencyCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode))
    throw new SalesError(400, "Currency is required.");

  const organizationResult = await client.query(
    `SELECT id,name,base_currency,country_code FROM public.organizations WHERE id=$1`,
    [context.organizationId],
  );
  const organization = organizationResult.rows[0];
  if (!organization) throw new SalesError(404, "Organisation not found.");

  const partyResult = await client.query(
    `SELECT id,code,customer_number,party_type,display_name,legal_name,gstin,pan,currency_code,credit_limit,payment_term_id,status,
            default_price_list_id,tax_treatment,sales_block,sales_block_reason,place_of_supply,gst_state_code
       FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, partyId],
  );
  const party = partyResult.rows[0];
  if (!party || party.status !== "active")
    throw new SalesError(
      409,
      "The selected customer or prospect is not active.",
    );
  // A formal quotation or order is for a Customer Master, not a prospect.
  if (!["customer", "both"].includes(party.party_type))
    throw new SalesError(
      409,
      options.order
        ? "Sales orders require an active customer."
        : "A quotation is for a customer. Create the customer from the CRM account first.",
      "SALES_CUSTOMER_REQUIRED",
    );
  // F031: a sales block stops new documents (all = quotations and orders,
  // orders = orders only), like SAP's order block or D365 "on hold".
  if (party.sales_block === "all" || (party.sales_block === "orders" && options.order))
    throw new SalesError(
      409,
      `${party.display_name} is blocked for ${party.sales_block === "all" ? "new quotations and orders" : "new orders"}: ${party.sales_block_reason}`,
      "SALES_CUSTOMER_BLOCKED",
    );

  const owner = await client.query(
    `SELECT users.id,users.full_name FROM public.organization_memberships membership
       JOIN public.users users ON users.id=membership.user_id AND users.status='active'
      WHERE membership.organization_id=$1 AND membership.user_id=$2 AND membership.status='active'`,
    [context.organizationId, ownerUserId],
  );
  if (!owner.rows[0])
    throw new SalesError(
      409,
      "The selected owner is not an active organisation member.",
    );

  let contact = null;
  if (input.contactId) {
    const result = await client.query(
      // A contact belongs to a customer through its relationship: the same
      // person can be a contact of several companies. The job title and role
      // are the ones held at this customer.
      `SELECT contact.id,contact.first_name,contact.last_name,COALESCE(link.job_title,contact.designation) AS designation,contact.email,contact.phone,contact.mobile,link.role,contact.privacy_status,contact.archived_at
         FROM tenant.contacts contact
         JOIN tenant.crm_contact_account_relationships link ON link.organization_id=contact.organization_id AND link.contact_id=contact.id AND link.party_id=$2 AND link.status='active'
        WHERE contact.organization_id=$1 AND contact.id=$3 AND contact.status='active'`,
      [context.organizationId, partyId, uuid(input.contactId, "Contact")],
    );
    contact = result.rows[0];
    if (!contact)
      throw new SalesError(
        409,
        "The selected contact does not belong to the customer.",
      );
    // F032: a contact whose data was anonymized, erased or restricted under a
    // privacy request, or who was archived, cannot be copied onto a document.
    if (contact.archived_at || (contact.privacy_status && contact.privacy_status !== "active"))
      throw new SalesError(
        409,
        "The selected contact is archived or restricted by a privacy request and cannot be used on documents.",
        "SALES_CONTACT_NOT_USABLE",
      );
    delete contact.privacy_status;
    delete contact.archived_at;
  }
  // F032: the bill-to must be an invoicing address and the ship-to a
  // delivery address (D365 address purposes, Odoo invoice/delivery contacts).
  // The address the Customer Master marks as the default for a purpose is
  // always usable for it, whatever its type.
  const ADDRESS_PURPOSES = {
    "Billing address": ["billing", "registered"],
    "Shipping address": ["shipping", "plant", "office", "registered"],
  };
  const ADDRESS_DEFAULTS = { "Billing address": "is_default_billing", "Shipping address": "is_default_shipping" };
  async function addressSnapshot(addressId, label) {
    if (!addressId) return { id: null, row: null };
    const result = await client.query(
      `SELECT id,address_type,label,line1,line2,city,district,state,state_code,postal_code,country_code,gstin,is_default_billing,is_default_shipping FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND id=$3 AND status='active'`,
      [context.organizationId, partyId, uuid(addressId, label)],
    );
    if (!result.rows[0])
      throw new SalesError(
        409,
        `The selected ${label.toLowerCase()} does not belong to the customer.`,
      );
    const allowed = ADDRESS_PURPOSES[label];
    const isDefault = Boolean(result.rows[0][ADDRESS_DEFAULTS[label]]);
    delete result.rows[0].is_default_billing;
    delete result.rows[0].is_default_shipping;
    if (allowed && !isDefault && !allowed.includes(result.rows[0].address_type))
      throw new SalesError(
        409,
        `A ${result.rows[0].address_type} address cannot be used as the ${label.toLowerCase()}. Use a ${allowed.join(", ")} address.`,
        "SALES_ADDRESS_PURPOSE_MISMATCH",
      );
    return { id: addressId, row: result.rows[0] };
  }
  const billing = await addressSnapshot(
    input.billingAddressId,
    "Billing address",
  );
  const shipping = await addressSnapshot(
    input.shippingAddressId,
    "Shipping address",
  );

  const currencyResult = await client.query(
    `SELECT code,decimal_places,status FROM tenant.currencies WHERE organization_id=$1 AND code=$2`,
    [context.organizationId, currencyCode],
  );
  const currency = currencyResult.rows[0];
  if (!currency || currency.status !== "active")
    throw new SalesError(409, "The selected currency is not active.");
  const baseCurrencyCode = String(organization.base_currency).trim();
  let exchangeRate = decimal(input.exchangeRate || 1);
  if (currencyCode === baseCurrencyCode) exchangeRate = decimal(1);
  else if (exchangeRate <= 0n || input.exchangeRate == null) {
    const rate = await client.query(
      `SELECT rate FROM tenant.exchange_rates WHERE organization_id=$1 AND from_currency_code=$2 AND to_currency_code=$3 AND rate_date<=current_date AND status='active' ORDER BY rate_date DESC LIMIT 1`,
      [context.organizationId, currencyCode, baseCurrencyCode],
    );
    if (!rate.rows[0])
      throw new SalesError(
        409,
        `An exchange rate from ${currencyCode} to ${baseCurrencyCode} is required.`,
      );
    exchangeRate = decimal(rate.rows[0].rate);
  }

  // The document date decides which prices apply: an order's date, else today.
  const documentDate = date(input.quotationDate, "Quotation date") ?? date(input.orderDate, "Order date") ?? new Date().toISOString().slice(0, 10);
  let priceList;
  try {
    priceList = await resolveSalesPriceList(client, context, { priceListId: input.priceListId || null, partyId, currencyCode, documentDate });
  } catch (error) {
    if (!(error instanceof PriceListError)) throw error;
    // A sales order made from a quotation carries the quoted prices, so the
    // quotation's list is kept even if it has since been closed.
    const kept = options.carryQuotedPrices && input.priceListId
      ? (await client.query(`SELECT id,code,name,currency_code,tax_inclusive,is_default FROM tenant.price_lists WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.priceListId])).rows[0]
      : null;
    if (!kept) throw new SalesError(error.status, error.message, error.code);
    priceList = { id: kept.id, code: kept.code, name: kept.name, currencyCode: String(kept.currency_code).trim(), taxInclusive: kept.tax_inclusive, isDefault: kept.is_default, basis: "quotation" };
  }
  const settingsResult = await client.query(
    `SELECT * FROM tenant.sales_settings WHERE organization_id=$1`,
    [context.organizationId],
  );
  const settings = settingsResult.rows[0] || {};
  // Payment terms. A document that already has terms keeps them exactly as they were agreed (its own snapshot): a later
  // change to the customer, the company default or the term itself, even its deactivation, never reaches it. Otherwise:
  // the terms asked for, else the customer's, else the company default from Sales settings; an active term, offered for Sales.
  let paymentTerm = null;
  const carriedTerm = readTermSnapshot(input.carriedPaymentTerm);
  const paymentTermDefaultId = party.payment_term_id || settings.default_payment_term_id || null;
  const paymentTermsNote = Object.prototype.hasOwnProperty.call(input, "paymentTermsNote") ? text(input.paymentTermsNote, 1000) || null : carriedTerm?.note ?? null;
  if (carriedTerm?.id && (!input.paymentTermId || input.paymentTermId === carriedTerm.id)) {
    paymentTerm = { ...input.carriedPaymentTerm, note: paymentTermsNote ?? undefined };
  } else {
    // Terms asked for must be usable; a customer default that has since been deactivated gives way to the company default.
    const candidates = input.paymentTermId ? [input.paymentTermId] : [party.payment_term_id, settings.default_payment_term_id].filter(Boolean);
    for (const candidate of candidates) {
      try {
        paymentTerm = await salesTermSnapshot(client, context.organizationId, uuid(candidate, "Payment term"), paymentTermsNote);
        break;
      } catch (error) {
        if (!(error instanceof PaymentTermError)) throw error;
        if (input.paymentTermId) throw new SalesError(error.status === 404 ? 409 : error.status, error.message, error.code);
      }
    }
  }
  const tax = await documentTaxContext(client, context, input, { party, billing, shipping }, options);
  return {
    ...tax,
    partyId,
    ownerUserId,
    currencyCode,
    baseCurrencyCode,
    exchangeRate,
    organization,
    party,
    contact,
    billing,
    shipping,
    currency,
    priceList,
    documentDate,
    paymentTerm,
    // What the terms would be with nothing chosen: the customer's, else the company default.
    paymentTermDefaultId,
    settings,
  };
}

async function calculateLine(client, context, master, line, sequence, input, options = {}) {
  // A carried line keeps the price, discount and tax agreed on the quotation:
  // the whole document when an order is made from a quotation, or one quoted
  // line when a draft order made from a quotation is edited (line.quoted).
  const carried = Boolean(options.carryQuotedPrices || line.quoted);
  const itemId = uuid(line.itemId, `Line ${sequence} item`);
  const itemResult = await client.query(
    `SELECT item.id,item.code,item.name,item.description,item.sales_description,item.hsn_sac_code,item.uom_id,item.sales_uom_id,item.is_sellable,item.track_inventory,item.standard_cost,item.tax_category_id,item.item_type,item.is_variant_template,uom.code AS uom_code,uom.name AS uom_name FROM tenant.items item JOIN tenant.units_of_measure uom ON uom.id=item.uom_id WHERE item.organization_id=$1 AND item.id=$2 AND item.status='active'`,
    [context.organizationId, itemId],
  );
  const item = itemResult.rows[0];
  if (!item)
    throw new SalesError(409, `Line ${sequence} item is inactive.`);
  // A line carried over from a quotation keeps its product even if it has
  // since stopped being sold; a new line must be a sellable product.
  if (!item.is_sellable && !carried)
    throw new SalesError(409, `Line ${sequence}: ${item.name} is not sold.`, "SALES_ITEM_NOT_SELLABLE");
  // A variant is an item of its own: the line names the variant's item.
  if (line.variantId) throw new SalesError(409, `Line ${sequence}: choose the variant item itself.`, "SALES_VARIANT_IS_ITEM");
  if (item.is_variant_template) throw new SalesError(409, `Line ${sequence}: ${item.name} is a variant template. Choose one of its variants.`, "SALES_ITEM_TEMPLATE");
  // Without a unit on the line, the product's sales unit (when it is enabled
  // for sales), else the base unit. The unit, its conversion and the base
  // quantity come from the shared conversion service: base = quantity ×
  // factor, checked against both units' precision (a line carried from a
  // quotation keeps the unit it was quoted in).
  let defaultUomId = item.uom_id;
  if (item.sales_uom_id && item.sales_uom_id !== item.uom_id && (await resolveItemUnit(client, context.organizationId, itemId, item.sales_uom_id, { purpose: "sales" })).ok)
    defaultUomId = item.sales_uom_id;
  const uomId = line.uomId
    ? uuid(line.uomId, `Line ${sequence} UOM`)
    : defaultUomId;
  let quantity;
  try { quantity = decimal(line.quantity); } catch { throw new SalesError(400, `Line ${sequence}: enter the quantity as a number.`, "SALES_QUANTITY_INVALID"); }
  if (quantity <= 0n)
    throw new SalesError(
      400,
      `Line ${sequence} quantity must be greater than zero.`,
    );
  const unit = await normalizeQuantityToBase(client, context.organizationId, itemId, uomId, line.quantity, { purpose: "sales", allowInactive: carried });
  if (!unit.ok)
    throw new SalesError(unit.reason === "no_conversion" ? 409 : 400, `Line ${sequence}: ${unit.message}`,
      ["precision", "base_precision", "serial_fraction", "conversion_loss", "quantity_invalid"].includes(unit.reason) ? "SALES_QUANTITY_INVALID" : "SALES_UOM_INVALID");
  const conversionFactor = unit.factor;
  const uomCode = unit.unit.code;
  const baseQuantity = unit.baseQuantity;
  // Prices come from price lists only: a base-unit row is scaled to the
  // line's unit (2 boxes of 12 price 24 units); a unit-specific row is not.
  // The list price for the line's unit, from the price resolver. A line
  // carried over from a quotation keeps the quotation's list price: the
  // accepted quotation is the commercial commitment, not today's list.
  let listUnitPrice;
  let priceSource;
  let priceMissing = false;
  let priceMessage = null;
  let priceEntryId = null;
  if (carried && line.listUnitPrice != null) {
    listUnitPrice = decimal(line.listUnitPrice);
    priceSource = "quotation";
  } else {
    const resolved = await resolveSalesPrice(client, context, { priceList: master.priceList, itemId, uomId, documentDate: master.documentDate });
    listUnitPrice = decimal(resolved.listPrice);
    priceSource = resolved.source;
    priceMissing = resolved.missing;
    priceMessage = resolved.message;
    priceEntryId = resolved.entryId;
  }
  const appliedRules = [];
  const rules = await client.query(
    `SELECT id,code,adjustment_type,adjustment_value FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND status='active' AND (party_id IS NULL OR party_id=$2) AND (party_type IS NULL OR party_type=$3 OR party_type='both') AND (item_id IS NULL OR item_id=$4) AND (item_group_id IS NULL OR item_group_id=(SELECT group_id FROM tenant.items WHERE id=$4)) AND (price_list_id IS NULL OR price_list_id=$5) AND minimum_quantity<=$6 AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY priority,id`,
    [
      context.organizationId,
      master.partyId,
      master.party.party_type,
      itemId,
      master.priceList?.id || null,
      asDatabaseDecimal(quantity),
    ],
  );
  let calculatedUnitPrice = listUnitPrice;
  for (const rule of rules.rows) {
    const value = decimal(rule.adjustment_value);
    if (rule.adjustment_type === "discount_percent")
      calculatedUnitPrice = sub(
        calculatedUnitPrice,
        percent(calculatedUnitPrice, value),
      );
    // Fixed prices and amount discounts are per BASE unit (a customer price of
    // 50 is per pouch), so they scale with the selected unit like list prices.
    if (rule.adjustment_type === "discount_amount")
      calculatedUnitPrice = max(0, sub(calculatedUnitPrice, mul(value, conversionFactor)));
    if (rule.adjustment_type === "fixed_rate") calculatedUnitPrice = mul(value, conversionFactor);
    appliedRules.push({
      id: rule.id,
      code: rule.code,
      type: rule.adjustment_type,
      value: formatDecimal(value),
    });
  }
  const manualPriceGiven = !(line.unitPrice == null || line.unitPrice === "");
  if (priceMissing && !manualPriceGiven && !options.allowMissingPrice)
    throw new SalesError(409, `Line ${sequence}: ${priceMessage} Enter a price, or choose another price list.`, "SALES_PRICE_MISSING");
  const requestedUnitPrice = manualPriceGiven ? decimal(line.unitPrice) : calculatedUnitPrice;
  if (requestedUnitPrice < 0n) throw new SalesError(400, `Line ${sequence}: the price cannot be negative.`, "SALES_PRICE_INVALID");
  // carryQuotedPrices: the price was settled (and, if overridden, authorised) on the quotation.
  const manualOverride = carried ? line.manualPriceOverride === true : requestedUnitPrice !== calculatedUnitPrice || (priceMissing && manualPriceGiven);
  if (manualOverride && !carried) {
    requirePermission(context, "sales.price.override");
    if (!text(line.manualPriceReason, 1000))
      throw new SalesError(
        400,
        `Line ${sequence} requires a manual price reason.`,
      );
  }
  // A line discount is a percentage (the default) or a fixed amount off the
  // line; either way the line keeps the amount and the equivalent percentage.
  const gross = mul(quantity, requestedUnitPrice);
  // The entered type and value are kept; the amount is always calculated here.
  const discountType = line.discountType === "amount" ? "amount" : "percent";
  const discountValue = decimal(line.discountValue || 0);
  if (discountValue < 0n)
    throw new SalesError(400, `Line ${sequence}: the discount cannot be negative.`, "SALES_DISCOUNT_INVALID");
  let discountAmount;
  let discountPercent;
  if (discountType === "amount") {
    discountAmount = roundMoney(discountValue, master.currency.decimal_places);
    if (discountAmount > gross)
      throw new SalesError(400, `Line ${sequence}: the discount is more than the line amount.`, "SALES_DISCOUNT_INVALID");
    discountPercent = gross > 0n ? div(mul(discountAmount, 100), gross) : decimal(0);
  } else {
    if (discountValue > decimal(100))
      throw new SalesError(400, `Line ${sequence} discount must be between 0 and 100.`, "SALES_DISCOUNT_INVALID");
    discountPercent = discountValue;
    discountAmount = roundMoney(percent(gross, discountPercent), master.currency.decimal_places);
  }
  if (discountAmount > 0n && !carried) {
    if (!hasPermission(context, "sales.discount.apply"))
      throw new SalesError(403, `Line ${sequence}: you do not have permission to give discounts.`, "SALES_DISCOUNT_FORBIDDEN");
    if (master.settings.allow_line_discounts === false)
      throw new SalesError(409, "Line discounts are switched off in Sales settings.", "SALES_DISCOUNT_NOT_ALLOWED");
    if (master.settings[discountType === "amount" ? "allow_amount_discounts" : "allow_percent_discounts"] === false)
      throw new SalesError(409, `${discountType === "amount" ? "Fixed amount" : "Percentage"} discounts are switched off in Sales settings.`, "SALES_DISCOUNT_NOT_ALLOWED");
  }
  let netAmount = roundMoney(
    sub(gross, discountAmount),
    master.currency.decimal_places,
  );

  // Which tax applies: the product's tax category at the rate in force on the
  // document date, split by the seller's state and the place of supply. A
  // line carried from a quotation keeps the tax it was quoted with.
  let resolvedTax;
  if (carried && line.carriedTax) {
    resolvedTax = {
      ...line.carriedTax,
      rate: decimal(line.carriedTax.rate || 0),
      components: line.carriedTax.components.map((component) => ({ type: component.type, label: component.label, rate: decimal(component.rate) })),
      needsPlaceOfSupply: false,
    };
  } else {
    try {
      resolvedTax = await resolveLineTax(client, master.tax, {
        taxCategoryId: item.tax_category_id ?? master.tax.defaultTaxCategoryId, date: master.documentDate, sellerStateCode: master.tax.registration?.stateCode,
        placeOfSupply: master.placeOfSupply?.code, supplyType: master.supplyType, allowInactive: Boolean(carried),
      });
    } catch (error) {
      if (error instanceof TaxError) throw new SalesError(error.status, `Line ${sequence}: ${error.message}`, error.code);
      throw error;
    }
  }
  if (resolvedTax.needsPlaceOfSupply)
    throw new SalesError(
      422,
      !master.tax.registration?.stateCode
        ? "Add the company's GST registration in Settings → Taxes before quoting taxable items."
        : `Line ${sequence}: choose a billing or shipping address with a state, or set the place of supply, so GST can be calculated.`,
      "SALES_PLACE_OF_SUPPLY_REQUIRED",
    );
  const components = resolvedTax.components;
  // Services and non-stock items have no stock to reserve or issue.
  if (line.warehouseId && !item.track_inventory) line = { ...line, warehouseId: null };
  if (line.warehouseId) {
    const warehouse = await client.query(
      `SELECT 1 FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [
        context.organizationId,
        uuid(line.warehouseId, `Line ${sequence} warehouse`),
      ],
    );
    if (!warehouse.rows[0])
      throw new SalesError(
        409,
        `Line ${sequence} warehouse is inactive.`,
      );
  }
  const lineNet = netAmount;
  // The document discount reduces each line's taxable value before tax (GST
  // is charged on the discounted value). The line's share is known only once
  // every line is priced, so the line is finished in a second step.
  const finish = (headerDiscountGross) => {
  let netAmount = lineNet;
  const discountedNet = sub(netAmount, headerDiscountGross);
  let headerDiscountShare = headerDiscountGross;
  const inclusive = Boolean(master.priceList?.taxInclusive);
  // The shared calculation: each component rounded, the line's tax their sum;
  // for tax-inclusive prices the tax is backed out of the value.
  const calculated = computeTax({ base: discountedNet, inclusive, components, decimalPlaces: master.currency.decimal_places });
  const taxableAmount = calculated.taxableAmount;
  const taxAmount = calculated.taxAmount;
  const taxRate = calculated.totalRate;
  if (inclusive && taxRate > 0n) {
    const netExcludingTax = roundMoney(
      div(mul(netAmount, 100), add(100, taxRate)),
      master.currency.decimal_places,
    );
    headerDiscountShare = sub(netExcludingTax, taxableAmount);
    netAmount = netExcludingTax;
  }
  const taxLines = calculated.components.map((component, index) => ({
    sequence: index + 1,
    taxType: component.type,
    label: component.label,
    rate: asDatabaseDecimal(component.rate),
    taxableAmount: asDatabaseDecimal(component.taxableAmount),
    taxAmount: asDatabaseDecimal(component.taxAmount),
    taxCategoryId: resolvedTax.categoryId,
    taxRateId: resolvedTax.rateId,
    // Why this tax: kept with the line for audit and debugging.
    metadata: {
      taxCategoryCode: resolvedTax.categoryCode, treatment: resolvedTax.treatment, supplyNature: resolvedTax.supplyNature, placeOfSupply: master.placeOfSupply?.code ?? null,
      sellerStateCode: master.tax.registration?.stateCode ?? null, documentDate: master.documentDate, inclusive, reverseCharge: resolvedTax.reverseCharge,
    },
  }));
  const effectiveStandardCost = decimal(item.standard_cost || 0);
  const costAmount = roundMoney(
    mul(baseQuantity, effectiveStandardCost),
    master.currency.decimal_places,
  );
  const lineTotal = add(sub(netAmount, headerDiscountShare), taxAmount);
  const marginAmount = sub(netAmount, costAmount);
  const marginPercent =
    netAmount === 0n ? 0n : mul(div(marginAmount, netAmount), 100);
  return {
    sequence,
    itemId,
    uomId,
    warehouseId: line.warehouseId || null,
    itemCodeSnapshot: item.code,
    itemNameSnapshot: item.name,
    descriptionSnapshot: text(line.description, 4000) || item.sales_description || item.description,
    hsnSacSnapshot: item.hsn_sac_code,
    // Goods carry an HSN code, services a SAC code.
    hsnSacKind: item.hsn_sac_code ? (item.item_type === "service" ? "sac" : "hsn") : null,
    taxRate: asDatabaseDecimal(taxRate),
    taxRateId: resolvedTax.rateId,
    taxCategoryCode: resolvedTax.categoryCode,
    taxTreatment: resolvedTax.treatment,
    uomSnapshot: uomCode,
    quantity: asDatabaseDecimal(quantity),
    baseQuantity: asDatabaseDecimal(baseQuantity),
    conversionFactor: asDatabaseDecimal(conversionFactor),
    listUnitPrice: asDatabaseDecimal(listUnitPrice),
    unitPrice: asDatabaseDecimal(requestedUnitPrice),
    discountPercent: asDatabaseDecimal(discountPercent),
    quoted: Boolean(line.quoted),
    sourceQuotationLineId: line.sourceQuotationLineId ?? null,
    discountType,
    discountValue: asDatabaseDecimal(discountValue),
    discountAmount: asDatabaseDecimal(discountAmount),
    grossAmount: asDatabaseDecimal(roundMoney(gross, master.currency.decimal_places)),
    netAmount: asDatabaseDecimal(netAmount),
    documentDiscountAmount: asDatabaseDecimal(headerDiscountShare),
    taxableAmount: asDatabaseDecimal(taxableAmount),
    // (line discount + document discount share) as a percentage of the gross line amount
    effectiveDiscountPercent: asDatabaseDecimal(gross > 0n ? div(mul(add(discountAmount, headerDiscountGross), 100), gross) : decimal(0)),
    taxAmount: asDatabaseDecimal(taxAmount),
    lineTotal: asDatabaseDecimal(lineTotal),
    standardCost: asDatabaseDecimal(effectiveStandardCost),
    costAmount: asDatabaseDecimal(costAmount),
    marginAmount: asDatabaseDecimal(marginAmount),
    marginPercent: asDatabaseDecimal(marginPercent),
    taxCategoryId: resolvedTax.categoryId,
    requestedDeliveryDate: date(
      line.requestedDeliveryDate,
      `Line ${sequence} requested delivery date`,
    ),
    manualPriceOverride: manualOverride,
    manualPriceReason: manualOverride
      ? text(line.manualPriceReason, 1000)
      : null,
    priceMissing: priceMissing && !manualPriceGiven,
    priceMessage: priceMissing && !manualPriceGiven ? priceMessage : null,
    pricingTrace: {
      priceSource,
      priceListId: master.priceList?.id ?? null,
      priceListEntryId: priceEntryId,
      documentDate: master.documentDate,
      listPrice: asDatabaseDecimal(listUnitPrice),
      calculatedUnitPrice: asDatabaseDecimal(calculatedUnitPrice),
      finalUnitPrice: asDatabaseDecimal(requestedUnitPrice),
      appliedRules,
      manualOverride,
    },
    taxTrace: taxLines,
    taxLines,
  };
  };
  return { eligibleNet: lineNet, finish };
}

// What a document form offers for tax: the company registrations, the supply
// types and states, and whether this user may override what is worked out.
async function documentTaxOptions(client, context) {
  const tax = await loadTaxContext(client, { organizationId: context.organizationId });
  const registrations = (await client.query(
    `SELECT id, code, name, registration_number, state_code, is_default FROM tenant.tax_registrations WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC, lower(name)`,
    [context.organizationId])).rows;
  return {
    enabled: tax.enabled,
    registrations: registrations.map((row) => ({ id: row.id, code: row.code, name: row.name, registrationNumber: row.registration_number, stateCode: row.state_code, isDefault: row.is_default })),
    states: GST_STATES,
    supplyTypes: SUPPLY_TYPES.map(({ code, label }) => ({ code, label })),
    canOverrideTreatment: Boolean(hasPermission(context, TAX_PERMISSIONS.overrideTransaction)),
    canOverridePlaceOfSupply: Boolean(hasPermission(context, TAX_PERMISSIONS.overridePlaceOfSupply)),
  };
}

// The tax a document was calculated with: who issues it, the supply type and
// treatment, the place of supply and how it was arrived at, and the tax by
// component and rate.
function documentTax(master, lines) {
  const summary = summarizeTax(lines.flatMap((line) => line.taxLines)).map((entry) => ({
    taxType: entry.taxType, label: entry.label, rate: asDatabaseDecimal(entry.rate), taxableAmount: asDatabaseDecimal(entry.taxableAmount), taxAmount: asDatabaseDecimal(entry.taxAmount),
  }));
  return {
    enabled: master.tax.enabled,
    seller: master.tax.registration,
    supplyType: master.supplyType,
    derivedSupplyType: master.derivedSupplyType,
    treatment: treatmentOfSupply(master.supplyType),
    overrideReason: master.taxOverrideReason,
    placeOfSupply: master.placeOfSupply,
    supplyNature: master.supplyNature,
    summary,
  };
}

// How a document's tax context is stored on its version (quotation and order alike).
export function documentTaxColumns(preview) {
  const { tax } = preview;
  return [tax.seller?.id ?? null, JSON.stringify(tax.seller ?? {}), tax.treatment, tax.overrideReason, tax.placeOfSupply?.name ?? null, tax.placeOfSupply?.source ?? "derived",
    tax.placeOfSupply?.reason ?? null, tax.supplyNature];
}
// The tax classification kept on each line.
export const lineTaxColumns = (line) => [line.taxRate, line.taxRateId, line.taxCategoryCode, line.taxTreatment, line.hsnSacKind];

// How a document's discount is stored on its version (quotation and order alike).
export function documentDiscountColumns(preview) {
  const { totals, discount } = preview;
  return [totals.documentDiscountType, totals.documentDiscountValue, totals.documentDiscountAmount, totals.grossTotal, totals.lineDiscountTotal, totals.taxableTotal,
    discount.reasonCode, discount.reasonText];
}

export async function previewSalesDocument(
  client,
  context,
  input,
  options = {},
) {
  if (!Array.isArray(input.lines) || !input.lines.length)
    throw new SalesError(400, "Add at least one item line.");
  if (input.lines.length > 500)
    throw new SalesError(400, "A document cannot contain more than 500 lines.");
  const master = await loadDocumentContext(client, context, input, options);
  // 1. every line: price, quantity, line discount
  const priced = [];
  for (let i = 0; i < input.lines.length; i++)
    priced.push(
      await calculateLine(
        client,
        context,
        master,
        input.lines[i],
        i + 1,
        input,
        options,
      ),
    );
  // 2. the document discount, shared across the lines in proportion to their value
  const documentDiscount = readDocumentDiscount(context, master, input, priced.map((line) => line.eligibleNet),
    { ...options, carryQuotedPrices: Boolean(options.carryQuotedPrices || options.carryDocumentDiscount) });
  const shares = allocateDocumentDiscount(documentDiscount.amount, priced.map((line) => line.eligibleNet), master.currency.decimal_places);
  // 3. taxable value and tax, per line
  const lines = priced.map((line, index) => line.finish(shares[index]));
  const headerDiscountPercent = documentDiscount.percent;
  const discountChecks = checkDiscountRules(context, master, input, lines, options);
  let subtotal = decimal(0),
    grossTotal = decimal(0),
    taxableTotal = decimal(0),
    discountTotal = decimal(0),
    taxTotal = decimal(0),
    costTotal = decimal(0),
    maximumDiscount = decimal(0);
  for (const line of lines) {
    subtotal = add(subtotal, line.netAmount);
    grossTotal = add(grossTotal, line.grossAmount);
    taxableTotal = add(taxableTotal, line.taxableAmount);
    discountTotal = add(discountTotal, line.discountAmount);
    taxTotal = add(taxTotal, line.taxAmount);
    costTotal = add(costTotal, line.costAmount);
    maximumDiscount = max(maximumDiscount, line.discountPercent);
  }
  const charges = [];
  let chargeTotal = decimal(0);
  for (let i = 0; i < (input.charges || []).length; i++) {
    const charge = input.charges[i];
    const value = decimal(charge.value);
    if (value < 0n)
      throw new SalesError(400, "Charge values cannot be negative.");
    const amount = roundMoney(
      charge.calculationType === "percentage"
        ? percent(subtotal, value)
        : value,
      master.currency.decimal_places,
    );
    chargeTotal = add(chargeTotal, amount);
    charges.push({
      sequence: i + 1,
      chargeType: charge.chargeType || "other",
      label: text(charge.label, 120) || "Charge",
      calculationType: charge.calculationType,
      value: asDatabaseDecimal(value),
      amount: asDatabaseDecimal(amount),
      taxable: charge.taxable !== false,
    });
  }
  // Header/document-level discount (F039): shared across the lines pro rata
  // before tax in calculateLine, so tax is charged on the discounted value.
  // Folded into discountTotal/maximumDiscount so it stays visible in
  // reporting and is still caught by the discount-threshold approval gate.
  const headerDiscountAmount = lines.reduce(
    (total, line) => add(total, line.documentDiscountAmount),
    decimal(0),
  );
  const lineDiscountTotal = discountTotal;
  discountTotal = add(discountTotal, headerDiscountAmount);
  maximumDiscount = max(maximumDiscount, headerDiscountPercent);
  const beforeRounding = sub(
    add(subtotal, chargeTotal, taxTotal),
    headerDiscountAmount,
  );
  const grandTotal = roundMoney(beforeRounding, master.currency.decimal_places);
  const roundingAdjustment = sub(grandTotal, beforeRounding);
  const baseCurrencyTotal = roundMoney(
    mul(grandTotal, master.exchangeRate),
    master.currency.decimal_places,
  );
  const marginAmount = sub(sub(subtotal, headerDiscountAmount), costTotal);
  const marginPercent =
    subtotal === 0n ? 0n : mul(div(marginAmount, subtotal), 100);
  const snapshots = {
    customer: {
      id: master.party.id,
      code: master.party.code,
      customerNumber: master.party.customer_number ?? null,
      displayName: master.party.display_name,
      legalName: master.party.legal_name,
      gstin: master.party.gstin,
      pan: master.party.pan,
      partyType: master.party.party_type,
    },
    contact: master.contact || {},
    billingAddress: master.billing.row || {},
    shippingAddress: master.shipping.row || {},
    paymentTerm: master.paymentTerm || {},
  };
  return {
    master,
    lines,
    charges,
    snapshots,
    totals: {
      subtotal: asDatabaseDecimal(subtotal),
      discountTotal: asDatabaseDecimal(discountTotal),
      chargeTotal: asDatabaseDecimal(chargeTotal),
      taxTotal: asDatabaseDecimal(taxTotal),
      roundingAdjustment: asDatabaseDecimal(roundingAdjustment),
      grandTotal: asDatabaseDecimal(grandTotal),
      baseCurrencyTotal: asDatabaseDecimal(baseCurrencyTotal),
      costTotal: asDatabaseDecimal(costTotal),
      marginAmount: asDatabaseDecimal(marginAmount),
      marginPercent: asDatabaseDecimal(marginPercent),
      maximumDiscountPercent: asDatabaseDecimal(maximumDiscount),
      grossTotal: asDatabaseDecimal(grossTotal),
      lineDiscountTotal: asDatabaseDecimal(lineDiscountTotal),
      documentDiscountType: documentDiscount.type,
      documentDiscountValue: asDatabaseDecimal(documentDiscount.value),
      documentDiscountPercent: asDatabaseDecimal(documentDiscount.percent),
      documentDiscountAmount: asDatabaseDecimal(headerDiscountAmount),
      taxableTotal: asDatabaseDecimal(taxableTotal),
    },
    discount: discountChecks,
    tax: documentTax(master, lines),
    pricingTrace: lines.map((line) => ({
      sequence: line.sequence,
      ...line.pricingTrace,
    })),
    taxTrace: lines.flatMap((line) =>
      line.taxTrace.map((tax) => ({ lineSequence: line.sequence, ...tax })),
    ),
  };
}

// F041: an approver away on an active delegation has new requests routed to
// their delegate; the original assignee is kept on the event trail.
export async function resolveApprover(client, context, assignedTo) {
  if (!assignedTo) return { assignee: null, delegatedFrom: null };
  const delegation = (
    await client.query(
      `SELECT delegate_user_id FROM tenant.sales_approval_delegations
        WHERE organization_id=$1 AND delegator_user_id=$2 AND status='active' AND starts_on<=current_date AND ends_on>=current_date
        ORDER BY created_at DESC LIMIT 1`,
      [context.organizationId, assignedTo],
    )
  ).rows[0];
  return delegation
    ? { assignee: delegation.delegate_user_id, delegatedFrom: assignedTo }
    : { assignee: assignedTo, delegatedFrom: null };
}
// Approving/rejecting straight from the quotation or order must also close
// the matching inbox request, or it stays "pending" and fails when opened.
const APPROVAL_COMMAND_FOR = Object.freeze({
  sales_quotation: "sales.quotation.approve",
  sales_order: "sales.order.approve",
  sales_order_amendment: "sales.order.amendment.approve",
});
export async function closeApprovalRequest(client, context, entityType, entityId, status, note = null) {
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: APPROVAL_COMMAND_FOR[entityType], entityId,
    decision: status, actorUserId: context.userId || null, note,
  });
}

export function redactMargin(value, context) {
  if (hasPermission(context, "sales.margin.view")) return value;
  const protectedKeys = new Set([
    "standard_cost",
    "cost_amount",
    "cost_total",
    "margin_amount",
    "margin_percent",
  ]);
  function walk(item) {
    if (Array.isArray(item)) return item.map(walk);
    if (item instanceof Date) return item;
    if (item && typeof item === "object") {
      const output = {};
      for (const [key, v] of Object.entries(item))
        if (!protectedKeys.has(key)) output[key] = walk(v);
      return output;
    }
    return item;
  }
  return walk(value);
}

export async function getSalesReport(client, context, key) {
  requirePermission(context, "sales.reports.view");
  const allowed = new Set([
    "expiring-quotations",
    "pending-approvals",
    "fulfillment",
    "remaining-by-product",
    "delivery-performance",
    "billing-readiness",
    "order-status",
  ]);
  if (!allowed.has(key)) throw new SalesError(404, "Unknown Sales report.");
  const queries = {
    "expiring-quotations": `SELECT quotation.id,quotation.quotation_number,quotation.valid_until,version.customer_snapshot->>'displayName' AS customer,version.currency_code,version.grand_total FROM tenant.sales_quotations quotation JOIN tenant.sales_quotation_versions version ON version.id=quotation.current_version_id WHERE quotation.organization_id=$1 AND quotation.lifecycle_status IN ('approved','sent') AND quotation.valid_until>=current_date AND quotation.valid_until<=current_date+30 ORDER BY quotation.valid_until`,
    "pending-approvals": `SELECT id,quotation_number,lifecycle_status,approval_status,updated_at FROM tenant.sales_quotations WHERE organization_id=$1 AND approval_status='pending' ORDER BY updated_at`,
    // Open demand per order, from the deliveries and cancellations themselves: what is left to deliver and whether it is late.
    fulfillment: `SELECT orders.id AS sales_order_id,orders.sales_order_number,version.customer_snapshot->>'displayName' AS customer,orders.requested_delivery_date,
        sum(line.quantity) AS ordered,sum(delivered.quantity) AS delivered,sum(progress.cancelled_quantity) AS cancelled,
        sum(GREATEST(line.quantity-progress.cancelled_quantity-delivered.quantity,0)) AS remaining,
        CASE WHEN sum(delivered.quantity)=0 THEN 'Not delivered' ELSE 'Partially delivered' END AS fulfillment,
        CASE WHEN orders.requested_delivery_date<current_date THEN 'Overdue' ELSE '' END AS overdue
      FROM tenant.sales_orders orders
      JOIN tenant.sales_order_versions version ON version.id=orders.current_version_id
      JOIN tenant.sales_order_lines line ON line.sales_order_version_id=version.id
      JOIN tenant.items item ON item.id=line.item_id AND item.item_type<>'service'
      JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(delivery_line.quantity),0) AS quantity FROM tenant.sales_delivery_lines delivery_line
                            JOIN tenant.sales_fulfillment_requests delivery ON delivery.id=delivery_line.delivery_id AND delivery.delivery_status IN ('dispatched','delivered')
                           WHERE delivery_line.sales_order_line_id=line.id) delivered
     WHERE orders.organization_id=$1 AND orders.lifecycle_status='confirmed'
     GROUP BY orders.id,version.customer_snapshot
    HAVING sum(GREATEST(line.quantity-progress.cancelled_quantity-delivered.quantity,0))>0
     ORDER BY orders.requested_delivery_date NULLS LAST,orders.sales_order_number LIMIT 500`,
    // Open demand per product across confirmed orders: what procurement and production can plan from.
    "remaining-by-product": `SELECT item.code AS product_code,item.name AS product,line.uom_snapshot AS unit,count(DISTINCT orders.id) AS orders,
        sum(GREATEST(line.quantity-progress.cancelled_quantity-delivered.quantity,0)) AS remaining,
        sum(LEAST(GREATEST(line.quantity-progress.cancelled_quantity-delivered.quantity,0),progress.reserved_quantity)) AS reserved,
        min(orders.requested_delivery_date) AS earliest_requested
      FROM tenant.sales_orders orders
      JOIN tenant.sales_order_lines line ON line.sales_order_version_id=orders.current_version_id
      JOIN tenant.items item ON item.id=line.item_id AND item.item_type<>'service'
      JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(delivery_line.quantity),0) AS quantity FROM tenant.sales_delivery_lines delivery_line
                            JOIN tenant.sales_fulfillment_requests delivery ON delivery.id=delivery_line.delivery_id AND delivery.delivery_status IN ('dispatched','delivered')
                           WHERE delivery_line.sales_order_line_id=line.id) delivered
     WHERE orders.organization_id=$1 AND orders.lifecycle_status='confirmed'
     GROUP BY item.id,item.code,item.name,line.uom_snapshot
    HAVING sum(GREATEST(line.quantity-progress.cancelled_quantity-delivered.quantity,0))>0
     ORDER BY remaining DESC LIMIT 500`,
    // Each dispatched delivery against the date the customer asked for.
    "delivery-performance": `SELECT delivery.request_number AS delivery_number,orders.sales_order_number,delivery.customer_snapshot->>'displayName' AS customer,
        orders.requested_delivery_date,delivery.dispatch_date,delivery.delivered_at::date AS delivered_on,
        CASE WHEN orders.requested_delivery_date IS NULL THEN 'No date requested'
             WHEN COALESCE(delivery.delivered_at::date,delivery.dispatch_date)<=orders.requested_delivery_date THEN 'On time'
             ELSE 'Late by '||(COALESCE(delivery.delivered_at::date,delivery.dispatch_date)-orders.requested_delivery_date)||' day(s)' END AS performance
      FROM tenant.sales_fulfillment_requests delivery
      JOIN tenant.sales_orders orders ON orders.id=delivery.sales_order_id
     WHERE delivery.organization_id=$1 AND delivery.delivery_status IN ('dispatched','delivered')
     ORDER BY delivery.dispatch_date DESC NULLS LAST,delivery.request_number DESC LIMIT 500`,
    "billing-readiness": `SELECT id AS sales_order_id,sales_order_number,billing_status,updated_at FROM tenant.sales_orders WHERE organization_id=$1 AND lifecycle_status='confirmed' AND billing_status IN ('ready','partially_invoiced') ORDER BY updated_at DESC`,
  };
  // Order status: each dimension of every order's progress, from the tracking service (never one squeezed "stage").
  if (key === "order-status") return salesOrderTrackingReport(client, context.organizationId, { canSeeMoney: Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("sales.invoice.payments.view")) });
  return (await client.query(queries[key], [context.organizationId])).rows;
}

export async function getSalesOptions(
  client,
  context,
  opportunityId = null,
  partyId = null,
) {
  requirePermission(context, "sales.view");
  // Contacts/addresses join across every customer in the org; once a
  // specific customer is chosen this scopes to just its own records instead
  // of fetching every customer's contacts/addresses on every load.
  const partyFilterId = partyId ? uuid(partyId, "Customer") : null;
  const [
    parties,
    contacts,
    addresses,
    items,
    uoms,
    itemUomConversions,
    warehouses,
    priceLists,
    paymentTerms,
    currencies,
    users,
    opportunities,
  ] = await Promise.all([
    client.query(
      `SELECT id,code,party_type,display_name,legal_name,currency_code,credit_limit,payment_term_id,default_price_list_id,tax_treatment,default_shipping_method,default_delivery_terms,default_incoterm,sales_block,sales_block_reason FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','prospect','both') ORDER BY display_name LIMIT 500`,
      [context.organizationId],
    ),
    client.query(
      `SELECT contact.id,link.party_id,contact.first_name,contact.last_name,contact.email,contact.mobile,COALESCE(link.job_title,contact.designation) AS designation,contact.phone,
              link.is_primary_contact AS is_primary,link.role,link.department,link.is_billing_contact,link.is_shipping_contact,link.address_id
         FROM tenant.crm_contact_account_relationships link
         JOIN tenant.contacts contact ON contact.organization_id=link.organization_id AND contact.id=link.contact_id
        WHERE link.organization_id=$1 AND link.status='active' AND contact.status='active'${partyFilterId ? ` AND link.party_id=$2` : ""} ORDER BY link.is_primary_contact DESC,contact.first_name LIMIT 1000`,
      partyFilterId
        ? [context.organizationId, partyFilterId]
        : [context.organizationId],
    ),
    client.query(
      `SELECT address.id,address.party_id,address.address_type,address.line1,address.city,address.state,address.state_code,address.postal_code,address.line2,address.district,address.country_code,address.gstin,address.is_primary,address.label,address.is_default_billing,address.is_default_shipping
         FROM tenant.addresses address
         JOIN tenant.business_parties party ON party.organization_id=address.organization_id AND party.id=address.party_id
        WHERE address.organization_id=$1 AND address.status='active'${partyFilterId ? ` AND address.party_id=$2` : ""} ORDER BY address.is_default_billing DESC,address.is_primary DESC,address.city LIMIT 500`,
      partyFilterId
        ? [context.organizationId, partyFilterId]
        : [context.organizationId],
    ),
    client.query(
      `SELECT id,code,name,item_type,uom_id,sales_uom_id,sales_description,description,track_inventory,standard_cost,tax_category_id,parent_item_id,variant_attributes FROM tenant.items WHERE organization_id=$1 AND status='active' AND is_sellable ORDER BY name LIMIT 2000`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,code,name,decimal_places FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY category,name`,
      [context.organizationId],
    ),
    // A line can only be sold in a UOM the item is actually convertible to
    // (calculateLine enforces this server-side too) -- this is what the line
    // editor's per-item UOM picker filters against, instead of offering every
    // UOM in the org regardless of whether a conversion exists.
    client.query(
      `SELECT item_id,from_uom_id,to_uom_id,conversion_factor FROM tenant.item_uom_conversions WHERE organization_id=$1 AND status='active' AND sales_enabled LIMIT 2000`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 500`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,code,name,currency_code,tax_inclusive,is_default FROM tenant.price_lists WHERE organization_id=$1 AND price_list_type='sales' AND status='active' AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY is_default DESC,name`,
      [context.organizationId],
    ),
    listSalesTermOptions(client, context.organizationId).then((rows) => ({ rows })),
    client.query(
      `SELECT code,name,symbol,decimal_places,is_base FROM tenant.currencies WHERE organization_id=$1 AND status='active' ORDER BY is_base DESC,code`,
      [context.organizationId],
    ),
    client.query(
      `SELECT users.id,users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id=membership.user_id WHERE membership.organization_id=$1 AND membership.status='active' AND users.status='active' ORDER BY users.full_name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,party_id,contact_id,owner_user_id,name,amount,currency_code,expected_close_date FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open'${opportunityId ? ` AND id=$2` : ""} ORDER BY updated_at DESC LIMIT 200`,
      opportunityId
        ? [context.organizationId, opportunityId]
        : [context.organizationId],
    ),
  ]);
  let opportunityItems = [];
  if (opportunityId)
    opportunityItems = (
      await client.query(
        `SELECT opportunity_item.item_id,opportunity_item.price_list_id,opportunity_item.description,opportunity_item.quantity,opportunity_item.unit_price,opportunity_item.discount_percent,item.uom_id FROM tenant.crm_opportunity_items opportunity_item JOIN tenant.items item ON item.id=opportunity_item.item_id WHERE opportunity_item.organization_id=$1 AND opportunity_item.opportunity_id=$2 ORDER BY opportunity_item.created_at`,
        [context.organizationId, opportunityId],
      )
    ).rows;
  // SECURITY: item.standard_cost is otherwise gated everywhere (redactMargin
  // on quotation/order reads, sales.margin.view on the margin report) - the
  // options picker used while building a NEW document must not be the one
  // path that leaks it to any sales.view user regardless of that permission.
  return redactMargin(
    {
      parties: parties.rows,
      contacts: contacts.rows,
      addresses: addresses.rows,
      items: items.rows,
      uoms: uoms.rows,
      itemUomConversions: itemUomConversions.rows,
      warehouses: warehouses.rows,
      priceLists: priceLists.rows,
      paymentTerms: paymentTerms.rows,
      currencies: currencies.rows,
      users: users.rows,
      opportunities: opportunities.rows,
      opportunityItems,
      // Only what the document forms need to pre-fill; thresholds stay server-side.
      settings: await client
        .query(`SELECT default_quote_validity_days,allow_direct_orders FROM tenant.sales_settings WHERE organization_id=$1`, [context.organizationId])
        .then((r) => r.rows[0] || { default_quote_validity_days: 15, allow_direct_orders: true }),
      discounts: await discountOptions(client, context),
      tax: await documentTaxOptions(client, context),
    },
    context,
  );
}

// pass1-operations.js: sales settings, advances, drop-ship requests and
// commission accrual. price-lists/: price lists and the one price resolver.
export * from "./pass1-operations.js";
export * from "./price-lists/index.js";
export * from "./after-sales.js";
export * from "./quotations/index.js";
export * from "./orders/index.js";
export * from "./order-confirmations/index.js";
export * from "./availability/index.js";
export * from "./reservations/index.js";
export * from "./deliveries/index.js";
export * from "./invoices/index.js";
export * from "./returns/index.js";
export * from "./credit-notes/index.js";
export * from "./order-tracking/index.js";
export * from "./home/index.js";
export { DISCOUNT_PERMISSIONS, DISCOUNT_REASONS } from "./discounts.js";
