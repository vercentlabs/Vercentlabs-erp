// Manufacturing — Material Availability: whether the materials for an order's remaining production are there, and what to do when they are
// not. A calculation only — Inventory stays the authority on stock, reservations and eligibility; nothing here moves, reserves or buys.
//
// For each material line of the order (its frozen recipe, or a draft's planned materials):
//   remaining requirement   required (planned + approved extra) − already used
//   in production           issued, not returned, not yet used           (covered: physically in production custody)
//   reserved for the order  Inventory reservations owned by the order    (covered: allocated)
//   newly available         usable, unreserved stock in the material warehouse (could be reserved now; shared between lines of an item)
//   shortage                remaining − in production − reserved − newly available
//   incoming                confirmed purchase orders still to receive, transfers in transit, linked subassembly orders — never stock
// Maximum feasible output: the largest further output whose requirement (the BOM engine's own calculation: yield, batches, allowances,
// rounding) every material's coverage meets — found by a bounded search, not by ratios.
import { restrictionReasonSql } from "../../stock/rules.js";
import { explodeRevision } from "../boms/bom-engine.js";
import {
  D, EXECUTING, MO, STATUS_LABEL, ZERO, add, has, idempotent, lineFigures, loadMaterials, loadOrder, max, min, moError, needMo, nextNumber, q, reservedByItem, reservedPerLine, sub,
  text, usableBalances, uuid,
} from "../orders/mo-core.js";

export const MATERIAL = Object.freeze({ view: "manufacturing.material.view", otherWarehouses: "manufacturing.material.view_other_warehouse",
  shortageRequest: "manufacturing.material.shortage_request", export: "manufacturing.material.export" });
const needView = (c) => { needMo(c, MO.view); if (!has(c, MATERIAL.view)) throw moError(403, "MFG_MO_PERMISSION_DENIED", "You do not have permission to view material availability."); };
const LINE_LABEL = { READY: "Ready", RESERVABLE: "Available to reserve", AWAITING_RECEIPT: "Awaiting receipt", SHORTAGE: "Short", BLOCKED: "Blocked" };
const READINESS_LABEL = { READY: "Ready", PARTIALLY_READY: "Partially ready", SHORTAGE: "Shortage", AWAITING_RECEIPT: "Awaiting receipt", BLOCKED: "Blocked", UNKNOWN: "Unknown" };

// Inventory's freshness for the order's materials in its warehouse: the newest availability version and change sequence.
async function inventoryState(client, c, warehouseId, itemIds) {
  const versions = (await client.query(`SELECT COALESCE(max(version), 0) AS version, max(updated_at) AS at FROM tenant.inventory_availability_versions
     WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = ANY($3::uuid[])`, [c.organizationId, warehouseId, itemIds])).rows[0];
  const sequence = (await client.query(`SELECT COALESCE(max(sequence), 0) AS sequence FROM tenant.inventory_availability_events WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = ANY($3::uuid[])`,
    [c.organizationId, warehouseId, itemIds])).rows[0];
  return { version: Number(versions.version), changedAt: versions.at, cursor: Number(sequence.sequence) };
}

// Stock that exists but cannot be used (held, quarantined, damaged, expired, blocked), by reason; batches and serial units that can be.
async function eligibilityOf(client, c, itemId, warehouseId, trackingType) {
  const excluded = (await client.query(
    `SELECT ${restrictionReasonSql("location", "batch")} AS reason, sum(balance.quantity) AS quantity FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3 AND balance.quantity > 0 GROUP BY 1`, [c.organizationId, itemId, warehouseId])).rows
    .filter((row) => row.reason).map((row) => ({ reason: row.reason, quantity: q(D(row.quantity)) }));
  const result = { excluded };
  if (trackingType === "batch") {
    const batches = (await usableBalances(client, c, itemId, warehouseId)).filter((row) => row.batch_id && sub(D(row.quantity), D(row.reserved_quantity)) > ZERO);
    result.batches = { usable: new Set(batches.map((row) => row.batch_id)).size, largest: q(batches.reduce((best, row) => max(best, sub(D(row.quantity), D(row.reserved_quantity))), ZERO)) };
  }
  if (trackingType === "serial") {
    result.serials = { usable: Number((await client.query(
      `SELECT count(*)::int AS n FROM tenant.stock_serials serial LEFT JOIN tenant.warehouse_locations location ON location.id = serial.warehouse_location_id
        WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.warehouse_id = $3 AND serial.status = 'available' AND COALESCE(location.disposition, 'available') = 'available'
          AND NOT EXISTS (SELECT 1 FROM tenant.stock_reservations reservation WHERE reservation.serial_id = serial.id AND reservation.status = 'active')`, [c.organizationId, itemId, warehouseId])).rows[0].n) };
  }
  return result;
}

// What is coming, never counted as stock: confirmed purchase orders still to receive into the warehouse, transfers in transit to it, and
// linked subassembly orders not yet received.
async function incomingOf(client, c, order, itemIds) {
  const rows = [];
  const purchases = (await client.query(
    `SELECT line.product_id AS item_id, po.id, po.purchase_order_number AS number, status.remaining_to_receive * COALESCE(NULLIF(line.conversion_factor, 0), 1) AS quantity,
            COALESCE(status.expected_delivery_date, po.expected_delivery_date) AS expected
       FROM tenant.purchase_order_line_status status JOIN tenant.purchase_order_lines line ON line.id = status.purchase_order_line_id JOIN tenant.purchase_orders po ON po.id = line.purchase_order_id
      WHERE po.organization_id = $1 AND po.status = 'confirmed' AND line.product_id = ANY($2::uuid[]) AND status.remaining_to_receive > 0
        AND COALESCE(line.receiving_warehouse_id, po.default_warehouse_id) = $3`, [c.organizationId, itemIds, order.material_warehouse_id])).rows;
  for (const row of purchases) rows.push({ itemId: row.item_id, source: "PURCHASE_ORDER", reference: row.number, id: row.id, quantity: D(row.quantity), expected: row.expected });
  const transfers = (await client.query(
    `SELECT line.item_id, transfer.id, transfer.document_number AS number, line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity AS quantity, transfer.expected_arrival_date AS expected
       FROM tenant.inventory_transfer_lines line JOIN tenant.inventory_transfers transfer ON transfer.id = line.transfer_id
      WHERE transfer.organization_id = $1 AND transfer.destination_warehouse_id = $2 AND transfer.status IN ('dispatched', 'in_transit', 'partially_received') AND line.item_id = ANY($3::uuid[])
        AND line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity > 0`, [c.organizationId, order.material_warehouse_id, itemIds])).rows;
  for (const row of transfers) rows.push({ itemId: row.item_id, source: "TRANSFER", reference: row.number, id: row.id, quantity: D(row.quantity), expected: row.expected });
  const children = (await client.query(
    `SELECT finished_item_id AS item_id, id, mo_number AS number, status, planned_base_quantity - received_quantity AS quantity, planned_end_at AS expected FROM tenant.manufacturing_orders
      WHERE organization_id = $1 AND parent_order_id = $2 AND status NOT IN ('COMPLETED', 'CANCELLED') AND finished_goods_warehouse_id = $3 AND planned_base_quantity > received_quantity`,
    [c.organizationId, order.id, order.material_warehouse_id])).rows;
  for (const row of children) rows.push({ itemId: row.item_id, source: "CHILD_ORDER", reference: row.number, id: row.id, quantity: D(row.quantity), expected: row.expected, status: row.status });
  return rows;
}

// The order's remaining requirement per material and its coverage: the shared core of the order view, the shortages list and the reports.
async function coverage(client, c, order, { withAlternates = false } = {}) {
  const lines = await loadMaterials(client, c, order.id);
  const itemIds = [...new Set(lines.map((line) => line.component_item_id))];
  const reserved = reservedPerLine(lines, await reservedByItem(client, c, order));
  const free = new Map();
  for (const itemId of itemIds) free.set(itemId, (await usableBalances(client, c, itemId, order.material_warehouse_id)).reduce((sum, row) => add(sum, max(sub(D(row.quantity), D(row.reserved_quantity)), ZERO)), ZERO));
  const freeLeft = new Map(free);
  const incoming = await incomingOf(client, c, order, itemIds);
  const demands = (await client.query(
    `SELECT item_id, manufacturing_order_material_id, demand_number, status, quantity FROM tenant.manufacturing_material_demands
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')`, [c.organizationId, order.id])).rows;
  const items = new Map((await client.query(`SELECT id, status, lifecycle_status, item_type FROM tenant.items WHERE id = ANY($1::uuid[])`, [itemIds])).rows.map((row) => [row.id, row]));
  const out = [];
  for (const line of lines) {
    const figures = lineFigures(line);
    const remaining = max(sub(sub(figures.required, figures.consumed), figures.scrapped), ZERO);
    const custody = max(figures.custody, ZERO);
    const held = reserved.get(line.id) ?? ZERO;
    const open = max(sub(sub(remaining, custody), held), ZERO);
    const available = freeLeft.get(line.component_item_id) ?? ZERO;
    const take = min(available, open);
    freeLeft.set(line.component_item_id, sub(available, take));
    const shortage = sub(open, take);
    const lineIncoming = incoming.filter((row) => row.itemId === line.component_item_id);
    const incomingTotal = lineIncoming.reduce((sum, row) => add(sum, row.quantity), ZERO);
    const expected = lineIncoming.map((row) => row.expected).filter(Boolean).sort()[0] ?? null;
    const linkedDemand = demands.filter((row) => row.item_id === line.component_item_id && (!row.manufacturing_order_material_id || row.manufacturing_order_material_id === line.id));
    const blockers = [];
    const item = items.get(line.component_item_id);
    if (!item || item.status !== "active" || item.lifecycle_status === "inactive") blockers.push(`${line.item_code} is inactive.`);
    const eligibility = await eligibilityOf(client, c, line.component_item_id, order.material_warehouse_id, line.tracking_type);
    if (line.tracking_type === "serial" && eligibility.serials && D(eligibility.serials.usable) < open && open > ZERO) blockers.push(`${line.item_code}: only ${eligibility.serials.usable} serial unit(s) can be used.`);
    const status = blockers.length ? "BLOCKED" : open === ZERO ? "READY" : shortage === ZERO ? "RESERVABLE" : incomingTotal >= shortage ? "AWAITING_RECEIPT" : "SHORTAGE";
    let alternates = null;
    if (withAlternates && shortage > ZERO) {
      alternates = (await client.query(`SELECT id, code FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND id <> $2 ORDER BY code`, [c.organizationId, order.material_warehouse_id])).rows;
      const found = [];
      for (const warehouse of alternates) {
        const there = (await usableBalances(client, c, line.component_item_id, warehouse.id)).reduce((sum, row) => add(sum, max(sub(D(row.quantity), D(row.reserved_quantity)), ZERO)), ZERO);
        if (there > ZERO) found.push({ warehouseId: warehouse.id, warehouse: warehouse.code, available: q(there) });
      }
      alternates = found;
    }
    out.push({
      materialId: line.id, lineNumber: line.line_number, itemId: line.component_item_id, code: line.item_code, name: line.item_name, uom: line.uom_code, kind: line.kind, origin: line.origin,
      trackingType: line.tracking_type, required: q(figures.required), consumed: q(figures.consumed), remaining: q(remaining), inProduction: q(custody), reserved: q(held), newlyAvailable: q(take),
      shortage: q(shortage), incoming: q(incomingTotal), expectedAt: expected, incomingSources: lineIncoming.map((row) => ({ source: row.source, reference: row.reference, id: row.id, quantity: q(row.quantity), expected: row.expected })),
      requested: linkedDemand.map((row) => ({ number: row.demand_number, status: row.status, quantity: q(D(row.quantity)) })), status, statusLabel: LINE_LABEL[status], blockers,
      eligibility, alternates,
      covered: { allocated: q(add(custody, held)), feasible: q(add(add(custody, held), take)) },
      _coverage: add(add(custody, held), take), _allocated: add(custody, held),
    });
  }
  return { lines: out, itemIds };
}

// The largest further output every material covers, through the BOM engine (yield, batches, allowances and rounding), by bisection over the
// finished item's unit precision. Extra (non-recipe) material lines do not limit it.
async function feasibleOutput(client, c, order, lines, remainingOutput, coverageKey = "_coverage") {
  if (!order.bom_revision_id || remainingOutput <= ZERO) return { maximum: ZERO, limiting: [] };
  const cover = new Map();
  for (const line of lines.filter((row) => row.origin === "RECIPE")) cover.set(line.itemId, add(cover.get(line.itemId) ?? ZERO, line[coverageKey]));
  const decimals = Number((await client.query(`SELECT COALESCE(uom.decimal_places, 0) AS d FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.id = $1`,
    [order.finished_item_id])).rows[0]?.d ?? 0);
  const step = 10n ** BigInt(6 - Math.max(0, Math.min(6, decimals)));
  const needs = async (quantity) => {
    const explosion = await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(quantity), policy: "USE_STOCKED_SUBASSEMBLIES" });
    return new Map(explosion.consumed.map((row) => [row.itemId, D(row.required)]));
  };
  const fits = (requirement) => [...requirement].every(([itemId, quantity]) => quantity <= (cover.get(itemId) ?? ZERO));
  const full = await needs(remainingOutput);
  if (fits(full)) return { maximum: remainingOutput, limiting: [] };
  let low = ZERO;
  let high = remainingOutput;
  for (let round = 0; round < 40 && high - low > step; round += 1) {
    let middle = (low + high) / 2n;
    middle -= middle % step;
    if (middle <= low) middle = low + step;
    if (middle >= high) break;
    if (fits(await needs(middle))) low = middle; else high = middle;
  }
  if (low === ZERO && high === step && fits(await needs(step))) low = step;
  const limiting = [...full].map(([itemId, quantity]) => ({ itemId, ratio: quantity > ZERO ? Number(cover.get(itemId) ?? ZERO) / Number(quantity) : Infinity }))
    .filter((row) => row.ratio < 1).sort((a, b) => a.ratio - b.ratio).map((row) => row.itemId);
  return { maximum: low, limiting };
}

function readinessOf(lines, feasible, remainingOutput, authoritative) {
  if (!authoritative) return "UNKNOWN";
  if (lines.some((row) => row.status === "BLOCKED")) return "BLOCKED";
  if (lines.every((row) => row.status === "READY")) return "READY";
  if (feasible >= remainingOutput && remainingOutput > ZERO) return "PARTIALLY_READY";
  if (lines.filter((row) => row.status === "SHORTAGE").length === 0 && lines.some((row) => row.status === "AWAITING_RECEIPT")) return "AWAITING_RECEIPT";
  return feasible > ZERO ? "PARTIALLY_READY" : "SHORTAGE";
}

// ------------------------------------------------------------------ one order
// input: { since? (an inventory cursor: report whether anything changed after it) }
export async function getMaterialAvailability(client, c, id, input = {}) {
  needView(c);
  const order = await loadOrder(client, c, id);
  const remainingOutput = max(sub(D(order.planned_base_quantity), D(order.accepted_quantity)), ZERO);
  let lines;
  let itemIds;
  let authoritative = true;
  let failure = null;
  try {
    ({ lines, itemIds } = await coverage(client, c, order, { withAlternates: has(c, MATERIAL.otherWarehouses) }));
  } catch (error) {
    authoritative = false;
    failure = error.message;
    lines = [];
    itemIds = [];
  }
  const feasible = authoritative ? await feasibleOutput(client, c, order, lines, remainingOutput).catch((error) => { failure = error.message; return { maximum: ZERO, limiting: [], failed: true }; }) : { maximum: ZERO, limiting: [] };
  const allocatedFeasible = authoritative ? await feasibleOutput(client, c, order, lines, remainingOutput, "_allocated").catch(() => ({ maximum: ZERO, limiting: [] })) : { maximum: ZERO, limiting: [] };
  const readiness = feasible.failed ? "BLOCKED" : readinessOf(lines, feasible.maximum, remainingOutput, authoritative);
  const state = authoritative && itemIds.length ? await inventoryState(client, c, order.material_warehouse_id, itemIds) : { version: 0, changedAt: null, cursor: 0 };
  const shortLines = lines.filter((row) => D(row.shortage) > ZERO);
  const allocation = lines.every((row) => row.status === "READY") ? "FULLY_ALLOCATED" : lines.some((row) => D(row.covered.allocated) > ZERO) ? "PARTIALLY_ALLOCATED" : "NOT_ALLOCATED";
  const warehouse = (await client.query(`SELECT code, name FROM tenant.warehouses WHERE id = $1`, [order.material_warehouse_id])).rows[0];
  const nextAction = readiness === "UNKNOWN" ? "Stock cannot be verified right now; wait and refresh before reserving or issuing."
    : readiness === "BLOCKED" ? "Resolve the blocked materials before reserving or issuing."
    : readiness === "READY" ? "Materials are allocated or issued for the remaining output."
    : shortLines.length === 0 ? "Everything needed is available: reserve the materials."
    : feasible.maximum > ZERO ? `Request the missing materials, or review a smaller batch of ${q(feasible.maximum)}.` : "Request the missing materials.";
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], orderVersion: order.version, bomRevisionId: order.bom_revision_id,
    snapshotId: order.bom_snapshot_id, warehouse: { id: order.material_warehouse_id, code: warehouse?.code, name: warehouse?.name },
    plannedOutput: q(D(order.planned_base_quantity)), acceptedOutput: q(D(order.accepted_quantity)), remainingOutput: q(remainingOutput),
    maximumFeasibleOutput: q(feasible.maximum), allocatedFeasibleOutput: q(allocatedFeasible.maximum), unfeasibleOutput: q(max(sub(remainingOutput, feasible.maximum), ZERO)),
    limiting: feasible.limiting.map((itemId) => lines.find((row) => row.itemId === itemId)?.code).filter(Boolean),
    readiness, readinessLabel: READINESS_LABEL[readiness], allocation, availabilityAuthoritative: authoritative, failure, nextAction,
    partialProduction: { allowed: EXECUTING.has(order.status), note: "A smaller batch still needs a manager's partial start (or its materials reserved); nothing starts automatically." },
    shortages: shortLines.length, calculatedAt: new Date().toISOString(), inventory: state,
    changedSince: input.since !== undefined && input.since !== null && input.since !== "" ? state.cursor > Number(input.since) : null,
    materials: lines.map(({ _coverage, _allocated, ...row }) => row),
    can: { reserve: EXECUTING.has(order.status) && has(c, MO.reserve) && authoritative, requestShortages: has(c, MATERIAL.shortageRequest) && shortLines.length > 0 && authoritative,
      seeAlternates: has(c, MATERIAL.otherWarehouses), export: has(c, MATERIAL.export) },
  };
}

// What a reservation would do now, per material, without reserving: wanted, reservable, short.
export async function previewMaterialReservation(client, c, id) {
  needView(c);
  const order = await loadOrder(client, c, id);
  const { lines } = await coverage(client, c, order);
  const byItem = new Map();
  for (const line of lines) {
    const entry = byItem.get(line.itemId) ?? { itemId: line.itemId, code: line.code, uom: line.uom, wanted: ZERO, reservable: ZERO, trackingType: line.trackingType };
    entry.wanted = add(entry.wanted, max(sub(sub(D(line.remaining), D(line.inProduction)), D(line.reserved)), ZERO));
    entry.reservable = add(entry.reservable, D(line.newlyAvailable));
    byItem.set(line.itemId, entry);
  }
  const rows = [...byItem.values()].map((row) => ({ ...row, wanted: q(row.wanted), reservable: q(row.trackingType === "serial" ? ZERO : row.reservable),
    short: q(sub(row.wanted, row.trackingType === "serial" ? ZERO : row.reservable)), note: row.trackingType === "serial" ? "Serial units are chosen at issue." : null }));
  return { orderId: order.id, complete: rows.every((row) => D(row.short) === ZERO || row.note), lines: rows.filter((row) => D(row.wanted) > ZERO), previewOnly: true };
}

// Whether an issue of these quantities would pass now (input: { lines: [{ materialId, quantity }] }) — the same checks the issue makes, without
// moving anything: state, the line's remaining quantity, and stock reserved for the order or free in the warehouse.
export async function validateMaterialIssueReadiness(client, c, id, input = {}) {
  needView(c);
  const order = await loadOrder(client, c, id);
  const problems = [];
  if (!EXECUTING.has(order.status)) problems.push(`${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: materials are issued to a released or in-progress order.`);
  const materials = await loadMaterials(client, c, order.id);
  const { lines } = await coverage(client, c, order);
  const results = [];
  for (const request of Array.isArray(input.lines) ? input.lines : []) {
    const material = materials.find((row) => row.id === request.materialId);
    const line = lines.find((row) => row.materialId === request.materialId);
    if (!material || !line) { problems.push("A material line is not on this order."); continue; }
    const amount = D(String(request.quantity ?? "0"));
    const toIssue = lineFigures(material).toIssue;
    const stock = add(D(line.reserved), D(line.newlyAvailable));
    const issues = [];
    if (amount > toIssue) issues.push(`only ${q(toIssue)} may still be issued`);
    if (amount > stock) issues.push(`${q(stock)} is reserved or free in the warehouse`);
    if (line.trackingType === "serial") issues.push("choose the serial units at issue");
    results.push({ materialId: line.materialId, code: line.code, quantity: q(amount), ok: issues.length === 0, issues });
  }
  return { orderId: order.id, ok: problems.length === 0 && results.every((row) => row.ok), problems, lines: results, checkedAt: new Date().toISOString(), previewOnly: true };
}

// ------------------------------------------------------------------ shortages to Procurement
// The order's shortages handed to Procurement as demand, per material line, net of demand already requested and still open for it — so a
// recheck never asks twice. input: { materialIds?, idempotencyKey? }
export async function requestMaterialShortages(client, c, id, input = {}) {
  needMo(c, MO.view);
  if (!has(c, MATERIAL.shortageRequest) && !has(c, MO.reserve)) throw moError(403, "MFG_MO_PERMISSION_DENIED", "You do not have permission to request missing materials.");
  const result = await idempotent(client, c, "manufacturing.order.shortage_request", input.idempotencyKey, { id, materialIds: input.materialIds ?? null }, async () => {
    const order = await loadOrder(client, c, id, { lock: true });
    if (!["RELEASED", "IN_PROGRESS", "ON_HOLD", "AWAITING_APPROVAL", "DRAFT"].includes(order.status)) throw moError(409, "MFG_MO_STATE_INVALID", "Materials are requested for an open order.");
    const { lines } = await coverage(client, c, order);
    const created = [];
    const existing = [];
    for (const line of lines) {
      if (input.materialIds?.length && !input.materialIds.includes(line.materialId)) continue;
      const shortage = D(line.shortage);
      if (shortage <= ZERO) continue;
      const requested = line.requested.reduce((sum, row) => add(sum, D(row.quantity)), ZERO);
      const wanted = sub(shortage, requested);
      if (wanted <= ZERO) { existing.push({ code: line.code, requested: q(requested), demands: line.requested.map((row) => row.number) }); continue; }
      const count = Number((await client.query(`SELECT count(*) AS n FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND manufacturing_order_id = $2 AND item_id = $3`,
        [c.organizationId, order.id, line.itemId])).rows[0].n);
      const number = await nextNumber(client, c, "manufacturing_material_demand");
      await client.query(
        `INSERT INTO tenant.manufacturing_material_demands (organization_id, demand_number, item_id, quantity, uom_id, warehouse_id, required_by, bom_id, revision_id, snapshot_id, finished_item_id,
           planned_quantity, request_key, notes, created_by, manufacturing_order_id, manufacturing_order_material_id)
         SELECT $1, $2, $3, $4, material.uom_id, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, material.id FROM tenant.manufacturing_order_materials material WHERE material.id = $16`,
        [c.organizationId, number, line.itemId, q(wanted), order.material_warehouse_id, new Date(order.planned_start_at).toISOString().slice(0, 10), order.bom_id, order.bom_revision_id, order.bom_snapshot_id,
          order.finished_item_id, order.planned_base_quantity, `mo:${order.id}:${line.materialId}:${count + 1}`, `For ${order.mo_number}${requested > ZERO ? ` (beyond ${q(requested)} already requested)` : ""}`,
          c.userId ?? null, order.id, line.materialId]);
      created.push({ number, code: line.code, quantity: q(wanted), alreadyRequested: q(requested), incoming: line.incoming });
    }
    await client.query(`INSERT INTO tenant.manufacturing_order_events (organization_id, manufacturing_order_id, action, summary, details, actor_user_id) VALUES ($1,$2,'SHORTAGES_HANDED_OFF',$3,$4::jsonb,$5)`,
      [c.organizationId, order.id, created.length ? created.map((row) => `${row.number} ${row.code} ${row.quantity}`).join(", ") : "Nothing new to request", JSON.stringify({ created, existing }), c.userId ?? null]);
    return { orderId: order.id, created, existing };
  });
  if (!result.created.length && result.existing.length && !result.replayed) {
    return { ...result, message: "A linked material request already covers these shortages." };
  }
  return result;
}

// ------------------------------------------------------------------ across orders
// Every open order's shortages (filters: { warehouseId?, itemId?, status? }), oldest release first.
export async function listMaterialShortages(client, c, filters = {}) {
  needView(c);
  const orders = (await client.query(
    `SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND status IN ('DRAFT', 'AWAITING_APPROVAL', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD')
       AND ($2::uuid IS NULL OR material_warehouse_id = $2) ORDER BY COALESCE(released_at, created_at) LIMIT 300`, [c.organizationId, filters.warehouseId ? uuid(filters.warehouseId, "Warehouse") : null])).rows;
  const rows = [];
  const warehouses = new Map((await client.query(`SELECT id, code FROM tenant.warehouses WHERE organization_id = $1`, [c.organizationId])).rows.map((row) => [row.id, row.code]));
  for (const order of orders) {
    const { lines } = await coverage(client, c, order);
    for (const line of lines) {
      if (D(line.shortage) <= ZERO && line.status !== "BLOCKED") continue;
      if (filters.itemId && line.itemId !== filters.itemId) continue;
      rows.push({ orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], warehouseId: order.material_warehouse_id,
        warehouse: warehouses.get(order.material_warehouse_id), materialId: line.materialId, itemId: line.itemId, code: line.code, name: line.name, uom: line.uom, kind: line.kind,
        remaining: line.remaining, covered: line.covered.feasible, shortage: line.shortage, incoming: line.incoming, expectedAt: line.expectedAt, requested: line.requested, status: line.status,
        statusLabel: line.statusLabel, requiredBy: order.planned_start_at, ageDays: Math.max(0, Math.floor((Date.now() - new Date(order.released_at ?? order.created_at).getTime()) / 86_400_000)) });
    }
  }
  return filters.status ? rows.filter((row) => row.status === filters.status) : rows;
}

// Reports (kind): readiness | demand-by-item | warehouse-shortages | reservation-coverage | issued-vs-required | incoming | subassembly-shortages | aging
export async function getMaterialReport(client, c, kind = "readiness") {
  needView(c);
  const orders = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND status IN ('DRAFT', 'AWAITING_APPROVAL', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD') ORDER BY planned_start_at LIMIT 200`,
    [c.organizationId])).rows;
  if (kind === "readiness") {
    const out = [];
    for (const order of orders) {
      const view = await getMaterialAvailability(client, c, order.id);
      out.push({ orderId: order.id, orderNumber: order.mo_number, status: view.orderStatusLabel, warehouse: view.warehouse.code, remaining: view.remainingOutput, feasible: view.maximumFeasibleOutput,
        allocatedFeasible: view.allocatedFeasibleOutput, readiness: view.readiness, readinessLabel: view.readinessLabel, shortages: view.shortages, limiting: view.limiting.join(", ") });
    }
    return out;
  }
  const lines = [];
  for (const order of orders) {
    const { lines: rows } = await coverage(client, c, order);
    for (const row of rows) lines.push({ ...row, orderId: order.id, orderNumber: order.mo_number, warehouseId: order.material_warehouse_id, released: order.released_at ?? order.created_at });
  }
  const sum = (rows, field) => rows.reduce((total, row) => add(total, D(row[field])), ZERO);
  const group = (key) => {
    const map = new Map();
    for (const row of lines) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
    return [...map.entries()];
  };
  if (kind === "demand-by-item") return group((row) => row.itemId).map(([, rows]) => ({ code: rows[0].code, name: rows[0].name, uom: rows[0].uom, orders: new Set(rows.map((row) => row.orderId)).size,
    remaining: q(sum(rows, "remaining")), inProduction: q(sum(rows, "inProduction")), reserved: q(sum(rows, "reserved")), shortage: q(sum(rows, "shortage")), incoming: q(D(rows[0].incoming)) }));
  if (kind === "warehouse-shortages") {
    const names = new Map((await client.query(`SELECT id, code FROM tenant.warehouses WHERE organization_id = $1`, [c.organizationId])).rows.map((row) => [row.id, row.code]));
    return group((row) => `${row.warehouseId}:${row.itemId}`).map(([, rows]) => ({ warehouse: names.get(rows[0].warehouseId), code: rows[0].code, uom: rows[0].uom, shortage: q(sum(rows, "shortage")),
      orders: new Set(rows.map((row) => row.orderId)).size })).filter((row) => D(row.shortage) > ZERO);
  }
  const perLine = (rows) => rows.map((row) => ({ orderId: row.orderId, orderNumber: row.orderNumber, code: row.code, uom: row.uom, required: row.required, consumed: row.consumed, remaining: row.remaining,
    inProduction: row.inProduction, reserved: row.reserved, shortage: row.shortage, incoming: row.incoming, expectedAt: row.expectedAt, sources: row.incomingSources,
    ageDays: Math.max(0, Math.floor((Date.now() - new Date(row.released).getTime()) / 86_400_000)) }));
  if (kind === "reservation-coverage" || kind === "issued-vs-required") return perLine(lines);
  if (kind === "incoming") return perLine(lines.filter((row) => D(row.incoming) > ZERO));
  if (kind === "subassembly-shortages") return perLine(lines.filter((row) => row.kind === "SUBASSEMBLY" && D(row.shortage) > ZERO));
  if (kind === "aging") return perLine(lines.filter((row) => D(row.shortage) > ZERO)).sort((a, b) => b.ageDays - a.ageDays);
  throw moError(400, "MFG_MO_VALIDATION_FAILED", "Unknown report.");
}

// A BOM revision's material availability for a quantity in a warehouse, before any order exists (input: { plannedQuantity, warehouseId, policy?, choices? }).
export async function previewBomAvailability(client, c, revisionId, input = {}) {
  if (!has(c, "manufacturing.bom.view") || !has(c, MATERIAL.view)) throw moError(403, "MFG_MO_PERMISSION_DENIED", "You do not have permission to view material availability.");
  const warehouseId = uuid(input.warehouseId, "Warehouse");
  const planned = D(String(input.plannedQuantity ?? "1"));
  const explosion = await explodeRevision(client, c.organizationId, uuid(revisionId, "Revision"), { plannedQuantity: q(planned), policy: input.policy, choices: input.choices });
  const lines = [];
  for (const row of explosion.consumed) {
    const free = (await usableBalances(client, c, row.itemId, warehouseId)).reduce((sum, balance) => add(sum, max(sub(D(balance.quantity), D(balance.reserved_quantity)), ZERO)), ZERO);
    const required = D(row.required);
    lines.push({ itemId: row.itemId, code: row.code, name: row.name, uom: row.baseUom, kind: row.kind, required: q(required), available: q(free), shortage: q(max(sub(required, free), ZERO)) });
  }
  const cover = new Map(lines.map((row) => [row.itemId, D(row.available)]));
  const fits = async (quantity) => (await explodeRevision(client, c.organizationId, revisionId, { plannedQuantity: q(quantity), policy: input.policy, choices: input.choices })).consumed
    .every((row) => D(row.required) <= (cover.get(row.itemId) ?? ZERO));
  let low = ZERO;
  let high = planned;
  if (lines.every((row) => D(row.shortage) === ZERO)) low = planned;
  else for (let round = 0; round < 40 && high - low > 1_000_000n; round += 1) {
    let middle = (low + high) / 2n;
    middle -= middle % 1_000_000n;
    if (middle <= low) break;
    if (await fits(middle)) low = middle; else high = middle;
  }
  return { revisionId, warehouseId, plannedQuantity: q(planned), plannedUom: explosion.plannedUom, lines, maximumFeasible: q(low), shortages: lines.filter((row) => D(row.shortage) > ZERO).length,
    assumptions: explosion.assumptions, previewOnly: true };
}

export { text };
