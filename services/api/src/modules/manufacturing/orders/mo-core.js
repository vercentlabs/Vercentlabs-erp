// Manufacturing Orders — the shared core: permissions, errors, loading, quantities, the Inventory calls (through Inventory's own movements
// and reservations, source type 'manufacturing_work_order'), the Finance journals (through the shared posting service) and the costing
// policy. Every quantity is in the item's base unit; money is in the base currency.
//
// Costing policy (material only; labour and overhead are not measured and never assumed zero in a total that claims them):
//   issue      work in progress takes Inventory's valuation of the issued stock
//   return     back to stock at the line's average issue cost; work in progress gives it up
//   receipt    finished goods are valued at the recipe's planned material per unit, priced at each material's actual average issue cost
//              (its estimate when none is issued yet); never more than the work in progress holds, never a selling price, never an
//              unknown cost passed as zero
//   completion what is left in work in progress (usage beyond plan, rejects, scrap) is closed to manufacturing variance
import { randomUUID } from "node:crypto";

import { add, decimal, div, formatDecimal, mul, sub } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { AccountingError, createJournalEntry, getAccountMapping, getPrimaryLedger, postJournalEntry } from "../../accounting/index.js";
import { USABLE_ROW, postStockMovement, releaseStockReservation, reserveStock } from "../../stock/index.js";
import { valuationOfMovements } from "../../stock/valuation-engine.js";
import { has, text, uuid } from "../common.js";

export { has, text, uuid };
export const SOURCE = "manufacturing_work_order";
export const ZERO = 0n;
export const D = (value) => decimal(value ?? 0);
export const q = (value, places = 6) => formatDecimal(value, places).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
export const money = (value) => formatDecimal(value, 2);
export const min = (a, b) => (a < b ? a : b);
export const max = (a, b) => (a > b ? a : b);
export { add, div, mul, sub };

export const MO = Object.freeze({
  view: "manufacturing.mo.view", create: "manufacturing.mo.create", editDraft: "manufacturing.mo.edit_draft", submit: "manufacturing.mo.submit", approve: "manufacturing.mo.approve",
  release: "manufacturing.mo.release", reserve: "manufacturing.mo.reserve_material", issue: "manufacturing.mo.issue_material", return: "manufacturing.mo.return_material",
  extra: "manufacturing.mo.extra_material", approveVariance: "manufacturing.mo.approve_variance", start: "manufacturing.mo.start", record: "manufacturing.mo.record_production",
  quality: "manufacturing.mo.quality_decide", receive: "manufacturing.mo.receive_goods", hold: "manufacturing.mo.hold", complete: "manufacturing.mo.complete", cancel: "manufacturing.mo.cancel",
  costView: "manufacturing.mo.cost_view", export: "manufacturing.mo.export", settings: "manufacturing.settings.manage",
});

export const STATUS_LABEL = Object.freeze({ DRAFT: "Draft", AWAITING_APPROVAL: "Awaiting approval", RELEASED: "Released", IN_PROGRESS: "In progress", ON_HOLD: "On hold",
  COMPLETION_PENDING: "Completion pending", COMPLETED: "Completed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Recovery required" });
export const EXECUTING = new Set(["RELEASED", "IN_PROGRESS"]);
export const LIVE = new Set(["RELEASED", "IN_PROGRESS", "ON_HOLD"]);

const MESSAGES = Object.freeze({
  MFG_MO_NOT_FOUND: "The manufacturing order was not found.",
  MFG_MO_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_MO_PRODUCT_INVALID: "This product cannot be manufactured: it must be an active, stocked product.",
  MFG_MO_QUANTITY_INVALID: "Enter a valid planned quantity.",
  MFG_MO_DATES_INVALID: "The planned completion cannot be before the planned start.",
  MFG_MO_WAREHOUSE_INVALID: "Choose active warehouses for materials, production and finished goods.",
  MFG_MO_BOM_NOT_ELIGIBLE: "No approved BOM revision is effective for this product on the planned start date.",
  MFG_MO_STATE_INVALID: "This action is not available in the order's current state.",
  MFG_MO_VERSION_CONFLICT: "Another user changed this order. Refresh and try again.",
  MFG_MO_VALIDATION_FAILED: "The order has problems to fix first.",
  MFG_MO_APPROVAL_SELF: "Someone other than the person who submitted it must approve this order.",
  MFG_MO_MATERIALS_NOT_READY: "Some materials are not reserved or issued for the full quantity.",
  MFG_MO_OVER_ISSUE: "That is more than the order may still issue. Request extra material first.",
  MFG_MO_OVER_RETURN: "That is more than is in production custody for this material.",
  MFG_MO_OVER_CONSUME: "That is more than has been issued (less returns) for this material.",
  MFG_MO_INSUFFICIENT_STOCK: "There is not enough usable stock in the material warehouse.",
  MFG_MO_OVERPRODUCTION: "Accepted output would exceed the planned quantity and its tolerance.",
  MFG_MO_QUANTITY_MISMATCH: "Accepted, rejected and awaiting inspection must add up to the quantity reported.",
  MFG_MO_INSPECTION_REQUIRED: "Every unit produced waits for a quality decision before it is accepted.",
  MFG_MO_OVER_DECISION: "That is more than is awaiting inspection on this entry.",
  MFG_MO_OVER_RECEIPT: "Only accepted output that has not been received can be received.",
  MFG_MO_COST_UNKNOWN: "The material cost of these goods is unknown; issue the materials (or give them a cost) first.",
  MFG_MO_WIP_INSUFFICIENT: "Work in progress does not hold the material cost of these goods yet; issue the materials for them first.",
  MFG_MO_REASON_REQUIRED: "Give a reason.",
  MFG_MO_COMPLETION_BLOCKED: "The order cannot be completed yet.",
  MFG_MO_CANCEL_BLOCKED: "Material or output is still on this order; return it or close the order short instead.",
  MFG_MO_VARIANCE_SELF: "Someone other than the requester must approve this extra material.",
  MFG_MO_FINANCE_FAILED: "Finance could not record this; nothing was posted.",
  MFG_MO_INVENTORY_FAILED: "Inventory could not post this; nothing was moved.",
  MFG_MO_KEY_REQUIRED: "This action needs a request key so a retry never posts twice.",
});

export class MoError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message ?? MESSAGES[code] ?? "The manufacturing order action failed.");
    this.name = "MoError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const moError = (status, code, message, details) => new MoError(status, code, message, details);
export const needMo = (c, permission) => { if (!has(c, permission)) throw moError(403, "MFG_MO_PERMISSION_DENIED"); };

// A positive quantity text, or the error.
export function quantity(value, code = "MFG_MO_QUANTITY_INVALID", label = null) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw moError(400, code, label ? `${label}: enter a quantity more than zero.` : undefined);
  return raw;
}
export function timestamp(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw moError(400, "MFG_MO_DATES_INVALID", `${label} is not a valid date.`);
  return date.toISOString();
}

// ------------------------------------------------------------------ loading
export async function loadOrder(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Manufacturing order")])).rows[0];
  if (!row) throw moError(404, "MFG_MO_NOT_FOUND");
  return row;
}
export async function loadMaterials(client, c, orderId, { lock = false } = {}) {
  return (await client.query(
    `SELECT material.*, item.code AS item_code, item.name AS item_name, item.tracking_type, uom.code AS uom_code, uom.decimal_places AS uom_decimals
       FROM tenant.manufacturing_order_materials material JOIN tenant.items item ON item.id = material.component_item_id JOIN tenant.units_of_measure uom ON uom.id = material.uom_id
      WHERE material.organization_id = $1 AND material.manufacturing_order_id = $2 ORDER BY material.line_number${lock ? " FOR UPDATE OF material" : ""}`, [c.organizationId, orderId])).rows;
}
export function requireStatus(order, ...allowed) {
  if (!allowed.includes(order.status)) {
    throw moError(409, "MFG_MO_STATE_INVALID", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}; this needs it to be ${allowed.map((s) => STATUS_LABEL[s].toLowerCase()).join(" or ")}.`);
  }
}
export function versionCheck(order, expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(order.version)) throw moError(409, "MFG_MO_VERSION_CONFLICT");
}
export async function settingsOf(client, c) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { selfApproval: Boolean(row.mo_self_approval_allowed), varianceSelfApproval: Boolean(row.mo_variance_self_approval_allowed),
    tolerancePct: D(row.mo_overproduction_tolerance_pct ?? 0), requireInspection: Boolean(row.mo_require_inspection),
    partialReservation: row.mo_partial_reservation_allowed ?? true, releaseWithShortages: row.mo_release_with_shortages_allowed ?? true };
}

// The line's figures: required (planned + approved extra), net issued (issued less returned, a reversal being a return), still to issue,
// in production custody (net issued less used less scrapped), used and scrapped. One non-overlapping split: issued = used + scrapped +
// returned + in custody.
export function lineFigures(material) {
  const required = add(D(material.planned_quantity), D(material.authorized_extra_quantity));
  const netIssued = sub(D(material.issued_quantity), D(material.returned_quantity));
  const scrapped = D(material.scrapped_quantity ?? 0);
  // Used: net of corrections (a correction lowers consumed_quantity and records itself in consumption_corrected_quantity).
  const consumed = D(material.consumed_quantity);
  return { required, netIssued, toIssue: max(sub(required, netIssued), ZERO), custody: sub(sub(netIssued, consumed), scrapped), consumed, scrapped };
}

// ------------------------------------------------------------------ events and numbers
export async function event(client, c, orderId, action, { from = null, to = null, summary = null, details = {} } = {}) {
  await client.query(
    `INSERT INTO tenant.manufacturing_order_events (organization_id, manufacturing_order_id, action, from_status, to_status, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [c.organizationId, orderId, action, from, to, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}
export const nextNumber = (client, c, documentType) => nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType });
export async function setStatus(client, c, order, to, fields = {}, { action, summary = null, details = {} } = {}) {
  const sets = ["status = $3", "version = version + 1"];
  const values = [c.organizationId, order.id, to];
  for (const [column, value] of Object.entries(fields)) { values.push(value); sets.push(`${column} = $${values.length}`); }
  const row = (await client.query(`UPDATE tenant.manufacturing_orders SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`, values)).rows[0];
  await event(client, c, order.id, action, { from: order.status, to, summary, details });
  return row;
}

// Create-and-post as one unit even inside a caller's transaction: a refused post leaves no draft behind.
export async function atomically(client, work) {
  const name = `mfg_${Math.random().toString(36).slice(2, 10)}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {});
    throw error;
  }
}

// ------------------------------------------------------------------ idempotent requests
// A retried request with the same key returns the first result; the same key with a different request is refused by the shared service.
export async function idempotent(client, c, operation, key, payload, work, { required = false } = {}) {
  const normalized = text(key, 200) || null;
  if (required && !normalized) throw moError(400, "MFG_MO_KEY_REQUIRED");
  const token = await beginIdempotentOperation(client, c, { operation, key: normalized, payload });
  if (token.replayed) return { ...token.response, replayed: true };
  const response = await work(normalized ?? randomUUID());
  await completeIdempotentOperation(client, c, token, { response, aggregateType: "manufacturing_order", aggregateId: response?.orderId ?? null });
  return response;
}

// ------------------------------------------------------------------ Inventory
const stockError = (error) => {
  if (error instanceof MoError) return error;
  if (error?.status && error.status < 500 && error.code) return moError(error.status, error.code === "STOCK_INSUFFICIENT" ? "MFG_MO_INSUFFICIENT_STOCK" : error.code, `Inventory: ${error.message}`);
  return error;
};
// Reservations are an allocation the order makes on Inventory's behalf; physical issues and receipts need the person's own Inventory
// permission (and Inventory's warehouse checks), so a Manufacturing permission alone never moves stock.
const allocationContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view", "stock.reserve"])] });
const stockContext = (c, ...extra) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view", ...extra])] });

// Usable stock of an item in a warehouse, by balance (location and batch), earliest expiry first: never held, quarantined, damaged or expired.
export async function usableBalances(client, c, itemId, warehouseId) {
  return (await client.query(
    `SELECT balance.warehouse_location_id, balance.batch_id, balance.quantity, balance.reserved_quantity, batch.batch_number
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3 AND balance.quantity > 0 AND ${USABLE_ROW}
      ORDER BY batch.expires_on NULLS LAST, balance.updated_at, balance.warehouse_location_id NULLS FIRST`, [c.organizationId, itemId, warehouseId])).rows;
}
export async function freeStock(client, c, itemId, warehouseId) {
  return (await usableBalances(client, c, itemId, warehouseId)).reduce((sum, row) => add(sum, max(sub(D(row.quantity), D(row.reserved_quantity)), ZERO)), ZERO);
}
// What the order holds reserved, per item (Inventory's own record).
export async function reservedByItem(client, c, order) {
  const rows = (await client.query(
    `SELECT item_id, COALESCE(sum(active_quantity), 0) AS quantity FROM tenant.stock_reservations
      WHERE organization_id = $1 AND reference_type = $2 AND reference_id = $3 AND warehouse_id = $4 AND status = 'active' GROUP BY item_id`,
    [c.organizationId, SOURCE, order.id, order.material_warehouse_id])).rows;
  return new Map(rows.map((row) => [row.item_id, D(row.quantity)]));
}
// Reservations of the order shared out over its lines of one item, in line order (two lines of the same material share one item's holds).
export function reservedPerLine(materials, reserved) {
  const left = new Map(reserved);
  const result = new Map();
  for (const material of materials) {
    const have = left.get(material.component_item_id) ?? ZERO;
    const take = min(have, lineFigures(material).toIssue);
    result.set(material.id, take);
    left.set(material.component_item_id, sub(have, take));
  }
  for (const material of materials) {
    const extra = left.get(material.component_item_id) ?? ZERO;
    if (extra > ZERO) { result.set(material.id, add(result.get(material.id), extra)); left.set(material.component_item_id, ZERO); }
  }
  return result;
}

export async function reserve(client, c, order, itemId, wanted, key) {
  let left = wanted;
  let index = 0;
  try {
    for (const balance of await usableBalances(client, c, itemId, order.material_warehouse_id)) {
      if (left <= ZERO) break;
      const free = sub(D(balance.quantity), D(balance.reserved_quantity));
      if (free <= ZERO) continue;
      const take = min(free, left);
      await reserveStock(client, allocationContext(c), { itemId, warehouseId: order.material_warehouse_id, warehouseLocationId: balance.warehouse_location_id, batchId: balance.batch_id,
        quantity: q(take), referenceType: SOURCE, referenceId: order.id, idempotencyKey: `${key}:${itemId}:${index}` });
      index += 1;
      left = sub(left, take);
    }
  } catch (error) { throw stockError(error); }
  return sub(wanted, left);
}

// Give up up to `amount` of the order's reservations of an item (all when null).
export async function releaseReservations(client, c, order, itemId = null, amount = null) {
  const rows = (await client.query(
    `SELECT id, active_quantity FROM tenant.stock_reservations WHERE organization_id = $1 AND reference_type = $2 AND reference_id = $3 AND status = 'active'
        AND ($4::uuid IS NULL OR item_id = $4) ORDER BY created_at DESC`, [c.organizationId, SOURCE, order.id, itemId])).rows;
  let left = amount === null ? null : amount;
  for (const row of rows) {
    if (left !== null && left <= ZERO) break;
    const active = D(row.active_quantity);
    const part = left === null || left >= active ? null : left;
    await releaseStockReservation(client, allocationContext(c), row.id, { status: "released", quantity: part === null ? null : q(part), reasonCode: "manufacturing_order", reason: `For ${order.mo_number}` });
    if (left !== null) left = sub(left, part ?? active);
  }
}

export async function receiveStock(client, c, { itemId, warehouseId, amount, unitCost, batchId = null, reference, referenceId, reason, key }) {
  try {
    const movement = await postStockMovement(client, stockContext(c), { movementType: "receipt", itemId, warehouseId, batchId, quantity: q(amount), unitCost: q(unitCost),
      referenceType: SOURCE, referenceId, reason: `${reason} · ${reference}`, idempotencyKey: key });
    const value = await valuationOfMovements(client, c.organizationId, [movement.id]);
    return { movement, cost: D(Math.abs(Number(value.total)).toFixed(6)) };
  } catch (error) { throw stockError(error); }
}

// ------------------------------------------------------------------ Finance
// One balanced journal through the shared posting service: one live posting per event per source document. Lines: { mappingKey, itemId?,
// debit|credit (scaled) }. A Finance failure stops the whole action (nothing is moved or posted), never a silent gap.
export async function postJournal(client, c, { event: postingEvent, sourceType, sourceId, sourceNumber, reference, description, lines }) {
  const valued = lines.filter((line) => (line.debit ?? ZERO) !== ZERO || (line.credit ?? ZERO) !== ZERO);
  if (!valued.length) return null;
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.view", "accounting.journal.create"])] };
  try {
    const ledger = await getPrimaryLedger(client, ctx);
    const date = (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS day`)).rows[0].day;
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
      [c.organizationId, ledger.id])).rows[0];
    if (!journal) throw moError(409, "MFG_MO_FINANCE_FAILED", "Finance: a General journal is not configured.");
    const merged = new Map();
    for (const line of valued) {
      const account = (await getAccountMapping(client, ctx, ledger.id, line.mappingKey, { ...(line.itemId ? { itemId: line.itemId } : {}), date })).account_id;
      const keyOf = `${account}:${line.label}`;
      const entry = merged.get(keyOf) ?? { accountId: account, label: line.label, amount: ZERO };
      entry.amount = add(entry.amount, sub(line.debit ?? ZERO, line.credit ?? ZERO));
      merged.set(keyOf, entry);
    }
    const rows = [...merged.values()].filter((entry) => money(entry.amount) !== "0.00" && money(entry.amount) !== "-0.00").map((entry) => ({ accountId: entry.accountId,
      description: `${entry.label} · ${reference}`, debit: entry.amount > ZERO ? money(entry.amount) : 0, credit: entry.amount < ZERO ? money(-entry.amount) : 0, referenceType: sourceType, referenceId: sourceId }));
    if (!rows.length) return null;
    const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() || "INR";
    const created = await createJournalEntry(client, ctx, { ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
      reference, description, currencyCode: currency, exchangeRate: "1", lines: rows },
    { internal: true, sourceModule: "manufacturing", sourceType, sourceId, sourceNumber, postingEvent });
    await postJournalEntry(client, ctx, created.entry.id, { internal: true, allowDraft: true });
    return created.entry.id;
  } catch (error) {
    if (error instanceof MoError) throw error;
    if (error instanceof AccountingError || (error?.status && error.status < 500)) throw moError(error.status ?? 409, "MFG_MO_FINANCE_FAILED", `Finance: ${error.message}`);
    throw error;
  }
}

// ------------------------------------------------------------------ costing
// The material cost of one unit of output: each recipe line's planned quantity per unit, priced at its actual average issue cost (its
// estimate when nothing is issued yet). Null with the lines that have no cost.
export function unitMaterialCost(order, materials) {
  const plannedOutput = D(order.planned_base_quantity);
  let total = ZERO;
  const missing = [];
  const basis = [];
  for (const material of materials.filter((row) => row.origin === "RECIPE" && D(row.planned_quantity) > ZERO)) {
    const issued = D(material.issued_quantity);
    const rate = issued > ZERO ? div(D(material.issued_cost), issued) : material.estimated_unit_cost !== null ? D(material.estimated_unit_cost) : null;
    if (rate === null) { missing.push(material.item_code); continue; }
    const perUnit = div(D(material.planned_quantity), plannedOutput);
    total = add(total, mul(perUnit, rate));
    basis.push({ code: material.item_code, perUnit: q(perUnit), rate: q(rate), source: issued > ZERO ? "Actual issue cost" : "Estimate" });
  }
  return { unitCost: missing.length ? null : total, missing, basis };
}
// Work in progress still held: issued material less what finished goods took, what was closed to variance and what scrap took out of it
// (abnormal loss written off, recoverable scrap moved to the scrap bin — Scrap, 0119).
export const wipBalance = (order) => sub(D(order.wip_material_cost), add(add(D(order.wip_capitalised_cost), D(order.wip_variance_cost)), D(order.wip_scrap_cost ?? 0)));
