// POS Real-Time Inventory (0102). What a terminal shows is read from Inventory — the outlet's own warehouse at the terminal's selling location —
// never kept by POS; the database records an "availability changed" event (warehouse, item, version, reason) in every transaction that changes
// stock, reservations, a batch or a location, and terminals subscribed to their outlets' warehouses fetch the authoritative figure again.
//
//   available   eligible on hand (never held, quarantined, damaged, expired, blocked or inactive stock) less active reservations
//   status      IN_STOCK, LOW_STOCK (at or below the item's reorder level for this warehouse, else the outlet's threshold), OUT_OF_STOCK,
//               NOT_TRACKED (services and items not kept in stock — never "out of stock")
//   detail      on hand, reserved and non-sellable only for users who may see Inventory (stock.view) where the outlet shows exact stock
//
// A displayed figure is information: checkout still reserves atomically (Stock Reduction).
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { USABLE_ROW } from "../../stock/index.js";
import { reconcileInventoryBalances } from "../../stock/balances.js";

export const POS_INVENTORY_MESSAGES = Object.freeze({
  POS_INVENTORY_UNAVAILABLE: "Stock cannot be checked right now.",
  POS_INVENTORY_OUT_OF_STOCK: "This product is out of stock at this store.",
  POS_INVENTORY_INSUFFICIENT: "Only the available quantity can be sold.",
  POS_INVENTORY_WAREHOUSE_MISSING: "This store's stock location is not configured.",
  POS_INVENTORY_STALE: "Stock information changed. Checking again.",
  POS_INVENTORY_SYNC_DISCONNECTED: "Live stock updates are disconnected.",
  POS_INVENTORY_SYNC_RECOVERING: "Reconnecting and updating stock.",
  POS_INVENTORY_VERSION_CONFLICT: "Stock changed during Checkout. Please review.",
  POS_INVENTORY_RESERVATION_FAILED: "Stock could not be reserved.",
  POS_INVENTORY_RESERVATION_EXPIRED: "Stock reservation expired. Availability is being checked.",
  POS_INVENTORY_BATCH_UNAVAILABLE: "The selected batch is not available.",
  POS_INVENTORY_SERIAL_UNAVAILABLE: "The selected serial number is unavailable.",
  POS_INVENTORY_PERMISSION_DENIED: "You cannot view this stock location.",
  POS_INVENTORY_RECONCILIATION_REQUIRED: "Stock information needs verification.",
});
const inventoryError = (status, code, message = POS_INVENTORY_MESSAGES[code]) => posError(status, message, code);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privileged = (context) => Boolean(context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (context, permission) => privileged(context) || Boolean(context.permissions?.includes(permission));
const n = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 1e6) / 1e6);
const text = (value) => (value === null || value === undefined ? null : String(n(value)));
const MAX_BULK = 200;

// The outlet (and terminal) whose stock a terminal sees: from a bill, a terminal, an outlet, or the user's open session — always one the user
// may use. Its warehouse must exist and be active.
async function scopeOf(client, context, { cartId = null, terminalId = null, outletId = null } = {}) {
  requirePermission(context, "pos.view");
  let source;
  if (cartId) source = (await client.query(`SELECT store_id, terminal_id FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId])).rows[0];
  else if (terminalId) source = (await client.query(`SELECT store_id, id AS terminal_id FROM tenant.pos_terminals WHERE organization_id=$1 AND id=$2`, [context.organizationId, terminalId])).rows[0];
  else if (outletId) source = { store_id: outletId, terminal_id: null };
  else source = (await client.query(`SELECT store_id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND cashier_user_id=$2 AND status='open'
      ORDER BY opened_at DESC NULLS LAST LIMIT 1`, [context.organizationId, context.userId])).rows[0];
  if (!source) throw inventoryError(404, "POS_INVENTORY_PERMISSION_DENIED", "Choose the store or terminal to check stock for.");
  try { await assertPosStoreAccess(client, context, source.store_id, source.terminal_id); }
  catch { throw inventoryError(403, "POS_INVENTORY_PERMISSION_DENIED"); }
  const row = (await client.query(
    `SELECT store.id AS store_id, store.name AS store_name, warehouse.id AS warehouse_id, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            warehouse.status AS warehouse_status, warehouse.system_role, COALESCE(terminal.selling_location_id, store.selling_location_id) AS location_id,
            COALESCE(settings.low_stock_threshold, 5) AS low_stock_threshold, COALESCE(settings.show_exact_stock_if_authorized, true) AS show_exact
       FROM tenant.pos_stores store
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = store.organization_id AND warehouse.id = store.warehouse_id
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = store.organization_id AND terminal.id = $3
       LEFT JOIN tenant.pos_outlet_product_settings settings ON settings.organization_id = store.organization_id AND settings.store_id = store.id
      WHERE store.organization_id = $1 AND store.id = $2`, [context.organizationId, source.store_id, source.terminal_id ?? null])).rows[0];
  if (!row) throw inventoryError(404, "POS_INVENTORY_PERMISSION_DENIED");
  if (!row.warehouse_id || row.system_role) throw inventoryError(409, "POS_INVENTORY_WAREHOUSE_MISSING");
  return { ...row, terminal_id: source.terminal_id ?? null, detailed: Boolean(row.show_exact) && can(context, "stock.view") };
}

export function posStockStatus({ stocked, available, threshold }) {
  if (!stocked) return "NOT_TRACKED";
  if (available === null || available === undefined) return "UNKNOWN";
  if (available <= 0) return "OUT_OF_STOCK";
  if (threshold !== null && threshold !== undefined && available <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

const STATUS_LABEL = { IN_STOCK: "In Stock", LOW_STOCK: "Low Stock", OUT_OF_STOCK: "Out of Stock", NOT_TRACKED: "Not Tracked", UNKNOWN: "Checking Stock" };
const label = (status, available) => (status === "LOW_STOCK" ? `Only ${n(available)} Left` : STATUS_LABEL[status]);

// Availability of many items at once at one outlet (a product list, a bill): one query for the balances, one for the thresholds, one for the
// versions. Quantities are in the base unit; each row says how fresh it is (inventory version, last change).
async function availabilityAt(client, context, scope, itemIds) {
  const ids = [...new Set(itemIds.filter((id) => UUID.test(String(id))))].slice(0, MAX_BULK);
  if (!ids.length) return new Map();
  const org = context.organizationId;
  const items = (await client.query(
    `SELECT item.id, item.code, item.name, item.tracking_type, item.item_type, item.track_inventory, base.code AS base_uom
       FROM tenant.items item LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[])`, [org, ids])).rows;
  const values = [org, scope.warehouse_id, ids];
  if (scope.location_id) values.push(scope.location_id);
  const [balances, thresholds, versions] = await Promise.all([
    client.query(
      `SELECT balance.item_id, sum(balance.quantity)::text AS on_hand, sum(balance.reserved_quantity)::text AS reserved,
              sum(CASE WHEN ${USABLE_ROW} THEN 0 ELSE balance.quantity END)::text AS non_sellable,
              sum(CASE WHEN ${USABLE_ROW} THEN greatest(balance.quantity - balance.reserved_quantity, 0) ELSE 0 END)::text AS available,
              max(balance.updated_at) AS updated_at
         FROM tenant.stock_balances balance
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.item_id = ANY($3::uuid[])${scope.location_id ? " AND balance.warehouse_location_id = $4" : ""}
        GROUP BY balance.item_id`, values),
    client.query(`SELECT item_id, reorder_level_base_quantity::text AS level FROM tenant.inventory_reorder_rules
        WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = ANY($3::uuid[]) AND enabled`, [org, scope.warehouse_id, ids]),
    client.query(`SELECT item_id, version, updated_at FROM tenant.inventory_availability_versions WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = ANY($3::uuid[])`,
      [org, scope.warehouse_id, ids]),
  ]);
  const balanceOf = new Map(balances.rows.map((row) => [row.item_id, row]));
  const thresholdOf = new Map(thresholds.rows.map((row) => [row.item_id, n(row.level)]));
  const versionOf = new Map(versions.rows.map((row) => [row.item_id, row]));
  const out = new Map();
  for (const item of items) {
    const stocked = item.item_type !== "service" && item.track_inventory !== false;
    const balance = balanceOf.get(item.id);
    const available = stocked ? n(balance?.available ?? 0) : null;
    const threshold = thresholdOf.has(item.id) ? thresholdOf.get(item.id) : n(scope.low_stock_threshold);
    const status = posStockStatus({ stocked, available, threshold });
    const version = versionOf.get(item.id);
    out.set(item.id, {
      itemId: item.id, sku: item.code, name: item.name, warehouseId: scope.warehouse_id, trackingType: (item.tracking_type ?? "none").toUpperCase(), baseUom: item.base_uom,
      stocked, availableQuantity: stocked ? text(available) : null, stockStatus: status, statusLabel: label(status, available), lowStockThreshold: stocked ? text(threshold) : null,
      ...(scope.detailed && stocked ? { onHandQuantity: text(balance?.on_hand ?? 0), reservedQuantity: text(balance?.reserved ?? 0), nonSellableQuantity: text(balance?.non_sellable ?? 0) } : {}),
      inventoryVersion: Number(version?.version ?? 0), lastUpdatedAt: version?.updated_at ?? balance?.updated_at ?? null,
    });
  }
  return out;
}

const scopeView = (scope) => ({ storeId: scope.store_id, storeName: scope.store_name, warehouseId: scope.warehouse_id, warehouseCode: scope.warehouse_code,
  warehouseName: scope.warehouse_name, terminalId: scope.terminal_id, detailed: scope.detailed });

// Many items at once (a product list, a bill's items). input: { itemIds, cartId | terminalId | outletId }.
export async function getPosBulkItemAvailability(client, context, input = {}) {
  const itemIds = Array.isArray(input.itemIds) ? input.itemIds : [];
  if (itemIds.length > MAX_BULK) throw posError(400, `At most ${MAX_BULK} items at a time.`, "POS_INVENTORY_BULK_TOO_LARGE");
  const scope = await scopeOf(client, context, input);
  const rows = await availabilityAt(client, context, scope, itemIds);
  return { ...scopeView(scope), checkedAt: new Date().toISOString(), items: itemIds.map((id) => rows.get(id)).filter(Boolean) };
}

// One item, with its eligible batches and serial numbers when it is tracked (never expired, blocked, held or reserved ones).
export async function getPosItemStock(client, context, itemId, input = {}) {
  const scope = await scopeOf(client, context, input);
  const row = (await availabilityAt(client, context, scope, [itemId])).get(itemId);
  if (!row) throw inventoryError(404, "POS_INVENTORY_OUT_OF_STOCK", "This product was not found.");
  let batches = [];
  let serials = [];
  if (row.stocked && row.trackingType === "BATCH") {
    batches = (await client.query(
      `SELECT batch.id, batch.batch_number, batch.expires_on, sum(greatest(balance.quantity - balance.reserved_quantity, 0))::text AS available
         FROM tenant.stock_balances balance
         JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
        WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.item_id = $3 AND ${USABLE_ROW}${scope.location_id ? " AND balance.warehouse_location_id = $4" : ""}
        GROUP BY batch.id, batch.batch_number, batch.expires_on HAVING sum(greatest(balance.quantity - balance.reserved_quantity, 0)) > 0
        ORDER BY batch.expires_on NULLS LAST, batch.batch_number`, [context.organizationId, scope.warehouse_id, itemId, ...(scope.location_id ? [scope.location_id] : [])])).rows
      .map((batch) => ({ id: batch.id, batchNumber: batch.batch_number, expiresOn: batch.expires_on, availableQuantity: text(batch.available) }));
  }
  if (row.stocked && row.trackingType === "SERIAL") {
    serials = (await client.query(
      `SELECT serial.id, serial.serial_number FROM tenant.stock_serials serial
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = serial.organization_id AND batch.id = serial.batch_id
        WHERE serial.organization_id = $1 AND serial.warehouse_id = $2 AND serial.item_id = $3 AND serial.status = 'available' AND ${USABLE_ROW}
          ${scope.location_id ? "AND serial.warehouse_location_id = $4" : ""}
          AND NOT EXISTS (SELECT 1 FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id AND reservation.status = 'active')
        ORDER BY serial.serial_number LIMIT 200`, [context.organizationId, scope.warehouse_id, itemId, ...(scope.location_id ? [scope.location_id] : [])])).rows
      .map((serial) => ({ id: serial.id, serialNumber: serial.serial_number }));
  }
  return { ...scopeView(scope), ...row, batches, serials, checkedAt: new Date().toISOString() };
}

// A bill's items against what is available now (its own checkout reservation counts as its own): each line's need, what is available, and a
// warning when the bill asks for more. A draft bill reserves nothing; checkout reserves atomically.
export async function getPosCartAvailability(client, context, cartId) {
  const cart = (await client.query(`SELECT id, status, checkout_started_at, checkout_reference FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId])).rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  const scope = await scopeOf(client, context, { cartId });
  const lines = (await client.query(
    `SELECT line.id, line.line_number, line.item_id, line.description, line.quantity, COALESCE(line.base_quantity, line.quantity) AS base_quantity, uom.code AS uom
       FROM tenant.pos_cart_lines line LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.cart_id = $2 ORDER BY line.line_number`, [context.organizationId, cartId])).rows;
  const rows = await availabilityAt(client, context, scope, lines.map((line) => line.item_id));
  const own = new Map(cart.checkout_reference ? (await client.query(
    `SELECT item_id, sum(active_quantity)::text AS held FROM tenant.stock_reservations WHERE organization_id = $1 AND reference_type = 'pos_checkout' AND reference_id = $2
        AND status = 'active' GROUP BY item_id`, [context.organizationId, cart.checkout_reference])).rows.map((row) => [row.item_id, n(row.held)]) : []);
  const needed = new Map();
  for (const line of lines) needed.set(line.item_id, n((needed.get(line.item_id) ?? 0) + Number(line.base_quantity)));
  const out = lines.map((line) => {
    const row = rows.get(line.item_id);
    const available = row?.stocked ? n(Number(row.availableQuantity) + (own.get(line.item_id) ?? 0)) : null;
    const short = row?.stocked && available < needed.get(line.item_id);
    return { lineId: line.id, lineNumber: line.line_number, itemId: line.item_id, description: line.description, quantity: text(line.quantity), uom: line.uom,
      baseQuantity: text(line.base_quantity), itemNeeded: text(needed.get(line.item_id)), availableQuantity: row?.stocked ? text(available) : null, reservedForThisBill: text(own.get(line.item_id) ?? 0),
      stockStatus: row?.stockStatus ?? "UNKNOWN", statusLabel: row?.statusLabel ?? STATUS_LABEL.UNKNOWN, inventoryVersion: row?.inventoryVersion ?? 0,
      warning: short ? { code: available > 0 ? "POS_INVENTORY_INSUFFICIENT" : "POS_INVENTORY_OUT_OF_STOCK",
        message: available > 0 ? `Only ${available} available at this store. Reduce the quantity to continue.` : POS_INVENTORY_MESSAGES.POS_INVENTORY_OUT_OF_STOCK } : null };
  });
  return { ...scopeView(scope), cartId, inCheckout: Boolean(cart.checkout_started_at), ok: out.every((line) => !line.warning), checkedAt: new Date().toISOString(), lines: out };
}

// The warehouses a user's stream may hear: those of the outlets they may use (one outlet when asked, after checking access). Re-derived from the
// session each time — never from a channel name the client sends.
export async function authorizedPosInventoryScope(client, context, { outletId = null, terminalId = null } = {}) {
  requirePermission(context, "pos.view");
  if (outletId || terminalId) {
    const scope = await scopeOf(client, context, { outletId, terminalId });
    return { warehouseIds: [scope.warehouse_id], storeIds: [scope.store_id] };
  }
  const stores = await accessiblePosStoreIds(client, context);
  const rows = (await client.query(
    `SELECT id, warehouse_id FROM tenant.pos_stores WHERE organization_id = $1 AND warehouse_id IS NOT NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [context.organizationId, stores])).rows;
  return { warehouseIds: [...new Set(rows.map((row) => row.warehouse_id))], storeIds: rows.map((row) => row.id) };
}

// The change feed behind the live stream (and the polling fallback): events after a cursor for the authorised warehouses — plus the last few
// seconds again, so an event from a transaction that committed after a later one is never missed (the client ignores versions it has).
// Marks first delivery. input: { after (sequence), outletId?, terminalId?, recentSeconds? }.
export async function listPosInventoryChanges(client, context, input = {}) {
  const scope = await authorizedPosInventoryScope(client, context, input);
  const after = input.after === null || input.after === undefined || input.after === "" || !Number.isFinite(Number(input.after)) ? null : Math.max(0, Math.floor(Number(input.after)));
  const recent = Math.min(Math.max(Number(input.recentSeconds ?? 10), 0), 60);
  if (!scope.warehouseIds.length) return { cursor: after ?? 0, events: [], warehouseIds: [] };
  const latest = Number((await client.query(`SELECT COALESCE(max(sequence), 0) AS latest FROM tenant.inventory_availability_events WHERE organization_id = $1`,
    [context.organizationId])).rows[0].latest);
  // A new subscriber starts at the present: it fetches current availability itself.
  if (after === null) return { cursor: latest, events: [], warehouseIds: scope.warehouseIds };
  const events = (await client.query(
    `SELECT id, sequence, warehouse_id, item_id, inventory_version, reason, occurred_at FROM tenant.inventory_availability_events
      WHERE organization_id = $1 AND warehouse_id = ANY($2::uuid[]) AND (sequence > $3 OR occurred_at >= now() - make_interval(secs => $4))
      ORDER BY sequence LIMIT 500`, [context.organizationId, scope.warehouseIds, after, recent])).rows;
  const fresh = events.filter((row) => Number(row.sequence) > after).map((row) => row.id);
  if (fresh.length) await client.query(`UPDATE tenant.inventory_availability_events SET published_at = now() WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND published_at IS NULL`,
    [context.organizationId, fresh]);
  return {
    cursor: Math.max(after, ...events.map((row) => Number(row.sequence))), warehouseIds: scope.warehouseIds,
    events: events.map((row) => ({ eventId: row.id, sequence: Number(row.sequence), eventType: "INVENTORY_AVAILABILITY_CHANGED", warehouseId: row.warehouse_id, itemId: row.item_id,
      inventoryVersion: Number(row.inventory_version), reason: row.reason, occurredAt: row.occurred_at })),
  };
}

// Is live stock healthy? Events in the last hour, how quickly they reached a terminal, anything committed but never delivered, and whether
// Inventory's balances still agree with its ledger and reservations.
export async function getPosInventorySyncHealth(client, context) {
  requirePermission(context, "pos.view");
  if (!can(context, "stock.view")) throw inventoryError(403, "POS_INVENTORY_PERMISSION_DENIED");
  const stats = (await client.query(
    `SELECT count(*) FILTER (WHERE occurred_at >= now() - interval '1 hour')::int AS last_hour,
            count(*) FILTER (WHERE published_at IS NULL AND occurred_at < now() - interval '1 minute')::int AS undelivered,
            COALESCE(max(sequence), 0) AS latest, max(occurred_at) AS last_event_at,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM published_at - occurred_at)) FILTER (WHERE published_at IS NOT NULL AND occurred_at >= now() - interval '1 hour') AS p95_seconds
       FROM tenant.inventory_availability_events WHERE organization_id = $1`, [context.organizationId])).rows[0];
  const reconciliation = await reconcileInventoryBalances(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "stock.view"])] });
  const issues = reconciliation.quantity.length + reconciliation.reservations.length + reconciliation.serials.length + reconciliation.ineligibleReservations.length;
  return {
    checkedAt: new Date().toISOString(), eventsLastHour: stats.last_hour, undeliveredOverOneMinute: stats.undelivered, latestSequence: Number(stats.latest), lastEventAt: stats.last_event_at,
    deliveryP95Seconds: stats.p95_seconds === null ? null : Math.round(Number(stats.p95_seconds) * 1000) / 1000,
    reconciliation: { consistent: reconciliation.consistent, issues, quantity: reconciliation.quantity.length, reservations: reconciliation.reservations.length,
      serials: reconciliation.serials.length, ineligibleReservations: reconciliation.ineligibleReservations.length },
    status: issues ? "RECONCILIATION_REQUIRED" : stats.undelivered ? "DELAYED" : "HEALTHY",
  };
}

// Housekeeping (worker): change events are only for live delivery; they are kept for two days.
export async function prunePosInventoryEvents(client, organizationId, { keepHours = 48 } = {}) {
  const { rowCount } = await client.query(`DELETE FROM tenant.inventory_availability_events WHERE organization_id = $1 AND occurred_at < now() - make_interval(hours => $2)`,
    [organizationId, keepHours]);
  return { removed: rowCount ?? 0 };
}
