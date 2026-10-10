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
import { computeTax, loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
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

// The organization's tax set-up for a sale: whether tax applies and the
// company registration (its state decides CGST + SGST or IGST).
export async function resolvePosTaxContext(client, context) {
  return loadTaxContext(client, { organizationId: context.organizationId });
}

// The tax on one sale line, from the shared tax engine Sales uses.
export async function posLineTax(client, tax, { taxCategoryId, buyerStateCode, base, taxInclusive, decimalPlaces }) {
  const resolved = await resolveLineTax(client, tax, {
    taxCategoryId: taxCategoryId ?? tax.defaultTaxCategoryId, date: new Date(), sellerStateCode: tax.registration?.stateCode, placeOfSupply: buyerStateCode,
  });
  return { resolved, ...computeTax({ base, inclusive: taxInclusive, components: resolved.components, decimalPlaces }) };
}

// A walk-in sale has no shipping/billing address at all -- the customer
// is physically at the counter, so the practical place of supply is the
// store's own state (matches real over-the-counter retail GST practice:
// intra-state unless the selected customer's own registered/billing
// address proves otherwise).
export async function resolveBuyerStateCode(client, context, customerId, sellerStateCode) {
  if (!customerId) return sellerStateCode;
  const result = await client.query(
    `SELECT state_code FROM tenant.addresses
     WHERE organization_id=$1 AND party_id=$2 AND address_type='billing' AND status='active'
     ORDER BY is_primary DESC LIMIT 1`,
    [context.organizationId, customerId],
  );
  return result.rows[0]?.state_code || sellerStateCode;
}

// A sellable, active item. A variant is an item of its own: a line names the variant's item.
async function resolveSaleItem(client, context, itemId, variantId) {
  if (variantId) throw posError(409, "Choose the variant item itself.", "POS_SALE_VARIANT_IS_ITEM");
  const itemResult = await client.query(
    `SELECT id,code,name,description,standard_cost,tax_category_id,group_id,status,lifecycle_status,tracking_type,is_sellable,uom_id
     FROM tenant.items WHERE organization_id=$1 AND id=$2`,
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

async function resolveUnitPrice(client, context, store, policy, line, item, customerId) {
  // A price override was authorized when it was entered (Cashier Permissions: PRICE_OVERRIDE, its limit and reason) and is checked again
  // at checkout; pricing only applies it. Tax is always recomputed from the overridden price.
  if (line.priceOverride) {
    const requested = decimal(line.unitPrice);
    if (requested < 0n) throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
    return requested;
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
  return applyCustomerPricingRules(client, context, store, customerId, item.id, item.group_id, decimal(line.quantity), listUnitPrice);
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
// [{ itemId, quantity, unitPrice?, priceOverride?,
//    warehouseId?, warehouseLocationId?, batchId?, serialId?,
//    manualDiscount?: {type,value,reason} }]
export async function priceCartLines(client, context, { store, policy, customerId, lines, cartDiscount, couponCode, loyaltyRedeemPoints, expectedTotals } = {}) {
  if (!Array.isArray(lines) || !lines.length) {
    throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");
  }
  if (lines.length > 200) {
    throw posError(400, "A POS cart cannot contain more than 200 lines.", "POS_CART_LINE_LIMIT_EXCEEDED");
  }
  const decimalPlaces = await resolveCurrencyDecimalPlaces(client, context, store.currency_code);
  const taxContext = await resolvePosTaxContext(client, context);
  const buyerStateCode = await resolveBuyerStateCode(client, context, customerId, taxContext.registration?.stateCode ?? null);
  const taxInclusive = await resolvePriceListTaxInclusive(client, context, store.price_list_id);

  const priced = [];
  let lineNumber = 0;
  for (const rawLine of lines) {
    lineNumber += 1;
    const quantity = decimal(rawLine.quantity);
    if (quantity <= 0n) throw posError(400, "POS sale quantity must be greater than zero.", "POS_SALE_QUANTITY_INVALID");
    const item = await resolveSaleItem(client, context, rawLine.itemId, rawLine.variantId || null);
    const unitPrice = await resolveUnitPrice(client, context, store, policy, { ...rawLine, quantity: asDatabaseDecimal(quantity) }, item, customerId);
    const listPrice = unitPrice;
    const grossAmount = roundMoney(mul(quantity, unitPrice), decimalPlaces);
    const manualDiscountAmount = normalizedDiscountAmount(rawLine.manualDiscount, grossAmount, policy.max_line_discount_percent, `Line ${lineNumber}`);
    if (manualDiscountAmount > 0n && rawLine.manualDiscount && !rawLine.manualDiscount.alreadyAuthorized) {
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
      manualDiscountReason: manualDiscountAmount > 0n ? String(rawLine.manualDiscount.reason).trim() : null,
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
    });
  }

  const cartSubtotal = priced.reduce((sum, line) => add(sum, line.grossAmount), decimal(0));

  const promotionResult = await evaluatePromotions(client, context, store, customerId, priced, cartSubtotal);
  for (const line of priced) line.promotionDiscountAmount = promotionResult.lineDiscounts.get(line.lineNumber) || decimal(0);

  const afterPromotionSubtotal = priced.reduce(
    (sum, line) => add(sum, max(0, sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount))),
    decimal(0),
  );
  const couponResult = await evaluateCoupon(client, context, store, customerId, priced, afterPromotionSubtotal, couponCode);
  for (const line of priced) line.couponDiscountAmount = couponResult.lineDiscounts.get(line.lineNumber) || decimal(0);

  // Cart-level manual discount, allocated proportionally by each line's
  // remaining (post manual/promotion/coupon) amount using the existing
  // allocate() primitive so the sum of shares exactly equals the total
  // (no rounding leakage), then applied before tax per this module's
  // documented policy divergence from Sales' header discount.
  const preCartDiscountAmounts = priced.map((line) =>
    max(0, sub(sub(sub(line.grossAmount, line.manualDiscountAmount), line.promotionDiscountAmount), line.couponDiscountAmount)),
  );
  const preCartDiscountSubtotal = preCartDiscountAmounts.reduce((sum, amount) => add(sum, amount), decimal(0));
  let cartDiscountTotal = decimal(0);
  if (cartDiscount && preCartDiscountSubtotal > 0n) {
    cartDiscountTotal = normalizedDiscountAmount(cartDiscount, preCartDiscountSubtotal, policy.max_cart_discount_percent, "Cart");
    if (cartDiscountTotal > 0n && !cartDiscount.reason?.trim()) {
      throw posError(400, "Cart-level discount requires a reason.", "POS_DISCOUNT_REASON_REQUIRED");
    }
    if (cartDiscountTotal > 0n) {
      const shares = allocate(cartDiscountTotal, preCartDiscountAmounts.map(asDatabaseDecimal));
      priced.forEach((line, index) => (line.cartDiscountAmount = shares[index]));
    }
  }

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
    const calculated = await posLineTax(client, taxContext, { taxCategoryId: line.taxCategoryId, buyerStateCode, base: taxableBase, taxInclusive, decimalPlaces });
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
  const beforeRounding = sub(add(subtotal, taxTotal), discountTotal);
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

  return {
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
      loyaltyRedeemAmount: asDatabaseDecimal(line.loyaltyRedeemAmount),
      loyaltyRedeemPoints: asDatabaseDecimal(line.loyaltyRedeemPoints),
      loyaltyPointsEarned: asDatabaseDecimal(line.loyaltyPointsEarned),
      taxableAmount: asDatabaseDecimal(line.taxableAmount),
      taxAmount: asDatabaseDecimal(line.taxAmount),
      lineTotal: asDatabaseDecimal(line.lineTotal),
      standardCost: asDatabaseDecimal(line.standardCost),
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
