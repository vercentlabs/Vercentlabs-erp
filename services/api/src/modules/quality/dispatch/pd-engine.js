// Quality — Inspection Linked to Delivery: the Sales delivery adapter of the inspection engine. A pre-dispatch control point checks an
// actual delivery line (the goods picked for one customer shipment) before it leaves; Final Inspection never stands in for it.
//
//   trigger     when a delivery is marked ready to dispatch, the pre-dispatch control points of each stock line decide what to inspect: one
//               requirement and one inspection per line and control point, bound to the delivery, its order, the line (by its sales order
//               line: editing a draft delivery re-creates its lines) and the frozen control point and specification versions. Marking it ready again re-uses them: while nothing is decided the inspected quantity
//               follows the line; once Quality decided, the line can't exceed what was inspected. A missing specification or two equally
//               specific points is a visible exception that clears nothing.
//   gate        enforced by Sales in dispatch (fail-closed: an exception or an open requirement clears nothing): a line under a blocking
//               check leaves only up to what Quality cleared; a delivery that skipped "ready" while a blocking check applies is refused.
//   rejection   units Quality rejects stay in the warehouse on an Inventory quality hold case (opened from the disposition), so no other
//               delivery, transfer or POS sale takes them. Inventory releases or disposes of them through that case.
// Quality decides; Sales keeps the delivery quantities and Inventory keeps the stock.
import { qx, recordEvent } from "../common.js";
import { matchControlPoints, recordQcpEvent, specificationForControlPoint } from "../control-points/qcp-engine.js";
import { ensureMirrorPlan, recordSpecException } from "../specifications/qs-resolver.js";
import { EPS, has, inError, round6 } from "../incoming/in-rules.js";

export const DISPATCH_TRIGGER = "SALES_DELIVERY_READY_FOR_DISPATCH";
const blocks = (v) => v.requirement_type === "MANDATORY" && v.gate_type === "BLOCK_DISPATCH";
const describe = (x) => ({ controlPointId: x.version.control_point_id, code: x.version.qcp_code, name: x.version.name, version: x.version.version_number, versionId: x.version.id,
  requirement: x.version.requirement_type, gate: x.version.gate_type, mode: x.version.match_mode, purpose: x.version.purpose_code, trigger: x.version.trigger_event });
const dayOf = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

async function deliveryOf(client, c, deliveryId) {
  const row = (await client.query(`SELECT d.id, d.request_number, d.sales_order_id, d.party_id, d.warehouse_id, d.delivery_status, o.sales_order_number, p.display_name AS customer_name
      FROM tenant.sales_fulfillment_requests d JOIN tenant.sales_orders o ON o.id = d.sales_order_id LEFT JOIN tenant.business_parties p ON p.id = d.party_id
     WHERE d.organization_id = $1 AND d.id = $2`, [c.organizationId, deliveryId])).rows[0];
  if (!row) throw inError(404, "QUALITY_DISPATCH_DELIVERY_INVALID", "That delivery was not found.");
  return row;
}
// The delivery's stock lines (services and untracked items are never inspected here).
async function stockLines(client, c, deliveryId) {
  return (await client.query(`SELECT line.id, line.sales_order_line_id, line.item_id, line.warehouse_id, line.quantity, line.base_quantity, line.item_name_snapshot, line.sequence
      FROM tenant.sales_delivery_lines line JOIN tenant.items item ON item.id = line.item_id
     WHERE line.organization_id = $1 AND line.delivery_id = $2 AND COALESCE(item.track_inventory, false) AND item.item_type <> 'service' ORDER BY line.sequence NULLS LAST, line.created_at`,
  [c.organizationId, deliveryId])).rows;
}
const lineQuantity = (line) => round6(Number(line.base_quantity ?? line.quantity));
// A delivery line's requirements: by the delivery and the sales order line it delivers.
async function lineObligations(client, c, deliveryId, orderLineId, { lock = false } = {}) {
  return (await qx(client, `SELECT o.*, p.qcp_code FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      WHERE o.organization_id = $1 AND o.source_type = 'sales_delivery_line' AND o.source_document_id = $2 AND o.source_line_id = $3 AND o.status <> 'CANCELLED'
      ORDER BY o.created_at${lock ? " FOR UPDATE OF o" : ""}`, [c.organizationId, deliveryId, orderLineId])).rows;
}
// Every inspection of a requirement: the original and its reinspections.
async function familyOf(client, obligationId) {
  return (await qx(client, `WITH RECURSIVE chain AS (SELECT id FROM tenant.quality_inspections WHERE obligation_id = $1 AND reinspection_of_id IS NULL
      UNION ALL SELECT i.id FROM tenant.quality_inspections i JOIN chain ON i.reinspection_of_id = chain.id) SELECT id FROM chain`, [obligationId])).rows.map((r) => r.id);
}
async function decidedOn(client, obligationId) {
  const family = await familyOf(client, obligationId);
  if (!family.length) return { family, decided: 0 };
  const row = (await client.query(`SELECT COALESCE(sum(accept_quantity + conditional_quantity + reject_quantity + reinspect_quantity + rework_quantity), 0) AS q
      FROM tenant.quality_dispositions WHERE inspection_id = ANY($1::uuid[])`, [family])).rows[0];
  return { family, decided: round6(Number(row.q)) };
}

export async function planDeliveryLineQuality(client, c, { line, date = null }) {
  const match = await matchControlPoints(client, c, { trigger: DISPATCH_TRIGGER, itemId: line.item_id, warehouseId: line.warehouse_id, date });
  const blocking = match.selected.some((x) => blocks(x.version)) || match.conflicts.some((k) => k.candidates.some((x) => blocks(x.version)));
  return { ...match, blocking };
}

// ------------------------------------------------------------------ requirements and inspections when a delivery is ready
// Idempotent per delivery line and control point. Called by Sales after the delivery became Ready to dispatch.
export async function createDeliveryObligations(client, c, { deliveryId }) {
  const delivery = await deliveryOf(client, c, deliveryId);
  const out = { obligationIds: [], inspectionIds: [] };
  const date = dayOf(new Date());
  for (const line of await stockLines(client, c, delivery.id)) {
    const quantity = lineQuantity(line);
    const existing = await lineObligations(client, c, delivery.id, line.sales_order_line_id, { lock: true });
    for (const ob of existing) await followLineQuantity(client, c, ob, { line, quantity });
    const plan = await planDeliveryLineQuality(client, c, { line, date });
    if (!plan.candidates.length) continue;
    const label = `${delivery.request_number} · ${line.item_name_snapshot}`;
    const key = `sales_delivery:${delivery.id}:${line.sales_order_line_id}`;
    const insert = async (x, fields) => {
      const v = x.version;
      const row = (await qx(client, `INSERT INTO tenant.quality_inspection_obligations (organization_id, control_point_id, qcp_version_id, spec_version_id, source_type, source_document_id,
          source_line_id, source_label, source_event_key, purpose_code, item_id, warehouse_id, controlled_quantity, blocking, status, exception_code, resolution, created_by)
        VALUES ($1, $2, $3, $4, 'sales_delivery_line', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
        ON CONFLICT (organization_id, source_event_key, control_point_id) WHERE status <> 'CANCELLED' DO NOTHING RETURNING *`,
      [c.organizationId, v.control_point_id, v.id, fields.specVersionId ?? null, delivery.id, line.sales_order_line_id, label.slice(0, 200), key, v.purpose_code, line.item_id, line.warehouse_id,
        String(quantity), blocks(v), fields.status, fields.exceptionCode ?? null,
        JSON.stringify({ ...describe(x), date, deliveryId: delivery.id, orderId: delivery.sales_order_id, checkpoint: "PRE_DISPATCH", ...fields.resolution }), c.userId ?? null])).rows[0];
      if (!row) return null;
      out.obligationIds.push(row.id);
      await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: v.id, obligationId: row.id, action: "REQUIREMENT_CREATED", to: row.status, details: { source: label } });
      return row;
    };
    let missing = false;
    for (const x of plan.selected) {
      if (existing.some((o) => o.control_point_id === x.version.control_point_id)) continue;
      const spec = await specificationForControlPoint(client, c, x.version, { itemId: line.item_id, supplierId: null, warehouseId: line.warehouse_id, date });
      const ob = await insert(x, spec.versionId ? { status: "PENDING", specVersionId: spec.versionId, resolution: { specification: spec.method } }
        : { status: "EXCEPTION", exceptionCode: "SPEC_MISSING", resolution: { problem: spec.reason } });
      if (!ob) continue;
      if (!spec.versionId) {
        missing = true;
        await recordSpecException(client, c, { code: "SPEC_MISSING", stage: "PRE_DISPATCH", itemId: line.item_id, warehouseId: line.warehouse_id, sourceType: "sales_delivery_line",
          sourceId: delivery.id, sourceLineId: line.sales_order_line_id, sourceLabel: label, detail: { controlPoint: x.version.qcp_code, problem: spec.reason }, controlPointId: x.version.control_point_id, obligationId: ob.id });
        continue;
      }
      out.inspectionIds.push(await openDeliveryInspection(client, c, ob, { delivery, line, quantity, checkpoint: "PRE_DISPATCH", key: `${key}:${x.version.control_point_id}`,
        resolution: { method: "CONTROL_POINT", controlPoint: x.version.qcp_code, controlPointVersion: x.version.version_number, binding: x.version.spec_binding, date, ...(spec.trace ?? {}) } }));
    }
    for (const k of plan.conflicts) {
      for (const x of k.candidates) {
        if (existing.some((o) => o.control_point_id === x.version.control_point_id)) continue;
        const ob = await insert(x, { status: "EXCEPTION", exceptionCode: "RULE_CONFLICT", resolution: { problem: "Two equally specific control points apply", others: k.candidates.map((y) => y.version.qcp_code) } });
        if (ob) await recordSpecException(client, c, { code: "APPLICABILITY_CONFLICT", stage: "PRE_DISPATCH", itemId: line.item_id, warehouseId: line.warehouse_id, sourceType: "sales_delivery_line",
          sourceId: delivery.id, sourceLineId: line.sales_order_line_id, sourceLabel: label, detail: { controlPoints: k.candidates.map((y) => y.version.qcp_code), purpose: k.purpose },
          controlPointId: x.version.control_point_id, obligationId: ob.id });
      }
    }
    const outcome = plan.conflicts.length ? "CONFLICT" : missing ? "SPEC_MISSING" : out.obligationIds.length ? "REQUIREMENTS_CREATED" : "ALREADY_EVALUATED";
    await client.query(`INSERT INTO tenant.quality_qcp_evaluations (organization_id, trigger_event, source_type, source_document_id, source_line_id, source_label, effective_date, outcome, candidates,
        obligation_ids, forced_hold, details, actor_user_id) VALUES ($1, $2, 'sales_delivery_line', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)`,
    [c.organizationId, DISPATCH_TRIGGER, delivery.id, line.sales_order_line_id, label, date, outcome, JSON.stringify(plan.candidates.map(describe)), out.obligationIds, plan.blocking,
      JSON.stringify({ quantity: String(quantity) }), c.userId ?? null]);
  }
  return out;
}

// The line changed while the delivery was back in draft: an undecided requirement follows it; a decided one keeps what was inspected, and the
// line can't go beyond it (the rest ships on another delivery, inspected there).
async function followLineQuantity(client, c, ob, { line, quantity }) {
  const controlled = round6(Number(ob.controlled_quantity));
  if (Math.abs(controlled - quantity) <= EPS) return;
  const { family, decided } = await decidedOn(client, ob.id);
  if (decided > EPS) {
    if (quantity > controlled + EPS)
      throw inError(409, "QUALITY_DISPATCH_QUANTITY_MISMATCH", `Quality inspected ${controlled} of ${line.item_name_snapshot} on this delivery and has decided on it: the line can't go above ${controlled}. Ship the rest on another delivery.`,
        { controlled, decided });
    return;
  }
  await client.query(`UPDATE tenant.quality_inspection_obligations SET controlled_quantity = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ob.id, String(quantity)]);
  for (const id of family) {
    await client.query(`UPDATE tenant.quality_inspections SET lot_quantity = $2, row_version = row_version + 1, updated_at = now() WHERE id = $1 AND disposition_status = 'NONE'`, [id, String(quantity)]);
    await client.query(`UPDATE tenant.quality_dispatch_contexts SET line_quantity = $2 WHERE inspection_id = $1`, [id, String(quantity)]);
    await recordEvent(client, c, "inspection", id, "quality.dispatch.source_changed", { reason: `The delivery line changed from ${controlled} to ${quantity}` });
  }
  await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "SOURCE_CORRECTED", from: ob.status, to: ob.status,
    details: { from: String(controlled), to: String(quantity) } });
}

// The inspection of a delivery line with its frozen delivery context.
export async function openDeliveryInspection(client, c, ob, { delivery, line, quantity, checkpoint, key = null, resolution }) {
  const { createInspection } = await import("../inspections.js");
  const planId = await ensureMirrorPlan(client, c, ob.spec_version_id);
  const inspection = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: "pre_dispatch", sourceType: "sales_delivery", sourceId: delivery.id, itemId: line.item_id, warehouseId: line.warehouse_id,
    lotQuantity: String(quantity), specResolution: resolution, population: { controlled: String(quantity), requirement: ob.id, delivery: delivery.request_number, order: delivery.sales_order_number },
  }, { boundVersionId: ob.spec_version_id, allowPendingSample: true, obligationId: ob.id, qcpVersionId: ob.qcp_version_id });
  await client.query(`UPDATE tenant.quality_inspection_obligations SET inspection_id = $2, status = 'PENDING', exception_code = NULL, updated_at = clock_timestamp(), row_version = row_version + 1
    WHERE id = $1 AND inspection_id IS NULL`, [ob.id, inspection.id]);
  await insertDispatchContext(client, c, inspection.id, { delivery, line, quantity, checkpoint, key });
  return inspection.id;
}
export async function insertDispatchContext(client, c, inspectionId, { delivery, line, quantity, checkpoint, key = null }) {
  await client.query(`INSERT INTO tenant.quality_dispatch_contexts (inspection_id, organization_id, delivery_id, sales_order_line_id, sales_order_id, delivery_number, order_number, customer_id,
      customer_name, warehouse_id, line_quantity, checkpoint_type, source_event_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [inspectionId, c.organizationId, delivery.id, line.sales_order_line_id, delivery.sales_order_id, delivery.request_number, delivery.sales_order_number, delivery.party_id ?? null, delivery.customer_name ?? null,
    line.warehouse_id, String(quantity), checkpoint, key]);
  await recordEvent(client, c, "inspection", inspectionId, "quality.dispatch.context", { delivery: delivery.request_number, order: delivery.sales_order_number, checkpoint });
}
// A reinspection carries the original's delivery context.
export async function copyDispatchContext(client, c, originalId, reinspectionId) {
  await client.query(`INSERT INTO tenant.quality_dispatch_contexts (inspection_id, organization_id, delivery_id, sales_order_line_id, sales_order_id, delivery_number, order_number, customer_id,
      customer_name, warehouse_id, line_quantity, checkpoint_type)
    SELECT $2, organization_id, delivery_id, sales_order_line_id, sales_order_id, delivery_number, order_number, customer_id, customer_name, warehouse_id, line_quantity, 'REINSPECTION'
      FROM tenant.quality_dispatch_contexts WHERE inspection_id = $1 ON CONFLICT (inspection_id) DO NOTHING`, [originalId, reinspectionId]);
}

// ------------------------------------------------------------------ the gate (called by Sales in dispatch)
// What every blocking requirement on a delivery's line allows to leave (null: none applies).
export async function dispatchAllowance(client, c, deliveryId, orderLineId) {
  const rows = (await lineObligations(client, c, deliveryId, orderLineId)).filter((o) => o.blocking);
  if (!rows.length) return null;
  return { allowance: Math.min(...rows.map((o) => (o.status === "EXCEPTION" ? 0 : Number(o.allowance_quantity ?? 0)))), open: rows.filter((o) => ["PENDING", "EXCEPTION"].includes(o.status)), rows };
}
export async function assertDispatchClearance(client, c, { deliveryId }) {
  const delivery = await deliveryOf(client, c, deliveryId);
  for (const line of await stockLines(client, c, delivery.id)) {
    const quantity = lineQuantity(line);
    const gate = await dispatchAllowance(client, c, delivery.id, line.sales_order_line_id);
    if (!gate) {
      const plan = await planDeliveryLineQuality(client, c, { line });
      if (plan.blocking) {
        const codes = [...new Set([...plan.selected, ...plan.conflicts.flatMap((k) => k.candidates)].filter((x) => blocks(x.version)).map((x) => x.version.qcp_code))];
        throw inError(409, "QUALITY_DISPATCH_GATE_ACTIVE", `${line.item_name_snapshot} is checked by Quality before dispatch (${codes.join(", ")}): mark the delivery ready to dispatch so Quality can inspect it.`,
          { line: line.id, controlPoints: codes });
      }
      continue;
    }
    if (quantity > gate.allowance + EPS) {
      const pending = [...new Set(gate.open.map((o) => o.qcp_code))];
      throw inError(409, "QUALITY_DISPATCH_GATE_ACTIVE", pending.length
        ? `${line.item_name_snapshot} is awaiting Quality's pre-dispatch clearance (${pending.join(", ")}).`
        : `Quality cleared ${round6(gate.allowance)} of the ${quantity} ${line.item_name_snapshot} on this delivery. Return it to draft and reduce the line to ${round6(gate.allowance)}; rejected units stay on Quality hold.`,
      { line: line.id, allowance: gate.allowance, quantity, pending });
    }
  }
}

// ------------------------------------------------------------------ the delivery is cancelled
// Undecided requirements end and their open inspections are cancelled; anything Quality already decided stays as evidence (a hold case it
// opened is Inventory's to resolve).
export async function cancelDeliveryObligations(client, c, { deliveryId, reason }) {
  const rows = (await qx(client, `SELECT o.* FROM tenant.quality_inspection_obligations o WHERE o.organization_id = $1 AND o.source_type = 'sales_delivery_line' AND o.source_document_id = $2
      AND o.status <> 'CANCELLED' FOR UPDATE`, [c.organizationId, deliveryId])).rows;
  for (const ob of rows) {
    const { family, decided } = await decidedOn(client, ob.id);
    if (decided > EPS) continue;
    await client.query(`UPDATE tenant.quality_inspection_obligations SET status = 'CANCELLED', outcome_label = 'Delivery cancelled', updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ob.id]);
    for (const id of family) {
      const cancelled = (await client.query(`UPDATE tenant.quality_inspections SET workflow_status = 'CANCELLED', status = 'cancelled', cancel_reason = $2, row_version = row_version + 1, updated_at = now()
          WHERE id = $1 AND disposition_status = 'NONE' AND workflow_status <> 'CANCELLED' RETURNING id`, [id, `The delivery was cancelled${reason ? `: ${reason}` : ""}`])).rows[0];
      if (cancelled) await recordEvent(client, c, "inspection", id, "quality.dispatch.source_cancelled", { reason: reason ?? "The delivery was cancelled" });
    }
    await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "SOURCE_CORRECTED", from: ob.status, to: "CANCELLED", details: { reason: "Delivery cancelled" } });
  }
}

// ------------------------------------------------------------------ rejected units go on an Inventory hold
// Called by the disposition when a pre-dispatch decision rejects units. The case is opened from the stock reserved for the delivery line (where
// the picked goods are) by someone who may create holds, and placed at once when they may also place it (and give the delivery's reservation
// way); otherwise the draft case waits for Inventory to place it, and shows in the exceptions until it does. Never fails the disposition:
// savepoints keep the decision when the case can't be opened or placed.
export async function holdRejectedUnits(client, c, { inspection, disposition, quantity, reason }) {
  if (!(quantity > EPS)) return { holdId: null, waiting: null };
  if (!has(c, "stock.holds.create")) return { holdId: null, waiting: "Inventory puts the rejected units on a quality hold" };
  const ctx = (await client.query(`SELECT * FROM tenant.quality_dispatch_contexts WHERE inspection_id = $1`, [inspection.id])).rows[0];
  if (!ctx) return { holdId: null, waiting: "Inventory puts the rejected units on a quality hold" };
  // Where the picked goods are: the line's active reservations first, then the warehouse's available stock.
  const positions = (await client.query(`SELECT warehouse_location_id AS location_id, batch_id, sum(active_quantity) AS q FROM tenant.stock_reservations
      WHERE organization_id = $1 AND sales_order_line_id = $2 AND warehouse_id = $3 AND status = 'active' AND active_quantity > 0 GROUP BY 1, 2 ORDER BY q DESC`,
  [c.organizationId, ctx.sales_order_line_id, ctx.warehouse_id])).rows;
  if (!positions.length) positions.push(...(await client.query(`SELECT b.warehouse_location_id AS location_id, b.batch_id, sum(b.quantity) AS q FROM tenant.stock_balances b
      LEFT JOIN tenant.warehouse_locations l ON l.id = b.warehouse_location_id
     WHERE b.organization_id = $1 AND b.item_id = $2 AND b.warehouse_id = $3 AND b.quantity > 0 AND COALESCE(l.disposition, 'available') = 'available' GROUP BY 1, 2 ORDER BY 3 DESC`,
  [c.organizationId, inspection.item_id, ctx.warehouse_id])).rows);
  const lines = [];
  let left = round6(quantity);
  for (const p of positions) {
    if (left <= EPS) break;
    const take = round6(Math.min(left, Number(p.q)));
    lines.push({ itemId: inspection.item_id, quantity: String(take), sourceLocationId: p.location_id, batchId: p.batch_id, notes: `${disposition.disposition_number}: rejected before dispatch` });
    left = round6(left - take);
  }
  if (left > EPS || !lines.length) return { holdId: null, waiting: "Inventory locates the rejected units and puts them on a quality hold" };
  const { createStockHold, listHoldReasons, placeStockOnHold } = await import("../../stock/quality-holds.js");
  let hold;
  await client.query("SAVEPOINT quality_dispatch_hold");
  try {
    const reasonId = (await listHoldReasons(client, { ...c, permissions: [...(c.permissions ?? []), "stock.holds.view"] })).find((r) => r.code === "QUALITY_CONCERN")?.id;
    ({ hold } = await createStockHold(client, c, { holdType: "quality_hold", reasonId, warehouseId: ctx.warehouse_id, lines,
      notes: `Rejected at pre-dispatch inspection ${inspection.inspection_number} (${ctx.delivery_number}): ${reason}` }));
    await client.query(`UPDATE tenant.inventory_stock_holds SET source_document_type = 'quality_disposition', source_document_id = $2, source_document_number = $3 WHERE id = $1`,
      [hold.id, disposition.id, disposition.disposition_number]);
    await client.query("RELEASE SAVEPOINT quality_dispatch_hold");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT quality_dispatch_hold");
    return { holdId: null, waiting: `Inventory puts the rejected units on a quality hold (${error.message})` };
  }
  await client.query(`UPDATE tenant.quality_dispositions SET stock_hold_id = $2 WHERE id = $1`, [disposition.id, hold.id]);
  if (!has(c, "stock.holds.place")) return { holdId: hold.id, waiting: `Inventory places hold ${hold.number} on the rejected units` };
  await client.query("SAVEPOINT quality_dispatch_place");
  try {
    await placeStockOnHold(client, c, hold.id, {});
    await client.query("RELEASE SAVEPOINT quality_dispatch_place");
    return { holdId: hold.id, placed: true, waiting: null };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT quality_dispatch_place");
    return { holdId: hold.id, placed: false, waiting: `Inventory places the hold on the rejected units (${error.message})` };
  }
}
