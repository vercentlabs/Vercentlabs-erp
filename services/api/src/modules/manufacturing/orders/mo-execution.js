// Manufacturing Orders — execution: reserve materials in Inventory, issue them to production and return what is unused, record what
// production actually used, extra material beyond the plan (requested, then approved by someone else), start, report output, quality
// decisions, receive accepted output into finished-goods stock, and complete — only when production, quality, receipts, materials and
// work in progress are reconciled (or the order is closed short with a reason). Stock moves only through Inventory; money only through
// Finance; every physical action takes a request key so a retry never posts twice.
import { randomUUID } from "node:crypto";

import { loadItem, resolveEffectiveBom } from "../boms/bom-engine.js";
import {
  D, EXECUTING, LIVE, MO, ZERO, add, div, event, freeStock, has, idempotent, lineFigures, loadMaterials, loadOrder, max, min, moError, money, needMo, nextNumber, postJournal, q,
  quantity, receiveStock, releaseReservations, requireStatus, reserve, reservedByItem, setStatus, settingsOf, sub, text, uuid, versionCheck, wipBalance,
} from "./mo-core.js";
import { consumeThroughNote } from "../consumption/consumption-service.js";
import { issueThroughNote } from "../issues/issue-service.js";
import { createManufacturingOrder } from "./mo-lifecycle.js";
import { getManufacturingOrder, materialView, readinessOf } from "./mo-read.js";

const needStock = (c, permission, what) => {
  if (!has(c, permission)) throw moError(403, "MFG_MO_PERMISSION_DENIED", `Inventory: you also need permission to ${what} stock.`);
};
const lineOf = (materials, materialId) => {
  const line = materials.find((row) => row.id === materialId);
  if (!line) throw moError(404, "MFG_MO_NOT_FOUND", "That material line is not on this order.");
  return line;
};
const withOrder = async (client, c, result) => ({ ...result, order: await getManufacturingOrder(client, c, result.orderId) });

// ------------------------------------------------------------------ reservations
// Reserve what each material still needs (required less issued less already reserved) from usable stock in the material warehouse. When
// stock covers only part, nothing is reserved unless the planner confirms a partial reservation (allowPartial) and the company allows it;
// the refusal lists exactly what would and would not be reserved. Serial-tracked materials are chosen unit by unit when they are issued.
// input: { itemIds?, allowPartial?, idempotencyKey? }
export async function reserveManufacturingMaterials(client, c, id, input = {}) {
  needMo(c, MO.reserve);
  const result = await idempotent(client, c, "manufacturing.order.reserve", input.idempotencyKey, { id, itemIds: input.itemIds ?? null, allowPartial: Boolean(input.allowPartial) }, async (key) => {
    const order = await loadOrder(client, c, id, { lock: true });
    requireStatus(order, "RELEASED", "IN_PROGRESS");
    const materials = await loadMaterials(client, c, order.id);
    const reserved = await reservedByItem(client, c, order);
    const settings = await settingsOf(client, c);
    const plan = [];
    for (const itemId of new Set(materials.map((line) => line.component_item_id))) {
      if (input.itemIds?.length && !input.itemIds.includes(itemId)) continue;
      const lines = materials.filter((line) => line.component_item_id === itemId);
      const need = sub(lines.reduce((sum, line) => add(sum, lineFigures(line).toIssue), ZERO), reserved.get(itemId) ?? ZERO);
      if (need <= ZERO || lines[0].tracking_type === "serial") continue;
      const free = await freeStock(client, c, itemId, order.material_warehouse_id);
      if (free < need) plan.push({ code: lines[0].item_code, wanted: q(need), reservable: q(free), short: q(sub(need, free)) });
    }
    if (plan.length && !input.allowPartial) {
      throw moError(409, "MFG_MATERIAL_PARTIAL_ALLOCATION", `Only part could be reserved: ${plan.map((row) => `${row.code} ${row.reservable} of ${row.wanted}`).join(", ")}. Nothing was reserved; confirm a partial reservation to reserve what is there.`, { lines: plan });
    }
    if (plan.length && !settings.partialReservation) throw moError(409, "MFG_MATERIAL_PARTIAL_ALLOCATION", "The company does not allow partial reservations; nothing was reserved.", { lines: plan });
    const outcomes = [];
    for (const itemId of new Set(materials.map((line) => line.component_item_id))) {
      if (input.itemIds?.length && !input.itemIds.includes(itemId)) continue;
      const lines = materials.filter((line) => line.component_item_id === itemId);
      const need = sub(lines.reduce((sum, line) => add(sum, lineFigures(line).toIssue), ZERO), reserved.get(itemId) ?? ZERO);
      if (need <= ZERO) continue;
      if (lines[0].tracking_type === "serial") { outcomes.push({ itemId, code: lines[0].item_code, wanted: q(need), reserved: "0", short: q(need), note: "Serial units are chosen at issue." }); continue; }
      const got = await reserve(client, c, order, itemId, need, key);
      outcomes.push({ itemId, code: lines[0].item_code, wanted: q(need), reserved: q(got), short: q(sub(need, got)) });
    }
    await event(client, c, order.id, "MATERIALS_RESERVED", { summary: outcomes.map((row) => `${row.code} ${row.reserved}/${row.wanted}`).join(", ") || "Nothing more to reserve", details: { outcomes } });
    return { orderId: order.id, outcomes };
  });
  return withOrder(client, c, result);
}

// Give back the order's reservations (all, or of one item) — what it no longer needs held.
export async function releaseManufacturingReservations(client, c, id, input = {}) {
  needMo(c, MO.reserve);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "RELEASED", "IN_PROGRESS", "ON_HOLD");
  await releaseReservations(client, c, order, input.itemId ? uuid(input.itemId, "Material") : null);
  await event(client, c, order.id, "RESERVATIONS_RELEASED", { summary: input.itemId ? "One material's reservations released" : "All reservations released" });
  return getManufacturingOrder(client, c, order.id);
}

// ------------------------------------------------------------------ issue and return
// The order's "Issue materials": an issue note created and posted at once (Material Issue): the order's own reservation first, at its
// location and batch; Inventory checks the stock, the person's issue permission and the warehouse; one work-in-progress journal per note.
// input: { lines: [{ materialId, quantity, batchId?, serialIds? }], idempotencyKey }
export async function issueManufacturingMaterials(client, c, id, input = {}) {
  return withOrder(client, c, await issueThroughNote(client, c, id, input));
}

// input: { lines: [{ materialId, quantity, reason, batchId? }], idempotencyKey }. Back to the material warehouse at the line's average issue cost.
export async function returnManufacturingMaterials(client, c, id, input = {}) {
  needMo(c, MO.return);
  needStock(c, "stock.receive", "receive");
  const result = await idempotent(client, c, "manufacturing.order.return", input.idempotencyKey, { id, lines: input.lines }, async (key) => {
    const order = await loadOrder(client, c, id, { lock: true });
    requireStatus(order, "RELEASED", "IN_PROGRESS", "ON_HOLD");
    const lines = Array.isArray(input.lines) ? input.lines.filter((line) => line && Number(line.quantity) > 0) : [];
    if (!lines.length) throw moError(400, "MFG_MO_QUANTITY_INVALID", "Choose at least one material and quantity to return.");
    const materials = await loadMaterials(client, c, order.id, { lock: true });
    let total = ZERO;
    const returned = [];
    for (const request of lines) {
      const material = lineOf(materials, request.materialId);
      const amount = D(quantity(request.quantity, "MFG_MO_QUANTITY_INVALID", material.item_code));
      const reason = text(request.reason, 500);
      if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", `${material.item_code}: say why it is returned.`);
      const figures = lineFigures(material);
      if (amount > figures.custody) throw moError(409, "MFG_MO_OVER_RETURN", `${material.item_code}: ${q(figures.custody)} ${material.uom_code} is in production custody.`);
      if (material.tracking_type === "serial") throw moError(409, "MFG_MO_VALIDATION_FAILED", `${material.item_code} is serial-tracked: return its units through Inventory (stock adjustment) for now.`);
      let batchId = request.batchId ? uuid(request.batchId, "Batch") : null;
      if (!batchId && material.tracking_type === "batch") {
        const batches = (await client.query(`SELECT DISTINCT allocation->>'batchId' AS batch FROM tenant.manufacturing_order_material_movements movement, jsonb_array_elements(movement.allocations) allocation
           WHERE movement.organization_id = $1 AND movement.material_id = $2 AND movement.direction = 'ISSUE' AND allocation->>'batchId' IS NOT NULL`, [c.organizationId, material.id])).rows;
        if (batches.length !== 1) throw moError(400, "MFG_MO_VALIDATION_FAILED", `${material.item_code} is batch-tracked: choose the batch being returned.`);
        batchId = batches[0].batch;
      }
      if (batchId) {
        const out = (await client.query(
          `SELECT COALESCE(sum(CASE WHEN movement.direction = 'ISSUE' THEN (allocation->>'quantity')::numeric ELSE -(allocation->>'quantity')::numeric END), 0) AS quantity
             FROM tenant.manufacturing_order_material_movements movement, jsonb_array_elements(movement.allocations) allocation
            WHERE movement.organization_id = $1 AND movement.material_id = $2 AND allocation->>'batchId' = $3`, [c.organizationId, material.id, batchId])).rows[0];
        if (amount > D(out.quantity)) throw moError(409, "MFG_MO_OVER_RETURN", `${material.item_code}: ${q(D(out.quantity))} of that batch was issued to this order and not yet returned.`);
      }
      const unitCost = D(material.issued_quantity) > ZERO ? div(D(material.issued_cost), D(material.issued_quantity)) : ZERO;
      const movementId = randomUUID();
      const number = await nextNumber(client, c, "manufacturing_material_return");
      const stock = await receiveStock(client, c, { itemId: material.component_item_id, warehouseId: order.material_warehouse_id, amount, unitCost, batchId, reference: order.mo_number, referenceId: order.id,
        reason: `Return from production: ${reason}`, key: `${key}:${material.id}` });
      const journal = await postJournal(client, c, { event: "manufacturing_material_return", sourceType: "manufacturing_material_movement", sourceId: movementId, sourceNumber: number,
        reference: `${number} · ${order.mo_number}`, description: `Material returned from ${order.mo_number}`,
        lines: [{ mappingKey: "inventory", itemId: material.component_item_id, label: "Inventory", debit: stock.cost }, { mappingKey: "wip", label: "Work in progress", credit: stock.cost }] });
      await client.query(
        `INSERT INTO tenant.manufacturing_order_material_movements (id, organization_id, manufacturing_order_id, material_id, movement_number, direction, item_id, warehouse_id, quantity, unit_cost,
           total_cost, allocations, stock_movement_ids, journal_entry_id, reason, idempotency_key, posted_by) VALUES ($1,$2,$3,$4,$5,'RETURN',$6,$7,$8,$9,$10,$11::jsonb,$12::uuid[],$13,$14,$15,$16)`,
        [movementId, c.organizationId, order.id, material.id, number, material.component_item_id, order.material_warehouse_id, q(amount), q(unitCost), money(stock.cost),
          JSON.stringify([{ batchId, quantity: q(amount) }]), [stock.movement.id], journal, reason, key, c.userId ?? null]);
      await client.query(`UPDATE tenant.manufacturing_order_materials SET returned_quantity = returned_quantity + $3, returned_cost = returned_cost + $4, version = version + 1 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, material.id, q(amount), money(stock.cost)]);
      material.returned_quantity = q(add(D(material.returned_quantity), amount));
      total = add(total, D(money(stock.cost)));
      returned.push({ number, code: material.item_code, quantity: q(amount) });
    }
    await client.query(`UPDATE tenant.manufacturing_orders SET wip_material_cost = wip_material_cost - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(total)]);
    await event(client, c, order.id, "MATERIAL_RETURNED", { summary: returned.map((row) => `${row.number} ${row.code} ${row.quantity}`).join(", "), details: { returned } });
    return { orderId: order.id, returned };
  }, { required: true });
  return withOrder(client, c, result);
}

// What production actually used of what was issued (input: { lines: [{ materialId, quantity, note? }], idempotencyKey?, outputBasisQuantity? }):
// a consumption note recorded and posted at once (Material Consumption) — one posting path. No stock or money moves: the cost is already in
// work in progress; this is the actual usage against plan, allocated to the exact issued stock.
export async function recordManufacturingConsumption(client, c, id, input = {}) {
  const lines = Array.isArray(input.lines) ? input.lines.filter((line) => line && Number(line.quantity) > 0) : [];
  await consumeThroughNote(client, c, id, { ...input, lines, note: lines.map((line) => line.note).filter(Boolean).join("; ") || undefined });
  return getManufacturingOrder(client, c, id);
}

// ------------------------------------------------------------------ extra material (variances)
// input: { materialId? or componentItemId, quantity, reason }. Changes this order's plan once approved — never the BOM.
export async function requestExtraMaterial(client, c, id, input = {}) {
  needMo(c, MO.extra);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "RELEASED", "IN_PROGRESS");
  const materials = await loadMaterials(client, c, order.id);
  const material = input.materialId ? lineOf(materials, input.materialId) : null;
  const itemId = material?.component_item_id ?? uuid(input.componentItemId, "Material");
  const item = await loadItem(client, c.organizationId, itemId);
  if (!item || !["product", "consumable"].includes(item.item_type) || item.status !== "active" || item.is_variant_template) throw moError(400, "MFG_MO_VALIDATION_FAILED", "That item cannot be used as a material.");
  if (item.id === order.finished_item_id) throw moError(400, "MFG_MO_VALIDATION_FAILED", "An order does not consume its own product.");
  const amount = quantity(input.quantity);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why extra material is needed.");
  await client.query(`INSERT INTO tenant.manufacturing_order_material_variances (organization_id, manufacturing_order_id, material_id, component_item_id, quantity, reason, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, order.id, material?.id ?? null, item.id, amount, reason, c.userId ?? null]);
  await event(client, c, order.id, "EXTRA_MATERIAL_REQUESTED", { summary: `${item.code} +${amount}: ${reason}` });
  return getManufacturingOrder(client, c, order.id);
}

// input: { decision: "APPROVE" | "REJECT", note? }. By someone other than the requester unless the company allows it.
export async function decideExtraMaterial(client, c, id, varianceId, input = {}) {
  needMo(c, MO.approveVariance);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "RELEASED", "IN_PROGRESS", "ON_HOLD");
  const variance = (await client.query(`SELECT * FROM tenant.manufacturing_order_material_variances WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, order.id, uuid(varianceId, "Request")])).rows[0];
  if (!variance) throw moError(404, "MFG_MO_NOT_FOUND", "That extra-material request was not found.");
  if (variance.status !== "REQUESTED") return getManufacturingOrder(client, c, order.id);
  const settings = await settingsOf(client, c);
  if (variance.requested_by === c.userId && !settings.varianceSelfApproval) throw moError(409, "MFG_MO_VARIANCE_SELF");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Approve or reject the request.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && (!note || note.length < 3)) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why the request is rejected.");
  if (decision === "APPROVE") {
    if (variance.material_id) {
      await client.query(`UPDATE tenant.manufacturing_order_materials SET authorized_extra_quantity = authorized_extra_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, variance.material_id, variance.quantity]);
    } else {
      const item = await loadItem(client, c.organizationId, variance.component_item_id);
      const next = (await client.query(`SELECT COALESCE(max(line_number), 0) + 1 AS n FROM tenant.manufacturing_order_materials WHERE manufacturing_order_id = $1`, [order.id])).rows[0].n;
      const line = (await client.query(
        `INSERT INTO tenant.manufacturing_order_materials (organization_id, manufacturing_order_id, line_number, origin, component_item_id, uom_id, kind, planned_quantity, authorized_extra_quantity)
         VALUES ($1,$2,$3,'EXTRA',$4,$5,'MATERIAL',0,$6) RETURNING id`, [c.organizationId, order.id, next, item.id, item.uom_id, variance.quantity])).rows[0];
      variance.material_id = line.id;
    }
  }
  await client.query(`UPDATE tenant.manufacturing_order_material_variances SET status = $3, decided_by = $4, decided_at = clock_timestamp(), decision_note = $5, material_id = COALESCE(material_id, $6)
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, variance.id, decision === "APPROVE" ? "APPROVED" : "REJECTED", c.userId ?? null, note, variance.material_id]);
  await event(client, c, order.id, decision === "APPROVE" ? "EXTRA_MATERIAL_APPROVED" : "EXTRA_MATERIAL_REJECTED", { summary: `${q(D(variance.quantity))}${note ? `: ${note}` : ""}` });
  return getManufacturingOrder(client, c, order.id);
}

// ------------------------------------------------------------------ production
// Start a released order. With materials not fully reserved or issued, only someone who may approve variances starts it, with a reason.
// input: { allowPartial?, reason? }
export async function startManufacturingProduction(client, c, id, input = {}) {
  needMo(c, MO.start);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status === "IN_PROGRESS") return getManufacturingOrder(client, c, order.id);
  requireStatus(order, "RELEASED");
  versionCheck(order, input.expectedVersion);
  const materials = await materialView(client, c, order);
  let partial = null;
  if (readinessOf(materials) !== "READY") {
    const short = materials.filter((row) => !["ISSUED", "RESERVED"].includes(row.readiness)).map((row) => `${row.code} (${row.shortage} short)`);
    if (!input.allowPartial) throw moError(409, "MFG_MO_MATERIALS_NOT_READY", `Not reserved or issued in full: ${short.join(", ")}. Reserve them, or start with a partial batch if a manager permits it.`, { short });
    needMo(c, MO.approveVariance);
    partial = text(input.reason, 1000);
    if (partial.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why production starts without all materials.");
  }
  await setStatus(client, c, order, "IN_PROGRESS", { actual_start_at: new Date(), started_by: c.userId ?? null, partial_start_reason: partial }, { action: "STARTED", summary: partial ? `Partial start: ${partial}` : null });
  return getManufacturingOrder(client, c, order.id);
}

// Output, quality and finished goods: see Partial Production (one path — production entries, decisions, receipts that name their entries).
export { decideManufacturingQuality, produceThroughEntry as recordManufacturingProduction } from "../production/production-service.js";

// The order's "Receive goods" (input: { quantity, productionEntryId?, batchNumber?, expiresOn?, serialNumbers?, idempotencyKey }): a finished-goods
// receipt note created and posted at once through the one receipt posting path. Whoever may receive an order's goods may do this.
export async function receiveManufacturedGoods(client, c, id, input = {}) {
  needMo(c, MO.receive);
  if (!has(c, "stock.receive")) throw moError(403, "MFG_MO_PERMISSION_DENIED", "Inventory: you also need permission to receive stock.");
  const { receiveThroughNote } = await import("../receipts/fgr-service.js");
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.fgr.view", "manufacturing.fgr.create", "manufacturing.fgr.post"])] };
  const result = await receiveThroughNote(client, ctx, id, input);
  return { ...result, order: await getManufacturingOrder(client, c, id) };
}

// ------------------------------------------------------------------ completion
// input: { shortCloseReason?, consumeRemaining?, expectedVersion? }. Every obligation reconciled: nothing awaits inspection, all accepted
// output is received, material in production is used or returned (or declared used), no open request or exception; output short of the
// plan needs a reason from someone who may approve variances. Reservations are released and work in progress left over is closed to
// manufacturing variance.
export async function completeManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.complete);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status === "COMPLETED") return getManufacturingOrder(client, c, order.id);
  // An order waiting for its short close to be approved completes only through that approval.
  if (order.status === "COMPLETION_PENDING" && !input.approvedShortClose) throw moError(409, "MFG_MO_STATE_INVALID", `${order.mo_number}'s short close waits for approval.`);
  if (order.status !== "COMPLETION_PENDING") requireStatus(order, "IN_PROGRESS");
  versionCheck(order, input.expectedVersion);
  const materials = await loadMaterials(client, c, order.id, { lock: true });
  const blockers = [];
  if (D(order.pending_inspection_quantity) > ZERO) blockers.push(`${q(D(order.pending_inspection_quantity))} output awaits a quality decision.`);
  const unreceived = sub(D(order.accepted_quantity), D(order.received_quantity));
  if (unreceived > ZERO) blockers.push(`${q(unreceived)} accepted output has not been received into stock.`);
  const variances = Number((await client.query(`SELECT count(*) AS n FROM tenant.manufacturing_order_material_variances WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'REQUESTED'`,
    [c.organizationId, order.id])).rows[0].n);
  if (variances) blockers.push(`${variances} extra-material request(s) await a decision.`);
  const exceptions = (await client.query(`SELECT category, reason FROM tenant.manufacturing_order_exceptions WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'OPEN'`,
    [c.organizationId, order.id])).rows;
  if (exceptions.length) blockers.push(`Open exception: ${exceptions.map((row) => row.reason).join("; ")}.`);
  // Notes not yet settled: consumption waiting to post or for an approval, and any issue or consumption whose posting needs recovery.
  const notes = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.manufacturing_material_consumptions WHERE manufacturing_order_id = $2 AND organization_id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL'))::int AS consumption_open,
            (SELECT count(*) FROM tenant.manufacturing_material_consumptions WHERE manufacturing_order_id = $2 AND organization_id = $1 AND status = 'RECOVERY_REQUIRED')::int AS consumption_recovery,
            (SELECT count(*) FROM tenant.manufacturing_material_issues WHERE manufacturing_order_id = $2 AND organization_id = $1 AND status = 'RECOVERY_REQUIRED')::int AS issue_recovery,
            (SELECT count(*) FROM tenant.manufacturing_finished_goods_receipts WHERE manufacturing_order_id = $2 AND organization_id = $1 AND status IN ('DRAFT', 'PENDING_APPROVAL'))::int AS receipt_open,
            (SELECT count(*) FROM tenant.manufacturing_finished_goods_receipts WHERE manufacturing_order_id = $2 AND organization_id = $1
               AND (status = 'RECOVERY_REQUIRED' OR correction_status = 'REQUESTED'))::int AS receipt_unsettled,
            (SELECT count(*) FROM tenant.manufacturing_scraps WHERE manufacturing_order_id = $2 AND organization_id = $1
               AND (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RECOVERY_REQUIRED') OR correction_status = 'REQUESTED'))::int AS scrap_unsettled`,
    [c.organizationId, order.id])).rows[0];
  if (notes.consumption_open) blockers.push(`${notes.consumption_open} consumption note(s) are not posted: post or cancel them.`);
  if (notes.receipt_open) blockers.push(`${notes.receipt_open} finished-goods receipt(s) are not posted: post or cancel them.`);
  if (notes.receipt_unsettled) blockers.push("A finished-goods receipt waits for a correction decision or needs recovery first.");
  if (notes.scrap_unsettled) blockers.push(`${notes.scrap_unsettled} scrap note(s) are not settled: post or cancel them, and decide any correction.`);
  const entries = (await client.query(`SELECT count(*) FILTER (WHERE status = 'DRAFT')::int AS drafts, count(*) FILTER (WHERE status = 'RECOVERY_REQUIRED')::int AS recovery
      FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2`, [c.organizationId, order.id])).rows[0];
  if (entries.drafts) blockers.push(`${entries.drafts} production entr${entries.drafts === 1 ? "y is" : "ies are"} still a draft: post or cancel ${entries.drafts === 1 ? "it" : "them"}.`);
  if (entries.recovery) blockers.push("A production entry disagrees with its records and needs recovery first.");
  if (notes.consumption_recovery || notes.issue_recovery) blockers.push("An issue or consumption posting disagrees with its records and needs recovery first.");
  const inCustody = materials.filter((line) => lineFigures(line).custody > ZERO);
  if (inCustody.length && !input.consumeRemaining) blockers.push(`Material is still in production: ${inCustody.map((line) => `${line.item_code} ${q(lineFigures(line).custody)}`).join(", ")} — return it or record it as used.`);
  const short = D(order.accepted_quantity) < D(order.planned_base_quantity);
  const shortReason = text(input.shortCloseReason, 1000);
  if (short) {
    if (shortReason.length < 3) blockers.push(`Only ${q(D(order.accepted_quantity))} of ${q(D(order.planned_base_quantity))} accepted: give a reason to close the order short.`);
    else if (!has(c, MO.approveVariance)) blockers.push("Closing an order short needs someone who may approve variances.");
  }
  if (blockers.length) throw moError(409, "MFG_MO_COMPLETION_BLOCKED", blockers[0], { blockers });
  // The authorized closing disposition: what is still in production is declared used, on a closing consumption note against its issued stock.
  if (inCustody.length) {
    const closing = { ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.consumption.view", "manufacturing.consumption.create", "manufacturing.consumption.post"])] };
    await consumeThroughNote(client, closing, order.id, { lines: inCustody.map((line) => ({ materialId: line.id, quantity: q(lineFigures(line).custody) })), note: "Declared used at completion" },
      { kind: "CLOSING", key: `mo-close:${order.id}` });
  }
  await releaseReservations(client, c, order);
  const residual = wipBalance(order);
  const journal = residual === ZERO ? null : await postJournal(client, c, { event: "manufacturing_order_close", sourceType: "manufacturing_order", sourceId: order.id, sourceNumber: order.mo_number,
    reference: order.mo_number, description: `${order.mo_number} closed: material beyond (or below) the recipe`,
    lines: residual > ZERO
      ? [{ mappingKey: "manufacturing_variance", label: "Manufacturing variance", debit: residual }, { mappingKey: "wip", label: "Work in progress", credit: residual }]
      : [{ mappingKey: "wip", label: "Work in progress", debit: -residual }, { mappingKey: "manufacturing_variance", label: "Manufacturing variance", credit: -residual }] });
  const summary = {
    planned: q(D(order.planned_base_quantity)), accepted: q(D(order.accepted_quantity)), rejected: q(D(order.rejected_quantity)), received: q(D(order.received_quantity)),
    shortfall: q(max(sub(D(order.planned_base_quantity), D(order.accepted_quantity)), ZERO)), shortCloseReason: short ? shortReason : null,
    materials: materials.map((line) => ({ code: line.item_code, planned: q(D(line.planned_quantity)), extra: q(D(line.authorized_extra_quantity)), consumed: q(D(line.consumed_quantity)),
      returned: q(D(line.returned_quantity)), netCost: money(sub(D(line.issued_cost), D(line.returned_cost))) })),
    cost: { actualMaterial: money(D(order.wip_material_cost)), capitalised: money(D(order.wip_capitalised_cost)), variance: money(residual), journalEntryId: journal },
  };
  await setStatus(client, c, order, "COMPLETED", { completed_at: new Date(), completed_by: c.userId ?? null, short_close_reason: short ? shortReason : null, completion_summary: JSON.stringify(summary),
    wip_variance_cost: money(add(D(order.wip_variance_cost), residual)) }, { action: short ? "CLOSED_SHORT" : "COMPLETED", summary: short ? shortReason : `Variance ₹${money(residual)}`, details: summary });
  return getManufacturingOrder(client, c, order.id);
}

// ------------------------------------------------------------------ short close: requested, then approved by someone else
// input: { reason }. Everything else that completion needs must already hold (a dry run of its checks); the order waits in COMPLETION_PENDING,
// where no ordinary production, issue or consumption happens. The plan is never rewritten: the shortfall is recorded beside it.
export async function requestShortClose(client, c, id, input = {}) {
  needMo(c, MO.complete);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "IN_PROGRESS");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why the order closes short.");
  if (D(order.accepted_quantity) >= D(order.planned_base_quantity)) throw moError(409, "MFG_MO_STATE_INVALID", `${order.mo_number} has accepted its full plan: complete it instead.`);
  // Dry run: every completion check except the short-close authority (the transaction is rolled back to here either way).
  await client.query("SAVEPOINT short_close_check");
  let blockers = [];
  try {
    await completeManufacturingOrder(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), MO.complete, MO.approveVariance])] }, order.id,
      { shortCloseReason: reason, consumeRemaining: input.consumeRemaining });
  } catch (error) {
    blockers = error.details?.blockers ?? [error.message];
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT short_close_check");
  }
  if (blockers.length) throw moError(409, "MFG_MO_COMPLETION_BLOCKED", blockers[0], { blockers });
  const fresh = await loadOrder(client, c, order.id, { lock: true });
  await setStatus(client, c, fresh, "COMPLETION_PENDING", { short_close_requested_by: c.userId ?? null, short_close_requested_at: new Date(), short_close_request_reason: reason },
    { action: "SHORT_CLOSE_REQUESTED", summary: `${q(D(fresh.accepted_quantity))} of ${q(D(fresh.planned_base_quantity))} accepted: ${reason}` });
  return getManufacturingOrder(client, c, order.id);
}
// input: { decision: APPROVE | REJECT, note?, consumeRemaining? }. Approval completes the order short (reservations released, work in
// progress left closed to variance); rejection returns it to production.
export async function decideShortClose(client, c, id, input = {}) {
  needMo(c, MO.approveVariance);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "COMPLETION_PENDING");
  const settings = await settingsOf(client, c);
  if (order.short_close_requested_by === c.userId && !settings.selfApproval) throw moError(409, "MFG_MO_APPROVAL_SELF", "Someone other than the person who asked approves the short close.");
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Approve or reject the short close.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why production continues.");
    await setStatus(client, c, order, "IN_PROGRESS", {}, { action: "SHORT_CLOSE_REJECTED", summary: note });
    return getManufacturingOrder(client, c, order.id);
  }
  return completeManufacturingOrder(client, c, order.id, { shortCloseReason: `${order.short_close_request_reason}${note ? ` (approved: ${note})` : ""}`, consumeRemaining: input.consumeRemaining, approvedShortClose: true });
}

// ------------------------------------------------------------------ shortages, subassemblies, exceptions
// Shortages handed to Procurement as demand (never a purchase order), net of what is already requested for each material line: see
// Material Availability. input: { materialIds?, idempotencyKey? }
export async function handOffManufacturingShortages(client, c, id, input = {}) {
  const { requestMaterialShortages } = await import("../availability/material-availability.js");
  const result = await requestMaterialShortages(client, c, id, { materialIds: input.materialIds, idempotencyKey: input.idempotencyKey });
  return { created: result.created, existing: result.existing, message: result.message ?? null, order: await getManufacturingOrder(client, c, id) };
}

// A linked order to make a subassembly this order consumes, into the material warehouse it is issued from. input: { quantity? } (default: the shortage)
export async function createSubassemblyOrder(client, c, id, materialId, input = {}) {
  needMo(c, MO.create);
  const parent = await loadOrder(client, c, id);
  requireStatus(parent, "RELEASED", "IN_PROGRESS", "ON_HOLD");
  const line = (await materialView(client, c, parent)).find((row) => row.id === materialId);
  if (!line) throw moError(404, "MFG_MO_NOT_FOUND", "That material line is not on this order.");
  if (!(await resolveEffectiveBom(client, c.organizationId, line.itemId))) throw moError(409, "MFG_MO_BOM_NOT_ELIGIBLE", `${line.code} has no effective BOM to make it from.`);
  const amount = input.quantity ? quantity(input.quantity) : D(line.shortage) > ZERO ? line.shortage : line.remainingToIssue;
  if (!(Number(amount) > 0)) throw moError(400, "MFG_MO_QUANTITY_INVALID", `${line.code}: nothing is short; enter the quantity to make.`);
  const now = new Date();
  const due = new Date(parent.planned_start_at) > now ? new Date(parent.planned_start_at) : now;
  return createManufacturingOrder(client, c, { finishedItemId: line.itemId, plannedQuantity: amount, uomId: line.uomId, manufacturingWarehouseId: parent.manufacturing_warehouse_id,
    materialWarehouseId: parent.material_warehouse_id, finishedGoodsWarehouseId: parent.material_warehouse_id, plannedStartAt: now.toISOString(), plannedEndAt: due.toISOString(),
    priority: parent.priority, parentOrderId: parent.id, parentMaterialId: line.id, notes: `Subassembly for ${parent.mo_number}`, idempotencyKey: input.idempotencyKey });
}

const CATEGORIES = new Set(["MATERIAL_SHORTAGE", "QUALITY_ISSUE", "EQUIPMENT_DOWNTIME", "PRIORITY_CHANGE", "COST_VARIANCE", "QUANTITY_VARIANCE", "POSTING_FAILURE", "OTHER"]);
// An exception blocks completion until resolved. input: { category, reason, quantity? }
export async function raiseManufacturingException(client, c, id, input = {}) {
  needMo(c, MO.hold);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "RELEASED", "IN_PROGRESS", "ON_HOLD");
  const category = String(input.category ?? "OTHER").toUpperCase();
  if (!CATEGORIES.has(category)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Choose the kind of exception.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Describe the exception.");
  await client.query(`INSERT INTO tenant.manufacturing_order_exceptions (organization_id, manufacturing_order_id, category, reason, quantity, raised_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, order.id, category, reason, input.quantity ? quantity(input.quantity) : null, c.userId ?? null]);
  await event(client, c, order.id, "EXCEPTION_RAISED", { summary: `${category.toLowerCase().replace(/_/g, " ")}: ${reason}` });
  return getManufacturingOrder(client, c, order.id);
}
export async function resolveManufacturingException(client, c, id, exceptionId, input = {}) {
  needMo(c, MO.hold);
  const order = await loadOrder(client, c, id, { lock: true });
  const resolution = text(input.resolution, 1000);
  if (resolution.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say how it was resolved.");
  const row = (await client.query(`UPDATE tenant.manufacturing_order_exceptions SET status = 'RESOLVED', resolved_by = $4, resolved_at = clock_timestamp(), resolution = $5
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND id = $3 AND status = 'OPEN' AND (source_type IS DISTINCT FROM 'hold' OR $6) RETURNING reason`,
    [c.organizationId, order.id, uuid(exceptionId, "Exception"), c.userId ?? null, resolution, order.status !== "ON_HOLD"])).rows[0];
  if (!row) throw moError(409, "MFG_MO_STATE_INVALID", "That exception is resolved already, or it is the hold itself (resume the order to resolve it).");
  await event(client, c, order.id, "EXCEPTION_RESOLVED", { summary: `${row.reason} → ${resolution}` });
  return getManufacturingOrder(client, c, order.id);
}

export { EXECUTING, LIVE, max, min };
