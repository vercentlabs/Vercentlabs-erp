// Physical Inventory / Stock Count: verifying recorded stock against what physically exists in one warehouse, and turning confirmed differences
// into one linked Stock Adjustment. The count discovers and proves discrepancies; the adjustment corrects them — a count never moves stock.
//
// Scope: the whole warehouse, some locations, or some items (optionally in some locations). Draft → In Progress (Start captures the system stock
// of every position in scope — quantity, balance version, last movement — generates the lines and freezes the scope with count locks that every
// stock movement and new reservation checks) → Ready for Review → Completed (the variances posted as one Stock Adjustment through the adjustment
// engine — gains and losses each with their reason, reservation conflicts resolved in the same posting — and the locks released), or Cancelled.
// Blank is not counted, zero is counted and none found. Every attempt is kept: a recount adds one, never overwrites. Serial numbers are counted by
// identity (present, missing, unexpected), so equal totals with different serial numbers are still a discrepancy. A blind count hides the system
// quantity from whoever may not see it. A completed count is never edited; a later difference is a new count.
import { STOCK_COUNT_PERMISSIONS as P } from "@vercentlabs/permissions";

import { decimal, formatDecimal, roundMoney } from "../../core/decimal.js";
import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { buildXlsxWorkbook, isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { createInventoryAdjustment, getAdjustmentImpact, listAdjustmentReasons, postInventoryAdjustment, updateDraftAdjustment } from "./adjustments.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { dispositionAt } from "./ledger-posting.js";
import { ledgerLocation, validateWarehouseOperation } from "./warehouses.js";

export class CountError extends Error {
  constructor(status, message, code = "COUNT_ERROR", details = undefined) {
    super(message);
    this.name = "CountError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const COUNT_TYPES = Object.freeze([
  { id: "full_warehouse", label: "Full warehouse" }, { id: "locations", label: "Locations" }, { id: "items", label: "Selected items" },
]);
export const COUNT_STATUSES = Object.freeze([
  { id: "draft", label: "Draft" }, { id: "in_progress", label: "In progress" }, { id: "ready_for_review", label: "Ready for review" }, { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
]);
export const RESOLUTION_TYPES = Object.freeze([
  { id: "stock_adjustment", label: "Stock adjustment" }, { id: "location_transfer", label: "Location transfer" }, { id: "disposition_movement", label: "Disposition movement" },
  { id: "manual_investigation", label: "Manual investigation" }, { id: "no_action", label: "No action" },
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = 0n;
const UNIT = 1000000n;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new CountError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const fail = (field, message, code = "COUNT_VALIDATION", status = 400) => { throw new CountError(status, message, code, { issues: [{ field, message }] }); };
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) fail(label, `${label} is not valid.`); return id; };
const optionalUuid = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const dec = (value) => { const out = formatDecimal(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); return out === "-0" ? "0" : out; };
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const ADJUSTMENT_RIGHTS = ["stock.adjustments.view", "stock.adjustments.create", "stock.adjustments.edit", "stock.adjustments.count", "stock.adjustments.post_increase",
  "stock.adjustments.post_decrease", "stock.adjustments.restricted", "stock.adjustments.batch", "stock.adjustments.serial", "stock.adjustments.backdate"];
// The count is what authorizes its adjustment: its completer needs Complete (and, for reservation conflicts, its own permission), not the adjustment rights.
const adjustmentContext = (c, { resolve = false, large = false } = {}) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), ...ADJUSTMENT_RIGHTS,
  ...(resolve ? ["stock.adjustments.resolve_reservations"] : []), ...(large ? ["stock.adjustments.post_large"] : []),
  ...(can(c, "stock.adjustments.manual_cost") ? ["stock.adjustments.manual_cost"] : []), ...(can(c, "stock.adjustments.zero_cost") ? ["stock.adjustments.zero_cost"] : [])])] });

async function event(client, c, countId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.physical_inventory_count_events (organization_id, count_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, countId, eventType, String(summary).slice(0, 1000), JSON.stringify(details), c.userId ?? null]);
}
async function stocked(work, label) {
  try { return await work(); } catch (error) {
    if (error instanceof StockError || String(error?.code ?? "").startsWith("WAREHOUSE_")) throw new CountError(error.status ?? 409, `${label}: ${error.message}`, error.code ?? "COUNT_STOCK_FAILED");
    throw error;
  }
}

async function loadCount(client, c, countId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.physical_inventory_counts WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(countId, "Stock count")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new CountError(404, "Stock count not found.", "COUNT_NOT_FOUND");
  return row;
}
const requireStatus = (row, ...allowed) => {
  if (!allowed.includes(row.status))
    throw new CountError(409, `This count is ${COUNT_STATUSES.find((entry) => entry.id === row.status)?.label.toLowerCase() ?? row.status}; that needs it ${allowed.map((status) => COUNT_STATUSES.find((entry) => entry.id === status)?.label.toLowerCase()).join(" or ")}.`,
      row.status === "completed" ? "COUNT_COMPLETED" : "COUNT_STATE_INVALID");
};

// ------------------------------------------------------------------ the freeze

// The active count lock covering a stock position (warehouse, location — null is MAIN — and item), if any. Inventory calls this on every
// movement and new reservation; the count's own adjustment passes its count.
export async function activeCountLock(client, organizationId, { warehouseId, locationId, itemId, exceptCountId = null }) {
  return (await client.query(
    `SELECT lock.count_id, count.document_number FROM tenant.inventory_count_locks lock
       JOIN tenant.physical_inventory_counts count ON count.id = lock.count_id
      WHERE lock.organization_id = $1 AND lock.warehouse_id = $2 AND lock.released_at IS NULL
        AND (NOT lock.location_scoped OR lock.location_id IS NOT DISTINCT FROM $3) AND (lock.item_id IS NULL OR lock.item_id = $4)
        AND ($5::uuid IS NULL OR lock.count_id <> $5) LIMIT 1`, [organizationId, warehouseId, locationId ?? null, itemId, exceptCountId])).rows[0] ?? null;
}

// ------------------------------------------------------------------ drafts

// Scope: count_type full_warehouse (nothing more), locations (locationIds; MAIN allowed), items (itemIds, optionally in locationIds).
async function readScope(client, c, warehouseId, type, input) {
  if (!COUNT_TYPES.some((entry) => entry.id === type)) fail("countType", "Choose the scope: the full warehouse, some locations or some items.");
  if (type === "full_warehouse") return [];
  const locations = [];
  for (const raw of Array.isArray(input.locationIds) ? input.locationIds : []) {
    const id = uuid(raw, "Location");
    const ledger = await stocked(() => ledgerLocation(client, c.organizationId, warehouseId, id, { label: "Location" }), "Location");
    if (!locations.some((entry) => entry === ledger)) locations.push(ledger);
  }
  if (type === "locations") {
    if (!locations.length) fail("locationIds", "Choose the locations to count.", "COUNT_SCOPE_REQUIRED");
    return locations.map((locationId) => ({ locationScoped: true, locationId, itemId: null }));
  }
  const items = [];
  for (const raw of Array.isArray(input.itemIds) ? input.itemIds : []) {
    const item = (await client.query(`SELECT id, name, track_inventory FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(raw, "Item")])).rows[0];
    if (!item) fail("itemIds", "An item was not found.", "COUNT_VALIDATION", 404);
    if (!item.track_inventory) fail("itemIds", `${item.name} is not a stock item; only inventory-tracked items are counted.`, "COUNT_ITEM_NOT_STOCKED", 409);
    if (!items.includes(item.id)) items.push(item.id);
  }
  if (!items.length) fail("itemIds", "Choose the items to count.", "COUNT_SCOPE_REQUIRED");
  return locations.length ? items.flatMap((itemId) => locations.map((locationId) => ({ locationScoped: true, locationId, itemId })))
    : items.map((itemId) => ({ locationScoped: false, locationId: null, itemId }));
}

async function readHeader(client, c, input, current = null) {
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column] ?? null);
  const warehouseId = optionalUuid(keep("warehouseId", "warehouse_id"), "Warehouse");
  if (!warehouseId) fail("warehouseId", "Choose the warehouse to count.");
  await stocked(() => validateWarehouseOperation(client, c, warehouseId, "adjust", { label: "Warehouse" }), "Warehouse");
  const threshold = keep("recountThresholdPercent", "recount_threshold_percent");
  const recount = threshold === null || threshold === "" ? null : Number(threshold);
  if (recount !== null && (!Number.isFinite(recount) || recount < 0 || recount > 100)) fail("recountThresholdPercent", "The recount threshold is a percentage from 0 to 100.");
  const assigned = optionalUuid(keep("assignedUserId", "assigned_user_id"), "Counter");
  if (assigned && !(await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, assigned]).catch(() => ({ rows: [1] }))).rows[0])
    fail("assignedUserId", "The counter is not a member of this company.");
  return { warehouseId, countType: keep("countType", "count_type") ?? "full_warehouse", blind: has(input, "blindCount") ? Boolean(input.blindCount) : current?.blind_count ?? true,
    recount, assigned, reference: text(keep("reference", "reference"), 120), instructions: text(keep("instructions", "instructions"), 2000) };
}

async function writeScope(client, c, countId, scope) {
  await client.query(`DELETE FROM tenant.physical_inventory_count_scopes WHERE organization_id = $1 AND count_id = $2`, [c.organizationId, countId]);
  for (const entry of scope)
    await client.query(`INSERT INTO tenant.physical_inventory_count_scopes (organization_id, count_id, location_scoped, location_id, item_id) VALUES ($1, $2, $3, $4, $5)`,
      [c.organizationId, countId, entry.locationScoped, entry.locationId, entry.itemId]);
}

// createStockCount. input: { warehouseId, countType, locationIds?, itemIds?, blindCount? (default on), recountThresholdPercent?, assignedUserId?, reference?,
// instructions?, idempotencyKey? }. A draft locks and changes nothing.
export async function createStockCount(client, c, input = {}) {
  need(c, P.create, "You do not have permission to create stock counts.");
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.physical_inventory_counts WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...(await getStockCount(client, c, done.id)), replayed: true };
  }
  const header = await readHeader(client, c, input);
  const scope = await readScope(client, c, header.warehouseId, header.countType, input);
  const number = await nextDocumentNumber(client, c, { documentType: "physical_inventory_count" });
  const id = (await client.query(
    `INSERT INTO tenant.physical_inventory_counts (organization_id, document_number, warehouse_id, count_type, blind_count, assigned_user_id, recount_threshold_percent, reference,
       instructions, idempotency_key, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [c.organizationId, number, header.warehouseId, header.countType, header.blind, header.assigned, header.recount, header.reference, header.instructions, key, c.userId ?? null])).rows[0].id;
  await writeScope(client, c, id, scope);
  await event(client, c, id, "created", `Drafted: ${COUNT_TYPES.find((entry) => entry.id === header.countType).label.toLowerCase()}${header.blind ? ", blind" : ""}`);
  return { ...(await getStockCount(client, c, id)), replayed: false };
}

export async function updateDraftCount(client, c, countId, input = {}) {
  need(c, P.configure, "You do not have permission to configure stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  requireStatus(row, "draft");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new CountError(409, "Someone else changed this count. Reload it.", "COUNT_VERSION_CONFLICT");
  const header = await readHeader(client, c, input, row);
  const scopeChanged = ["warehouseId", "countType", "locationIds", "itemIds"].some((key) => has(input, key));
  if (scopeChanged) await writeScope(client, c, row.id, await readScope(client, c, header.warehouseId, header.countType, input));
  await client.query(
    `UPDATE tenant.physical_inventory_counts SET warehouse_id = $3, count_type = $4, blind_count = $5, assigned_user_id = $6, recount_threshold_percent = $7, reference = $8, instructions = $9,
            version = version + 1, updated_by = $10, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, header.warehouseId, header.countType, header.blind, header.assigned, header.recount, header.reference, header.instructions, c.userId ?? null]);
  await event(client, c, row.id, scopeChanged ? "scope_changed" : "updated", scopeChanged ? "Scope changed" : "Draft changed");
  return getStockCount(client, c, row.id);
}

// ------------------------------------------------------------------ scope: what a count will cover

async function scopeRows(client, c, countId) {
  return (await client.query(`SELECT * FROM tenant.physical_inventory_count_scopes WHERE organization_id = $1 AND count_id = $2`, [c.organizationId, countId])).rows;
}
// The positions in scope (non-zero balances), with what the line needs: item, location (null MAIN), batch, quantity, version, last movement.
async function positionsInScope(client, c, row, scope) {
  const values = [c.organizationId, row.warehouse_id];
  const filter = row.count_type === "full_warehouse" ? "" : `AND EXISTS (SELECT 1 FROM tenant.physical_inventory_count_scopes scope WHERE scope.count_id = $${values.push(row.id)}
       AND (NOT scope.location_scoped OR scope.location_id IS NOT DISTINCT FROM balance.warehouse_location_id) AND (scope.item_id IS NULL OR scope.item_id = balance.item_id))`;
  void scope;
  return (await client.query(
    `SELECT balance.item_id, balance.warehouse_location_id AS location_id, balance.batch_id, balance.quantity, balance.reserved_quantity, balance.version, balance.last_movement_id,
            item.code, item.name, item.tracking_type, item.uom_id, batch.batch_number, batch.status AS batch_status, batch.expires_on, location.code AS location_code
       FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id AND item.track_inventory
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
      WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.quantity <> 0 ${filter}
      ORDER BY location.code NULLS FIRST, item.code, batch.batch_number NULLS FIRST`, values)).rows;
}
// The disposition of a position, as Stock Adjustments will check it: the location's, or expired for a batch past its date or blocked.
async function dispositionOf(client, c, cache, locationId, batch) {
  if (!cache.has(locationId ?? "main")) cache.set(locationId ?? "main", await dispositionAt(client, c.organizationId, locationId ?? null));
  const base = cache.get(locationId ?? "main");
  const today = new Date().toISOString().slice(0, 10);
  if (base === "available" && batch && (batch.status !== "active" || (batch.expires_on && dayOf(batch.expires_on) < today))) return "expired";
  return base;
}
// Serial numbers in stock at a location of the warehouse (null is MAIN, whichever way the serial records it).
async function serialsAt(client, c, warehouseId, itemId, locationId) {
  return (await client.query(
    `SELECT serial.id, serial.serial_number FROM tenant.stock_serials serial
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
      WHERE serial.organization_id = $1 AND serial.warehouse_id = $2 AND serial.item_id = $3 AND serial.status = 'available'
        AND (CASE WHEN location.is_default_storage THEN NULL ELSE serial.warehouse_location_id END) IS NOT DISTINCT FROM $4 ORDER BY serial.serial_number`,
    [c.organizationId, warehouseId, itemId, locationId ?? null])).rows;
}

// Before starting: what the count will cover and freeze — locations, items, positions, batch positions, serial numbers expected, active reservations —
// and any active count it would overlap.
export async function previewCountScope(client, c, countId) {
  need(c, P.view, "You do not have permission to view stock counts.");
  const row = await loadCount(client, c, countId);
  const scope = await scopeRows(client, c, row.id);
  const positions = await positionsInScope(client, c, row, scope);
  const serialItems = positions.filter((entry) => entry.tracking_type === "serial");
  const reservations = (await client.query(
    `SELECT count(*)::int AS count FROM tenant.stock_reservations reservation WHERE reservation.organization_id = $1 AND reservation.warehouse_id = $2 AND reservation.status = 'active'
        AND ($3 = 'full_warehouse' OR EXISTS (SELECT 1 FROM tenant.physical_inventory_count_scopes scope WHERE scope.count_id = $4
          AND (NOT scope.location_scoped OR scope.location_id IS NOT DISTINCT FROM reservation.warehouse_location_id) AND (scope.item_id IS NULL OR scope.item_id = reservation.item_id)))`,
    [c.organizationId, row.warehouse_id, row.count_type, row.id])).rows[0].count;
  const overlaps = await overlappingCounts(client, c, row, scope);
  return {
    locations: new Set(positions.map((entry) => entry.location_id ?? "main")).size, items: new Set(positions.map((entry) => entry.item_id)).size, positions: positions.length,
    batchPositions: positions.filter((entry) => entry.batch_id).length, serialsExpected: Math.round(serialItems.reduce((sum, entry) => sum + Number(entry.quantity), 0)),
    activeReservations: reservations, overlaps: overlaps.map((entry) => entry.document_number),
    freeze: row.count_type === "full_warehouse" ? "The whole warehouse" : `${scope.length} scope entr${scope.length === 1 ? "y" : "ies"} in this warehouse`,
  };
}

// Counts in progress whose locks overlap this count's scope (a full count overlaps everything in its warehouse).
async function overlappingCounts(client, c, row, scope) {
  const entries = row.count_type === "full_warehouse" ? [{ location_scoped: false, location_id: null, item_id: null }] : scope;
  const found = new Map();
  for (const entry of entries) {
    const rows = (await client.query(
      `SELECT DISTINCT count.id, count.document_number FROM tenant.inventory_count_locks lock JOIN tenant.physical_inventory_counts count ON count.id = lock.count_id
        WHERE lock.organization_id = $1 AND lock.warehouse_id = $2 AND lock.released_at IS NULL AND lock.count_id <> $3
          AND (NOT lock.location_scoped OR NOT $4 OR lock.location_id IS NOT DISTINCT FROM $5) AND (lock.item_id IS NULL OR $6::uuid IS NULL OR lock.item_id = $6)`,
      [c.organizationId, row.warehouse_id, row.id, entry.location_scoped, entry.location_id ?? null, entry.item_id ?? null])).rows;
    for (const hit of rows) found.set(hit.id, hit);
  }
  return [...found.values()];
}

// ------------------------------------------------------------------ start

// startStockCount: under the warehouse's count lock, refused if another active count covers any of the same stock; the scope is locked, the
// system stock of every position in scope captured (quantity, balance version, last movement; serial numbers expected), the lines generated, and
// the count is in progress from that cutoff.
export async function startStockCount(client, c, countId) {
  need(c, P.start, "You do not have permission to start stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  if (row.status === "in_progress") return { ...(await getStockCount(client, c, row.id)), replayed: true };
  requireStatus(row, "draft");
  await stocked(() => validateWarehouseOperation(client, c, row.warehouse_id, "adjust", { label: "Warehouse" }), "Warehouse");
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`count-lock:${c.organizationId}:${row.warehouse_id}`]);
  const scope = await scopeRows(client, c, row.id);
  if (row.count_type !== "full_warehouse" && !scope.length) fail("scope", "Choose what the count covers before starting it.", "COUNT_SCOPE_REQUIRED");
  const overlaps = await overlappingCounts(client, c, row, scope);
  if (overlaps.length)
    throw new CountError(409, `Stock in this scope is already under active count ${overlaps.map((entry) => entry.document_number).join(", ")}.`, "COUNT_OVERLAP", { counts: overlaps.map((entry) => entry.document_number) });
  const locks = row.count_type === "full_warehouse" ? [{ location_scoped: false, location_id: null, item_id: null }] : scope;
  for (const entry of locks)
    await client.query(`INSERT INTO tenant.inventory_count_locks (organization_id, count_id, warehouse_id, location_scoped, location_id, item_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.organizationId, row.id, row.warehouse_id, entry.location_scoped, entry.location_id, entry.item_id]);
  const snapshotAt = (await client.query(`SELECT clock_timestamp() AS at`)).rows[0].at;
  const positions = await positionsInScope(client, c, row, scope);
  const cache = new Map();
  const lines = [];
  const serialGroups = new Map();
  for (const position of positions) {
    if (position.tracking_type === "serial") {
      const keyed = `${position.item_id}:${position.location_id ?? "main"}`;
      const group = serialGroups.get(keyed) ?? { position, quantity: 0, version: 0 };
      group.quantity += Number(position.quantity);
      group.version = Math.max(group.version, Number(position.version ?? 0));
      serialGroups.set(keyed, group);
      continue;
    }
    lines.push({ itemId: position.item_id, item: position, locationId: position.location_id, batchId: position.batch_id,
      disposition: await dispositionOf(client, c, cache, position.location_id, position.batch_id ? { status: position.batch_status, expires_on: position.expires_on } : null),
      system: decimal(String(position.quantity)), version: position.version, lastMovement: position.last_movement_id, serials: null });
  }
  for (const group of serialGroups.values())
    lines.push({ itemId: group.position.item_id, item: group.position, locationId: group.position.location_id, batchId: null,
      disposition: await dispositionOf(client, c, cache, group.position.location_id, null), system: decimal(String(group.quantity)), version: group.version, lastMovement: null,
      serials: await serialsAt(client, c, row.warehouse_id, group.position.item_id, group.position.location_id) });
  // A selected item with nothing recorded in scope is still counted: zero expected, so stock found is visible.
  for (const entry of scope.filter((scoped) => scoped.item_id)) {
    if (lines.some((line) => line.itemId === entry.item_id && (!entry.location_scoped || (line.locationId ?? null) === (entry.location_id ?? null)))) continue;
    const item = (await client.query(`SELECT id AS item_id, code, name, tracking_type, uom_id FROM tenant.items WHERE id = $1`, [entry.item_id])).rows[0];
    if (item.tracking_type === "batch") continue;
    lines.push({ itemId: item.item_id, item, locationId: entry.location_id ?? null, batchId: null, disposition: await dispositionOf(client, c, cache, entry.location_id ?? null, null),
      system: ZERO, version: null, lastMovement: null, serials: item.tracking_type === "serial" ? [] : null });
  }
  for (const [index, line] of lines.entries()) {
    const id = (await client.query(
      `INSERT INTO tenant.physical_inventory_count_lines (organization_id, count_id, line_number, item_id, item_snapshot, tracking_type, location_id, disposition, batch_id, base_uom_id,
         system_base_quantity, balance_version_snapshot, last_movement_snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [c.organizationId, row.id, index + 1, line.itemId, JSON.stringify({ code: line.item.code, name: line.item.name }), line.item.tracking_type, line.locationId, line.disposition,
        line.batchId, line.item.uom_id, formatDecimal(line.system), line.version ?? null, line.lastMovement ?? null])).rows[0].id;
    for (const serial of line.serials ?? [])
      await client.query(`INSERT INTO tenant.physical_inventory_serial_counts (organization_id, count_id, line_id, item_id, expected_serial_id, serial_number, location_id, expected)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`, [c.organizationId, row.id, id, line.itemId, serial.id, serial.serial_number, line.locationId]);
  }
  await client.query(`UPDATE tenant.physical_inventory_counts SET status = 'in_progress', snapshot_at = $3, started_by = $4, started_at = now(), version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, snapshotAt, c.userId ?? null]);
  await event(client, c, row.id, "started", `Started: ${lines.length} line${lines.length === 1 ? "" : "s"} captured; ${locks.length} scope lock${locks.length === 1 ? "" : "s"} placed`,
    { lines: lines.length, locks: locks.length });
  return { ...(await getStockCount(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ counting

async function lineOf(client, c, row, lineId) {
  const line = (await client.query(`SELECT * FROM tenant.physical_inventory_count_lines WHERE organization_id = $1 AND count_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, row.id, uuid(lineId, "Count line")])).rows[0];
  if (!line) throw new CountError(404, "That line is not on this count.", "COUNT_LINE_NOT_FOUND");
  return line;
}
const labelOf = (line) => `Line ${line.line_number} (${line.item_snapshot?.code ?? "item"})`;

// Records an attempt and what it means: the line's counted quantity and variance; a first count beyond the recount threshold needs a recount.
async function recordAttempt(client, c, row, line, { entered, uomId, factor, base, source = "manual", notes = null }) {
  const attempt = Number((await client.query(`SELECT COALESCE(max(attempt_number), 0) + 1 AS next FROM tenant.physical_inventory_count_entries WHERE line_id = $1`, [line.id])).rows[0].next);
  await client.query(
    `INSERT INTO tenant.physical_inventory_count_entries (organization_id, line_id, attempt_number, entered_quantity, entered_uom_id, conversion_factor, counted_base_quantity, entry_source,
       notes, counted_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [c.organizationId, line.id, attempt, formatDecimal(entered), uomId, formatDecimal(factor), formatDecimal(base), source, notes, c.userId ?? null]);
  const system = decimal(line.system_base_quantity);
  const variance = base - system;
  const threshold = row.recount_threshold_percent === null ? null : Number(row.recount_threshold_percent);
  const percent = system === ZERO ? null : Math.abs(Number(formatDecimal(variance)) / Number(formatDecimal(system))) * 100;
  const recount = attempt === 1 && line.line_status !== "recount_required" && threshold !== null && percent !== null && percent > threshold;
  await client.query(
    `UPDATE tenant.physical_inventory_count_lines SET counted_base_quantity = $3, variance_base_quantity = $4, line_status = $5, accepted_counted_base_quantity = NULL, version = version + 1,
            updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, line.id, formatDecimal(base), formatDecimal(variance), recount ? "recount_required" : "counted"]);
  await event(client, c, row.id, attempt > 1 ? "recounted" : "counted", `${labelOf(line)}: attempt ${attempt} ${dec(base)}${recount ? ` — variance ${percent.toFixed(1)}% is over the recount threshold` : ""}`,
    { lineId: line.id, attempt, quantity: formatDecimal(base) });
  return { attempt, recount };
}

async function openForCounting(client, c, countId) {
  const row = await loadCount(client, c, countId, { lock: true });
  requireStatus(row, "in_progress");
  return row;
}

// enterCount: what was counted on a line, in any of the item's units. input: { lineId, quantity (blank is not a count: enter 0 for none), uomId?, notes?, source? }.
export async function enterCount(client, c, countId, input = {}) {
  const row = await openForCounting(client, c, countId);
  const line = await lineOf(client, c, row, input.lineId);
  if (line.line_status === "recount_required") need(c, P.recount, "You do not have permission to recount.");
  else need(c, P.count, "You do not have permission to enter counts.");
  if (line.tracking_type === "serial") fail("quantity", `${labelOf(line)}: serial numbers are counted by identity, not by quantity.`, "COUNT_SERIALS_REQUIRED");
  if (line.tracking_type === "batch") need(c, P.countBatch, "You do not have permission to count batches.");
  if (line.line_status === "accepted") throw new CountError(409, `${labelOf(line)} is accepted; request a recount to count it again.`, "COUNT_LINE_ACCEPTED");
  const raw = String(input.quantity ?? "").trim();
  if (raw === "") fail("quantity", `${labelOf(line)}: blank means not counted — enter 0 if none was found.`, "COUNT_QUANTITY_REQUIRED");
  if (!/^\d+(\.\d+)?$/.test(raw)) fail("quantity", `${labelOf(line)}: enter a quantity of zero or more.`, "COUNT_QUANTITY_INVALID");
  const uomId = optionalUuid(input.uomId, "Unit") ?? line.base_uom_id;
  const unit = await normalizeQuantityToBase(client, c.organizationId, line.item_id, uomId, raw, { purpose: "inventory" });
  if (!unit.ok) fail("uomId", `${labelOf(line)}: ${unit.message}`, unit.code ?? "COUNT_UOM_INVALID", 409);
  const result = await recordAttempt(client, c, row, line, { entered: decimal(raw), uomId, factor: decimal(unit.factor), base: unit.baseQuantity,
    source: ["scan", "import"].includes(input.source) ? input.source : "manual", notes: text(input.notes) });
  return { ...result, count: await getStockCount(client, c, row.id) };
}

// enterSerialCount: the serial numbers physically found on a serial line. input: { lineId, presentSerialNumbers, unexpectedSerialNumbers? }. Every
// expected serial number not present is missing; a found one not expected is unexpected — exact identities, not a total.
export async function enterSerialCount(client, c, countId, input = {}) {
  const row = await openForCounting(client, c, countId);
  const line = await lineOf(client, c, row, input.lineId);
  need(c, line.line_status === "recount_required" ? P.recount : P.countSerial, "You do not have permission to count serial numbers.");
  if (line.tracking_type !== "serial") fail("lineId", `${labelOf(line)} is not serial-numbered.`);
  if (line.line_status === "accepted") throw new CountError(409, `${labelOf(line)} is accepted; request a recount to count it again.`, "COUNT_LINE_ACCEPTED");
  const listOf = (value) => (Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/)).map((entry) => String(entry).trim()).filter(Boolean);
  const scanned = [...listOf(input.presentSerialNumbers), ...listOf(input.unexpectedSerialNumbers)];
  const lower = scanned.map((entry) => entry.toLowerCase());
  const twice = lower.find((entry, index) => lower.indexOf(entry) !== index);
  if (twice) fail("serials", `${labelOf(line)}: serial ${scanned[lower.indexOf(twice)]} is scanned twice.`, "COUNT_SERIAL_DUPLICATE");
  const expected = (await client.query(`SELECT * FROM tenant.physical_inventory_serial_counts WHERE organization_id = $1 AND line_id = $2 AND expected`, [c.organizationId, line.id])).rows;
  const present = new Set();
  const unexpected = [];
  for (const number of scanned) {
    const hit = expected.find((entry) => entry.serial_number.toLowerCase() === number.toLowerCase());
    if (hit) { present.add(hit.id); continue; }
    const elsewhere = (await client.query(`SELECT line.line_number, line.item_snapshot FROM tenant.physical_inventory_serial_counts serial JOIN tenant.physical_inventory_count_lines line ON line.id = serial.line_id
        WHERE serial.count_id = $1 AND lower(serial.serial_number) = lower($2) AND serial.line_id <> $3`, [row.id, number, line.id])).rows[0];
    if (elsewhere) fail("serials", `${labelOf(line)}: serial ${number} is counted on line ${elsewhere.line_number} of this count.`, "COUNT_SERIAL_DUPLICATE", 409);
    const known = (await client.query(`SELECT id, item_id, status, warehouse_id, missing_since, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = lower($2)`,
      [c.organizationId, number])).rows[0];
    if (known && known.item_id !== line.item_id) fail("serials", `${labelOf(line)}: serial ${number} belongs to another item.`, "COUNT_SERIAL_INVALID", 409);
    if (known?.status === "available")
      fail("serials", `${labelOf(line)}: serial ${known.serial_number} is in stock elsewhere — that is a location transfer to record, not stock found.`, "COUNT_SERIAL_ELSEWHERE", 409);
    if (known && !known.missing_since) fail("serials", `${labelOf(line)}: serial ${known.serial_number} left stock through a document (sold or issued).`, "COUNT_SERIAL_INVALID", 409);
    unexpected.push({ serialId: known?.id ?? null, serialNumber: known?.serial_number ?? number });
  }
  if (unexpected.length) need(c, P.addUnexpected, "You do not have permission to add unexpected stock.");
  for (const entry of expected)
    await client.query(`UPDATE tenant.physical_inventory_serial_counts SET count_result = $3, scanned_serial_id = CASE WHEN $3 = 'present' THEN expected_serial_id END, counted_by = $4, counted_at = now()
       WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, present.has(entry.id) ? "present" : "missing", c.userId ?? null]);
  await client.query(`DELETE FROM tenant.physical_inventory_serial_counts WHERE organization_id = $1 AND line_id = $2 AND NOT expected`, [c.organizationId, line.id]);
  for (const entry of unexpected)
    await client.query(`INSERT INTO tenant.physical_inventory_serial_counts (organization_id, count_id, line_id, item_id, scanned_serial_id, serial_number, location_id, expected, count_result,
         counted_by, counted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'unexpected', $8, now())`,
      [c.organizationId, row.id, line.id, line.item_id, entry.serialId, entry.serialNumber, line.location_id, c.userId ?? null]);
  const base = BigInt(present.size + unexpected.length) * UNIT;
  const result = await recordAttempt(client, c, row, line, { entered: base, uomId: line.base_uom_id, factor: UNIT, base, source: input.source === "import" ? "import" : "scan",
    notes: `${present.size} present, ${expected.length - present.size} missing, ${unexpected.length} unexpected` });
  return { ...result, count: await getStockCount(client, c, row.id) };
}

// addUnexpectedStock: stock found in scope that the count has no line for. input: { itemId, locationId?, quantity, uomId?, batchId? | batchNumber + newExpiresOn?,
// serialNumbers? (serial items), notes? }.
export async function addUnexpectedStock(client, c, countId, input = {}) {
  need(c, P.addUnexpected, "You do not have permission to add unexpected stock.");
  const row = await openForCounting(client, c, countId);
  const item = (await client.query(`SELECT id, code, name, tracking_type, track_inventory, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, uuid(input.itemId, "Item")])).rows[0];
  if (!item) fail("itemId", "Item not found.", "COUNT_VALIDATION", 404);
  if (!item.track_inventory) fail("itemId", `${item.name} is not a stock item.`, "COUNT_ITEM_NOT_STOCKED", 409);
  const locationId = await stocked(() => ledgerLocation(client, c.organizationId, row.warehouse_id, optionalUuid(input.locationId, "Location"), { label: "Location" }), "Location");
  const inScope = row.count_type === "full_warehouse" || (await client.query(`SELECT 1 FROM tenant.physical_inventory_count_scopes WHERE count_id = $1
      AND (NOT location_scoped OR location_id IS NOT DISTINCT FROM $2) AND (item_id IS NULL OR item_id = $3)`, [row.id, locationId, item.id])).rows[0];
  if (!inScope) fail("itemId", `${item.code} at this location is outside this count's scope.`, "COUNT_OUTSIDE_SCOPE", 409);
  let batchId = null;
  let newBatch = null;
  let batch = null;
  if (item.tracking_type === "batch") {
    if (input.batchId || (input.batchNumber && !input.newExpiresOn && !input.isNewBatch)) {
      batch = (await client.query(`SELECT id, batch_number, status, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND (id::text = $3 OR lower(batch_number) = lower($3))`,
        [c.organizationId, item.id, String(input.batchId ?? input.batchNumber)])).rows[0];
    }
    if (batch) batchId = batch.id;
    else {
      newBatch = text(input.batchNumber, 80);
      if (!newBatch) fail("batchNumber", `${item.name} is batch-tracked: enter the batch found.`, "COUNT_BATCH_REQUIRED");
      if (input.newExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.newExpiresOn))) fail("newExpiresOn", "The expiry is not a valid date.");
    }
  }
  const disposition = await dispositionOf(client, c, new Map(), locationId, batch ? { status: batch.status, expires_on: batch.expires_on } : null);
  const exists = (await client.query(`SELECT line_number FROM tenant.physical_inventory_count_lines WHERE count_id = $1 AND item_id = $2 AND location_id IS NOT DISTINCT FROM $3
      AND batch_id IS NOT DISTINCT FROM $4 AND COALESCE(lower(new_batch_number), '') = COALESCE(lower($5), '')`, [row.id, item.id, locationId, batchId, newBatch])).rows[0];
  if (exists) fail("itemId", `${item.code} here is already on line ${exists.line_number}: enter the count there.`, "COUNT_LINE_EXISTS", 409);
  const lineNumber = Number((await client.query(`SELECT COALESCE(max(line_number), 0) + 1 AS next FROM tenant.physical_inventory_count_lines WHERE count_id = $1`, [row.id])).rows[0].next);
  const id = (await client.query(
    `INSERT INTO tenant.physical_inventory_count_lines (organization_id, count_id, line_number, item_id, item_snapshot, tracking_type, location_id, disposition, batch_id, new_batch_number,
       new_expires_on, base_uom_id, system_base_quantity, is_unexpected, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, true, $13) RETURNING id`,
    [c.organizationId, row.id, lineNumber, item.id, JSON.stringify({ code: item.code, name: item.name }), item.tracking_type, locationId, disposition, batchId, newBatch,
      newBatch ? input.newExpiresOn ?? null : null, item.uom_id, text(input.notes)])).rows[0].id;
  await event(client, c, row.id, "unexpected_added", `Unexpected stock: ${item.code}${newBatch ? ` batch ${newBatch} (new)` : batch ? ` batch ${batch.batch_number}` : ""}`, { lineId: id });
  if (item.tracking_type === "serial") return enterSerialCount(client, c, row.id, { lineId: id, unexpectedSerialNumbers: input.serialNumbers ?? [] });
  return enterCount(client, c, row.id, { lineId: id, quantity: input.quantity, uomId: input.uomId, notes: input.notes });
}

// requestRecount: lines to be counted again (their attempts stay). A count under review goes back to counting. input: { lineIds, reason? }.
export async function requestRecount(client, c, countId, input = {}) {
  need(c, P.requestRecount, "You do not have permission to request recounts.");
  const row = await loadCount(client, c, countId, { lock: true });
  requireStatus(row, "in_progress", "ready_for_review");
  const ids = (Array.isArray(input.lineIds) ? input.lineIds : []).map((id) => uuid(id, "Count line"));
  if (!ids.length) fail("lineIds", "Choose the lines to recount.");
  const updated = (await client.query(`UPDATE tenant.physical_inventory_count_lines SET line_status = 'recount_required', accepted_counted_base_quantity = NULL, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND count_id = $2 AND id = ANY($3::uuid[]) AND line_status IN ('counted', 'accepted') RETURNING line_number`, [c.organizationId, row.id, ids])).rows;
  if (!updated.length) throw new CountError(409, "Only counted lines are recounted.", "COUNT_LINE_NOT_COUNTED");
  if (row.status === "ready_for_review")
    await client.query(`UPDATE tenant.physical_inventory_counts SET status = 'in_progress', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  await event(client, c, row.id, "recount_requested", `Recount requested: line${updated.length === 1 ? "" : "s"} ${updated.map((entry) => entry.line_number).join(", ")}${text(input.reason) ? ` — ${text(input.reason)}` : ""}`);
  return getStockCount(client, c, row.id);
}

// submitStockCount: every line counted (none blank, no recount outstanding) → Ready for Review.
export async function submitStockCount(client, c, countId) {
  need(c, P.submit, "You do not have permission to submit stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  if (row.status === "ready_for_review") return { ...(await getStockCount(client, c, row.id)), replayed: true };
  requireStatus(row, "in_progress");
  const open = (await client.query(`SELECT line_status, count(*)::int AS count FROM tenant.physical_inventory_count_lines WHERE organization_id = $1 AND count_id = $2
      AND line_status IN ('not_counted', 'recount_required') GROUP BY line_status`, [c.organizationId, row.id])).rows;
  if (open.length)
    throw new CountError(409, `${open.map((entry) => `${entry.count} line${entry.count === 1 ? "" : "s"} ${entry.line_status === "not_counted" ? "not counted" : "awaiting a recount"}`).join(" and ")}. Count every line (0 if none found) first.`,
      "COUNT_INCOMPLETE", { open });
  await client.query(`UPDATE tenant.physical_inventory_counts SET status = 'ready_for_review', submitted_by = $3, submitted_at = now(), version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  await event(client, c, row.id, "submitted", "Submitted for review");
  return { ...(await getStockCount(client, c, row.id)), replayed: false };
}

// acceptCountLines: the reviewer accepts counted lines (all counted ones when no lineIds).
export async function acceptCountLines(client, c, countId, input = {}) {
  need(c, P.review, "You do not have permission to review stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  requireStatus(row, "ready_for_review");
  const ids = Array.isArray(input.lineIds) && input.lineIds.length ? input.lineIds.map((id) => uuid(id, "Count line")) : null;
  const accepted = (await client.query(`UPDATE tenant.physical_inventory_count_lines SET line_status = 'accepted', accepted_counted_base_quantity = counted_base_quantity, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND count_id = $2 AND line_status = 'counted' AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[])) RETURNING id`, [c.organizationId, row.id, ids])).rows;
  await event(client, c, row.id, "accepted", `${accepted.length} line${accepted.length === 1 ? "" : "s"} accepted`);
  return getStockCount(client, c, row.id);
}

// setLineResolution: how a variance is corrected. stock_adjustment (default) posts it with the count; a location transfer, disposition movement or
// investigation is done through its own workflow (with a note) and the count leaves it out; for stock found, the cost basis.
// input: { lineId, resolutionType?, note?, valuationSource?, unitCost?, costNote? }
export async function setLineResolution(client, c, countId, input = {}) {
  need(c, P.review, "You do not have permission to review stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  requireStatus(row, "ready_for_review");
  const line = await lineOf(client, c, row, input.lineId);
  const type = has(input, "resolutionType") ? input.resolutionType : line.resolution_type;
  if (!RESOLUTION_TYPES.some((entry) => entry.id === type)) fail("resolutionType", "Choose how the variance is resolved.");
  const note = has(input, "note") ? text(input.note) : line.resolution_note;
  if (type !== "stock_adjustment" && !note) fail("note", "Say how the variance is resolved (which transfer, movement or investigation).", "COUNT_RESOLUTION_NOTE_REQUIRED");
  const source = has(input, "valuationSource") ? (input.valuationSource || null) : line.valuation_source;
  if (source && !["current_valuation_cost", "manual_authorized_cost", "zero_cost_authorized"].includes(source)) fail("valuationSource", "Unknown cost basis.");
  if (source === "manual_authorized_cost") {
    if (!can(c, "stock.adjustments.manual_cost")) throw new CountError(403, "You do not have permission to enter the cost of stock found.", "PERMISSION_DENIED");
    if (!/^\d+(\.\d+)?$/.test(String(input.unitCost ?? line.manual_unit_cost ?? "")) || Number(input.unitCost ?? line.manual_unit_cost) <= 0) fail("unitCost", "Enter the authorized unit cost.", "COUNT_COST_REQUIRED");
  }
  if (source === "zero_cost_authorized" && !can(c, "stock.adjustments.zero_cost")) throw new CountError(403, "You do not have permission to add stock at zero cost.", "PERMISSION_DENIED");
  const costNote = has(input, "costNote") ? text(input.costNote) : line.cost_note;
  if (source && source !== "current_valuation_cost" && !costNote) fail("costNote", "Say where the cost comes from.", "COUNT_COST_REQUIRED");
  await client.query(`UPDATE tenant.physical_inventory_count_lines SET resolution_type = $3, resolution_note = $4, valuation_source = $5, manual_unit_cost = $6, cost_note = $7, version = version + 1,
      updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, line.id, type, note, source, source === "manual_authorized_cost" ? String(input.unitCost ?? line.manual_unit_cost) : null, costNote]);
  await event(client, c, row.id, "resolution", `${labelOf(line)}: ${RESOLUTION_TYPES.find((entry) => entry.id === type).label.toLowerCase()}${note ? ` — ${note}` : ""}`);
  return getStockCount(client, c, row.id);
}

// ------------------------------------------------------------------ variances and the adjustment

async function linesOf(client, c, countId) {
  const lines = (await client.query(
    `SELECT line.*, location.code AS location_code, batch.batch_number, batch.expires_on, uom.code AS base_uom
       FROM tenant.physical_inventory_count_lines line
       LEFT JOIN tenant.warehouse_locations location ON location.id = line.location_id
       LEFT JOIN tenant.stock_batches batch ON batch.id = line.batch_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.base_uom_id
      WHERE line.organization_id = $1 AND line.count_id = $2 ORDER BY line.line_number`, [c.organizationId, countId])).rows;
  const serials = (await client.query(`SELECT * FROM tenant.physical_inventory_serial_counts WHERE organization_id = $1 AND count_id = $2 ORDER BY serial_number`, [c.organizationId, countId])).rows;
  return lines.map((line) => ({ ...line, serials: serials.filter((serial) => serial.line_id === line.id) }));
}

// The variance of each line, by kind: no variance, shortage, gain, missing / unexpected serial numbers, a new batch; and the same item short in
// one place and over in another (stock moved without a transfer, or a disposition recorded wrongly) flagged for the reviewer.
function varianceOf(lines) {
  const out = lines.map((line) => {
    const variance = line.variance_base_quantity === null ? null : n(line.variance_base_quantity);
    const missing = line.serials.filter((serial) => serial.count_result === "missing").length;
    const unexpected = line.serials.filter((serial) => serial.count_result === "unexpected").length;
    const kinds = [];
    if (line.line_status === "recount_required") kinds.push("recount_required");
    if (missing) kinds.push("missing_serial");
    if (unexpected) kinds.push("unexpected_serial");
    if (line.new_batch_number) kinds.push("unexpected_batch");
    if (variance !== null && variance < 0) kinds.push("shortage");
    if (variance !== null && variance > 0) kinds.push("gain");
    if (variance === 0 && !missing && !unexpected) kinds.push("no_variance");
    return { lineId: line.id, variance, missing, unexpected, kinds };
  });
  for (const entry of out) {
    const line = lines.find((candidate) => candidate.id === entry.lineId);
    if (!entry.variance) continue;
    const offset = lines.find((other) => other.id !== line.id && other.item_id === line.item_id && (other.batch_id ?? null) === (line.batch_id ?? null)
      && other.variance_base_quantity !== null && Math.sign(Number(other.variance_base_quantity)) === -Math.sign(entry.variance));
    if (offset) entry.kinds.push("possible_misplacement");
  }
  return out;
}
const correctable = (line) => line.resolution_type === "stock_adjustment" && line.counted_base_quantity !== null
  && (Number(line.variance_base_quantity) !== 0 || line.serials.some((serial) => serial.count_result === "missing" || serial.count_result === "unexpected"));

// The adjustment the count posts: its variance lines (resolved by stock adjustment), grouped as Stock Adjustments needs them — one line per item,
// location and disposition (batches together; serial numbers missing and found) — each with its reason, Physical count gain or loss.
async function adjustmentInput(client, c, row, lines) {
  // The system reasons exist from a company's first use of Stock Adjustments.
  await listAdjustmentReasons(client, { ...c, permissions: [...(c.permissions ?? []), "stock.adjustments.view"] });
  const reasons = Object.fromEntries((await client.query(`SELECT code, id FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND code IN ('PHYSICAL_COUNT_GAIN', 'PHYSICAL_COUNT_LOSS', 'TRACKING_CORRECTION')`,
    [c.organizationId])).rows.map((entry) => [entry.code, entry.id]));
  const groups = new Map();
  for (const line of lines.filter(correctable)) {
    const key = `${line.item_id}:${line.location_id ?? "main"}:${line.disposition}`;
    const group = groups.get(key) ?? { itemId: line.item_id, locationId: line.location_id, disposition: line.disposition, tracking: line.tracking_type, delta: ZERO, batches: [], out: [], in: [],
      valuation: null, notes: [] };
    group.delta += decimal(String(line.variance_base_quantity));
    if (line.tracking_type === "batch" && Number(line.variance_base_quantity) !== 0)
      group.batches.push(line.batch_id ? { batchId: line.batch_id, difference: formatDecimal(decimal(String(line.variance_base_quantity))) }
        : { newBatchNumber: line.new_batch_number, newExpiresOn: dayOf(line.new_expires_on) ?? undefined, difference: formatDecimal(decimal(String(line.variance_base_quantity))) });
    for (const serial of line.serials) {
      if (serial.count_result === "missing") group.out.push(serial.expected_serial_id);
      if (serial.count_result === "unexpected") group.in.push(serial.serial_number);
    }
    if (Number(line.variance_base_quantity) > 0 && !group.valuation && line.valuation_source)
      group.valuation = { valuationSource: line.valuation_source, unitCost: line.manual_unit_cost === null ? undefined : String(line.manual_unit_cost), costNote: line.cost_note ?? undefined };
    if (line.notes) group.notes.push(line.notes);
    groups.set(key, group);
  }
  const entries = [...groups.values()].filter((group) => group.delta !== ZERO || group.out.length || group.in.length || group.batches.length);
  return entries.map((group) => ({
    itemId: group.itemId, locationId: group.locationId, disposition: group.disposition, entryMode: "difference",
    reasonId: group.delta > ZERO ? reasons.PHYSICAL_COUNT_GAIN : group.delta < ZERO ? reasons.PHYSICAL_COUNT_LOSS : reasons.TRACKING_CORRECTION,
    ...(group.tracking === "serial" ? { serialsOut: group.out, serialsIn: group.in } : group.tracking === "batch" ? { batches: group.batches } : { difference: formatDecimal(group.delta) }),
    ...(group.valuation ?? {}), notes: group.notes.join("; ").slice(0, 500) || `Stock count ${row.document_number}`,
  }));
}

async function headerReason(client, c, input) {
  const code = input.some((line) => line.difference?.startsWith?.("-") || line.serialsOut?.length || line.batches?.some((batch) => String(batch.difference).startsWith("-")))
    ? "PHYSICAL_COUNT_LOSS" : "PHYSICAL_COUNT_GAIN";
  return (await client.query(`SELECT id FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND code = $2`, [c.organizationId, code])).rows[0].id;
}

// previewCountAdjustment: the adjustment the count would post, checked against stock as it is now — projected stock per line, reservation conflicts
// (shortfall and the reservations affected), cost bases needed, value impact — without posting anything (prepared and discarded in one savepoint).
export async function previewCountAdjustment(client, c, countId) {
  need(c, P.review, "You do not have permission to review stock counts.");
  const row = await loadCount(client, c, countId);
  if (row.status === "completed") return { adjustmentId: row.linked_adjustment_id, completed: true };
  const lines = await linesOf(client, c, row.id);
  const input = await adjustmentInput(client, c, row, lines);
  if (!input.length) return { lines: 0, ready: true, errors: [], impact: null };
  await client.query("SAVEPOINT count_preview");
  try {
    const ctx = adjustmentContext(c, { resolve: true });
    const draft = await createInventoryAdjustment(client, ctx, { warehouseId: row.warehouse_id, reasonId: await headerReason(client, c, input), countReference: row.document_number,
      notes: `Stock count ${row.document_number}`, lines: input }, { physicalCountId: row.id });
    const impact = await getAdjustmentImpact(client, { ...ctx, permissions: [...ctx.permissions, ...(can(c, P.viewValue) ? ["stock.adjustments.view_cost"] : [])] }, draft.adjustment.id);
    return { lines: input.length, ready: impact.ready, errors: impact.errors, impact };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT count_preview");
  }
}

// completeStockCount: under the count's lock, every line counted, the variances posted as one Stock Adjustment (Physical count gain / loss per
// line, reservation conflicts resolved with the given resolutions, cost bases as reviewed), linked to the count; the count completed and its
// locks released — together, once. A count without variances completes with no adjustment, no movement and no journal. input: { resolutions? }.
export async function completeStockCount(client, c, countId, input = {}) {
  need(c, P.complete, "You do not have permission to complete stock counts.");
  const row = await loadCount(client, c, countId, { lock: true });
  if (row.status === "completed") return { ...(await getStockCount(client, c, row.id)), replayed: true };
  requireStatus(row, "ready_for_review");
  const resolutions = Array.isArray(input.resolutions) ? input.resolutions : [];
  if (resolutions.length) need(c, P.resolveReservations, "You do not have permission to resolve reservation conflicts.");
  const lines = await linesOf(client, c, row.id);
  const open = lines.filter((line) => ["not_counted", "recount_required"].includes(line.line_status));
  if (open.length) throw new CountError(409, `${open.length} line${open.length === 1 ? " is" : "s are"} not counted or awaiting a recount.`, "COUNT_INCOMPLETE");
  const input_ = await adjustmentInput(client, c, row, lines);
  let adjustment = null;
  if (input_.length) {
    const ctx = adjustmentContext(c, { resolve: resolutions.length > 0, large: true });
    const made = await createInventoryAdjustment(client, ctx, { warehouseId: row.warehouse_id, reasonId: await headerReason(client, c, input_), countReference: row.document_number,
      notes: `Stock count ${row.document_number}`, lines: input_, idempotencyKey: `physical-count:${row.id}` }, { physicalCountId: row.id });
    // A draft left by an earlier attempt that did not post is brought up to the count as reviewed now (cost bases, resolutions) before posting.
    if (made.replayed && made.adjustment.status === "draft")
      await updateDraftAdjustment(client, ctx, made.adjustment.id, { lines: input_, expectedVersion: made.adjustment.version });
    adjustment = (await postInventoryAdjustment(client, ctx, made.adjustment.id, { resolutions })).adjustment;
  }
  await client.query(`UPDATE tenant.physical_inventory_count_lines SET line_status = 'accepted', accepted_counted_base_quantity = counted_base_quantity, updated_at = now()
     WHERE organization_id = $1 AND count_id = $2 AND line_status = 'counted'`, [c.organizationId, row.id]);
  await client.query(`UPDATE tenant.inventory_count_locks SET released_at = now() WHERE organization_id = $1 AND count_id = $2 AND released_at IS NULL`, [c.organizationId, row.id]);
  await client.query(`UPDATE tenant.physical_inventory_counts SET status = 'completed', linked_adjustment_id = $3, completed_by = $4, completed_at = now(), version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, adjustment?.id ?? null, c.userId ?? null]);
  await event(client, c, row.id, "completed", adjustment ? `Completed: variances posted as ${adjustment.number}; the freeze is released` : "Completed with no variance: nothing to adjust; the freeze is released",
    { adjustmentId: adjustment?.id ?? null });
  return { ...(await getStockCount(client, c, row.id)), replayed: false };
}

// cancelStockCount: a draft, or a started count with a reason; nothing is adjusted and the freeze is released. Its evidence stays.
export async function cancelStockCount(client, c, countId, input = {}) {
  const row = await loadCount(client, c, countId, { lock: true });
  if (row.status === "cancelled") return { ...(await getStockCount(client, c, row.id)), replayed: true };
  requireStatus(row, "draft", "in_progress", "ready_for_review");
  const reason = text(input.reason);
  if (row.status === "draft") need(c, P.create, "You do not have permission to cancel stock counts.");
  else {
    need(c, P.cancel, "You do not have permission to cancel a started stock count.");
    if (!reason) fail("reason", "Give the reason for cancelling a started count.", "COUNT_REASON_REQUIRED");
  }
  await client.query(`UPDATE tenant.inventory_count_locks SET released_at = now() WHERE organization_id = $1 AND count_id = $2 AND released_at IS NULL`, [c.organizationId, row.id]);
  await client.query(`UPDATE tenant.physical_inventory_counts SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, reason]);
  await event(client, c, row.id, "cancelled", `Cancelled${reason ? `: ${reason}` : ""}; nothing adjusted, the freeze is released`);
  return { ...(await getStockCount(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ count sheets: export and import

const SHEET_COLUMNS = ["Line", "Location", "SKU", "Item", "Batch", "Expiry", "Serial", "UOM", "System Qty", "Counted Qty"];
async function sheetRows(client, c, row, { withSystem }) {
  const lines = await linesOf(client, c, row.id);
  const out = [];
  for (const line of lines) {
    const base = { Line: line.line_number, Location: line.location_code ?? "MAIN", SKU: line.item_snapshot?.code ?? "", Item: line.item_snapshot?.name ?? "",
      Batch: line.batch_number ?? line.new_batch_number ?? "", Expiry: dayOf(line.expires_on ?? line.new_expires_on) ?? "", UOM: line.base_uom ?? "" };
    if (line.tracking_type === "serial") {
      for (const serial of line.serials.filter((entry) => entry.expected))
        out.push({ ...base, Serial: serial.serial_number, ...(withSystem ? { "System Qty": 1 } : {}), "Counted Qty": "" });
      if (!line.serials.some((entry) => entry.expected)) out.push({ ...base, Serial: "", ...(withSystem ? { "System Qty": 0 } : {}), "Counted Qty": "" });
    } else out.push({ ...base, Serial: "", ...(withSystem ? { "System Qty": n(line.system_base_quantity) } : {}), "Counted Qty": "" });
  }
  return out;
}

// exportCountSheet: the count sheet (CSV or XLSX) — every line, serial numbers one per row; the system quantity only on a count that is not blind.
export async function exportCountSheet(client, c, countId, format = "csv") {
  need(c, P.export, "You do not have permission to export count sheets.");
  const row = await loadCount(client, c, countId);
  if (row.status === "draft") throw new CountError(409, "Start the count first: its lines are generated when it starts.", "COUNT_STATE_INVALID");
  const withSystem = !row.blind_count;
  const columns = SHEET_COLUMNS.filter((column) => column !== "System Qty" || withSystem);
  const rows = await sheetRows(client, c, row, { withSystem });
  await event(client, c, row.id, "sheet_exported", `Count sheet exported (${format.toUpperCase()})`);
  const fileName = `${row.document_number}-count-sheet.${format === "xlsx" ? "xlsx" : "csv"}`;
  if (format === "xlsx")
    return { fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buildXlsxWorkbook({ sheetName: "Count", columns: columns.map((column) => ({ label: column, key: column })), rows }) };
  const cell = (value) => { const out = value === null || value === undefined ? "" : String(value); return /[",\n\r]/.test(out) || /^[=+\-@]/.test(out) ? `"${(/^[=+\-@]/.test(out) ? `'${out}` : out).replace(/"/g, '""')}"` : out; };
  return { fileName, contentType: "text/csv; charset=utf-8", body: `﻿${[columns.join(","), ...rows.map((entry) => columns.map((column) => cell(entry[column])).join(","))].join("\r\n")}\r\n` };
}

// importCountEntries: a filled count sheet (CSV or XLSX: SKU, Location, Batch, Serial, Counted Qty, UOM). Every row is checked first; if any is
// wrong nothing is entered and the row errors are returned. Rows only enter counts on this count's lines — never stock.
export async function importCountEntries(client, c, countId, { bytes, fileName } = {}) {
  need(c, P.import, "You do not have permission to import count entries.");
  const row = await openForCounting(client, c, countId);
  const parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: 5000 }) : parseCsvUpload(bytes, { maxRows: 5000 });
  const field = (record, name) => {
    const key = Object.keys(record).find((header) => header.toLowerCase().replace(/[^a-z]/g, "") === name.toLowerCase().replace(/[^a-z]/g, ""));
    return key ? String(record[key] ?? "").trim() : "";
  };
  const lines = await linesOf(client, c, row.id);
  const uoms = new Map((await client.query(`SELECT id, lower(code) AS code FROM tenant.units_of_measure WHERE organization_id = $1`, [c.organizationId])).rows.map((entry) => [entry.code, entry.id]));
  const errors = [];
  const quantities = [];
  const serialRows = new Map();
  const seenSerials = new Set();
  parsed.records.forEach((record, index) => {
    const at = index + 2;
    const sku = field(record, "SKU");
    const counted = field(record, "Counted Qty");
    const serial = field(record, "Serial");
    if (!sku && !counted && !serial) return;
    const candidates = lines.filter((line) => (line.item_snapshot?.code ?? "").toLowerCase() === sku.toLowerCase());
    if (!candidates.length) { errors.push({ row: at, message: `SKU ${sku || "(blank)"} is not on this count.` }); return; }
    const location = (field(record, "Location") || "MAIN").toLowerCase();
    const atLocation = candidates.filter((line) => (line.location_code ?? "MAIN").toLowerCase() === location);
    if (!atLocation.length) { errors.push({ row: at, message: `${sku} at ${location.toUpperCase()} is outside this count (add it as unexpected stock on screen).` }); return; }
    const batchName = field(record, "Batch").toLowerCase();
    const line = atLocation.find((entry) => (entry.batch_number ?? entry.new_batch_number ?? "").toLowerCase() === batchName);
    if (!line) { errors.push({ row: at, message: `Batch ${batchName || "(blank)"} of ${sku} is not on this count at ${location.toUpperCase()}.` }); return; }
    if (line.tracking_type === "serial") {
      if (!serial) { if (counted) errors.push({ row: at, message: `${sku} is serial-numbered: one row per serial number found.` }); return; }
      if (counted && !/^[01]$/.test(counted)) { errors.push({ row: at, message: `${sku} serial ${serial}: a serial number is counted as 1 (found) or 0 (not found), never ${counted}.` }); return; }
      if (seenSerials.has(serial.toLowerCase())) { errors.push({ row: at, message: `Serial ${serial} is listed twice.` }); return; }
      seenSerials.add(serial.toLowerCase());
      const entry = serialRows.get(line.id) ?? { line, present: [], unexpected: [] };
      if (counted !== "0") (line.serials.some((expected) => expected.expected && expected.serial_number.toLowerCase() === serial.toLowerCase()) ? entry.present : entry.unexpected).push(serial);
      serialRows.set(line.id, entry);
      return;
    }
    if (counted === "") return;
    if (!/^\d+(\.\d+)?$/.test(counted)) { errors.push({ row: at, message: `${sku}: the counted quantity ${counted} is not a number of zero or more.` }); return; }
    const uomCode = field(record, "UOM").toLowerCase();
    const uomId = uomCode ? uoms.get(uomCode) : line.base_uom_id;
    if (uomCode && !uomId) { errors.push({ row: at, message: `${sku}: unit ${uomCode} is not known.` }); return; }
    if (quantities.some((entry) => entry.line.id === line.id)) { errors.push({ row: at, message: `${sku} at ${location.toUpperCase()}${batchName ? ` batch ${batchName}` : ""} is listed twice.` }); return; }
    quantities.push({ line, quantity: counted, uomId, row: at });
  });
  for (const entry of quantities) {
    const unit = await normalizeQuantityToBase(client, c.organizationId, entry.line.item_id, entry.uomId, entry.quantity, { purpose: "inventory" });
    if (!unit.ok) errors.push({ row: entry.row, message: `${entry.line.item_snapshot?.code}: ${unit.message}` });
  }
  if (errors.length) throw new CountError(422, `${errors.length} row${errors.length === 1 ? " has" : "s have"} errors; nothing was imported.`, "COUNT_IMPORT_INVALID", { errors });
  for (const entry of quantities) await enterCount(client, c, row.id, { lineId: entry.line.id, quantity: entry.quantity, uomId: entry.uomId, source: "import" });
  for (const entry of serialRows.values())
    await enterSerialCount(client, c, row.id, { lineId: entry.line.id, presentSerialNumbers: entry.present, unexpectedSerialNumbers: entry.unexpected, source: "import" });
  await event(client, c, row.id, "imported", `Count sheet imported: ${quantities.length + serialRows.size} line${quantities.length + serialRows.size === 1 ? "" : "s"} counted`);
  return { imported: quantities.length + serialRows.size, count: await getStockCount(client, c, row.id) };
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT count.*, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, creator.full_name AS created_by_name, counter.full_name AS assigned_user_name,
         completer.full_name AS completed_by_name, adjustment.document_number AS adjustment_number, adjustment.status AS adjustment_status,
         (SELECT count(*) FROM tenant.physical_inventory_count_lines line WHERE line.count_id = count.id) AS line_count,
         (SELECT count(*) FROM tenant.physical_inventory_count_lines line WHERE line.count_id = count.id AND line.line_status IN ('counted', 'accepted')) AS counted_lines,
         (SELECT count(*) FROM tenant.physical_inventory_count_lines line WHERE line.count_id = count.id AND line.line_status = 'recount_required') AS recount_lines,
         (SELECT count(*) FROM tenant.physical_inventory_count_lines line WHERE line.count_id = count.id AND line.counted_base_quantity IS NOT NULL
            AND (line.variance_base_quantity <> 0 OR EXISTS (SELECT 1 FROM tenant.physical_inventory_serial_counts serial WHERE serial.line_id = line.id AND serial.count_result IN ('missing', 'unexpected')))) AS variance_lines,
         adjustment.value_increase, adjustment.value_decrease
    FROM tenant.physical_inventory_counts count
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = count.organization_id AND warehouse.id = count.warehouse_id
    LEFT JOIN tenant.inventory_adjustments adjustment ON adjustment.id = count.linked_adjustment_id
    LEFT JOIN public.users creator ON creator.id = count.created_by
    LEFT JOIN public.users counter ON counter.id = count.assigned_user_id
    LEFT JOIN public.users completer ON completer.id = count.completed_by`;

function toHeader(row, c) {
  const lines = Number(row.line_count ?? 0);
  const counted = Number(row.counted_lines ?? 0);
  return {
    id: row.id, number: row.document_number, status: row.status, statusLabel: COUNT_STATUSES.find((entry) => entry.id === row.status)?.label ?? row.status, warehouseId: row.warehouse_id,
    warehouse: row.warehouse_code, warehouseName: row.warehouse_name, countType: row.count_type, countTypeLabel: COUNT_TYPES.find((entry) => entry.id === row.count_type)?.label,
    blindCount: row.blind_count, snapshotAt: row.snapshot_at, assignedUserId: row.assigned_user_id, assignedUserName: row.assigned_user_name,
    recountThresholdPercent: row.recount_threshold_percent === null ? null : n(row.recount_threshold_percent), reference: row.reference, instructions: row.instructions,
    lineCount: lines, countedLines: counted, recountLines: Number(row.recount_lines ?? 0), varianceLines: Number(row.variance_lines ?? 0), progress: lines ? Math.round((counted / lines) * 100) : 0,
    adjustmentId: row.linked_adjustment_id, adjustmentNumber: row.adjustment_number, adjustmentStatus: row.adjustment_status,
    ...(can(c, P.viewValue) && row.value_increase !== null && row.value_increase !== undefined ? { valueNet: n(Number(row.value_increase) - Number(row.value_decrease)) } : {}),
    createdAt: row.created_at, createdByName: row.created_by_name, startedAt: row.started_at, submittedAt: row.submitted_at, completedAt: row.completed_at, completedByName: row.completed_by_name,
    cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, version: row.version,
  };
}

export async function getStockCount(client, c, countId) {
  need(c, P.view, "You do not have permission to view stock counts.");
  const row = (await client.query(`${SELECT} WHERE count.organization_id = $1 AND count.id = $2`, [c.organizationId, uuid(countId, "Stock count")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new CountError(404, "Stock count not found.", "COUNT_NOT_FOUND");
  const scope = (await client.query(
    `SELECT scope.*, location.code AS location_code, item.code AS item_code, item.name AS item_name FROM tenant.physical_inventory_count_scopes scope
       LEFT JOIN tenant.warehouse_locations location ON location.id = scope.location_id LEFT JOIN tenant.items item ON item.id = scope.item_id
      WHERE scope.organization_id = $1 AND scope.count_id = $2`, [c.organizationId, row.id])).rows
    .map((entry) => ({ locationScoped: entry.location_scoped, locationId: entry.location_id, location: entry.location_scoped ? entry.location_code ?? "MAIN" : null, itemId: entry.item_id,
      item: entry.item_code ? `${entry.item_code} · ${entry.item_name}` : null }));
  const lines = await linesOf(client, c, row.id);
  // A blind count shows the system quantity and variance only to those who may see them (reviewers); a finished one to anyone who may view it.
  const seesSystem = !row.blind_count || ["completed", "cancelled"].includes(row.status) || can(c, P.viewSystemQuantity);
  const history = can(c, P.viewHistory);
  const attempts = history ? (await client.query(
    `SELECT entry.*, counter.full_name AS counted_by_name, uom.code AS uom_code FROM tenant.physical_inventory_count_entries entry
       JOIN tenant.physical_inventory_count_lines line ON line.id = entry.line_id LEFT JOIN public.users counter ON counter.id = entry.counted_by
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = entry.organization_id AND uom.id = entry.entered_uom_id
      WHERE line.organization_id = $1 AND line.count_id = $2 ORDER BY entry.line_id, entry.attempt_number`, [c.organizationId, row.id])).rows : [];
  const variances = varianceOf(lines);
  const lineOut = lines.map((line) => {
    const variance = variances.find((entry) => entry.lineId === line.id);
    const system = n(line.system_base_quantity);
    return {
      id: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.item_snapshot?.code, itemName: line.item_snapshot?.name, trackingType: line.tracking_type,
      locationId: line.location_id, location: line.location_code ?? "MAIN", disposition: line.disposition, batchId: line.batch_id, batch: line.batch_number ?? line.new_batch_number,
      newBatch: Boolean(line.new_batch_number), expiresOn: dayOf(line.expires_on ?? line.new_expires_on), baseUomId: line.base_uom_id, baseUom: line.base_uom, status: line.line_status,
      unexpected: line.is_unexpected, counted: line.counted_base_quantity === null ? null : n(line.counted_base_quantity),
      accepted: line.accepted_counted_base_quantity === null ? null : n(line.accepted_counted_base_quantity),
      ...(seesSystem ? { system, variance: variance.variance, variancePercent: variance.variance === null ? null : system === 0 ? null : Math.round((Math.abs(variance.variance) / Math.abs(system)) * 10000) / 100,
        kinds: variance.kinds } : { kinds: variance.kinds.filter((kind) => kind === "recount_required") }),
      serials: line.serials.map((serial) => ({ serialNumber: serial.serial_number, expected: serial.expected, result: seesSystem || !serial.expected ? serial.count_result : serial.count_result ? "counted" : null })),
      resolutionType: line.resolution_type, resolutionNote: line.resolution_note, valuationSource: line.valuation_source, unitCost: line.manual_unit_cost === null ? null : n(line.manual_unit_cost),
      costNote: line.cost_note, notes: line.notes,
      attempts: attempts.filter((entry) => entry.line_id === line.id).map((entry) => ({ attempt: entry.attempt_number, quantity: n(entry.entered_quantity), uom: entry.uom_code, conversion: n(entry.conversion_factor),
        baseQuantity: n(entry.counted_base_quantity), source: entry.entry_source, notes: entry.notes, countedBy: entry.counted_by_name, countedAt: entry.counted_at })),
    };
  });
  const serials = lines.flatMap((line) => line.serials);
  const summary = {
    lines: lines.length, counted: lines.filter((line) => ["counted", "accepted"].includes(line.line_status)).length, notCounted: lines.filter((line) => line.line_status === "not_counted").length,
    recountRequired: lines.filter((line) => line.line_status === "recount_required").length, accepted: lines.filter((line) => line.line_status === "accepted").length,
    serialsExpected: serials.filter((serial) => serial.expected).length, serialsPresent: serials.filter((serial) => serial.count_result === "present").length,
    ...(seesSystem ? { noVariance: variances.filter((entry) => entry.kinds.includes("no_variance")).length, shortages: variances.filter((entry) => entry.kinds.includes("shortage")).length,
      gains: variances.filter((entry) => entry.kinds.includes("gain")).length, serialsMissing: serials.filter((serial) => serial.count_result === "missing").length,
      serialsUnexpected: serials.filter((serial) => serial.count_result === "unexpected").length, possibleMisplacements: variances.filter((entry) => entry.kinds.includes("possible_misplacement")).length } : {}),
  };
  const events = history ? (await client.query(
    `SELECT event.event_type, event.summary, event.created_at, actor.full_name AS actor_name FROM tenant.physical_inventory_count_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.count_id = $2 ORDER BY event.created_at`, [c.organizationId, row.id])).rows.map((entry) => ({ type: entry.event_type, summary: entry.summary,
      at: entry.created_at, actor: entry.actor_name })) : [];
  const status = row.status;
  return {
    count: toHeader(row, c), scope, lines: lineOut, summary, history: events, seesSystemQuantity: seesSystem,
    capabilities: {
      edit: status === "draft" && can(c, P.configure), start: status === "draft" && can(c, P.start), count: status === "in_progress" && can(c, P.count),
      countSerial: status === "in_progress" && can(c, P.countSerial), addUnexpected: status === "in_progress" && can(c, P.addUnexpected), import: status === "in_progress" && can(c, P.import),
      submit: status === "in_progress" && can(c, P.submit), requestRecount: ["in_progress", "ready_for_review"].includes(status) && can(c, P.requestRecount),
      recount: status === "in_progress" && can(c, P.recount), review: status === "ready_for_review" && can(c, P.review), complete: status === "ready_for_review" && can(c, P.complete),
      resolveReservations: can(c, P.resolveReservations), cancel: (status === "draft" && can(c, P.create)) || (["in_progress", "ready_for_review"].includes(status) && can(c, P.cancel)),
      export: status !== "draft" && can(c, P.export), seesValue: can(c, P.viewValue),
    },
  };
}

// filters: view (all | draft | in_progress | ready_for_review | completed | cancelled), warehouseId, countType, from, to, search (number, reference), limit, offset.
export async function listStockCounts(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view stock counts.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["count.organization_id = $1"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`count.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  const view = filters.view ?? filters.status;
  if (COUNT_STATUSES.some((entry) => entry.id === view)) where.push(`count.status = ${bind(view)}`);
  if (filters.warehouseId && UUID.test(filters.warehouseId)) where.push(`count.warehouse_id = ${bind(filters.warehouseId)}`);
  if (COUNT_TYPES.some((entry) => entry.id === filters.countType)) where.push(`count.count_type = ${bind(filters.countType)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`count.created_at >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`count.created_at < ${bind(filters.to)}::date + 1`);
  const term = text(filters.search, 120);
  if (term) where.push(`lower(concat_ws(' ', count.document_number, count.reference)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = Number((await client.query(`SELECT count(*) FROM tenant.physical_inventory_counts count WHERE ${where.join(" AND ")}`, values)).rows[0].count);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY count.created_at DESC LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  return { total, rows: rows.map((entry) => toHeader(entry, c)), canCreate: can(c, P.create), seesValue: can(c, P.viewValue) };
}

export async function getStockCountOptions(client, c) {
  need(c, P.view, "You do not have permission to view stock counts.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, is_default FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL
      AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY is_default DESC, name`, [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock
      AND warehouse_id = ANY($2::uuid[]) ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((entry) => entry.id)])).rows;
  return {
    warehouses: warehouses.map((entry) => ({ id: entry.id, code: entry.code, name: entry.name, isDefault: entry.is_default,
      locations: locations.filter((location) => location.warehouse_id === entry.id).map((location) => ({ id: location.id, code: location.code, name: location.name, isMain: location.is_default_storage })) })),
    countTypes: COUNT_TYPES, statuses: COUNT_STATUSES, resolutionTypes: RESOLUTION_TYPES,
    capabilities: Object.fromEntries(Object.entries(P).map(([key, permission]) => [key, can(c, permission)])),
  };
}
