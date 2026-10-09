// Negative-Stock Control, the management side: the company policy and the item-level block, the negative-stock report (open and resolved
// negative positions, with the override that caused each), its export, the in-app badge, the audit trail and reconciliation of the exceptions
// against the balances. The check itself is in negative-stock-control.js, called by every stock movement.
//
// Nothing here changes stock: a negative position is resolved only by a real inbound movement (a receipt, a return, a transfer in, a positive
// adjustment). Reconciliation repairs the exception records, never a balance.
import { NEGATIVE_STOCK_PERMISSIONS as P } from "@vercentlabs/permissions";
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { ledgerSourceHref } from "./ledger.js";
import { NEGATIVE_OVERRIDE_REASONS, NEGATIVE_STOCK_POLICIES, canOverrideNegativeStock, getNegativeStockPolicy } from "./negative-stock-control.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const text = (value, max = 200) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const uuidOrNull = (value) => (value && UUID.test(String(value)) ? String(value) : null);
const REASON_LABEL = Object.fromEntries(NEGATIVE_OVERRIDE_REASONS.map((reason) => [reason.id, reason.label]));
export const NEGATIVE_STOCK_EVENT_LABELS = Object.freeze({
  blocked: "Negative stock attempt blocked", backdate_blocked: "Backdated transaction blocked", override_used: "Negative override used",
  position_created: "Negative position created", position_increased: "Negative position increased", partly_resolved: "Negative position partly resolved",
  resolved: "Negative position resolved", policy_changed: "Policy changed", item_policy_changed: "Item override changed", reconciled: "Exceptions reconciled",
});

async function event(client, c, eventType, fields = {}) {
  await client.query(
    `INSERT INTO tenant.negative_stock_events (organization_id, event_type, item_id, warehouse_id, location_id, exception_id, notes, permission, details, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [c.organizationId, eventType, fields.itemId ?? null, fields.warehouseId ?? null, fields.locationId ?? null, fields.exceptionId ?? null, fields.notes ?? null,
      fields.permission ?? null, JSON.stringify(fields.details ?? {}), c.userId ?? null]);
}

function capabilities(c) {
  return { viewWarnings: can(c, P.viewWarnings), viewExceptions: can(c, P.viewExceptions), override: canOverrideNegativeStock(c), viewAudit: can(c, P.viewAudit),
    configure: can(c, P.configure), itemBlock: can(c, P.itemBlock), export: can(c, P.export) };
}

// ------------------------------------------------------------------ policy

export async function getNegativeStockSettings(client, c) {
  if (!can(c, "stock.view") && !can(c, P.viewWarnings)) throw new StockError(403, "You do not have permission to view stock.", "PERMISSION_DENIED");
  const { policy, alertsEnabled } = await getNegativeStockPolicy(client, c.organizationId);
  const blockedItems = Number((await client.query(`SELECT count(*) AS count FROM tenant.items WHERE organization_id = $1 AND negative_stock_policy_override = 'block'`,
    [c.organizationId])).rows[0].count);
  return { policy, alertsEnabled, blockedItems, policies: NEGATIVE_STOCK_POLICIES, overrideReasons: NEGATIVE_OVERRIDE_REASONS, capabilities: capabilities(c) };
}

// input: { policy?: block | allow_with_override, alertsEnabled?: boolean, reason? }
export async function updateNegativeStockPolicy(client, c, input = {}) {
  need(c, P.configure, "You do not have permission to configure the negative-stock policy.");
  const current = await getNegativeStockPolicy(client, c.organizationId);
  const policy = input.policy === undefined ? current.policy : String(input.policy);
  if (!NEGATIVE_STOCK_POLICIES.some((entry) => entry.id === policy))
    throw new StockError(400, "The negative-stock policy is Block or Allow with authorised override (there is no unrestricted allow).", "NEGATIVE_STOCK_POLICY_INVALID");
  const alertsEnabled = input.alertsEnabled === undefined ? current.alertsEnabled : Boolean(input.alertsEnabled);
  if (policy === current.policy && alertsEnabled === current.alertsEnabled) return getNegativeStockSettings(client, c);
  await client.query(
    `INSERT INTO tenant.stock_settings (organization_id, negative_stock_policy, negative_stock_alerts_enabled, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id) DO UPDATE SET negative_stock_policy = EXCLUDED.negative_stock_policy, negative_stock_alerts_enabled = EXCLUDED.negative_stock_alerts_enabled,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [c.organizationId, policy, alertsEnabled, c.userId ?? null]);
  await event(client, c, "policy_changed", { notes: text(input.reason, 1000), permission: P.configure,
    details: { from: { policy: current.policy, alertsEnabled: current.alertsEnabled }, to: { policy, alertsEnabled } } });
  return getNegativeStockSettings(client, c);
}

// An item may always block negative stock (it can never be more permissive than the company).
export async function setItemNegativeStockPolicy(client, c, itemId, input = {}) {
  need(c, P.itemBlock, "You do not have permission to change an item's negative-stock setting.");
  if (!UUID.test(String(itemId ?? ""))) throw new StockError(400, "Item is not valid.", "STOCK_ITEM_NOT_FOUND");
  const value = input.alwaysBlock === true || input.policy === "block" ? "block" : input.alwaysBlock === false || input.policy === "inherit" ? "inherit" : null;
  if (!value) throw new StockError(400, "An item either inherits the company policy or always blocks negative stock.", "NEGATIVE_STOCK_POLICY_INVALID");
  const item = (await client.query(`SELECT id, code, negative_stock_policy_override FROM tenant.items WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, itemId])).rows[0];
  if (!item) throw new StockError(404, "Item not found.", "STOCK_ITEM_NOT_FOUND");
  if (item.negative_stock_policy_override !== value) {
    await client.query(`UPDATE tenant.items SET negative_stock_policy_override = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId, value]);
    await event(client, c, "item_policy_changed", { itemId, notes: text(input.reason, 1000), permission: P.itemBlock,
      details: { sku: item.code, from: item.negative_stock_policy_override, to: value } });
  }
  return { itemId, negativeStockPolicy: value, alwaysBlock: value === "block" };
}

// ------------------------------------------------------------------ the report

// filters: status (open | resolved | all), warehouseId, itemId, categoryId, reasonCode, userId, from, to (when it went negative), search, limit, offset.
export async function listNegativeStock(client, c, filters = {}) {
  need(c, P.viewExceptions, "You do not have permission to view negative stock.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["exception.organization_id = $1"];
  const status = ["open", "resolved"].includes(filters.status) ? filters.status : filters.status === "all" ? null : "open";
  if (status) where.push(`exception.status = ${bind(status)}`);
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`exception.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (uuidOrNull(filters.id)) where.push(`exception.id = ${bind(filters.id)}`);
  if (uuidOrNull(filters.warehouseId)) where.push(`exception.warehouse_id = ${bind(filters.warehouseId)}`);
  if (uuidOrNull(filters.itemId)) where.push(`exception.item_id = ${bind(filters.itemId)}`);
  if (uuidOrNull(filters.categoryId)) where.push(`item.group_id = ${bind(filters.categoryId)}`);
  if (filters.reasonCode && REASON_LABEL[filters.reasonCode]) where.push(`override.reason_code = ${bind(filters.reasonCode)}`);
  if (uuidOrNull(filters.userId)) where.push(`override.overridden_by = ${bind(filters.userId)}`);
  if (filters.from && DATE.test(String(filters.from))) where.push(`exception.opened_at >= ${bind(filters.from)}::date`);
  if (filters.to && DATE.test(String(filters.to))) where.push(`exception.opened_at < ${bind(filters.to)}::date + 1`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', item.code, item.name, override.source_document_number)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 5000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await client.query(
    `SELECT exception.*, item.code AS sku, item.name AS item_name, uom.code AS base_uom, category.name AS category_name, warehouse.code AS warehouse_code,
            warehouse.name AS warehouse_name, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number,
            balance.quantity AS on_hand_now, opener.movement_number AS opened_by_number, last.movement_number AS last_movement_number, last.occurred_at AS last_movement_at,
            resolver.movement_number AS resolved_by_number, resolver_group.source_document_number AS resolved_by_source, resolver_group.source_document_type AS resolved_by_source_type,
            resolver_group.source_document_id AS resolved_by_source_id,
            override.reason_code, override.notes AS override_notes, override.source_document_type, override.source_document_id, override.source_document_number,
            override.quantity_before, override.movement_quantity, override.quantity_after, actor.full_name AS overridden_by_name, override.overridden_at,
            count(*) OVER () AS total_rows
       FROM tenant.negative_stock_exceptions exception
       JOIN tenant.items item ON item.organization_id = exception.organization_id AND item.id = exception.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = exception.organization_id AND warehouse.id = exception.warehouse_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = exception.organization_id AND location.id = exception.location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = exception.organization_id AND batch.id = exception.batch_id
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id = exception.organization_id AND balance.item_id = exception.item_id
            AND balance.warehouse_id = exception.warehouse_id AND balance.warehouse_location_id IS NOT DISTINCT FROM exception.location_id
            AND balance.batch_id IS NOT DISTINCT FROM exception.batch_id
       LEFT JOIN tenant.stock_movements opener ON opener.organization_id = exception.organization_id AND opener.id = exception.opened_by_movement_id
       LEFT JOIN tenant.stock_movements last ON last.organization_id = exception.organization_id AND last.id = exception.last_movement_id
       LEFT JOIN tenant.stock_movements resolver ON resolver.organization_id = exception.organization_id AND resolver.id = exception.resolved_by_movement_id
       LEFT JOIN tenant.stock_movement_groups resolver_group ON resolver_group.organization_id = resolver.organization_id AND resolver_group.id = resolver.movement_group_id
       LEFT JOIN LATERAL (SELECT * FROM tenant.negative_stock_overrides found WHERE found.organization_id = exception.organization_id AND found.exception_id = exception.id
                           ORDER BY found.overridden_at LIMIT 1) override ON true
       LEFT JOIN public.users actor ON actor.id = override.overridden_by
      WHERE ${where.join(" AND ")}
      ORDER BY exception.status = 'open' DESC, exception.opened_at DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values);
  return {
    status: status ?? "all", total: Number(rows[0]?.total_rows ?? 0), limit, offset, capabilities: capabilities(c), reasons: NEGATIVE_OVERRIDE_REASONS,
    rows: rows.map((row) => ({
      id: row.id, status: row.status, origin: row.origin, itemId: row.item_id, sku: row.sku, itemName: row.item_name, category: row.category_name, baseUom: row.base_uom,
      warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name, locationId: row.location_id, location: row.location_code, batch: row.batch_number,
      // Open: the balance as it is now (never clamped). Resolved: what it came back to.
      onHand: row.status === "open" ? n(row.on_hand_now ?? row.current_quantity) : n(row.current_quantity), lowest: n(row.lowest_quantity),
      negativeSince: row.opened_at, ageDays: Math.max(0, Math.floor(((row.resolved_at ? new Date(row.resolved_at) : new Date()) - new Date(row.opened_at)) / 86400000)),
      cause: row.opened_by_number, lastMovement: row.last_movement_number, lastMovementAt: row.last_movement_at,
      source: row.source_document_number ? { type: row.source_document_type, id: row.source_document_id, number: row.source_document_number, href: ledgerSourceHref(row.source_document_type, row.source_document_id) } : null,
      reasonCode: row.reason_code ?? null, reason: row.reason_code ? REASON_LABEL[row.reason_code] : row.origin === "reconciliation" ? "No override found (integrity failure)" : null,
      notes: row.override_notes ?? null, overriddenBy: row.overridden_by_name ?? null, overriddenAt: row.overridden_at ?? null,
      override: row.reason_code ? { before: n(row.quantity_before), movement: n(row.movement_quantity), after: n(row.quantity_after) } : null,
      resolvedAt: row.resolved_at, resolvedBy: row.resolved_by_number ? { movement: row.resolved_by_number, number: row.resolved_by_source ?? row.resolved_by_number,
        href: ledgerSourceHref(row.resolved_by_source_type, row.resolved_by_source_id) } : null,
      itemStockHref: `/inventory/stock/items/${row.item_id}`, ledgerHref: `/inventory/stock-ledger?itemId=${row.item_id}&warehouseId=${row.warehouse_id}`,
    })),
  };
}

// The in-app badge: how many negative positions are open (null when alerts are off or the user does not see warnings).
export async function getNegativeStockSummary(client, c) {
  if (!can(c, P.viewWarnings)) return { open: null, alertsEnabled: false, capabilities: capabilities(c) };
  const { alertsEnabled } = await getNegativeStockPolicy(client, c.organizationId);
  const visible = await visibleWarehouseIds(client, c);
  const row = (await client.query(
    `SELECT count(*) FILTER (WHERE status = 'open') AS open, min(opened_at) FILTER (WHERE status = 'open') AS oldest FROM tenant.negative_stock_exceptions
      WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))`, [c.organizationId, visible])).rows[0];
  return { open: Number(row.open), oldest: row.oldest ?? null, alertsEnabled, capabilities: capabilities(c) };
}

// One negative position: the exception, every override behind it and its history.
export async function getNegativeStockException(client, c, id) {
  need(c, P.viewExceptions, "You do not have permission to view negative stock.");
  if (!UUID.test(String(id ?? ""))) throw new StockError(404, "Negative-stock exception not found.", "NEGATIVE_STOCK_EXCEPTION_NOT_FOUND");
  const exception = (await listNegativeStock(client, c, { status: "all", id })).rows[0];
  if (!exception) throw new StockError(404, "Negative-stock exception not found.", "NEGATIVE_STOCK_EXCEPTION_NOT_FOUND");
  const overrides = (await client.query(
    `SELECT override.*, movement.movement_number, actor.full_name AS actor_name FROM tenant.negative_stock_overrides override
       JOIN tenant.stock_movements movement ON movement.organization_id = override.organization_id AND movement.id = override.movement_id
       LEFT JOIN public.users actor ON actor.id = override.overridden_by
      WHERE override.organization_id = $1 AND override.exception_id = $2 ORDER BY override.overridden_at`, [c.organizationId, id])).rows;
  const history = can(c, P.viewAudit) ? (await listNegativeStockAudit(client, c, { exceptionId: id, limit: 500 })).rows : [];
  return {
    exception,
    overrides: overrides.map((row) => ({ id: row.id, movement: row.movement_number, source: row.source_document_number ? { number: row.source_document_number,
      href: ledgerSourceHref(row.source_document_type, row.source_document_id) } : null, before: n(row.quantity_before), quantity: n(row.movement_quantity), after: n(row.quantity_after),
      reasonCode: row.reason_code, reason: REASON_LABEL[row.reason_code], notes: row.notes, by: row.actor_name, at: row.overridden_at })),
    history,
  };
}

// ------------------------------------------------------------------ audit

// filters: eventType, itemId, warehouseId, exceptionId, userId, from, to, limit
export async function listNegativeStockAudit(client, c, filters = {}) {
  need(c, P.viewAudit, "You do not have permission to view the negative-stock audit.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["event.organization_id = $1"];
  if (filters.eventType && NEGATIVE_STOCK_EVENT_LABELS[filters.eventType]) where.push(`event.event_type = ${bind(filters.eventType)}`);
  if (uuidOrNull(filters.itemId)) where.push(`event.item_id = ${bind(filters.itemId)}`);
  if (uuidOrNull(filters.warehouseId)) where.push(`event.warehouse_id = ${bind(filters.warehouseId)}`);
  if (uuidOrNull(filters.exceptionId)) where.push(`event.exception_id = ${bind(filters.exceptionId)}`);
  if (uuidOrNull(filters.userId)) where.push(`event.actor_user_id = ${bind(filters.userId)}`);
  if (filters.from && DATE.test(String(filters.from))) where.push(`event.created_at >= ${bind(filters.from)}::date`);
  if (filters.to && DATE.test(String(filters.to))) where.push(`event.created_at < ${bind(filters.to)}::date + 1`);
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`(event.warehouse_id IS NULL OR event.warehouse_id = ANY(${bind(visible)}::uuid[]))`);
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 2000);
  const { rows } = await client.query(
    `SELECT event.*, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse_code, COALESCE(location.code, CASE WHEN event.warehouse_id IS NOT NULL THEN 'MAIN' END) AS location_code,
            movement.movement_number, actor.full_name AS actor_name
       FROM tenant.negative_stock_events event
       LEFT JOIN tenant.items item ON item.organization_id = event.organization_id AND item.id = event.item_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = event.organization_id AND warehouse.id = event.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = event.organization_id AND location.id = event.location_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = event.organization_id AND movement.id = event.movement_id
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE ${where.join(" AND ")} ORDER BY event.created_at DESC LIMIT ${bind(limit)}`, values);
  return {
    eventTypes: Object.entries(NEGATIVE_STOCK_EVENT_LABELS).map(([id, label]) => ({ id, label })),
    rows: rows.map((row) => ({
      id: row.id, type: row.event_type, label: NEGATIVE_STOCK_EVENT_LABELS[row.event_type] ?? row.event_type, at: row.created_at, by: row.actor_name ?? null,
      itemId: row.item_id, sku: row.sku, itemName: row.item_name, warehouse: row.warehouse_code, location: row.location_code, exceptionId: row.exception_id,
      movement: row.movement_number, sourceType: row.source_document_type, sourceId: row.source_document_id,
      before: row.quantity_before === null ? null : n(row.quantity_before), quantity: row.movement_quantity === null ? null : n(row.movement_quantity),
      after: row.quantity_after === null ? null : n(row.quantity_after), reasonCode: row.reason_code, reason: row.reason_code ? REASON_LABEL[row.reason_code] ?? row.reason_code : null,
      notes: row.notes, permission: row.permission, details: row.details ?? {},
    })),
  };
}

// ------------------------------------------------------------------ reconciliation

// Open exception ⇔ a balance below zero. A negative balance with no open exception is an integrity failure (found here, opened as a
// reconciliation exception on repair); an open exception whose balance is no longer negative is resolved on repair by the balance's last movement.
export async function reconcileNegativeStockExceptions(client, c, { repair = false } = {}) {
  need(c, repair ? P.configure : P.viewExceptions, "You do not have permission to reconcile negative stock.");
  const unrecorded = (await client.query(
    `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.quantity, balance.last_movement_id, item.code AS sku,
            warehouse.code AS warehouse_code
       FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
      WHERE balance.organization_id = $1 AND balance.quantity < 0 AND NOT EXISTS (
        SELECT 1 FROM tenant.negative_stock_exceptions exception WHERE exception.organization_id = balance.organization_id AND exception.status = 'open'
           AND exception.item_id = balance.item_id AND exception.warehouse_id = balance.warehouse_id AND exception.location_id IS NOT DISTINCT FROM balance.warehouse_location_id
           AND exception.batch_id IS NOT DISTINCT FROM balance.batch_id)`, [c.organizationId])).rows;
  const stale = (await client.query(
    `SELECT exception.id, exception.item_id, exception.warehouse_id, COALESCE(balance.quantity, 0) AS quantity, balance.last_movement_id, item.code AS sku, warehouse.code AS warehouse_code
       FROM tenant.negative_stock_exceptions exception
       JOIN tenant.items item ON item.organization_id = exception.organization_id AND item.id = exception.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = exception.organization_id AND warehouse.id = exception.warehouse_id
       LEFT JOIN tenant.stock_balances balance ON balance.organization_id = exception.organization_id AND balance.item_id = exception.item_id
            AND balance.warehouse_id = exception.warehouse_id AND balance.warehouse_location_id IS NOT DISTINCT FROM exception.location_id
            AND balance.batch_id IS NOT DISTINCT FROM exception.batch_id
      WHERE exception.organization_id = $1 AND exception.status = 'open' AND COALESCE(balance.quantity, 0) >= 0`, [c.organizationId])).rows;
  if (repair) {
    for (const row of unrecorded)
      await client.query(
        `INSERT INTO tenant.negative_stock_exceptions (organization_id, item_id, warehouse_id, location_id, batch_id, origin, opened_by_movement_id, current_quantity, lowest_quantity, last_movement_id)
         VALUES ($1,$2,$3,$4,$5,'reconciliation',$6,$7,$7,$6)`,
        [c.organizationId, row.item_id, row.warehouse_id, row.warehouse_location_id, row.batch_id, row.last_movement_id, row.quantity]);
    for (const row of stale)
      await client.query(
        `UPDATE tenant.negative_stock_exceptions SET status = 'resolved', current_quantity = $3, resolved_at = now(), resolved_by_movement_id = $4, last_movement_id = COALESCE($4, last_movement_id),
                updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, row.quantity, row.last_movement_id]);
    if (unrecorded.length || stale.length)
      await event(client, c, "reconciled", { permission: P.configure, details: { opened: unrecorded.length, resolved: stale.length } });
  }
  return {
    consistent: !unrecorded.length && !stale.length, repaired: repair ? unrecorded.length + stale.length : 0,
    unrecorded: unrecorded.map((row) => ({ itemId: row.item_id, sku: row.sku, warehouse: row.warehouse_code, locationId: row.warehouse_location_id, batchId: row.batch_id, onHand: n(row.quantity) })),
    stale: stale.map((row) => ({ exceptionId: row.id, itemId: row.item_id, sku: row.sku, warehouse: row.warehouse_code, onHand: n(row.quantity) })),
  };
}

// ------------------------------------------------------------------ export

export async function exportNegativeStock(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export the negative-stock report.");
  const list = await listNegativeStock(client, c, { ...filters, limit: 5000, offset: 0 });
  const columns = [
    { key: "sku", label: "SKU" }, { key: "item", label: "Item" }, { key: "category", label: "Category" }, { key: "warehouse", label: "Warehouse" }, { key: "location", label: "Location" },
    { key: "onHand", label: "On hand" }, { key: "lowest", label: "Lowest" }, { key: "uom", label: "Base UOM" }, { key: "since", label: "First negative at" }, { key: "age", label: "Age (days)" },
    { key: "lastMovement", label: "Last movement" }, { key: "source", label: "Source" }, { key: "reason", label: "Override reason" }, { key: "notes", label: "Override notes" },
    { key: "user", label: "Override user" }, { key: "status", label: "Status" }, { key: "resolvedAt", label: "Resolved at" }, { key: "resolvedBy", label: "Resolved by" },
  ];
  const data = list.rows.map((row) => ({
    sku: row.sku, item: row.itemName, category: row.category, warehouse: row.warehouse, location: row.location, onHand: row.onHand, lowest: row.lowest, uom: row.baseUom,
    since: new Date(row.negativeSince).toISOString(), age: row.ageDays, lastMovement: row.lastMovement, source: row.source?.number ?? row.cause, reason: row.reason, notes: row.notes,
    user: row.overriddenBy, status: row.status === "open" ? "Open" : "Resolved", resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : null, resolvedBy: row.resolvedBy?.number ?? null,
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx")
    return { fileName: `negative-stock-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buildXlsxWorkbook({ sheetName: "Negative stock", columns, rows: data }), rowCount: data.length };
  return { fileName: `negative-stock-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, data), rowCount: data.length };
}
