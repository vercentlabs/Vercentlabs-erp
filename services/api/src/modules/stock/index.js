import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { baseUnitPrice, normalizeQuantityToBase } from "../products/uom.js";
import { decimal, formatDecimal } from "../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";
import { restrictedStockSql } from "./rules.js";
import { ledgerLocation, resolveDefaultWarehouse, validateWarehouseOperation } from "./warehouses.js";
import { dispositionAt, internalMoveTypes, ledgerSourceOf, openMovementGroup, operationOf, resolveLedgerType } from "./ledger-posting.js";

import { StockError } from "./errors.js";
import { recordNegativeStockEffects, validateStockReduction } from "./negative-stock-control.js";
import { planReplay, planValuation, plannedUnitCost, recordValuation } from "./valuation-engine.js";
import { followHeldStock } from "./quality-hold-control.js";
export { StockError };
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0)
    throw new StockError(400, `${name} must be greater than zero.`);
  return n;
};
const has = (c, p) =>
  c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p))
    throw new StockError(
      403,
      "You do not have permission to perform this stock operation.",
      "PERMISSION_DENIED",
    );
};
export function stockContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: session.permissions || [],
    roleSlugs: session.roleSlugs || [],
  };
}
export async function getStockDashboard(client, c) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT COALESCE(sum(quantity),0)::text total_quantity,COALESCE(sum(quantity*average_cost),0)::text inventory_value,COALESCE(sum(reserved_quantity),0)::text reserved_quantity,count(DISTINCT item_id)::int stocked_items,count(DISTINCT warehouse_id)::int warehouses FROM tenant.stock_balances WHERE organization_id=$1`,
    [c.organizationId],
  );
  const low = await client.query(
    // Items that need replenishing (Reorder Level: the projection of enabled rules whose projected position is at or below the reorder level).
    `SELECT count(*)::int count FROM tenant.inventory_reorder_status s JOIN tenant.inventory_reorder_rules r ON r.id=s.rule_id WHERE s.organization_id=$1 AND r.enabled AND s.status IN ('reorder_required','out_of_stock')`,
    [c.organizationId],
  );
  return { ...rows[0], low_stock_items: low.rows[0].count };
}
async function settings(client, c) {
  const { rows } = await client.query(
    `SELECT negative_stock_policy,costing_method FROM tenant.stock_settings WHERE organization_id=$1`,
    [c.organizationId],
  );
  return (
    rows[0] || { negative_stock_policy: "block", costing_method: "moving_average" }
  );
}
async function stockDimension(client, c, input) {
  const item = (await client.query(
    // An inactive item keeps its stock movable (returned, transferred, adjusted or disposed of); a draft item has none.
    `SELECT id,uom_id,track_inventory,negative_stock_policy_override,standard_cost,tracking_type,valuation_method FROM tenant.items WHERE organization_id=$1 AND id=$2 AND lifecycle_status IN ('active','inactive')`,
    [c.organizationId, input.itemId],
  )).rows[0];
  if (!item)
    throw new StockError(404, "Stock item was not found.", "STOCK_ITEM_NOT_FOUND");
  if (!item.track_inventory)
    throw new StockError(409, "This item is not inventory-tracked.", "STOCK_ITEM_NOT_TRACKED");

  const warehouse = (await client.query(
    `SELECT id,system_role FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, input.warehouseId],
  )).rows[0];
  if (!warehouse)
    throw new StockError(404, "Warehouse was not found.", "STOCK_WAREHOUSE_NOT_FOUND");

  if (input.warehouseLocationId) {
    const location = (await client.query(
      `SELECT id FROM tenant.warehouse_locations WHERE organization_id=$1 AND id=$2 AND warehouse_id=$3 AND status='active'`,
      [c.organizationId, input.warehouseLocationId, input.warehouseId],
    )).rows[0];
    if (!location)
      throw new StockError(404, "Warehouse location was not found in the selected warehouse.", "STOCK_LOCATION_NOT_FOUND");
  }

  if (input.batchId) {
    const batch = (await client.query(
      `SELECT id FROM tenant.stock_batches WHERE organization_id=$1 AND id=$2 AND item_id=$3 AND status='active'`,
      [c.organizationId, input.batchId, input.itemId],
    )).rows[0];
    if (!batch)
      throw new StockError(404, "Batch was not found for the selected item.", "STOCK_BATCH_NOT_FOUND");
  }

  if (input.serialId) {
    const serial = (await client.query(
      `SELECT id FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2 AND item_id=$3`,
      [c.organizationId, input.serialId, input.itemId],
    )).rows[0];
    if (!serial)
      throw new StockError(404, "Serial number was not found for the selected item.", "STOCK_SERIAL_NOT_FOUND");
  }

  return { item, warehouse };
}

// F295: tenant.items.tracking_type (migration 117) is the item master's
// declaration that it must be sold/issued against a specific batch or
// serial -- previously nothing anywhere required one or checked it made
// sense. For 'batch' items, stock_balances is already correctly
// dimensioned by batch_id (see the balance query in postStockMovement
// below), so the only real gap was that a batch was never actually
// REQUIRED on an issue; the existing FOR UPDATE row lock and
// quantity/reserved-quantity check already correctly prevent a batch from
// going negative once one is supplied, so no separate state machine is
// needed for batches the way serials need one.
function requireTrackingReference(item, movementType, input) {
  if (movementType !== "issue") return;
  if (item.tracking_type === "batch" && !input.batchId) {
    throw new StockError(400, "This item requires a batch to be selected before it can be issued.", "STOCK_BATCH_REQUIRED");
  }
  if (item.tracking_type === "serial" && !input.serialId) {
    throw new StockError(400, "This item requires a serial number to be selected before it can be issued.", "STOCK_SERIAL_REQUIRED");
  }
}

// F295: a serial is a single, discrete unit -- unlike a batch's quantity,
// it can only ever be in one of two coherent states: sitting in stock
// ('available') or already sold ('sold'). This is the ONLY code anywhere
// that ever transitions tenant.stock_serials.status (see migration 117's
// comment). Locked with its own FOR UPDATE so two concurrent issues
// against the SAME serial id serialize on this row: the second one to
// reach here always observes the first one's already-committed 'sold'
// status and is rejected, closing the double-sell race deterministically
// rather than relying on timing.
//
// Documented rule for 'receipt' (the return/restock direction): a serial
// can only be receipted back to 'available' from 'sold' -- that is the
// only prior state a genuine return can coherently come from (the serial
// was sold on the original sale, and this receipt is undoing exactly
// that). A receipt against a serial that is already 'available' has no
// coherent prior state to undo (it was never sold, or was already
// returned once) and is rejected rather than silently accepted, which
// would let the same physical return double-credit stock. A 'receipt'
// with no serialId at all (e.g. bulk initial stock intake before any
// serial numbers are individually registered) is left alone -- this
// module has no serial-registration endpoint yet, so requiring one on
// every receipt would make it impossible to ever receive serial-tracked
// stock for the first time; that is a disclosed, separate gap, not one
// this pass silently papers over.
async function applySerialTransition(client, c, input, item, movementType) {
  if (item.tracking_type !== "serial" || !input.serialId) return;
  if (movementType === "receipt" && input.serialRegistered) {
    // The serial number was registered by this very receipt: it starts in stock where it was received.
    await client.query(`UPDATE tenant.stock_serials SET status='available',warehouse_id=$3,warehouse_location_id=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 AND item_id=$5`,
      [c.organizationId, input.serialId, input.warehouseId, input.warehouseLocationId || null, input.itemId]);
    return;
  }
  if (movementType === "issue") {
    const held = (await client.query(`SELECT id, reservation_number FROM tenant.stock_reservations WHERE organization_id=$1 AND serial_id=$2 AND status='active'`, [c.organizationId, input.serialId])).rows[0];
    if (held && held.id !== input.reservationId)
      throw new StockError(409, `This serial number is reserved (${held.reservation_number}); it leaves only through that reservation.`, "STOCK_SERIAL_RESERVED");
  }
  const serial = await client.query(
    `SELECT id,status,warehouse_id,warehouse_location_id FROM tenant.stock_serials
     WHERE organization_id=$1 AND id=$2 AND item_id=$3
     FOR UPDATE`,
    [c.organizationId, input.serialId, input.itemId],
  );
  const row = serial.rows[0];
  if (!row) throw new StockError(404, "Serial number was not found for the selected item.", "STOCK_SERIAL_NOT_FOUND");
  if (movementType === "issue") {
    // A serial number is on hand where it is, once: issuing one that is not (sold, or in another warehouse) would be negative serial stock.
    if (row.status !== "available" || (row.warehouse_id && row.warehouse_id !== input.warehouseId)) {
      throw new StockError(409, "That serial number is not on hand here (already issued, or in another warehouse). Serial stock never goes negative.", "NEGATIVE_SERIAL_STOCK_BLOCKED");
    }
    // ...and at its own location: a unit on quality hold, in quarantine or damaged never leaves from the warehouse's available stock.
    const defaultStorage = async () => (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id=$1 AND warehouse_id=$2 AND is_default_storage`,
      [c.organizationId, input.warehouseId])).rows[0]?.id ?? null;
    if (row.warehouse_location_id !== (input.warehouseLocationId || null)) {
      const fallback = await defaultStorage();
      if ((row.warehouse_location_id ?? fallback) !== (input.warehouseLocationId || fallback))
        throw new StockError(409, "That serial number is not at this location. Issue it from where it is kept.", "STOCK_SERIAL_NOT_AT_LOCATION");
    }
    await client.query(
      `UPDATE tenant.stock_serials SET status='sold',warehouse_id=$3,warehouse_location_id=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, row.id, input.warehouseId, input.warehouseLocationId || null],
    );
  } else if (movementType === "receipt") {
    if (row.status !== "sold") {
      throw new StockError(
        409,
        "This serial number is not currently marked as sold, so it has no coherent sale to return.",
        "STOCK_SERIAL_NOT_RETURNABLE",
      );
    }
    await client.query(
      `UPDATE tenant.stock_serials SET status='available',warehouse_id=$3,warehouse_location_id=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, row.id, input.warehouseId, input.warehouseLocationId || null],
    );
  }
}

// A quantity entered in another unit than the item's base (2 BOX of 20): checked and converted by the shared conversion service. The ledger
// gets the base quantity (40); the movement keeps what was entered, its unit and factor. A unit cost entered per that unit becomes the cost
// of one base unit (₹5,000 / CARTON of 100 = ₹50 / PCS).
async function enteredInUnit(client, c, input, purpose = "inventory") {
  if (!input.uomId) return { input, entered: null };
  const unit = await normalizeQuantityToBase(client, c.organizationId, input.itemId, input.uomId, input.quantity, { purpose });
  if (!unit.ok) throw new StockError(unit.reason === "no_conversion" || unit.reason === "not_enabled" || unit.reason === "unit_inactive" ? 409 : 400, unit.message, unit.code ?? "STOCK_UOM_INVALID");
  if (unit.unit.isBase) return { input: { ...input, quantity: formatDecimal(unit.baseQuantity) }, entered: null };
  const enteredCost = input.unitCost == null || input.unitCost === "" ? null : decimal(String(input.unitCost));
  return {
    input: { ...input, quantity: formatDecimal(unit.baseQuantity), unitCost: enteredCost === null ? input.unitCost : formatDecimal(baseUnitPrice(enteredCost, unit.factor)) },
    entered: { uomId: input.uomId, quantity: formatDecimal(unit.quantity), factor: formatDecimal(unit.factor), unitCost: enteredCost === null ? null : formatDecimal(enteredCost),
      baseQuantity: formatDecimal(unit.baseQuantity) },
  };
}

// A movement posted by hand (no document behind it) is an adjustment in a warehouse the user may adjust; a document (receipt, delivery,
// return, transfer, opening stock) has checked its warehouse operation itself. Opening stock comes only from an Opening Stock document being
// posted (modules/stock/opening-stock.js), never as a loose movement. A location chosen as MAIN is the ledger's "no location".
async function placeMovement(client, c, input) {
  if (input.referenceType === "opening_stock") {
    const document = (await client.query(`SELECT status FROM tenant.opening_stocks WHERE organization_id=$1 AND id=$2`, [c.organizationId, input.referenceId || null])).rows[0];
    if (document?.status !== "draft")
      throw new StockError(409, "Opening stock is brought in only by posting an Opening Stock document.", "STOCK_OPENING_DOCUMENT_REQUIRED");
  }
  if (!input.referenceType) await validateWarehouseOperation(client, c, input.warehouseId, "adjust", { label: "Stock movement" });
  return { ...input, warehouseLocationId: await ledgerLocation(client, c.organizationId, input.warehouseId, input.warehouseLocationId || null) };
}

// When a movement takes effect. Opening stock: its cutoff. A movement posted by hand: effectiveOn (YYYY-MM-DD) when it happened earlier —
// backdating needs its own permission and never reaches the future. Everything else: now. The ledger keeps both: occurred_at (effective)
// and created_at (posted).
async function effectiveDateOf(client, c, input) {
  if (input.referenceType === "opening_stock") return input.occurredOn ?? null;
  // A document's own date (a goods receipt's receipt date): the document has validated it; never the future, never a closed period.
  const documented = Boolean(input.referenceType && input.occurredOn);
  if (!documented && (input.referenceType || !input.effectiveOn)) return null;
  const day = String(documented ? input.occurredOn : input.effectiveOn).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new StockError(400, "The effective date is not a valid date.", "STOCK_EFFECTIVE_DATE_INVALID");
  const today = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  if (day > today) throw new StockError(400, "A stock movement cannot take effect in the future.", "STOCK_EFFECTIVE_DATE_FUTURE");
  if (day === today) return null;
  if (!documented && !has(c, "stock.backdate")) throw new StockError(403, "You do not have permission to backdate stock movements.", "STOCK_BACKDATE_FORBIDDEN");
  // Never into a closed or locked accounting period.
  const period = (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id=$1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type='standard' DESC, start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0];
  if (period && period.status !== "open")
    throw new StockError(409, `The accounting period ${period.name} is ${period.status}: stock cannot be backdated into it.`, "STOCK_PERIOD_CLOSED");
  return day;
}

// A document line's own unit snapshot (2 BOX at 20 PCS each, as the line recorded it): kept on the movement beside the base quantity.
function documentUnit(transaction) {
  if (!transaction?.uomId || transaction.quantity === null || transaction.quantity === undefined || !transaction.factor) return null;
  return { uomId: transaction.uomId, quantity: formatDecimal(decimal(String(transaction.quantity))), factor: formatDecimal(decimal(String(transaction.factor))), unitCost: null };
}

// A reversal undoes exactly one posted movement: the same item, warehouse, location, batch and serial, the opposite quantity, once.
async function reversalTarget(client, c, input, signed) {
  const original = (await client.query(`SELECT * FROM tenant.stock_movements WHERE organization_id=$1 AND id=$2`, [c.organizationId, input.reversesMovementId])).rows[0];
  if (!original) throw new StockError(404, "The movement to reverse was not found.", "STOCK_MOVEMENT_NOT_FOUND");
  if (original.ledger_type === "reversal") throw new StockError(409, "A reversal is not reversed again; post the correcting document instead.", "STOCK_REVERSAL_OF_REVERSAL");
  const already = (await client.query(`SELECT movement_number FROM tenant.stock_movements WHERE organization_id=$1 AND reversed_movement_id=$2`, [c.organizationId, original.id])).rows[0];
  if (already) throw new StockError(409, `Movement ${original.movement_number} was already reversed by ${already.movement_number}.`, "STOCK_MOVEMENT_ALREADY_REVERSED");
  const same = (a, b) => (a ?? null) === (b ?? null);
  if (original.item_id !== input.itemId || original.warehouse_id !== input.warehouseId || !same(original.warehouse_location_id, input.warehouseLocationId || null)
      || !same(original.batch_id, input.batchId || null) || !same(original.serial_id, input.serialId || null) || Math.abs(Number(original.quantity) + signed) > 1e-9)
    throw new StockError(409, `A reversal of ${original.movement_number} takes back exactly what it moved, where it moved it.`, "STOCK_REVERSAL_MISMATCH");
  return original;
}

// Reverses posted movements with compensating ones (the originals stay): one opposite movement each, restoring exactly the original
// valuation (Inventory Valuation: the value it moved, and for FIFO the layers it took or opened), in a reversal group linked to the original posting. Idempotent per movement. The source document decides whether it may be reversed; there is no
// general "reverse movement" action. options: { reason, referenceType, referenceId, keyPrefix }
export async function reverseStockMovements(client, c, movementIds, options = {}) {
  const ids = [...new Set((movementIds ?? []).filter(Boolean))];
  if (!ids.length) return { groupId: null, movements: [] };
  const originals = (await client.query(`SELECT * FROM tenant.stock_movements WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY ledger_sequence DESC`, [c.organizationId, ids])).rows;
  if (originals.length !== ids.length) throw new StockError(404, "A movement to reverse was not found.", "STOCK_MOVEMENT_NOT_FOUND");
  const first = (await client.query(`SELECT * FROM tenant.stock_movement_groups WHERE organization_id=$1 AND id=$2`, [c.organizationId, originals[originals.length - 1].movement_group_id])).rows[0];
  const group = await openMovementGroup(client, c, { sourceType: first.source_document_type, sourceId: first.source_document_id, sourceNumber: first.source_document_number,
    operation: "reversal", postingKey: `reverse:${first.id}`, reversalOfGroupId: first.id, reason: options.reason ?? null });
  const ctx = { ...c, permissions: [...new Set([...(c.permissions || []), "stock.receive", "stock.issue"])] };
  const movements = [];
  for (const original of originals) {
    const inbound = Number(original.quantity) > 0;
    movements.push(await postStockMovement(client, ctx, {
      movementType: inbound ? "issue" : "receipt", itemId: original.item_id, warehouseId: original.warehouse_id, warehouseLocationId: original.warehouse_location_id,
      batchId: original.batch_id, serialId: original.serial_id ?? undefined, quantity: String(Math.abs(Number(original.quantity))),
      referenceType: options.referenceType ?? original.reference_type, referenceId: options.referenceId ?? original.reference_id, sourceLineId: original.source_line_id,
      reason: options.reason ?? `Reversal of ${original.movement_number}`, reversesMovementId: original.id, groupId: group.id,
      idempotencyKey: `${options.keyPrefix ?? "reverse"}:${original.id}`,
    }));
  }
  return { groupId: group.id, movements };
}

// The whole of one posting reversed (every movement of the group).
export async function reverseInventoryMovementGroup(client, c, groupId, options = {}) {
  const ids = (await client.query(`SELECT id FROM tenant.stock_movements WHERE organization_id=$1 AND movement_group_id=$2`, [c.organizationId, groupId])).rows.map((row) => row.id);
  if (!ids.length) throw new StockError(404, "That stock posting was not found.", "STOCK_MOVEMENT_GROUP_NOT_FOUND");
  return reverseStockMovements(client, c, ids, options);
}

export async function postStockMovement(client, c, rawInput = {}) {
  const unit = await enteredInUnit(client, c, rawInput);
  // What was entered: converted here (uomId), or the unit snapshot of the document line the base quantity came from (transaction).
  const entered = unit.entered ?? documentUnit(rawInput.transaction);
  let input = unit.input;
  // Posted by hand: no document behind it (it becomes its own adjustment document).
  if (["manual", "stock_adjustment"].includes(input.referenceType) && !input.referenceId) input = { ...input, referenceType: null };
  const movementType = String(input.movementType || "").toLowerCase();
  // return: goods coming back from a customer (a sales return), received like a receipt.
  if (!new Set(["receipt", "issue", "adjustment", "return"]).has(movementType))
    throw new StockError(400, "Movement type must be receipt, issue, adjustment or return.", "STOCK_MOVEMENT_TYPE_INVALID");
  const permission = movementType === "receipt" || movementType === "return" ? "stock.receive" : movementType === "issue" ? "stock.issue" : "stock.adjust";
  need(c, permission);

  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, {
    operation: "stock.movement",
    key: idempotencyKey,
    payload: { ...rawInput, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const qty = num(input.quantity, "Quantity");
  const direction = movementType === "adjustment" ? String(input.adjustmentDirection || "increase").toLowerCase() : null;
  if (movementType === "adjustment" && !new Set(["increase", "decrease"]).has(direction))
    throw new StockError(400, "Adjustment direction must be increase or decrease.", "STOCK_ADJUSTMENT_DIRECTION_INVALID");
  const signed = movementType === "issue" || direction === "decrease" ? -qty : qty;
  const { item, warehouse } = await stockDimension(client, c, { ...input, movementType });
  input = await placeMovement(client, c, input);
  // An adjustment follows the tracking rules of its direction: a decrease names its batch or serial number, like an issue.
  const tracked = movementType === "adjustment" ? (signed < 0 ? "issue" : "receipt") : movementType;
  requireTrackingReference(item, tracked, input);
  const effectiveOn = await effectiveDateOf(client, c, input);
  // Stock under an active physical count does not move; the count's own adjustment is the one thing that posts there.
  const counting = await countLockOn(client, c.organizationId, { warehouseId: input.warehouseId, locationId: input.warehouseLocationId || null, itemId: input.itemId,
    exceptCountId: input.physicalCountId || null });
  if (counting) throw underCount(counting);
  await lockInventoryItem(client, c, input.itemId);
  const cfg = await settings(client, c);

  const current = await client.query(
    `SELECT quantity,reserved_quantity,average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 FOR UPDATE`,
    [c.organizationId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null],
  );
  const old = current.rows[0] || { quantity: 0, reserved_quantity: 0, average_cost: 0 };
  const next = Number(old.quantity) + signed;
  // Negative-Stock Control (negative-stock-control.js): a decrease takes only what is available at this exact position, unless an authorised
  // override may take an untracked item below zero; a backdated one is checked against the history after it.
  const ledgerTypeOf = input.reversesMovementId ? "reversal" : resolveLedgerType(input, signed);
  const { override } = signed < 0
    ? await validateStockReduction(client, c, input, { item, old, qty, policy: cfg.negative_stock_policy, ledgerType: ledgerTypeOf, effectiveOn,
      transit: Boolean(warehouse.system_role), countAdjustment: Boolean(input.physicalCountId) })
    : { override: null };
  // F295: validated and transitioned under the serial row's own FOR UPDATE
  // lock (inside applySerialTransition), in the same transaction as the
  // balance lock taken just above -- see that function's doc comment for
  // the exact available/sold rule.
  await applySerialTransition(client, c, input, item, tracked);

  const movementNumber = await nextDocumentNumber(client, c, {
    documentType: "stock_movement",
    prefix: "STK",
  });
  // The ledger facts: what the movement means, the posting (movement group) and document it belongs to, the disposition of the stock it
  // moved and, for a reversal, what it reverses. A movement posted by hand is its own adjustment document.
  const reverses = input.reversesMovementId ? await reversalTarget(client, c, input, signed) : null;
  const ledgerType = reverses ? "reversal" : resolveLedgerType(input, signed);
  // Inventory Valuation (valuation-engine.js): the value of this movement, decided with the warehouse's valuation stream locked. A location or
  // disposition move inside the warehouse is valued by what it moves, never re-costed (its legs keep their own ledger type).
  const valuation = await planReplay(client, c, await planValuation(client, c, { item, warehouseId: input.warehouseId, signed, ledgerType: reverses ? null : ledgerType,
    effectiveOn, reverses, input: { unitCost: input.unitCost, value: input.value, costSource: input.costSource, valueFromMovementId: input.valueFromMovementId,
      costSnapshot: input.costSnapshot } }), effectiveOn ? `${effectiveOn} 12:00` : null);
  const cost = plannedUnitCost(valuation);
  const disposition = await dispositionAt(client, c.organizationId, input.warehouseLocationId || null);
  const source = await ledgerSourceOf(client, c.organizationId, input.referenceType, input.referenceId);
  const effectiveAt = effectiveOn ? `${effectiveOn} 12:00` : null;
  const group = input.groupId
    ? (await client.query(`SELECT * FROM tenant.stock_movement_groups WHERE organization_id=$1 AND id=$2`, [c.organizationId, input.groupId])).rows[0]
    : await openMovementGroup(client, c, source
      ? { sourceType: source.type, sourceId: source.id, sourceNumber: source.number, operation: operationOf(ledgerType), effectiveAt, reversalOfGroupId: reverses?.movement_group_id ?? null }
      : { adjustment: true, sourceType: "stock_adjustment", sourceNumber: movementNumber, operation: ledgerType, effectiveAt, reason: input.reason || null, postingKey: idempotencyKey ? `adjustment:${idempotencyKey}` : null });
  if (!group) throw new StockError(404, "The stock posting this movement belongs to was not found.", "STOCK_MOVEMENT_GROUP_NOT_FOUND");
  const movement = await client.query(
    // Opening stock is dated at midday of its cutoff (the first movement of the warehouse's history, the same day in any time zone);
    // everything else when it happens.
    `INSERT INTO tenant.stock_movements(organization_id,movement_number,movement_type,item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,unit_cost,reference_type,reference_id,reason,created_by,idempotency_key,cost_variance,entered_uom_id,entered_quantity,entered_conversion_factor,entered_unit_cost,occurred_at,
       movement_group_id,ledger_type,base_uom_id,disposition,source_line_id,reversed_movement_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,COALESCE($21::date+time '12:00',now()),$22,$23,$24,$25,$26,$27) RETURNING *`,
    [c.organizationId,movementNumber,movementType,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,input.serialId || null,signed,cost,
      source ? input.referenceType : "stock_adjustment",source ? input.referenceId : group.id,input.reason || null,c.userId,idempotencyKey,0,
      entered?.uomId ?? null,entered?.quantity ?? null,entered?.factor ?? null,entered?.unitCost ?? null,effectiveOn,
      group.id,ledgerType,item.uom_id,disposition,input.sourceLineId ?? source?.lineId ?? null,reverses?.id ?? null],
  );
  // The database refuses a balance going below zero unless this movement carries an authorised override (tenant.guard_negative_stock_balance).
  if (override && next < 0) await client.query(`SELECT set_config('vercent.negative_stock', 'override', true)`);
  await client.query(
    // The current-balance projection moves in the same transaction as the ledger: one more version, and the movement that changed it.
    `INSERT INTO tenant.stock_balances(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reserved_quantity,average_cost,version,last_movement_id) VALUES($1,$2,$3,$4,$5,$6,0,$7,1,$8) ON CONFLICT(organization_id,item_id,warehouse_id,warehouse_location_id,batch_id) DO UPDATE SET quantity=EXCLUDED.quantity,version=tenant.stock_balances.version+1,last_movement_id=EXCLUDED.last_movement_id,updated_at=now()`,
    [c.organizationId,input.itemId,input.warehouseId,input.warehouseLocationId || null,input.batchId || null,next,cost,movement.rows[0].id],
  );
  if (override && next < 0) await client.query(`SELECT set_config('vercent.negative_stock', '', true)`);
  await recordNegativeStockEffects(client, c, { input, before: Number(old.quantity), after: next, movement: movement.rows[0], override, group });
  // The value, recorded with the movement (and the carrying rate every position of the item in this warehouse shows).
  await recordValuation(client, c, valuation, movement.rows[0]);
  // Quality holds follow held stock that another document moves (quality-hold-control.js).
  await followHeldStock(client, c, { input, movement: movement.rows[0], signed, ledgerType, group });
  const response = { ...movement.rows[0], replayed: false };
  await completeIdempotentOperation(client, c, idempotency, {
    response,
    aggregateType: "stock_movement",
    aggregateId: movement.rows[0].id,
  });
  return response;
}

// Stock moved inside one warehouse on behalf of another document — goods released from a receipt's inspection hold, a rejection moved into or
// out of quality: out of one location and into another, the same batch and serial numbers; the warehouse value does not change. A Location Transfer when
// the disposition stays the same, a Disposition change when it does (Internal Transfers never change disposition; this is where it changes).
// input: { itemId, warehouseId, fromLocationId, toLocationId, batchId?, serialIds?, quantity (base), referenceType, referenceId, reason?, idempotencyKey }
export async function moveStockWithinWarehouse(client, c, input = {}) {
  if (!input.referenceType || !input.referenceId) throw new StockError(400, "A stock move inside a warehouse needs the document it is for.", "STOCK_SOURCE_REQUIRED");
  const from = await ledgerLocation(client, c.organizationId, input.warehouseId, input.fromLocationId || null, { label: "From" });
  const to = await ledgerLocation(client, c.organizationId, input.warehouseId, input.toLocationId || null, { label: "To" });
  if ((from ?? null) === (to ?? null)) throw new StockError(400, "Source and destination must be different.", "STOCK_TRANSFER_SAME_LOCATION");
  const legs = internalMoveTypes(await dispositionAt(client, c.organizationId, from), await dispositionAt(client, c.organizationId, to));
  const ctx = { ...c, permissions: [...new Set([...(c.permissions || []), "stock.issue", "stock.receive"])] };
  const units = input.serialIds?.length ? input.serialIds.map((serialId) => ({ serialId, quantity: "1" })) : [{ serialId: null, quantity: String(input.quantity) }];
  const movements = [];
  for (const unit of units) {
    const suffix = unit.serialId ? `:${unit.serialId}` : "";
    const base = { itemId: input.itemId, warehouseId: input.warehouseId, batchId: input.batchId || null, serialId: unit.serialId ?? undefined, quantity: unit.quantity,
      referenceType: input.referenceType, referenceId: input.referenceId, reason: input.reason ?? null, holdOperation: input.holdOperation ?? undefined, groupId: input.groupId ?? undefined };
    const out = await postStockMovement(client, ctx, { ...base, movementType: "issue", warehouseLocationId: from, ledgerType: legs.out, idempotencyKey: `${input.idempotencyKey}:out${suffix}` });
    const into = await postStockMovement(client, ctx, { ...base, movementType: "receipt", warehouseLocationId: to, ledgerType: legs.in, holdCarryFrom: out.id,
      idempotencyKey: `${input.idempotencyKey}:in${suffix}` });
    movements.push(out, into);
  }
  return { movements };
}

// F112-F114 governed reservation and availability primitives. The stock ledger
// remains the quantity source of truth; reservations only adjust
// stock_balances.reserved_quantity and never invent a stock movement.
export async function getStockAvailability(client, c, input = {}) {
  need(c, "stock.view");
  if (!input.itemId) throw new StockError(400, "Item is required.", "STOCK_ITEM_REQUIRED");
  const values = [c.organizationId, input.itemId];
  let filter = "";
  if (input.warehouseId) { values.push(input.warehouseId); filter += ` AND balance.warehouse_id=$${values.length}`; }
  if (input.warehouseLocationId) { values.push(input.warehouseLocationId); filter += ` AND balance.warehouse_location_id=$${values.length}`; }
  if (input.batchId) { values.push(input.batchId); filter += ` AND balance.batch_id=$${values.length}`; }
  // On hand counts every row; available only usable ones (USABLE_ROW): stock in a quality or
  // inactive location, or in a blocked or expired batch, is on hand but cannot be sold.
  const { rows } = await client.query(
    `SELECT balance.item_id,${input.warehouseId ? "balance.warehouse_id" : "NULL::uuid AS warehouse_id"},
            COALESCE(sum(balance.quantity),0)::text AS on_hand_quantity,
            COALESCE(sum(balance.reserved_quantity),0)::text AS reserved_quantity,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN greatest(balance.quantity-balance.reserved_quantity,0) ELSE 0 END),0)::text AS available_quantity,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} AND balance.quantity-balance.reserved_quantity>0 THEN greatest(balance.quantity-balance.reserved_quantity,0) ELSE 0 END),0)::text AS available_to_promise,
            COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN 0 ELSE balance.quantity END),0)::text AS unusable_quantity
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2${filter}
      GROUP BY balance.item_id${input.warehouseId ? ",balance.warehouse_id" : ""}`,
    values,
  );
  const row = rows[0] || {
    item_id: input.itemId,
    warehouse_id: input.warehouseId || null,
    on_hand_quantity: "0",
    reserved_quantity: "0",
    available_quantity: "0",
    available_to_promise: "0",
    unusable_quantity: "0",
  };
  const requested = input.requestedQuantity == null || input.requestedQuantity === "" ? null : num(input.requestedQuantity, "Requested quantity");
  return {
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    onHandQuantity: row.on_hand_quantity,
    reservedQuantity: row.reserved_quantity,
    // On hand in quality hold, quarantine or damaged, in inactive locations, or in blocked or expired batches: never available.
    unusableQuantity: row.unusable_quantity,
    availableQuantity: row.available_quantity,
    availableToPromise: row.available_to_promise,
    requestedQuantity: requested,
    canPromise: requested == null ? null : Number(row.available_to_promise) >= requested,
  };
}

// ---- Stock reservations ------------------------------------------------------
// A reservation commits usable stock in one warehouse (and one location and
// batch row) to a demand: an order line, a work order, a manual hold. It
// lowers what is available, never what is on hand, and creates no stock
// movement and no accounting entry. It keeps what it reserved; consumption by
// a delivery and releases are recorded beside it:
//   active = reserved − consumed − released
// stock_balances.reserved_quantity is a cache of the active quantities of a
// balance row, changed in the same statement order as the reservation and
// rebuilt from the reservations by rebuildInventoryBalanceProjection (balances.js).

// A balance row whose stock can be sold or issued: not in a quality or inactive location, nor in a blocked or expired batch.
export const USABLE_ROW = `NOT ${restrictedStockSql("location", "batch")}`;
const reservationRound = (value) => Math.round(Number(value) * 1e6) / 1e6;

// Every reservation belongs to a document of a known kind that exists in this company: a sales order line (or, for make-to-order, the order),
// a warehouse transfer, a purchase return or a manufacturing work order. There are no anonymous holds.
export const RESERVATION_SOURCES = Object.freeze({
  sales_order_line: { label: "Sales order", sql: `SELECT 1 FROM tenant.sales_order_lines WHERE organization_id=$1 AND id=$2` },
  sales_order: { label: "Sales order", sql: `SELECT 1 FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2` },
  // An internal transfer reserves its source stock when it is confirmed (Internal Transfers).
  stock_transfer: { label: "Internal transfer", sql: `SELECT 1 FROM tenant.inventory_transfers WHERE organization_id=$1 AND id=$2 AND status IN ('draft','confirmed')` },
  purchase_return: { label: "Purchase return", sql: `SELECT 1 FROM tenant.purchase_returns WHERE organization_id=$1 AND id=$2 AND document_status='draft'` },
  manufacturing_work_order: { label: "Work order", sql: `SELECT 1 FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND id=$2` },
});
async function assertReservationSource(client, c, input) {
  if (!input.referenceType || !input.referenceId)
    throw new StockError(400, "A reservation needs its source document.", "STOCK_RESERVATION_REFERENCE_REQUIRED");
  const source = RESERVATION_SOURCES[input.referenceType];
  if (!source) throw new StockError(400, "Stock is reserved only for a sales order, a warehouse transfer, a purchase return or a work order.", "STOCK_RESERVATION_SOURCE_INVALID");
  if (!/^[0-9a-f-]{36}$/i.test(String(input.referenceId)) || !(await client.query(source.sql, [c.organizationId, input.referenceId])).rows[0])
    throw new StockError(404, `The ${source.label.toLowerCase()} this reservation is for was not found (or is no longer open).`, "STOCK_RESERVATION_SOURCE_NOT_FOUND");
}

// The demand a reservation serves: its source document, the source line, and how much of the item that line still needs (base units; null when
// the source does not say). A draft or closed document holds nothing. Inventory supplies the stock; the source supplies the demand.
async function reservationDemand(client, c, input) {
  const notOpen = (label) => { throw new StockError(409, `The ${label} is not open for reservations: a draft or closed document holds no stock.`, "STOCK_RESERVATION_SOURCE_NOT_OPEN"); };
  const lineFor = async (table, parent, documentId, quantityColumn, itemColumn) => {
    const lines = (await client.query(`SELECT id, ${quantityColumn} AS quantity FROM tenant.${table} WHERE organization_id=$1 AND ${parent}=$2 AND ${itemColumn}=$3
        AND ($4::uuid IS NULL OR id=$4) ORDER BY id`, [c.organizationId, documentId, input.itemId, input.sourceLineId || null])).rows;
    if (input.sourceLineId && !lines.length) throw new StockError(404, "The source line was not found on that document for this item.", "STOCK_RESERVATION_SOURCE_LINE_INVALID");
    if (!lines.length) throw new StockError(409, "That item is not on the source document.", "STOCK_RESERVATION_SOURCE_LINE_INVALID");
    return lines.length === 1 ? { lineId: lines[0].id, open: Number(lines[0].quantity) } : { lineId: null, open: lines.reduce((sum, line) => sum + Number(line.quantity), 0) };
  };
  switch (input.referenceType) {
    case "sales_order_line": {
      const row = (await client.query(
        `SELECT version.sales_order_id, sales_order.lifecycle_status, line.item_id, COALESCE(NULLIF(line.conversion_factor, 0), 1) AS factor, line.quantity,
                progress.confirmed_quantity, progress.fulfilled_quantity, progress.cancelled_quantity
           FROM tenant.sales_order_lines line
           JOIN tenant.sales_order_versions version ON version.organization_id = line.organization_id AND version.id = line.sales_order_version_id
           JOIN tenant.sales_orders sales_order ON sales_order.organization_id = version.organization_id AND sales_order.id = version.sales_order_id
           LEFT JOIN tenant.sales_order_line_progress progress ON progress.organization_id = line.organization_id AND progress.sales_order_line_id = line.id
          WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, input.referenceId])).rows[0];
      if (row.item_id !== input.itemId) throw new StockError(409, "The order line is for another item.", "STOCK_RESERVATION_SOURCE_LINE_INVALID");
      if (row.lifecycle_status !== "confirmed") notOpen("sales order");
      const ordered = Number(row.confirmed_quantity ?? row.quantity);
      return { documentType: "sales_order", documentId: row.sales_order_id, lineId: input.referenceId,
        open: Math.max(ordered - Number(row.fulfilled_quantity ?? 0) - Number(row.cancelled_quantity ?? 0), 0) * Number(row.factor) };
    }
    case "sales_order":
      return { documentType: "sales_order", documentId: input.referenceId, lineId: null, open: null };
    case "stock_transfer": {
      const line = await lineFor("inventory_transfer_lines", "transfer_id", input.referenceId, "base_quantity", "item_id");
      return { documentType: "inventory_transfer", documentId: input.referenceId, ...line };
    }
    case "purchase_return": {
      // The return's lines were validated against what the goods receipt may still return: the reservation never exceeds that entitlement.
      const line = await lineFor("purchase_return_lines", "purchase_return_id", input.referenceId, "base_quantity", "product_id");
      return { documentType: "purchase_return", documentId: input.referenceId, ...line };
    }
    default:
      return { documentType: "manufacturing_work_order", documentId: input.referenceId, lineId: input.sourceLineId || null, open: null };
  }
}

// The reservation (one per source line and item) an allocation of `quantity` joins, under its lock: created on first use; its requested quantity
// is what the source needs now. exact: refused beyond the open demand; otherwise the room left is returned.
async function ensureReservation(client, c, input, quantity, { exact = true } = {}) {
  if (input.referenceType === "purchase_return") need(c, "stock.reservations.reserve_purchase_return");
  const demand = await reservationDemand(client, c, input);
  await client.query(
    `INSERT INTO tenant.inventory_reservations (organization_id, item_id, base_uom_id, reference_type, source_document_type, source_document_id, source_line_id, expires_at, created_by)
     SELECT $1, $2, uom_id, $3, $4, $5, $6, $7, $8 FROM tenant.items WHERE organization_id = $1 AND id = $2
     ON CONFLICT (organization_id, reference_type, source_document_id, COALESCE(source_line_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id) DO NOTHING`,
    [c.organizationId, input.itemId, input.referenceType, demand.documentType, demand.documentId, demand.lineId, input.expiresAt ?? null, c.userId ?? null]);
  const parent = (await client.query(
    `SELECT * FROM tenant.inventory_reservations WHERE organization_id = $1 AND reference_type = $2 AND source_document_id = $3 AND source_line_id IS NOT DISTINCT FROM $4 AND item_id = $5 FOR UPDATE`,
    [c.organizationId, input.referenceType, demand.documentId, demand.lineId, input.itemId])).rows[0];
  const active = Number(parent.active_base_quantity);
  const room = demand.open === null ? Infinity : reservationRound(Math.max(demand.open - active, 0));
  if (exact && quantity > room + 1e-9)
    throw Object.assign(new StockError(409, `The source still needs only ${reservationRound(demand.open)} and ${reservationRound(active)} is already reserved: ${reservationRound(quantity)} more cannot be reserved.`,
      "STOCK_RESERVATION_EXCEEDS_DEMAND"), { details: { open: reservationRound(demand.open), reserved: reservationRound(active), requested: reservationRound(quantity) } });
  await client.query(`UPDATE tenant.inventory_reservations SET requested_base_quantity = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, parent.id, demand.open === null ? reservationRound(active + quantity) : reservationRound(demand.open)]);
  return { id: parent.id, room, demand };
}

// A stock position (warehouse, location — null is MAIN — item) under an active physical count's lock: frozen from movements and new reservations.
const UNDER_COUNT_SQL = (warehouse, location, item) => `EXISTS (SELECT 1 FROM tenant.inventory_count_locks count_lock WHERE count_lock.organization_id = ${warehouse.split(".")[0]}.organization_id
  AND count_lock.warehouse_id = ${warehouse} AND count_lock.released_at IS NULL AND (NOT count_lock.location_scoped OR count_lock.location_id IS NOT DISTINCT FROM ${location})
  AND (count_lock.item_id IS NULL OR count_lock.item_id = ${item}))`;
async function countLockOn(client, organizationId, { warehouseId, locationId, itemId, exceptCountId = null }) {
  return (await client.query(
    `SELECT count_lock.count_id, count.document_number FROM tenant.inventory_count_locks count_lock JOIN tenant.physical_inventory_counts count ON count.id = count_lock.count_id
      WHERE count_lock.organization_id = $1 AND count_lock.warehouse_id = $2 AND count_lock.released_at IS NULL AND (NOT count_lock.location_scoped OR count_lock.location_id IS NOT DISTINCT FROM $3)
        AND (count_lock.item_id IS NULL OR count_lock.item_id = $4) AND count_lock.count_id IS DISTINCT FROM $5::uuid LIMIT 1`,
    [organizationId, warehouseId, locationId ?? null, itemId, exceptCountId])).rows[0] ?? null;
}
const underCount = (lock) => new StockError(409, `This stock position is under active physical count ${lock.document_number}: nothing moves or is newly reserved there until the count is completed or cancelled.`,
  "STOCK_UNDER_COUNT", { countId: lock.count_id, count: lock.document_number });

async function reservationEvent(client, c, reservationId, eventType, quantity, { reasonCode = null, reason = null, details = {} } = {}) {
  await client.query(
    `INSERT INTO tenant.stock_reservation_events (organization_id, reservation_id, event_type, quantity, active_after, reason_code, reason, details, actor_user_id)
     SELECT $1, $2, $3, $4, active_quantity, $5, $6, $7, $8 FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, reservationId, eventType, quantity, reasonCode, reason, JSON.stringify(details), c.userId ?? null]);
}

async function insertReservation(client, c, balance, quantity, input, idempotencyKey) {
  const number = await nextDocumentNumber(client, c, { documentType: "stock_reservation" });
  const created = await client.query(
    `INSERT INTO tenant.stock_reservations(
       organization_id,reservation_number,item_id,warehouse_id,warehouse_location_id,batch_id,quantity,reference_type,reference_id,status,reserved_by,idempotency_key,
       sales_order_id,sales_order_line_id,sales_quantity,sales_uom,serial_id,expires_at,inventory_reservation_id,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13,$14,$15,$16,$17,$18,now()) RETURNING *`,
    [c.organizationId, number, input.itemId, input.warehouseId, balance.warehouse_location_id, balance.batch_id, quantity, String(input.referenceType).slice(0, 100), input.referenceId,
      c.userId ?? null, idempotencyKey, input.salesOrderId ?? null, input.salesOrderLineId ?? null, input.salesQuantity ?? null, input.salesUom ?? null, input.serialId ?? null,
      input.expiresAt ?? null, input.inventoryReservationId],
  );
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=reserved_quantity+$6,updated_at=now()
      WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
    [c.organizationId, input.itemId, input.warehouseId, balance.warehouse_location_id, balance.batch_id, quantity],
  );
  await reservationEvent(client, c, created.rows[0].id, "created", quantity, { details: { source: input.referenceType, sourceId: input.referenceId, serialId: input.serialId ?? null } });
  return created.rows[0];
}

// Reserves exactly `quantity` from one balance row, for one source line (input.sourceLineId names it where the reference is the document), never
// more than the line still needs.
export async function reserveStock(client, c, rawInput = {}) {
  let input = rawInput;
  need(c, "stock.reserve");
  const quantity = num(input.quantity, "Quantity");
  if (!input.itemId || !input.warehouseId)
    throw new StockError(400, "Item and warehouse are required for a reservation.", "STOCK_RESERVATION_SCOPE_REQUIRED");
  await stockDimension(client, c, { itemId: input.itemId, warehouseId: input.warehouseId });
  await assertReservationSource(client, c, input);
  if (input.expiresAt !== undefined && input.expiresAt !== null && Number.isNaN(Date.parse(String(input.expiresAt))))
    throw new StockError(400, "The expiry is not a valid date and time.", "STOCK_RESERVATION_EXPIRY_INVALID");
  // A serial number: exactly that unit, where it is, once.
  if (input.serialId) {
    if (quantity !== 1) throw new StockError(400, "A serial number is reserved one unit at a time.", "STOCK_RESERVATION_SERIAL_QUANTITY");
    const serial = (await client.query(`SELECT id, serial_number, item_id, warehouse_id, warehouse_location_id, batch_id, status FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, input.serialId])).rows[0];
    if (!serial || serial.item_id !== input.itemId || serial.warehouse_id !== input.warehouseId || serial.status !== "available")
      throw new StockError(409, "That serial number is not in stock in this warehouse.", "STOCK_SERIAL_NOT_AVAILABLE");
    // A unit on quality hold, in quarantine or damaged is never reserved.
    if ((await dispositionAt(client, c.organizationId, serial.warehouse_location_id)) !== "available")
      throw new StockError(409, `Serial ${serial.serial_number} is held (quality hold, quarantine or damaged) and cannot be reserved.`, "STOCK_SERIAL_NOT_AVAILABLE");
    const held = (await client.query(`SELECT reservation_number FROM tenant.stock_reservations WHERE organization_id=$1 AND serial_id=$2 AND status='active'`, [c.organizationId, serial.id])).rows[0];
    if (held) throw new StockError(409, `Serial ${serial.serial_number} is already reserved (${held.reservation_number}).`, "STOCK_SERIAL_ALREADY_RESERVED");
    input = { ...input, warehouseLocationId: serial.warehouse_location_id ?? (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id=$1 AND warehouse_id=$2 AND is_default_storage`,
      [c.organizationId, serial.warehouse_id])).rows[0]?.id, batchId: serial.batch_id };
  }
  await stockDimension(client, c, { itemId: input.itemId, warehouseId: input.warehouseId, warehouseLocationId: input.warehouseLocationId || null, batchId: input.batchId || null });
  const idempotencyKey = String(input.idempotencyKey || "").trim() || null;
  const idempotency = await beginIdempotentOperation(client, c, { operation: "stock.reservation.create", key: idempotencyKey, payload: { ...input, idempotencyKey: undefined } });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  await lockInventoryItem(client, c, input.itemId);
  const reservation = await ensureReservation(client, c, input, quantity, { exact: true });
  input = { ...input, inventoryReservationId: reservation.id };
  const values = [c.organizationId, input.itemId, input.warehouseId];
  let dimensionFilter = "";
  const locationId = await ledgerLocation(client, c.organizationId, input.warehouseId, input.warehouseLocationId || null);
  if (input.warehouseLocationId) dimensionFilter += locationId ? ` AND balance.warehouse_location_id=$${values.push(locationId)}` : " AND balance.warehouse_location_id IS NULL";
  if (input.batchId) { values.push(input.batchId); dimensionFilter += ` AND balance.batch_id=$${values.length}`; }
  const balance = (await client.query(
    `SELECT balance.* FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2 AND balance.warehouse_id=$3${dimensionFilter}
        AND balance.quantity-balance.reserved_quantity >= $${values.length + 1} AND ${USABLE_ROW}
      ORDER BY (balance.quantity-balance.reserved_quantity) DESC,balance.updated_at ASC
      LIMIT 1 FOR UPDATE OF balance`,
    [...values, quantity],
  )).rows[0];
  if (!balance) throw new StockError(409, "Insufficient available stock for this reservation.", "STOCK_RESERVATION_INSUFFICIENT");
  const counting = await countLockOn(client, c.organizationId, { warehouseId: input.warehouseId, locationId: balance.warehouse_location_id, itemId: input.itemId });
  if (counting) throw underCount(counting);
  const created = await insertReservation(client, c, balance, quantity, input, idempotencyKey);
  const response = { ...created, replayed: false };
  await completeIdempotentOperation(client, c, idempotency, { response, aggregateType: "stock_reservation", aggregateId: created.id });
  return response;
}

// Reserves as much as is usable and free now, up to maxQuantity, in one
// warehouse: the product is locked first, so two requests can never reserve
// the same unit; stock spread over several locations or batches is reserved
// from each (one reservation per row). Stock under quality hold is left.
// input: { itemId, warehouseId, maxQuantity, referenceType, referenceId, salesOrderId?, salesOrderLineId?, salesQuantityPerBase?, salesUom? }
// Returns { requested, reserved, reservations }.
export async function reserveAvailableStock(client, c, rawInput = {}) {
  let input = rawInput;
  need(c, "stock.reserve");
  const wanted = num(input.maxQuantity, "Quantity");
  await assertReservationSource(client, c, input);
  await stockDimension(client, c, { itemId: input.itemId, warehouseId: input.warehouseId });
  await lockInventoryItem(client, c, input.itemId);
  const reservation = await ensureReservation(client, c, input, wanted, { exact: false });
  input = { ...input, inventoryReservationId: reservation.id };
  const rows = (await client.query(
    `SELECT balance.* FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=balance.organization_id AND location.id=balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=balance.organization_id AND batch.id=balance.batch_id
      WHERE balance.organization_id=$1 AND balance.item_id=$2 AND balance.warehouse_id=$3 AND balance.quantity-balance.reserved_quantity > 0 AND ${USABLE_ROW}
        AND NOT ${UNDER_COUNT_SQL("balance.warehouse_id", "balance.warehouse_location_id", "balance.item_id")}
      ORDER BY (balance.quantity-balance.reserved_quantity) DESC,balance.updated_at ASC
      FOR UPDATE OF balance`,
    [c.organizationId, input.itemId, input.warehouseId],
  )).rows;
  const free = Math.max(0, rows.reduce((total, row) => total + Number(row.quantity) - Number(row.reserved_quantity), 0));
  let left = Math.min(wanted, free, reservation.room);
  const reservations = [];
  for (const row of rows) {
    if (left <= 1e-9) break;
    const take = reservationRound(Math.min(left, Number(row.quantity) - Number(row.reserved_quantity)));
    if (take <= 1e-9) continue;
    const perBase = Number(input.salesQuantityPerBase) || null;
    reservations.push(await insertReservation(client, c, row, take, { ...input, salesQuantity: perBase ? reservationRound(take * perBase) : null }, null));
    left = reservationRound(left - take);
  }
  return { requested: wanted, reserved: reservationRound(reservations.reduce((total, row) => total + Number(row.quantity), 0)), reservations };
}

// Gives back what a reservation still holds, or part of it.
// options: { status: "released" | "cancelled" | "consumed", quantity?, reasonCode?, reason? }
// "consumed" closes what is left as consumed (a work order that used its material).
export async function releaseStockReservation(client, c, id, { status = "released", quantity = null, reasonCode = null, reason = null } = {}) {
  need(c, "stock.reserve");
  if (!new Set(["released", "cancelled", "consumed"]).has(status))
    throw new StockError(400, "Reservation close status is invalid.", "STOCK_RESERVATION_STATUS_INVALID");
  const reservation = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reservation.status !== "active") return reservation;
  const active = Number(reservation.active_quantity);
  const amount = quantity == null ? active : reservationRound(num(quantity, "Quantity to release"));
  if (amount > active + 1e-9) throw new StockError(409, `Only ${active} is still reserved.`, "STOCK_RESERVATION_EXCEEDS_ACTIVE");
  await adjustReservedBalance(client, c, reservation, amount);
  const closing = amount + 1e-9 >= active;
  const consumed = status === "consumed";
  const { rows } = await client.query(
    `UPDATE tenant.stock_reservations
        SET consumed_quantity=consumed_quantity+$3, released_quantity=released_quantity+$4,
            status=CASE WHEN $5 THEN (CASE WHEN $6 THEN 'consumed' WHEN consumed_quantity > 0 AND $7 = 'released' THEN 'consumed' ELSE $7 END) ELSE 'active' END,
            released_at=CASE WHEN $5 THEN now() ELSE released_at END, released_by=$8, release_reason_code=COALESCE($9, release_reason_code), release_reason=COALESCE($10, release_reason),
            updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, id, consumed ? amount : 0, consumed ? 0 : amount, closing, consumed, status, c.userId ?? null, reasonCode, reason],
  );
  await reservationEvent(client, c, id, consumed ? "consumed" : status === "cancelled" ? "cancelled" : reasonCode === "expired" ? "expired" : "released", amount, { reasonCode, reason });
  return rows[0];
}

// A delivery used part or all of a reservation: the reservation is consumed,
// the stock is issued from the very row it was reserved in, and the
// consumption is recorded with the delivery and the movement, together.
// reference: { deliveryId?, deliveryLineId?, issue: { referenceType, referenceId, idempotencyKey } }
export async function consumeStockReservation(client, c, id, quantity, reference = {}) {
  need(c, "stock.reserve");
  const amount = reservationRound(num(quantity, "Quantity consumed"));
  const reservation = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reference.issue?.idempotencyKey) {
    const done = (await client.query(
      `SELECT movement.id FROM tenant.stock_movements movement JOIN tenant.stock_reservation_consumptions consumption ON consumption.organization_id = movement.organization_id
          AND consumption.stock_movement_id = movement.id AND consumption.reservation_id = $3 WHERE movement.organization_id=$1 AND movement.idempotency_key=$2`,
      [c.organizationId, reference.issue.idempotencyKey, reservation.id])).rows[0];
    if (done) return { ...reservation, stockMovementId: done.id, replayed: true };
  }
  if (reservation.status !== "active" || amount > Number(reservation.active_quantity) + 1e-9)
    throw new StockError(409, `Only ${Number(reservation.active_quantity)} is still reserved on ${reservation.reservation_number ?? "this reservation"}.`, "STOCK_RESERVATION_EXCEEDS_ACTIVE");
  // A reservation is not permission to ship stock that has since become ineligible (expired, blocked, held, moved to a non-allocating place).
  const position = (await client.query(
    `SELECT ${restrictedStockSql("location", "batch")} AS restricted FROM (SELECT 1) AS anchor
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id=$1 AND location.id=$2
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id=$1 AND batch.id=$3`,
    [c.organizationId, reservation.warehouse_location_id, reservation.batch_id])).rows[0];
  if (position?.restricted)
    throw new StockError(409, `The stock reserved on ${reservation.reservation_number} is no longer eligible (held, expired or blocked). Reallocate or release the reservation first.`, "STOCK_RESERVATION_INELIGIBLE");
  await adjustReservedBalance(client, c, reservation, amount);
  const { rows } = await client.query(
    `UPDATE tenant.stock_reservations
        SET consumed_quantity=consumed_quantity+$3, last_consumed_at=now(),
            status=CASE WHEN quantity-consumed_quantity-released_quantity-$3 <= 0 THEN 'consumed' ELSE 'active' END,
            released_at=CASE WHEN quantity-consumed_quantity-released_quantity-$3 <= 0 THEN now() ELSE released_at END, updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, id, amount],
  );
  const movement = reference.issue
    ? await postStockMovement(client, c, {
      movementType: "issue", itemId: reservation.item_id, warehouseId: reservation.warehouse_id, warehouseLocationId: reservation.warehouse_location_id,
      batchId: reservation.batch_id, serialId: reservation.serial_id ?? undefined, reservationId: reservation.id, quantity: amount, referenceType: reference.issue.referenceType,
      referenceId: reference.issue.referenceId, idempotencyKey: reference.issue.idempotencyKey, ledgerType: reference.issue.ledgerType, groupId: reference.issue.groupId,
      sourceLineId: reference.issue.sourceLineId, transaction: reference.issue.transaction,
    })
    : null;
  await reservationEvent(client, c, id, "consumed", amount, { details: { movementId: movement?.id ?? null, deliveryId: reference.deliveryId ?? null } });
  await client.query(
    `INSERT INTO tenant.stock_reservation_consumptions (organization_id, reservation_id, quantity, delivery_id, delivery_line_id, stock_movement_id, consumed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, id, amount, reference.deliveryId ?? null, reference.deliveryLineId ?? null, movement?.id ?? null, c.userId ?? null],
  );
  return { ...rows[0], stockMovementId: movement?.id ?? null };
}

async function adjustReservedBalance(client, c, reservation, amount) {
  const balance = (await client.query(
    `SELECT reserved_quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3
       AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 FOR UPDATE`,
    [c.organizationId, reservation.item_id, reservation.warehouse_id, reservation.warehouse_location_id, reservation.batch_id],
  )).rows[0];
  if (!balance || Number(balance.reserved_quantity) + 1e-9 < amount)
    throw new StockError(409, "Reservation balance is inconsistent; reconcile stock reservations before releasing it.", "STOCK_RESERVATION_DRIFT");
  await client.query(
    `UPDATE tenant.stock_balances SET reserved_quantity=greatest(reserved_quantity-$6,0),version=version+1,updated_at=now()
      WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
    [c.organizationId, reservation.item_id, reservation.warehouse_id, reservation.warehouse_location_id, reservation.batch_id, amount],
  );
}

export async function listActiveStockReservationsByReference(client, c, { referenceType, referenceId }) {
  need(c, "stock.view");
  const { rows } = await client.query(
    `SELECT * FROM tenant.stock_reservations
      WHERE organization_id=$1 AND reference_type=$2 AND reference_id=$3 AND status='active' ORDER BY created_at, id`,
    [c.organizationId, String(referenceType).slice(0, 100), referenceId],
  );
  return rows;
}


export async function listStockOperationOptions(client,c){
  need(c,"stock.view");
  const [items,warehouses,locations,batches]=await Promise.all([
    // Each item with its base unit and the units Inventory may be entered in (the base and its inventory-enabled conversions).
    client.query(`SELECT item.id,item.code,item.name,item.uom_id,item.tracking_type,item.requires_expiry_date,base.code AS base_uom,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('uomId',conversion.from_uom_id,'code',uom.code,'factor',conversion.conversion_factor,'decimals',COALESCE(conversion.quantity_precision,uom.decimal_places)) ORDER BY conversion.conversion_factor)
          FROM tenant.item_uom_conversions conversion JOIN tenant.units_of_measure uom ON uom.organization_id=conversion.organization_id AND uom.id=conversion.from_uom_id
         WHERE conversion.organization_id=item.organization_id AND conversion.item_id=item.id AND conversion.to_uom_id=item.uom_id AND conversion.status='active' AND conversion.inventory_enabled AND uom.status='active'),'[]'::jsonb) AS units
       FROM tenant.items item LEFT JOIN tenant.units_of_measure base ON base.organization_id=item.organization_id AND base.id=item.uom_id
      WHERE item.organization_id=$1 AND item.status='active' ORDER BY item.name LIMIT 500`,[c.organizationId]),
    client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' AND system_role IS NULL ORDER BY is_default DESC,name LIMIT 200`,[c.organizationId]),
    client.query(`SELECT l.id,l.code,l.name,l.warehouse_id FROM tenant.warehouse_locations l JOIN tenant.warehouses w ON w.organization_id=l.organization_id AND w.id=l.warehouse_id WHERE l.organization_id=$1 AND l.status='active' AND w.status='active' ORDER BY w.code,l.code LIMIT 1000`,[c.organizationId]),
    client.query(`SELECT id,batch_number AS code,batch_number AS name,item_id FROM tenant.stock_batches WHERE organization_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 500`,[c.organizationId]),
  ]);
  // What each item has available now, per warehouse (eligible on hand less reservations; base unit), for the hints on stock forms. Forms
  // only advise: the transaction re-checks and reserves atomically.
  const availability = (await client.query(
    `SELECT balance.item_id, balance.warehouse_id, sum(balance.quantity) AS on_hand,
            greatest(sum(CASE WHEN ${restrictedStockSql("location", "batch")} THEN 0 ELSE greatest(balance.quantity - balance.reserved_quantity, 0) END), 0) AS available
       FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 GROUP BY balance.item_id, balance.warehouse_id HAVING sum(balance.quantity) <> 0`, [c.organizationId])).rows
    .map((row) => ({ item_id: row.item_id, warehouse_id: row.warehouse_id, on_hand: Number(row.on_hand), available: Number(row.available) }));
  // New stock documents start in the user's preferred warehouse, else the company default.
  const preferred = await resolveDefaultWarehouse(client, c);
  return {items:items.rows,warehouses:warehouses.rows,locations:locations.rows,batches:batches.rows,availability,defaultWarehouseId:preferred?.warehouseId ?? null};
}

// Batch and serial registration, used by Manufacturing when production creates or receives tracked stock.
export { createStockBatch, receiveSerializedStock } from "./master-operations.js";

// Moves a reservation to another position (warehouse, location, batch or serial) without ever losing it: the new allocation is reserved first
// and the old one released only if that succeeds, in one transaction. input: { warehouseId?, locationId?, batchId?, serialId?, reason }.
export async function reallocateStockReservation(client, c, id, input = {}) {
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  if (!reason) throw new StockError(400, "Give the reason for reallocating the reservation.", "STOCK_REASON_REQUIRED");
  const reservation = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!reservation) throw new StockError(404, "Reservation not found.", "STOCK_RESERVATION_NOT_FOUND");
  if (reservation.status !== "active") throw new StockError(409, "Only an active reservation can be reallocated.", "STOCK_RESERVATION_NOT_ACTIVE");
  // A transfer names its source position on the transfer itself: change it by cancelling and drafting the transfer again.
  if (reservation.reference_type === "stock_transfer")
    throw new StockError(409, "A transfer's reservation follows the transfer: cancel it and draft it again from the right stock.", "STOCK_RESERVATION_REALLOCATE_TRANSFER");
  const ctx = { ...c, permissions: [...new Set([...(c.permissions || []), "stock.reserve"])] };
  const warehouseId = input.warehouseId || reservation.warehouse_id;
  // Another warehouse is a fulfillment decision with its own permission; another location, batch or serial number in the same warehouse is the other.
  if (warehouseId !== reservation.warehouse_id) need(c, "stock.reservations.reallocate_warehouse");
  else need(c, "stock.reservation.reallocate");
  if (warehouseId !== reservation.warehouse_id) {
    await validateWarehouseOperation(client, c, warehouseId, null, { label: "Reallocate to" });
  }
  const parent = reservation.inventory_reservation_id
    ? (await client.query(`SELECT source_line_id FROM tenant.inventory_reservations WHERE organization_id=$1 AND id=$2`, [c.organizationId, reservation.inventory_reservation_id])).rows[0] : null;
  // Release first inside this transaction so the same stock can be chosen again (a batch to its other location); if the new reservation
  // fails, the whole transaction rolls back and the old reservation stands.
  const quantity = Number(reservation.active_quantity);
  await releaseStockReservation(client, ctx, reservation.id, { status: "released", reasonCode: "reallocated", reason });
  const created = await reserveStock(client, ctx, {
    itemId: reservation.item_id, warehouseId, warehouseLocationId: input.locationId || null, batchId: input.serialId ? null : input.batchId || null, serialId: input.serialId || null,
    quantity, referenceType: reservation.reference_type, referenceId: reservation.reference_id, salesOrderId: reservation.sales_order_id, salesOrderLineId: reservation.sales_order_line_id,
    salesQuantity: reservation.sales_quantity, salesUom: reservation.sales_uom, expiresAt: reservation.expires_at, sourceLineId: parent?.source_line_id ?? undefined,
  });
  await reservationEvent(client, c, reservation.id, "reallocated", quantity, { reason, details: { to: created.id, toNumber: created.reservation_number } });
  await reservationEvent(client, c, created.id, "reallocated", quantity, { reason, details: { from: reservation.id, fromNumber: reservation.reservation_number } });
  return { from: { id: reservation.id, number: reservation.reservation_number }, to: created };
}

// Releases the active reservations whose expiry has passed (temporary holds); ordinary sales and transfer reservations have none.
export async function expireStockReservations(client, c) {
  need(c, "stock.reserve");
  const due = (await client.query(`SELECT id FROM tenant.stock_reservations WHERE organization_id=$1 AND status='active' AND expires_at IS NOT NULL AND expires_at <= now() ORDER BY expires_at`,
    [c.organizationId])).rows;
  for (const row of due) await releaseStockReservation(client, c, row.id, { status: "released", reasonCode: "expired", reason: "The reservation expired" });
  return { expired: due.length };
}

// Inventory releasing a reservation held for another document (a stale order line, a transfer no one will dispatch): its own permission and a
// reason; the source document keeps its demand, now unreserved. input: { quantity? (all when empty), reason }.
export async function releaseReservation(client, c, id, input = {}) {
  need(c, "stock.reservation.release");
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  if (!reason) throw new StockError(400, "Give the reason for releasing the reservation.", "STOCK_REASON_REQUIRED");
  const quantity = input.quantity === undefined || input.quantity === null || input.quantity === "" ? null : input.quantity;
  return releaseStockReservation(client, { ...c, permissions: [...new Set([...(c.permissions || []), "stock.reserve"])] }, id,
    { status: "released", quantity, reasonCode: "inventory_release", reason });
}
