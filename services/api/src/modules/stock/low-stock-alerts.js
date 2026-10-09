// Low-Stock Alerts: the reorder calculation's conditions as alerts — out of stock (critical), replenishment required (high), low stock but
// covered by confirmed incoming (warning). No threshold or formula of its own: the database evaluator (tenant.evaluate_low_stock_alert)
// derives every alert from the reorder rule's status projection whenever that changes, keeps one live occurrence per rule, escalates and
// de-escalates it, and resolves it by itself. People acknowledge alerts and act on them (a draft purchase order or transfer, through the
// Replenishment actions); they never resolve them by hand. Notifications go out once per meaningful transition, to users who may see the
// warehouse. Nothing here moves stock or touches valuation.
import { STOCK_ALERT_PERMISSIONS as P, STOCK_REORDER_PERMISSIONS as R } from "@vercentlabs/permissions";
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { createNotification } from "../../core/platform/notifications/service.js";
import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import {
  createPurchaseDraftFromReorder, createTransferDraftFromReorder, getOtherWarehouseAvailability, getReorderDemandBreakdown, getReorderIncomingBreakdown, getReorderRule,
} from "./reorder.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 1e6) / 1e6);
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const fail = (message, code = "LOW_STOCK_ALERT_INVALID", status = 400) => { throw new StockError(status, message, code); };
const uuid = (value, label) => { if (!value || !UUID.test(String(value))) fail(`${label} is invalid.`); return String(value); };

export const ALERT_CONDITIONS = Object.freeze([
  { id: "out_of_stock", label: "Out of stock", severity: "critical" }, { id: "replenishment_required", label: "Replenishment required", severity: "high" },
  { id: "low_stock", label: "Low stock — replenishment in progress", severity: "warning" },
]);
const CONDITION_LABEL = Object.fromEntries(ALERT_CONDITIONS.map((entry) => [entry.id, entry.label]));
const RESOLUTION_LABEL = Object.freeze({
  condition_cleared: "The condition cleared", incoming_confirmed: "Confirmed incoming covers it", stock_increased: "Stock arrived", demand_reduced: "Demand fell",
  policy_changed: "The reorder rule's thresholds changed", reorder_rule_disabled: "The reorder rule was disabled", reconciled: "Corrected by reconciliation",
});
// The saved views: presets of the same list.
export const ALERT_VIEWS = Object.freeze([
  { id: "active", label: "All active" }, { id: "critical", label: "Critical", filters: { severity: "critical" } },
  { id: "out_of_stock", label: "Out of stock", filters: { condition: "out_of_stock" } }, { id: "replenishment_required", label: "Replenishment required", filters: { condition: "replenishment_required" } },
  { id: "low_stock", label: "Low stock — covered", filters: { condition: "low_stock" } }, { id: "overdue", label: "Overdue incoming", filters: { overdue: "true" } },
  { id: "unacknowledged", label: "Unacknowledged", filters: { status: "open" } }, { id: "resolved", label: "Resolved", filters: { status: "resolved" } },
  { id: "all", label: "All occurrences", filters: { status: "all" } },
]);

// ---------------------------------------------------------------- reading
const FROM = `
    FROM tenant.inventory_low_stock_alerts alert
    JOIN tenant.inventory_reorder_rules rule ON rule.id = alert.rule_id
    JOIN tenant.items item ON item.organization_id = alert.organization_id AND item.id = alert.item_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = alert.organization_id AND warehouse.id = alert.warehouse_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
    LEFT JOIN tenant.inventory_reorder_status status ON status.rule_id = alert.rule_id
    LEFT JOIN public.users acknowledger ON acknowledger.id = alert.acknowledged_by`;
const COLUMNS = `alert.*, item.code AS sku, item.name AS item_name, uom.code AS base_uom, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
    rule.reorder_level_base_quantity, rule.target_level_base_quantity, rule.order_multiple_base_quantity, rule.enabled AS rule_enabled,
    status.eligible_on_hand, status.firm_open_demand, status.current_planning_position, status.firm_incoming, status.projected_position, status.raw_suggested_base_quantity,
    status.suggested_base_quantity, status.earliest_incoming_date, status.status AS reorder_status, acknowledger.full_name AS acknowledged_by_name`;

function toAlert(row) {
  const live = row.status !== "resolved";
  const reorder = n(row.reorder_level_base_quantity);
  const projected = n(row.projected_position ?? 0);
  return {
    id: row.id, ruleId: row.rule_id, occurrence: row.occurrence_number, condition: row.condition_type, conditionLabel: CONDITION_LABEL[row.condition_type],
    severity: row.severity, status: row.status, negativeStock: row.negative_stock, overdueIncoming: row.overdue_incoming,
    itemId: row.item_id, sku: row.sku, itemName: row.item_name, baseUom: row.base_uom, warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name,
    firstDetectedAt: row.first_detected_at, conditionSince: row.condition_since, lastEvaluatedAt: row.last_evaluated_at,
    acknowledgedAt: row.acknowledged_at, acknowledgedBy: row.acknowledged_by_name ?? null, resolvedAt: row.resolved_at, resolutionReason: row.resolution_reason,
    resolutionLabel: row.resolution_reason ? RESOLUTION_LABEL[row.resolution_reason] : null,
    // Current figures (from the reorder status) — only meaningful while the alert is live; a resolved alert shows its snapshot.
    live: live ? {
      eligibleOnHand: n(row.eligible_on_hand), firmDemand: n(row.firm_open_demand), currentPosition: n(row.current_planning_position), firmIncoming: n(row.firm_incoming),
      projectedPosition: projected, reorderLevel: reorder, targetLevel: n(row.target_level_base_quantity), orderMultiple: n(row.order_multiple_base_quantity),
      rawSuggested: n(row.raw_suggested_base_quantity), suggested: n(row.suggested_base_quantity), shortfallToReorder: n(Math.max(0, reorder - projected)),
      nextIncoming: row.earliest_incoming_date ?? null,
    } : null,
    detected: {
      eligibleOnHand: n(row.detected_eligible_on_hand), firmDemand: n(row.detected_firm_demand), currentPosition: n(row.detected_current_position),
      firmIncoming: n(row.detected_firm_incoming), projectedPosition: n(row.detected_projected_position), reorderLevel: n(row.detected_reorder_level),
      targetLevel: n(row.detected_target_level), suggested: n(row.detected_suggested_quantity),
    },
  };
}

// filters: view (a saved view), status (active | open | acknowledged | resolved | all), severity, condition, warehouseId, itemId, categoryId,
// search (SKU, item, barcode, warehouse), minAgeDays, incoming (yes | no), overdue (true), sort (urgency | age | shortage), limit, offset.
// Only alerts of warehouses the user may see; urgency first by default (critical, high, warning; oldest first within).
export async function getLowStockAlerts(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view low-stock alerts.");
  const view = ALERT_VIEWS.find((entry) => entry.id === (filters.view || "active"));
  if (!view) fail("Unknown view.");
  const f = { ...(view.filters ?? {}), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== "")) };
  const visible = await visibleWarehouseIds(client, c);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["alert.organization_id = $1"];
  if (visible) where.push(`alert.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  const status = f.status ?? "active";
  if (status === "active") where.push("alert.status <> 'resolved'");
  else if (["open", "acknowledged", "resolved"].includes(status)) where.push(`alert.status = ${bind(status)}`);
  else if (status !== "all") fail("Unknown status.");
  if (f.severity) { if (!["critical", "high", "warning"].includes(f.severity)) fail("Unknown severity."); where.push(`alert.severity = ${bind(f.severity)}`); }
  if (f.condition) { if (!CONDITION_LABEL[f.condition]) fail("Unknown condition."); where.push(`alert.condition_type = ${bind(f.condition)}`); }
  if (f.warehouseId) {
    const id = uuid(f.warehouseId, "Warehouse");
    if (visible && !visible.includes(id)) fail("You do not have access to that warehouse.", "LOW_STOCK_ALERT_WAREHOUSE_FORBIDDEN", 403);
    where.push(`alert.warehouse_id = ${bind(id)}`);
  }
  if (f.itemId) where.push(`alert.item_id = ${bind(uuid(f.itemId, "Item"))}`);
  if (f.categoryId) where.push(`item.group_id = ${bind(uuid(f.categoryId, "Category"))}`);
  const search = text(f.search, 120);
  if (search) where.push(`lower(concat_ws(' ', item.code, item.name, item.barcode, warehouse.code, warehouse.name)) LIKE ${bind(`%${search.toLowerCase()}%`)}`);
  if (f.minAgeDays) where.push(`alert.first_detected_at <= now() - (${bind(Number(f.minAgeDays) || 0)}::numeric * interval '1 day')`);
  if (f.incoming === "yes") where.push("COALESCE(status.firm_incoming, 0) > 0");
  if (f.incoming === "no") where.push("COALESCE(status.firm_incoming, 0) = 0");
  if (String(f.overdue) === "true") where.push("alert.overdue_incoming");
  const order = f.sort === "age" ? "alert.first_detected_at"
    : f.sort === "shortage" ? "status.suggested_base_quantity DESC NULLS LAST, alert.first_detected_at"
    : "CASE alert.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, alert.first_detected_at";
  const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 1000);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const { rows } = await client.query(`SELECT ${COLUMNS}, count(*) OVER () AS total ${FROM} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values);
  return { rows: rows.map(toAlert), total: Number(rows[0]?.total ?? 0), counts: await getLowStockAlertCounts(client, c), view: view.id, capabilities: capabilities(c) };
}
export const getOpenLowStockAlerts = (client, c, filters = {}) => getLowStockAlerts(client, c, { ...filters, view: "active" });
export const getOutOfStockAlerts = (client, c, filters = {}) => getLowStockAlerts(client, c, { ...filters, view: "out_of_stock" });
export const getReplenishmentRequiredAlerts = (client, c, filters = {}) => getLowStockAlerts(client, c, { ...filters, view: "replenishment_required" });
export const getLowStockCoveredAlerts = (client, c, filters = {}) => getLowStockAlerts(client, c, { ...filters, view: "low_stock" });

const capabilities = (c) => ({
  acknowledge: can(c, P.acknowledge), viewHistory: can(c, P.viewHistory), export: can(c, P.export), purchaseDraft: can(c, R.createPurchaseDraft),
  transferDraft: can(c, R.createTransferDraft), editRule: can(c, R.edit), viewDemand: can(c, R.viewDemand), viewIncoming: can(c, R.viewIncoming), viewOtherStock: can(c, R.viewOtherStock),
});

async function loadAlert(client, c, alertId, { lock = false } = {}) {
  const row = (await client.query(`SELECT ${COLUMNS} ${FROM} WHERE alert.organization_id = $1 AND alert.id = $2${lock ? " FOR UPDATE OF alert" : ""}`,
    [c.organizationId, uuid(alertId, "Alert")])).rows[0];
  const visible = await visibleWarehouseIds(client, c);
  if (!row || (visible && !visible.includes(row.warehouse_id))) fail("Alert not found.", "LOW_STOCK_ALERT_NOT_FOUND", 404);
  return row;
}

// One alert: its live figures (the rule is recalculated first), what was detected, the demand and incoming behind it, other warehouses' stock,
// its condition history, actions taken and earlier occurrences.
export async function getLowStockAlert(client, c, alertId) {
  need(c, P.view, "You do not have permission to view low-stock alerts.");
  const first = await loadAlert(client, c, alertId);
  const rule = can(c, R.view) ? await getReorderRule(client, c, first.rule_id) : null;
  const row = await loadAlert(client, c, alertId);
  return {
    alert: toAlert(row), rule: rule?.rule ?? null,
    demand: rule?.demand ?? null, incoming: rule?.incoming ?? null, otherWarehouses: rule?.otherWarehouses ?? null, supplier: rule?.supplier ?? null,
    history: can(c, P.viewHistory) ? await getLowStockAlertHistory(client, c, row.id) : null,
    occurrences: (await client.query(
      `SELECT id, occurrence_number, condition_type, severity, status, first_detected_at, resolved_at, resolution_reason FROM tenant.inventory_low_stock_alerts
        WHERE organization_id = $1 AND rule_id = $2 ORDER BY occurrence_number DESC LIMIT 50`, [c.organizationId, row.rule_id])).rows
      .map((entry) => ({ id: entry.id, occurrence: entry.occurrence_number, condition: entry.condition_type, severity: entry.severity, status: entry.status,
        from: entry.first_detected_at, to: entry.resolved_at, resolution: entry.resolution_reason ? RESOLUTION_LABEL[entry.resolution_reason] : null })),
    capabilities: capabilities(c),
  };
}

export async function getLowStockAlertHistory(client, c, alertId) {
  need(c, P.viewHistory, "You do not have permission to view low-stock alert history.");
  const events = (await client.query(
    `SELECT event.event_type, event.previous_condition, event.new_condition, event.previous_severity, event.new_severity, event.reason, event.details, event.reorder_status_version,
            event.created_at, actor.full_name FROM tenant.inventory_low_stock_alert_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.alert_id = $2`, [c.organizationId, alertId])).rows.map((row) => ({
    kind: "event", type: row.event_type, at: row.created_at, by: row.full_name ?? "System", from: row.previous_condition ? CONDITION_LABEL[row.previous_condition] : null,
    to: row.new_condition ? CONDITION_LABEL[row.new_condition] : null, reason: row.reason ? RESOLUTION_LABEL[row.reason] ?? row.reason : null, figures: row.details,
    statusVersion: row.reorder_status_version,
  }));
  const actions = (await client.query(
    `SELECT action.action_type, action.document_type, action.document_id, action.document_number, action.base_quantity, action.notes, action.performed_at, actor.full_name
       FROM tenant.inventory_low_stock_alert_actions action LEFT JOIN public.users actor ON actor.id = action.performed_by
      WHERE action.organization_id = $1 AND action.alert_id = $2`, [c.organizationId, alertId])).rows.map((row) => ({
    kind: "action", type: row.action_type, at: row.performed_at, by: row.full_name ?? null, document: row.document_id ? { type: row.document_type, id: row.document_id,
      number: row.document_number, href: row.document_type === "purchase_order" ? `/procurement/purchase-orders/${row.document_id}` : `/inventory/transfers/${row.document_id}` } : null,
    quantity: n(row.base_quantity), notes: row.notes,
  }));
  return [...events, ...actions].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export const getLowStockDemandBreakdown = async (client, c, alertId) => { const row = await loadAlert(client, c, alertId); return getReorderDemandBreakdown(client, c, row.item_id, row.warehouse_id); };
export const getLowStockIncomingBreakdown = async (client, c, alertId) => { const row = await loadAlert(client, c, alertId); return getReorderIncomingBreakdown(client, c, row.item_id, row.warehouse_id); };
export const getLowStockOtherWarehouseAvailability = async (client, c, alertId) => { const row = await loadAlert(client, c, alertId); return getOtherWarehouseAvailability(client, c, row.item_id, row.warehouse_id); };

// ---------------------------------------------------------------- acting
// Acknowledge: someone has seen this and takes responsibility. The stock condition — and the alert's condition — is unchanged.
export async function acknowledgeLowStockAlert(client, c, alertId, input = {}) {
  need(c, P.acknowledge, "You do not have permission to acknowledge low-stock alerts.");
  const row = await loadAlert(client, c, alertId, { lock: true });
  if (row.status === "resolved") fail("This alert has already resolved.", "LOW_STOCK_ALERT_RESOLVED", 409);
  if (row.status === "acknowledged") return getLowStockAlert(client, c, row.id);
  await client.query(`UPDATE tenant.inventory_low_stock_alerts SET status = 'acknowledged', acknowledged_by = $3, acknowledged_at = now(), updated_at = now(), version = version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  await client.query(`INSERT INTO tenant.inventory_low_stock_alert_events (organization_id, alert_id, event_type, previous_condition, new_condition, previous_severity, new_severity, actor_user_id, reason)
      VALUES ($1, $2, 'acknowledged', $3, $3, $4, $4, $5, $6)`, [c.organizationId, row.id, row.condition_type, row.severity, c.userId ?? null, text(input.notes, 1000)]);
  await client.query(`INSERT INTO tenant.inventory_low_stock_alert_actions (organization_id, alert_id, action_type, notes, performed_by) VALUES ($1, $2, 'acknowledged', $3, $4)`,
    [c.organizationId, row.id, text(input.notes, 1000), c.userId ?? null]);
  return getLowStockAlert(client, c, row.id);
}
// Acknowledge selected (never "resolve selected": resolution is calculated).
export async function acknowledgeLowStockAlerts(client, c, alertIds = [], input = {}) {
  need(c, P.acknowledge, "You do not have permission to acknowledge low-stock alerts.");
  const ids = [...new Set((Array.isArray(alertIds) ? alertIds : []).map(String))].slice(0, 500);
  let acknowledged = 0;
  const skipped = [];
  for (const id of ids) {
    try {
      const before = await loadAlert(client, c, id);
      if (before.status === "open") { await acknowledgeLowStockAlert(client, c, id, input); acknowledged += 1; } else skipped.push({ id, reason: before.status });
    } catch (error) { if (error instanceof StockError) skipped.push({ id, reason: error.code }); else throw error; }
  }
  return { acknowledged, skipped };
}

// Drafts from an alert: the Replenishment actions, recalculated before they are made; the action is recorded on the alert. A draft never
// resolves the alert — only confirmed incoming (or stock) does, when the status recalculates.
export async function createPurchaseDraftFromLowStockAlert(client, c, alertId, input = {}) {
  need(c, P.view, "You do not have permission to view low-stock alerts.");
  const row = await loadAlert(client, c, alertId);
  if (row.status === "resolved") fail("This alert has already resolved: open the reorder rule to replenish anyway.", "LOW_STOCK_ALERT_RESOLVED", 409);
  return createPurchaseDraftFromReorder(client, c, row.rule_id, input);
}
export async function createTransferDraftFromLowStockAlert(client, c, alertId, input = {}) {
  need(c, P.view, "You do not have permission to view low-stock alerts.");
  const row = await loadAlert(client, c, alertId);
  if (row.status === "resolved") fail("This alert has already resolved: open the reorder rule to replenish anyway.", "LOW_STOCK_ALERT_RESOLVED", 409);
  return createTransferDraftFromReorder(client, c, row.rule_id, input);
}

// ---------------------------------------------------------------- evaluation and reconciliation
export async function evaluateLowStockAlert(client, c, ruleId) {
  return (await client.query(`SELECT tenant.evaluate_low_stock_alert($1) AS condition`, [uuid(ruleId, "Reorder rule")])).rows[0].condition;
}
export async function evaluateAffectedLowStockAlerts(client, c, pairs = []) {
  let evaluated = 0;
  for (const pair of pairs) {
    const rule = (await client.query(`SELECT id FROM tenant.inventory_reorder_rules WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [c.organizationId, pair.itemId, pair.warehouseId])).rows[0];
    if (rule) { await client.query(`SELECT tenant.refresh_reorder_rule($1)`, [rule.id]); await evaluateLowStockAlert(client, c, rule.id); evaluated += 1; }
  }
  return { evaluated };
}
export const resolveLowStockAlertIfConditionCleared = (client, c, ruleId) => evaluateLowStockAlert(client, c, ruleId);
export const escalateLowStockAlert = (client, c, ruleId) => evaluateLowStockAlert(client, c, ruleId);

// The invariant, checked and restored: an actionable reorder condition ↔ exactly one live alert of that condition. Run after the reorder
// projection is reconciled (the daily job does both).
export async function reconcileLowStockAlerts(client, c) {
  const before = (await client.query(
    `SELECT rule.id AS rule_id, alert.id AS alert_id, alert.condition_type FROM tenant.inventory_reorder_rules rule
       LEFT JOIN tenant.inventory_low_stock_alerts alert ON alert.rule_id = rule.id AND alert.status <> 'resolved' WHERE rule.organization_id = $1`, [c.organizationId])).rows;
  const differences = [];
  for (const row of before) {
    const condition = await evaluateLowStockAlert(client, c, row.rule_id);
    if ((condition ?? null) !== (row.condition_type ?? null)) differences.push({ ruleId: row.rule_id, before: row.condition_type ?? null, after: condition ?? null });
  }
  return { rules: before.length, differences, consistent: differences.length === 0 };
}

// ---------------------------------------------------------------- notifications
// Delivers the queued transitions (opened, reopened, escalated) as in-app notifications to every active member who may see low-stock alerts
// and that warehouse — checked before delivery, never only on click. Each transition is delivered once.
export async function dispatchLowStockAlertNotifications(client, c, { limit = 200 } = {}) {
  const pending = (await client.query(
    `SELECT queue.id, queue.alert_id, event.event_type, event.details, alert.condition_type, alert.warehouse_id, item.code AS sku, item.name AS item_name, uom.code AS uom,
            warehouse.name AS warehouse_name, warehouse.code AS warehouse_code
       FROM tenant.inventory_low_stock_alert_notifications queue
       JOIN tenant.inventory_low_stock_alert_events event ON event.id = queue.event_id
       JOIN tenant.inventory_low_stock_alerts alert ON alert.id = queue.alert_id
       JOIN tenant.items item ON item.organization_id = alert.organization_id AND item.id = alert.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = alert.organization_id AND warehouse.id = alert.warehouse_id
      WHERE queue.organization_id = $1 AND queue.status = 'pending' ORDER BY queue.created_at LIMIT $2 FOR UPDATE OF queue SKIP LOCKED`, [c.organizationId, limit])).rows;
  let delivered = 0;
  for (const row of pending) {
    const recipients = await alertRecipients(client, c.organizationId, row.warehouse_id);
    const message = notificationText(row);
    let count = 0;
    for (const userId of recipients)
      if (await createNotification(client, { organizationId: c.organizationId, userId, category: "inventory_low_stock", title: message.title, message: message.body,
        href: `/inventory/replenishment/alerts/${row.alert_id}`, entityType: "inventory_low_stock_alert", entityId: row.alert_id })) count += 1;
    await client.query(`UPDATE tenant.inventory_low_stock_alert_notifications SET status = 'dispatched', dispatched_at = now(), recipients = $2 WHERE id = $1`, [row.id, count]);
    delivered += count;
  }
  return { transitions: pending.length, delivered };
}

const qty = (value, unit) => `${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ""}`;
function notificationText(row) {
  const f = row.details ?? {};
  const where = row.warehouse_name ?? row.warehouse_code;
  const escalated = row.event_type === "escalated" ? " (worse)" : "";
  if (row.condition_type === "out_of_stock")
    return { title: `Out of Stock — ${row.sku}${escalated}`, body: `${where} has no eligible stock of ${row.item_name}.${Number(f.incoming) > 0 ? ` Confirmed incoming: ${qty(f.incoming, row.uom)}${f.nextIncoming ? ` expected ${String(f.nextIncoming).slice(0, 10)}` : ""}.` : ""}${Number(f.suggested) > 0 ? ` Suggested replenishment: ${qty(f.suggested, row.uom)}.` : ""}` };
  if (row.condition_type === "replenishment_required")
    return { title: `Replenishment required — ${row.sku}${escalated}`, body: `${where} has a projected replenishment position of ${qty(f.projected, row.uom)}, at or below its reorder level of ${qty(f.reorder, row.uom)}. Suggested replenishment: ${qty(f.suggested, row.uom)}.` };
  return { title: `Low Stock — ${row.sku}`, body: `${where} is at ${qty(f.current, row.uom)} against a reorder level of ${qty(f.reorder, row.uom)}; confirmed incoming covers it (projected ${qty(f.projected, row.uom)}).${f.overdue ? " Some of that incoming is overdue." : ""}` };
}

// Active members holding View Low-Stock Alerts (directly or as owner / administrator) who may see the warehouse.
async function alertRecipients(client, organizationId, warehouseId) {
  const { rows } = await client.query(
    `SELECT DISTINCT membership.user_id FROM public.organization_memberships membership
       JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
        AND (assignment.starts_at IS NULL OR assignment.starts_at <= now()) AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND (role.slug IN ('organization_owner', 'system_administrator') OR EXISTS (SELECT 1 FROM public.role_permissions permission WHERE permission.role_id = role.id AND permission.permission_key = $3))
        AND (role.slug IN ('organization_owner', 'system_administrator')
          OR EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.warehouse_id = $2 AND access.user_id = membership.user_id)
          OR (NOT EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.user_id = membership.user_id)
              AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_user_access access WHERE access.organization_id = $1 AND access.warehouse_id = $2)))`,
    [organizationId, warehouseId, P.view]);
  return rows.map((row) => row.user_id);
}

// ---------------------------------------------------------------- dashboards and export
// Inventory Attention: out of stock, replenishment required, low stock covered (live alerts of visible warehouses), and open negative-stock
// exceptions (their own feature, linked).
export async function getLowStockAlertCounts(client, c, { warehouseId = null } = {}) {
  if (!can(c, P.view)) return null;
  const visible = await visibleWarehouseIds(client, c);
  const row = (await client.query(
    `SELECT count(*) FILTER (WHERE condition_type = 'out_of_stock') AS out_of_stock, count(*) FILTER (WHERE condition_type = 'replenishment_required') AS required,
            count(*) FILTER (WHERE condition_type = 'low_stock') AS low_stock, count(*) FILTER (WHERE status = 'open') AS unacknowledged,
            count(*) FILTER (WHERE overdue_incoming) AS overdue
       FROM tenant.inventory_low_stock_alerts WHERE organization_id = $1 AND status <> 'resolved' AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR warehouse_id = $3)`, [c.organizationId, visible, warehouseId ? uuid(warehouseId, "Warehouse") : null])).rows[0];
  const negative = (await client.query(`SELECT count(*) AS n FROM tenant.negative_stock_exceptions WHERE organization_id = $1 AND status = 'open'
      AND ($2::uuid[] IS NULL OR warehouse_id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR warehouse_id = $3)`,
    [c.organizationId, visible, warehouseId ? uuid(warehouseId, "Warehouse") : null]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0];
  return { outOfStock: Number(row.out_of_stock), replenishmentRequired: Number(row.required), lowStock: Number(row.low_stock), unacknowledged: Number(row.unacknowledged),
    overdueIncoming: Number(row.overdue), negativeStock: Number(negative.n) };
}

export async function exportLowStockAlerts(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export low-stock alerts.");
  const data = (await getLowStockAlerts(client, c, { ...filters, limit: 1000 })).rows;
  const columns = [
    { key: "severity", label: "Severity" }, { key: "condition", label: "Condition" }, { key: "status", label: "Status" }, { key: "sku", label: "SKU" }, { key: "item", label: "Item" },
    { key: "warehouse", label: "Warehouse" }, { key: "eligible", label: "Eligible On Hand" }, { key: "demand", label: "Firm Demand" }, { key: "current", label: "Current Position" },
    { key: "incoming", label: "Firm Incoming" }, { key: "projected", label: "Projected Position" }, { key: "reorder", label: "Reorder Level" }, { key: "target", label: "Target" },
    { key: "suggested", label: "Suggested Qty" }, { key: "uom", label: "Base UOM" }, { key: "nextIncoming", label: "Next Incoming" }, { key: "overdue", label: "Overdue Incoming" },
    { key: "since", label: "First Detected" }, { key: "acknowledgedBy", label: "Acknowledged By" }, { key: "resolved", label: "Resolved" }, { key: "resolution", label: "Resolution" },
  ];
  const rows = data.map((row) => {
    const figures = row.live ?? row.detected;
    return { severity: row.severity, condition: row.conditionLabel, status: row.status, sku: row.sku, item: row.itemName, warehouse: row.warehouse, eligible: figures.eligibleOnHand,
      demand: figures.firmDemand, current: figures.currentPosition, incoming: figures.firmIncoming, projected: figures.projectedPosition, reorder: figures.reorderLevel,
      target: figures.targetLevel, suggested: figures.suggested, uom: row.baseUom, nextIncoming: row.live?.nextIncoming ? String(row.live.nextIncoming).slice(0, 10) : "",
      overdue: row.overdueIncoming ? "Yes" : "No", since: new Date(row.firstDetectedAt).toISOString(), acknowledgedBy: row.acknowledgedBy ?? "",
      resolved: row.resolvedAt ? new Date(row.resolvedAt).toISOString() : "", resolution: row.resolutionLabel ?? "" };
  });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") return { fileName: `low-stock-alerts-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: buildXlsxWorkbook({ sheetName: "Low-stock alerts", columns, rows }), rowCount: rows.length };
  return { fileName: `low-stock-alerts-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, rows), rowCount: rows.length };
}

export const getLowStockAlertOptions = (c) => ({ views: ALERT_VIEWS.map(({ id, label }) => ({ id, label })), conditions: ALERT_CONDITIONS, capabilities: capabilities(c) });
