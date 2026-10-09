import { createJournalEntry, getAccountMapping, getPrimaryLedger, postJournalEntry } from "../accounting/index.js";
import { StockError } from "./errors.js";

// Inventory Valuation engine: the value of every stock movement, in the company's base currency. postStockMovement (index.js) calls
// planValuation before it writes the movement (the plan holds the warehouse's valuation stream locked and gives the movement its unit cost) and
// recordValuation after (the immutable entry, FIFO layers and allocations, the balance projection, any settlement or restatement).
//
// One method per item for the whole company. Valuation state is per warehouse and item:
//   Moving Average  an inbound movement blends into the average (value / quantity); an outbound one leaves at it (all of what is left: exactly
//                   the value left, never a residual).
//   FIFO            every inbound movement opens a cost layer; an outbound one consumes the oldest layers first (effective time, valuation
//                   sequence, id) and records what it took from each.
// Inbound cost: a transfer in carries exactly what left the source (and, for FIFO, its layers with their age); a reversal restores exactly what
// the original took (its layers too); otherwise the document's cost (receipt, opening, authorised adjustment cost, original delivery cost), the
// current valuation rate when the document has none, and zero recorded as missing cost when there is no rate either (an exception, never a guess).
// Location and disposition moves inside a warehouse change no value. A reversal of an inbound movement takes back exactly its value.
// Negative stock (Moving Average only, through an authorised override): the issue is valued provisionally at the last average; the receipt that
// brings the position back settles the difference with a settlement entry. FIFO stock never goes negative.
// Backdated movements replay the warehouse's stream from their date: every later value that changes gets a restatement entry; nothing is edited.

const SCALE = 10n ** 10n;
const CENT = 10n ** 8n;
const ZERO = 0n;
const D = (value) => {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new StockError(400, `Invalid amount ${text}.`, "VALUATION_AMOUNT_INVALID");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const padded = `${fraction}${"0".repeat(11)}`;
  let scaled = BigInt(whole) * SCALE + BigInt(padded.slice(0, 10));
  if (Number(padded[10]) >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
};
const absD = (value) => (value < ZERO ? -value : value);
const roundDiv = (numerator, denominator) => {
  if (denominator === ZERO) throw new RangeError("Division by zero.");
  const negative = (numerator < ZERO) !== (denominator < ZERO);
  const quotient = (absD(numerator) + absD(denominator) / 2n) / absD(denominator);
  return negative ? -quotient : quotient;
};
const mulD = (left, right) => roundDiv(left * right, SCALE);
const divD = (left, right) => roundDiv(left * SCALE, right);
const money = (value) => roundDiv(value, CENT) * CENT;
const text = (value, digits = 10) => {
  const negative = value < ZERO;
  const unsigned = absD(value);
  const whole = unsigned / SCALE;
  const fraction = String(unsigned % SCALE).padStart(10, "0").slice(0, digits);
  return `${negative ? "-" : ""}${whole}${digits ? `.${fraction}` : ""}`;
};
export const valuationNumber = (value) => Number(text(D(value)));

const INTERNAL_TYPES = new Set(["location_transfer_in", "location_transfer_out", "disposition_in", "disposition_out"]);
// Outbound legs whose value is carried into another warehouse's stream.
const CARRYING_TYPES = new Set(["transfer_out", "transfer_to_transit", "transfer_from_transit"]);
export const COST_SOURCES = Object.freeze({
  document_cost: "Document cost", receipt_cost: "Receipt cost", opening_cost: "Opening stock cost", manual_authorized_cost: "Authorised cost entered",
  zero_cost_authorized: "Zero cost (authorised)", zero_cost: "Zero cost (not authorised)", current_valuation_cost: "Current valuation cost",
  original_delivery_cost: "Original delivery cost", transfer_source: "Transferred from source", reversal_original: "Original valuation reversed",
  moving_average: "Moving average", fifo_layers: "FIFO layers", provisional_negative_average: "Provisional (last moving average)", internal_move: "No value change",
  missing_cost: "Missing cost", negative_stock_settlement: "Negative stock settlement", backdated_restatement: "Backdated restatement", migrated: "Carried over",
});

const methodOf = (item) => (item.valuation_method === "fifo" ? "fifo" : "moving_average");

async function lockStream(client, organizationId, warehouseId, item) {
  await client.query(
    `INSERT INTO tenant.inventory_valuation_balances (organization_id, warehouse_id, item_id, valuation_method) VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, warehouse_id, item_id) DO NOTHING`, [organizationId, warehouseId, item.id, methodOf(item)]);
  const row = (await client.query(`SELECT * FROM tenant.inventory_valuation_balances WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
    [organizationId, warehouseId, item.id])).rows[0];
  return { row, quantity: D(row.base_quantity), value: D(row.inventory_value), average: row.moving_average_cost === null ? null : D(row.moving_average_cost) };
}

// An entry's value as it stands now: its own value and any restatements of it; for FIFO, what it took from (or gave back to) each layer.
async function effectiveOf(client, organizationId, entryId) {
  const value = D((await client.query(
    `SELECT COALESCE(sum(value_delta), 0) AS v FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND (id = $2 OR restates_entry_id = $2)`,
    [organizationId, entryId])).rows[0].v);
  const allocations = (await client.query(
    `SELECT allocation.cost_layer_id, sum(allocation.quantity) AS quantity, sum(allocation.value) AS value, max(layer.unit_cost) AS unit_cost, max(layer.effective_at) AS effective_at
       FROM tenant.inventory_valuation_allocations allocation
       JOIN tenant.inventory_valuation_entries entry ON entry.organization_id = allocation.organization_id AND entry.id = allocation.valuation_entry_id
       JOIN tenant.inventory_cost_layers layer ON layer.organization_id = allocation.organization_id AND layer.id = allocation.cost_layer_id
      WHERE allocation.organization_id = $1 AND (entry.id = $2 OR entry.restates_entry_id = $2)
      GROUP BY allocation.cost_layer_id HAVING sum(allocation.quantity) <> 0`, [organizationId, entryId])).rows
    .map((row) => ({ layerId: row.cost_layer_id, quantity: D(row.quantity), value: D(row.value), unitCost: D(row.unit_cost), effectiveAt: row.effective_at }));
  return { value, allocations };
}

async function movementEntry(client, organizationId, movementId) {
  return (await client.query(`SELECT * FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND movement_id = $2 AND entry_kind = 'movement'`,
    [organizationId, movementId])).rows[0] ?? null;
}

// FIFO: take quantity from the open layers, oldest first (or from the given layers first). Each take is valued at the layer's cost; taking all
// that is left of a layer takes exactly its remaining value.
async function consumeLayers(client, organizationId, warehouseId, itemId, quantity, { preferredSourceEntryId = null } = {}) {
  const layers = (await client.query(
    `SELECT * FROM tenant.inventory_cost_layers WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 AND status = 'open'
      ORDER BY (source_entry_id = $4) DESC NULLS LAST, effective_at, valuation_sequence, id FOR UPDATE`,
    [organizationId, warehouseId, itemId, preferredSourceEntryId])).rows;
  let left = quantity;
  const allocations = [];
  for (const layer of layers) {
    if (left <= ZERO) break;
    const remaining = D(layer.remaining_quantity);
    const remainingValue = D(layer.remaining_value);
    const take = remaining < left ? remaining : left;
    if (take <= ZERO) continue;
    const value = take === remaining ? remainingValue : money(mulD(take, D(layer.unit_cost)));
    allocations.push({ layerId: layer.id, quantity: take, value, unitCost: D(layer.unit_cost), remaining: remaining - take, remainingValue: remainingValue - value });
    left -= take;
  }
  if (left > ZERO)
    throw new StockError(409, "FIFO stock never goes negative: the cost layers do not cover this quantity. Reconcile the valuation of this item.", "NEGATIVE_FIFO_STOCK_BLOCKED");
  return allocations;
}

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], ZERO);

// The plan for one movement. context: { item, warehouseId, signed (number), ledgerType, effectiveOn ('YYYY-MM-DD' | null), reverses (the
// original movement row, for a reversal), input: { unitCost?, value?, costSource?, valueFromMovementId?, costSnapshot? } }
export async function planValuation(client, c, context) {
  const { item, warehouseId, ledgerType, input = {} } = context;
  const organizationId = c.organizationId;
  const method = methodOf(item);
  const quantity = absD(D(context.signed));
  const inbound = context.signed > 0;
  const stream = await lockStream(client, organizationId, warehouseId, item);
  const plan = { method, warehouseId, itemId: item.id, quantityDelta: inbound ? quantity : -quantity, stream, layersToCreate: [], allocations: [], restorations: [],
    settlement: null, replay: null, snapshot: null, details: {} };
  const rate = stream.quantity > ZERO && stream.value >= ZERO ? divD(stream.value, stream.quantity) : stream.average;

  if (INTERNAL_TYPES.has(ledgerType)) {
    return finish(plan, { role: "internal", value: ZERO, unitCost: rate ?? ZERO, costSource: "internal_move" });
  }

  if (inbound) {
    let value;
    let costSource;
    if (input.valueFromMovementId) {
      // A transfer in: exactly the value that left the source, and for FIFO the source's layers, keeping their age.
      const source = await movementEntry(client, organizationId, input.valueFromMovementId);
      if (!source) throw new StockError(409, "The transferred stock's valuation was not found.", "MOVEMENT_WITHOUT_VALUATION");
      const effective = await effectiveOf(client, organizationId, source.id);
      value = -effective.value;
      costSource = "transfer_source";
      plan.details.sourceEntryId = source.id;
      if (method === "fifo") {
        const carried = effective.allocations.filter((allocation) => allocation.quantity > ZERO);
        if (sum(carried, "quantity") !== quantity) throw new StockError(409, "The transferred quantity does not match what left the source.", "FIFO_LAYER_MISMATCH");
        plan.layersToCreate = carried.map((allocation) => ({ quantity: allocation.quantity, value: allocation.value, unitCost: allocation.unitCost, effectiveAt: allocation.effectiveAt,
          originLayerId: allocation.layerId }));
      }
    } else if (context.reverses && Number(context.reverses.quantity) < 0) {
      // A reversal of an issue: exactly what the issue took, back into the layers it came from.
      const original = await movementEntry(client, organizationId, context.reverses.id);
      if (!original) throw new StockError(409, "The reversed movement has no valuation.", "MOVEMENT_WITHOUT_VALUATION");
      const effective = await effectiveOf(client, organizationId, original.id);
      value = -effective.value;
      costSource = "reversal_original";
      plan.details.reversalOfId = original.id;
      plan.reversalOfId = original.id;
      if (method === "fifo") plan.restorations = effective.allocations.map((allocation) => ({ ...allocation }));
    } else {
      const explicitValue = input.value === undefined || input.value === null || input.value === "" ? null : D(input.value);
      const explicitCost = input.unitCost === undefined || input.unitCost === null || input.unitCost === "" ? null : D(input.unitCost);
      if ((explicitValue !== null && explicitValue < ZERO) || (explicitCost !== null && explicitCost < ZERO))
        throw new StockError(400, "Unit cost must be zero or greater.", "STOCK_UNIT_COST_INVALID");
      if (explicitValue !== null || explicitCost !== null) {
        value = explicitValue !== null ? money(explicitValue) : money(mulD(quantity, explicitCost));
        costSource = input.costSource && COST_SOURCES[input.costSource] ? input.costSource : value === ZERO ? "zero_cost" : "document_cost";
      } else if (rate !== null && rate > ZERO) {
        value = money(mulD(quantity, rate));
        costSource = "current_valuation_cost";
      } else {
        value = ZERO;
        costSource = "missing_cost";
      }
      if (input.costSnapshot?.sourceCurrency) plan.snapshot = { sourceCurrency: String(input.costSnapshot.sourceCurrency).slice(0, 3), sourceUnitCost: D(input.costSnapshot.sourceUnitCost ?? 0),
        exchangeRate: D(input.costSnapshot.exchangeRate ?? 1) };
    }
    const unitCost = divD(value, quantity);
    if (method === "fifo" && !plan.layersToCreate.length && !plan.restorations.length)
      plan.layersToCreate = [{ quantity, value, unitCost, effectiveAt: null, originLayerId: null }];
    // Moving Average back from negative: the units issued provisionally are settled at this receipt's cost.
    if (method === "moving_average" && stream.quantity < ZERO) {
      const after = stream.quantity + quantity;
      const provisional = stream.average ?? unitCost;
      const target = after >= ZERO ? money(mulD(after, unitCost)) : money(mulD(after, provisional));
      const correction = target - (stream.value + value);
      if (correction !== ZERO) plan.settlement = { value: correction, coveredQuantity: (after >= ZERO ? -stream.quantity : quantity), provisionalRate: provisional, actualRate: unitCost };
    }
    return finish(plan, { role: "inbound", value, unitCost, costSource }, context);
  }

  // Outbound.
  if (context.reverses && Number(context.reverses.quantity) > 0) {
    // A reversal of a receipt: exactly the value it brought in (from its own FIFO layer first).
    const original = await movementEntry(client, organizationId, context.reverses.id);
    if (!original) throw new StockError(409, "The reversed movement has no valuation.", "MOVEMENT_WITHOUT_VALUATION");
    const effective = await effectiveOf(client, organizationId, original.id);
    plan.reversalOfId = original.id;
    plan.details.reversalOfId = original.id;
    let value;
    if (method === "fifo") {
      plan.allocations = await consumeLayers(client, organizationId, warehouseId, item.id, quantity, { preferredSourceEntryId: original.id });
      value = sum(plan.allocations, "value");
    } else value = quantity === stream.quantity ? stream.value : effective.value;
    return finish(plan, { role: "outbound", value: -value, unitCost: divD(value, quantity), costSource: "reversal_original" }, context);
  }
  if (method === "fifo") {
    plan.allocations = await consumeLayers(client, organizationId, warehouseId, item.id, quantity);
    const value = sum(plan.allocations, "value");
    return finish(plan, { role: "outbound", value: -value, unitCost: divD(value, quantity), costSource: "fifo_layers" }, context);
  }
  if (quantity <= stream.quantity) {
    // Moving average: everything that is left takes exactly the value that is left.
    const value = quantity === stream.quantity ? stream.value : money(mulD(quantity, rate));
    return finish(plan, { role: "outbound", value: -value, unitCost: divD(value, quantity), costSource: "moving_average" }, context);
  }
  // Beyond what is on hand (an authorised negative-stock override): provisionally at the last valid moving average, never at an invented cost.
  const provisional = stream.average !== null && stream.average > ZERO ? stream.average : rate;
  if (provisional === null || provisional <= ZERO)
    throw new StockError(409, "This item has no valuation rate to issue negative stock at (no moving average yet). Receive it first.", "NEGATIVE_STOCK_VALUATION_UNSUPPORTED");
  const value = money(mulD(quantity, provisional));
  return finish(plan, { role: "outbound", value: -value, unitCost: provisional, costSource: "provisional_negative_average" }, context);
}

function finish(plan, result, context = {}) {
  Object.assign(plan, result);
  plan.effectiveOn = context.effectiveOn ?? null;
  return plan;
}

// The movement's unit cost (what the stock ledger keeps) from a plan.
export const plannedUnitCost = (plan) => text(absD(plan.unitCost), 6);

// Whether a backdated movement lands before later entries of its stream, and if so the replay: its own value (for an outbound one) and the
// restatement of every later value. Run before the movement is written (the stream is locked).
export async function planReplay(client, c, plan, effectiveAt) {
  if (!effectiveAt) return plan;
  const later = Number((await client.query(
    `SELECT count(*) AS c FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 AND effective_at > $4::timestamptz`,
    [c.organizationId, plan.warehouseId, plan.itemId, effectiveAt])).rows[0].c);
  if (!later) return plan;
  plan.replay = await replayStream(client, c, plan, effectiveAt);
  if (plan.role === "outbound" && plan.method === "moving_average" && plan.costSource !== "reversal_original") {
    plan.value = plan.replay.newValue;
    plan.unitCost = divD(absD(plan.value), absD(plan.quantityDelta));
  }
  if (plan.role === "outbound" && plan.method === "fifo" && plan.costSource !== "reversal_original") {
    plan.allocations = plan.replay.newAllocations;
    plan.value = -sum(plan.allocations, "value");
    plan.unitCost = divD(absD(plan.value), absD(plan.quantityDelta));
  }
  return plan;
}

// Replays the whole stream (warehouse + item) in effective order with the new movement in its place.
async function replayStream(client, c, plan, effectiveAt) {
  const organizationId = c.organizationId;
  const entries = (await client.query(
    `SELECT * FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 ORDER BY effective_at, valuation_sequence`,
    [organizationId, plan.warehouseId, plan.itemId])).rows;
  if (entries.some((entry) => entry.entry_kind === "settlement" && new Date(entry.effective_at) >= new Date(effectiveAt)))
    throw new StockError(409, "Stock of this item went negative after that date: a backdated movement cannot be revalued automatically. Post it today instead.", "BACKDATED_REVALUATION_REQUIRED");
  const layerRows = (await client.query(`SELECT * FROM tenant.inventory_cost_layers WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [organizationId, plan.warehouseId, plan.itemId])).rows;
  const allocationRows = (await client.query(
    `SELECT allocation.*, entry.restates_entry_id, entry.id AS entry_id FROM tenant.inventory_valuation_allocations allocation
       JOIN tenant.inventory_valuation_entries entry ON entry.organization_id = allocation.organization_id AND entry.id = allocation.valuation_entry_id
      WHERE allocation.organization_id = $1 AND entry.warehouse_id = $2 AND entry.item_id = $3`, [organizationId, plan.warehouseId, plan.itemId])).rows;
  const restated = new Map();
  for (const entry of entries.filter((row) => row.entry_kind === "restatement"))
    restated.set(entry.restates_entry_id, (restated.get(entry.restates_entry_id) ?? ZERO) + D(entry.value_delta));
  const recordedAllocations = new Map();
  for (const row of allocationRows) {
    const target = row.restates_entry_id ?? row.entry_id;
    const byLayer = recordedAllocations.get(target) ?? new Map();
    const current = byLayer.get(row.cost_layer_id) ?? { quantity: ZERO, value: ZERO };
    byLayer.set(row.cost_layer_id, { quantity: current.quantity + D(row.quantity), value: current.value + D(row.value) });
    recordedAllocations.set(target, byLayer);
  }
  const NEW = "__new__";
  const timeline = [...entries.filter((entry) => entry.entry_kind === "movement"), { id: NEW, effective_at: effectiveAt, valuation_sequence: Number.MAX_SAFE_INTEGER, cost_role: plan.role,
    base_quantity_delta: text(plan.quantityDelta), value_delta: text(plan.value), source_cost_type: plan.costSource, ledger_type: null }]
    .sort((a, b) => new Date(a.effective_at) - new Date(b.effective_at) || Number(a.valuation_sequence) - Number(b.valuation_sequence));
  // Replay state.
  let quantity = ZERO;
  let value = ZERO;
  const layers = new Map();
  const layersOf = (entryId) => layerRows.filter((layer) => layer.source_entry_id === entryId);
  const fifoOrder = () => [...layers.values()].filter((layer) => layer.remaining > ZERO)
    .sort((a, b) => new Date(a.effectiveAt) - new Date(b.effectiveAt) || a.sequence - b.sequence || String(a.id).localeCompare(String(b.id)));
  const restatements = [];
  let newValue = null;
  let newAllocations = [];
  for (const entry of timeline) {
    const delta = D(entry.base_quantity_delta);
    if (entry.cost_role === "internal") { quantity += delta; continue; }
    if (entry.cost_role === "inbound") {
      const entryValue = entry.id === NEW ? plan.value : D(entry.value_delta) + (restated.get(entry.id) ?? ZERO);
      quantity += delta;
      value += entryValue;
      if (plan.method === "fifo") {
        const restoring = entry.id === NEW ? plan.restorations : [...(recordedAllocations.get(entry.id) ?? new Map())].map(([layerId, row]) => ({ layerId, quantity: row.quantity, value: row.value }))
          .filter((row) => row.quantity < ZERO);
        if (restoring.length) for (const row of restoring) {
          const layer = layers.get(row.layerId);
          if (layer) { layer.remaining += absD(row.quantity); layer.remainingValue += absD(row.value); }
        }
        else if (entry.id === NEW) plan.layersToCreate.forEach((spec, index) => layers.set(`${NEW}:${index}`, { id: `${NEW}:${index}`, unitCost: spec.unitCost,
          effectiveAt: spec.effectiveAt ?? effectiveAt, sequence: Number.MAX_SAFE_INTEGER, remaining: spec.quantity, remainingValue: spec.value }));
        else for (const layer of layersOf(entry.id)) layers.set(layer.id, { id: layer.id, unitCost: D(layer.unit_cost), effectiveAt: layer.effective_at, sequence: Number(layer.valuation_sequence),
          remaining: D(layer.original_quantity), remainingValue: D(layer.original_value) });
      }
      if (quantity < ZERO) throw new StockError(409, "The stock would be negative at some point after that date: post the movement today instead.", "BACKDATED_REVALUATION_REQUIRED");
      continue;
    }
    // Outbound.
    const take = absD(delta);
    const recorded = entry.id === NEW ? null : D(entry.value_delta) + (restated.get(entry.id) ?? ZERO);
    const fixed = entry.source_cost_type === "reversal_original" || (entry.id === NEW && plan.costSource === "reversal_original");
    let outValue;
    let allocations = [];
    if (plan.method === "fifo") {
      let left = take;
      for (const layer of fifoOrder()) {
        if (left <= ZERO) break;
        const part = layer.remaining < left ? layer.remaining : left;
        const partValue = part === layer.remaining ? layer.remainingValue : money(mulD(part, layer.unitCost));
        allocations.push({ layerId: layer.id, quantity: part, value: partValue, unitCost: layer.unitCost });
        layer.remaining -= part;
        layer.remainingValue -= partValue;
        left -= part;
      }
      if (left > ZERO) throw new StockError(409, "The stock would be negative at some point after that date: post the movement today instead.", "BACKDATED_REVALUATION_REQUIRED");
      outValue = -sum(allocations, "value");
    } else if (fixed) outValue = entry.id === NEW ? plan.value : recorded;
    else if (take > quantity) throw new StockError(409, "The stock would be negative at some point after that date: post the movement today instead.", "BACKDATED_REVALUATION_REQUIRED");
    else outValue = take === quantity ? -value : -money(mulD(take, divD(value, quantity)));
    quantity -= take;
    value += outValue;
    if (quantity < ZERO) throw new StockError(409, "The stock would be negative at some point after that date: post the movement today instead.", "BACKDATED_REVALUATION_REQUIRED");
    if (entry.id === NEW) { newValue = outValue; newAllocations = allocations; continue; }
    const difference = outValue - recorded;
    const before = recordedAllocations.get(entry.id) ?? new Map();
    const allocationDeltas = [];
    if (plan.method === "fifo") {
      const replayed = new Map(allocations.map((row) => [row.layerId, row]));
      for (const layerId of new Set([...before.keys(), ...replayed.keys()])) {
        const was = before.get(layerId) ?? { quantity: ZERO, value: ZERO };
        const now = replayed.get(layerId) ?? { quantity: ZERO, value: ZERO };
        if (now.quantity !== was.quantity || now.value !== was.value)
          allocationDeltas.push({ layerId, quantity: now.quantity - was.quantity, value: now.value - was.value, unitCost: now.unitCost ?? layers.get(layerId)?.unitCost ?? ZERO });
      }
    }
    if (difference !== ZERO || allocationDeltas.length) {
      if (CARRYING_TYPES.has(entry.ledger_type))
        throw new StockError(409, "A later transfer of this item would change value: a backdated movement here cannot be revalued automatically. Post it today instead.", "BACKDATED_REVALUATION_REQUIRED");
      restatements.push({ entry, difference, allocationDeltas });
    }
  }
  // Every value restated must be in an open period.
  for (const { entry } of restatements) {
    const period = (await client.query(
      `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
      [organizationId, entry.effective_at])).rows[0];
    if (period && period.status !== "open")
      throw new StockError(409, `The backdated movement would change values already reported in ${period.name} (${period.status}). Post it in the current period instead.`, "VALUATION_PERIOD_CLOSED");
  }
  return { restatements, newValue, newAllocations, finalQuantity: quantity, finalValue: value, layers };
}

// Writes what a plan decided, once the movement exists.
export async function recordValuation(client, c, plan, movement) {
  const organizationId = c.organizationId;
  const baseCurrency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.base_currency?.trim() || "INR";
  const stream = plan.stream;
  let quantity = stream.quantity + plan.quantityDelta;
  let value = stream.value + plan.value;
  const entry = (await client.query(
    `INSERT INTO tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, movement_id, entry_kind, cost_role, valuation_method, ledger_type, base_quantity_delta,
       base_unit_cost, value_delta, base_currency, source_currency, source_unit_cost, exchange_rate, source_cost_type, effective_at, reversal_of_id, balance_quantity_after,
       balance_value_after, details, created_by)
     VALUES ($1,$2,$3,$4,'movement',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [organizationId, plan.warehouseId, plan.itemId, movement.id, plan.role, plan.method, movement.ledger_type, text(plan.quantityDelta, 6), text(absD(plan.unitCost)), text(plan.value, 2),
      baseCurrency, plan.snapshot?.sourceCurrency ?? null, plan.snapshot ? text(plan.snapshot.sourceUnitCost) : null, plan.snapshot ? text(plan.snapshot.exchangeRate) : null,
      plan.costSource, movement.occurred_at, plan.reversalOfId ?? null, text(quantity, 6), text(value, 2), JSON.stringify(plan.details), c.userId ?? null])).rows[0];

  if (plan.method === "fifo") {
    // Layers consumed (or, for a reversal of an issue, given back), and the layers this entry opens.
    for (const allocation of plan.allocations) {
      await client.query(`INSERT INTO tenant.inventory_valuation_allocations (organization_id, valuation_entry_id, cost_layer_id, quantity, value, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [organizationId, entry.id, allocation.layerId, text(allocation.quantity, 6), text(allocation.value, 2), text(allocation.unitCost)]);
      if (!plan.replay) await client.query(
        `UPDATE tenant.inventory_cost_layers SET remaining_quantity = $3, remaining_value = $4, status = CASE WHEN $3::numeric = 0 THEN 'exhausted' ELSE 'open' END, updated_at = now()
          WHERE organization_id = $1 AND id = $2`, [organizationId, allocation.layerId, text(allocation.remaining, 6), text(allocation.remainingValue, 2)]);
    }
    for (const restoration of plan.restorations) {
      await client.query(`INSERT INTO tenant.inventory_valuation_allocations (organization_id, valuation_entry_id, cost_layer_id, quantity, value, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [organizationId, entry.id, restoration.layerId, text(-restoration.quantity, 6), text(-restoration.value, 2), text(restoration.unitCost)]);
      if (!plan.replay) await client.query(
        `UPDATE tenant.inventory_cost_layers SET remaining_quantity = remaining_quantity + $3, remaining_value = remaining_value + $4, status = 'open', updated_at = now()
          WHERE organization_id = $1 AND id = $2`, [organizationId, restoration.layerId, text(restoration.quantity, 6), text(restoration.value, 2)]);
    }
    const created = [];
    for (const spec of plan.layersToCreate) {
      if (spec.quantity <= ZERO) continue;
      created.push((await client.query(
        `INSERT INTO tenant.inventory_cost_layers (organization_id, warehouse_id, item_id, source_entry_id, source_movement_id, origin_layer_id, original_quantity, original_value,
           remaining_quantity, remaining_value, unit_cost, effective_at, valuation_sequence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$8,$9,COALESCE($10::timestamptz,$11::timestamptz),$12) RETURNING id`,
        [organizationId, plan.warehouseId, plan.itemId, entry.id, movement.id, spec.originLayerId, text(spec.quantity, 6), text(spec.value, 2), text(spec.unitCost),
          spec.effectiveAt ?? null, movement.occurred_at, entry.valuation_sequence])).rows[0].id);
    }
    plan.createdLayerIds = created;
  }

  if (plan.replay) {
    const restatementIds = await applyReplay(client, c, plan, entry, baseCurrency);
    quantity = plan.replay.finalQuantity;
    value = plan.replay.finalValue;
    plan.restatementIds = restatementIds;
  }

  // Back from negative: the settlement of the provisionally valued issues.
  let settlement = null;
  if (plan.settlement) {
    value += plan.settlement.value;
    settlement = (await client.query(
      `INSERT INTO tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, entry_kind, cost_role, valuation_method, ledger_type, base_quantity_delta, base_unit_cost,
         value_delta, base_currency, source_cost_type, effective_at, balance_quantity_after, balance_value_after, details, created_by)
       VALUES ($1,$2,$3,'settlement','adjustment',$4,$5,0,0,$6,$7,'negative_stock_settlement',$8,$9,$10,$11,$12) RETURNING *`,
      [organizationId, plan.warehouseId, plan.itemId, plan.method, movement.ledger_type, text(plan.settlement.value, 2), baseCurrency, movement.occurred_at, text(quantity, 6), text(value, 2),
        JSON.stringify({ receiptEntryId: entry.id, coveredQuantity: text(plan.settlement.coveredQuantity, 6), provisionalRate: text(plan.settlement.provisionalRate),
          actualRate: text(plan.settlement.actualRate) }), c.userId ?? null])).rows[0];
    await correctionJournal(client, c, [settlement], { itemId: plan.itemId, description: `Negative stock settled by ${movement.movement_number}` });
  }

  // The balance projection, and the carrying rate every stock position of this item in this warehouse shows.
  let average;
  if (plan.method === "moving_average") {
    if (quantity > ZERO) average = divD(value, quantity);
    else if (quantity < ZERO) average = plan.role === "inbound" && plan.settlement ? plan.settlement.provisionalRate : (stream.average ?? (plan.unitCost > ZERO ? plan.unitCost : null));
    else average = plan.role === "inbound" && plan.unitCost > ZERO ? plan.unitCost : stream.average;
  } else average = quantity > ZERO ? divD(value, quantity) : null;
  await client.query(
    `UPDATE tenant.inventory_valuation_balances SET base_quantity = $3, inventory_value = $4, moving_average_cost = $5, last_valuation_entry_id = $6, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, stream.row.id, text(quantity, 6), text(value, 2), average === null || average === undefined ? null : text(average), settlement?.id ?? entry.id]);
  const carrying = quantity !== ZERO ? divD(value, quantity) : average;
  if (carrying !== null && carrying !== undefined)
    await client.query(`UPDATE tenant.stock_balances SET average_cost = $4 WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [organizationId, plan.warehouseId, plan.itemId, text(carrying < ZERO ? -carrying : carrying, 6)]);
  return entry;
}

async function applyReplay(client, c, plan, entry, baseCurrency) {
  const organizationId = c.organizationId;
  const replay = plan.replay;
  const layerIds = new Map((plan.createdLayerIds ?? []).map((id, index) => [`__new__:${index}`, id]));
  const realLayer = (id) => layerIds.get(id) ?? id;
  // The new entry's own allocations went in above; the layers now take the replayed state.
  for (const [id, layer] of replay.layers) {
    const real = realLayer(id);
    await client.query(
      `UPDATE tenant.inventory_cost_layers SET remaining_quantity = $3, remaining_value = $4, status = CASE WHEN $3::numeric = 0 THEN 'exhausted' ELSE 'open' END, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [organizationId, real, text(layer.remaining, 6), text(layer.remainingValue, 2)]);
  }
  const written = [];
  for (const { entry: target, difference, allocationDeltas } of replay.restatements) {
    const restatement = (await client.query(
      `INSERT INTO tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, entry_kind, cost_role, valuation_method, ledger_type, base_quantity_delta, base_unit_cost,
         value_delta, base_currency, source_cost_type, effective_at, restates_entry_id, balance_quantity_after, balance_value_after, details, created_by)
       VALUES ($1,$2,$3,'restatement','adjustment',$4,$5,0,0,$6,$7,'backdated_restatement',$8,$9,$10,$11,$12,$13) RETURNING *`,
      [organizationId, plan.warehouseId, plan.itemId, plan.method, target.ledger_type, text(difference, 2), baseCurrency, target.effective_at, target.id,
        target.balance_quantity_after, target.balance_value_after, JSON.stringify({ causedBy: entry.id, causedByMovementId: entry.movement_id }), c.userId ?? null])).rows[0];
    for (const delta of allocationDeltas)
      await client.query(`INSERT INTO tenant.inventory_valuation_allocations (organization_id, valuation_entry_id, cost_layer_id, quantity, value, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)`,
        [organizationId, restatement.id, realLayer(delta.layerId), text(delta.quantity, 6), text(delta.value, 2), text(delta.unitCost)]);
    written.push(restatement);
  }
  if (written.length) {
    await correctionJournal(client, c, written.filter((row) => D(row.value_delta) !== ZERO), { itemId: plan.itemId, description: "Backdated stock movement: later values restated" });
    await client.query(`INSERT INTO tenant.inventory_valuation_events (organization_id, event_type, item_id, warehouse_id, summary, details, actor_user_id) VALUES ($1,'replayed',$2,$3,$4,$5,$6)`,
      [organizationId, plan.itemId, plan.warehouseId, `A backdated movement restated ${written.length} later value${written.length === 1 ? "" : "s"}`,
        JSON.stringify({ entryId: entry.id, restatements: written.map((row) => ({ id: row.id, restates: row.restates_entry_id, value: row.value_delta })) }), c.userId ?? null]);
  }
  return written.map((row) => row.id);
}

// Finance for a valuation correction (a negative-stock settlement or a restatement): Inventory against the cost of goods sold, today.
async function correctionJournal(client, c, entries, { itemId, description }) {
  const total = entries.reduce((amount, entry) => amount + D(entry.value_delta), ZERO);
  if (!entries.length || total === ZERO) return null;
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.view", "accounting.journal.create"])] };
  const date = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const ledger = await getPrimaryLedger(client, ctx);
  const inventory = (await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId, date })).account_id;
  const cogs = (await getAccountMapping(client, ctx, ledger.id, "cogs", { itemId, date })).account_id;
  const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
    [c.organizationId, ledger.id])).rows[0];
  if (!journal) throw new StockError(409, "Finance: a General journal is not configured for valuation corrections.", "VALUATION_FINANCE_FAILED");
  const amount = text(absD(total), 2);
  const increase = total > ZERO;
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() || "INR";
  const lines = [
    { accountId: inventory, description, debit: increase ? amount : 0, credit: increase ? 0 : amount, referenceType: "inventory_valuation", referenceId: entries[0].id },
    { accountId: cogs, description, debit: increase ? 0 : amount, credit: increase ? amount : 0, referenceType: "inventory_valuation", referenceId: entries[0].id },
  ];
  const created = await createJournalEntry(client, ctx, { ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
    reference: "Inventory valuation", description, currencyCode: currency, exchangeRate: "1", lines },
  { internal: true, sourceModule: "inventory", sourceType: "inventory_valuation", sourceId: entries[0].id, sourceNumber: "Valuation" });
  await postJournalEntry(client, ctx, created.entry.id, { internal: true, allowDraft: true });
  for (const entry of entries)
    await client.query(`UPDATE tenant.inventory_valuation_entries SET journal_entry_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, created.entry.id]);
  return created.entry.id;
}

// The valuation of posted movements, for a document's own journal: the total value (signed: + into inventory) per item.
export async function valuationOfMovements(client, organizationId, movementIds) {
  const ids = [...new Set((movementIds ?? []).filter(Boolean))];
  if (!ids.length) return { total: 0, byItem: new Map(), byMovement: new Map() };
  const rows = (await client.query(
    `SELECT entry.movement_id, entry.item_id, (SELECT COALESCE(sum(restatement.value_delta), 0) FROM tenant.inventory_valuation_entries restatement
              WHERE restatement.organization_id = entry.organization_id AND restatement.restates_entry_id = entry.id) + entry.value_delta AS value
       FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = $1 AND entry.movement_id = ANY($2::uuid[]) AND entry.entry_kind = 'movement'`,
    [organizationId, ids])).rows;
  const byItem = new Map();
  const byMovement = new Map();
  let total = ZERO;
  for (const row of rows) {
    const value = D(row.value);
    total += value;
    byItem.set(row.item_id, (byItem.get(row.item_id) ?? ZERO) + value);
    byMovement.set(row.movement_id, Number(text(value, 2)));
  }
  return { total: Number(text(total, 2)), byItem: new Map([...byItem].map(([key, amount]) => [key, Number(text(amount, 2))])), byMovement };
}

// The current valuation rate of an item in a warehouse (the cost found stock is valued at by default): what is on hand is worth per unit, or
// the last moving average when nothing is. 0 when there is none.
export async function currentValuationRate(client, organizationId, warehouseId, itemId) {
  const row = (await client.query(`SELECT base_quantity, inventory_value, moving_average_cost FROM tenant.inventory_valuation_balances WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [organizationId, warehouseId, itemId])).rows[0];
  if (!row) return 0;
  const quantity = D(row.base_quantity);
  const rate = quantity > ZERO ? divD(D(row.inventory_value), quantity) : row.moving_average_cost === null ? ZERO : D(row.moving_average_cost);
  return rate > ZERO ? Number(text(rate)) : 0;
}

// Finance for stock that left to (or came back from) a customer: the cost of goods sold against Inventory, at exactly the value Inventory
// Valuation gave the movements — never the selling price. One journal per document. options: { movementIds, date, reference, description,
// sourceType, sourceId, sourceNumber }. Returns { journalEntryId, amount } or null when nothing was valued.
export async function postCostOfGoodsJournal(client, c, options) {
  const valuation = await valuationOfMovements(client, c.organizationId, options.movementIds);
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.view", "accounting.journal.create"])] };
  const ledger = await getPrimaryLedger(client, ctx);
  const totals = new Map();
  const book = (accountId, amount, description) => totals.set(`${accountId}:${description}`, { accountId, description, amount: (totals.get(`${accountId}:${description}`)?.amount ?? ZERO) + amount });
  for (const [itemId, amount] of valuation.byItem) {
    const value = D(amount);
    if (value === ZERO) continue;
    const inventory = (await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId, date: options.date })).account_id;
    const cogs = (await getAccountMapping(client, ctx, ledger.id, "cogs", { itemId, date: options.date })).account_id;
    book(inventory, value, "Inventory");
    book(cogs, -value, "Cost of goods sold");
  }
  const lines = [...totals.values()].filter((entry) => entry.amount !== ZERO).map((entry) => ({ accountId: entry.accountId, description: `${entry.description} · ${options.reference}`,
    debit: entry.amount > ZERO ? text(entry.amount, 2) : 0, credit: entry.amount < ZERO ? text(-entry.amount, 2) : 0, referenceType: options.sourceType, referenceId: options.sourceId }));
  if (!lines.length) return null;
  const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
    [c.organizationId, ledger.id])).rows[0];
  if (!journal) throw new StockError(409, "Finance: a General journal is not configured for the cost of goods sold.", "VALUATION_FINANCE_FAILED");
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() || "INR";
  const created = await createJournalEntry(client, ctx, { ledgerId: ledger.id, journalId: journal.id, entryDate: options.date, accountingDate: options.date, documentDate: options.date,
    entryType: "subledger", reference: options.reference, description: options.description, currencyCode: currency, exchangeRate: "1", lines },
  { internal: true, sourceModule: "inventory", sourceType: options.sourceType, sourceId: options.sourceId, sourceNumber: options.sourceNumber });
  await postJournalEntry(client, ctx, created.entry.id, { internal: true, allowDraft: true });
  return { journalEntryId: created.entry.id, amount: Math.abs(valuation.total) };
}
