// Partial Production — the reads: an order's production progress (planned, authorized target, reported, awaiting inspection, accepted,
// rejected, received, accepted not yet received, remaining, yield — and the same per batch and per entry), what is receivable, material
// readiness for a next batch (with the BOM's expectation for it), one entry with its decisions, receipts and corrections, the entry list,
// the order's production history and the reports. Costs only with the cost permission; nothing here changes anything.
import { explodeRevision } from "../boms/bom-engine.js";
import { money, wipBalance } from "../orders/mo-core.js";
import {
  D, ENTRY_STATUS_LABEL, MO, PRODUCTION, STATUS_LABEL, ZERO, add, authorizedTarget, decisionsOf, entryFigures, has, loadEntry, loadProductionOrder, materialReadiness, max, outputQuantity,
  productionError, productionSettings, q, sub, uuid,
} from "./production-core.js";

const needView = (c) => { if (!has(c, MO.view)) throw productionError(403, "MFG_PARTIAL_PERMISSION_DENIED"); };
const percent = (part, whole) => (whole > ZERO ? (Number(part) / Number(whole) * 100).toFixed(1) : null);
const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};

async function entriesOf(client, c, orderId, { statuses = ["REPORTED", "RECOVERY_REQUIRED"] } = {}) {
  const rows = (await client.query(`SELECT entry.*, batch.batch_reference AS batch, uom.code AS uom_code FROM tenant.manufacturing_production_entries entry
      LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id LEFT JOIN tenant.units_of_measure uom ON uom.id = entry.output_uom_id
     WHERE entry.organization_id = $1 AND entry.manufacturing_order_id = $2 AND entry.status = ANY($3::text[]) ORDER BY COALESCE(entry.posted_at, entry.recorded_at), entry.entry_number`,
    [c.organizationId, orderId, statuses])).rows;
  const decided = await decisionsOf(client, c, rows.map((row) => row.id));
  return rows.map((row) => ({ row, figures: entryFigures(row, decided.get(row.id)) }));
}
const entryView = (row, figures, people) => ({
  id: row.id, number: row.entry_number, status: row.status, statusLabel: ENTRY_STATUS_LABEL[row.status], batchId: row.production_batch_id, batch: row.batch ?? row.batch_reference,
  entered: row.entered_quantity === null ? null : q(D(row.entered_quantity)), uom: row.uom_code, reported: q(figures.reported), accepted: q(figures.accepted), rejected: q(figures.rejected),
  pending: q(figures.pending), received: q(figures.received), receivable: q(figures.receivable), correctedPending: q(figures.correctedPending), correctedAccepted: q(figures.correctedAccepted),
  inspection: figures.inspection, receipt: figures.receipt, producedAt: row.produced_at, postedAt: row.posted_at, postedBy: people?.get(row.posted_by) ?? null, notes: row.notes,
  rejectionReason: row.rejection_reason, materialOverride: row.material_override_reason, rowVersion: row.row_version,
});

// ------------------------------------------------------------------ an order's progress
export async function getMoProductionProgress(client, c, orderId) {
  needView(c);
  const order = await loadProductionOrder(client, c, orderId);
  const settings = await productionSettings(client, c);
  const target = authorizedTarget(order, settings);
  const planned = D(order.planned_base_quantity);
  const accepted = D(order.accepted_quantity);
  const reported = D(order.reported_quantity);
  const received = D(order.received_quantity);
  const posted = await entriesOf(client, c, order.id);
  const drafts = await entriesOf(client, c, order.id, { statuses: ["DRAFT"] });
  const batches = (await client.query(`SELECT batch.*, location.code AS location FROM tenant.manufacturing_production_batches batch LEFT JOIN tenant.warehouse_locations location ON location.id = batch.production_location_id
      WHERE batch.organization_id = $1 AND batch.manufacturing_order_id = $2 ORDER BY batch.started_at`, [c.organizationId, order.id])).rows;
  const consumed = (await client.query(`SELECT note.production_batch_id, line.item_id, sum(line.base_quantity - line.corrected_quantity) AS quantity FROM tenant.manufacturing_material_consumptions note
      JOIN tenant.manufacturing_material_consumption_lines line ON line.consumption_id = note.id WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND note.status = 'POSTED'
        AND note.production_batch_id IS NOT NULL GROUP BY 1, 2`, [c.organizationId, order.id])).rows;
  const requests = (await client.query(`SELECT * FROM tenant.manufacturing_overproduction_requests WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY requested_at DESC`, [c.organizationId, order.id])).rows;
  const people = await names(client, [...posted.map((entry) => entry.row.posted_by), ...requests.flatMap((row) => [row.requested_by, row.decided_by]), order.short_close_requested_by]);
  const items = new Map((await client.query(`SELECT material.component_item_id AS id, item.code FROM tenant.manufacturing_order_materials material JOIN tenant.items item ON item.id = material.component_item_id
      WHERE material.manufacturing_order_id = $1`, [order.id])).rows.map((row) => [row.id, row.code]));
  const batchViews = [];
  for (const batch of batches) {
    const own = posted.filter((entry) => entry.row.production_batch_id === batch.id);
    const sum = (field) => own.reduce((total, entry) => add(total, entry.figures[field]), ZERO);
    const batchReported = sum("reported");
    let materials = [];
    if (order.bom_revision_id && batchReported > ZERO) {
      const expected = (await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(batchReported), policy: "USE_STOCKED_SUBASSEMBLIES" })).consumed;
      const byItem = new Map();
      for (const row of expected) byItem.set(row.itemId, add(byItem.get(row.itemId) ?? ZERO, D(row.required)));
      for (const row of consumed.filter((part) => part.production_batch_id === batch.id)) if (!byItem.has(row.item_id)) byItem.set(row.item_id, ZERO);
      materials = [...byItem.entries()].map(([itemId, expect]) => {
        const actual = consumed.filter((part) => part.production_batch_id === batch.id && part.item_id === itemId).reduce((total, part) => add(total, D(part.quantity)), ZERO);
        return { code: items.get(itemId) ?? itemId, expected: q(expect), consumed: q(actual), variance: q(sub(actual, expect)) };
      });
    }
    batchViews.push({ id: batch.id, reference: batch.batch_reference, status: batch.status, location: batch.location, planned: batch.planned_quantity === null ? null : q(D(batch.planned_quantity)),
      startedAt: batch.started_at, endedAt: batch.ended_at, entries: own.length, reported: q(batchReported), accepted: q(sum("accepted")), rejected: q(sum("rejected")), pending: q(sum("pending")),
      received: q(sum("received")), receivable: q(sum("receivable")), materials, consumptionRecorded: materials.some((row) => D(row.consumed) > ZERO) });
  }
  const receivable = posted.reduce((total, entry) => add(total, entry.figures.receivable), ZERO);
  const s = order.status;
  return {
    orderId: order.id, orderNumber: order.mo_number, status: s, statusLabel: STATUS_LABEL[s], version: order.version,
    quantities: { planned: q(planned), authorizedTarget: q(target), overproductionAllowance: q(D(order.overproduction_allowance_quantity ?? 0)), tolerancePct: q(settings.tolerancePct),
      reported: q(reported), pending: q(D(order.pending_inspection_quantity)), accepted: q(accepted), rejected: q(D(order.rejected_quantity)), received: q(received),
      acceptedNotReceived: q(sub(accepted, received)), remaining: q(max(sub(planned, accepted), ZERO)), shortfall: s === "COMPLETED" ? q(max(sub(planned, accepted), ZERO)) : null,
      progressPct: percent(accepted, planned), yieldPct: percent(accepted, add(accepted, D(order.rejected_quantity))) },
    // A check that every figure is rebuilt from the entries and decisions: the order's counters agree with its posted entries.
    reconciled: posted.reduce((total, entry) => add(total, entry.figures.reported), ZERO) === reported && posted.reduce((total, entry) => add(total, entry.figures.accepted), ZERO) === accepted
      && posted.reduce((total, entry) => add(total, entry.figures.received), ZERO) === received && receivable === sub(accepted, received),
    batches: batchViews,
    entries: posted.map((entry) => entryView(entry.row, entry.figures, people)),
    drafts: drafts.map((entry) => entryView(entry.row, entry.figures, people)),
    overproduction: requests.map((row) => ({ id: row.id, quantity: q(D(row.quantity)), reason: row.reason, status: row.status, requestedBy: people.get(row.requested_by) ?? null, requestedAt: row.requested_at,
      decidedBy: people.get(row.decided_by) ?? null, note: row.decision_note, mayDecide: row.status === "REQUESTED" && has(c, MO.approveVariance) && (row.requested_by !== c.userId || settings.varianceSelfApproval) })),
    shortClose: order.short_close_requested_at ? { requestedBy: people.get(order.short_close_requested_by) ?? null, requestedAt: order.short_close_requested_at, reason: order.short_close_request_reason,
      pending: s === "COMPLETION_PENDING", mayDecide: s === "COMPLETION_PENDING" && has(c, MO.approveVariance) && (order.short_close_requested_by !== c.userId || settings.selfApproval) } : null,
    can: {
      record: s === "IN_PROGRESS" && has(c, MO.record) && has(c, PRODUCTION.post), draft: ["RELEASED", "IN_PROGRESS"].includes(s) && has(c, PRODUCTION.editDraft),
      openBatch: ["RELEASED", "IN_PROGRESS"].includes(s) && has(c, PRODUCTION.editDraft), decideQuality: ["IN_PROGRESS", "ON_HOLD"].includes(s) && has(c, MO.quality) && D(order.pending_inspection_quantity) > ZERO,
      receive: s === "IN_PROGRESS" && has(c, MO.receive) && has(c, "stock.receive") && receivable > ZERO, requestOverproduction: ["RELEASED", "IN_PROGRESS"].includes(s) && has(c, MO.record),
      requestShortClose: s === "IN_PROGRESS" && has(c, MO.complete) && accepted < planned, correct: ["IN_PROGRESS", "ON_HOLD"].includes(s) && has(c, PRODUCTION.correct),
      export: has(c, PRODUCTION.export), viewCost: has(c, MO.costView),
    },
  };
}

export async function listProductionBatches(client, c, orderId) {
  return (await getMoProductionProgress(client, c, orderId)).batches;
}

// What may be received: accepted output not yet in stock, entry by entry (oldest first).
export async function getReceivableFinishedGoods(client, c, orderId) {
  needView(c);
  const order = await loadProductionOrder(client, c, orderId);
  const posted = await entriesOf(client, c, order.id);
  const rows = posted.filter((entry) => entry.figures.receivable > ZERO).map((entry) => entryView(entry.row, entry.figures));
  return { orderId: order.id, orderNumber: order.mo_number, warehouseId: order.finished_goods_warehouse_id, total: q(rows.reduce((sum, row) => add(sum, D(row.receivable)), ZERO)), entries: rows };
}

// Can the next batch go ahead? The BOM's expectation for it, and the materials for everything reported so far plus it.
export async function checkBatchMaterialReadiness(client, c, orderId, input = {}) {
  needView(c);
  const order = await loadProductionOrder(client, c, orderId);
  const batch = (await outputQuantity(client, c, order, input.quantity, input.uomId)).base;
  const readiness = await materialReadiness(client, c, order, add(D(order.reported_quantity), batch), batch);
  const eligible = order.status === "IN_PROGRESS" || order.status === "RELEASED";
  return { orderId: order.id, orderNumber: order.mo_number, batchQuantity: q(batch), previewOnly: true, eligible, ...readiness,
    productionReady: eligible && readiness.ready, note: "A preview only: it reports what is issued or reserved now and records no production." };
}

// ------------------------------------------------------------------ one entry
export async function getProductionEntry(client, c, entryId) {
  needView(c);
  const entry = await loadEntry(client, c, entryId);
  const order = await loadProductionOrder(client, c, entry.manufacturing_order_id);
  const figures = entryFigures(entry, (await decisionsOf(client, c, [entry.id])).get(entry.id));
  const batch = entry.production_batch_id ? (await client.query(`SELECT batch.*, location.code AS location FROM tenant.manufacturing_production_batches batch
      LEFT JOIN tenant.warehouse_locations location ON location.id = batch.production_location_id WHERE batch.id = $1`, [entry.production_batch_id])).rows[0] : null;
  const location = entry.production_location_id ? (await client.query(`SELECT code, name FROM tenant.warehouse_locations WHERE id = $1`, [entry.production_location_id])).rows[0] : null;
  const uom = entry.output_uom_id ? (await client.query(`SELECT code FROM tenant.units_of_measure WHERE id = $1`, [entry.output_uom_id])).rows[0]?.code : null;
  const decisions = (await client.query(`SELECT * FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND production_entry_id = $2 ORDER BY decided_at`, [c.organizationId, entry.id])).rows;
  const receipts = (await client.query(`SELECT allocation.quantity, receipt.receipt_number, receipt.id, receipt.received_at, receipt.unit_cost, warehouse.code AS warehouse, batch.batch_number
      FROM tenant.manufacturing_goods_receipt_allocations allocation JOIN tenant.manufacturing_goods_receipts receipt ON receipt.id = allocation.goods_receipt_id
      JOIN tenant.warehouses warehouse ON warehouse.id = receipt.warehouse_id LEFT JOIN tenant.stock_batches batch ON batch.id = receipt.batch_id
     WHERE allocation.organization_id = $1 AND allocation.production_entry_id = $2 ORDER BY receipt.received_at`, [c.organizationId, entry.id])).rows;
  const corrections = (await client.query(`SELECT * FROM tenant.manufacturing_production_corrections WHERE organization_id = $1 AND production_entry_id = $2 ORDER BY corrected_at`, [c.organizationId, entry.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_production_entry_events WHERE organization_id = $1 AND production_entry_id = $2 ORDER BY occurred_at`, [c.organizationId, entry.id])).rows;
  const consumption = (await client.query(`SELECT id, consumption_number, status FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND (production_entry_id = $2 OR ($3::uuid IS NOT NULL AND production_batch_id = $3))
      ORDER BY created_at`, [c.organizationId, entry.id, entry.production_batch_id])).rows;
  const people = await names(client, [entry.recorded_by, entry.posted_by, entry.cancelled_by, ...decisions.map((row) => row.decided_by), ...corrections.map((row) => row.corrected_by), ...events.map((row) => row.actor_user_id)]);
  const expected = order.bom_revision_id && figures.reported > ZERO
    ? (await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(figures.reported), policy: "USE_STOCKED_SUBASSEMBLIES" })).consumed.map((row) => ({ code: row.code, expected: q(D(row.required)), uom: row.baseUom }))
    : [];
  const settings = await productionSettings(client, c);
  const live = order.status === "IN_PROGRESS";
  const finished = (await client.query(`SELECT code, name FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0];
  return {
    ...entryView({ ...entry, batch: batch?.batch_reference, uom_code: uom }, figures, people),
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, finishedItem: finished, planned: q(D(order.planned_base_quantity)) },
    batch: batch ? { id: batch.id, reference: batch.batch_reference, status: batch.status, planned: batch.planned_quantity === null ? null : q(D(batch.planned_quantity)), location: batch.location } : null,
    location, recordedBy: people.get(entry.recorded_by) ?? null, recordedAt: entry.recorded_at, cancelledBy: people.get(entry.cancelled_by) ?? null, cancelReason: entry.cancel_reason,
    split: { accepted: q(D(entry.accepted_quantity)), rejected: q(D(entry.rejected_quantity)), pending: q(D(entry.pending_quantity)) },
    expectedMaterials: expected,
    consumptionNotes: consumption.map((row) => ({ id: row.id, number: row.consumption_number, status: row.status })),
    decisions: decisions.map((row) => ({ id: row.id, accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)), reason: row.rejection_reason, reasonCode: row.reason_code,
      disposition: row.rejection_disposition ?? row.disposition, inspectionReference: row.inspection_reference, by: people.get(row.decided_by) ?? null, at: row.decided_at })),
    receipts: receipts.map((row) => ({ id: row.id, number: row.receipt_number, quantity: q(D(row.quantity)), warehouse: row.warehouse, batch: row.batch_number, at: row.received_at,
      unitCost: has(c, MO.costView) ? q(D(row.unit_cost)) : null })),
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, kind: row.kind, quantity: q(D(row.quantity)), reason: row.reason, evidence: row.evidence, by: people.get(row.corrected_by) ?? null, at: row.corrected_at })),
    history: events.map((row) => ({ action: row.action, summary: row.summary, actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    print: { count: entry.print_count, watermark: entry.status === "REPORTED" ? null : entry.status === "CANCELLED" ? "CANCELLED" : entry.status === "DRAFT" ? "DRAFT" : "RECOVERY" },
    can: {
      edit: entry.status === "DRAFT" && ["RELEASED", "IN_PROGRESS"].includes(order.status) && has(c, PRODUCTION.editDraft), cancel: entry.status === "DRAFT" && has(c, PRODUCTION.editDraft),
      post: entry.status === "DRAFT" && live && has(c, MO.record) && has(c, PRODUCTION.post),
      decideQuality: entry.status === "REPORTED" && figures.pending > ZERO && ["IN_PROGRESS", "ON_HOLD"].includes(order.status) && has(c, MO.quality) && (entry.posted_by !== c.userId || settings.selfApproval),
      receive: entry.status === "REPORTED" && figures.receivable > ZERO && live && has(c, MO.receive) && has(c, "stock.receive"),
      correct: entry.status === "REPORTED" && ["IN_PROGRESS", "ON_HOLD"].includes(order.status) && has(c, PRODUCTION.correct) && (figures.pending > ZERO || figures.receivable > ZERO),
      print: has(c, PRODUCTION.export),
    },
  };
}

// filters: { status, orderId, batchId, from, to, search, inspection (PENDING|...), receivable (true) }
export async function listProductionEntries(client, c, filters = {}) {
  needView(c);
  const values = [c.organizationId];
  const where = ["entry.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`entry.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.orderId) where.push(`entry.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.batchId) where.push(`entry.production_batch_id = ${bind(uuid(filters.batchId, "Batch"))}`);
  if (filters.from) where.push(`COALESCE(entry.produced_at, entry.recorded_at) >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(entry.produced_at, entry.recorded_at) < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(entry.entry_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(COALESCE(entry.batch_reference, '')) LIKE ${term} OR lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})`);
  }
  const rows = (await client.query(`SELECT entry.*, mo.mo_number, item.code AS item_code, item.name AS item_name, batch.batch_reference AS batch, uom.code AS uom_code
      FROM tenant.manufacturing_production_entries entry JOIN tenant.manufacturing_orders mo ON mo.id = entry.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
      LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id LEFT JOIN tenant.units_of_measure uom ON uom.id = entry.output_uom_id
     WHERE ${where.join(" AND ")} ORDER BY COALESCE(entry.posted_at, entry.recorded_at) DESC LIMIT 500`, values)).rows;
  const decided = await decisionsOf(client, c, rows.map((row) => row.id));
  const people = await names(client, rows.map((row) => row.posted_by ?? row.recorded_by));
  return rows.map((row) => ({ ...entryView(row, entryFigures(row, decided.get(row.id)), people), orderId: row.manufacturing_order_id, orderNumber: row.mo_number, product: `${row.item_code} · ${row.item_name}`,
    recordedBy: people.get(row.recorded_by) ?? null }))
    .filter((row) => (!filters.inspection || row.inspection === filters.inspection) && (!filters.receivable || D(row.receivable) > ZERO));
}

// The order's production history: entries, decisions, receipts, corrections, allowances and short-close, oldest first.
export async function getProductionHistory(client, c, orderId) {
  needView(c);
  const order = await loadProductionOrder(client, c, orderId);
  const rows = (await client.query(`SELECT event.*, actor.full_name AS actor FROM tenant.manufacturing_order_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.manufacturing_order_id = $2 AND event.action IN ('STARTED', 'PRODUCTION_BATCH_OPENED', 'PRODUCTION_BATCH_CLOSED', 'PRODUCTION_RECORDED', 'QUALITY_DECIDED',
        'GOODS_RECEIVED', 'PRODUCTION_CORRECTED', 'OVERPRODUCTION_REQUESTED', 'OVERPRODUCTION_APPROVED', 'OVERPRODUCTION_REJECTED', 'HELD', 'RESUMED', 'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSE_REJECTED',
        'COMPLETED', 'CLOSED_SHORT') ORDER BY event.occurred_at`, [c.organizationId, order.id])).rows;
  return rows.map((row) => ({ action: row.action, summary: row.summary, actor: row.actor, at: row.occurred_at }));
}

// ------------------------------------------------------------------ reports
// kind: summary | batches | planned-vs-accepted | yield | accepted-unreceived | receipts | material-per-batch | wip | cost | sales-linked | over-short |
// corrections | exceptions. filters: { from, to, orderId }
export async function getProductionReport(client, c, kind = "summary", filters = {}) {
  needView(c);
  const costView = has(c, MO.costView);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const orderWhere = ["mo.organization_id = $1"];
  if (filters.orderId) orderWhere.push(`mo.id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  const dated = (column) => [filters.from ? `${column} >= ${bind(String(filters.from))}::date` : null, filters.to ? `${column} < (${bind(String(filters.to))}::date + 1)` : null].filter(Boolean);
  const orders = async (extra = "") => (await client.query(`SELECT mo.*, item.code, item.name FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
      WHERE ${orderWhere.join(" AND ")} ${extra} ORDER BY mo.mo_number LIMIT 1000`, values)).rows;
  const orderRow = (row) => ({ orderId: row.id, orderNumber: row.mo_number, product: `${row.code} · ${row.name}`, status: STATUS_LABEL[row.status], planned: q(D(row.planned_base_quantity)),
    reported: q(D(row.reported_quantity)), accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)), pending: q(D(row.pending_inspection_quantity)), received: q(D(row.received_quantity)),
    acceptedNotReceived: q(sub(D(row.accepted_quantity), D(row.received_quantity))), remaining: q(max(sub(D(row.planned_base_quantity), D(row.accepted_quantity)), ZERO)),
    progressPct: percent(D(row.accepted_quantity), D(row.planned_base_quantity)), yieldPct: percent(D(row.accepted_quantity), add(D(row.accepted_quantity), D(row.rejected_quantity))) });
  if (kind === "summary") {
    const where = ["entry.organization_id = $1", "entry.status IN ('REPORTED', 'RECOVERY_REQUIRED')", ...dated("entry.produced_at")];
    if (filters.orderId) where.push(`entry.manufacturing_order_id = $2`);
    return (await client.query(`SELECT to_char(entry.produced_at, 'YYYY-MM-DD') AS day, mo.id, mo.mo_number, count(*)::int AS entries,
        sum(entry.reported_quantity - entry.corrected_pending_quantity - entry.corrected_accepted_quantity) AS reported FROM tenant.manufacturing_production_entries entry
        JOIN tenant.manufacturing_orders mo ON mo.id = entry.manufacturing_order_id WHERE ${where.join(" AND ")} GROUP BY 1, 2, 3 ORDER BY 1 DESC, 3`, values)).rows
      .map((row) => ({ day: row.day, orderId: row.id, orderNumber: row.mo_number, entries: row.entries, reported: q(D(row.reported)) }));
  }
  if (["planned-vs-accepted", "yield", "accepted-unreceived", "over-short"].includes(kind)) {
    const rows = (await orders(kind === "accepted-unreceived" ? "AND mo.accepted_quantity > mo.received_quantity" : kind === "over-short"
      ? "AND (mo.status = 'COMPLETED' AND mo.accepted_quantity <> mo.planned_base_quantity OR mo.overproduction_allowance_quantity > 0 OR mo.short_close_requested_at IS NOT NULL)" : "AND mo.reported_quantity > 0"))
      .map((row) => ({ ...orderRow(row), allowance: q(D(row.overproduction_allowance_quantity ?? 0)), shortClose: row.short_close_reason ?? row.short_close_request_reason ?? null,
        outcome: row.status === "COMPLETED" ? (D(row.accepted_quantity) < D(row.planned_base_quantity) ? "Short-closed" : D(row.accepted_quantity) > D(row.planned_base_quantity) ? "Over plan" : "Complete") : STATUS_LABEL[row.status] }));
    return rows;
  }
  if (kind === "batches" || kind === "material-per-batch") {
    const out = [];
    for (const order of await orders("AND mo.reported_quantity > 0")) {
      const progress = await getMoProductionProgress(client, c, order.id);
      for (const batch of progress.batches) {
        if (kind === "batches") out.push({ orderId: order.id, orderNumber: order.mo_number, ...batch, materials: undefined });
        else for (const material of batch.materials) out.push({ orderId: order.id, orderNumber: order.mo_number, batch: batch.reference, reported: batch.reported, ...material });
      }
    }
    return out;
  }
  if (kind === "receipts") {
    const where = ["receipt.organization_id = $1", ...dated("receipt.received_at")];
    if (filters.orderId) where.push(`receipt.manufacturing_order_id = $2`);
    const rows = (await client.query(`SELECT receipt.*, mo.mo_number, warehouse.code AS warehouse, batch.batch_number,
        (SELECT string_agg(entry.entry_number || ' ' || trim(trailing '.' FROM trim(trailing '0' FROM allocation.quantity::text)), ', ') FROM tenant.manufacturing_goods_receipt_allocations allocation
           JOIN tenant.manufacturing_production_entries entry ON entry.id = allocation.production_entry_id WHERE allocation.goods_receipt_id = receipt.id) AS sources
        FROM tenant.manufacturing_goods_receipts receipt JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id JOIN tenant.warehouses warehouse ON warehouse.id = receipt.warehouse_id
        LEFT JOIN tenant.stock_batches batch ON batch.id = receipt.batch_id WHERE ${where.join(" AND ")} ORDER BY receipt.received_at DESC LIMIT 1000`, values)).rows;
    return rows.map((row) => ({ receiptNumber: row.receipt_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, quantity: q(D(row.quantity)), warehouse: row.warehouse, batch: row.batch_number,
      sources: row.sources, at: row.received_at, unitCost: costView ? q(D(row.unit_cost)) : null, totalCost: costView ? money(D(row.total_cost)) : null }));
  }
  if (kind === "wip" || kind === "cost") {
    const rows = await orders(kind === "wip" ? "AND mo.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING')" : "AND mo.wip_material_cost > 0");
    return rows.map((row) => {
      const wip = wipBalance(row);
      const receivedQty = D(row.received_quantity);
      return { ...orderRow(row), materialInWip: costView ? money(D(row.wip_material_cost)) : null, capitalised: costView ? money(D(row.wip_capitalised_cost)) : null,
        varianceClosed: costView ? money(D(row.wip_variance_cost)) : null, remainingWip: costView ? money(wip) : null,
        receivedUnitCost: costView && receivedQty > ZERO ? q(D(row.wip_capitalised_cost) * 1_000_000n / receivedQty, 4) : null };
    });
  }
  if (kind === "sales-linked") {
    const rows = (await client.query(`SELECT allocation.*, mo.mo_number, mo.accepted_quantity AS mo_accepted, so.sales_order_number, version.customer_snapshot->>'displayName' AS customer, demand.required_date
        FROM tenant.manufacturing_demand_allocations allocation JOIN tenant.manufacturing_orders mo ON mo.id = allocation.manufacturing_order_id
        JOIN tenant.manufacturing_sales_demands demand ON demand.id = allocation.demand_id JOIN tenant.sales_orders so ON so.id = demand.sales_order_id
        LEFT JOIN tenant.sales_order_versions version ON version.id = so.current_version_id WHERE ${orderWhere.join(" AND ")} ORDER BY mo.mo_number`, values)).rows;
    return rows.map((row) => ({ orderId: row.manufacturing_order_id, orderNumber: row.mo_number, salesOrder: row.sales_order_number, customer: row.customer, requiredDate: row.required_date,
      assigned: q(D(row.allocated_quantity)), received: q(D(row.received_quantity)), reserved: q(D(row.reserved_quantity)), status: row.status }));
  }
  if (kind === "corrections") {
    const where = ["correction.organization_id = $1", ...dated("correction.corrected_at")];
    if (filters.orderId) where.push(`correction.manufacturing_order_id = $2`);
    const rows = (await client.query(`SELECT correction.*, entry.entry_number, mo.mo_number FROM tenant.manufacturing_production_corrections correction
        JOIN tenant.manufacturing_production_entries entry ON entry.id = correction.production_entry_id JOIN tenant.manufacturing_orders mo ON mo.id = correction.manufacturing_order_id
       WHERE ${where.join(" AND ")} ORDER BY correction.corrected_at DESC`, values)).rows;
    const people = await names(client, rows.map((row) => row.corrected_by));
    return rows.map((row) => ({ number: row.correction_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, entryNumber: row.entry_number, kind: row.kind, quantity: q(D(row.quantity)),
      reason: row.reason, by: people.get(row.corrected_by) ?? null, at: row.corrected_at }));
  }
  if (kind === "exceptions") {
    const out = [];
    for (const order of await orders("AND mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING', 'RECOVERY_REQUIRED')")) {
      const progress = await getMoProductionProgress(client, c, order.id);
      if (!progress.reconciled) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: "The order's output counters disagree with its posted entries." });
      if (progress.drafts.length) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: `${progress.drafts.length} production entr${progress.drafts.length === 1 ? "y is" : "ies are"} still a draft.` });
      if (D(progress.quantities.pending) > ZERO) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: `${progress.quantities.pending} output awaits a quality decision.` });
      if (D(progress.quantities.acceptedNotReceived) > ZERO) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: `${progress.quantities.acceptedNotReceived} accepted output is not in stock.` });
      for (const row of progress.overproduction.filter((request) => request.status === "REQUESTED")) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: `Overproduction +${row.quantity} awaits a decision.` });
      if (progress.shortClose?.pending) out.push({ orderId: order.id, orderNumber: order.mo_number, problem: "A short close awaits approval." });
    }
    return out;
  }
  throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "Unknown report.");
}

export { PRODUCTION };
