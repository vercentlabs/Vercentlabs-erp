// F297/F298 — offline POS workspace + offline-to-online sync. Unlike the
// original single-index.js version of this module (where the write side
// had to live in index.js itself to avoid a circular import with
// completePointOfSale), this capability owns both halves directly: the
// bounded catalog/price/tax/permission snapshot a device refreshes
// periodically while online, the conflict-queue reads/resolution, AND the
// write-side sync orchestration, which imports completePointOfSale
// directly from the assortment-pricing-customer-and-cart capability the
// same way returns-refunds-and-exchanges/exchange.js imports
// completePosCart from it.
import { requireCompanyRecord } from "../../../core/references.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { completePointOfSale } from "../assortment-pricing-customer-and-cart/sale-completion.js";

// Bound rationale (documented per the task brief's "define and document
// the bound" requirement): a store's assigned sales price list is already
// the complete set of items that terminal can legally sell — nothing
// outside it is checkout-eligible even online — so scoping to it is not
// a lossy truncation of "the whole catalog," it is the correct scope.
// 2000 is then a hard payload-size ceiling on top of that (a device with
// more than 2000 priced, currently-active SKUs at one store is being
// asked to hold an unusually large book; the remainder simply isn't
// offline-sellable until the next snapshot refresh picks up the highest-
// priority slice by our ordering below), keeping the encrypted IndexedDB
// blob and the PBKDF2/AES-GCM round trip bounded and fast on real cashier
// hardware rather than "the whole catalog verbatim."
export const OFFLINE_SNAPSHOT_ITEM_LIMIT = 2000;

// Explicit, surfaced unsupported-while-offline list (task non-negotiable):
// the frontend renders this verbatim as a blocked/disabled-control banner
// rather than letting any of these half-work. Each entry is enforced on
// BOTH sides — the offline checkout UI disables the control, and the
// server-side sync/snapshot code never accepts or fabricates data for it.
export const OFFLINE_UNSUPPORTED_OPERATIONS = Object.freeze([
  Object.freeze({
    code: "NON_CASH_TENDER",
    label: "Card, UPI, wallet, bank transfer or store-credit tender",
    reason:
      "No payment-provider adapter can authoritatively capture non-cash money without a live connection. Only cash is accepted while genuinely offline (mirrors the cash-only pattern already used elsewhere in this POS module for tenders without a configured provider adapter).",
  }),
  Object.freeze({
    code: "CUSTOMER_ASSIGNMENT",
    label: "Attaching a customer to the sale",
    reason:
      "A customer's active/inactive status can change server-side at any time. Offline sales are walk-in (no customer) only; assigning a customer requires a live connection.",
  }),
  Object.freeze({
    code: "COUPON_REDEMPTION",
    label: "Entering a coupon code",
    reason:
      "Coupon usage limits are only safely enforced by the server's own reservation/commit ledger. Coupon codes are not part of the offline snapshot and cannot be redeemed offline.",
  }),
  Object.freeze({
    code: "PROMOTION_APPLICATION",
    label: "Automatic promotions",
    reason:
      "Promotion eligibility can change between the last snapshot refresh and checkout. Offline sales price at snapshot list/unit price plus the cashier's own manual discount only; promotions are evaluated online only.",
  }),
  Object.freeze({
    code: "PRICE_OVERRIDE",
    label: "Manual price override",
    reason:
      "Price override requires live authorization evidence and is disabled for every offline sale regardless of the cashier's permission grant.",
  }),
  Object.freeze({
    code: "LIVE_STOCK_TRUTH",
    label: "Selling beyond the snapshot's last-known stock quantity",
    reason:
      "The offline snapshot's stock figure is a point-in-time copy, not live truth. The offline checkout UI blocks a line quantity beyond that last-known figure, and the server independently re-validates true current stock again at sync time regardless.",
  }),
  Object.freeze({
    code: "RETURNS_EXCHANGES_REFUNDS",
    label: "Returns, exchanges and refunds",
    reason:
      "Not part of the offline checkout workspace. These require the live return/refund workflow and are always blocked while offline.",
  }),
]);

const POS_OFFLINE_PERMISSION_PREFIX = "pos.";

async function ensureOfflineDeviceKey(client, context) {
  const existing = await client.query(
    `SELECT key_material FROM tenant.pos_offline_device_keys
     WHERE organization_id=$1 AND company_id=$2 AND user_id=$3`,
    [context.organizationId, context.companyId, context.userId],
  );
  if (existing.rows[0]) return existing.rows[0].key_material;
  const seed = await client.query(
    `INSERT INTO tenant.pos_offline_device_keys(organization_id,company_id,user_id,key_material)
     VALUES ($1,$2,$3,encode(gen_random_bytes(32),'hex'))
     ON CONFLICT (organization_id,company_id,user_id) DO UPDATE SET rotated_at=tenant.pos_offline_device_keys.rotated_at
     RETURNING key_material`,
    [context.organizationId, context.companyId, context.userId],
  );
  return seed.rows[0].key_material;
}

// Same price-list resolution query sale-completion.js's completePointOfSale/
// resolvePointOfSaleUnitPrice use — kept here as its own small helper both
// because this call site only ever wants the live catalog rate, never the
// priceOverride branch, and to keep the offline-specific price-drift
// concern local to this capability.
export async function currentOfflineCatalogUnitPrice(client, context, store, itemId, quantity) {
  if (!store.price_list_id) return null;
  const price = await client.query(
    `SELECT price_item.rate
     FROM tenant.price_list_items price_item
     JOIN tenant.price_lists price_list
       ON price_list.organization_id=price_item.organization_id
      AND price_list.id=price_item.price_list_id
     WHERE price_item.organization_id=$1
       AND price_item.price_list_id=$2
       AND price_item.item_id=$3
       AND price_item.minimum_quantity<=$4
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
    [context.organizationId, store.price_list_id, itemId, quantity, store.currency_code],
  );
  return price.rows[0] ? Number(price.rows[0].rate) : null;
}

export async function loadOfflineStore(client, context, storeId) {
  const store = await client.query(
    `SELECT * FROM tenant.pos_stores WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, storeId],
  );
  if (!store.rows[0]) throw posError(404, "POS store was not found.", "POS_STORE_NOT_FOUND");
  return store.rows[0];
}

// F297: the bounded catalog/price/tax/permission snapshot a device fetches
// while online and refreshes periodically. Everything in it is a plain,
// versioned, timestamped copy — the client never treats it as live truth
// again once captured (see currentOfflineCatalogUnitPrice above, which the
// WRITE-side sync path re-resolves fresh from the same tables at sync
// time, and OFFLINE_UNSUPPORTED_OPERATIONS above, which the client-side
// checkout UI must render and enforce).
export async function getPosOfflineSnapshot(client, context, { storeId } = {}) {
  requirePermission(context, "pos.offline.sync");
  const store = await requireCompanyRecord(client, context, "pos_store", storeId);
  await assertPosStoreAccess(client, context, store.id);
  if (!store.active) throw posError(409, "This POS store is not active.", "POS_STORE_INACTIVE");

  const settings = await client.query(
    `SELECT allow_negative_stock,allow_price_override,max_line_discount_percent
     FROM tenant.pos_settings WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const policy = settings.rows[0] || { allow_negative_stock: false, allow_price_override: false, max_line_discount_percent: 100 };

  let items = [];
  if (store.price_list_id) {
    const rows = await client.query(
      `SELECT item.id AS item_id,item.code,item.name,item.barcode,item.tax_category_id,
              price_item.rate,price_item.minimum_quantity,
              coalesce(balance.quantity-balance.reserved_quantity,0)::text AS last_known_quantity
       FROM tenant.price_list_items price_item
       JOIN tenant.price_lists price_list
         ON price_list.organization_id=price_item.organization_id
        AND price_list.id=price_item.price_list_id
       JOIN tenant.items item
         ON item.organization_id=price_item.organization_id
        AND item.id=price_item.item_id
        AND item.status='active'
       LEFT JOIN tenant.stock_balances balance
         ON balance.organization_id=item.organization_id
        AND balance.company_id=$2
        AND balance.item_id=item.id
        AND balance.warehouse_id=$3
       WHERE price_item.organization_id=$1
         AND price_item.price_list_id=$4
         AND price_item.status='active'
         AND price_list.status='active'
         AND price_list.price_list_type='sales'
         AND price_list.currency_code=$5
         AND (price_item.valid_from IS NULL OR price_item.valid_from<=current_date)
         AND (price_item.valid_to IS NULL OR price_item.valid_to>=current_date)
         AND (price_list.valid_from IS NULL OR price_list.valid_from<=current_date)
         AND (price_list.valid_to IS NULL OR price_list.valid_to>=current_date)
       ORDER BY item.code ASC
       LIMIT $6`,
      [context.organizationId, context.companyId, store.warehouse_id, store.price_list_id, store.currency_code, OFFLINE_SNAPSHOT_ITEM_LIMIT],
    );
    items = rows.rows.map((row) => ({
      itemId: row.item_id,
      code: row.code,
      name: row.name,
      barcode: row.barcode,
      taxCategoryId: row.tax_category_id,
      unitPrice: Number(row.rate),
      minimumQuantity: Number(row.minimum_quantity),
      lastKnownQuantity: Number(row.last_known_quantity),
    }));
  }

  // A simplified, disclosed subset of the real tax engine (services/api/
  // src/core/tax-engine.js): the full engine resolves seller/buyer state
  // jurisdiction and tax-rule effective dates live from Postgres and is
  // not something that can run correctly offline against a stale copy
  // without risking a wrong-jurisdiction tax figure on the receipt. The
  // offline snapshot instead ships one flat effective rate per tax
  // category (the rate that would apply for this store's own state today)
  // purely for an offline RECEIPT ESTIMATE — the server always re-derives
  // the authoritative tax figure via the full engine inside
  // completePointOfSale at sync time, so this simplification can never
  // under- or over-charge tax in what is actually recorded.
  const taxCategoryIds = [...new Set(items.map((item) => item.taxCategoryId).filter(Boolean))];
  let taxRates = [];
  if (taxCategoryIds.length) {
    const rates = await client.query(
      `SELECT DISTINCT ON (tax_category_id) tax_category_id,rate
       FROM tenant.tax_rates
       WHERE organization_id=$1 AND tax_category_id=ANY($2::uuid[])
         AND (company_id IS NULL OR company_id=$3)
         AND status='active'
         AND (effective_from IS NULL OR effective_from<=current_date)
         AND (effective_to IS NULL OR effective_to>=current_date)
       ORDER BY tax_category_id,company_id NULLS LAST,effective_from DESC NULLS LAST`,
      [context.organizationId, taxCategoryIds, context.companyId],
    );
    taxRates = rates.rows.map((row) => ({ taxCategoryId: row.tax_category_id, rate: Number(row.rate) }));
  }

  const encryptionSeed = await ensureOfflineDeviceKey(client, context);
  const permissions = (context.permissions || []).filter((permission) => permission.startsWith(POS_OFFLINE_PERMISSION_PREFIX));

  return {
    version: `${store.id}:${Date.now()}`,
    generatedAt: new Date().toISOString(),
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      warehouseId: store.warehouse_id,
      currencyCode: store.currency_code,
      priceListId: store.price_list_id,
    },
    policy: {
      allowNegativeStock: Boolean(policy.allow_negative_stock),
      maxLineDiscountPercent: Number(policy.max_line_discount_percent ?? 100),
    },
    items,
    itemLimit: OFFLINE_SNAPSHOT_ITEM_LIMIT,
    itemLimitReached: items.length >= OFFLINE_SNAPSHOT_ITEM_LIMIT,
    taxRatesByCategory: taxRates,
    cashierPermissions: permissions,
    unsupportedOperations: OFFLINE_UNSUPPORTED_OPERATIONS,
    encryptionSeed,
  };
}

export async function listPosOfflineSyncConflicts(client, context, { status = null, storeId = null, limit = 100, offset = 0 } = {}) {
  requirePermission(context, "pos.offline.resolve");
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (status) {
    values.push(status);
    filter += ` AND status=$${values.length}`;
  }
  // Additive: lets the F296 inventory/stock-sync workspace scope its
  // Exceptions tab to the store currently being viewed, the same way every
  // other list here already scopes to a store. Omitted entirely (not just
  // null), this keeps every existing caller's behavior unchanged.
  if (storeId) {
    values.push(storeId);
    filter += ` AND store_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.pos_offline_sync_conflicts
     WHERE organization_id=$1 AND company_id=$2${filter}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function lockPosOfflineSyncConflict(client, context, conflictId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_offline_sync_conflicts
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, conflictId],
  );
  if (!result.rows[0]) throw posError(404, "Offline sync conflict was not found.", "POS_OFFLINE_CONFLICT_NOT_FOUND");
  return result.rows[0];
}

export async function recordPosOfflineSyncConflict(
  client,
  context,
  { localTransactionId, storeId, terminalId, shiftId, conflictType, errorCode, detail, capturedPayload, serverContextSnapshot },
) {
  const result = await client.query(
    `INSERT INTO tenant.pos_offline_sync_conflicts
      (organization_id,company_id,local_transaction_id,store_id,terminal_id,shift_id,cashier_user_id,
       conflict_type,error_code,detail,captured_payload,server_context_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
     ON CONFLICT (organization_id,local_transaction_id) DO UPDATE SET
       conflict_type=EXCLUDED.conflict_type,error_code=EXCLUDED.error_code,detail=EXCLUDED.detail,
       server_context_snapshot=EXCLUDED.server_context_snapshot,updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      localTransactionId,
      storeId || null,
      terminalId || null,
      shiftId || null,
      context.userId,
      conflictType,
      errorCode || null,
      detail || null,
      JSON.stringify(capturedPayload || {}),
      JSON.stringify(serverContextSnapshot || {}),
    ],
  );
  return result.rows[0];
}

// F297/F298 — offline-to-online sync (write side). The non-negotiable this
// function exists to satisfy: a queued offline sale is never completed
// through a parallel sale-creation path — it goes through the exact same
// completePointOfSale pipeline every other flat-lines POS entry point
// uses, which re-derives price/tax/stock/discount-permission/shift-open
// state fresh, under this same transaction, from current Postgres data —
// never from the frozen offline snapshot. Only the one thing
// completePointOfSale itself cannot detect (it always trusts the CURRENT
// catalog rate for a non-override line) — unit-price drift since offline
// capture — is checked explicitly here, up front, before ever attempting
// completion.
const OFFLINE_CONFLICT_CODE_MAP = Object.freeze({
  POS_SHIFT_NOT_OPEN: "shift_closed",
  POS_SALE_ITEM_NOT_FOUND: "item_not_found",
  INSUFFICIENT_STOCK: "insufficient_stock",
  POS_CUSTOMER_NOT_FOUND: "customer_inactive",
  UNDERPAYMENT: "underpayment",
  FORBIDDEN: "permission_denied",
  POS_PRICE_LIST_REQUIRED: "price_changed",
  POS_PRICE_NOT_FOUND: "price_changed",
});

function canonicalOfflineSyncPayload(input) {
  return {
    storeId: input.storeId,
    terminalId: input.terminalId || null,
    shiftId: input.shiftId,
    lines: (Array.isArray(input.lines) ? input.lines : []).map((line) => ({
      itemId: line.itemId,
      variantId: line.variantId || null,
      quantity: Number(line.quantity),
      capturedUnitPrice: Number(line.capturedUnitPrice),
      discountAmount: line.discountAmount != null ? Number(line.discountAmount) : null,
      discountReason: line.discountReason || null,
      description: line.description || null,
      warehouseLocationId: line.warehouseLocationId || null,
      batchId: line.batchId || null,
      serialId: line.serialId || null,
    })),
    payments: (Array.isArray(input.payments) ? input.payments : []).map((payment) => ({
      method: payment.method,
      amount: Number(payment.amount),
    })),
    customerId: null, // F297 scope: customer assignment is unsupported-while-offline (see OFFLINE_UNSUPPORTED_OPERATIONS)
    customerName: input.customerName || null,
    roundingAdjustment: input.roundingAdjustment != null ? Number(input.roundingAdjustment) : 0,
    capturedAt: input.capturedAt || null,
  };
}

function requireLocalTransactionId(value) {
  const localTransactionId = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(localTransactionId)) {
    throw posError(
      400,
      "A globally-unique, client-generated UUID local transaction id is required.",
      "POS_OFFLINE_LOCAL_ID_INVALID",
    );
  }
  return localTransactionId;
}

export async function syncOfflinePosSale(client, context, input = {}) {
  requirePermission(context, "pos.offline.sync");
  const localTransactionId = requireLocalTransactionId(input.localTransactionId);
  const canonicalPayload = canonicalOfflineSyncPayload(input);
  if (canonicalPayload.lines.length === 0) {
    throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");
  }
  if (canonicalPayload.storeId) await assertPosStoreAccess(client, context, canonicalPayload.storeId);

  // A local transaction id already sitting in the conflict queue has not
  // changed outcome just because the device sent it again — surface its
  // current state rather than re-deriving it (a pending conflict needs a
  // human; a resolved one is a terminal, already-known outcome).
  const existing = await client.query(
    `SELECT * FROM tenant.pos_offline_sync_conflicts WHERE organization_id=$1 AND local_transaction_id=$2`,
    [context.organizationId, localTransactionId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.status === "pending") {
      return { outcome: "conflict", localTransactionId, conflictId: row.id, conflictType: row.conflict_type, detail: row.detail, replayed: true };
    }
    if (row.status === "resolved_voided") {
      return { outcome: "voided", localTransactionId, conflictId: row.id, detail: row.resolution_reason, replayed: true };
    }
    return { outcome: "accepted", localTransactionId, sale: { id: row.resolved_sale_id }, replayed: true };
  }

  const captureConflict = async (conflictType, errorCode, detail, serverContextSnapshot = {}) => {
    const conflict = await recordPosOfflineSyncConflict(client, context, {
      localTransactionId,
      storeId: canonicalPayload.storeId,
      terminalId: canonicalPayload.terminalId,
      shiftId: canonicalPayload.shiftId,
      conflictType,
      errorCode,
      detail,
      capturedPayload: canonicalPayload,
      serverContextSnapshot,
    });
    return {
      outcome: "conflict",
      localTransactionId,
      conflictId: conflict.id,
      conflictType: conflict.conflict_type,
      detail: conflict.detail,
      replayed: false,
    };
  };

  // Unsupported-while-offline, mirrored server-side in addition to the
  // offline checkout UI's own block, so a non-cash tender that somehow
  // reached this endpoint becomes a reviewable conflict, not a crash.
  for (const payment of canonicalPayload.payments) {
    if (payment.method !== "cash") {
      return captureConflict(
        "payment_unsupported",
        "POS_OFFLINE_NON_CASH_TENDER",
        `Payment method "${payment.method}" is not available for an offline sale; only cash is supported while offline.`,
      );
    }
  }
  if (canonicalPayload.payments.length === 0) {
    throw posError(400, "At least one payment is required.", "POS_PAYMENT_REQUIRED");
  }

  let store;
  try {
    store = await loadOfflineStore(client, context, canonicalPayload.storeId);
  } catch (error) {
    if (error.code === "POS_STORE_NOT_FOUND" || error.code === "POS_STORE_INACTIVE") {
      return captureConflict("other", error.code, error.message);
    }
    throw error;
  }

  // Price-drift check: see the function-level comment above for why this
  // cannot be left to completePointOfSale alone.
  for (const line of canonicalPayload.lines) {
    let currentPrice;
    try {
      currentPrice = await currentOfflineCatalogUnitPrice(client, context, store, line.itemId, line.quantity);
    } catch {
      currentPrice = null;
    }
    if (currentPrice == null) {
      return captureConflict(
        "price_changed",
        "POS_OFFLINE_PRICE_NOT_FOUND",
        `No active price currently exists for item ${line.itemId}; it may have been removed from the price list since this sale was captured offline.`,
        { itemId: line.itemId },
      );
    }
    const drift = Math.abs(currentPrice - Number(line.capturedUnitPrice));
    if (drift > 0.01) {
      return captureConflict(
        "price_changed",
        "POS_OFFLINE_PRICE_CHANGED",
        `The price for item ${line.itemId} has changed since this sale was captured offline (captured ${line.capturedUnitPrice}, current ${currentPrice}).`,
        { itemId: line.itemId, capturedUnitPrice: line.capturedUnitPrice, currentUnitPrice: currentPrice },
      );
    }
  }

  const saleInput = {
    lines: canonicalPayload.lines.map((line) => ({
      itemId: line.itemId,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.capturedUnitPrice,
      priceOverride: false,
      discountAmount: line.discountAmount,
      discountReason: line.discountReason,
      description: line.description,
      warehouseLocationId: line.warehouseLocationId,
      batchId: line.batchId,
      serialId: line.serialId,
    })),
    payments: canonicalPayload.payments,
    shiftId: canonicalPayload.shiftId,
    customerId: canonicalPayload.customerId,
    customerName: canonicalPayload.customerName,
    currencyCode: store.currency_code,
    roundingAdjustment: canonicalPayload.roundingAdjustment,
    idempotencyKey: localTransactionId,
  };

  let sale;
  try {
    sale = await completePointOfSale(client, context, saleInput);
  } catch (error) {
    const conflictType = OFFLINE_CONFLICT_CODE_MAP[error.code];
    if (conflictType) {
      return captureConflict(conflictType, error.code, error.message);
    }
    throw error;
  }

  return { outcome: "accepted", localTransactionId, sale, replayed: Boolean(sale.replayed) };
}

// Human resolution of a queued conflict: either void the offline attempt
// outright (with a mandatory reason, never silent) or retry it with an
// operator-adjusted line/payment snapshot. A retry re-resolves price fresh
// (an operator who has SEEN the new current price and chosen to proceed is
// exactly the human-in-the-loop this queue exists for) and completes
// through the same completePointOfSale pipeline, under a resolution-scoped
// idempotency key so it can never collide with — or be blocked by — the
// original failed attempt's own idempotency record.
export async function resolvePosOfflineSyncConflict(client, context, conflictId, input = {}) {
  requirePermission(context, "pos.offline.resolve");
  const conflict = await lockPosOfflineSyncConflict(client, context, conflictId);
  if (conflict.store_id) await assertPosStoreAccess(client, context, conflict.store_id);
  if (conflict.status !== "pending") {
    throw posError(409, `This offline sync conflict was already resolved (${conflict.status}).`, "POS_OFFLINE_CONFLICT_ALREADY_RESOLVED");
  }
  const action = String(input.action || "").trim();

  if (action === "void") {
    const reason = String(input.reason || "").trim();
    if (!reason) {
      throw posError(400, "A reason is required to void an offline sale attempt.", "POS_OFFLINE_VOID_REASON_REQUIRED");
    }
    const updated = await client.query(
      `UPDATE tenant.pos_offline_sync_conflicts
       SET status='resolved_voided',resolution_reason=$4,resolved_by=$5,resolved_at=now(),updated_at=now()
       WHERE organization_id=$1 AND company_id=$2 AND id=$3
       RETURNING *`,
      [context.organizationId, context.companyId, conflictId, reason, context.userId],
    );
    await event(client, context, "pos_offline_sync_conflict", conflictId, "pos.offline.sync.voided", {
      localTransactionId: conflict.local_transaction_id,
      reason,
    });
    return updated.rows[0];
  }

  if (action === "retry") {
    const payload = conflict.captured_payload || {};
    const sourceLines = Array.isArray(input.lines) && input.lines.length ? input.lines : payload.lines || [];
    if (sourceLines.length === 0) {
      throw posError(400, "At least one sale line is required to retry.", "POS_SALE_LINES_REQUIRED");
    }
    const store = await loadOfflineStore(client, context, conflict.store_id || payload.storeId);
    const lines = [];
    for (const line of sourceLines) {
      const currentPrice = await currentOfflineCatalogUnitPrice(client, context, store, line.itemId, Number(line.quantity));
      if (currentPrice == null) {
        throw posError(409, `No active price currently exists for item ${line.itemId}.`, "POS_OFFLINE_PRICE_NOT_FOUND");
      }
      lines.push({
        itemId: line.itemId,
        variantId: line.variantId || null,
        quantity: Number(line.quantity),
        unitPrice: currentPrice,
        priceOverride: false,
        discountAmount: line.discountAmount ?? null,
        discountReason: line.discountReason || null,
        description: line.description || null,
        warehouseLocationId: line.warehouseLocationId || null,
        batchId: line.batchId || null,
        serialId: line.serialId || null,
      });
    }
    const saleInput = {
      lines,
      payments: input.payments || payload.payments || [],
      shiftId: input.shiftId || conflict.shift_id || payload.shiftId,
      customerId: null,
      customerName: payload.customerName || null,
      currencyCode: store.currency_code,
      roundingAdjustment: payload.roundingAdjustment || 0,
      idempotencyKey: `${conflict.local_transaction_id}:resolved:${conflict.id}`,
    };
    const sale = await completePointOfSale(client, context, saleInput);
    const updated = await client.query(
      `UPDATE tenant.pos_offline_sync_conflicts
       SET status='resolved_retried',resolution_reason=$4,resolved_sale_id=$5,resolved_by=$6,resolved_at=now(),updated_at=now()
       WHERE organization_id=$1 AND company_id=$2 AND id=$3
       RETURNING *`,
      [context.organizationId, context.companyId, conflictId, input.reason || null, sale.id, context.userId],
    );
    await event(client, context, "pos_offline_sync_conflict", conflictId, "pos.offline.sync.retried", {
      localTransactionId: conflict.local_transaction_id,
      saleId: sale.id,
    });
    return updated.rows[0];
  }

  throw posError(400, "Resolution action must be 'retry' or 'void'.", "POS_OFFLINE_RESOLUTION_ACTION_INVALID");
}
