// F277/F278/F279/F280/F281 — the ONE authoritative, deterministic POS
// pricing/tax/discount/promotion/coupon evaluator. Both the cart-based
// checkout flow (cart.js) and the legacy flat-lines completePointOfSale
// payload (index.js) call this same function so there is exactly one
// business calculator, not two divergent ones. Never trust a client-supplied unitPrice, discount,
// tax, or total — every monetary figure here is derived server-side from
// tenant.price_list_items, tenant.tax_rates, tenant.pos_promotions and
// tenant.pos_coupons, using the fixed-point decimal primitives in
// services/api/src/core/decimal.js (never native `Number` arithmetic for
// money).
//
// Evaluation order (select effective price/customer context ->
// deterministic discount/promotion/coupon/tax evaluation):
// resolve unit price -> manual line discount -> promotions -> coupon ->
// cart-level manual discount (allocated proportionally) -> tax on the
// resulting taxable base. Unlike Sales' previewSalesDocument, where the
// header discount is applied AFTER tax (a deliberate, documented Sales
// decision that a whole-document discount doesn't retroactively change a
// tax line already computed on each line's own pre-header-discount
// amount), POS applies every discount layer -- manual, promotion, coupon,
// and cart-level -- BEFORE tax, because retail/GST practice taxes the
// price actually paid. This is a deliberate, documented divergence from Sales' header-discount
// behavior, not an oversight.
import { add, sub, mul, div, percent, max, min, roundMoney, asDatabaseDecimal, decimal, allocate } from "../../../core/decimal.js";
import { determineRequiredSalesDocument } from "../../../core/invoicing/index.js";
import { createHash } from "node:crypto";
import { computeTax, gstStateName, loadTaxContext, resolveLineTax, summarizeTax } from "../../../core/tax/index.js";
import { posError } from "../shared/errors.js";
import { resolveSalesPrice, resolveSalesPriceList } from "../../sales/price-lists/resolver.js";
import {
  resolveActivePosLoyaltyProgram,
  getPosLoyaltyBalanceValue,
  requirePosLoyaltyRedemptionEligible,
  computePosLoyaltyRedemption,
  computePosLoyaltyEarnPoints,
} from "./loyalty.js";

export async function resolveCurrencyDecimalPlaces(client, context, currencyCode) {
  const result = await client.query(
    `SELECT decimal_places FROM tenant.currencies WHERE organization_id=$1 AND code=$2 AND status='active'`,
    [context.organizationId, currencyCode],
  );
  return result.rows[0]?.decimal_places ?? 2;
}

// Mirrors Sales' master.priceList.tax_inclusive -- the POS store's price
// list decides whether its configured rates already include tax, exactly
// the same authoritative source Sales itself reads, not a second
// POS-invented setting.
async function resolvePriceListTaxInclusive(client, context, priceListId) {
  if (!priceListId) return false;
  const result = await client.query(
    `SELECT tax_inclusive FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, priceListId],
  );
  return Boolean(result.rows[0]?.tax_inclusive);
}

// ------------------------------------------------------------------ POS Taxes (migration 0089)
//
// POS supplies the transaction context; the shared tax engine (core/tax) decides the tax. POS never picks a rate, never treats a missing
// classification as zero tax, and never charges GST from a registration that cannot (composition, an expired registration, none at all).
//
//   seller          the outlet's own GST registration (pos_stores.tax_registration_id), else the company default; regular regime only
//   place of supply goods handed over at the counter: the store's state; goods delivered: the delivery state (asked for); services: a
//                   registered business buyer's billing state, else the customer's billing state on record, else the store's state
//   classification  taxable, nil-rated (0%), exempt, non-GST, zero-rated — kept apart for reporting
//   rounding        each component is rounded to the currency per line; the bill's tax is the sum of the lines', so components, lines and
//                   the bill always reconcile; the bill total is then rounded once (the rounding adjustment is shown, never hidden in a tax)

export const POS_TAX_MESSAGES = Object.freeze({
  POS_TAX_CONFIGURATION_MISSING: "Tax setup is incomplete. Contact your manager.",
  POS_TAX_REGISTRATION_INVALID: "Store tax registration needs attention.",
  POS_TAX_ITEM_CLASSIFICATION_MISSING: "Tax details are missing for this product.",
  POS_TAX_HSN_SAC_INVALID: "Product tax classification is invalid.",
  POS_TAX_RATE_NOT_FOUND: "Applicable tax rate could not be found.",
  POS_TAX_RULE_AMBIGUOUS: "Tax configuration has conflicting rules.",
  POS_TAX_SUPPLY_CONTEXT_REQUIRED: "Additional delivery or billing details are required.",
  POS_TAX_BUYER_DETAILS_REQUIRED: "Enter the required customer tax details.",
  POS_TAX_SPECIAL_REGIME_UNSUPPORTED: "This tax scenario is not supported at POS.",
  POS_TAX_DISCOUNT_INVALID: "Discount cannot be applied under the current tax rules.",
  POS_TAX_CALCULATION_FAILED: "Tax could not be calculated. Please retry.",
  POS_TAX_CALCULATION_STALE: "Taxes changed. Please review the bill.",
  POS_TAX_TOTAL_MISMATCH: "Bill totals could not be verified.",
  POS_TAX_CHECKOUT_LOCKED: "Payment is being processed.",
  POS_TAX_RETURN_ADJUSTMENT_INVALID: "Return tax adjustment could not be validated.",
});
export const posTaxError = (status, code, detail = null) => {
  const error = posError(status, detail ? `${POS_TAX_MESSAGES[code]} ${detail}` : POS_TAX_MESSAGES[code], code);
  error.taxError = true;
  return error;
};

const HSN_PATTERN = /^[0-9]{4}([0-9]{2}){0,2}$/;
const SAC_PATTERN = /^99[0-9]{4}$/;
const GST_REGISTERED_BUYER = ["registered_regular", "registered_composition", "sez"];

// The legally relevant tax date (the invoice date) in the organization's own time zone.
async function taxDay(client, context) {
  return (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS day FROM public.organizations WHERE id = $1`,
    [context.organizationId])).rows[0]?.day ?? new Date().toISOString().slice(0, 10);
}

// The supply context of a bill: who sells (the outlet's registration), when (the tax date), and where each kind of line is supplied.
// input: storeId, customerId, billingAddressId, supplyMode ("in_store" | "delivery"), deliveryStateCode.
export async function resolvePosSupplyContext(client, context, { storeId = null, customerId = null, billingAddressId = null, supplyMode = "in_store", deliveryStateCode = null } = {}) {
  const store = storeId ? (await client.query(`SELECT tax_registration_id FROM tenant.pos_stores WHERE organization_id = $1 AND id = $2`, [context.organizationId, storeId])).rows[0] : null;
  let tax;
  try {
    tax = await loadTaxContext(client, { organizationId: context.organizationId, sellerRegistrationId: store?.tax_registration_id ?? null });
  } catch (error) {
    throw posTaxError(409, "POS_TAX_REGISTRATION_INVALID", error.message);
  }
  const day = await taxDay(client, context);
  const registration = tax.registration;
  if (tax.enabled) {
    if (!registration) throw posTaxError(409, "POS_TAX_REGISTRATION_INVALID", "No GST registration is set up for this store.");
    if (registration.registrationType && registration.registrationType !== "regular")
      throw posTaxError(409, "POS_TAX_SPECIAL_REGIME_UNSUPPORTED", `The store's registration (${registration.name}) is ${String(registration.registrationType).replace(/_/g, " ")}; POS bills only under a regular GST registration.`);
    const from = registration.validFrom ? String(registration.validFrom instanceof Date ? registration.validFrom.toISOString() : registration.validFrom).slice(0, 10) : null;
    const until = registration.validUntil ? String(registration.validUntil instanceof Date ? registration.validUntil.toISOString() : registration.validUntil).slice(0, 10) : null;
    if ((from && day < from) || (until && day > until)) throw posTaxError(409, "POS_TAX_REGISTRATION_INVALID", `The registration ${registration.name} is not valid on ${day}.`);
    if (tax.countryCode === "IN" && !registration.stateCode) throw posTaxError(409, "POS_TAX_REGISTRATION_INVALID", "The registration has no state.");
  }
  const sellerStateCode = registration?.stateCode ?? null;
  const mode = supplyMode === "delivery" ? "delivery" : "in_store";
  if (mode === "delivery" && !(deliveryStateCode && gstStateName(deliveryStateCode)))
    throw posTaxError(409, "POS_TAX_SUPPLY_CONTEXT_REQUIRED", "Choose the state the goods are delivered to.");
  let buyer = null;
  if (customerId) {
    const party = (await client.query(`SELECT gstin, tax_treatment, gst_state_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, customerId])).rows[0];
    const billing = (await client.query(
      `SELECT state_code FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND address_type = 'billing' AND status = 'active'
        ORDER BY (id = $3::uuid) DESC, is_default_billing DESC, is_primary DESC, created_at LIMIT 1`, [context.organizationId, customerId, billingAddressId])).rows[0];
    buyer = { registered: Boolean(party?.gstin) && GST_REGISTERED_BUYER.includes(party?.tax_treatment ?? ""), stateCode: billing?.state_code ?? party?.gst_state_code ?? null };
  }
  return {
    tax, day, sellerStateCode, supplyMode: mode, deliveryStateCode: mode === "delivery" ? deliveryStateCode : null,
    // Goods: where they are handed over — the store, or the delivery state. Never the buyer's state on its own.
    goodsPlaceOfSupply: mode === "delivery" ? deliveryStateCode : sellerStateCode,
    // Services: a registered buyer's location, else the buyer's address on record, else the store.
    servicesPlaceOfSupply: buyer?.stateCode ?? sellerStateCode,
    buyer,
  };
}

// The engine's decision for one product on this bill: its tax category (the product's, else the company default — never none), its
// HSN/SAC (checked for shape; India), the rate in force on the tax date and the components for its place of supply.
export async function resolvePosLineTax(client, supply, item) {
  const tax = supply.tax;
  const isService = item.item_type === "service";
  const placeOfSupply = isService ? supply.servicesPlaceOfSupply : supply.goodsPlaceOfSupply;
  const code = String(item.hsn_sac_code ?? "").replace(/[\s.]/g, "");
  if (!tax.enabled) {
    return { treatment: "non_taxable", classification: "non_gst", taxType: "none", categoryId: item.tax_category_id ?? null, categoryCode: null, rateId: null, rate: decimal(0),
      cessRate: decimal(0), components: [], placeOfSupply, hsnSac: code || null, notCharged: true };
  }
  const categoryId = item.tax_category_id ?? tax.defaultTaxCategoryId ?? null;
  if (!categoryId) throw posTaxError(409, "POS_TAX_ITEM_CLASSIFICATION_MISSING", `${item.name} has no tax category.`);
  if (tax.countryCode === "IN" && !(isService ? SAC_PATTERN : HSN_PATTERN).test(code))
    throw posTaxError(409, "POS_TAX_HSN_SAC_INVALID", `${item.name}: ${code ? `"${code}" is not a valid ${isService ? "SAC" : "HSN"} code` : `no ${isService ? "SAC" : "HSN"} code`}.`);
  let decision;
  try {
    decision = await resolveLineTax(client, tax, { taxCategoryId: categoryId, date: supply.day, sellerStateCode: supply.sellerStateCode, placeOfSupply, requireCategory: true });
  } catch (error) {
    const mapped = { TAX_RATE_MISSING: "POS_TAX_RATE_NOT_FOUND", TAX_CATEGORY_INACTIVE: "POS_TAX_ITEM_CLASSIFICATION_MISSING", TAX_CATEGORY_INVALID: "POS_TAX_ITEM_CLASSIFICATION_MISSING",
      TAX_CATEGORY_REQUIRED: "POS_TAX_ITEM_CLASSIFICATION_MISSING", TAX_REGIME_UNSUPPORTED: "POS_TAX_SPECIAL_REGIME_UNSUPPORTED" }[error.code] ?? "POS_TAX_CALCULATION_FAILED";
    throw posTaxError(409, mapped, `${item.name}: ${error.message}`);
  }
  if (decision.needsPlaceOfSupply) throw posTaxError(409, "POS_TAX_SUPPLY_CONTEXT_REQUIRED", `${item.name}: the place of supply is not known.`);
  return { ...decision, placeOfSupply, hsnSac: code || null };
}

// Before a product goes on a bill: its tax can be worked out at this outlet for this bill (registration, category, HSN/SAC, rate, place of
// supply) — otherwise it is refused and nothing is written.
export async function assertPosProductTaxable(client, context, cart, itemId) {
  const supply = await resolvePosSupplyContext(client, context, { storeId: cart.store_id, customerId: cart.customer_id ?? null, billingAddressId: cart.billing_address_id ?? null,
    supplyMode: cart.supply_mode ?? "in_store", deliveryStateCode: cart.delivery_state_code ?? null });
  await resolvePosLineTax(client, supply, await resolveSaleItem(client, context, itemId, null));
}

// Which document a sale is: a tax invoice (everything taxable), a bill of supply (nothing taxable, or no GST registration), or both on one
// document when taxable and non-taxable lines are sold together.
// GST Invoice (0098): the shared invoicing rule decides — GST off or no registration is an ordinary receipt, never a bill of supply.
function taxDocumentType(supply, lines) {
  return determineRequiredSalesDocument({ taxEnabled: supply.tax.enabled, hasRegistration: Boolean(supply.tax.registration), registrationType: supply.tax.registration?.registrationType,
    classifications: lines.map((line) => line.taxClassification) }).documentType ?? "tax_invoice";
}

// A fingerprint of what the bill's tax was worked out from and came to — bound to the checkout attempt, so a payment is never taken for a
// tax that has since changed.
function taxFingerprint(supply, lines, totals) {
  return createHash("sha256").update(JSON.stringify([
    supply.tax.registration?.id ?? null, supply.day, supply.supplyMode, supply.deliveryStateCode,
    lines.map((line) => [line.itemId, asDatabaseDecimal(line.quantity), line.taxClassification, line.taxRateId, asDatabaseDecimal(line.taxableAmount), asDatabaseDecimal(line.taxAmount),
      (line.taxComponents ?? []).map((component) => [component.type, component.rate, component.taxAmount])]),
    totals.taxTotal, totals.grandTotal,
  ])).digest("hex");
}

// A walk-in sale has no shipping/billing address at all -- the customer
// is physically at the counter, so the practical place of supply is the
// store's own state (matches real over-the-counter retail GST practice:
// intra-state unless the selected customer's own registered/billing
// address proves otherwise).
//
// A registered customer's bill uses the billing address chosen at the counter (Named Customer), else their default billing address.
export async function resolveBuyerStateCode(client, context, customerId, sellerStateCode, billingAddressId = null) {
  if (!customerId) return sellerStateCode;
  const result = await client.query(
    `SELECT state_code FROM tenant.addresses
     WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
     ORDER BY (id = $3::uuid) DESC, is_default_billing DESC, is_primary DESC, created_at LIMIT 1`,
    [context.organizationId, customerId, billingAddressId],
  );
  return result.rows[0]?.state_code || sellerStateCode;
}

// A registered customer's own price list (Customer Master: default_price_list_id) when it is active, current and in the bill's currency;
// null otherwise. It prices the items it lists; anything it does not list keeps the outlet's price.
export async function resolveCustomerPriceList(client, context, customerId, store) {
  if (!customerId) return null;
  const row = (await client.query(`SELECT default_price_list_id FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [context.organizationId, customerId])).rows[0];
  if (!row?.default_price_list_id || row.default_price_list_id === store.price_list_id) return null;
  try {
    const priceList = await resolveSalesPriceList(client, context, { priceListId: row.default_price_list_id, currencyCode: store.currency_code });
    return { id: row.default_price_list_id, priceList, taxInclusive: await resolvePriceListTaxInclusive(client, context, row.default_price_list_id) };
  } catch {
    return null;
  }
}

// A sellable, active item. A variant is an item of its own: a line names the variant's item.
async function resolveSaleItem(client, context, itemId, variantId) {
  if (variantId) throw posError(409, "Choose the variant item itself.", "POS_SALE_VARIANT_IS_ITEM");
  const itemResult = await client.query(
    `SELECT item.id,item.code,item.name,item.description,item.standard_cost,item.tax_category_id,item.group_id,item.status,item.lifecycle_status,item.tracking_type,
            item.is_sellable,item.uom_id,item.hsn_sac_code,item.item_type,item.manual_discount_allowed,item.max_manual_discount_percent,item.min_selling_price,
            item_group.name AS group_name, item_group.manual_discount_allowed AS group_manual_discount_allowed, item_group.max_manual_discount_percent AS group_max_manual_discount_percent
       FROM tenant.items item
       LEFT JOIN tenant.item_groups item_group ON item_group.organization_id = item.organization_id AND item_group.id = item.group_id
      WHERE item.organization_id=$1 AND item.id=$2`,
    [context.organizationId, itemId],
  );
  const item = itemResult.rows[0];
  if (!item || item.status !== "active" || item.lifecycle_status !== "active" || !item.is_sellable) {
    throw posError(404, "One or more POS sale items were not found.", "POS_SALE_ITEM_NOT_FOUND");
  }
  return item;
}

// F275 fix: customer-sensitive pricing. Previously this resolver only
// ever consulted the store's own price list, so a customer with a
// negotiated price (tenant.sales_pricing_rules, the same table Sales'
// own previewSalesDocument reads at services/api/src/modules/sales/
// index.js:334-364) was silently charged the plain walk-in rate at POS
// checkout — no separate POS-owned pricing master is created here, this
// reuses Sales' authoritative rule table and its exact adjustment
// semantics (discount_percent / discount_amount / fixed_rate, applied in
// priority order). A manual price override still bypasses all of this
// entirely, matching Sales' own manualOverride semantics.
export async function applyCustomerPricingRules(client, context, store, customerId, itemId, itemGroupId, quantity, listUnitPrice) {
  if (!customerId) return listUnitPrice;
  const rules = await client.query(
    `SELECT adjustment_type,adjustment_value FROM tenant.sales_pricing_rules
     WHERE organization_id=$1 AND status='active'
       AND party_id=$2 AND (party_type IS NULL OR party_type IN ('customer','both'))
       AND (item_id IS NULL OR item_id=$3)
       AND (item_group_id IS NULL OR item_group_id=$4)
       AND (price_list_id IS NULL OR price_list_id=$5)
       AND minimum_quantity<=$6
       AND (valid_from IS NULL OR valid_from<=current_date)
       AND (valid_to IS NULL OR valid_to>=current_date)
     ORDER BY priority,id`,
    [context.organizationId, customerId, itemId, itemGroupId, store.price_list_id, asDatabaseDecimal(quantity)],
  );
  let price = listUnitPrice;
  for (const rule of rules.rows) {
    const value = decimal(rule.adjustment_value);
    if (rule.adjustment_type === "discount_percent") price = sub(price, percent(price, value));
    else if (rule.adjustment_type === "discount_amount") price = max(0, sub(price, value));
    else if (rule.adjustment_type === "fixed_rate") price = value;
  }
  return price;
}

// The configured selling price of an item at this store (its price list, today, in the unit it is sold in), before customer rules; null
// when it has none. A price override's deviation is measured against it.
export async function resolveListUnitPrice(client, context, store, itemId, uomId = null) {
  if (!store.price_list_id) return null;
  try {
    const priceList = await resolveSalesPriceList(client, context, { priceListId: store.price_list_id, currencyCode: store.currency_code });
    const resolved = await resolveSalesPrice(client, context, { priceList, itemId, uomId });
    return resolved.missing ? null : decimal(resolved.listPrice);
  } catch {
    return null;
  }
}

// Returns { unitPrice, priceListId (null for an override), fromCustomerList }.
async function resolveUnitPrice(client, context, store, policy, line, item, customerId, customerList = null) {
  // A price override was authorized when it was entered (Cashier Permissions: PRICE_OVERRIDE, its limit and reason) and is checked again
  // at checkout; pricing only applies it. Tax is always recomputed from the overridden price.
  if (line.priceOverride) {
    const requested = decimal(line.unitPrice);
    if (requested < 0n) throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
    return { unitPrice: requested, priceListId: null, fromCustomerList: false };
  }
  // The customer's own price list first (Named Customer), when it prices this item in this unit.
  if (customerList) {
    const own = await resolveSalesPrice(client, context, { priceList: customerList.priceList, itemId: item.id, uomId: line.uomId || null });
    if (!own.missing) {
      const unitPrice = await applyCustomerPricingRules(client, context, { ...store, price_list_id: customerList.id }, customerId, item.id, item.group_id, decimal(line.quantity), decimal(own.listPrice));
      return { unitPrice, priceListId: customerList.id, fromCustomerList: true };
    }
  }
  if (!store.price_list_id) {
    throw posError(
      409,
      "The POS store requires an active sales price list before checkout. Configure a price list or use an authorized price override.",
      "POS_PRICE_LIST_REQUIRED",
    );
  }
  // The store's price list, through the same price resolver Sales uses: the
  // price valid today for the item, else no price.
  let priceList;
  try {
    priceList = await resolveSalesPriceList(client, context, { priceListId: store.price_list_id, currencyCode: store.currency_code });
  } catch {
    throw posError(409, "The store's price list is inactive, out of date or in another currency.", "POS_PRICE_LIST_REQUIRED");
  }
  // The price of the unit the line is sold in (a box is priced as a box, or as its pieces at the base unit's price).
  const resolved = await resolveSalesPrice(client, context, { priceList, itemId: item.id, uomId: line.uomId || null });
  if (resolved.missing) throw posError(409, resolved.message, "POS_PRICE_NOT_FOUND");
  const listUnitPrice = decimal(resolved.listPrice);
  const unitPrice = await applyCustomerPricingRules(client, context, store, customerId, item.id, item.group_id, decimal(line.quantity), listUnitPrice);
  return { unitPrice, priceListId: store.price_list_id, fromCustomerList: false };
}

export function normalizedDiscountAmount(discount, base, maxPercent, label) {
  if (!discount) return decimal(0);
  const type = discount.type === "percent" ? "percent" : discount.type === "amount" ? "amount" : null;
  if (!type) throw posError(400, `${label} discount type must be "percent" or "amount".`, "POS_DISCOUNT_TYPE_INVALID");
  const value = decimal(discount.value);
  if (value < 0n) throw posError(400, `${label} discount value cannot be negative.`, "POS_DISCOUNT_INVALID");
  if (type === "percent") {
    if (value > decimal(100)) throw posError(400, `${label} discount percent cannot exceed 100.`, "POS_DISCOUNT_INVALID");
    if (value > decimal(maxPercent)) {
      throw posError(409, `${label} discount exceeds the configured policy limit of ${maxPercent}%.`, "POS_DISCOUNT_POLICY_EXCEEDED");
    }
    return percent(base, value);
  }
  const percentOfBase = base === 0n ? decimal(0) : mul(div(value, base), 100);
  if (percentOfBase > decimal(maxPercent)) {
    throw posError(409, `${label} discount exceeds the configured policy limit of ${maxPercent}%.`, "POS_DISCOUNT_POLICY_EXCEEDED");
  }
  return min(value, base);
}

// F280: deterministic promotion evaluation. Ordered by priority then id
// (never SQL/object-iteration order) so the same configuration always
// produces the same result for the same cart snapshot. Only one
// "exclusive" promotion may apply to a given cart; non-stackable
// promotions stop after the first eligible one is applied per line.
async function evaluatePromotions(client, context, store, customerId, lines, cartSubtotal) {
  const promotions = await client.query(
    `SELECT * FROM tenant.pos_promotions
     WHERE organization_id=$1 AND status='active' AND (store_id IS NULL OR store_id=$2)
       AND (effective_from IS NULL OR effective_from<=current_date)
       AND (effective_to IS NULL OR effective_to>=current_date)
       AND (usage_limit_total IS NULL OR usage_count<usage_limit_total)
     ORDER BY priority ASC,id ASC`,
    [context.organizationId, store.id],
  );

  const applications = [];
  const explanations = [];
  let exclusiveApplied = false;
  const lineDiscounts = new Map(lines.map((line) => [line.lineNumber, decimal(0)]));

  for (const promotion of promotions.rows) {
    if (exclusiveApplied) {
      explanations.push({ code: promotion.code, applied: false, reason: "Another exclusive promotion already applied to this cart." });
      continue;
    }
    if (promotion.eligible_customer_ids.length && (!customerId || !promotion.eligible_customer_ids.includes(customerId))) {
      explanations.push({ code: promotion.code, applied: false, reason: "This customer is not eligible for this promotion." });
      continue;
    }
    // F280: usage_limit_per_customer (migration 113) is enforced: checked here (preview) and
    // re-checked under lock at commit time (commitPosPromotionApplications
    // in promotions.js), the same two-layer pattern coupons already use.
    if (customerId && promotion.usage_limit_per_customer != null) {
      const perCustomer = await client.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications
         WHERE organization_id=$1 AND promotion_id=$2 AND customer_id=$3`,
        [context.organizationId, promotion.id, customerId],
      );
      if (Number(perCustomer.rows[0].count) >= promotion.usage_limit_per_customer) {
        explanations.push({ code: promotion.code, applied: false, reason: "This customer already reached this promotion's usage limit." });
        continue;
      }
    }
    // Matrix item #18 (per-store half): usage_limit_per_store (migration
    // 118) follows the exact same preview-check/commit-recheck pattern as
    // usage_limit_per_customer just above, counted from the same
    // pos_promotion_applications evidence table (now carrying store_id --
    // see commitPosPromotionApplications in promotions.js) rather than a
    // separate counter column.
    if (promotion.usage_limit_per_store != null) {
      const perStore = await client.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications
         WHERE organization_id=$1 AND promotion_id=$2 AND store_id=$3`,
        [context.organizationId, promotion.id, store.id],
      );
      if (Number(perStore.rows[0].count) >= promotion.usage_limit_per_store) {
        explanations.push({ code: promotion.code, applied: false, reason: "This store already reached this promotion's usage limit." });
        continue;
      }
    }
    if (promotion.min_basket_amount != null && cartSubtotal < decimal(promotion.min_basket_amount)) {
      explanations.push({ code: promotion.code, applied: false, reason: `Basket must reach ${promotion.min_basket_amount} to qualify.` });
      continue;
    }
    const eligibleLines = lines.filter((line) => {
      if (line.promotionLocked) return false;
      if (promotion.eligible_item_ids.length && !promotion.eligible_item_ids.includes(line.itemId)) return false;
      if (promotion.eligible_item_group_ids.length && !promotion.eligible_item_group_ids.includes(line.itemGroupId)) return false;
      if (promotion.min_quantity != null && decimal(line.quantity) < decimal(promotion.min_quantity)) return false;
      return true;
    });
    if (!eligibleLines.length) {
      explanations.push({ code: promotion.code, applied: false, reason: "No eligible items in the cart for this promotion." });
      continue;
    }
    let promotionTotal = decimal(0);
    for (const line of eligibleLines) {
      const netSoFar = sub(sub(line.grossAmount, line.manualDiscountAmount), lineDiscounts.get(line.lineNumber));
      if (netSoFar <= 0n) continue;
      let amount =
        promotion.discount_type === "percent" ? percent(netSoFar, decimal(promotion.discount_value)) : min(decimal(promotion.discount_value), netSoFar);
      if (promotion.max_discount_amount != null) amount = min(amount, decimal(promotion.max_discount_amount));
      lineDiscounts.set(line.lineNumber, add(lineDiscounts.get(line.lineNumber), amount));
      promotionTotal = add(promotionTotal, amount);
      // `amount` above is the raw BigInt-scaled decimal.js value, still
      // needed in that form for the add()/min() arithmetic on lines 266-268
      // -- but this `applications` entry is DB-bound (commitPosPromotionApplications
      // in promotions.js inserts `.amount` straight into pos_promotion_applications.
      // discount_amount), so it must cross that boundary already descaled,
      // same as every other DB-bound field in this module. Left raw, a
      // 10% discount on 500 was stored -- and receipted -- as 50,000,000
      // instead of 50.00 (decimal.js's SCALE is 1e6).
      applications.push({ promotionId: promotion.id, code: promotion.code, lineNumber: line.lineNumber, amount: asDatabaseDecimal(amount) });
    }
    if (promotionTotal > 0n) {
      explanations.push({ code: promotion.code, applied: true, amountSaved: asDatabaseDecimal(promotionTotal), reason: promotion.name });
      if (promotion.exclusive) exclusiveApplied = true;
      if (!promotion.stackable) {
        // A non-stackable promotion still allows OTHER exclusive/priority
        // rules to be evaluated for lines it did not touch, but no other
        // promotion may touch the SAME lines it already discounted.
        for (const line of eligibleLines) line.promotionLocked = true;
      }
    } else {
      explanations.push({ code: promotion.code, applied: false, reason: "Promotion evaluated but produced no discount for this cart." });
    }
  }
  return { lineDiscounts, applications, explanations };
}

// F281: validate + price a coupon against the cart WITHOUT committing a
// redemption. Committing (incrementing committed_count, flipping the
// reservation to 'committed') only happens inside cart-completion's own
// transaction, under the coupon row's own lock -- see coupons.js.
async function evaluateCoupon(client, context, store, customerId, lines, cartSubtotalAfterOtherDiscounts, couponCode) {
  if (!couponCode) return { coupon: null, lineDiscounts: new Map(), amount: decimal(0) };
  const normalized = String(couponCode).trim().toUpperCase();
  const result = await client.query(
    `SELECT * FROM tenant.pos_coupons
     WHERE organization_id=$1 AND upper(code)=$2 AND status='active' AND (store_id IS NULL OR store_id=$3)
       AND (effective_from IS NULL OR effective_from<=current_date)
       AND (effective_to IS NULL OR effective_to>=current_date)`,
    [context.organizationId, normalized, store.id],
  );
  const coupon = result.rows[0];
  if (!coupon) throw posError(404, "Coupon code is invalid, inactive or expired.", "POS_COUPON_NOT_FOUND");
  if (coupon.usage_limit_total != null && coupon.committed_count >= coupon.usage_limit_total) {
    throw posError(409, "This coupon has reached its usage limit.", "POS_COUPON_USAGE_LIMIT_REACHED");
  }
  if (coupon.eligible_customer_ids.length && (!customerId || !coupon.eligible_customer_ids.includes(customerId))) {
    throw posError(409, "This coupon is not valid for the selected customer.", "POS_COUPON_CUSTOMER_INELIGIBLE");
  }
  if (coupon.min_basket_amount != null && cartSubtotalAfterOtherDiscounts < decimal(coupon.min_basket_amount)) {
    throw posError(409, `Basket must reach ${coupon.min_basket_amount} to use this coupon.`, "POS_COUPON_MIN_BASKET_NOT_MET");
  }
  if (customerId && coupon.usage_limit_per_customer != null) {
    const perCustomer = await client.query(
      `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions
       WHERE organization_id=$1 AND coupon_id=$2 AND customer_id=$3 AND status='committed'`,
      [context.organizationId, coupon.id, customerId],
    );
    if (Number(perCustomer.rows[0].count) >= coupon.usage_limit_per_customer) {
      throw posError(409, "This customer has already used this coupon the maximum number of times.", "POS_COUPON_CUSTOMER_LIMIT_REACHED");
    }
  }
  // Matrix item #18 (per-store half): same pattern as the per-customer
  // check above, counted from pos_coupon_redemptions' committed rows now
  // carrying store_id (migration 118) -- see applyPosCartCoupon in
  // cart.js, which stamps store_id onto the reservation at attach time.
  if (coupon.usage_limit_per_store != null) {
    const perStore = await client.query(
      `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions
       WHERE organization_id=$1 AND coupon_id=$2 AND store_id=$3 AND status='committed'`,
      [context.organizationId, coupon.id, store.id],
    );
    if (Number(perStore.rows[0].count) >= coupon.usage_limit_per_store) {
      throw posError(409, "This store has already used this coupon the maximum number of times.", "POS_COUPON_STORE_LIMIT_REACHED");
    }
  }
  const eligibleLines = coupon.eligible_item_ids.length ? lines.filter((line) => coupon.eligible_item_ids.includes(line.itemId)) : lines;
  if (!eligibleLines.length) throw posError(409, "No items in the cart are eligible for this coupon.", "POS_COUPON_NO_ELIGIBLE_ITEMS");
  const lineDiscounts = new Map(lines.map((line) => [line.lineNumber, decimal(0)]));
  const eligibleBase = eligibleLines.reduce(
    (sum, line) => add(sum, max(0, sub(sub(line.grossAmount, line.manualDiscountAmount), lineDiscounts.get(line.lineNumber) || decimal(0)))),
    decimal(0),
  );
  let totalAmount =
    coupon.discount_type === "percent" ? percent(eligibleBase, decimal(coupon.discount_value)) : min(decimal(coupon.discount_value), eligibleBase);
  if (coupon.max_discount_amount != null) totalAmount = min(totalAmount, decimal(coupon.max_discount_amount));
  if (totalAmount > 0n && eligibleBase > 0n) {
    const weights = eligibleLines.map((line) => max(0, sub(line.grossAmount, line.manualDiscountAmount)));
    const shares = allocate(totalAmount, weights.map(asDatabaseDecimal));
    eligibleLines.forEach((line, index) => lineDiscounts.set(line.lineNumber, shares[index]));
  }
  return { coupon, lineDiscounts, amount: totalAmount };
}

// F306: evaluate a REQUESTED loyalty-point redemption against the cart's
// current post-cart-discount, pre-tax base. Re-validates eligibility
// (min/max/balance) on every call — see requirePosLoyaltyRedemptionEligible's
// comment for why this alone is only ever a PREVIEW check, never the
// authoritative one (that's commitPosLoyaltyForSale's row-locked recheck
// at actual sale completion).
//
// BUG FIX (found via this session's own real-Postgres test run, never
// caught before because this uncommitted work's own test suite had never
// been run against it): the active program must be resolved whenever a
// customer is attached, REGARDLESS of whether a redemption was requested
// -- earning points is the common case and must not depend on the
// customer simultaneously redeeming in the same transaction. Only the
// eligibility/amount computation below is skipped when no redemption is
// requested; `program` (used by computePosLoyaltyEarnPoints for every
// line, further down in priceCartLines) is resolved unconditionally for
// any customer.
async function evaluatePosLoyaltyRedemption(client, context, customerId, requestedPoints, remainingBase) {
  if (!customerId) {
    return { program: null, balanceBefore: decimal(0), pointsApplied: decimal(0), amount: decimal(0) };
  }
  const program = await resolveActivePosLoyaltyProgram(client, context);
  if (!requestedPoints || decimal(requestedPoints) <= 0n) {
    return { program, balanceBefore: decimal(0), pointsApplied: decimal(0), amount: decimal(0) };
  }
  const balanceBefore = await getPosLoyaltyBalanceValue(client, context, customerId);
  const eligiblePoints = requirePosLoyaltyRedemptionEligible(program, balanceBefore, requestedPoints);
  const { pointsApplied, amount } = computePosLoyaltyRedemption(program, eligiblePoints, remainingBase);
  return { program, balanceBefore, pointsApplied, amount };
}

// The single authoritative pricing pipeline. `lines` input shape:
// Item Discounts (migration 0090): each line's manual discount, after the automatic promotions, under the company's stacking rule —
//   non_stackable (default)     a line with a promotion takes no manual discount: the conflict is reported, the manual discount not applied
//   manual_replaces_automatic   the manual discount replaces the promotion on that line
//   stackable                   the manual discount applies to what is left after the promotion
// A percentage is of that base and follows quantity changes; a fixed amount is for the whole line and stays fixed. Nothing is clamped
// silently: a discount the product does not allow, above the line, above the product's largest percentage, below its lowest price, or a
// 100% discount the company does not allow, is reported on the line (discountIssues) — a new discount is refused for it and checkout stops.
export const POS_ITEM_DISCOUNT_MESSAGES = Object.freeze({
  POS_ITEM_DISCOUNT_NOT_ALLOWED: "Discount is not allowed for this product.",
  POS_ITEM_DISCOUNT_PERMISSION_DENIED: "You cannot apply Item Discounts.",
  POS_ITEM_DISCOUNT_PERCENT_INVALID: "Enter a valid discount percentage.",
  POS_ITEM_DISCOUNT_AMOUNT_INVALID: "Enter a valid discount amount.",
  POS_ITEM_DISCOUNT_PERCENT_LIMIT: "Discount exceeds your percentage limit.",
  POS_ITEM_DISCOUNT_AMOUNT_LIMIT: "Discount exceeds your amount limit.",
  POS_ITEM_DISCOUNT_AGGREGATE_LIMIT: "Total discounts exceed your permitted limit.",
  POS_ITEM_DISCOUNT_EXCEEDS_VALUE: "Discount cannot exceed the eligible item value.",
  POS_ITEM_DISCOUNT_MIN_PRICE_VIOLATION: "Discount is below the allowed selling price.",
  POS_ITEM_DISCOUNT_STACKING_CONFLICT: "This discount cannot be combined with the existing offer.",
  POS_ITEM_DISCOUNT_APPROVAL_REQUIRED: "Supervisor approval is required.",
  POS_ITEM_DISCOUNT_APPROVAL_EXPIRED: "Approval expired. Request it again.",
  POS_ITEM_DISCOUNT_APPROVAL_INVALID: "Approval no longer matches this bill.",
  POS_ITEM_DISCOUNT_PRICE_CHANGED: "Item price changed. Review the discount.",
  POS_ITEM_DISCOUNT_QUANTITY_CHANGED: "Quantity changed. Review the discount.",
  POS_ITEM_DISCOUNT_TAX_FAILED: "Tax could not be calculated.",
  POS_ITEM_DISCOUNT_VERSION_CONFLICT: "This bill changed. Refresh and try again.",
  POS_ITEM_DISCOUNT_REASON_REQUIRED: "Choose a reason for this discount.",
  POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT: "This line has a price override. Remove it before discounting the line.",
});

function resolveManualLineDiscounts(priced, promotionResult, policy, decimalPlaces) {
  const stacking = policy.manual_discount_stacking ?? "non_stackable";
  const issue = (line, code, detail = null) => line.discountIssues.push({ code, message: detail ? `${line.description}: ${detail}` : `${line.description}: ${POS_ITEM_DISCOUNT_MESSAGES[code]}`, lineNumber: line.lineNumber });
  for (const line of priced) {
    const request = line.manualRequest;
    if (!request) continue;
    let promotion = promotionResult.lineDiscounts.get(line.lineNumber) || decimal(0);
    if (promotion > 0n && stacking === "manual_replaces_automatic") {
      promotionResult.lineDiscounts.set(line.lineNumber, decimal(0));
      promotionResult.applications = promotionResult.applications.filter((application) => application.lineNumber !== line.lineNumber);
      promotion = decimal(0);
    }
    if (promotion > 0n && stacking === "non_stackable") {
      issue(line, "POS_ITEM_DISCOUNT_STACKING_CONFLICT", "a promotion already applies to this line and the two cannot be combined. Remove the manual discount.");
      continue;
    }
    const base = sub(line.grossAmount, promotion);
    const value = decimal(request.value);
    if (line.priceOverride) issue(line, "POS_ITEM_DISCOUNT_OVERRIDE_CONFLICT");
    if (!line.discountPolicy.allowed) issue(line, "POS_ITEM_DISCOUNT_NOT_ALLOWED", `manual discounts are not allowed for this ${line.discountPolicy.blockedBy ?? "product"}.`);
    let amount;
    if (line.manualDiscountType === "percent") {
      if (value > decimal(100) || (value === decimal(100) && !policy.allow_full_line_discount))
        issue(line, "POS_ITEM_DISCOUNT_PERCENT_INVALID", value > decimal(100) ? "a discount cannot be more than 100%." : "this company does not allow a line to be discounted in full.");
      amount = roundMoney(percent(base, min(value, decimal(100))), decimalPlaces);
    } else {
      amount = value;
      if (amount > base) { issue(line, "POS_ITEM_DISCOUNT_EXCEEDS_VALUE", `the discount (${asDatabaseDecimal(amount)}) is more than the line's value (${asDatabaseDecimal(base)}).`); amount = base; }
      else if (amount === base && !policy.allow_full_line_discount) issue(line, "POS_ITEM_DISCOUNT_AMOUNT_INVALID", "this company does not allow a line to be discounted in full.");
    }
    const maxPercent = line.discountPolicy.maxPercent;
    if (maxPercent !== null && line.grossAmount > 0n && div(mul(amount, decimal(100)), line.grossAmount) > maxPercent)
      issue(line, "POS_ITEM_DISCOUNT_NOT_ALLOWED", `at most ${asDatabaseDecimal(maxPercent).replace(/\.?0+$/, "")}% may be taken off this product.`);
    const minPrice = line.discountPolicy.minSellingPrice;
    if (minPrice !== null && line.baseQuantity > 0n && div(sub(base, amount), line.baseQuantity) < minPrice)
      issue(line, "POS_ITEM_DISCOUNT_MIN_PRICE_VIOLATION", `it would sell below the lowest allowed price of ${asDatabaseDecimal(minPrice).replace(/\.?0+$/, "")} a unit.`);
    line.manualDiscountAmount = amount;
  }
}

// Cart Discounts (migration 0091): one bill discount — a percentage of the eligible value, or a fixed amount off it — allocated across the
// eligible lines. A line is left out (with the reason shown to the cashier) when the product takes no manual discounts, the price was
// overridden, it has a promotion (combined only when the company's rule is "stackable"; a bill discount never replaces an offer), it has an
// item discount and the rule is "non-stackable", or nothing is left to discount. Each line can take at most what keeps it within the
// product's largest percentage and above its lowest price. The amount is shared in proportion to each line's remaining value, in whole
// paise: a line that reaches its limit keeps its limit and the rest goes to the others; leftover paise go to the largest remainders, ties by
// line. The shares always add up to the discount exactly. Nothing is reduced silently: a discount above the eligible value, one that cannot
// be shared without breaking a product's limits, or a bill with nothing eligible is reported (issues) and not applied — checkout stops.
export const POS_CART_DISCOUNT_MESSAGES = Object.freeze({
  POS_CART_DISCOUNT_NOT_ALLOWED: "Cart Discount is not allowed for this bill.",
  POS_CART_DISCOUNT_PERMISSION_DENIED: "You cannot apply Cart Discounts.",
  POS_CART_DISCOUNT_PERCENT_INVALID: "Enter a valid discount percentage.",
  POS_CART_DISCOUNT_AMOUNT_INVALID: "Enter a valid discount amount.",
  POS_CART_DISCOUNT_PERCENT_LIMIT: "Discount exceeds your percentage limit.",
  POS_CART_DISCOUNT_AMOUNT_LIMIT: "Discount exceeds your amount limit.",
  POS_CART_DISCOUNT_AGGREGATE_LIMIT: "Total discounts exceed your permitted limit.",
  POS_CART_DISCOUNT_NO_ELIGIBLE_ITEMS: "No products in this bill qualify for a Cart Discount.",
  POS_CART_DISCOUNT_EXCEEDS_ELIGIBLE_VALUE: "Discount exceeds the eligible bill amount.",
  POS_CART_DISCOUNT_MIN_PRICE_VIOLATION: "Discount would reduce a product below its allowed price.",
  POS_CART_DISCOUNT_STACKING_CONFLICT: "This discount cannot be combined with an existing offer.",
  POS_CART_DISCOUNT_ALLOCATION_FAILED: "Discount could not be distributed correctly.",
  POS_CART_DISCOUNT_APPROVAL_REQUIRED: "Supervisor approval is required.",
  POS_CART_DISCOUNT_APPROVAL_EXPIRED: "Approval expired. Request it again.",
  POS_CART_DISCOUNT_APPROVAL_INVALID: "Approval no longer matches this bill.",
  POS_CART_DISCOUNT_REVALIDATION_REQUIRED: "The bill changed. Please review the discount.",
  POS_CART_DISCOUNT_TAX_FAILED: "Tax could not be calculated.",
  POS_CART_DISCOUNT_VERSION_CONFLICT: "This bill changed. Refresh and try again.",
  POS_CART_DISCOUNT_ZERO_TOTAL_NOT_ALLOWED: "This bill cannot be completed with a zero total.",
  POS_CART_DISCOUNT_REASON_REQUIRED: "Choose a reason for this discount.",
});
export const POS_CART_DISCOUNT_EXCLUSIONS = Object.freeze({
  product: "Discounts are not allowed for this product.",
  price_override: "The price of this line was changed.",
  offer: "It already has an offer that cannot be combined.",
  item_discount: "It already has an item discount that cannot be combined.",
  nothing_left: "Nothing is left to discount.",
  product_limit: "It is already at this product's discount limit.",
  min_price: "It is already at its lowest allowed price.",
});

// Share totalUnits in proportion to each entry's weight without going above its cap (all in whole minor units). Returns the shares and
// whatever could not be placed.
function allocateCapped(totalUnits, entries) {
  const shares = new Map(entries.map((entry) => [entry.key, 0n]));
  let open = entries.filter((entry) => entry.capUnits > 0n && entry.weight > 0n);
  let left = totalUnits;
  while (open.length && left > 0n) {
    const weight = open.reduce((sum, entry) => sum + entry.weight, 0n);
    // Lines whose proportional share reaches their cap take the cap; the rest is shared again among the others.
    const capped = open.filter((entry) => left * entry.weight >= entry.capUnits * weight);
    if (capped.length) {
      for (const entry of capped) { shares.set(entry.key, entry.capUnits); left -= entry.capUnits; }
      open = open.filter((entry) => !capped.includes(entry));
      continue;
    }
    const exact = open.map((entry) => ({ entry, floor: (left * entry.weight) / weight, remainder: (left * entry.weight) % weight }));
    let rest = left - exact.reduce((sum, share) => sum + share.floor, 0n);
    exact.sort((a, b) => (a.remainder === b.remainder ? (a.entry.key < b.entry.key ? -1 : 1) : a.remainder > b.remainder ? -1 : 1));
    for (const share of exact) {
      const extra = rest > 0n ? 1n : 0n;
      rest -= extra;
      shares.set(share.entry.key, share.floor + extra);
    }
    left = 0n;
  }
  return { shares, unallocated: left };
}

function resolveCartDiscount(priced, cartDiscount, policy, decimalPlaces) {
  const stacking = policy.manual_discount_stacking ?? "non_stackable";
  const unit = 10n ** BigInt(Math.max(0, 6 - decimalPlaces));
  const summary = { type: null, value: null, eligibleBase: decimal(0), excludedBase: decimal(0), amount: decimal(0), excluded: [], allocations: [], issues: [], fingerprint: null };
  const entries = [];
  for (const line of priced) {
    line.cartDiscountAmount = decimal(0);
    const remaining = max(0, sub(sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount), line.couponDiscountAmount));
    const product = line.discountPolicy;
    let cap = remaining;
    if (product.productMaxPercent !== null && product.productMaxPercent !== undefined)
      cap = min(cap, max(0, sub(div(mul(line.grossAmount, product.productMaxPercent), decimal(100)), line.manualDiscountAmount)));
    const capByLimit = cap;
    if (product.minSellingPrice !== null && product.minSellingPrice !== undefined) cap = min(cap, max(0, sub(remaining, mul(product.minSellingPrice, line.baseQuantity))));
    const reason = !product.allowed ? "product"
      : line.priceOverride ? "price_override"
        : line.promotionDiscountAmount > 0n && stacking !== "stackable" ? "offer"
          : line.manualDiscountAmount > 0n && stacking === "non_stackable" ? "item_discount"
            : remaining <= 0n ? "nothing_left"
              : capByLimit < unit ? "product_limit"
                : cap < unit ? "min_price" : null;
    line.cartDiscountBase = reason ? decimal(0) : remaining;
    line.cartDiscountExcludedReason = reason;
    if (reason) {
      summary.excludedBase = add(summary.excludedBase, remaining);
      summary.excluded.push({ lineNumber: line.lineNumber, lineId: line.lineId, description: line.description, reason, message: POS_CART_DISCOUNT_EXCLUSIONS[reason], value: remaining });
      continue;
    }
    summary.eligibleBase = add(summary.eligibleBase, remaining);
    entries.push({ line, key: String(line.lineId ?? String(line.lineNumber).padStart(6, "0")), weight: remaining, capUnits: cap / unit });
  }
  if (!cartDiscount || !cartDiscount.type || decimal(cartDiscount.value ?? 0) <= 0n) return summary;
  const type = cartDiscount.type === "percent" ? "percent" : "amount";
  const value = decimal(cartDiscount.value);
  summary.type = type;
  summary.value = value;
  const issue = (code, message = POS_CART_DISCOUNT_MESSAGES[code]) => summary.issues.push({ code, message });
  const eligible = summary.eligibleBase;
  if (eligible <= 0n) { issue("POS_CART_DISCOUNT_NO_ELIGIBLE_ITEMS"); return summary; }
  let amount;
  if (type === "percent") {
    if (value > decimal(100)) issue("POS_CART_DISCOUNT_PERCENT_INVALID", "A discount cannot be more than 100%.");
    else if (value === decimal(100) && !policy.allow_full_line_discount) issue("POS_CART_DISCOUNT_PERCENT_INVALID", "This company does not allow a bill to be discounted in full.");
    amount = roundMoney(percent(eligible, min(value, decimal(100))), decimalPlaces);
  } else {
    amount = value;
    if (roundMoney(value, decimalPlaces) !== value) issue("POS_CART_DISCOUNT_AMOUNT_INVALID", `Use at most ${decimalPlaces} decimal places.`);
    else if (value > eligible) issue("POS_CART_DISCOUNT_EXCEEDS_ELIGIBLE_VALUE", `The discount (${asDatabaseDecimal(value)}) is more than the eligible bill amount (${asDatabaseDecimal(eligible)}). Change or remove it.`);
    else if (value === eligible && !policy.allow_full_line_discount) issue("POS_CART_DISCOUNT_AMOUNT_INVALID", "This company does not allow a bill to be discounted in full.");
  }
  const companyMax = policy.max_cart_discount_percent === null || policy.max_cart_discount_percent === undefined ? null : decimal(policy.max_cart_discount_percent);
  if (!summary.issues.length && companyMax !== null && div(mul(amount, decimal(100)), eligible) > companyMax)
    issue("POS_CART_DISCOUNT_NOT_ALLOWED", `At most ${asDatabaseDecimal(companyMax).replace(/\.?0+$/, "")}% may be taken off a bill.`);
  if (summary.issues.length) return summary;
  const { shares, unallocated } = allocateCapped(amount / unit, entries);
  if (unallocated > 0n) {
    const room = entries.reduce((sum, entry) => sum + entry.capUnits, 0n) * unit;
    issue("POS_CART_DISCOUNT_MIN_PRICE_VIOLATION", `At most ${asDatabaseDecimal(room)} can be taken off this bill without a product going below its allowed price or discount limit.`);
    return summary;
  }
  for (const entry of entries) {
    entry.line.cartDiscountAmount = shares.get(entry.key) * unit;
    summary.allocations.push({ lineNumber: entry.line.lineNumber, lineId: entry.line.lineId, eligibleBase: entry.weight, amount: entry.line.cartDiscountAmount });
  }
  const allocated = priced.reduce((sum, line) => add(sum, line.cartDiscountAmount), decimal(0));
  if (allocated !== amount) {
    for (const line of priced) line.cartDiscountAmount = decimal(0);
    summary.allocations = [];
    issue("POS_CART_DISCOUNT_ALLOCATION_FAILED");
    return summary;
  }
  summary.amount = amount;
  summary.fingerprint = createHash("sha256").update(JSON.stringify([type, asDatabaseDecimal(value), asDatabaseDecimal(amount),
    priced.map((line) => [line.lineId ?? line.lineNumber, line.itemId, asDatabaseDecimal(line.quantity), asDatabaseDecimal(line.cartDiscountBase), asDatabaseDecimal(line.cartDiscountAmount)])]))
    .digest("hex").slice(0, 32);
  return summary;
}

// [{ itemId, quantity, unitPrice?, priceOverride?,
//    warehouseId?, warehouseLocationId?, batchId?, serialId?,
//    manualDiscount?: {type,value,reason} }]
export async function priceCartLines(client, context, {
  store, policy, customerId, billingAddressId = null, supplyMode = "in_store", deliveryStateCode = null, lines, cartDiscount, couponCode, loyaltyRedeemPoints, expectedTotals,
} = {}) {
  if (!Array.isArray(lines) || !lines.length) {
    throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");
  }
  if (lines.length > 200) {
    throw posError(400, "A POS cart cannot contain more than 200 lines.", "POS_CART_LINE_LIMIT_EXCEEDED");
  }
  const decimalPlaces = await resolveCurrencyDecimalPlaces(client, context, store.currency_code);
  const supply = await resolvePosSupplyContext(client, context, { storeId: store.id, customerId, billingAddressId, supplyMode, deliveryStateCode });
  const taxInclusive = await resolvePriceListTaxInclusive(client, context, store.price_list_id);
  const customerList = await resolveCustomerPriceList(client, context, customerId, store);

  const priced = [];
  let lineNumber = 0;
  for (const rawLine of lines) {
    lineNumber += 1;
    const quantity = decimal(rawLine.quantity);
    if (quantity <= 0n) throw posError(400, "POS sale quantity must be greater than zero.", "POS_SALE_QUANTITY_INVALID");
    const item = await resolveSaleItem(client, context, rawLine.itemId, rawLine.variantId || null);
    const taxDecision = await resolvePosLineTax(client, supply, item);
    const resolvedPrice = await resolveUnitPrice(client, context, store, policy, { ...rawLine, quantity: asDatabaseDecimal(quantity) }, item, customerId, customerList);
    const unitPrice = resolvedPrice.unitPrice;
    const listPrice = unitPrice;
    const grossAmount = roundMoney(mul(quantity, unitPrice), decimalPlaces);
    // The manual discount is resolved after the automatic promotions (see below); here only who may ask for it is checked.
    const manualRequest = rawLine.manualDiscount && decimal(rawLine.manualDiscount.value ?? 0) > 0n ? rawLine.manualDiscount : null;
    const manualDiscountAmount = decimal(0);
    if (manualRequest && !manualRequest.alreadyAuthorized) {
      if (!context.permissions?.includes("pos.discount.apply") && !context.roleSlugs?.includes("organization_owner")) {
        const error = new Error("Missing permission: pos.discount.apply");
        error.code = "FORBIDDEN";
        throw error;
      }
      if (!rawLine.manualDiscount.reason || !String(rawLine.manualDiscount.reason).trim()) {
        throw posError(400, `Line ${lineNumber} discount requires a reason.`, "POS_DISCOUNT_REASON_REQUIRED");
      }
    }
    const uomFactor = decimal(rawLine.uomFactor ?? 1);
    priced.push({
      lineNumber,
      lineId: rawLine.lineId ?? null,
      itemId: item.id,
      // The unit sold, its factor and the base quantity stock moves (a box of 12 issues 12 pieces).
      uomId: rawLine.uomId || item.uom_id,
      // Snapshots for the receipt: the barcode the line was scanned with and the SKU it was sold under.
      scannedBarcode: rawLine.scannedBarcode ?? null,
      sku: item.code,
      uomFactor,
      baseQuantity: mul(quantity, uomFactor),
      itemGroupId: item.group_id || null,
      description: rawLine.description || item.name,
      quantity,
      listPrice,
      unitPrice,
      priceOverride: Boolean(rawLine.priceOverride),
      grossAmount,
      manualDiscountAmount,
      manualDiscountReason: manualRequest ? String(manualRequest.reason ?? "").trim() || null : null,
      manualRequest,
      manualDiscountType: manualRequest ? (manualRequest.type === "percent" ? "percent" : "amount") : null,
      manualDiscountValue: manualRequest ? decimal(manualRequest.value) : null,
      discountIssues: [],
      // The product's discount policy: allowed (item and category), the largest percentage (item, category, company — the strictest), and
      // the lowest price a base unit may be sold at after discounts.
      discountPolicy: {
        allowed: item.manual_discount_allowed !== false && item.group_manual_discount_allowed !== false,
        blockedBy: item.manual_discount_allowed === false ? "product" : item.group_manual_discount_allowed === false ? `category ${item.group_name ?? ""}`.trim() : null,
        maxPercent: [item.max_manual_discount_percent, item.group_max_manual_discount_percent, policy.max_line_discount_percent]
          .filter((value) => value !== null && value !== undefined).map((value) => decimal(value)).reduce((low, value) => (low === null || value < low ? value : low), null),
        // The product's own largest percentage (item and category, not the company's line limit): what all manual discounts on it may reach.
        productMaxPercent: [item.max_manual_discount_percent, item.group_max_manual_discount_percent]
          .filter((value) => value !== null && value !== undefined).map((value) => decimal(value)).reduce((low, value) => (low === null || value < low ? value : low), null),
        minSellingPrice: item.min_selling_price === null || item.min_selling_price === undefined ? null : decimal(item.min_selling_price),
      },
      promotionDiscountAmount: decimal(0),
      couponDiscountAmount: decimal(0),
      cartDiscountAmount: decimal(0),
      loyaltyRedeemAmount: decimal(0),
      loyaltyRedeemPoints: decimal(0),
      loyaltyPointsEarned: decimal(0),
      warehouseId: rawLine.warehouseId || store.warehouse_id,
      warehouseLocationId: rawLine.warehouseLocationId || null,
      batchId: rawLine.batchId || null,
      serialId: rawLine.serialId || null,
      // F295: surfaced so the checkout UI can require a serial/batch
      // BEFORE completion is attempted, not just discover the requirement
      // from postStockMovement's hard rejection at checkout time. Not
      // persisted on tenant.pos_cart_lines -- it is always derivable from
      // the item master, never mutable cart state.
      trackingType: item.tracking_type || "none",
      taxCategoryId: item.tax_category_id,
      standardCost: decimal(item.standard_cost || 0),
      // The price list this line's price came from; its own tax-inclusive setting decides how tax is worked out.
      priceListId: resolvedPrice.priceListId,
      taxInclusive: resolvedPrice.fromCustomerList ? customerList.taxInclusive : taxInclusive,
      // The engine's tax decision for this line, and what the sale keeps of it.
      taxDecision,
      taxClassification: taxDecision.classification,
      hsnSac: taxDecision.hsnSac,
      taxCategoryCode: taxDecision.categoryCode ?? null,
      taxRateId: taxDecision.rateId ?? null,
      taxRatePercent: add(taxDecision.rate ?? decimal(0), taxDecision.cessRate ?? decimal(0)),
      placeOfSupply: taxDecision.placeOfSupply ?? null,
    });
    priced[priced.length - 1].taxCategoryId = taxDecision.categoryId ?? item.tax_category_id;
  }

  const cartSubtotal = priced.reduce((sum, line) => add(sum, line.grossAmount), decimal(0));

  const promotionResult = await evaluatePromotions(client, context, store, customerId, priced, cartSubtotal);
  resolveManualLineDiscounts(priced, promotionResult, policy, decimalPlaces);
  for (const line of priced) line.promotionDiscountAmount = promotionResult.lineDiscounts.get(line.lineNumber) || decimal(0);

  const afterPromotionSubtotal = priced.reduce(
    (sum, line) => add(sum, max(0, sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount))),
    decimal(0),
  );
  const couponResult = await evaluateCoupon(client, context, store, customerId, priced, afterPromotionSubtotal, couponCode);
  for (const line of priced) line.couponDiscountAmount = couponResult.lineDiscounts.get(line.lineNumber) || decimal(0);

  // Cart Discounts (0091): the bill discount on what is left of each eligible line, after promotions, item discounts and coupons.
  const cartDiscountSummary = resolveCartDiscount(priced, cartDiscount, policy, decimalPlaces);
  const cartDiscountTotal = cartDiscountSummary.amount;

  // F306: loyalty redemption, allocated proportionally across lines by
  // each line's remaining (post manual/promotion/coupon/cart-discount)
  // amount, using the exact same allocate() pattern as the cart-level
  // discount just above -- see loyalty.js's BUSINESS RULE 2 for why this
  // reduces the taxable base BEFORE tax, consistently with every other
  // POS discount layer.
  const preLoyaltyAmounts = priced.map((line) =>
    max(0, sub(sub(sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount), line.couponDiscountAmount), line.cartDiscountAmount)),
  );
  const preLoyaltySubtotal = preLoyaltyAmounts.reduce((sum, amount) => add(sum, amount), decimal(0));
  const loyaltyResult = await evaluatePosLoyaltyRedemption(client, context, customerId, loyaltyRedeemPoints, preLoyaltySubtotal);
  if (loyaltyResult.amount > 0n) {
    const amountShares = allocate(loyaltyResult.amount, preLoyaltyAmounts.map(asDatabaseDecimal));
    // Points are allocated independently (same weights) rather than
    // derived per line from amount/rate, so the per-line shares sum
    // EXACTLY to pointsApplied (allocate()'s own guarantee) with no
    // per-line division-rounding drift -- this is what
    // pos_sale_lines.loyalty_redeem_points is for (reversal
    // proportionality on a partial return).
    const pointShares = allocate(loyaltyResult.pointsApplied, preLoyaltyAmounts.map(asDatabaseDecimal));
    priced.forEach((line, index) => {
      line.loyaltyRedeemAmount = amountShares[index];
      line.loyaltyRedeemPoints = pointShares[index];
    });
  }

  let subtotal = decimal(0);
  let manualDiscountTotal = decimal(0);
  let promotionDiscountTotal = decimal(0);
  let couponDiscountTotal = decimal(0);
  let loyaltyRedeemTotal = decimal(0);
  let loyaltyPointsToEarn = decimal(0);
  let taxTotal = decimal(0);
  for (const line of priced) {
    subtotal = add(subtotal, line.grossAmount);
    manualDiscountTotal = add(manualDiscountTotal, line.manualDiscountAmount);
    promotionDiscountTotal = add(promotionDiscountTotal, line.promotionDiscountAmount);
    couponDiscountTotal = add(couponDiscountTotal, line.couponDiscountAmount);
    loyaltyRedeemTotal = add(loyaltyRedeemTotal, line.loyaltyRedeemAmount);

    const taxableBase = max(
      0,
      sub(
        sub(sub(sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount), line.couponDiscountAmount), line.cartDiscountAmount),
        line.loyaltyRedeemAmount,
      ),
    );
    const calculated = computeTax({ base: taxableBase, inclusive: line.taxInclusive, components: line.taxDecision.components, decimalPlaces });
    const taxableAmount = calculated.taxableAmount;
    const taxAmount = calculated.taxAmount;
    line.taxRate = calculated.totalRate;
    line.taxableAmount = taxableAmount;
    line.taxAmount = taxAmount;
    line.taxComponents = calculated.components.map((component) => ({
      type: component.type,
      label: component.label,
      rate: asDatabaseDecimal(component.rate),
      taxableAmount: asDatabaseDecimal(component.taxableAmount),
      taxAmount: asDatabaseDecimal(component.taxAmount),
    }));
    line.lineTotal = add(taxableAmount, taxAmount);
    line.loyaltyPointsEarned = computePosLoyaltyEarnPoints(loyaltyResult.program, taxableAmount);
    loyaltyPointsToEarn = add(loyaltyPointsToEarn, line.loyaltyPointsEarned);
    taxTotal = add(taxTotal, taxAmount);
  }

  // F306 eligibility rule: a program's min_eligible_sale_amount applies to
  // EARNING only (a redemption the cashier already validated/applied
  // stands regardless of basket size) -- measured against the post-every-
  // other-discount, pre-tax, pre-redemption base so a customer using
  // points to pay for most of a basket doesn't get disqualified from
  // earning by the very redemption that lowered their taxable spend.
  if (loyaltyResult.program?.min_eligible_sale_amount != null && preLoyaltySubtotal < decimal(loyaltyResult.program.min_eligible_sale_amount)) {
    loyaltyPointsToEarn = decimal(0);
    for (const line of priced) line.loyaltyPointsEarned = decimal(0);
  }

  const discountTotal = add(add(add(add(manualDiscountTotal, promotionDiscountTotal), couponDiscountTotal), cartDiscountTotal), loyaltyRedeemTotal);
  // What the lines come to (taxable value + tax each): a tax-inclusive price already holds its tax, so tax is never added a second time.
  const taxableTotal = priced.reduce((sum, line) => add(sum, line.taxableAmount), decimal(0));
  const beforeRounding = add(taxableTotal, taxTotal);
  const grandTotal = roundMoney(beforeRounding, decimalPlaces);
  const roundingAdjustment = sub(grandTotal, beforeRounding);

  if (expectedTotals) {
    const tolerance = decimal("0.01");
    for (const [key, expectedValue] of Object.entries(expectedTotals)) {
      if (expectedValue == null) continue;
      const authoritative = { subtotal, discountTotal, taxTotal, grandTotal }[key];
      if (authoritative == null) continue;
      if (
        (decimal(expectedValue) > authoritative ? decimal(expectedValue) - authoritative : authoritative - decimal(expectedValue)) > tolerance
      ) {
        throw posError(
          409,
          `The ${key} you expected (${expectedValue}) no longer matches the authoritative server total (${asDatabaseDecimal(authoritative)}). Refresh and try again.`,
          "POS_PRICE_CONFLICT",
        );
      }
    }
  }

  const breakdown = summarizeTax(priced.flatMap((line) => (line.taxComponents ?? []).map((component) => ({
    taxType: component.type, label: component.label, rate: component.rate, taxableAmount: decimal(component.taxableAmount), taxAmount: decimal(component.taxAmount),
  })))).map((group) => ({ type: group.taxType, label: group.label, rate: asDatabaseDecimal(group.rate), taxableAmount: asDatabaseDecimal(group.taxableAmount), taxAmount: asDatabaseDecimal(group.taxAmount) }));
  const taxSummary = {
    seller: supply.tax.registration ?? null, taxDate: supply.day, supplyMode: supply.supplyMode, deliveryStateCode: supply.deliveryStateCode,
    placeOfSupply: supply.goodsPlaceOfSupply ?? null, placeOfSupplyName: gstStateName(supply.goodsPlaceOfSupply) ?? null, documentType: taxDocumentType(supply, priced),
    taxableTotal: asDatabaseDecimal(taxableTotal), breakdown, taxEnabled: supply.tax.enabled,
    pricesIncludeTax: priced.every((line) => line.taxInclusive) ? true : priced.every((line) => !line.taxInclusive) ? false : null,
  };
  taxSummary.hash = taxFingerprint(supply, priced, { taxTotal: asDatabaseDecimal(taxTotal), grandTotal: asDatabaseDecimal(grandTotal) });
  return {
    tax: taxSummary,
    cartDiscount: {
      ...cartDiscountSummary, value: cartDiscountSummary.value === null ? null : asDatabaseDecimal(cartDiscountSummary.value), eligibleBase: asDatabaseDecimal(cartDiscountSummary.eligibleBase),
      excludedBase: asDatabaseDecimal(cartDiscountSummary.excludedBase), amount: asDatabaseDecimal(cartDiscountSummary.amount),
      excluded: cartDiscountSummary.excluded.map((entry) => ({ ...entry, value: asDatabaseDecimal(entry.value) })),
      allocations: cartDiscountSummary.allocations.map((entry) => ({ ...entry, eligibleBase: asDatabaseDecimal(entry.eligibleBase), amount: asDatabaseDecimal(entry.amount) })),
    },
    // The customer's own price list when it priced any line, else the outlet's.
    effectivePriceListId: priced.some((line) => customerList && line.priceListId === customerList.id) ? customerList.id : store.price_list_id ?? null,
    lines: priced.map((line) => ({
      ...line,
      quantity: asDatabaseDecimal(line.quantity),
      uomFactor: asDatabaseDecimal(line.uomFactor),
      baseQuantity: asDatabaseDecimal(line.baseQuantity),
      listPrice: asDatabaseDecimal(line.listPrice),
      unitPrice: asDatabaseDecimal(line.unitPrice),
      grossAmount: asDatabaseDecimal(line.grossAmount),
      manualDiscountAmount: asDatabaseDecimal(line.manualDiscountAmount),
      promotionDiscountAmount: asDatabaseDecimal(line.promotionDiscountAmount),
      couponDiscountAmount: asDatabaseDecimal(line.couponDiscountAmount),
      cartDiscountAmount: asDatabaseDecimal(line.cartDiscountAmount),
      cartDiscountBase: asDatabaseDecimal(line.cartDiscountBase ?? 0),
      cartDiscountExcludedReason: line.cartDiscountExcludedReason ?? null,
      loyaltyRedeemAmount: asDatabaseDecimal(line.loyaltyRedeemAmount),
      loyaltyRedeemPoints: asDatabaseDecimal(line.loyaltyRedeemPoints),
      loyaltyPointsEarned: asDatabaseDecimal(line.loyaltyPointsEarned),
      taxableAmount: asDatabaseDecimal(line.taxableAmount),
      taxAmount: asDatabaseDecimal(line.taxAmount),
      lineTotal: asDatabaseDecimal(line.lineTotal),
      standardCost: asDatabaseDecimal(line.standardCost),
      taxRatePercent: asDatabaseDecimal(line.taxRatePercent),
      taxDecision: undefined,
      manualRequest: undefined,
      discountPolicy: undefined,
      manualDiscountValue: line.manualDiscountValue === null ? null : asDatabaseDecimal(line.manualDiscountValue),
    })),
    totals: {
      subtotal: asDatabaseDecimal(subtotal),
      manualDiscountTotal: asDatabaseDecimal(manualDiscountTotal),
      promotionDiscountTotal: asDatabaseDecimal(promotionDiscountTotal),
      couponDiscountTotal: asDatabaseDecimal(couponDiscountTotal),
      cartDiscountTotal: asDatabaseDecimal(cartDiscountTotal),
      loyaltyRedeemTotal: asDatabaseDecimal(loyaltyRedeemTotal),
      discountTotal: asDatabaseDecimal(discountTotal),
      taxTotal: asDatabaseDecimal(taxTotal),
      taxableTotal: asDatabaseDecimal(taxableTotal),
      roundingAdjustment: asDatabaseDecimal(roundingAdjustment),
      grandTotal: asDatabaseDecimal(grandTotal),
    },
    promotionApplications: promotionResult.applications,
    promotionExplanations: promotionResult.explanations,
    coupon: couponResult.coupon
      ? { id: couponResult.coupon.id, code: couponResult.coupon.code, amount: asDatabaseDecimal(couponResult.amount) }
      : null,
    // F306: a live preview of what this cart WOULD do to the customer's
    // loyalty balance if completed right now -- pointsToEarn/
    // redeemPointsApplied/redeemAmount are the exact figures the commit
    // functions in loyalty.js will use if this cart is completed without
    // further changes, but (per requirePosLoyaltyRedemptionEligible's
    // comment) balanceAfterPreview is only ever a preview snapshot, never
    // the authoritative concurrency-safe figure.
    loyalty: {
      programId: loyaltyResult.program?.id || null,
      // The rate resolved
      // HERE, at pricing time, is what sale-completion.js snapshots onto
      // pos_sales.loyalty_redemption_value_per_point_snapshot -- the
      // immutable historical rate this specific sale's accrual is valued
      // at, regardless of any later change to the program's live rate.
      redemptionValuePerPoint: loyaltyResult.program?.redemption_value_per_point ?? null,
      pointsToEarn: asDatabaseDecimal(loyaltyPointsToEarn),
      redeemPointsRequested: asDatabaseDecimal(decimal(loyaltyRedeemPoints || 0)),
      redeemPointsApplied: asDatabaseDecimal(loyaltyResult.pointsApplied),
      redeemAmount: asDatabaseDecimal(loyaltyRedeemTotal),
      balanceBeforeSale: asDatabaseDecimal(loyaltyResult.balanceBefore),
      balanceAfterPreview: asDatabaseDecimal(add(sub(loyaltyResult.balanceBefore, loyaltyResult.pointsApplied), loyaltyPointsToEarn)),
    },
  };
}
