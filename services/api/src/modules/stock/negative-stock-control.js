import { StockError } from "./errors.js";

// Negative-Stock Control: the one check every stock-consuming movement passes (postStockMovement calls it with the stock position locked).
//
// A decrease may take only what is available at that exact position (warehouse, location, batch) — on hand less what is reserved there.
// Beyond that:
//   serial stock never goes negative (NEGATIVE_SERIAL_STOCK_BLOCKED), batch stock never (NEGATIVE_BATCH_STOCK_BLOCKED);
//   reserved stock is never taken, override or not (INSUFFICIENT_AVAILABLE_STOCK);
//   otherwise the policy: the company's (block | allow_with_override), an item may force block. Block: NEGATIVE_STOCK_BLOCKED. Allow with
//   override: the movement needs an authorised override (permission, reason code, notes) — NEGATIVE_STOCK_OVERRIDE_REQUIRED without one — and
//   only on an untracked Moving-Average item (FIFO stock never goes negative), on a movement that consumes stock (an issue, a delivery, a difference adjustment), never a transfer, location or
//   disposition move, purchase return, reversal, count or the transit warehouse, and only when the stock has a cost to issue at.
// A backdated decrease is checked against every running balance after it (BACKDATED_NEGATIVE_STOCK), with the same override rule.
// A refusal carries what the user needs (on hand, reserved, available, requested, shortfall, where) and is written to the negative-stock
// history after its transaction has rolled back (recordBlockedNegativeStockAttempt).

const EPS = 1e-9;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
export const NEGATIVE_STOCK_POLICIES = Object.freeze([
  { id: "block", label: "Block negative stock" },
  { id: "allow_with_override", label: "Allow with authorised override (untracked items only)" },
]);
export const NEGATIVE_OVERRIDE_REASONS = Object.freeze([
  { id: "DELAYED_RECEIPT_POSTING", label: "Delayed receipt posting" },
  { id: "MIGRATION_TIMING", label: "Migration timing" },
  { id: "EMERGENCY_OPERATION", label: "Emergency operation" },
  { id: "AUTHORIZED_BACKDATE", label: "Authorised backdate" },
  { id: "OTHER", label: "Other (explain in the notes)" },
]);
const REASON_IDS = new Set(NEGATIVE_OVERRIDE_REASONS.map((reason) => reason.id));
// Movements that consume stock for good; everything else only moves stock the company keeps, or undoes a posting.
const OVERRIDABLE_LEDGER_TYPES = new Set(["adjustment_out", "sales_delivery", "production_issue"]);
const MIN_NOTES = 10;
const MIN_OTHER_NOTES = 20;

export function canOverrideNegativeStock(c) {
  return Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes("stock.negative.override"));
}

export async function getNegativeStockPolicy(client, organizationId) {
  const row = (await client.query(`SELECT negative_stock_policy, negative_stock_alerts_enabled FROM tenant.stock_settings WHERE organization_id = $1`, [organizationId])).rows[0];
  return { policy: row?.negative_stock_policy ?? "block", alertsEnabled: row ? Boolean(row.negative_stock_alerts_enabled) : true };
}

// An item may only be stricter than the company.
export function resolveNegativeStockPolicy(companyPolicy, item) {
  return item?.negative_stock_policy_override === "block" ? "block" : companyPolicy === "allow_with_override" ? "allow_with_override" : "block";
}

async function positionOf(client, organizationId, input) {
  return (await client.query(
    `SELECT item.code AS sku, item.name AS item_name, uom.code AS uom, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number
       FROM tenant.items item
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = item.organization_id AND warehouse.id = $3
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = item.organization_id AND location.id = $4
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = item.organization_id AND batch.id = $5
      WHERE item.organization_id = $1 AND item.id = $2`,
    [organizationId, input.itemId, input.warehouseId, input.warehouseLocationId || null, input.batchId || null])).rows[0] ?? {};
}

const MESSAGES = {
  INSUFFICIENT_AVAILABLE_STOCK: (f) => `Only ${f.available} ${f.uom} ${f.reserved > EPS ? "is available after reservations" : "is available"} at ${f.where}; ${f.requested} was requested (${f.shortfall} short). Reserved stock is not taken.`,
  NEGATIVE_STOCK_BLOCKED: (f) => `Not enough stock at ${f.where}: on hand ${f.onHand} ${f.uom}, requested ${f.requested} (${f.shortfall} short). Negative stock is blocked.`,
  NEGATIVE_BATCH_STOCK_BLOCKED: (f) => `Batch ${f.batch} holds only ${f.onHand} ${f.uom} at ${f.where}; ${f.requested} was requested. Batch stock never goes negative — choose another batch.`,
  NEGATIVE_SERIAL_STOCK_BLOCKED: (f) => `That serial number is not on hand at ${f.where}. Serial stock never goes negative.`,
  NEGATIVE_STOCK_OVERRIDE_REQUIRED: (f) => `Posting this would take ${f.sku} at ${f.where} to ${f.projected} ${f.uom} (on hand ${f.onHand}, requested ${f.requested}). Negative stock needs an authorised override with a reason.`,
};

// The refusal: an error carrying the facts, and the event written once its transaction has rolled back.
function refusal(status, code, facts, input, message) {
  const error = new StockError(status, message ?? MESSAGES[code](facts), code);
  error.details = { negativeStock: facts };
  error.negativeStockEvent = {
    eventType: code === "BACKDATED_NEGATIVE_STOCK" ? "backdate_blocked" : "blocked", code, itemId: input.itemId, warehouseId: input.warehouseId,
    locationId: input.warehouseLocationId || null, batchId: input.batchId || null, sourceType: input.referenceType ?? null,
    sourceId: input.referenceId ?? null, before: facts.onHand ?? null, movementQuantity: facts.requested === undefined ? null : -facts.requested,
    after: facts.projected ?? null, details: facts,
  };
  return error;
}

// The running balance of the position from the backdated date on, with this decrease in it: the first day it would be negative and the lowest
// balance it would reach.
export async function validateHistoricalStockPath(client, organizationId, input, quantity, effectiveOn) {
  const { rows } = await client.query(
    `WITH position AS (
       SELECT occurred_at, sum(quantity) OVER (ORDER BY occurred_at, created_at, id) AS running, row_number() OVER (ORDER BY occurred_at, created_at, id) AS seq
         FROM tenant.stock_movements WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
          AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5)
     SELECT COALESCE((SELECT running FROM position WHERE occurred_at < $6::date + time '12:00' ORDER BY seq DESC LIMIT 1), 0) AS before,
            (SELECT min(running) FROM position WHERE occurred_at >= $6::date + time '12:00') AS lowest,
            (SELECT min(occurred_at)::date::text FROM position WHERE occurred_at >= $6::date + time '12:00' AND running - $7 < -${EPS}) AS first_negative_on`,
    [organizationId, input.itemId, input.warehouseId, input.warehouseLocationId || null, input.batchId || null, effectiveOn, quantity]);
  const before = Number(rows[0].before);
  const lowest = round(Math.min(before, rows[0].lowest === null ? Infinity : Number(rows[0].lowest)) - quantity);
  const firstNegativeOn = before - quantity < -EPS ? effectiveOn : rows[0].first_negative_on;
  return { lowest, firstNegativeOn: lowest < -EPS ? firstNegativeOn : null };
}

// The override the user gave: allowed here, by this user, with a real reason.
export function validateNegativeStockOverride(c, override, { allowedHere, facts, input }) {
  if (!allowedHere)
    throw refusal(409, "NEGATIVE_STOCK_OVERRIDE_NOT_ALLOWED", facts, input,
      "Negative stock cannot be overridden here: transfers, location and disposition moves, purchase returns, reversals, counts, tracked items and FIFO-valued items never go below zero.");
  if (!canOverrideNegativeStock(c))
    throw refusal(403, "NEGATIVE_STOCK_OVERRIDE_NOT_ALLOWED", facts, input, "You do not have permission to override negative stock.");
  const reasonCode = String(override?.reasonCode ?? "").trim().toUpperCase();
  const notes = String(override?.notes ?? "").trim();
  if (!REASON_IDS.has(reasonCode))
    throw new StockError(400, "Choose why negative stock is being overridden.", "NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED");
  const minimum = reasonCode === "OTHER" ? MIN_OTHER_NOTES : MIN_NOTES;
  if (notes.length < minimum || /^(n\/?a|none|nil|-+|\.+)$/i.test(notes))
    throw new StockError(400, `Explain the override in at least ${minimum} characters${reasonCode === "OTHER" ? " (Other needs a detailed explanation)" : ""}.`, "NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED");
  return { reasonCode, notes: notes.slice(0, 2000) };
}

// The check itself. Returns { override } — the validated override when this movement needs one, else null. Throws when it may not post.
// context: { item (tracking_type, negative_stock_policy_override), old (quantity, reserved_quantity), qty, policy (the company's), ledgerType,
// effectiveOn, transit (the transit warehouse), countAdjustment }
export async function validateStockReduction(client, c, input, context) {
  try {
    return await checkStockReduction(client, c, input, context);
  } catch (error) {
    if (error?.negativeStockEvent) error.negativeStockEvent.userId = c.userId ?? null;
    throw error;
  }
}

async function checkStockReduction(client, c, input, context) {
  const { item, old, qty, effectiveOn } = context;
  const onHand = round(old.quantity);
  const reserved = round(old.reserved_quantity);
  const available = round(Math.max(onHand - reserved, 0));
  const policy = resolveNegativeStockPolicy(context.policy, item);
  const tracking = item.tracking_type || "none";
  let needsOverride = false;
  let facts = null;
  const factsOf = async (extra = {}) => {
    const where = await positionOf(client, c.organizationId, input);
    return { itemId: input.itemId, sku: where.sku ?? null, itemName: where.item_name ?? null, uom: where.uom ?? "", warehouseId: input.warehouseId,
      warehouse: where.warehouse_code ?? null, warehouseName: where.warehouse_name ?? null, locationId: input.warehouseLocationId || null, location: where.location_code ?? "MAIN",
      batchId: input.batchId || null, batch: where.batch_number ?? null, where: `${where.warehouse_code ?? "the warehouse"} / ${where.location_code ?? "MAIN"}${where.batch_number ? ` / batch ${where.batch_number}` : ""}`,
      onHand, reserved, available, requested: qty, shortfall: round(Math.max(qty - available, 0)), projected: round(onHand - qty), policy, tracking, ...extra };
  };
  if (qty > available + EPS) {
    facts = await factsOf();
    let code;
    if (tracking === "serial") code = onHand + EPS < qty ? "NEGATIVE_SERIAL_STOCK_BLOCKED" : "INSUFFICIENT_AVAILABLE_STOCK";
    else if (tracking === "batch") code = onHand + EPS < qty ? "NEGATIVE_BATCH_STOCK_BLOCKED" : "INSUFFICIENT_AVAILABLE_STOCK";
    else if (reserved > EPS || onHand + EPS >= qty) code = "INSUFFICIENT_AVAILABLE_STOCK";
    else if (policy === "block") code = "NEGATIVE_STOCK_BLOCKED";
    if (code) {
      // Stock is held per location and batch: when the request names none but the warehouse holds enough elsewhere, say so.
      let message;
      if (!input.warehouseLocationId || !input.batchId) {
        const elsewhere = Number((await client.query(
          `SELECT COALESCE(sum(greatest(quantity - reserved_quantity, 0)), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3`,
          [c.organizationId, input.itemId, input.warehouseId])).rows[0].q);
        if (elsewhere + EPS >= qty) {
          facts.elsewhere = round(elsewhere);
          message = `${MESSAGES[code](facts)} The warehouse holds enough in other locations or batches: choose the location (and batch) the stock is in.`;
        }
      }
      throw refusal(409, code, facts, input, message);
    }
    needsOverride = true;
  }
  if (effectiveOn) {
    const path = await validateHistoricalStockPath(client, c.organizationId, input, qty, effectiveOn);
    if (path.firstNegativeOn) {
      facts = { ...(facts ?? await factsOf()), firstNegativeOn: path.firstNegativeOn, lowestHistorical: path.lowest, effectiveOn };
      if (tracking !== "none" || policy === "block")
        throw refusal(409, "BACKDATED_NEGATIVE_STOCK", facts, input,
          `Taking ${qty} ${facts.uom} out on ${effectiveOn} would make ${facts.sku} at ${facts.where} negative on ${path.firstNegativeOn} (lowest ${path.lowest} ${facts.uom}), even though today's stock covers it. Choose a later date or post the missing receipt first.`);
      needsOverride = true;
    }
  }
  if (!needsOverride) return { override: null };
  // FIFO stock never goes negative: there is no cost layer to consume (Inventory Valuation).
  const allowedHere = tracking === "none" && item.valuation_method !== "fifo" && OVERRIDABLE_LEDGER_TYPES.has(context.ledgerType) && !context.transit && !context.countAdjustment
    && !input.reversesMovementId && input.referenceType !== "opening_stock";
  if (!input.negativeOverride) {
    facts.canOverride = allowedHere && canOverrideNegativeStock(c);
    facts.reasons = NEGATIVE_OVERRIDE_REASONS;
    throw refusal(409, allowedHere ? "NEGATIVE_STOCK_OVERRIDE_REQUIRED" : "NEGATIVE_STOCK_BLOCKED", facts, input);
  }
  return { override: { ...validateNegativeStockOverride(c, input.negativeOverride, { allowedHere, facts, input }), facts } };
}

// After the movement is in the ledger and the balance updated: the override record, and the negative position's exception opened, grown,
// partly or fully resolved — only ever by a real movement.
export async function recordNegativeStockEffects(client, c, { input, before, after, movement, override, group }) {
  const position = [c.organizationId, input.itemId, input.warehouseId, input.warehouseLocationId || null, input.batchId || null];
  const quantity = round(Number(movement.quantity));
  if (before >= -EPS && after >= -EPS && !override) return;
  const event = (eventType, exceptionId, extra = {}) => client.query(
    `INSERT INTO tenant.negative_stock_events (organization_id, event_type, item_id, warehouse_id, location_id, batch_id, exception_id, movement_id, source_document_type,
       source_document_id, quantity_before, movement_quantity, quantity_after, reason_code, notes, permission, details, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [c.organizationId, eventType, input.itemId, input.warehouseId, input.warehouseLocationId || null, input.batchId || null, exceptionId, movement.id,
      group?.source_document_type ?? null, group?.source_document_id ?? null, round(before), quantity, round(after), extra.reasonCode ?? null, extra.notes ?? null,
      extra.permission ?? null, JSON.stringify(extra.details ?? {}), c.userId ?? null]);
  const open = (await client.query(
    `SELECT * FROM tenant.negative_stock_exceptions WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3 AND location_id IS NOT DISTINCT FROM $4
        AND batch_id IS NOT DISTINCT FROM $5 AND status = 'open' FOR UPDATE`, position)).rows[0];
  let exceptionId = open?.id ?? null;
  if (after < -EPS) {
    if (open) {
      await client.query(`UPDATE tenant.negative_stock_exceptions SET current_quantity = $2, lowest_quantity = least(lowest_quantity, $2), last_movement_id = $3, updated_at = now() WHERE id = $1`,
        [open.id, round(after), movement.id]);
      await event(after < before ? "position_increased" : "partly_resolved", open.id);
    } else {
      exceptionId = (await client.query(
        `INSERT INTO tenant.negative_stock_exceptions (organization_id, item_id, warehouse_id, location_id, batch_id, origin, opened_by_movement_id, current_quantity, lowest_quantity, last_movement_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$7) RETURNING id`, [...position, override ? "override" : "reconciliation", movement.id, round(after)])).rows[0].id;
      await event("position_created", exceptionId);
    }
  } else if (open) {
    await client.query(`UPDATE tenant.negative_stock_exceptions SET status = 'resolved', current_quantity = $2, resolved_at = now(), resolved_by_movement_id = $3, last_movement_id = $3, updated_at = now() WHERE id = $1`,
      [open.id, round(after), movement.id]);
    await event("resolved", open.id, { details: { resolvedBy: movement.movement_number } });
  }
  if (override) {
    await client.query(
      `INSERT INTO tenant.negative_stock_overrides (organization_id, exception_id, movement_id, source_document_type, source_document_id, source_document_number, source_line_id,
         item_id, warehouse_id, location_id, quantity_before, movement_quantity, quantity_after, reason_code, notes, overridden_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.organizationId, exceptionId, movement.id, group?.source_document_type ?? null, group?.source_document_id ?? null, group?.source_document_number ?? null,
        movement.source_line_id ?? null, input.itemId, input.warehouseId, input.warehouseLocationId || null, round(before), quantity, round(after), override.reasonCode, override.notes,
        c.userId ?? null]);
    await event("override_used", exceptionId, { reasonCode: override.reasonCode, notes: override.notes, permission: "stock.negative.override",
      details: override.facts?.firstNegativeOn ? { backdated: true, firstNegativeOn: override.facts.firstNegativeOn, lowestHistorical: override.facts.lowestHistorical } : {} });
  }
}

// A refused movement's attempt, written in its own transaction after the request's has rolled back (the web route layer calls this).
export async function recordBlockedNegativeStockAttempt(client, organizationId, userId, error) {
  const attempt = error?.negativeStockEvent;
  if (!attempt) return false;
  userId = userId ?? attempt.userId ?? null;
  await client.query(
    `INSERT INTO tenant.negative_stock_events (organization_id, event_type, item_id, warehouse_id, location_id, batch_id, source_document_type, source_document_id,
       quantity_before, movement_quantity, quantity_after, details, actor_user_id)
     SELECT $1,$2,$3,$4,$5,$6,$7,
            CASE WHEN $8::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN $8::uuid END, $9,$10,$11,$12,$13
      WHERE EXISTS (SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $3) AND EXISTS (SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $4)`,
    [organizationId, attempt.eventType, attempt.itemId, attempt.warehouseId, attempt.locationId, attempt.batchId, attempt.sourceType, attempt.sourceId ?? null,
      attempt.before, attempt.movementQuantity, attempt.after, JSON.stringify({ code: attempt.code, ...attempt.details }), userId ?? null]);
  return true;
}

// The refusals every stock-consuming document passes on unchanged (with their facts and audit) when it wraps stock errors in its own.
export const NEGATIVE_STOCK_CODES = Object.freeze(["INSUFFICIENT_AVAILABLE_STOCK", "NEGATIVE_STOCK_BLOCKED", "NEGATIVE_BATCH_STOCK_BLOCKED", "NEGATIVE_SERIAL_STOCK_BLOCKED",
  "NEGATIVE_STOCK_OVERRIDE_REQUIRED", "NEGATIVE_STOCK_OVERRIDE_NOT_ALLOWED", "NEGATIVE_STOCK_OVERRIDE_REASON_REQUIRED", "NEGATIVE_STOCK_VALUATION_UNSUPPORTED",
  "BACKDATED_NEGATIVE_STOCK"]);
export const isNegativeStockCode = (code) => NEGATIVE_STOCK_CODES.includes(code);
export function carryNegativeStock(from, to) {
  if (from?.negativeStockEvent) to.negativeStockEvent = from.negativeStockEvent;
  if (from?.details && to.details === undefined) to.details = from.details;
  return to;
}

// The open negative positions (with what caused them) — for an item's stock page and the report. warehouseIds: the user's visible warehouses
// (null: all).
export async function openNegativeExceptions(client, organizationId, { itemId = null, warehouseIds = null } = {}) {
  const { rows } = await client.query(
    `SELECT exception.id, exception.item_id, exception.warehouse_id, exception.location_id, exception.batch_id, exception.origin, exception.opened_at, exception.current_quantity,
            exception.lowest_quantity, warehouse.code AS warehouse_code, COALESCE(location.code, 'MAIN') AS location_code, opener.movement_number AS opened_by_movement,
            override.reason_code, override.notes, override.source_document_type, override.source_document_id, override.source_document_number, actor.full_name AS overridden_by_name
       FROM tenant.negative_stock_exceptions exception
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = exception.organization_id AND warehouse.id = exception.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = exception.organization_id AND location.id = exception.location_id
       LEFT JOIN tenant.stock_movements opener ON opener.organization_id = exception.organization_id AND opener.id = exception.opened_by_movement_id
       LEFT JOIN LATERAL (SELECT * FROM tenant.negative_stock_overrides found WHERE found.organization_id = exception.organization_id AND found.exception_id = exception.id
                           ORDER BY found.overridden_at LIMIT 1) override ON true
       LEFT JOIN public.users actor ON actor.id = override.overridden_by
      WHERE exception.organization_id = $1 AND exception.status = 'open' AND ($2::uuid IS NULL OR exception.item_id = $2) AND ($3::uuid[] IS NULL OR exception.warehouse_id = ANY($3::uuid[]))
      ORDER BY exception.opened_at`, [organizationId, itemId, warehouseIds]);
  return rows.map((row) => ({ id: row.id, itemId: row.item_id, warehouseId: row.warehouse_id, warehouse: row.warehouse_code, locationId: row.location_id, location: row.location_code,
    batchId: row.batch_id, origin: row.origin, since: row.opened_at, onHand: round(row.current_quantity), lowest: round(row.lowest_quantity), cause: row.opened_by_movement,
    reasonCode: row.reason_code ?? null, notes: row.notes ?? null, overriddenBy: row.overridden_by_name ?? null,
    source: row.source_document_number ? { type: row.source_document_type, id: row.source_document_id, number: row.source_document_number } : null }));
}
