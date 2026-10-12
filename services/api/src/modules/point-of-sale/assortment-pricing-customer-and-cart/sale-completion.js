// POS-CAP-002 (F277-F281 cart lifecycle capstone). A cart's terminal state
// transition -- draft/priced -> completed sale -- is this capability's own
// lifecycle boundary, the same way cart.js already owns draft/priced/held/
// cancelled/expired. completePosCart necessarily also reaches into Stock
// (postCanonicalStockMovement), tender-and-payment-execution (locking
// already-captured non-cash legs) and this capability's own promotions/
// coupons commit steps -- that cross-capability composition is expected
// for a capstone operation, the same way CRM's lead-conversion.js (in its
// own dedicated capability folder) composes accounts/contacts/
// opportunities rather than living in crm/index.js.
//
// completePointOfSale is the legacy flat-lines predecessor to
// completePosCart (no cart aggregate involved) -- still supported; both
// share the private helpers below.
import { computeTax, summarizeTax } from "../../../core/tax/index.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, sub, mul, div, percent, max, roundMoney, asDatabaseDecimal, decimal, formatDecimal } from "../../../core/decimal.js";
import { getStockAvailability, postStockMovement as postCanonicalStockMovement } from "../../stock/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import {
  resolveCurrencyDecimalPlaces,
  resolvePosSupplyContext,
  resolvePosLineTax,
  normalizedDiscountAmount,
  priceCartLines,
  applyCustomerPricingRules,
} from "./cart-pricing.js";
import { issuePosDocument } from "../transaction-continuity-and-documents/receipt-printing.js";
import { issuePosSaleInvoice } from "../transaction-continuity-and-documents/gst-invoices.js";
import { loadPosSettingsPolicy, loadPosCartLines, toPosCartPricingInputLines, assertPosCartDiscountsAuthorized, cartEvent, buildPosBuyerSnapshot } from "./cart.js";
import { assertPosAction } from "../permissions/index.js";
import { commitPosPromotionApplications } from "./promotions.js";
import { commitPosCouponRedemption } from "./coupons.js";
import { resolveActivePosLoyaltyProgram, computePosLoyaltyEarnPoints, commitPosLoyaltyForSale } from "./loyalty.js";
import { lockCapturedCartPaymentLegs } from "../tender-and-payment-execution/payments.js";
import { isTerminalPaymentMethodEnabled, resolveTerminalStockSource } from "../terminals/index.js";
import { randomUUID } from "node:crypto";
import { POS_STOCK_MESSAGES, consumePosLineStock, ensurePosCheckoutStockAllocation, resolvePosStockRecovery } from "../inventory-and-offline-continuity/stock-reduction.js";
import { assertShiftCashSession } from "../cash-shift-day-end-and-reconciliation/shift-opening.js";

// Sale-line stock issue routes through Stock's own postStockMovement
// (services/api/src/modules/stock/index.js) rather than a local fork, so
// stock_balances and stock_valuation_layers stay authoritative after a
// completed sale. The augmented-permissions pattern below mirrors the
// precedent in stock/index.js's own moveStockWithinWarehouse(): the caller
// already passed requirePermission(context, "pos.sale.create") above, so
// this business operation is what authorizes the resulting stock
// movement — the caller does not need to separately hold stock.issue.

// Sellable stock comes from Inventory's own availability engine: on hand less reserved, never quality-held, quarantined, damaged, expired or
// blocked stock, at the location the sale issues from when there is one.
async function stockAvailable(client, context, itemId, warehouseId, warehouseLocationId = null) {
  const availability = await getStockAvailability(client, { ...context, permissions: [...new Set([...(context.permissions || []), "stock.view"])] },
    { itemId, warehouseId, warehouseLocationId: warehouseLocationId || undefined });
  return Number(availability.availableQuantity ?? availability.available_quantity ?? 0);
}

// Sale-line stock issue routes through Stock's own postStockMovement
// (services/api/src/modules/stock/index.js) rather than a local fork, so
// stock_balances and stock_valuation_layers stay authoritative after a
// completed sale. The augmented-permissions pattern below mirrors the
// precedent in stock/index.js's own moveStockWithinWarehouse(): the caller
// already passed requirePermission(context, "pos.sale.create") above, so
// this business operation is what authorizes the resulting stock
// movement — the caller does not need to separately hold stock.issue.

function safeDocumentPrefix(value, fallback = "POS") {
  const normalized = String(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9/_-]+/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

// F275 gap closure (legacy flat-lines path): this path previously only
// ever consulted the store's own price list, same as the cart path did
// before F275's own fix — silently ignoring a customer's negotiated rate
// (tenant.sales_pricing_rules). Not just a documentation gap: this path
// is genuinely reachable via POST /api/pos/sales (a real, customerId-
// accepting HTTP endpoint) and is what offline sync's completion step
// (inventory-and-offline-continuity/offline-sync.js) itself completes
// through — so it needed the same fix cart-pricing.js's own
// applyCustomerPricingRules already implements, reused here rather than
// duplicated.
async function resolvePointOfSaleUnitPrice(client, context, shift, policy, line, customerId, itemGroupId) {
  const requestedPrice = Number(line.unitPrice);
  if (!Number.isFinite(requestedPrice) || requestedPrice < 0) {
    throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
  }

  if (line.priceOverride) {
    const listRate = shift.price_list_id ? (await client.query(
      `SELECT price_item.rate FROM tenant.price_list_items price_item
        WHERE price_item.organization_id=$1 AND price_item.price_list_id=$2 AND price_item.item_id=$3 AND price_item.status='active'
          AND (price_item.valid_from IS NULL OR price_item.valid_from<=current_date) AND (price_item.valid_to IS NULL OR price_item.valid_to>=current_date)
        ORDER BY price_item.minimum_quantity LIMIT 1`, [context.organizationId, shift.price_list_id, line.itemId])).rows[0]?.rate : null;
    const requested = decimal(requestedPrice);
    const list = listRate === null || listRate === undefined ? null : decimal(listRate);
    const deviation = list && list > 0n ? div(mul(max(sub(requested, list), sub(list, requested)), decimal(100)), list) : decimal(100);
    await assertPosAction(client, context, { permission: "PRICE_OVERRIDE", outletId: shift.store_id, reason: line.overrideReason ?? line.reason, percentage: formatDecimal(deviation) });
    return requested;
  }

  if (!shift.price_list_id) {
    throw posError(
      409,
      "The POS store requires an active sales price list before checkout. Configure a price list or use an authorized price override.",
      "POS_PRICE_LIST_REQUIRED",
    );
  }

  const price = await client.query(
    `SELECT price_item.rate
     FROM tenant.price_list_items price_item
     JOIN tenant.price_lists price_list
       ON price_list.organization_id=price_item.organization_id
      AND price_list.id=price_item.price_list_id
     WHERE price_item.organization_id=$1
       AND price_item.price_list_id=$2
       AND price_item.item_id=$3
       AND price_item.minimum_quantity <= $4
       AND price_item.status='active'
       AND price_list.status='active'
       AND price_list.price_list_type='sales'
       AND price_list.currency_code=$5
       AND (price_item.valid_from IS NULL OR price_item.valid_from<=current_date)
       AND (price_item.valid_to IS NULL OR price_item.valid_to>=current_date)
       AND (price_list.valid_from IS NULL OR price_list.valid_from<=current_date)
       AND (price_list.valid_to IS NULL OR price_list.valid_to>=current_date)
     ORDER BY price_item.minimum_quantity DESC,price_item.valid_from DESC NULLS LAST
     LIMIT 1`,
    [context.organizationId, shift.price_list_id, line.itemId, line.quantity, shift.currency_code],
  );
  if (!price.rows[0]) {
    throw posError(409, "No active POS price exists for this item and quantity.", "POS_PRICE_NOT_FOUND");
  }
  const listUnitPrice = decimal(price.rows[0].rate);
  return applyCustomerPricingRules(client, context, shift, customerId, line.itemId, itemGroupId, decimal(line.quantity), listUnitPrice);
}

// Items sold without stock: services, and items not kept in inventory.
async function nonStockItemIds(client, context, itemIds) {
  if (!itemIds.length) return new Set();
  return new Set((await client.query(`SELECT id FROM tenant.items WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND (item_type = 'service' OR track_inventory = false)`,
    [context.organizationId, [...new Set(itemIds)]])).rows.map((row) => row.id));
}

export async function completePointOfSale(client, context, input) {
  requirePermission(context, "pos.sale.create");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");
  }
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw posError(400, "At least one payment is required.", "POS_PAYMENT_REQUIRED");
  }

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.sale.complete",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  // Wave 0 deliberately fails closed for payment methods without an
  // authoritative provider adapter. A client assertion is never enough to
  // mark card/UPI/wallet/bank/store-credit money as captured.
  for (const payment of input.payments) {
    const amount = Number(payment.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) {
      throw posError(400, "POS payment amount must be greater than zero.", "POS_PAYMENT_AMOUNT_INVALID");
    }
    if (payment.method !== "cash") {
      throw posError(
        409,
        `Payment method ${payment.method} is not available until an authoritative provider adapter is configured.`,
        "POS_PAYMENT_PROVIDER_NOT_CONFIGURED",
      );
    }
  }

  const shiftResult = await client.query(
    `SELECT shift.*,store.warehouse_id,store.currency_code,store.price_list_id,
            terminal.receipt_prefix
     FROM tenant.pos_shifts shift
     JOIN tenant.pos_stores store
       ON store.id=shift.store_id
      AND store.organization_id=shift.organization_id
     JOIN tenant.pos_terminals terminal
       ON terminal.id=shift.terminal_id
      AND terminal.organization_id=shift.organization_id
      AND terminal.store_id=shift.store_id
     WHERE shift.organization_id=$1
       AND shift.id=$2 AND shift.status='open' AND shift.lifecycle_status='OPEN'
       AND store.active=true AND terminal.status='active'
     FOR UPDATE`,
    [context.organizationId, input.shiftId],
  );
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }
  await assertPosStoreAccess(client, context, shift.store_id, shift.terminal_id);
  await assertPosAction(client, context, { permission: "SALE_CREATE", outletId: shift.store_id });
  await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: shift.store_id });
  // Cash is taken only where the outlet accepts it and the terminal manages cash.
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, shift.terminal_id, "cash")))
    throw posError(409, 'Payment method "cash" is not available on this terminal.', "PAYMENT_METHOD_NOT_AVAILABLE");
  // Shift Opening (0103): cash only into an open cash session (a card / UPI shift has none until its drawer is counted).
  await assertShiftCashSession(client, context, shift.id);

  // SECURITY (consolidated pass): this used to SELECT only
  // allow_negative_stock/allow_price_override, so the discount check below
  // (`policy.max_line_discount_percent ?? 100`) silently ignored whatever
  // the organization actually configured and always fell back to
  // "100% -- no cap at all." discount_approval_threshold_percent is now
  // also selected so this legacy path can be held to the same fail-closed
  // rule the cart-based path (F279) already enforces (see below).
  const settings = await client.query(
    `SELECT allow_negative_stock,allow_price_override,max_line_discount_percent,discount_approval_threshold_percent
     FROM tenant.pos_settings
     WHERE organization_id=$1`,
    [context.organizationId],
  );
  const policy = settings.rows[0] || {
    allow_negative_stock: false,
    allow_price_override: false,
    max_line_discount_percent: 100,
    discount_approval_threshold_percent: 10,
  };

  // F276: reference the authoritative CRM/Sales customer master
  // (tenant.business_parties) rather than trusting a free-text/unvalidated
  // id. Found via audit: this previously accepted any UUID (or
  // none) with zero validation, alongside an always-trusted free-text
  // customerName. Validated before the line loop so the resolved customer
  // can also supply the buyer's state code for tax-jurisdiction resolution
  // below.
  if (input.customerId) {
    const customer = await client.query(
      `SELECT id FROM tenant.business_parties
       WHERE organization_id=$1
         AND id=$2 AND party_type IN ('customer','both') AND status='active'`,
      [context.organizationId, input.customerId],
    );
    if (!customer.rows[0]) {
      throw posError(404, "Selected customer was not found or is not an active customer.", "POS_CUSTOMER_NOT_FOUND");
    }
  }

  // F278/PHASE 4: tax is ALWAYS derived server-side from tenant.tax_rates
  // via the same resolveTaxRateComponents helper Sales' calculateLine
  // uses (services/api/src/core/tax) — a client-supplied
  // taxAmount is never persisted as-is; if one is present it is only
  // compared against the authoritative figure and rejected as a conflict
  // when it disagrees (POS_PRICE_CONFLICT), never silently trusted and
  // never silently coerced to zero. Discounts are policy-validated
  // (reason required, bounded by pos_settings.max_line_discount_percent)
  // via the same normalizedDiscountAmount cart-pricing.js also uses,
  // closing the "no policy-driven discount evaluation" gap for this
  // legacy flat-lines path too, without requiring every existing caller
  // to migrate to the full cart aggregate in this same pass.
  const decimalPlaces = await resolveCurrencyDecimalPlaces(client, context, shift.currency_code);
  // The same supply context and tax decisions as the cart (a counter sale: the store is the place of supply for goods).
  const supply = await resolvePosSupplyContext(client, context, { storeId: shift.store_id, customerId: input.customerId || null });
  const priceList = shift.price_list_id
    ? await client.query(`SELECT tax_inclusive FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND status='active'`, [
        context.organizationId,
        shift.price_list_id,
      ])
    : { rows: [] };
  const taxInclusive = Boolean(priceList.rows[0]?.tax_inclusive);

  let subtotal = decimal(0);
  let discountTotal = decimal(0);
  let taxTotal = decimal(0);
  let taxableTotal = decimal(0);
  const normalizedLines = [];

  // F306: the legacy flat-lines path has no cart aggregate and does not
  // evaluate promotions/coupons either (see this function's own header
  // comment for that pre-existing, documented limitation) -- it earns
  // loyalty points (same basis/timing as the cart path: final net-of-tax
  // line amount) but does not support redemption, which requires the
  // interactive cart preview/apply flow.
  const loyaltyProgram = input.customerId ? await resolveActivePosLoyaltyProgram(client, context) : null;
  let loyaltyPointsEarned = decimal(0);

  // pos_sale_lines.description is NOT NULL (receipts must show a real line
  // description, not a blank line) — a caller reasonably won't always
  // override it, so batch-resolve each item's own name/tax category as the
  // default rather than requiring every checkout call to repeat it. Found
  // via direct PostgreSQL testing: the prior code passed line.description
  // straight through and only ever worked because the one existing test
  // happened to always supply one.
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const itemRows = await client.query(
    `SELECT id,name,tax_category_id,group_id,hsn_sac_code,item_type,track_inventory FROM tenant.items WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
    [context.organizationId, itemIds],
  );
  const itemById = new Map(itemRows.rows.map((row) => [row.id, row]));

  for (const [index, line] of input.lines.entries()) {
    const quantity = Number(line.quantity);
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      throw posError(400, "POS sale quantity must be greater than zero.", "POS_SALE_QUANTITY_INVALID");
    }
    if (!itemById.has(line.itemId)) {
      throw posError(404, "One or more POS sale items were not found.", "POS_SALE_ITEM_NOT_FOUND");
    }
    const item = itemById.get(line.itemId);

    // A variant is an item of its own: the line names the variant's item.
    if (line.variantId) throw posError(409, "Choose the variant item itself.", "POS_SALE_VARIANT_IS_ITEM");

    // Stock comes from the outlet's warehouse, at the terminal's selling location (else the outlet's): never a warehouse the caller names.
    if (line.warehouseId && line.warehouseId !== shift.warehouse_id) throw posError(409, "Stock is sold from this outlet's selling warehouse only.", "INVALID_SELLING_LOCATION");
    const { warehouseId, locationId: warehouseLocationId } = await resolveTerminalStockSource(client, context.organizationId, shift.terminal_id, line.warehouseLocationId || null);
    const available = item.item_type === "service" || item.track_inventory === false ? Infinity : await stockAvailable(client, context, line.itemId, warehouseId, warehouseLocationId);
    if (!policy.allow_negative_stock && available < quantity) {
      const error = posError(409, "Insufficient stock for POS sale.", "INSUFFICIENT_STOCK");
      error.itemId = line.itemId;
      throw error;
    }

    const unitPrice = decimal(
      await resolvePointOfSaleUnitPrice(client, context, shift, policy, { ...line, quantity }, input.customerId, item.group_id),
    );
    const lineSubtotal = roundMoney(mul(decimal(quantity), unitPrice), decimalPlaces);

    let discountAmount = decimal(0);
    if (line.discountAmount != null && Number(line.discountAmount) > 0) {
      requirePermission(context, "pos.discount.apply");
      if (!line.discountReason || !String(line.discountReason).trim()) {
        throw posError(400, `Line ${index + 1} discount requires a reason.`, "POS_DISCOUNT_REASON_REQUIRED");
      }
      discountAmount = normalizedDiscountAmount(
        { type: "amount", value: line.discountAmount, reason: line.discountReason },
        lineSubtotal,
        policy.max_line_discount_percent ?? 100,
        `Line ${index + 1}`,
      );
      if (discountAmount > 0n) {
        const percentOfGross = lineSubtotal > 0n ? div(mul(discountAmount, decimal(100)), lineSubtotal) : decimal(100);
        await assertPosAction(client, context, { permission: "DISCOUNT_LINE_MANUAL", outletId: shift.store_id, reason: line.discountReason,
          percentage: formatDecimal(percentOfGross), amount: formatDecimal(add(discountTotal, discountAmount)) });
      }
    }
    const taxableAmount = max(0, sub(lineSubtotal, discountAmount));
    const decision = await resolvePosLineTax(client, supply, item);
    const calculated = computeTax({ base: taxableAmount, inclusive: taxInclusive, components: decision.components, decimalPlaces });
    const taxRate = calculated.totalRate;
    const components = calculated.components;
    const taxableBase = calculated.taxableAmount;
    const taxAmount = calculated.taxAmount;
    if (line.taxAmount != null) {
      const expected = decimal(line.taxAmount);
      const diff = expected > taxAmount ? expected - taxAmount : taxAmount - expected;
      if (diff > decimal("0.01")) {
        throw posError(
          409,
          `The tax you expected (${line.taxAmount}) does not match the authoritative server-calculated tax (${asDatabaseDecimal(taxAmount)}) for line ${index + 1}.`,
          "POS_PRICE_CONFLICT",
        );
      }
    }
    const lineTotal = add(taxableBase, taxAmount);
    taxableTotal = add(taxableTotal, taxableBase);
    subtotal = add(subtotal, lineSubtotal);
    discountTotal = add(discountTotal, discountAmount);
    taxTotal = add(taxTotal, taxAmount);
    const linePointsEarned = computePosLoyaltyEarnPoints(loyaltyProgram, taxableBase);
    loyaltyPointsEarned = add(loyaltyPointsEarned, linePointsEarned);
    normalizedLines.push({
      ...line,
      lineNumber: index + 1,
      quantity,
      unitPrice: asDatabaseDecimal(unitPrice),
      discountAmount: asDatabaseDecimal(discountAmount),
      taxAmount: asDatabaseDecimal(taxAmount),
      taxComponents: components.map((component) => ({
        type: component.type,
        label: component.label,
        rate: asDatabaseDecimal(component.rate),
        taxableAmount: asDatabaseDecimal(component.taxableAmount),
        taxAmount: asDatabaseDecimal(component.taxAmount),
      })),
      lineTotal: asDatabaseDecimal(lineTotal),
      taxableAmount: asDatabaseDecimal(taxableBase),
      taxClassification: decision.classification,
      hsnSac: decision.hsnSac,
      taxCategoryId: decision.categoryId ?? null,
      taxCategoryCode: decision.categoryCode ?? null,
      taxRateId: decision.rateId ?? null,
      taxRatePercent: asDatabaseDecimal(add(decision.rate ?? decimal(0), decision.cessRate ?? decimal(0))),
      priceIncludesTax: taxInclusive,
      placeOfSupply: decision.placeOfSupply ?? null,
      warehouseId,
      warehouseLocationId,
      description: line.description || item.name,
      loyaltyPointsEarned: linePointsEarned,
    });
  }
  if (loyaltyProgram?.min_eligible_sale_amount != null && subtotal - discountTotal < decimal(loyaltyProgram.min_eligible_sale_amount)) {
    loyaltyPointsEarned = decimal(0);
    for (const line of normalizedLines) line.loyaltyPointsEarned = decimal(0);
  }

  // A client-supplied roundingAdjustment is a legitimate cashier action
  // (rounding physical cash to the nearest coin denomination available),
  // never an authoritative total override — bounded to strictly less than
  // one currency unit so it can never be used to smuggle an arbitrary
  // discount past the policy checks above.
  const roundingAdjustment = decimal(input.roundingAdjustment || 0);
  if (roundingAdjustment >= decimal(1) || roundingAdjustment <= decimal(-1)) {
    throw posError(400, "Rounding adjustment must be less than one currency unit.", "POS_ROUNDING_INVALID");
  }
  const grandTotal = add(add(taxableTotal, taxTotal), roundingAdjustment);
  const legacyBreakdown = summarizeTax(normalizedLines.flatMap((line) => line.taxComponents.map((component) => ({
    taxType: component.type, label: component.label, rate: component.rate, taxableAmount: decimal(component.taxableAmount), taxAmount: decimal(component.taxAmount),
  })))).map((group) => ({ type: group.taxType, label: group.label, rate: asDatabaseDecimal(group.rate), taxableAmount: asDatabaseDecimal(group.taxableAmount), taxAmount: asDatabaseDecimal(group.taxAmount) }));
  const legacyTaxable = normalizedLines.filter((line) => line.taxClassification === "taxable").length;
  const legacyDocumentType = !supply.tax.enabled ? "bill_of_supply" : legacyTaxable === normalizedLines.length ? "tax_invoice" : legacyTaxable ? "invoice_cum_bill_of_supply" : "bill_of_supply";
  if (grandTotal < 0n) {
    throw posError(400, "Calculated POS sale total is invalid.", "POS_TOTAL_INVALID");
  }
  const paidTotal = input.payments.reduce((sum, payment) => add(sum, decimal(payment.amount)), decimal(0));
  if (paidTotal < grandTotal) {
    throw posError(409, "Payment total is less than sale total.", "UNDERPAYMENT");
  }

  // Receipt numbers are unique per ORGANIZATION (pos_sales_organization_id_
  // receipt_number_key), not per terminal -- a per-terminal sequence key
  // here was a real, previously-undetected bug: two terminals sharing the
  // schema's own default receipt_prefix ('POS') would each independently
  // count from 1, so their first sale would collide on "POS-000001" and
  // fail with a raw, unhandled unique-constraint violation. Found via
  // genuine real-Postgres/real-browser testing this session (two real
  // terminals in the same org), not by inspection. The sequence is now
  // shared per organization, matching the constraint's actual scope; a
  // terminal's own receipt_prefix still lets it produce visually distinct
  // numbers if configured, but correctness no longer depends on that.
  const receiptNumber = input.receiptNumber || await nextDocumentNumber(client, context, {
    documentType: "pos_receipt",
    prefix: safeDocumentPrefix(shift.receipt_prefix, "POS"),
  });

  const sale = await client.query(
    `INSERT INTO tenant.pos_sales
      (organization_id,store_id,terminal_id,shift_id,receipt_number,
       customer_id,customer_name,currency_code,subtotal,discount_total,tax_total,
       rounding_adjustment,grand_total,paid_total,change_total,status,
       idempotency_key,created_by,completed_at,loyalty_program_id,loyalty_points_earned,
       loyalty_redemption_value_per_point_snapshot,seller_tax_registration_id,seller_tax_snapshot,place_of_supply_snapshot,supply_mode_snapshot,
       tax_document_type,taxable_total,tax_breakdown,tax_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       'completed',$16,$17,now(),$18,$19,$20,$21,$22::jsonb,$23,'in_store',$24,$25,$26::jsonb,$27)
     RETURNING *`,
    [
      context.organizationId,
      shift.store_id,
      shift.terminal_id,
      input.shiftId,
      receiptNumber,
      input.customerId || null,
      input.customerName || null,
      input.currencyCode || shift.currency_code,
      asDatabaseDecimal(subtotal),
      asDatabaseDecimal(discountTotal),
      asDatabaseDecimal(taxTotal),
      asDatabaseDecimal(roundingAdjustment),
      asDatabaseDecimal(grandTotal),
      asDatabaseDecimal(paidTotal),
      asDatabaseDecimal(sub(paidTotal, grandTotal)),
      input.idempotencyKey,
      context.userId,
      loyaltyProgram?.id || null,
      asDatabaseDecimal(loyaltyPointsEarned),
      loyaltyProgram?.redemption_value_per_point ?? null,
      supply.tax.registration?.id ?? null,
      supply.tax.registration ? JSON.stringify(supply.tax.registration) : null,
      supply.goodsPlaceOfSupply ?? null,
      legacyDocumentType,
      asDatabaseDecimal(taxableTotal),
      JSON.stringify(legacyBreakdown),
      supply.day,
    ],
  );

  const saleLineIdByLineNumberLegacy = new Map();
  const legacyNonStock = await nonStockItemIds(client, context, normalizedLines.map((line) => line.itemId));
  for (const line of normalizedLines) {
    const stockMovement = legacyNonStock.has(line.itemId) ? null : await postCanonicalStockMovement(
      client,
      { ...context, permissions: [...new Set([...(context.permissions || []), "stock.issue"])] },
      {
        movementType: "issue",
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        warehouseLocationId: line.warehouseLocationId,
        batchId: line.batchId,
        serialId: line.serialId,
        quantity: line.quantity,
        unitCost: line.unitCost || 0,
        referenceType: "pos_sale",
        referenceId: sale.rows[0].id,
        reason: "POS sale issue",
        idempotencyKey: `${input.idempotencyKey}:line:${line.lineNumber}`,
      },
    );

    const saleLine = await client.query(
      `INSERT INTO tenant.pos_sale_lines
        (organization_id,sale_id,line_number,item_id,description,quantity,
         unit_price,discount_amount,tax_amount,line_total,warehouse_id,
         warehouse_location_id,batch_id,serial_id,stock_movement_id,
         manual_discount_amount,promotion_discount_amount,coupon_discount_amount,tax_components,
         loyalty_points_earned,taxable_amount,hsn_sac_snapshot,tax_category_id,tax_category_code,tax_rate_id,tax_rate,tax_classification,
         price_includes_tax,place_of_supply)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,0,$17::jsonb,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING id`,
      [
        context.organizationId,
        sale.rows[0].id,
        line.lineNumber,
        line.itemId,
        line.description,
        String(line.quantity),
        String(line.unitPrice),
        String(line.discountAmount),
        String(line.taxAmount),
        String(line.lineTotal),
        line.warehouseId,
        line.warehouseLocationId || null,
        line.batchId || null,
        line.serialId || null,
        stockMovement?.id ?? null,
        String(line.discountAmount),
        JSON.stringify(line.taxComponents || []),
        asDatabaseDecimal(line.loyaltyPointsEarned || decimal(0)),
        line.taxableAmount, line.hsnSac, line.taxCategoryId, line.taxCategoryCode, line.taxRateId, line.taxRatePercent, line.taxClassification,
        line.priceIncludesTax, line.placeOfSupply,
      ],
    );
    saleLineIdByLineNumberLegacy.set(line.lineNumber, saleLine.rows[0].id);
  }

  if (input.customerId) {
    await commitPosLoyaltyForSale(client, context, {
      saleId: sale.rows[0].id,
      customerId: input.customerId,
      programId: loyaltyProgram?.id || null,
      lines: normalizedLines.map((line) => ({ saleLineId: saleLineIdByLineNumberLegacy.get(line.lineNumber), points: line.loyaltyPointsEarned })),
      redeemPointsApplied: 0,
    });
  }

  // Each cash tender settles what is left of the bill; any excess is change, given back from the last tender.
  let leftToSettle = grandTotal;
  const legacyTenders = [];
  for (const payment of input.payments) {
    const received = decimal(payment.amount);
    const applied = leftToSettle < received ? leftToSettle : received;
    leftToSettle = sub(leftToSettle, applied);
    if (applied <= 0n) continue;
    const change = sub(received, applied);
    const row = await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,sale_id,shift_id,payment_method,amount,provider_reference,authorization_reference,status,captured_at,created_by,provider_key,
         cash_received_amount,change_due_amount,change_given_amount,cash_receipt_confirmed_at,custody_status,completed_at)
       VALUES ($1,$2,$3,'cash',$4,NULL,NULL,'captured',now(),$5,'cash',$6,$7,$7,now(),'completed',now()) RETURNING id`,
      [context.organizationId, sale.rows[0].id, input.shiftId, asDatabaseDecimal(applied), context.userId, asDatabaseDecimal(received), asDatabaseDecimal(change)],
    );
    legacyTenders.push({ id: row.rows[0].id, received, change });
  }

  // Cash tender may exceed the sale total when change is returned. The till
  // retains only the authoritative sale total, so record one net sale cash
  // movement rather than one movement per tender line.
  for (const tender of legacyTenders) {
    for (const [cashEvent, amount] of [["sale_cash_received", tender.received], ["sale_change_given", sub(decimal(0), tender.change)]]) {
      if (amount === 0n) continue;
      const cashMovementNumber = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
      await client.query(
        `INSERT INTO tenant.pos_cash_movements
          (organization_id,shift_id,movement_number,movement_type,amount,reference_type,reference_id,created_by,cash_event,payment_id)
         VALUES ($1,$2,$3,'sale',$4,'pos_sale',$5,$6,$7,$8)`,
        [context.organizationId, input.shiftId, cashMovementNumber, asDatabaseDecimal(amount), sale.rows[0].id, context.userId, cashEvent, tender.id],
      );
    }
  }

  await event(client, context, "sale", sale.rows[0].id, "pos.sale.completed", {
    receiptNumber,
    grandTotal: asDatabaseDecimal(grandTotal),
  });
  await issuePosSaleInvoice(client, context, sale.rows[0].id);
  await issuePosDocument(client, context, "pos_sale", sale.rows[0].id);
  const response = { ...sale.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_sale",
    aggregateId: sale.rows[0].id,
  });
  return response;
}

// F277 PHASE 10 — the primary, cart-based sale-completion path. Every
// monetary figure is recomputed fresh (via the same priceCartLines used
// by every cart mutation) INSIDE this transaction, under the cart row's
// own lock, so a price/promotion/coupon config change between the last
// preview and this exact moment can never silently ship a stale total —
// and a client-supplied expectedGrandTotal is only ever compared for
// conflict, never trusted as the figure to charge.
export async function completePosCart(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw posError(400, "At least one payment is required.", "POS_PAYMENT_REQUIRED");
  }
  // F283/F284/F285/F286: a payment leg is either a cash tender (a
  // client-supplied amount is fine -- physical cash exchange has always
  // been the one case a client asserts the figure for, unchanged from
  // before) or a reference to a payment ATTEMPT that was already
  // initiated via initiatePosPayment and independently, server-side,
  // reached 'captured' (via the adapter's own synchronous response or a
  // verified webhook -- see features/payments.js). The client can never
  // simply assert a card/UPI/wallet amount here; only cash amounts are
  // ever taken from client input.
  const cashLegs = [];
  const nonCashLegs = [];
  // Cash Payments (0092): cash the cashier already confirmed receiving is in custody on the bill; it is referenced, never re-entered.
  const custodyLegs = [];
  for (const payment of input.payments) {
    const method = String(payment.method || "").trim().toLowerCase();
    if (method === "cash" && payment.paymentId) {
      custodyLegs.push({ method, paymentId: payment.paymentId });
    } else if (method === "cash") {
      const amount = decimal(payment.amount);
      if (amount <= 0n) throw posError(400, "POS payment amount must be greater than zero.", "POS_PAYMENT_AMOUNT_INVALID");
      cashLegs.push({ method, amount });
    } else if (["card", "upi", "wallet", "bank_transfer"].includes(method)) {
      if (!payment.paymentId) {
        throw posError(
          400,
          `A ${method} payment leg must reference an already-initiated paymentId (see initiatePosPayment).`,
          "POS_PAYMENT_ID_REQUIRED",
        );
      }
      nonCashLegs.push({ method, paymentId: payment.paymentId });
    } else {
      throw posError(400, `Unsupported POS payment method: ${payment.method}.`, "POS_PAYMENT_METHOD_INVALID");
    }
  }
  // A pure single cash tender may still exceed the total (change is
  // returned). Any split/multi-method sale must sum EXACTLY to the total
  // -- a card/UPI leg is exact by nature, and "change" against a
  // non-cash leg is not a real-world concept.
  const isSingleCashTender = cashLegs.length === 1 && nonCashLegs.length === 0 && custodyLegs.length === 0;

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.sale.complete",
    key: input.idempotencyKey,
    payload: { cartId, ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const cartResult = await client.query(
    `SELECT cart.*,store.warehouse_id,store.currency_code,store.price_list_id,store.active AS store_active,
            terminal.receipt_prefix,terminal.status AS terminal_status,shift.status AS shift_status,shift.lifecycle_status AS shift_lifecycle
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     JOIN tenant.pos_terminals terminal ON terminal.organization_id=cart.organization_id AND terminal.id=cart.terminal_id
     JOIN tenant.pos_shifts shift ON shift.organization_id=cart.organization_id AND shift.id=cart.shift_id
     WHERE cart.organization_id=$1 AND cart.id=$2
     FOR UPDATE OF cart`,
    [context.organizationId, cartId],
  );
  const cart = cartResult.rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  // F268-F273: same store-assignment boundary as every other
  // cart operation (see features/cart.js's lockCart/getPosCart) -- this
  // query is a bespoke SELECT rather than a call into lockCart, so it needs
  // its own check.
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  // Cash is taken only where the outlet accepts it and the terminal manages cash (card, UPI and the rest are checked when initiated).
  if (cashLegs.length && !(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "cash")))
    throw posError(409, 'Payment method "cash" is not available on this terminal.', "PAYMENT_METHOD_NOT_AVAILABLE");
  if (cart.status !== "priced") {
    throw posError(409, `This cart is ${cart.status} and cannot be completed.`, "POS_CART_NOT_PRICED");
  }
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(cart.version)) {
    throw posError(409, "This cart changed since you last loaded it. Refresh and try again.", "POS_CART_VERSION_CONFLICT");
  }
  if (cart.shift_status !== "open" || cart.shift_lifecycle !== "OPEN") {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }
  // Shift Opening (0103): new cash is taken only into an open cash session.
  if (cashLegs.length) await assertShiftCashSession(client, context, cart.shift_id);
  if (!cart.store_active || cart.terminal_status !== "active") {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }

  const policy = await loadPosSettingsPolicy(client, context);
  // Cashier Permissions, as of this moment (a permission revoked during the session counts): completing the sale, and every manual
  // discount and price override on the cart within the cashier's limits or allowed by the approval recorded when it was applied.
  await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id });
  await assertPosCartDiscountsAuthorized(client, context, cart);

  const existingLines = await loadPosCartLines(client, context, cartId);
  if (!existingLines.length) throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");

  const nonStock = await nonStockItemIds(client, context, existingLines.map((line) => line.item_id));
  // Stock Reduction (0101): every stock line covered by this checkout's live reservations — an expired one is released and reserved again,
  // never consumed blindly; a line that cannot be covered stops the sale here (the caller keeps the payments and marks stock recovery).
  const { coverage: stockCoverage } = await ensurePosCheckoutStockAllocation(client, context, cart);

  const store = { id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id };
  const cartDiscount = cart.cart_discount_type
    ? { type: cart.cart_discount_type, value: cart.cart_discount_value, reason: cart.cart_discount_reason }
    : null;
  const priced = await priceCartLines(client, context, {
    store,
    policy,
    customerId: cart.customer_id,
    billingAddressId: cart.billing_address_id,
    supplyMode: cart.supply_mode ?? "in_store",
    deliveryStateCode: cart.delivery_state_code ?? null,
    lines: toPosCartPricingInputLines(existingLines),
    cartDiscount,
    couponCode: cart.coupon_code,
    loyaltyRedeemPoints: cart.loyalty_redeem_points,
    expectedTotals: input.expectedGrandTotal != null ? { grandTotal: input.expectedGrandTotal } : undefined,
  });
  // The tax confirmed when checkout began is the tax charged: if anything that decides it changed since (a rate, a registration, the place
  // of supply), the payment is not taken against the old figure — the cashier reviews the bill and starts checkout again.
  if (cart.checkout_tax_hash && cart.checkout_tax_hash !== priced.tax.hash) {
    const stale = posError(409, "Taxes changed. Please review the bill.", "POS_TAX_CALCULATION_STALE");
    stale.details = { grandTotal: priced.totals.grandTotal, taxTotal: priced.totals.taxTotal };
    throw stale;
  }

  // Non-cash legs are locked and validated here (leg belongs to THIS cart,
  // has genuinely reached 'captured', and has not already been consumed by
  // a different sale) -- their amount is always read from the
  // server-owned payment row itself, never from client input.
  const lockedNonCashPayments = nonCashLegs.length ? await lockCapturedCartPaymentLegs(client, context, cartId, nonCashLegs) : [];
  const custodyPayments = [];
  for (const leg of custodyLegs) {
    const held = (await client.query(
      `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 AND cart_id=$3 AND payment_method='cash' FOR UPDATE`, [context.organizationId, leg.paymentId, cartId])).rows[0];
    if (!held) throw posError(404, "That cash payment was not found on this bill.", "POS_PAYMENT_NOT_FOUND");
    if (held.sale_id) throw posError(409, "This payment has already been completed.", "POS_CASH_PAYMENT_ALREADY_COMPLETED");
    if (held.custody_status !== "pending") throw posError(409, "This cash is not in hand on this bill.", "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED");
    custodyPayments.push(held);
  }
  const cashTotal = cashLegs.reduce((sum, leg) => add(sum, leg.amount), decimal(0));
  const nonCashTotal = lockedNonCashPayments.reduce((sum, row) => add(sum, decimal(row.amount)), decimal(0));
  const custodyApplied = custodyPayments.reduce((sum, row) => add(sum, decimal(row.amount)), decimal(0));
  const custodyReceived = custodyPayments.reduce((sum, row) => add(sum, decimal(row.cash_received_amount)), decimal(0));
  const custodyChange = custodyPayments.reduce((sum, row) => add(sum, decimal(row.change_given_amount ?? 0)), decimal(0));
  const paidTotal = add(add(cashTotal, nonCashTotal), custodyApplied);
  const grandTotal = decimal(priced.totals.grandTotal);
  // A single cash tender may be more than the bill: the change goes back; the drawer keeps only the bill.
  let legacyApplied = cashTotal;
  let legacyChange = decimal(0);
  if (isSingleCashTender) {
    if (paidTotal < grandTotal) {
      throw posError(409, "Payment total is less than sale total.", "UNDERPAYMENT");
    }
    legacyApplied = grandTotal;
    legacyChange = sub(cashTotal, grandTotal);
  } else if (paidTotal !== grandTotal) {
    throw posError(
      409,
      `Split/multi-method payments must sum exactly to the sale total (received ${asDatabaseDecimal(paidTotal)}, expected ${asDatabaseDecimal(grandTotal)}).`,
      "POS_PAYMENT_SPLIT_MISMATCH",
    );
  }

  // See the matching comment in completePointOfSale: shared per-organization,
  // not per-terminal, to match pos_sales_organization_id_receipt_number_key.
  const receiptNumber = await nextDocumentNumber(client, context, {
    documentType: "pos_receipt",
    prefix: safeDocumentPrefix(cart.receipt_prefix, "POS"),
  });

  // The buyer as they are now — kept on the sale and never changed afterwards (walk-in: no customer, optional name and address; registered: the
  // customer's billing details and GST registration).
  const buyer = await buildPosBuyerSnapshot(client, context, cart);
  const sale = await client.query(
    `INSERT INTO tenant.pos_sales
      (organization_id,store_id,terminal_id,shift_id,receipt_number,
       customer_id,currency_code,subtotal,discount_total,tax_total,rounding_adjustment,
       grand_total,paid_total,change_total,status,idempotency_key,created_by,completed_at,
       cart_id,coupon_code,loyalty_program_id,loyalty_points_earned,loyalty_redeem_points,loyalty_redeem_amount,
       loyalty_redemption_value_per_point_snapshot,customer_mode,customer_name,buyer_name_snapshot,buyer_tax_details,billing_address_snapshot,tax_treatment_snapshot,
       customer_code_snapshot,customer_type_snapshot,billing_address_id_snapshot,price_list_id_snapshot,
       seller_tax_registration_id,seller_tax_snapshot,place_of_supply_snapshot,supply_mode_snapshot,tax_document_type,taxable_total,tax_breakdown,tax_calculation_hash,tax_date,
       cart_discount_type,cart_discount_value,cart_discount_amount,cart_discount_eligible_base,cart_discount_reason_code,cart_discount_note,cart_discount_approval_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',$15,$16,now(),$17,$18,$19,$20,$21,$22,$23,$24,$25,$25,$26::jsonb,$27::jsonb,$28,$29,$30,$31,$32,
       $33,$34::jsonb,$35,$36,$37,$38,$39::jsonb,$40,$41,$42,$43,$44,$45,$46,$47,$48)
     RETURNING *`,
    [
      context.organizationId,
      cart.store_id,
      cart.terminal_id,
      cart.shift_id,
      receiptNumber,
      cart.customer_id,
      cart.currency_code,
      priced.totals.subtotal,
      priced.totals.discountTotal,
      priced.totals.taxTotal,
      priced.totals.roundingAdjustment,
      priced.totals.grandTotal,
      // Paid = what was handed over (cash received) plus card / UPI; change = the cash given back.
      asDatabaseDecimal(add(add(cashTotal, nonCashTotal), custodyReceived)),
      asDatabaseDecimal(add(legacyChange, custodyChange)),
      input.idempotencyKey,
      context.userId,
      cart.id,
      cart.coupon_code,
      priced.loyalty.programId,
      priced.loyalty.pointsToEarn,
      priced.loyalty.redeemPointsApplied,
      priced.loyalty.redeemAmount,
      priced.loyalty.redemptionValuePerPoint,
      buyer.mode,
      buyer.name,
      buyer.taxDetails ? JSON.stringify(buyer.taxDetails) : null,
      buyer.billingAddress ? JSON.stringify(buyer.billingAddress) : null,
      buyer.taxTreatment,
      buyer.customerCode ?? null,
      buyer.customerType ?? null,
      buyer.billingAddressId ?? null,
      priced.effectivePriceListId ?? null,
      priced.tax.seller?.id ?? null,
      priced.tax.seller ? JSON.stringify(priced.tax.seller) : null,
      priced.tax.placeOfSupply,
      priced.tax.supplyMode,
      priced.tax.documentType,
      priced.tax.taxableTotal,
      JSON.stringify(priced.tax.breakdown),
      priced.tax.hash,
      priced.tax.taxDate,
      // The bill discount as charged (Cart Discounts): entered type and value, the amount, the eligible value, reason and approval.
      decimal(priced.cartDiscount.amount) > 0n ? priced.cartDiscount.type : null,
      decimal(priced.cartDiscount.amount) > 0n ? priced.cartDiscount.value : null,
      decimal(priced.cartDiscount.amount) > 0n ? priced.cartDiscount.amount : null,
      decimal(priced.cartDiscount.amount) > 0n ? priced.cartDiscount.eligibleBase : null,
      decimal(priced.cartDiscount.amount) > 0n ? cart.cart_discount_reason_code ?? null : null,
      decimal(priced.cartDiscount.amount) > 0n ? cart.cart_discount_note ?? null : null,
      decimal(priced.cartDiscount.amount) > 0n ? cart.cart_discount_approval_id ?? null : null,
    ],
  );
  const saleId = sale.rows[0].id;
  // The bill discount's history row is closed with the sale (it stays on the sale, never changed).
  await client.query(
    `UPDATE tenant.pos_cart_adjustments SET status='completed', ended_at=now(), ended_by=$3, updated_at=now(), version=version+1
      WHERE organization_id=$1 AND cart_id=$2 AND status='active'`, [context.organizationId, cart.id, context.userId]);
  // A digital receipt the customer agreed to, queued for sending once the sale is saved (sending never touches the sale itself).
  for (const [channel, destination] of [["email", cart.receipt_contact_email], ["sms", cart.receipt_contact_phone]]) {
    if (destination && cart.receipt_delivery_consent)
      await client.query(`INSERT INTO tenant.pos_receipt_deliveries (organization_id, sale_id, channel, destination, consent, requested_by) VALUES ($1,$2,$3,$4,true,$5)`,
        [context.organizationId, saleId, channel, destination, context.userId]);
  }

  const saleLineIdByLineNumber = new Map();
  for (const [lineIndex, line] of priced.lines.entries()) {
    // The cart line it came from: what the cashier entered for its manual discount, the reason and any approval.
    const cartLine = existingLines[lineIndex] ?? {};
    // The sale line's id is decided first so its stock movements name it. Stock moves in the base unit, from the reservations this checkout
    // holds (one movement per reserved position or batch); its cost comes from Inventory valuation, never from the selling price.
    const saleLineId = randomUUID();
    const coverage = nonStock.has(line.itemId) ? null : stockCoverage.get(cartLine.id);
    if (!nonStock.has(line.itemId) && !coverage) throw posError(409, POS_STOCK_MESSAGES.POS_STOCK_CONSUMPTION_FAILED, "POS_STOCK_CONSUMPTION_FAILED");
    const movementIds = coverage ? await consumePosLineStock(client, context, { checkoutReference: cart.checkout_reference, saleId, saleLineId, coverage }) : [];
    const stockMovement = movementIds.length ? { id: movementIds[0] } : null;
    const totalLineDiscount = asDatabaseDecimal(
      add(
        add(decimal(line.manualDiscountAmount), decimal(line.promotionDiscountAmount)),
        add(decimal(line.couponDiscountAmount), decimal(line.cartDiscountAmount)),
      ),
    );
    const saleLine = await client.query(
      `INSERT INTO tenant.pos_sale_lines
        (organization_id,sale_id,line_number,item_id,description,quantity,unit_price,
         discount_amount,tax_amount,line_total,warehouse_id,warehouse_location_id,batch_id,serial_id,
         stock_movement_id,manual_discount_amount,promotion_discount_amount,coupon_discount_amount,tax_components,
         loyalty_points_earned,loyalty_redeem_points,loyalty_redeem_amount,uom_id,uom_factor,base_quantity,scanned_barcode,sku,
         taxable_amount,hsn_sac_snapshot,tax_category_id,tax_category_code,tax_rate_id,tax_rate,tax_classification,price_includes_tax,place_of_supply,
         gross_amount,list_unit_price,cart_discount_amount,manual_discount_type,manual_discount_value,manual_discount_reason_code,manual_discount_note,manual_discount_approval_id,id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
         $37,$38,$39,$40,$41,$42,$43,$44,$45)
       RETURNING id`,
      [
        context.organizationId,
        saleId,
        line.lineNumber,
        line.itemId,
        line.description,
        line.quantity,
        line.unitPrice,
        totalLineDiscount,
        line.taxAmount,
        line.lineTotal,
        line.warehouseId,
        line.warehouseLocationId,
        line.batchId,
        line.serialId,
        stockMovement?.id ?? null,
        line.manualDiscountAmount,
        line.promotionDiscountAmount,
        line.couponDiscountAmount,
        JSON.stringify(line.taxComponents || []),
        line.loyaltyPointsEarned,
        line.loyaltyRedeemPoints,
        line.loyaltyRedeemAmount,
        line.uomId,
        line.uomFactor,
        line.baseQuantity,
        line.scannedBarcode,
        line.sku,
        line.taxableAmount,
        line.hsnSac ?? null,
        line.taxCategoryId ?? null,
        line.taxCategoryCode ?? null,
        line.taxRateId ?? null,
        line.taxRatePercent ?? null,
        line.taxClassification ?? null,
        Boolean(line.taxInclusive),
        line.placeOfSupply ?? null,
        line.grossAmount,
        line.listPrice,
        line.cartDiscountAmount,
        decimal(line.manualDiscountAmount) > 0n ? line.manualDiscountType ?? "amount" : null,
        decimal(line.manualDiscountAmount) > 0n ? line.manualDiscountValue ?? line.manualDiscountAmount : null,
        decimal(line.manualDiscountAmount) > 0n ? cartLine.manual_discount_reason_code ?? null : null,
        decimal(line.manualDiscountAmount) > 0n ? cartLine.manual_discount_note ?? cartLine.manual_discount_reason ?? null : null,
        decimal(line.manualDiscountAmount) > 0n ? cartLine.manual_discount_approval_id ?? null : null,
        saleLineId,
      ],
    );
    saleLineIdByLineNumber.set(line.lineNumber, saleLine.rows[0].id);
  }

  const cashPaymentIds = [];
  for (const leg of cashLegs) {
    const applied = isSingleCashTender ? legacyApplied : leg.amount;
    const change = isSingleCashTender ? legacyChange : decimal(0);
    const row = await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,sale_id,cart_id,shift_id,store_id,terminal_id,payment_method,amount,status,captured_at,created_by,currency_code,provider_key,
         cash_received_amount,change_due_amount,change_given_amount,cash_receipt_confirmed_at,change_confirmed_at,custody_status,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'cash',$7,'captured',now(),$8,$9,'cash',$10,$11,$11,now(),CASE WHEN $11::numeric > 0 THEN now() END,'completed',now()) RETURNING id`,
      [context.organizationId, saleId, cartId, cart.shift_id, cart.store_id, cart.terminal_id, asDatabaseDecimal(applied), context.userId, cart.currency_code,
        asDatabaseDecimal(leg.amount), asDatabaseDecimal(change)],
    );
    cashPaymentIds.push({ id: row.rows[0].id, received: leg.amount, change });
  }
  // Cash already in hand becomes part of the sale; its movements were recorded when it was received (never twice).
  for (const held of custodyPayments) {
    await client.query(
      `UPDATE tenant.pos_payments SET sale_id=$3,status='captured',captured_at=now(),completed_at=now(),custody_status='completed',custody_resolved_at=now(),finalization_error=NULL,
              version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, held.id, saleId]);
  }
  // F283/F284/F285/F286: each already-captured non-cash leg is attached to
  // the new sale (sale_id=saleId) here, inside the SAME transaction as the
  // sale row itself -- this is also what prevents the leg from ever being
  // reused by a second sale (lockCapturedCartPaymentLegs required
  // sale_id IS NULL under FOR UPDATE, and this update is the only place
  // that ever sets it).
  for (const row of lockedNonCashPayments) {
    await client.query(
      `UPDATE tenant.pos_payments SET sale_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, row.id, saleId],
    );
  }

  // Only the CASH portion of the tender ever touches the till -- a
  // card/UPI/wallet leg is money the provider holds, not physical cash in
  // the drawer. (Bug fixed alongside this feature: this previously
  // recorded the FULL sale grand_total as a cash movement even when a
  // split-tender leg existed, which would have inflated expected-cash
  // reconciliation the moment a non-cash method was ever wired up.)
  for (const tender of cashPaymentIds) {
    for (const [cashEvent, amount] of [["sale_cash_received", tender.received], ["sale_change_given", sub(decimal(0), tender.change)]]) {
      if (amount === 0n) continue;
      const cashMovementNumber = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
      await client.query(
        `INSERT INTO tenant.pos_cash_movements
          (organization_id,shift_id,movement_number,movement_type,amount,reference_type,reference_id,created_by,cash_event,payment_id,terminal_id,store_id,currency_code)
         VALUES ($1,$2,$3,'sale',$4,'pos_sale',$5,$6,$7,$8,$9,$10,$11)`,
        [context.organizationId, cart.shift_id, cashMovementNumber, asDatabaseDecimal(amount), saleId, context.userId, cashEvent, tender.id, cart.terminal_id, cart.store_id, cart.currency_code],
      );
    }
  }

  if (priced.promotionApplications.length) {
    await commitPosPromotionApplications(client, context, saleId, saleLineIdByLineNumber, priced.promotionApplications, cart.customer_id, cart.store_id);
  }
  if (priced.coupon) {
    await commitPosCouponRedemption(client, context, cartId, saleId, priced.coupon.amount);
  }
  if (cart.customer_id) {
    await commitPosLoyaltyForSale(client, context, {
      saleId,
      customerId: cart.customer_id,
      programId: priced.loyalty.programId,
      lines: priced.lines.map((line) => ({ saleLineId: saleLineIdByLineNumber.get(line.lineNumber), points: line.loyaltyPointsEarned })),
      redeemPointsApplied: priced.loyalty.redeemPointsApplied,
    });
  }

  await client.query(
    `UPDATE tenant.pos_carts SET status='completed',completed_sale_id=$3,completed_at=now(),version=version+1,updated_at=now(),updated_by=$4,
            checkout_started_at=NULL,checkout_expires_at=NULL,checkout_started_by=NULL
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, saleId, context.userId],
  );
  await cartEvent(client, context, cartId, "completed", `Completed as receipt ${receiptNumber}`, { saleId, grandTotal: priced.totals.grandTotal });
  await resolvePosStockRecovery(client, context, cartId, "sale_completed");

  await event(client, context, "sale", saleId, "pos.sale.completed", { receiptNumber, grandTotal: priced.totals.grandTotal, cartId });
  await issuePosSaleInvoice(client, context, sale.rows[0].id);
  await issuePosDocument(client, context, "pos_sale", sale.rows[0].id);
  const response = { ...sale.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_sale", aggregateId: saleId });
  return response;
}
