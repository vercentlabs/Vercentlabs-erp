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
// completePosCart (no cart aggregate involved) -- kept working, not
// rebuilt, per the standing "do not rebuild functionality that already
// works" instruction; both share the private helpers below.
import { nextDocumentNumber } from "../../../core/document-numbering.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, sub, mul, div, percent, max, roundMoney, asDatabaseDecimal, decimal } from "../../../core/decimal.js";
import { resolveTaxRateComponents } from "../../../core/tax-engine.js";
import { postStockMovement as postCanonicalStockMovement } from "../../stock/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import {
  resolveCurrencyDecimalPlaces,
  resolveSellerStateCode,
  resolveBuyerStateCode,
  normalizedDiscountAmount,
  priceCartLines,
  applyCustomerPricingRules,
} from "./cart-pricing.js";
import { loadPosSettingsPolicy, loadPosCartLines, toPosCartPricingInputLines, assertPosCartDiscountsApproved } from "./cart.js";
import { commitPosPromotionApplications } from "./promotions.js";
import { commitPosCouponRedemption } from "./coupons.js";
import { resolveActivePosLoyaltyProgram, computePosLoyaltyEarnPoints, commitPosLoyaltyForSale } from "./loyalty.js";
import { lockCapturedCartPaymentLegs } from "../tender-and-payment-execution/payments.js";

// Sale-line stock issue routes through Stock's own postStockMovement
// (services/api/src/modules/stock/index.js) rather than a local fork, so
// stock_balances and stock_valuation_layers stay authoritative after a
// completed sale — see docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md
// Section 6. The augmented-permissions pattern below mirrors the existing
// precedent in stock/index.js's own completeStockTransfer(): the caller
// already passed requirePermission(context, "pos.sale.create") above, so
// this business operation is what authorizes the resulting stock
// movement — the caller does not need to separately hold stock.issue.

async function stockAvailable(client, context, itemId, warehouseId) {
  const result = await client.query(
    `SELECT coalesce(sum(quantity-reserved_quantity),0)::text AS available
     FROM tenant.stock_balances
     WHERE organization_id=$1 AND company_id=$2
       AND item_id=$3 AND warehouse_id=$4`,
    [context.organizationId, context.companyId, itemId, warehouseId],
  );
  return Number(result.rows[0].available);
}

// Sale-line stock issue routes through Stock's own postStockMovement
// (services/api/src/modules/stock/index.js) rather than a local fork, so
// stock_balances and stock_valuation_layers stay authoritative after a
// completed sale — see docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md
// Section 6. The augmented-permissions pattern below mirrors the existing
// precedent in stock/index.js's own completeStockTransfer(): the caller
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
    if (!policy.allow_price_override) {
      throw posError(409, "Price override is disabled for this company.", "POS_PRICE_OVERRIDE_DISABLED");
    }
    requirePermission(context, "pos.price.override");
    return decimal(requestedPrice);
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
      AND store.company_id=shift.company_id
     JOIN tenant.pos_terminals terminal
       ON terminal.id=shift.terminal_id
      AND terminal.organization_id=shift.organization_id
      AND terminal.company_id=shift.company_id
      AND terminal.store_id=shift.store_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2
       AND shift.id=$3 AND shift.status='open'
       AND store.active=true AND terminal.status='active'
     FOR UPDATE`,
    [context.organizationId, context.companyId, input.shiftId],
  );
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }
  await assertPosStoreAccess(client, context, shift.store_id, shift.terminal_id);

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
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const policy = settings.rows[0] || {
    allow_negative_stock: false,
    allow_price_override: false,
    max_line_discount_percent: 100,
    discount_approval_threshold_percent: 10,
  };

  // F276: reference the authoritative CRM/Sales customer master
  // (tenant.business_parties) rather than trusting a free-text/unvalidated
  // id — a customer record can be organization-shared (company_id IS NULL)
  // or company-specific, matching how Sales/CRM already resolve it, so this
  // is not a plain company_id=$2 equality check like requireCompanyRecord's
  // other kinds. Found via audit: this previously accepted any UUID (or
  // none) with zero validation, alongside an always-trusted free-text
  // customerName. Validated before the line loop so the resolved customer
  // can also supply the buyer's state code for tax-jurisdiction resolution
  // below.
  if (input.customerId) {
    const customer = await client.query(
      `SELECT id FROM tenant.business_parties
       WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2)
         AND id=$3 AND party_type IN ('customer','both') AND status='active'`,
      [context.organizationId, context.companyId, input.customerId],
    );
    if (!customer.rows[0]) {
      throw posError(404, "Selected customer was not found or is not an active customer for this company.", "POS_CUSTOMER_NOT_FOUND");
    }
  }

  // F278/PHASE 4: tax is ALWAYS derived server-side from tenant.tax_rates
  // via the same resolveTaxRateComponents helper Sales' calculateLine
  // uses (services/api/src/core/tax-engine.js) — a client-supplied
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
  const sellerStateCode = await resolveSellerStateCode(client, context);
  const buyerStateCode = await resolveBuyerStateCode(client, context, input.customerId, sellerStateCode);
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
    `SELECT id,name,tax_category_id,group_id FROM tenant.items WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
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

    const warehouseId = line.warehouseId || shift.warehouse_id;
    const available = await stockAvailable(client, context, line.itemId, warehouseId);
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
      // SECURITY (consolidated pass): this legacy flat-lines path has no
      // cart to bind a real maker-checker approval to (F279's approval
      // engine is keyed on a cart id + cart version) -- rather than build
      // a second, weaker approval mechanism just for this deprecated path,
      // an above-threshold discount fails closed here with a clear error
      // directing the caller to the cart-based checkout, which DOES have
      // real supervisor approval. Effective-percent-of-gross computed with
      // fixed-point decimals, the same way the cart path computes it, so a
      // flat amount can't bypass this by not being expressed as a percent.
      if (lineSubtotal > 0n) {
        const percentOfGross = div(mul(discountAmount, decimal(100)), lineSubtotal);
        if (percentOfGross > decimal(policy.discount_approval_threshold_percent ?? 10)) {
          throw posError(
            409,
            `Line ${index + 1} discount above ${policy.discount_approval_threshold_percent ?? 10}% requires supervisor approval — use the cart-based checkout for discounts that need approval.`,
            "POS_DISCOUNT_APPROVAL_REQUIRED",
          );
        }
      }
    }
    const taxableAmount = max(0, sub(lineSubtotal, discountAmount));
    const { taxRate, components } = await resolveTaxRateComponents(client, {
      organizationId: context.organizationId,
      companyId: context.companyId,
      taxCategoryId: item.tax_category_id,
      sellerStateCode,
      buyerStateCode,
      exempt: false,
    });
    let taxableBase = taxableAmount;
    let taxAmount = decimal(0);
    if (taxInclusive && taxRate > 0n) {
      taxableBase = roundMoney(div(mul(taxableAmount, 100), add(100, taxRate)), decimalPlaces);
      taxAmount = sub(taxableAmount, taxableBase);
    } else if (taxRate > 0n) {
      taxAmount = roundMoney(percent(taxableAmount, taxRate), decimalPlaces);
    }
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
        taxableAmount: asDatabaseDecimal(taxableBase),
      })),
      lineTotal: asDatabaseDecimal(lineTotal),
      warehouseId,
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
  const grandTotal = add(sub(subtotal, discountTotal), add(taxTotal, roundingAdjustment));
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
  // shared per company, matching the constraint's actual scope; a
  // terminal's own receipt_prefix still lets it produce visually distinct
  // numbers if configured, but correctness no longer depends on that.
  const receiptNumber = input.receiptNumber || await nextDocumentNumber(client, context, {
    documentType: "pos_receipt",
    prefix: safeDocumentPrefix(shift.receipt_prefix, "POS"),
  });

  const sale = await client.query(
    `INSERT INTO tenant.pos_sales
      (organization_id,company_id,store_id,terminal_id,shift_id,receipt_number,
       customer_id,customer_name,currency_code,subtotal,discount_total,tax_total,
       rounding_adjustment,grand_total,paid_total,change_total,status,
       idempotency_key,created_by,completed_at,loyalty_program_id,loyalty_points_earned,
       loyalty_redemption_value_per_point_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       'completed',$17,$18,now(),$19,$20,$21)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
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
    ],
  );

  const saleLineIdByLineNumberLegacy = new Map();
  for (const line of normalizedLines) {
    const stockMovement = await postCanonicalStockMovement(
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
        (organization_id,sale_id,line_number,item_id,variant_id,description,quantity,
         unit_price,discount_amount,tax_amount,line_total,warehouse_id,
         warehouse_location_id,batch_id,serial_id,stock_movement_id,
         manual_discount_amount,promotion_discount_amount,coupon_discount_amount,tax_components,
         loyalty_points_earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,0,0,$18::jsonb,$19)
       RETURNING id`,
      [
        context.organizationId,
        sale.rows[0].id,
        line.lineNumber,
        line.itemId,
        line.variantId || null,
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
        stockMovement.id,
        String(line.discountAmount),
        JSON.stringify(line.taxComponents || []),
        asDatabaseDecimal(line.loyaltyPointsEarned || decimal(0)),
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

  for (const payment of input.payments) {
    await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,company_id,sale_id,shift_id,payment_method,amount,
         provider_reference,authorization_reference,status,captured_at,created_by)
       VALUES ($1,$2,$3,$4,'cash',$5,NULL,NULL,'captured',now(),$6)`,
      [
        context.organizationId,
        context.companyId,
        sale.rows[0].id,
        input.shiftId,
        asDatabaseDecimal(decimal(payment.amount)),
        context.userId,
      ],
    );
  }

  // Cash tender may exceed the sale total when change is returned. The till
  // retains only the authoritative sale total, so record one net sale cash
  // movement rather than one movement per tender line.
  if (grandTotal > 0n) {
    const cashMovementNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_cash_movement",
      prefix: "CASH",
    });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,
         amount,reference_type,reference_id,created_by)
       VALUES ($1,$2,$3,$4,'sale',$5,'pos_sale',$6,$7)`,
      [
        context.organizationId,
        context.companyId,
        input.shiftId,
        cashMovementNumber,
        asDatabaseDecimal(grandTotal),
        sale.rows[0].id,
        context.userId,
      ],
    );
  }

  await event(client, context, "sale", sale.rows[0].id, "pos.sale.completed", {
    receiptNumber,
    grandTotal: asDatabaseDecimal(grandTotal),
  });
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
  for (const payment of input.payments) {
    const method = String(payment.method || "").trim().toLowerCase();
    if (method === "cash") {
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
  const isSingleCashTender = cashLegs.length === 1 && nonCashLegs.length === 0;

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.sale.complete",
    key: input.idempotencyKey,
    payload: { cartId, ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const cartResult = await client.query(
    `SELECT cart.*,store.warehouse_id,store.currency_code,store.price_list_id,store.active AS store_active,
            terminal.receipt_prefix,terminal.status AS terminal_status,shift.status AS shift_status
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     JOIN tenant.pos_terminals terminal ON terminal.organization_id=cart.organization_id AND terminal.id=cart.terminal_id
     JOIN tenant.pos_shifts shift ON shift.organization_id=cart.organization_id AND shift.id=cart.shift_id
     WHERE cart.organization_id=$1 AND cart.company_id=$2 AND cart.id=$3
     FOR UPDATE OF cart`,
    [context.organizationId, context.companyId, cartId],
  );
  const cart = cartResult.rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  // Phase 2 (F268-F273): same store-assignment boundary as every other
  // cart operation (see features/cart.js's lockCart/getPosCart) -- this
  // query is a bespoke SELECT rather than a call into lockCart, so it needs
  // its own check.
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  if (cart.status !== "priced") {
    throw posError(409, `This cart is ${cart.status} and cannot be completed.`, "POS_CART_NOT_PRICED");
  }
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(cart.version)) {
    throw posError(409, "This cart changed since you last loaded it. Refresh and try again.", "POS_CART_VERSION_CONFLICT");
  }
  if (cart.shift_status !== "open") {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }
  if (!cart.store_active || cart.terminal_status !== "active") {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }

  const policy = await loadPosSettingsPolicy(client, context);
  // F279 requirement K: fail closed on any above-threshold discount that
  // is not backed by a genuine, currently-valid approval decision (see
  // assertPosCartDiscountsApproved in features/cart.js). Checked against
  // `cart` as loaded by the FOR UPDATE query above, so this always sees
  // the cart's authoritative current version.
  await assertPosCartDiscountsApproved(client, context, cart, policy);

  const existingLines = await loadPosCartLines(client, context, cartId);
  if (!existingLines.length) throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");

  for (const line of existingLines) {
    const available = await stockAvailable(client, context, line.item_id, line.warehouse_id);
    if (!policy.allow_negative_stock && available < Number(line.quantity)) {
      const error = posError(409, "Insufficient stock for POS sale.", "INSUFFICIENT_STOCK");
      error.itemId = line.item_id;
      throw error;
    }
  }

  const store = { id: cart.store_id, warehouse_id: cart.warehouse_id, currency_code: cart.currency_code, price_list_id: cart.price_list_id };
  const cartDiscount = cart.cart_discount_type
    ? { type: cart.cart_discount_type, value: cart.cart_discount_value, reason: cart.cart_discount_reason }
    : null;
  const priced = await priceCartLines(client, context, {
    store,
    policy,
    customerId: cart.customer_id,
    lines: toPosCartPricingInputLines(existingLines),
    cartDiscount,
    couponCode: cart.coupon_code,
    loyaltyRedeemPoints: cart.loyalty_redeem_points,
    expectedTotals: input.expectedGrandTotal != null ? { grandTotal: input.expectedGrandTotal } : undefined,
  });

  // Non-cash legs are locked and validated here (leg belongs to THIS cart,
  // has genuinely reached 'captured', and has not already been consumed by
  // a different sale) -- their amount is always read from the
  // server-owned payment row itself, never from client input.
  const lockedNonCashPayments = nonCashLegs.length ? await lockCapturedCartPaymentLegs(client, context, cartId, nonCashLegs) : [];
  const cashTotal = cashLegs.reduce((sum, leg) => add(sum, leg.amount), decimal(0));
  const nonCashTotal = lockedNonCashPayments.reduce((sum, row) => add(sum, decimal(row.amount)), decimal(0));
  const paidTotal = add(cashTotal, nonCashTotal);
  const grandTotal = decimal(priced.totals.grandTotal);
  if (isSingleCashTender) {
    if (paidTotal < grandTotal) {
      throw posError(409, "Payment total is less than sale total.", "UNDERPAYMENT");
    }
  } else if (paidTotal !== grandTotal) {
    throw posError(
      409,
      `Split/multi-method payments must sum exactly to the sale total (received ${asDatabaseDecimal(paidTotal)}, expected ${asDatabaseDecimal(grandTotal)}).`,
      "POS_PAYMENT_SPLIT_MISMATCH",
    );
  }

  // See the matching comment in completePointOfSale: shared per-company,
  // not per-terminal, to match pos_sales_organization_id_receipt_number_key.
  const receiptNumber = await nextDocumentNumber(client, context, {
    documentType: "pos_receipt",
    prefix: safeDocumentPrefix(cart.receipt_prefix, "POS"),
  });

  const sale = await client.query(
    `INSERT INTO tenant.pos_sales
      (organization_id,company_id,store_id,terminal_id,shift_id,receipt_number,
       customer_id,currency_code,subtotal,discount_total,tax_total,rounding_adjustment,
       grand_total,paid_total,change_total,status,idempotency_key,created_by,completed_at,
       cart_id,coupon_code,loyalty_program_id,loyalty_points_earned,loyalty_redeem_points,loyalty_redeem_amount,
       loyalty_redemption_value_per_point_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed',$16,$17,now(),$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
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
      asDatabaseDecimal(paidTotal),
      asDatabaseDecimal(sub(paidTotal, decimal(priced.totals.grandTotal))),
      input.idempotencyKey,
      context.userId,
      cart.id,
      cart.coupon_code,
      priced.loyalty.programId,
      priced.loyalty.pointsToEarn,
      priced.loyalty.redeemPointsApplied,
      priced.loyalty.redeemAmount,
      priced.loyalty.redemptionValuePerPoint,
    ],
  );
  const saleId = sale.rows[0].id;

  const saleLineIdByLineNumber = new Map();
  for (const line of priced.lines) {
    const stockMovement = await postCanonicalStockMovement(
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
        unitCost: line.standardCost || 0,
        referenceType: "pos_sale",
        referenceId: saleId,
        reason: "POS sale issue",
        idempotencyKey: `${input.idempotencyKey}:line:${line.lineNumber}`,
      },
    );
    const totalLineDiscount = asDatabaseDecimal(
      add(
        add(decimal(line.manualDiscountAmount), decimal(line.promotionDiscountAmount)),
        add(decimal(line.couponDiscountAmount), decimal(line.cartDiscountAmount)),
      ),
    );
    const saleLine = await client.query(
      `INSERT INTO tenant.pos_sale_lines
        (organization_id,sale_id,line_number,item_id,variant_id,description,quantity,unit_price,
         discount_amount,tax_amount,line_total,warehouse_id,warehouse_location_id,batch_id,serial_id,
         stock_movement_id,manual_discount_amount,promotion_discount_amount,coupon_discount_amount,tax_components,
         loyalty_points_earned,loyalty_redeem_points,loyalty_redeem_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23)
       RETURNING id`,
      [
        context.organizationId,
        saleId,
        line.lineNumber,
        line.itemId,
        line.variantId,
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
        stockMovement.id,
        line.manualDiscountAmount,
        line.promotionDiscountAmount,
        line.couponDiscountAmount,
        JSON.stringify(line.taxComponents || []),
        line.loyaltyPointsEarned,
        line.loyaltyRedeemPoints,
        line.loyaltyRedeemAmount,
      ],
    );
    saleLineIdByLineNumber.set(line.lineNumber, saleLine.rows[0].id);
  }

  for (const leg of cashLegs) {
    await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,company_id,sale_id,shift_id,payment_method,amount,status,captured_at,created_by)
       VALUES ($1,$2,$3,$4,'cash',$5,'captured',now(),$6)`,
      [context.organizationId, context.companyId, saleId, cart.shift_id, asDatabaseDecimal(leg.amount), context.userId],
    );
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
  if (cashTotal > 0n) {
    const cashMovementNumber = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,amount,reference_type,reference_id,created_by)
       VALUES ($1,$2,$3,$4,'sale',$5,'pos_sale',$6,$7)`,
      [context.organizationId, context.companyId, cart.shift_id, cashMovementNumber, asDatabaseDecimal(cashTotal), saleId, context.userId],
    );
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
    `UPDATE tenant.pos_carts SET status='completed',completed_sale_id=$3,completed_at=now(),version=version+1,updated_at=now(),updated_by=$4
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, saleId, context.userId],
  );

  await event(client, context, "sale", saleId, "pos.sale.completed", { receiptNumber, grandTotal: priced.totals.grandTotal, cartId });
  const response = { ...sale.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_sale", aggregateId: saleId });
  return response;
}
