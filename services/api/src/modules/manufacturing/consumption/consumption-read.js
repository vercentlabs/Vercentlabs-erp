// Material Consumption — the reads: one note (lines, the BOM's expectation and variance, the stock each line used, approval, corrections,
// timeline), the list, what an order's production holds and may use (by batch, serial unit and issue), the BOM's suggestion for an output,
// an order's material reconciliation (issued, used, scrapped, returned, in custody — per material and per identity), the posting check, the
// reconciliation queue and the reports. Costs only with the cost permission. Nothing here changes custody.
import { money } from "../orders/mo-core.js";
import {
  BAND_LABEL, CONSUMPTION, CONSUMPTION_STATUS_LABEL, D, MO, approvalOf, STATUS_LABEL, UNPOSTED, ZERO, add, consumptionError, consumptionSettings, custodyOf, div, expectationFor, has, lineFigures,
  loadConsumption, loadConsumptionLines, loadConsumptionOrder, loadMaterials, max, mul, needConsumptionView, outputBasis, q, storedConsumptionLines, sub, uuid, variancesOf,
} from "./consumption-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const lookup = async (client, c, sql, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  return list.length ? new Map((await client.query(sql, [c.organizationId, list])).rows.map((row) => [row.id, row])) : new Map();
};
const ACTION_LABEL = Object.freeze({ CREATED: "Draft created", EDITED: "Draft edited", APPROVAL_REQUESTED: "Approval requested", APPROVED: "Usage variance approved", REJECTED: "Usage variance rejected",
  POSTED: "Posted: usage confirmed", CANCELLED: "Cancelled", CORRECTED: "Correction: back to custody", PRINTED: "Printed", REPRINTED: "Reprinted", RECOVERY_REQUIRED: "Marked for recovery",
  RECOVERED: "Recovered: custody agrees" });
const pct = (value) => (value === null || value === undefined ? null : q(D(value), 2));

// ------------------------------------------------------------------ one note
export async function getMaterialConsumption(client, c, id) {
  needConsumptionView(c);
  const note = await loadConsumption(client, c, id);
  const order = await loadConsumptionOrder(client, c, note.manufacturing_order_id);
  const materials = await loadMaterials(client, c, order.id);
  const rows = await loadConsumptionLines(client, c, note.id);
  const lines = storedConsumptionLines(rows, materials);
  const costView = has(c, MO.costView);
  const unposted = UNPOSTED.has(note.status);
  const settings = await consumptionSettings(client, c);
  // A draft's expectation follows the BOM now; a posted note keeps what it was posted against.
  const variances = unposted ? variancesOf(lines, await expectationFor(client, c, order, await outputBasis(client, c, note)), settings)
    : rows.map((row) => ({ expected: row.expected_quantity === null ? null : D(row.expected_quantity), variance: row.variance_quantity === null ? null : D(row.variance_quantity),
      pct: row.variance_pct === null ? null : D(row.variance_pct), band: row.variance_band ?? "NO_BASIS" }));
  const approval = unposted ? approvalOf(note, lines, variances) : { required: note.approval_status !== "NOT_REQUIRED", valid: true, stale: false, status: note.approval_status };
  const custody = unposted ? await custodyOf(client, c, order, materials) : null;
  const allocations = rows.length ? (await client.query(
    `SELECT allocation.*, batch.batch_number, serial.serial_number, movement.movement_number, issue.issue_number FROM tenant.manufacturing_material_consumption_allocations allocation
       LEFT JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id LEFT JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id
       LEFT JOIN tenant.manufacturing_order_material_movements movement ON movement.id = allocation.source_movement_id LEFT JOIN tenant.manufacturing_material_issues issue ON issue.id = allocation.material_issue_id
      WHERE allocation.organization_id = $1 AND allocation.consumption_line_id = ANY($2::uuid[]) ORDER BY allocation.created_at`, [c.organizationId, rows.map((row) => row.id)])).rows : [];
  const batches = await lookup(client, c, `SELECT id, batch_number, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.map((row) => row.batch_id));
  const serials = await lookup(client, c, `SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.flatMap((row) => row.serial_ids ?? []));
  const location = note.production_location_id ? (await client.query(`SELECT id, code, name FROM tenant.warehouse_locations WHERE id = $1`, [note.production_location_id])).rows[0] : null;
  const warehouse = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE id = $1`, [note.production_warehouse_id])).rows[0];
  const entry = note.production_entry_id ? (await client.query(`SELECT id, entry_number, reported_quantity, accepted_quantity, batch_reference FROM tenant.manufacturing_production_entries WHERE id = $1`,
    [note.production_entry_id])).rows[0] : null;
  const postings = (await client.query(`SELECT * FROM tenant.manufacturing_material_consumption_postings WHERE organization_id = $1 AND consumption_id = $2 ORDER BY created_at`, [c.organizationId, note.id])).rows;
  const corrections = (await client.query(`SELECT correction.*, line.line_number, item.code AS item_code FROM tenant.manufacturing_material_consumption_corrections correction
      JOIN tenant.manufacturing_material_consumption_lines line ON line.id = correction.consumption_line_id JOIN tenant.items item ON item.id = line.item_id
      WHERE correction.organization_id = $1 AND correction.consumption_id = $2 ORDER BY correction.corrected_at`, [c.organizationId, note.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_material_consumption_events WHERE organization_id = $1 AND consumption_id = $2 ORDER BY occurred_at`, [c.organizationId, note.id])).rows;
  const people = await names(client, [note.created_by, note.posted_by, note.approval_requested_by, note.approved_by, note.cancelled_by, note.supervisor_user_id, ...events.map((row) => row.actor_user_id),
    ...corrections.map((row) => row.corrected_by)]);
  const finished = (await client.query(`SELECT code, name FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0];
  const revision = order.bom_revision_id ? (await client.query(`SELECT revision_number FROM tenant.manufacturing_bom_revisions WHERE id = $1`, [order.bom_revision_id])).rows[0] : null;
  const basis = await outputBasis(client, c, note);
  const posting = postings.find((row) => row.kind === "CONSUMPTION") ?? null;
  const live = order.status === "IN_PROGRESS";
  const quantity = rows.reduce((sum, row) => add(sum, D(row.base_quantity)), ZERO);
  return {
    id: note.id, number: note.consumption_number, status: note.status, statusLabel: CONSUMPTION_STATUS_LABEL[note.status], kind: note.kind, rowVersion: note.row_version,
    consumptionDate: note.consumption_date, consumedAt: note.consumed_at, notes: note.notes, createdBy: people.get(note.created_by) ?? null, createdAt: note.created_at,
    postedBy: people.get(note.posted_by) ?? null, postedAt: note.posted_at, supervisor: people.get(note.supervisor_user_id) ?? null, cancelledBy: people.get(note.cancelled_by) ?? null,
    cancelReason: note.cancel_reason,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, finishedItem: finished, revisionNumber: revision?.revision_number ?? null,
      plannedOutput: q(D(order.planned_base_quantity)), acceptedOutput: q(D(order.accepted_quantity)) },
    production: { warehouse, location, entry: entry ? { id: entry.id, number: entry.entry_number, reported: q(D(entry.reported_quantity)), accepted: q(D(entry.accepted_quantity)) } : null,
      batchReference: note.production_batch_reference, outputBasis: basis === null ? null : q(basis) },
    approval: { ...approval, reason: note.approval_reason, requestedBy: people.get(note.approval_requested_by) ?? null, requestedAt: note.approval_requested_at,
      decidedBy: people.get(note.approved_by) ?? null, decidedAt: note.approved_at, note: note.approval_note, policy: note.approval_policy },
    policy: { warningPct: q(settings.warningPct), approvalPct: q(settings.approvalPct) },
    lines: rows.map((row, index) => {
      const material = materials.find((line) => line.id === row.material_id);
      const figures = lineFigures(material);
      const variance = variances[index];
      return {
        id: row.id, lineNumber: row.line_number, materialId: row.material_id, itemId: row.item_id, code: row.item_code, name: row.item_name, trackingType: row.tracking_type, origin: material.origin,
        quantity: q(D(row.quantity)), uomId: row.uom_id, uom: row.uom_code, baseQuantity: q(D(row.base_quantity)), baseUom: row.base_uom_code,
        planned: q(D(material.planned_quantity)), extra: q(D(material.authorized_extra_quantity)), issued: q(D(material.issued_quantity)), consumed: q(figures.consumed), scrapped: q(figures.scrapped),
        returned: q(D(material.returned_quantity)), inCustody: q(figures.custody), custodyNow: custody ? q(custody.get(material.id).custody) : null,
        expected: variance.expected === null ? null : q(variance.expected), variance: variance.variance === null ? null : q(variance.variance), variancePct: pct(variance.pct),
        band: variance.band, bandLabel: BAND_LABEL[variance.band], varianceReason: row.variance_reason, notes: row.notes,
        batch: row.batch_id ? { id: row.batch_id, number: batches.get(row.batch_id)?.batch_number ?? null } : null,
        serials: (row.serial_ids ?? []).map((serialId) => ({ id: serialId, number: serials.get(serialId)?.serial_number ?? null })),
        unitCost: costView && row.unit_cost !== null ? q(D(row.unit_cost)) : null, totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null,
        corrected: q(D(row.corrected_quantity)),
        allocations: allocations.filter((part) => part.consumption_line_id === row.id).map((part) => ({ id: part.id, issueNumber: part.issue_number ?? part.movement_number, issueId: part.material_issue_id,
          batch: part.batch_number, serial: part.serial_number, quantity: q(D(part.quantity)), unitCost: costView && part.unit_cost !== null ? q(D(part.unit_cost)) : null })),
      };
    }),
    totals: { quantity: q(quantity), cost: costView && note.total_cost !== null ? money(D(note.total_cost)) : null, costStatus: note.cost_status },
    posting: posting ? { key: posting.command_key, documentVersion: posting.document_version, custodyStatus: posting.custody_status, financeStatus: posting.finance_status, at: posting.created_at,
      financeNote: posting.finance_status === "IN_WIP_AT_ISSUE" ? "The value went to work in progress when the material was issued; consumption allocates it within work in progress — no second journal." : "Part of the issued cost is missing: review the issue's valuation." } : null,
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, lineNumber: row.line_number, code: row.item_code, quantity: q(D(row.quantity)), reason: row.reason, evidence: row.evidence,
      cost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, by: people.get(row.corrected_by) ?? null, at: row.corrected_at })),
    print: { count: note.print_count, lastPrintedAt: note.last_printed_at, watermark: note.status === "POSTED" ? null : note.status === "CANCELLED" ? "CANCELLED" : "DRAFT" },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary,
      actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      edit: unposted && live && has(c, CONSUMPTION.create), cancel: unposted && has(c, CONSUMPTION.create), preview: unposted && has(c, CONSUMPTION.create),
      requestApproval: unposted && live && has(c, CONSUMPTION.create) && approval.required && !approval.valid && note.status !== "PENDING_APPROVAL",
      decideApproval: note.status === "PENDING_APPROVAL" && has(c, CONSUMPTION.approve) && ((note.approval_requested_by !== c.userId && note.created_by !== c.userId) || settings.selfApproval),
      post: unposted && live && has(c, CONSUMPTION.post) && note.status !== "PENDING_APPROVAL",
      correct: note.status === "POSTED" && note.kind !== "CLOSING" && has(c, CONSUMPTION.reverse) && ["IN_PROGRESS", "ON_HOLD"].includes(order.status)
        && rows.some((row) => D(row.corrected_quantity) < D(row.base_quantity)),
      print: has(c, CONSUMPTION.export), viewCost: costView, recover: ["POSTED", "RECOVERY_REQUIRED"].includes(note.status) && has(c, CONSUMPTION.reverse),
    },
  };
}

// ------------------------------------------------------------------ list
// filters: { status, orderId, itemId, entryId, recordedBy, from, to, search }
export async function listMaterialConsumptions(client, c, filters = {}) {
  needConsumptionView(c);
  const values = [c.organizationId];
  const where = ["note.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`note.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.orderId) where.push(`note.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.entryId) where.push(`note.production_entry_id = ${bind(uuid(filters.entryId, "Production entry"))}`);
  if (filters.recordedBy) where.push(`note.created_by = ${bind(uuid(filters.recordedBy, "User"))}`);
  if (filters.itemId) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_material_consumption_lines line WHERE line.consumption_id = note.id AND line.item_id = ${bind(uuid(filters.itemId, "Item"))})`);
  if (filters.from) where.push(`COALESCE(note.posted_at, note.created_at) >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(note.posted_at, note.created_at) < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(note.consumption_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR lower(COALESCE(note.production_batch_reference, '')) LIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.consumption_id = note.id
        AND (lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})))`);
  }
  const rows = (await client.query(
    `SELECT note.*, mo.mo_number, mo.status AS order_status, finished.code AS finished_code, finished.name AS finished_name,
            (SELECT count(*)::int FROM tenant.manufacturing_material_consumption_lines line WHERE line.consumption_id = note.id) AS line_count,
            (SELECT bool_or(line.variance_band IN ('APPROVAL', 'UNPLANNED', 'WARNING')) FROM tenant.manufacturing_material_consumption_lines line WHERE line.consumption_id = note.id) AS has_variance,
            (SELECT string_agg(item.code || ' ' || trim(trailing '.' FROM trim(trailing '0' FROM line.base_quantity::text)), ', ' ORDER BY line.line_number)
               FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.consumption_id = note.id) AS summary
       FROM tenant.manufacturing_material_consumptions note JOIN tenant.manufacturing_orders mo ON mo.id = note.manufacturing_order_id JOIN tenant.items finished ON finished.id = mo.finished_item_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(note.posted_at, note.created_at) DESC LIMIT 500`, values)).rows;
  const people = await names(client, rows.flatMap((row) => [row.created_by, row.posted_by]));
  const costView = has(c, MO.costView);
  return rows.map((row) => ({
    id: row.id, number: row.consumption_number, status: row.status, statusLabel: CONSUMPTION_STATUS_LABEL[row.status], kind: row.kind, orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
    orderStatusLabel: STATUS_LABEL[row.order_status], finishedItem: `${row.finished_code} · ${row.finished_name}`, lines: row.line_count, summary: row.summary, batchReference: row.production_batch_reference,
    outputBasis: row.output_basis_quantity === null ? null : q(D(row.output_basis_quantity)), hasVariance: Boolean(row.has_variance), approvalStatus: row.approval_status,
    recordedBy: people.get(row.created_by) ?? null, postedBy: people.get(row.posted_by) ?? null, createdAt: row.created_at, postedAt: row.posted_at,
    totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, costStatus: row.cost_status,
  }));
}
export const getMoConsumptionHistory = (client, c, orderId) => listMaterialConsumptions(client, c, { orderId });

// ------------------------------------------------------------------ what production holds and may use
// Per material line: planned, extra, issued, used, scrapped, returned and in custody; the identities still held (batch or serial unit, with
// the issue they came from and its production location); and, given an output quantity, what the BOM expects it to use (a suggestion only).
export async function getConsumableMoMaterials(client, c, orderId, input = {}) {
  needConsumptionView(c);
  const order = await loadConsumptionOrder(client, c, orderId);
  const materials = await loadMaterials(client, c, order.id);
  const custody = await custodyOf(client, c, order, materials);
  const basis = input.outputQuantity !== undefined && input.outputQuantity !== null && String(input.outputQuantity).trim() !== "" && Number(input.outputQuantity) > 0
    ? D(String(input.outputQuantity).trim()) : null;
  const expected = await expectationFor(client, c, order, basis);
  const batchIds = [...custody.values()].flatMap((held) => held.entries.map((entry) => entry.batchId));
  const serialIds = [...custody.values()].flatMap((held) => held.entries.map((entry) => entry.serialId));
  const batches = await lookup(client, c, `SELECT id, batch_number, expires_on, status FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, batchIds);
  const serials = await lookup(client, c, `SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, serialIds);
  const locations = await lookup(client, c, `SELECT id, code FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [...custody.values()].flatMap((held) => held.entries.map((entry) => entry.productionLocationId)));
  const entries = (await client.query(`SELECT id, entry_number, reported_quantity, accepted_quantity, batch_reference, recorded_at FROM tenant.manufacturing_production_entries
      WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY recorded_at DESC`, [c.organizationId, order.id])).rows;
  const left = expected ? new Map(expected) : null;
  let eligible = true;
  let reason = null;
  if (order.status !== "IN_PROGRESS") { eligible = false; reason = order.status === "RELEASED" ? "Production has not started: start it before recording usage." : `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}.`; }
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], orderVersion: order.version, eligible, reason,
    plannedOutput: q(D(order.planned_base_quantity)), acceptedOutput: q(D(order.accepted_quantity)), reportedOutput: q(D(order.reported_quantity)), outputBasis: basis === null ? null : q(basis),
    productionEntries: entries.map((row) => ({ id: row.id, number: row.entry_number, reported: q(D(row.reported_quantity)), accepted: q(D(row.accepted_quantity)), batchReference: row.batch_reference, at: row.recorded_at })),
    materials: materials.map((material) => {
      const figures = lineFigures(material);
      const held = custody.get(material.id);
      const suggestion = left ? left.get(material.component_item_id) ?? ZERO : null;
      if (left) left.set(material.component_item_id, ZERO);
      const identities = [...held.pools.values()].filter((pool) => pool.available > ZERO).map((pool) => {
        const sources = held.entries.filter((entry) => entry.key === pool.key);
        const batch = sources[0]?.batchId ? batches.get(sources[0].batchId) : null;
        return { key: pool.key, batchId: sources[0]?.batchId ?? null, batch: batch?.batch_number ?? null, expiresOn: batch?.expires_on ?? null,
          batchUsable: batch ? batch.status === "active" && !(batch.expires_on && new Date(batch.expires_on) < new Date(new Date().toDateString())) : true,
          serialId: sources[0]?.serialId ?? null, serial: sources[0]?.serialId ? serials.get(sources[0].serialId)?.serial_number ?? null : null, available: q(pool.available),
          sources: sources.filter((entry) => entry.remaining > ZERO).map((entry) => ({ movementId: entry.movementId, issueNumber: entry.issueNumber ?? entry.movementNumber, issueId: entry.issueId,
            location: entry.productionLocationId ? locations.get(entry.productionLocationId)?.code ?? null : null, remaining: q(entry.remaining) })) };
      });
      return {
        materialId: material.id, lineNumber: material.line_number, itemId: material.component_item_id, code: material.item_code, name: material.item_name, uomId: material.uom_id, uom: material.uom_code,
        kind: material.kind, origin: material.origin, trackingType: material.tracking_type, planned: q(D(material.planned_quantity)), extra: q(D(material.authorized_extra_quantity)),
        issued: q(D(material.issued_quantity)), consumed: q(figures.consumed), scrapped: q(figures.scrapped), returned: q(D(material.returned_quantity)), inCustody: q(held.custody),
        suggestion: suggestion === null ? null : q(suggestion), identities,
        reason: held.custody > ZERO ? null : D(material.issued_quantity) === ZERO ? "Nothing issued yet." : "Nothing left in production custody.",
      };
    }),
  };
}
// The BOM's expected usage for an output quantity (never posted on its own).
export async function suggestBomConsumption(client, c, orderId, input = {}) {
  const view = await getConsumableMoMaterials(client, c, orderId, input);
  return { orderId: view.orderId, outputBasis: view.outputBasis, suggestionOnly: true, lines: view.materials.map((row) => ({ materialId: row.materialId, code: row.code, uom: row.uom, suggestion: row.suggestion, inCustody: row.inCustody })) };
}

// ------------------------------------------------------------------ reconciliation of an order's material
// Per material: issued = used + scrapped + returned + in custody (one exclusive split); per identity the same; and the BOM's expectation
// for the accepted output against what was used (usage variance), so custody balance and usage efficiency are both visible.
export async function getConsumptionReconciliation(client, c, orderId) {
  needConsumptionView(c);
  const order = await loadConsumptionOrder(client, c, orderId);
  const materials = await loadMaterials(client, c, order.id);
  const custody = await custodyOf(client, c, order, materials);
  const accepted = D(order.accepted_quantity);
  const expected = await expectationFor(client, c, order, accepted > ZERO ? accepted : null);
  const left = expected ? new Map(expected) : null;
  const costView = has(c, MO.costView);
  const batchIds = [...custody.values()].flatMap((held) => held.entries.map((entry) => entry.batchId));
  const serialIds = [...custody.values()].flatMap((held) => held.entries.map((entry) => entry.serialId));
  const batches = await lookup(client, c, `SELECT id, batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, batchIds);
  const serials = await lookup(client, c, `SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, serialIds);
  const usedValue = new Map((await client.query(`SELECT line.material_id, COALESCE(sum(line.total_cost * (line.base_quantity - line.corrected_quantity) / line.base_quantity), 0) AS cost
      FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
     WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND note.status IN ('POSTED', 'RECOVERY_REQUIRED') GROUP BY 1`, [c.organizationId, order.id])).rows.map((row) => [row.material_id, D(row.cost)]));
  const lines = materials.map((material) => {
    const figures = lineFigures(material);
    const held = custody.get(material.id);
    const expect = left ? left.get(material.component_item_id) ?? ZERO : null;
    if (left) left.set(material.component_item_id, ZERO);
    const usage = expect === null ? null : sub(figures.consumed, expect);
    const unit = D(material.issued_quantity) > ZERO ? div(D(material.issued_cost), D(material.issued_quantity)) : null;
    return {
      materialId: material.id, code: material.item_code, name: material.item_name, uom: material.uom_code, origin: material.origin, planned: q(D(material.planned_quantity)),
      extra: q(D(material.authorized_extra_quantity)), issued: q(D(material.issued_quantity)), consumed: q(figures.consumed), scrapped: q(figures.scrapped), returned: q(D(material.returned_quantity)),
      inCustody: q(figures.custody), reconciled: figures.custody === ZERO, expectedForAccepted: expect === null ? null : q(expect), usageVariance: usage === null ? null : q(usage),
      usageVariancePct: usage === null || !expect ? null : q(div(mul(usage, 100n * 1_000_000n), expect), 2),
      cost: costView ? { issued: money(D(material.issued_cost)), returned: money(D(material.returned_cost)), consumed: money(usedValue.get(material.id) ?? ZERO),
        scrapped: unit === null ? null : money(mul(figures.scrapped, unit)), inCustody: unit === null ? null : money(mul(max(figures.custody, ZERO), unit)) } : null,
      identities: [...held.pools.values()].map((pool) => {
        const first = held.entries.find((entry) => entry.key === pool.key);
        return { batch: first?.batchId ? batches.get(first.batchId)?.batch_number ?? null : null, serial: first?.serialId ? serials.get(first.serialId)?.serial_number ?? null : null,
          issued: q(pool.issued), consumed: q(pool.used), scrapped: q(pool.scrapped), returned: q(pool.returned), inCustody: q(pool.available) };
      }),
    };
  });
  const open = (await client.query(`SELECT count(*) FILTER (WHERE status IN ('DRAFT', 'PENDING_APPROVAL'))::int AS unposted, count(*) FILTER (WHERE status = 'RECOVERY_REQUIRED')::int AS recovery
      FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND manufacturing_order_id = $2`, [c.organizationId, order.id])).rows[0];
  return { orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, acceptedOutput: q(accepted), reconciled: lines.every((row) => row.reconciled),
    unpostedNotes: open.unposted, recoveryNotes: open.recovery, lines };
}

// ------------------------------------------------------------------ posting check and reconciliation queue
// Do the note's allocations add up to its lines, and does the order's usage record hold exactly its lines?
export async function checkMaterialConsumptionPosting(client, c, id) {
  needConsumptionView(c);
  const note = await loadConsumption(client, c, id);
  const problems = [];
  const posting = (await client.query(`SELECT * FROM tenant.manufacturing_material_consumption_postings WHERE organization_id = $1 AND consumption_id = $2 AND kind = 'CONSUMPTION'`, [c.organizationId, note.id])).rows[0];
  if (["POSTED", "RECOVERY_REQUIRED"].includes(note.status)) {
    if (!posting) problems.push("No posting record exists for this posted note.");
    const lines = (await client.query(
      `SELECT line.id, line.base_quantity, (SELECT COALESCE(sum(quantity), 0) FROM tenant.manufacturing_material_consumption_allocations allocation WHERE allocation.consumption_line_id = line.id) AS allocated,
              (SELECT COALESCE(sum(quantity), 0) FROM tenant.manufacturing_order_consumption usage WHERE usage.consumption_line_id = line.id) AS recorded, item.code
         FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.organization_id = $1 AND line.consumption_id = $2`, [c.organizationId, note.id])).rows;
    for (const row of lines) {
      if (D(row.allocated) !== D(row.base_quantity)) problems.push(`${row.code}: ${q(D(row.allocated))} allocated to issued stock, ${q(D(row.base_quantity))} recorded.`);
      if (D(row.recorded) !== D(row.base_quantity)) problems.push(`${row.code}: the order's usage record holds ${q(D(row.recorded))}, the note ${q(D(row.base_quantity))}.`);
    }
    if (note.cost_status === "MISSING") problems.push("Part of the issued cost of this material is missing: its value is unknown, not zero.");
  }
  return { consumptionId: note.id, consumptionNumber: note.consumption_number, status: note.status, consistent: problems.length === 0, problems,
    custody: { status: posting ? "CONFIRMED" : UNPOSTED.has(note.status) ? "NOT_POSTED" : "UNKNOWN" }, finance: { status: posting?.finance_status ?? "NOT_POSTED" }, checkedAt: new Date().toISOString() };
}
export async function getUnreconciledConsumption(client, c) {
  needConsumptionView(c);
  const rows = (await client.query(`SELECT id FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND status IN ('POSTED', 'RECOVERY_REQUIRED') ORDER BY posted_at DESC LIMIT 500`, [c.organizationId])).rows;
  const out = [];
  for (const row of rows) {
    const check = await checkMaterialConsumptionPosting(client, c, row.id);
    if (!check.consistent || check.status === "RECOVERY_REQUIRED") out.push(check);
  }
  return out;
}

// ------------------------------------------------------------------ reports
// kind: by-mo | by-component | by-date | by-batch | planned-vs-actual | variance | issued-vs-consumed | scrap-return | actual-cost | wip | traceability |
// approval-history | unreconciled. filters: { from, to, orderId, itemId, batchId, serial }
export async function getMaterialConsumptionReport(client, c, kind = "by-date", filters = {}) {
  needConsumptionView(c);
  const costView = has(c, MO.costView);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["note.organization_id = $1", "note.status IN ('POSTED', 'RECOVERY_REQUIRED')"];
  if (filters.from) where.push(`note.posted_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`note.posted_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.orderId) where.push(`note.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`line.item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  const posted = `FROM tenant.manufacturing_material_consumptions note JOIN tenant.manufacturing_material_consumption_lines line ON line.consumption_id = note.id
    JOIN tenant.manufacturing_orders mo ON mo.id = note.manufacturing_order_id JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
    WHERE ${where.join(" AND ")}`;
  const net = "(line.base_quantity - line.corrected_quantity)";
  const cost = (value) => (costView ? money(D(value ?? 0)) : null);
  if (kind === "by-mo") {
    return (await client.query(`SELECT mo.id, mo.mo_number, count(DISTINCT note.id)::int AS notes, count(*)::int AS lines, max(note.posted_at) AS last_at, sum(line.total_cost) AS cost ${posted}
      GROUP BY mo.id, mo.mo_number ORDER BY max(note.posted_at) DESC`, values)).rows.map((row) => ({ orderId: row.id, orderNumber: row.mo_number, notes: row.notes, lines: row.lines, lastAt: row.last_at, cost: cost(row.cost) }));
  }
  if (kind === "by-component") {
    return (await client.query(`SELECT item.id, item.code, item.name, uom.code AS uom, sum(${net}) AS quantity, sum(line.corrected_quantity) AS corrected, count(DISTINCT mo.id)::int AS orders,
        sum(line.total_cost) AS cost ${posted} GROUP BY item.id, item.code, item.name, uom.code ORDER BY item.code`, values)).rows
      .map((row) => ({ itemId: row.id, code: row.code, name: row.name, uom: row.uom, consumed: q(D(row.quantity)), corrected: q(D(row.corrected)), orders: row.orders, cost: cost(row.cost) }));
  }
  if (kind === "by-date") {
    return (await client.query(`SELECT to_char(note.posted_at, 'YYYY-MM-DD') AS day, count(DISTINCT note.id)::int AS notes, count(*)::int AS lines, count(DISTINCT mo.id)::int AS orders, sum(line.total_cost) AS cost ${posted}
      GROUP BY 1 ORDER BY 1 DESC`, values)).rows.map((row) => ({ day: row.day, notes: row.notes, lines: row.lines, orders: row.orders, cost: cost(row.cost) }));
  }
  if (kind === "by-batch") {
    return (await client.query(`SELECT mo.id AS order_id, mo.mo_number, COALESCE(note.production_batch_reference, '—') AS batch, max(note.output_basis_quantity) AS basis, count(DISTINCT note.id)::int AS notes,
        count(*)::int AS lines, sum(line.total_cost) AS cost, bool_or(line.variance_band IN ('APPROVAL', 'UNPLANNED', 'WARNING')) AS variance ${posted} GROUP BY 1, 2, 3 ORDER BY 2, 3`, values)).rows
      .map((row) => ({ orderId: row.order_id, orderNumber: row.mo_number, batch: row.batch, outputBasis: row.basis === null ? null : q(D(row.basis)), notes: row.notes, lines: row.lines, hasVariance: Boolean(row.variance), cost: cost(row.cost) }));
  }
  if (kind === "variance" || kind === "planned-vs-actual") {
    const rows = (await client.query(`SELECT note.id AS note_id, note.consumption_number, mo.id AS order_id, mo.mo_number, note.production_batch_reference, note.output_basis_quantity, item.code, uom.code AS uom,
        ${net} AS consumed, line.expected_quantity, line.variance_quantity, line.variance_pct, line.variance_band, line.variance_reason, note.approval_status ${posted}
        ${kind === "variance" ? "AND line.variance_band IN ('APPROVAL', 'UNPLANNED', 'WARNING', 'UNDER')" : "AND line.expected_quantity IS NOT NULL"} ORDER BY note.posted_at DESC LIMIT 2000`, values)).rows;
    return rows.map((row) => ({ consumptionId: row.note_id, consumptionNumber: row.consumption_number, orderId: row.order_id, orderNumber: row.mo_number, batch: row.production_batch_reference,
      outputBasis: row.output_basis_quantity === null ? null : q(D(row.output_basis_quantity)), code: row.code, uom: row.uom, consumed: q(D(row.consumed)),
      expected: row.expected_quantity === null ? null : q(D(row.expected_quantity)), variance: row.variance_quantity === null ? null : q(D(row.variance_quantity)), variancePct: pct(row.variance_pct),
      band: row.variance_band, bandLabel: BAND_LABEL[row.variance_band], reason: row.variance_reason, approvalStatus: row.approval_status }));
  }
  if (["issued-vs-consumed", "scrap-return", "wip"].includes(kind)) {
    const lineValues = [c.organizationId];
    const lineWhere = ["material.organization_id = $1"];
    if (filters.orderId) { lineValues.push(uuid(filters.orderId, "Manufacturing order")); lineWhere.push(`material.manufacturing_order_id = $${lineValues.length}`); }
    if (filters.itemId) { lineValues.push(uuid(filters.itemId, "Item")); lineWhere.push(`material.component_item_id = $${lineValues.length}`); }
    lineWhere.push(kind === "wip" ? "mo.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING')" : "material.issued_quantity > 0");
    const rows = (await client.query(`SELECT material.*, mo.mo_number, mo.status AS order_status, item.code, item.name, uom.code AS uom FROM tenant.manufacturing_order_materials material
        JOIN tenant.manufacturing_orders mo ON mo.id = material.manufacturing_order_id JOIN tenant.items item ON item.id = material.component_item_id JOIN tenant.units_of_measure uom ON uom.id = material.uom_id
       WHERE ${lineWhere.join(" AND ")} ORDER BY mo.mo_number, material.line_number LIMIT 2000`, lineValues)).rows;
    return rows.map((row) => {
      const figures = lineFigures(row);
      const unit = D(row.issued_quantity) > ZERO ? div(D(row.issued_cost), D(row.issued_quantity)) : null;
      return { orderId: row.manufacturing_order_id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.order_status], code: row.code, name: row.name, uom: row.uom,
        issued: q(D(row.issued_quantity)), consumed: q(figures.consumed), scrapped: q(figures.scrapped), returned: q(D(row.returned_quantity)), inCustody: q(figures.custody),
        reconciled: figures.custody === ZERO, custodyValue: costView && unit !== null ? money(mul(max(figures.custody, ZERO), unit)) : null,
        scrapValue: costView && unit !== null ? money(mul(figures.scrapped, unit)) : null };
    }).filter((row) => kind !== "wip" || D(row.inCustody) > ZERO);
  }
  if (kind === "actual-cost") {
    const rows = (await client.query(`SELECT mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom, sum(${net}) AS quantity,
        sum(line.total_cost * ${net} / line.base_quantity) AS cost, bool_or(note.cost_status = 'MISSING') AS missing ${posted} GROUP BY 1, 2, 3, 4 ORDER BY 2, 3`, values)).rows;
    return rows.map((row) => ({ orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom, consumed: q(D(row.quantity)),
      cost: costView ? money(D(row.cost ?? 0)) : null, unitCost: costView && D(row.quantity) > ZERO ? q(div(D(money(D(row.cost ?? 0))), D(row.quantity)), 4) : null, costMissing: Boolean(row.missing) }));
  }
  if (kind === "traceability") {
    if (filters.batchId) where.push(`allocation.batch_id = ${bind(uuid(filters.batchId, "Batch"))}`);
    if (filters.serial) where.push(`lower(serial.serial_number) = lower(${bind(String(filters.serial))})`);
    const rows = (await client.query(`SELECT note.id AS note_id, note.consumption_number, mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom, batch.batch_number, serial.serial_number, allocation.quantity,
        issue.issue_number, issue.id AS issue_id, note.production_batch_reference, note.posted_at, note.posted_by
        FROM tenant.manufacturing_material_consumption_allocations allocation JOIN tenant.manufacturing_material_consumption_lines line ON line.id = allocation.consumption_line_id
        JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id JOIN tenant.manufacturing_orders mo ON mo.id = note.manufacturing_order_id
        JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id LEFT JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id
        LEFT JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id LEFT JOIN tenant.manufacturing_material_issues issue ON issue.id = allocation.material_issue_id
       WHERE ${where.join(" AND ")} ORDER BY note.posted_at DESC LIMIT 2000`, values)).rows;
    const people = await names(client, rows.map((row) => row.posted_by));
    return rows.map((row) => ({ consumptionId: row.note_id, consumptionNumber: row.consumption_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom, batch: row.batch_number,
      serial: row.serial_number, quantity: q(D(row.quantity)), issueId: row.issue_id, issueNumber: row.issue_number, productionBatch: row.production_batch_reference, postedBy: people.get(row.posted_by) ?? null, at: row.posted_at }));
  }
  if (kind === "approval-history") {
    const rows = (await client.query(`SELECT note.*, mo.mo_number FROM tenant.manufacturing_material_consumptions note JOIN tenant.manufacturing_orders mo ON mo.id = note.manufacturing_order_id
        WHERE note.organization_id = $1 AND note.approval_status <> 'NOT_REQUIRED' ORDER BY note.approval_requested_at DESC NULLS LAST LIMIT 1000`, [c.organizationId])).rows;
    const people = await names(client, rows.flatMap((row) => [row.approval_requested_by, row.approved_by]));
    return rows.map((row) => ({ consumptionId: row.id, consumptionNumber: row.consumption_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, status: row.status, approvalStatus: row.approval_status,
      reason: row.approval_reason, requestedBy: people.get(row.approval_requested_by) ?? null, requestedAt: row.approval_requested_at, decidedBy: people.get(row.approved_by) ?? null, decidedAt: row.approved_at, note: row.approval_note }));
  }
  if (kind === "unreconciled") return getUnreconciledConsumption(client, c);
  throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "Unknown report.");
}

export { CONSUMPTION };
