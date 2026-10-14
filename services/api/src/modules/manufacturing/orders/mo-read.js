// Manufacturing Orders — reading: the list, one order with everything a manager needs on one screen (materials with their Inventory
// figures, production and quality, receipts, costs, linked orders and demand, history, and what the person may do), costs, history,
// the production summary report, the activity inquiry and the export. Nothing here changes anything.
import {
  D, EXECUTING, LIVE, MO, STATUS_LABEL, ZERO, add, div, freeStock, has, lineFigures, loadMaterials, loadOrder, max, money, mul, needMo, q, reservedByItem, reservedPerLine, settingsOf, sub,
  text, unitMaterialCost, uuid, wipBalance,
} from "./mo-core.js";

const isoOrNull = (value) => (value ? new Date(value).toISOString() : null);
const pct = (part, whole) => (whole > ZERO ? q(div(mul(part, 100n * 1_000_000n), whole), 2) : null);

// filters: { status?, search?, itemId?, priority?, from?, to?, parentOrderId? }
export async function listManufacturingOrders(client, c, filters = {}) {
  needMo(c, MO.view);
  const values = [c.organizationId];
  const where = [];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status && filters.status !== "all") {
    if (filters.status === "OPEN") where.push(`mo.status NOT IN ('COMPLETED', 'CANCELLED')`);
    else where.push(`mo.status = ${bind(text(filters.status, 40))}`);
  }
  if (filters.search) where.push(`(mo.mo_number ILIKE ${bind(`%${text(filters.search, 100)}%`)} OR item.code ILIKE $${values.length} OR item.name ILIKE $${values.length} OR mo.source_reference ILIKE $${values.length})`);
  if (filters.itemId) where.push(`mo.finished_item_id = ${bind(uuid(filters.itemId, "Product"))}`);
  if (filters.priority) where.push(`mo.priority = ${bind(text(filters.priority, 10))}`);
  if (filters.from) where.push(`mo.planned_start_at >= ${bind(String(filters.from))}::timestamptz`);
  if (filters.to) where.push(`mo.planned_start_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.parentOrderId) where.push(`mo.parent_order_id = ${bind(uuid(filters.parentOrderId, "Order"))}`);
  const rows = (await client.query(
    `SELECT mo.*, item.code AS item_code, item.name AS item_name, uom.code AS base_uom, master.bom_number, revision.revision_number, owner.full_name AS owner_name,
            material_wh.code AS material_wh, fg_wh.code AS fg_wh
       FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
       LEFT JOIN tenant.manufacturing_bom_masters master ON master.id = mo.bom_id LEFT JOIN tenant.manufacturing_bom_revisions revision ON revision.id = mo.bom_revision_id
       LEFT JOIN public.users owner ON owner.id = mo.production_owner_id JOIN tenant.warehouses material_wh ON material_wh.id = mo.material_warehouse_id
       JOIN tenant.warehouses fg_wh ON fg_wh.id = mo.finished_goods_warehouse_id
      WHERE mo.organization_id = $1${where.length ? ` AND ${where.join(" AND ")}` : ""}
      ORDER BY CASE WHEN mo.status IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END, mo.planned_start_at DESC, mo.created_at DESC LIMIT 500`, values)).rows;
  return rows.map((row) => ({
    id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], priority: row.priority,
    finishedItem: { id: row.finished_item_id, code: row.item_code, name: row.item_name }, baseUom: row.base_uom,
    planned: q(D(row.planned_base_quantity)), accepted: q(D(row.accepted_quantity)), received: q(D(row.received_quantity)), rejected: q(D(row.rejected_quantity)),
    pendingInspection: q(D(row.pending_inspection_quantity)), progressPct: pct(D(row.accepted_quantity), D(row.planned_base_quantity)),
    bom: row.bom_number ? `${row.bom_number} rev ${row.revision_number}` : null, plannedStartAt: row.planned_start_at, plannedEndAt: row.planned_end_at, owner: row.owner_name,
    source: row.source_reference, sourceType: row.source_demand_type, materialWarehouse: row.material_wh, finishedGoodsWarehouse: row.fg_wh, parentOrderId: row.parent_order_id,
    overdue: !["COMPLETED", "CANCELLED"].includes(row.status) && new Date(row.planned_end_at) < new Date(), updatedAt: row.updated_at,
  }));
}

// Material lines with Inventory's figures: required, reserved, issued, returned, consumed, to issue, free stock, shortage.
export async function materialView(client, c, order, materials = null) {
  const lines = materials ?? await loadMaterials(client, c, order.id);
  const reserved = reservedPerLine(lines, await reservedByItem(client, c, order));
  const free = new Map();
  for (const itemId of new Set(lines.map((line) => line.component_item_id))) free.set(itemId, await freeStock(client, c, itemId, order.material_warehouse_id));
  const freeLeft = new Map(free);
  const demands = (await client.query(
    `SELECT item_id, demand_number, status, quantity FROM tenant.manufacturing_material_demands WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    [c.organizationId, order.id])).rows;
  return lines.map((line) => {
    const figures = lineFigures(line);
    const held = reserved.get(line.id) ?? ZERO;
    const open = max(sub(figures.toIssue, held), ZERO);
    const available = freeLeft.get(line.component_item_id) ?? ZERO;
    const cover = available < open ? available : open;
    freeLeft.set(line.component_item_id, sub(available, cover));
    const shortage = sub(open, cover);
    const issued = D(line.issued_quantity);
    return {
      id: line.id, lineNumber: line.line_number, origin: line.origin, kind: line.kind, itemId: line.component_item_id, code: line.item_code, name: line.item_name, trackingType: line.tracking_type,
      uomId: line.uom_id, uom: line.uom_code, lineageId: line.lineage_id, bomLineId: line.bom_line_id,
      planned: q(D(line.planned_quantity)), extra: q(D(line.authorized_extra_quantity)), required: q(figures.required), reserved: q(held), issued: q(issued), returned: q(D(line.returned_quantity)),
      netIssued: q(figures.netIssued), consumed: q(figures.consumed), scrapped: q(figures.scrapped), reversed: q(D(line.reversed_quantity ?? 0)), inCustody: q(figures.custody),
      remainingToIssue: q(figures.toIssue), availableToReserve: q(available), shortage: q(shortage),
      issuedCost: money(D(line.issued_cost)), returnedCost: money(D(line.returned_cost)), averageIssueCost: issued > ZERO ? q(div(D(line.issued_cost), issued)) : null,
      estimatedUnitCost: line.estimated_unit_cost === null ? null : q(D(line.estimated_unit_cost)), estimatedCost: line.estimated_cost === null ? null : money(D(line.estimated_cost)),
      openDemand: demands.filter((row) => row.item_id === line.component_item_id).map((row) => ({ number: row.demand_number, status: row.status, quantity: q(D(row.quantity)) })),
      readiness: figures.toIssue === ZERO ? "ISSUED" : open === ZERO ? "RESERVED" : held > ZERO || figures.netIssued > ZERO ? "PARTIAL" : "NONE",
    };
  });
}

export function readinessOf(materials) {
  if (!materials.length) return "NO_MATERIALS";
  if (materials.every((row) => ["ISSUED", "RESERVED"].includes(row.readiness))) return "READY";
  return materials.some((row) => row.readiness !== "NONE") ? "PARTIAL" : "NOT_READY";
}

// The order's costs: estimate, actual issued (net of returns), capitalised to finished goods, work in progress left, variance; per material
// the planned against actual quantity and cost.
export function costView(order, materials) {
  const plannedOutput = D(order.planned_base_quantity);
  const accepted = D(order.accepted_quantity);
  const rows = materials.map((line) => {
    const netCost = sub(D(line.issued_cost), D(line.returned_cost));
    const standardForOutput = div(mul(D(line.planned_quantity), accepted), plannedOutput);
    return { id: line.id, code: line.item_code, name: line.item_name, uom: line.uom_code, origin: line.origin, planned: q(D(line.planned_quantity)), extra: q(D(line.authorized_extra_quantity)),
      netIssued: q(lineFigures(line).netIssued), consumed: q(lineFigures(line).consumed), standardForAccepted: q(standardForOutput),
      usageVariance: q(sub(lineFigures(line).consumed, standardForOutput)), estimatedCost: line.estimated_cost === null ? null : money(D(line.estimated_cost)), actualCost: money(netCost),
      costVariance: line.estimated_cost === null ? null : money(sub(netCost, D(line.estimated_cost))) };
  });
  const actual = D(order.wip_material_cost);
  const unit = unitMaterialCost(order, materials);
  const missing = materials.filter((line) => line.estimated_cost === null && line.origin === "RECIPE").map((line) => line.item_code);
  return {
    currency: "INR", estimatedMaterialCost: order.estimated_material_cost === null ? null : money(D(order.estimated_material_cost)), estimateComplete: missing.length === 0, estimateMissing: missing,
    actualMaterialCost: money(actual), materialCostVariance: order.estimated_material_cost === null ? null : money(sub(actual, D(order.estimated_material_cost))),
    capitalisedToFinishedGoods: money(D(order.wip_capitalised_cost)), varianceClosed: money(D(order.wip_variance_cost)), workInProgress: money(wipBalance(order)),
    currentUnitMaterialCost: unit.unitCost === null ? null : q(unit.unitCost), unitCostBasis: unit.basis, unitCostMissing: unit.missing,
    lines: rows, note: "Material cost only: labour and overhead are not measured on manufacturing orders yet, so they are not included (and not counted as zero).",
  };
}

export async function getManufacturingOrder(client, c, id) {
  needMo(c, MO.view);
  const order = await loadOrder(client, c, id);
  const header = (await client.query(
    `SELECT item.code, item.name, item.tracking_type, uom.code AS base_uom, out_uom.code AS output_uom, master.bom_number, revision.revision_number, revision.status AS revision_status,
            snapshot.content_hash AS snapshot_hash, snapshot.created_at AS snapshot_at, mwh.code AS mwh, mwh.name AS mwh_name, matwh.code AS matwh, matwh.name AS matwh_name,
            fgwh.code AS fgwh, fgwh.name AS fgwh_name, owner.full_name AS owner, creator.full_name AS creator, submitter.full_name AS submitter, approver.full_name AS approver,
            releaser.full_name AS releaser, starter.full_name AS starter, completer.full_name AS completer, canceller.full_name AS canceller, parent.mo_number AS parent_number
       FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
       JOIN tenant.units_of_measure out_uom ON out_uom.id = mo.output_uom_id
       LEFT JOIN tenant.manufacturing_bom_masters master ON master.id = mo.bom_id LEFT JOIN tenant.manufacturing_bom_revisions revision ON revision.id = mo.bom_revision_id
       LEFT JOIN tenant.manufacturing_bom_snapshots snapshot ON snapshot.id = mo.bom_snapshot_id
       JOIN tenant.warehouses mwh ON mwh.id = mo.manufacturing_warehouse_id JOIN tenant.warehouses matwh ON matwh.id = mo.material_warehouse_id JOIN tenant.warehouses fgwh ON fgwh.id = mo.finished_goods_warehouse_id
       LEFT JOIN public.users owner ON owner.id = mo.production_owner_id LEFT JOIN public.users creator ON creator.id = mo.created_by LEFT JOIN public.users submitter ON submitter.id = mo.submitted_by
       LEFT JOIN public.users approver ON approver.id = mo.approved_by LEFT JOIN public.users releaser ON releaser.id = mo.released_by LEFT JOIN public.users starter ON starter.id = mo.started_by
       LEFT JOIN public.users completer ON completer.id = mo.completed_by LEFT JOIN public.users canceller ON canceller.id = mo.cancelled_by
       LEFT JOIN tenant.manufacturing_orders parent ON parent.id = mo.parent_order_id
      WHERE mo.organization_id = $1 AND mo.id = $2`, [c.organizationId, order.id])).rows[0];
  const lines = await loadMaterials(client, c, order.id);
  const materials = await materialView(client, c, order, lines);
  const settings = await settingsOf(client, c);
  const [movements, consumption, variances, entries, decisions, receipts, exceptions, children, history] = await Promise.all([
    client.query(`SELECT movement.*, item.code AS item_code, actor.full_name AS actor FROM tenant.manufacturing_order_material_movements movement JOIN tenant.items item ON item.id = movement.item_id
       LEFT JOIN public.users actor ON actor.id = movement.posted_by WHERE movement.organization_id = $1 AND movement.manufacturing_order_id = $2 ORDER BY movement.posted_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT consumption.*, material.line_number, item.code AS item_code, actor.full_name AS actor FROM tenant.manufacturing_order_consumption consumption
       JOIN tenant.manufacturing_order_materials material ON material.id = consumption.material_id JOIN tenant.items item ON item.id = material.component_item_id
       LEFT JOIN public.users actor ON actor.id = consumption.recorded_by WHERE consumption.organization_id = $1 AND consumption.manufacturing_order_id = $2 ORDER BY consumption.recorded_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT variance.*, item.code AS item_code, item.name AS item_name, requester.full_name AS requester, decider.full_name AS decider FROM tenant.manufacturing_order_material_variances variance
       JOIN tenant.items item ON item.id = variance.component_item_id LEFT JOIN public.users requester ON requester.id = variance.requested_by LEFT JOIN public.users decider ON decider.id = variance.decided_by
       WHERE variance.organization_id = $1 AND variance.manufacturing_order_id = $2 ORDER BY variance.requested_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT entry.*, actor.full_name AS actor FROM tenant.manufacturing_production_entries entry LEFT JOIN public.users actor ON actor.id = entry.recorded_by
       WHERE entry.organization_id = $1 AND entry.manufacturing_order_id = $2 AND entry.status IN ('REPORTED', 'RECOVERY_REQUIRED') ORDER BY entry.recorded_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT decision.*, entry.entry_number, actor.full_name AS actor FROM tenant.manufacturing_quality_decisions decision JOIN tenant.manufacturing_production_entries entry ON entry.id = decision.production_entry_id
       LEFT JOIN public.users actor ON actor.id = decision.decided_by WHERE decision.organization_id = $1 AND decision.manufacturing_order_id = $2 ORDER BY decision.decided_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT receipt.*, warehouse.code AS warehouse_code, batch.batch_number, actor.full_name AS actor FROM tenant.manufacturing_goods_receipts receipt JOIN tenant.warehouses warehouse ON warehouse.id = receipt.warehouse_id
       LEFT JOIN tenant.stock_batches batch ON batch.id = receipt.batch_id LEFT JOIN public.users actor ON actor.id = receipt.received_by
       WHERE receipt.organization_id = $1 AND receipt.manufacturing_order_id = $2 ORDER BY receipt.received_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT exception.*, raiser.full_name AS raiser, resolver.full_name AS resolver FROM tenant.manufacturing_order_exceptions exception LEFT JOIN public.users raiser ON raiser.id = exception.raised_by
       LEFT JOIN public.users resolver ON resolver.id = exception.resolved_by WHERE exception.organization_id = $1 AND exception.manufacturing_order_id = $2 ORDER BY exception.raised_at DESC`, [c.organizationId, order.id]),
    client.query(`SELECT child.id, child.mo_number, child.status, child.planned_base_quantity, child.received_quantity, item.code FROM tenant.manufacturing_orders child JOIN tenant.items item ON item.id = child.finished_item_id
       WHERE child.organization_id = $1 AND child.parent_order_id = $2 ORDER BY child.created_at`, [c.organizationId, order.id]),
    client.query(`SELECT event.*, actor.full_name AS actor FROM tenant.manufacturing_order_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
       WHERE event.organization_id = $1 AND event.manufacturing_order_id = $2 ORDER BY event.occurred_at DESC LIMIT 300`, [c.organizationId, order.id]),
  ]).then((results) => results.map((result) => result.rows));
  // The customer demand this order supplies (Sales Order lines it is assigned to).
  const demand = (await client.query(
    `SELECT allocation.id, allocation.status, allocation.allocated_quantity, allocation.received_quantity, allocation.reserved_quantity, demand.id AS demand_id, sales_order.id AS sales_order_id,
            sales_order.sales_order_number, version.customer_snapshot->>'displayName' AS customer, demand.required_date
       FROM tenant.manufacturing_demand_allocations allocation JOIN tenant.manufacturing_sales_demands demand ON demand.id = allocation.demand_id
       JOIN tenant.sales_orders sales_order ON sales_order.id = demand.sales_order_id LEFT JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE allocation.organization_id = $1 AND allocation.manufacturing_order_id = $2 ORDER BY allocation.created_at`, [c.organizationId, order.id])).rows;
  const planned = D(order.planned_base_quantity);
  const accepted = D(order.accepted_quantity);
  const tolerance = settings.tolerancePct;
  const s = order.status;
  const openVariances = variances.filter((row) => row.status === "REQUESTED").length;
  const openExceptions = exceptions.filter((row) => row.status === "OPEN").length;
  const custody = materials.reduce((sum, row) => add(sum, D(row.inCustody)), ZERO);
  const unreceived = sub(accepted, D(order.received_quantity));
  const readiness = readinessOf(materials);
  const can = {
    edit: s === "DRAFT" && has(c, MO.editDraft), submit: s === "DRAFT" && has(c, MO.submit), returnToDraft: s === "AWAITING_APPROVAL" && has(c, MO.approve),
    approve: s === "AWAITING_APPROVAL" && !order.approved_at && has(c, MO.approve) && (order.submitted_by !== c.userId || settings.selfApproval),
    release: s === "AWAITING_APPROVAL" && Boolean(order.approved_at) && has(c, MO.release),
    reserve: EXECUTING.has(s) && has(c, MO.reserve), issue: EXECUTING.has(s) && has(c, MO.issue), return: LIVE.has(s) && has(c, MO.return) && custody > ZERO,
    consume: s === "IN_PROGRESS" && has(c, MO.record), requestExtra: EXECUTING.has(s) && has(c, MO.extra), decideVariance: openVariances > 0 && has(c, MO.approveVariance),
    start: s === "RELEASED" && has(c, MO.start), record: s === "IN_PROGRESS" && has(c, MO.record), decideQuality: s === "IN_PROGRESS" && D(order.pending_inspection_quantity) > ZERO && has(c, MO.quality),
    receive: s === "IN_PROGRESS" && unreceived > ZERO && has(c, MO.receive), hold: EXECUTING.has(s) && has(c, MO.hold), resume: s === "ON_HOLD" && has(c, MO.hold),
    complete: s === "IN_PROGRESS" && has(c, MO.complete), cancel: ["DRAFT", "AWAITING_APPROVAL", "RELEASED", "IN_PROGRESS", "ON_HOLD"].includes(s) && has(c, MO.cancel),
    handOffShortages: LIVE.has(s) && has(c, MO.reserve), createSubassemblyOrder: LIVE.has(s) && has(c, MO.create), raiseException: LIVE.has(s) && has(c, MO.hold),
    viewCost: has(c, MO.costView), export: has(c, MO.export),
  };
  const outputLimit = add(add(planned, div(mul(planned, tolerance), 100n * 1_000_000n)), D(order.overproduction_allowance_quantity ?? 0));
  // The order's material issue notes (Material Issue), newest first; and its scrap of issued material.
  const issueNotes = (await client.query(
    `SELECT issue.id, issue.issue_number, issue.status, issue.approval_status, issue.posted_at, issue.created_at, issue.total_cost, poster.full_name AS poster,
            (SELECT count(*)::int FROM tenant.manufacturing_material_issue_lines line WHERE line.material_issue_id = issue.id) AS line_count
       FROM tenant.manufacturing_material_issues issue LEFT JOIN public.users poster ON poster.id = issue.posted_by
      WHERE issue.organization_id = $1 AND issue.manufacturing_order_id = $2 ORDER BY issue.created_at DESC`, [c.organizationId, order.id])).rows;
  const scrap = (await client.query(
    `SELECT scrap.*, item.code AS item_code, actor.full_name AS actor FROM tenant.manufacturing_material_scrap scrap JOIN tenant.manufacturing_order_materials material ON material.id = scrap.material_id
       JOIN tenant.items item ON item.id = material.component_item_id LEFT JOIN public.users actor ON actor.id = scrap.recorded_by
      WHERE scrap.organization_id = $1 AND scrap.manufacturing_order_id = $2 ORDER BY scrap.recorded_at DESC`, [c.organizationId, order.id])).rows;
  can.scrap = LIVE.has(s) && has(c, "manufacturing.issue.scrap") && custody > ZERO;
  can.viewIssues = has(c, "manufacturing.issue.view") || has(c, MO.issue);
  can.recordConsumption = s === "IN_PROGRESS" && has(c, "manufacturing.consumption.create") && custody > ZERO;
  can.viewConsumption = has(c, "manufacturing.consumption.view") || has(c, "manufacturing.consumption.create");
  const consumptionNotes = (await client.query(
    `SELECT note.id, note.consumption_number, note.status, note.kind, note.approval_status, note.posted_at, note.created_at, note.total_cost, note.production_batch_reference, poster.full_name AS poster,
            (SELECT count(*)::int FROM tenant.manufacturing_material_consumption_lines line WHERE line.consumption_id = note.id) AS line_count
       FROM tenant.manufacturing_material_consumptions note LEFT JOIN public.users poster ON poster.id = note.posted_by
      WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 ORDER BY note.created_at DESC`, [c.organizationId, order.id])).rows;
  return {
    id: order.id, number: order.mo_number, status: s, statusLabel: STATUS_LABEL[s], heldFromStatus: order.held_from_status, priority: order.priority, version: order.version,
    finishedItem: { id: order.finished_item_id, code: header.code, name: header.name, trackingType: header.tracking_type, baseUom: header.base_uom },
    plannedQuantity: q(D(order.planned_quantity)), outputUom: header.output_uom, outputUomId: order.output_uom_id, plannedBaseQuantity: q(planned),
    bom: order.bom_id ? { id: order.bom_id, number: header.bom_number, revisionId: order.bom_revision_id, revisionNumber: header.revision_number, revisionStatus: header.revision_status,
      snapshotId: order.bom_snapshot_id, snapshotHash: header.snapshot_hash, frozenAt: header.snapshot_at } : null,
    warehouses: { manufacturing: { id: order.manufacturing_warehouse_id, code: header.mwh, name: header.mwh_name }, material: { id: order.material_warehouse_id, code: header.matwh, name: header.matwh_name },
      finishedGoods: { id: order.finished_goods_warehouse_id, code: header.fgwh, name: header.fgwh_name } },
    plannedStartAt: order.planned_start_at, plannedEndAt: order.planned_end_at, actualStartAt: order.actual_start_at, completedAt: order.completed_at,
    source: { type: order.source_demand_type, id: order.source_demand_id, reference: order.source_reference }, parent: order.parent_order_id ? { id: order.parent_order_id, number: header.parent_number } : null,
    owner: header.owner, ownerId: order.production_owner_id, notes: order.notes,
    people: { createdBy: header.creator, createdAt: order.created_at, submittedBy: header.submitter, submittedAt: order.submitted_at, approvedBy: header.approver, approvedAt: order.approved_at,
      approvalNote: order.approval_note, releasedBy: header.releaser, releasedAt: order.released_at, startedBy: header.starter, completedBy: header.completer, cancelledBy: header.canceller,
      cancelledAt: order.cancelled_at },
    reasons: { returned: order.returned_reason, partialStart: order.partial_start_reason, hold: order.hold_reason, holdCategory: order.hold_category, shortClose: order.short_close_reason, cancel: order.cancel_reason },
    quantities: { planned: q(planned), reported: q(D(order.reported_quantity)), accepted: q(accepted), rejected: q(D(order.rejected_quantity)), pendingInspection: q(D(order.pending_inspection_quantity)),
      received: q(D(order.received_quantity)), acceptedNotReceived: q(unreceived), remaining: q(max(sub(planned, accepted), ZERO)), outputLimit: q(outputLimit),
      progressPct: pct(accepted, planned), yieldPct: pct(accepted, D(order.reported_quantity)) },
    progress: { materials: readiness, issue: materials.every((row) => row.remainingToIssue === "0") ? "ISSUED" : materials.some((row) => row.netIssued !== "0") ? "PARTIAL" : "NONE",
      quality: D(order.pending_inspection_quantity) > ZERO ? "PENDING" : D(order.reported_quantity) > ZERO ? "DECIDED" : "NONE",
      receipt: unreceived > ZERO ? "PENDING" : D(order.received_quantity) > ZERO ? "RECEIVED" : "NONE", finance: s === "COMPLETED" ? "CLOSED" : wipBalance(order) !== ZERO ? "WIP_OPEN" : "NONE",
      openVariances, openExceptions },
    materials,
    movements: movements.map((row) => ({ id: row.id, number: row.movement_number, direction: row.direction, materialId: row.material_id, code: row.item_code, quantity: q(D(row.quantity)),
      unitCost: has(c, MO.costView) ? q(D(row.unit_cost)) : null, totalCost: has(c, MO.costView) ? money(D(row.total_cost)) : null, allocations: row.allocations, reason: row.reason,
      stockMovementIds: row.stock_movement_ids, journalEntryId: row.journal_entry_id, actor: row.actor, at: row.posted_at })),
    issues: issueNotes.map((row) => ({ id: row.id, number: row.issue_number, status: row.status, approvalStatus: row.approval_status, lines: row.line_count, postedAt: row.posted_at,
      createdAt: row.created_at, postedBy: row.poster, totalCost: has(c, MO.costView) && row.total_cost !== null ? money(D(row.total_cost)) : null })),
    consumptionNotes: consumptionNotes.map((row) => ({ id: row.id, number: row.consumption_number, status: row.status, kind: row.kind, approvalStatus: row.approval_status, lines: row.line_count,
      batchReference: row.production_batch_reference, postedAt: row.posted_at, createdAt: row.created_at, postedBy: row.poster,
      totalCost: has(c, MO.costView) && row.total_cost !== null ? money(D(row.total_cost)) : null })),
    scrap: scrap.map((row) => ({ id: row.id, materialId: row.material_id, code: row.item_code, quantity: q(D(row.quantity)), reason: row.reason, actor: row.actor, at: row.recorded_at })),
    consumption: consumption.map((row) => ({ id: row.id, materialId: row.material_id, code: row.item_code, quantity: q(D(row.quantity)), note: row.note, automatic: row.automatic, actor: row.actor, at: row.recorded_at })),
    variances: variances.map((row) => ({ id: row.id, materialId: row.material_id, code: row.item_code, name: row.item_name, quantity: q(D(row.quantity)), reason: row.reason, status: row.status,
      requestedBy: row.requester, requestedAt: row.requested_at, decidedBy: row.decider, decidedAt: row.decided_at, note: row.decision_note,
      mayDecide: row.status === "REQUESTED" && has(c, MO.approveVariance) && (row.requested_by !== c.userId || settings.varianceSelfApproval) })),
    production: entries.map((row) => ({ id: row.id, number: row.entry_number, batchReference: row.batch_reference, reported: q(D(row.reported_quantity)), accepted: q(D(row.accepted_quantity)),
      rejected: q(D(row.rejected_quantity)), pending: q(D(row.pending_quantity)), pendingRemaining: q(D(row.pending_remaining)), rejectionReason: row.rejection_reason, notes: row.notes,
      actor: row.actor, at: row.recorded_at })),
    qualityDecisions: decisions.map((row) => ({ id: row.id, entryId: row.production_entry_id, entryNumber: row.entry_number, accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)),
      reason: row.rejection_reason, disposition: row.disposition, inspectionReference: row.inspection_reference, actor: row.actor, at: row.decided_at })),
    receipts: receipts.map((row) => ({ id: row.id, number: row.receipt_number, quantity: q(D(row.quantity)), warehouse: row.warehouse_code, batch: row.batch_number, serialNumbers: row.serial_numbers ?? [],
      unitCost: has(c, MO.costView) ? q(D(row.unit_cost)) : null, totalCost: has(c, MO.costView) ? money(D(row.total_cost)) : null, costBasis: has(c, MO.costView) ? row.cost_basis : null,
      stockMovementIds: row.stock_movement_ids, journalEntryId: row.journal_entry_id, actor: row.actor, at: row.received_at })),
    exceptions: exceptions.map((row) => ({ id: row.id, category: row.category, reason: row.reason, status: row.status, quantity: row.quantity === null ? null : q(D(row.quantity)),
      raisedBy: row.raiser, raisedAt: row.raised_at, resolvedBy: row.resolver, resolvedAt: row.resolved_at, resolution: row.resolution })),
    customerDemand: demand.map((row) => ({ allocationId: row.id, demandId: row.demand_id, status: row.status, salesOrderId: row.sales_order_id, salesOrder: row.sales_order_number, customer: row.customer,
      requiredDate: row.required_date, assigned: q(D(row.allocated_quantity)), received: q(D(row.received_quantity)), reserved: q(D(row.reserved_quantity)) })),
    children: children.map((row) => ({ id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], item: row.code, planned: q(D(row.planned_base_quantity)), received: q(D(row.received_quantity)) })),
    costs: has(c, MO.costView) ? costView(order, lines) : null,
    settings: { requireInspection: settings.requireInspection, overproductionTolerancePct: q(tolerance) },
    history: history.map((row) => ({ action: row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary, details: row.details, actor: row.actor, at: row.occurred_at })),
    can,
  };
}

export async function getManufacturingOrderHistory(client, c, id) {
  return (await getManufacturingOrder(client, c, id)).history;
}
export async function getManufacturingOrderCosts(client, c, id) {
  needMo(c, MO.costView);
  const order = await loadOrder(client, c, id);
  return costView(order, await loadMaterials(client, c, order.id));
}

// Production summary and variance: one row per order in the period (planned start), with totals.
export async function getProductionSummary(client, c, filters = {}) {
  needMo(c, MO.view);
  const seeCost = has(c, MO.costView);
  const values = [c.organizationId];
  const where = [`mo.status <> 'CANCELLED'`];
  if (filters.from) { values.push(String(filters.from)); where.push(`mo.planned_start_at >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to)); where.push(`mo.planned_start_at < ($${values.length}::date + 1)`); }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 40)); where.push(`mo.status = $${values.length}`); }
  const rows = (await client.query(
    `SELECT mo.*, item.code AS item_code, item.name AS item_name, uom.code AS base_uom FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE mo.organization_id = $1 AND ${where.join(" AND ")} ORDER BY mo.planned_start_at DESC LIMIT 1000`, values)).rows;
  let totals = { planned: ZERO, accepted: ZERO, rejected: ZERO, received: ZERO, estimated: ZERO, actual: ZERO, variance: ZERO };
  const list = rows.map((row) => {
    const estimated = row.estimated_material_cost === null ? null : D(row.estimated_material_cost);
    totals = { planned: add(totals.planned, D(row.planned_base_quantity)), accepted: add(totals.accepted, D(row.accepted_quantity)), rejected: add(totals.rejected, D(row.rejected_quantity)),
      received: add(totals.received, D(row.received_quantity)), estimated: add(totals.estimated, estimated ?? ZERO), actual: add(totals.actual, D(row.wip_material_cost)),
      variance: add(totals.variance, D(row.wip_variance_cost)) };
    return { id: row.id, number: row.mo_number, status: row.status, statusLabel: STATUS_LABEL[row.status], item: `${row.item_code} · ${row.item_name}`, uom: row.base_uom,
      plannedStartAt: row.planned_start_at, completedAt: row.completed_at, planned: q(D(row.planned_base_quantity)), accepted: q(D(row.accepted_quantity)), rejected: q(D(row.rejected_quantity)),
      received: q(D(row.received_quantity)), yieldPct: pct(D(row.accepted_quantity), D(row.reported_quantity)), completionPct: pct(D(row.accepted_quantity), D(row.planned_base_quantity)),
      shortClosed: Boolean(row.short_close_reason),
      ...(seeCost ? { estimatedCost: estimated === null ? null : money(estimated), actualCost: money(D(row.wip_material_cost)), costVariance: estimated === null ? null : money(sub(D(row.wip_material_cost), estimated)),
        varianceClosed: money(D(row.wip_variance_cost)), capitalised: money(D(row.wip_capitalised_cost)) } : {}) };
  });
  return { rows: list, totals: { orders: list.length, planned: q(totals.planned), accepted: q(totals.accepted), rejected: q(totals.rejected), received: q(totals.received),
    yieldPct: pct(totals.accepted, add(totals.accepted, totals.rejected)),
    ...(seeCost ? { estimatedCost: money(totals.estimated), actualCost: money(totals.actual), varianceClosed: money(totals.variance) } : {}) }, costVisible: seeCost };
}

// Production activity across orders: material issues and returns, production entries, quality decisions and finished-goods receipts.
export async function listProductionActivity(client, c, filters = {}) {
  needMo(c, MO.view);
  const kind = text(filters.kind, 20) || "all";
  const limit = 300;
  const parts = [];
  if (["all", "materials"].includes(kind)) parts.push(`SELECT movement.id, CASE movement.direction WHEN 'ISSUE' THEN 'Material issue' ELSE 'Material return' END AS kind, movement.movement_number AS number,
      mo.id AS order_id, mo.mo_number, item.code AS item, movement.quantity, movement.posted_at AS at, actor.full_name AS actor, movement.reason AS note
      FROM tenant.manufacturing_order_material_movements movement JOIN tenant.manufacturing_orders mo ON mo.id = movement.manufacturing_order_id JOIN tenant.items item ON item.id = movement.item_id
      LEFT JOIN public.users actor ON actor.id = movement.posted_by WHERE movement.organization_id = $1`);
  if (["all", "production"].includes(kind)) parts.push(`SELECT entry.id, 'Production entry', entry.entry_number, mo.id, mo.mo_number, item.code, entry.reported_quantity, entry.recorded_at, actor.full_name,
      concat_ws(' · ', 'accepted ' || trim_scale(entry.accepted_quantity), 'rejected ' || trim_scale(entry.rejected_quantity), 'awaiting inspection ' || trim_scale(entry.pending_quantity))
      FROM tenant.manufacturing_production_entries entry JOIN tenant.manufacturing_orders mo ON mo.id = entry.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
      LEFT JOIN public.users actor ON actor.id = entry.recorded_by WHERE entry.organization_id = $1`);
  if (["all", "quality"].includes(kind)) parts.push(`SELECT decision.id, 'Quality decision', entry.entry_number, mo.id, mo.mo_number, item.code, decision.accepted_quantity + decision.rejected_quantity,
      decision.decided_at, actor.full_name, concat_ws(' · ', 'accepted ' || trim_scale(decision.accepted_quantity), 'rejected ' || trim_scale(decision.rejected_quantity), decision.rejection_reason)
      FROM tenant.manufacturing_quality_decisions decision JOIN tenant.manufacturing_production_entries entry ON entry.id = decision.production_entry_id
      JOIN tenant.manufacturing_orders mo ON mo.id = decision.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
      LEFT JOIN public.users actor ON actor.id = decision.decided_by WHERE decision.organization_id = $1`);
  if (["all", "receipts"].includes(kind)) parts.push(`SELECT receipt.id, 'Finished-goods receipt', receipt.receipt_number, mo.id, mo.mo_number, item.code, receipt.quantity, receipt.received_at, actor.full_name, NULL
      FROM tenant.manufacturing_goods_receipts receipt JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id JOIN tenant.items item ON item.id = receipt.item_id
      LEFT JOIN public.users actor ON actor.id = receipt.received_by WHERE receipt.organization_id = $1`);
  if (!parts.length) return [];
  const rows = (await client.query(`SELECT * FROM (${parts.join(" UNION ALL ")}) AS activity ORDER BY at DESC LIMIT ${limit}`, [c.organizationId])).rows;
  return rows.map((row) => ({ id: row.id, kind: row.kind, number: row.number, orderId: row.order_id, orderNumber: row.mo_number, item: row.item, quantity: q(D(row.quantity)), at: row.at,
    actor: row.actor, note: row.note }));
}

const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportManufacturingOrder(client, c, id) {
  needMo(c, MO.export);
  const order = await getManufacturingOrder(client, c, id);
  const rows = [
    ["Manufacturing order", order.number], ["Status", order.statusLabel], ["Product", `${order.finishedItem.code} · ${order.finishedItem.name}`],
    ["Planned", `${order.quantities.planned} ${order.finishedItem.baseUom ?? ""}`], ["BOM", order.bom ? `${order.bom.number} rev ${order.bom.revisionNumber}` : ""],
    ["Material warehouse", order.warehouses.material.code], ["Finished goods warehouse", order.warehouses.finishedGoods.code],
    ["Planned start", isoOrNull(order.plannedStartAt)], ["Planned completion", isoOrNull(order.plannedEndAt)], ["Accepted", order.quantities.accepted], ["Rejected", order.quantities.rejected],
    ["Received", order.quantities.received], [],
    ["Line", "Material", "Unit", "Planned", "Extra", "Required", "Reserved", "Net issued", "Consumed", "To issue", "Shortage"],
    ...order.materials.map((row) => [row.lineNumber, `${row.code} · ${row.name}`, row.uom, row.planned, row.extra, row.required, row.reserved, row.netIssued, row.consumed, row.remainingToIssue, row.shortage]),
    [], ["Production entry", "Reported", "Accepted", "Rejected", "Awaiting inspection", "Recorded"],
    ...order.production.map((row) => [row.number, row.reported, row.accepted, row.rejected, row.pendingRemaining, isoOrNull(row.at)]),
    [], ["Receipt", "Quantity", "Warehouse", "Batch", "Received"], ...order.receipts.map((row) => [row.number, row.quantity, row.warehouse, row.batch ?? "", isoOrNull(row.at)]),
  ];
  return { fileName: `${order.number}.csv`, csv: rows.map((row) => row.map(csvCell).join(",")).join("\n") };
}
