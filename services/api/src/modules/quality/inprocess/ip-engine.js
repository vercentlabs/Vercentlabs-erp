// Quality — In-Process Inspection: the production adapter of the inspection engine. Manufacturing has no operation-level execution, so a
// production run (batch) and its reported output (production entry) are the population an in-process check controls; the operation is the
// control point's operation label.
//
//   trigger     after a production entry posts, the in-process control points of the finished item decide what to inspect:
//                 FIRST_PIECE           the first output of each run (one requirement per run);
//                 OPERATION_COMPLETION  every reported output;
//                 PERIODIC              each time the order's cumulative output passes another N units (one requirement per checkpoint).
//               Each requirement is bound to the exact control point and specification versions and opens its inspection; a missing
//               specification or two equally specific points are a visible exception that clears nothing.
//   gates       enforced by Manufacturing where production would advance (fail-safe: an exception or an open requirement clears nothing):
//                 assertProductionProgress   output is not reported as accepted while a blocking check applies, and a run whose first piece
//                                            awaits clearance takes no more output;
//                 assertProductionAcceptance an entry's output is accepted (final inspection) only up to what every blocking requirement on it
//                                            cleared.
// Quality decides; Manufacturing keeps the quantities and carries out scrap through its own quality decision.
import { qx, recordEvent } from "../common.js";
import { matchControlPoints, recordQcpEvent, specificationForControlPoint } from "../control-points/qcp-engine.js";
import { ensureMirrorPlan, recordSpecException } from "../specifications/qs-resolver.js";
import { inError, round6, EPS } from "../incoming/in-rules.js";

export const IP_TRIGGER = "PRODUCTION_OPERATION_READY_FOR_QC";
// Final inspection (MVP 33): the same adapter on finished output; its gate holds the output in production custody until Quality clears it.
export const FINAL_TRIGGER = "PRODUCTION_OUTPUT_READY_FOR_QC";
const TRIGGERS = [IP_TRIGGER, FINAL_TRIGGER];
const blocks = (v) => v.requirement_type === "MANDATORY" && ["BLOCK_PRODUCTION_PROGRESS", "HOLD_STOCK"].includes(v.gate_type);
const isFinal = (o) => o.resolution?.trigger === FINAL_TRIGGER || o.resolution?.checkpoint === "FINAL_OUTPUT";
const describe = (x) => ({ controlPointId: x.version.control_point_id, code: x.version.qcp_code, name: x.version.name, version: x.version.version_number, versionId: x.version.id,
  requirement: x.version.requirement_type, gate: x.version.gate_type, mode: x.version.match_mode, purpose: x.version.purpose_code, checkpoint: x.version.checkpoint_type ?? "OPERATION_COMPLETION",
  interval: x.version.checkpoint_interval === null ? null : Number(x.version.checkpoint_interval), operation: x.version.operation_label ?? null, trigger: x.version.trigger_event });
const dayOf = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

export async function planProductionQuality(client, c, { order, date = null, trigger = IP_TRIGGER }) {
  const match = await matchControlPoints(client, c, { trigger, itemId: order.finished_item_id, warehouseId: order.manufacturing_warehouse_id, date });
  const blocking = match.selected.some((x) => blocks(x.version)) || match.conflicts.some((k) => k.candidates.some((x) => blocks(x.version)));
  return { ...match, blocking };
}

// ------------------------------------------------------------------ the gates (called by Manufacturing)
const cleared = (o) => o.status !== "EXCEPTION" && Number(o.allowance_quantity ?? 0) > EPS;
export async function assertProductionProgress(client, c, { order, batch, accepted = 0 }) {
  if (Number(accepted) > EPS) {
    for (const trigger of TRIGGERS) {
      const plan = await planProductionQuality(client, c, { order, trigger });
      if (!plan.blocking) continue;
      const codes = [...new Set([...plan.selected, ...plan.conflicts.flatMap((k) => k.candidates)].filter((x) => blocks(x.version)).map((x) => x.version.qcp_code))];
      throw inError(409, trigger === FINAL_TRIGGER ? "QUALITY_FINAL_STOCK_GATE_ACTIVE" : "QUALITY_IPQC_GATE_ACTIVE",
        `Output of this product goes through ${trigger === FINAL_TRIGGER ? "a final inspection" : "an in-process check"} (${codes.join(", ")}) before it is accepted: report it as awaiting inspection.`);
    }
  }
  if (!batch) return;
  const waiting = (await qx(client, `SELECT o.*, p.qcp_code FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      WHERE o.organization_id = $1 AND o.source_type = 'production_run' AND o.source_document_id = $2 AND o.source_line_id = $3 AND o.blocking AND o.status <> 'CANCELLED'`,
  [c.organizationId, order.id, batch.id])).rows.filter((o) => !cleared(o));
  if (waiting.length) throw inError(409, "QUALITY_IPQC_GATE_ACTIVE", `The first piece of run ${batch.batch_reference} awaits Quality clearance (${[...new Set(waiting.map((o) => o.qcp_code))].join(", ")}): no more output is reported in it until then.`,
    { requirements: waiting.map((o) => o.id) });
}
// What every blocking requirement on an entry allows to be accepted (null: none applies).
export async function productionAllowance(client, c, entryId) {
  const rows = (await qx(client, `SELECT o.*, p.qcp_code FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      WHERE o.organization_id = $1 AND o.blocking AND o.status <> 'CANCELLED' AND (
        (o.source_type = 'production_entry' AND o.source_line_id = $2)
        OR (o.source_type = 'production_run' AND o.resolution->>'entryId' = $2::text))`, [c.organizationId, entryId])).rows;
  if (!rows.length) return null;
  return { allowance: Math.min(...rows.map((o) => (o.status === "EXCEPTION" ? 0 : Number(o.allowance_quantity ?? 0)))), open: rows.filter((o) => ["PENDING", "EXCEPTION"].includes(o.status)), rows };
}
export async function assertProductionAcceptance(client, c, { entryId, quantity }) {
  const gate = await productionAllowance(client, c, entryId);
  if (!gate) return;
  const entry = (await client.query(`SELECT accepted_quantity, corrected_accepted_quantity, quality_moved_to_accepted, entry_number FROM tenant.manufacturing_production_entries WHERE id = $1`, [entryId])).rows[0];
  const decided = Number((await client.query(`SELECT COALESCE(sum(accepted_quantity), 0) AS q FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND production_entry_id = $2`,
    [c.organizationId, entryId])).rows[0].q);
  if (decided + Number(quantity) > gate.allowance + EPS) {
    const pending = [...new Set(gate.open.map((o) => o.qcp_code))];
    // The requirements actually holding it back say which gate this is.
    const limiting = gate.rows.filter((o) => (o.status === "EXCEPTION" ? 0 : Number(o.allowance_quantity ?? 0)) < decided + Number(quantity) - EPS);
    const final = limiting.length > 0 && limiting.every(isFinal);
    throw inError(409, final ? "QUALITY_FINAL_STOCK_GATE_ACTIVE" : "QUALITY_IPQC_GATE_ACTIVE", pending.length
      ? `${entry?.entry_number ?? "This output"} is awaiting ${final ? "final" : "in-process"} Quality clearance (${pending.join(", ")}).`
      : `Quality cleared ${round6(Math.max(gate.allowance - decided, 0))} of ${entry?.entry_number ?? "this output"}; the rest stays restricted.`,
    { allowance: gate.allowance, accepted: decided, pending });
  }
}

// ------------------------------------------------------------------ requirements and inspections after an entry posts
async function claimCheckpoint(client, c, { order, batchId, x, type, sequence, threshold, entry }) {
  return (await client.query(`INSERT INTO tenant.quality_inprocess_checkpoints (organization_id, manufacturing_order_id, production_batch_id, control_point_id, qcp_version_id, checkpoint_type,
      checkpoint_sequence, threshold_quantity, production_entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (organization_id, manufacturing_order_id, COALESCE(production_batch_id, '00000000-0000-0000-0000-000000000000'::uuid), control_point_id, checkpoint_type, checkpoint_sequence) DO NOTHING
    RETURNING id`, [c.organizationId, order.id, batchId, x.version.control_point_id, x.version.id, type, sequence, threshold === null ? null : String(threshold), entry.id])).rows[0]?.id ?? null;
}
// One requirement per control point and occurrence; its inspection of the entry's output awaiting inspection. Idempotent per source event.
export async function createProductionObligations(client, c, { order, batch, entry }) {
  const out = { obligationIds: [], inspectionIds: [], finalInspectionIds: [] };
  for (const trigger of TRIGGERS) {
    const made = await obligationsFor(client, c, { order, batch, entry, trigger });
    out.obligationIds.push(...made.obligationIds);
    (trigger === FINAL_TRIGGER ? out.finalInspectionIds : out.inspectionIds).push(...made.inspectionIds);
  }
  return out;
}
async function obligationsFor(client, c, { order, batch, entry, trigger }) {
  const final = trigger === FINAL_TRIGGER;
  const stage = final ? "FINAL" : "IN_PROCESS";
  const controlled = round6(Number(entry.pending_quantity ?? 0));
  if (controlled <= EPS) return { obligationIds: [], inspectionIds: [] };
  const date = dayOf(entry.produced_at ?? new Date());
  const plan = await planProductionQuality(client, c, { order, date, trigger });
  if (!plan.candidates.length) return { obligationIds: [], inspectionIds: [] };
  const reported = round6(Number(entry.reported_quantity));
  const after = round6(Number((await client.query(`SELECT COALESCE(sum(reported_quantity), 0) AS q FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2
      AND status IN ('REPORTED', 'RECOVERY_REQUIRED') AND (posted_at < (SELECT posted_at FROM tenant.manufacturing_production_entries WHERE id = $3) OR id = $3)`, [c.organizationId, order.id, entry.id])).rows[0].q));
  const before = round6(after - reported);
  const firstInRun = batch ? !(await client.query(`SELECT 1 FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND production_batch_id = $2 AND id <> $3
      AND status IN ('REPORTED', 'RECOVERY_REQUIRED') LIMIT 1`, [c.organizationId, batch.id, entry.id])).rows[0] : false;
  const obligationIds = [];
  const inspectionIds = [];
  const finalOccurrence = { type: "FINAL_OUTPUT", sequence: null, sourceType: "production_entry", lineId: entry.id, key: `production_final:${entry.id}`,
    label: `${order.mo_number} ${entry.entry_number}: finished output` };
  const occurrence = async (x) => {
    if (final) return finalOccurrence;
    const type = x.version.checkpoint_type ?? "OPERATION_COMPLETION";
    if (type === "FIRST_PIECE") {
      if (!batch || !firstInRun) return null;
      if (!(await claimCheckpoint(client, c, { order, batchId: batch.id, x, type, sequence: 1, threshold: null, entry }))) return null;
      return { type, sequence: 1, sourceType: "production_run", lineId: batch.id, key: `production_run:${batch.id}:first_piece`, label: `${order.mo_number} run ${batch.batch_reference}: first piece (${entry.entry_number})` };
    }
    if (type === "PERIODIC") {
      const every = Number(x.version.checkpoint_interval);
      if (!(every > 0)) return null;
      let last = null;
      for (let k = Math.floor(before / every + EPS) + 1; k * every <= after + EPS; k += 1) {
        if (await claimCheckpoint(client, c, { order, batchId: null, x, type, sequence: k, threshold: k * every, entry })) last = k;
      }
      if (last === null) return null;
      return { type, sequence: last, sourceType: "production_entry", lineId: entry.id, key: `production_periodic:${order.id}:${x.version.control_point_id}:${last}`,
        label: `${order.mo_number} ${entry.entry_number}: checkpoint at ${round6(last * every)} units` };
    }
    return { type: "OPERATION_COMPLETION", sequence: null, sourceType: "production_entry", lineId: entry.id, key: `production_entry:${entry.id}`, label: `${order.mo_number} ${entry.entry_number}` };
  };
  const insert = async (x, o, fields) => {
    const v = x.version;
    const row = (await qx(client, `INSERT INTO tenant.quality_inspection_obligations (organization_id, control_point_id, qcp_version_id, spec_version_id, source_type, source_document_id,
        source_line_id, source_label, source_event_key, purpose_code, item_id, warehouse_id, controlled_quantity, blocking, status, exception_code, resolution, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
      ON CONFLICT (organization_id, source_event_key, control_point_id) WHERE status <> 'CANCELLED' DO NOTHING RETURNING *`,
    [c.organizationId, v.control_point_id, v.id, fields.specVersionId ?? null, o.sourceType, order.id, o.lineId, o.label.slice(0, 200), o.key, v.purpose_code, order.finished_item_id,
      order.manufacturing_warehouse_id, String(controlled), blocks(v), fields.status, fields.exceptionCode ?? null,
      JSON.stringify({ ...describe(x), date, entryId: entry.id, batchId: batch?.id ?? null, checkpoint: o.type, sequence: o.sequence, ...fields.resolution }), c.userId ?? null])).rows[0];
    if (!row) return null;
    obligationIds.push(row.id);
    await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: v.id, obligationId: row.id, action: "REQUIREMENT_CREATED", to: row.status, details: { source: o.label } });
    if (o.type === "FIRST_PIECE" || o.type === "PERIODIC") await client.query(`UPDATE tenant.quality_inprocess_checkpoints SET obligation_id = $2 WHERE organization_id = $1 AND production_entry_id = $3
        AND control_point_id = $4 AND obligation_id IS NULL`, [c.organizationId, row.id, entry.id, v.control_point_id]);
    return row;
  };
  let missing = false;
  for (const x of plan.selected) {
    const o = await occurrence(x);
    if (!o) continue;
    const spec = await specificationForControlPoint(client, c, x.version, { itemId: order.finished_item_id, supplierId: null, warehouseId: order.manufacturing_warehouse_id, date });
    const ob = await insert(x, o, spec.versionId ? { status: "PENDING", specVersionId: spec.versionId, resolution: { specification: spec.method } }
      : { status: "EXCEPTION", exceptionCode: "SPEC_MISSING", resolution: { problem: spec.reason } });
    if (!ob) continue;
    if (!spec.versionId) {
      missing = true;
      await recordSpecException(client, c, { code: "SPEC_MISSING", stage, itemId: order.finished_item_id, supplierId: null, warehouseId: order.manufacturing_warehouse_id,
        sourceType: o.sourceType, sourceId: order.id, sourceLineId: o.lineId, sourceLabel: o.label, detail: { controlPoint: x.version.qcp_code, problem: spec.reason },
        controlPointId: x.version.control_point_id, obligationId: ob.id });
      continue;
    }
    inspectionIds.push(await openProductionInspection(client, c, ob, { order, batch, entry, checkpoint: o, operation: x.version.operation_label, quantity: controlled, before, after, final,
      resolution: { method: "CONTROL_POINT", controlPoint: x.version.qcp_code, controlPointVersion: x.version.version_number, binding: x.version.spec_binding, date, ...(spec.trace ?? {}) } }));
  }
  for (const k of plan.conflicts) {
    for (const x of k.candidates) {
      const o = await occurrence(x) ?? (final ? finalOccurrence : null) ?? { type: "OPERATION_COMPLETION", sequence: null, sourceType: "production_entry", lineId: entry.id, key: `production_entry:${entry.id}`, label: `${order.mo_number} ${entry.entry_number}` };
      const ob = await insert(x, o, { status: "EXCEPTION", exceptionCode: "RULE_CONFLICT", resolution: { problem: "Two equally specific control points apply", others: k.candidates.map((y) => y.version.qcp_code) } });
      if (ob) await recordSpecException(client, c, { code: "APPLICABILITY_CONFLICT", stage, itemId: order.finished_item_id, supplierId: null, warehouseId: order.manufacturing_warehouse_id,
        sourceType: o.sourceType, sourceId: order.id, sourceLineId: o.lineId, sourceLabel: o.label, detail: { controlPoints: k.candidates.map((y) => y.version.qcp_code), purpose: k.purpose },
        controlPointId: x.version.control_point_id, obligationId: ob.id });
    }
  }
  const outcome = plan.conflicts.length ? "CONFLICT" : missing ? "SPEC_MISSING" : obligationIds.length ? "REQUIREMENTS_CREATED" : "ALREADY_EVALUATED";
  await client.query(`INSERT INTO tenant.quality_qcp_evaluations (organization_id, trigger_event, source_type, source_document_id, source_line_id, source_label, effective_date, outcome, candidates,
      obligation_ids, forced_hold, details, actor_user_id) VALUES ($1, $2, 'production_entry', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)`,
  [c.organizationId, trigger, order.id, entry.id, `${order.mo_number} ${entry.entry_number}`, date, outcome, JSON.stringify(plan.candidates.map(describe)), obligationIds, plan.blocking,
    JSON.stringify({ controlled: String(controlled), cumulativeBefore: before, cumulativeAfter: after, firstInRun }), c.userId ?? null]);
  return { obligationIds, inspectionIds };
}

// The inspection of a production population with its frozen production context.
export async function openProductionInspection(client, c, ob, { order, batch, entry, checkpoint, operation, quantity, before = null, after = null, resolution, rework = null, reinspectionOf = null, final = false }) {
  const { createInspection } = await import("../inspections.js");
  const planId = await ensureMirrorPlan(client, c, ob.spec_version_id);
  const inspection = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: final ? "final" : "in_process", sourceType: "production_entry", sourceId: entry.id, itemId: order.finished_item_id, warehouseId: order.manufacturing_warehouse_id,
    lotQuantity: String(quantity), specResolution: resolution, population: { controlled: String(quantity), requirement: ob.id, entry: entry.entry_number, run: batch?.batch_reference ?? null },
  }, { boundVersionId: ob.spec_version_id, allowPendingSample: true, obligationId: ob.id, qcpVersionId: ob.qcp_version_id, ...(reinspectionOf ?? {}) });
  await client.query(`UPDATE tenant.quality_inspection_obligations SET inspection_id = $2, status = 'PENDING', exception_code = NULL, updated_at = clock_timestamp(), row_version = row_version + 1
    WHERE id = $1 AND (inspection_id IS NULL OR $3)`, [ob.id, inspection.id, Boolean(reinspectionOf)]);
  await insertContext(client, c, inspection.id, { order, batch, entry, checkpoint: { ...checkpoint, key: checkpoint.key && !rework ? `${checkpoint.key}:${ob.control_point_id}` : null },
    operation, quantity, before, after, rework });
  return inspection.id;
}
export async function insertContext(client, c, inspectionId, { order, batch, entry, checkpoint, operation, quantity, after = null, rework = null }) {
  const location = entry.production_location_id ?? batch?.production_location_id ?? null;
  const label = location ? (await client.query(`SELECT code, name FROM tenant.warehouse_locations WHERE id = $1`, [location])).rows[0] : null;
  await client.query(`INSERT INTO tenant.quality_inprocess_contexts (inspection_id, organization_id, manufacturing_order_id, production_entry_id, production_batch_id, mo_number, entry_number, batch_reference,
      bom_revision_id, operation_label, checkpoint_type, checkpoint_sequence, production_location_id, location_label, produced_quantity, cumulative_quantity, operator_user_id, source_event_key,
      rework_required, rework_instruction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
  [inspectionId, c.organizationId, order.id, entry.id, batch?.id ?? entry.production_batch_id ?? null, order.mo_number, entry.entry_number, batch?.batch_reference ?? entry.batch_reference ?? null,
    order.bom_revision_id ?? null, operation ?? null, checkpoint.type, checkpoint.sequence ?? null, location, label ? `${label.code} · ${label.name}` : null, String(quantity), after === null ? null : String(after),
    entry.posted_by ?? entry.recorded_by ?? null, rework ? null : `${checkpoint.key ?? `manual:${inspectionId}`}`, Boolean(rework), rework?.instruction ?? null]);
  await recordEvent(client, c, "inspection", inspectionId, "quality.inprocess.context", { order: order.mo_number, entry: entry.entry_number, checkpoint: checkpoint.type });
}

// A reinspection of production output carries the original's production context; after a rework disposition it waits for Manufacturing to
// confirm the rework before it starts.
export async function copyContextForReinspection(client, c, originalId, reinspectionId, { rework = false, instruction = null } = {}) {
  const ctx = (await client.query(`SELECT * FROM tenant.quality_inprocess_contexts WHERE inspection_id = $1`, [originalId])).rows[0];
  if (!ctx) return;
  await client.query(`INSERT INTO tenant.quality_inprocess_contexts (inspection_id, organization_id, manufacturing_order_id, production_entry_id, production_batch_id, mo_number, entry_number, batch_reference,
      bom_revision_id, operation_label, checkpoint_type, checkpoint_sequence, production_location_id, location_label, produced_quantity, cumulative_quantity, operator_user_id, shift_label,
      rework_required, rework_instruction)
    SELECT $2, organization_id, manufacturing_order_id, production_entry_id, production_batch_id, mo_number, entry_number, batch_reference, bom_revision_id, operation_label,
      CASE WHEN $3 THEN 'REWORK' ELSE checkpoint_type END, checkpoint_sequence, production_location_id, location_label, produced_quantity, cumulative_quantity, operator_user_id, shift_label, $3, $4
    FROM tenant.quality_inprocess_contexts WHERE inspection_id = $1`, [originalId, reinspectionId, rework, instruction]);
}

// Manufacturing corrects output that awaited inspection (it did not exist): every in-process requirement on the entry shrinks with it. A
// correction below what Quality already decided is refused (the decision stands); a requirement left with nothing to inspect ends.
export async function reconcileProductionCorrection(client, c, { entryId, quantity }) {
  const rows = (await qx(client, `SELECT o.*, i.id AS inspection_id2, i.workflow_status, i.inspection_number FROM tenant.quality_inspection_obligations o LEFT JOIN tenant.quality_inspections i ON i.id = o.inspection_id
      WHERE o.organization_id = $1 AND o.status <> 'CANCELLED' AND ((o.source_type = 'production_entry' AND o.source_line_id = $2) OR (o.source_type = 'production_run' AND o.resolution->>'entryId' = $2::text))
      FOR UPDATE OF o`, [c.organizationId, entryId])).rows;
  const { inspectionTotals } = await import("../incoming/dispositions.js");
  for (const o of rows) {
    const next = round6(Number(o.controlled_quantity) - Number(quantity));
    const family = (await qx(client, `WITH RECURSIVE chain AS (SELECT id FROM tenant.quality_inspections WHERE obligation_id = $1 AND reinspection_of_id IS NULL
        UNION ALL SELECT i.id FROM tenant.quality_inspections i JOIN chain ON i.reinspection_of_id = chain.id) SELECT id FROM chain`, [o.id])).rows.map((r) => r.id);
    let decided = 0;
    for (const id of family) { const t = await inspectionTotals(client, id); decided = Math.max(decided, t.accept + t.conditional + t.reject); }
    if (next < decided - EPS || next < -EPS) throw inError(409, "QUALITY_IPQC_QUANTITY_MISMATCH", `${o.source_label}: Quality already decided ${round6(decided)} of it; the output cannot be corrected below that.`);
    if (next <= EPS && decided <= EPS) {
      await client.query(`UPDATE tenant.quality_inspection_obligations SET status = 'CANCELLED', controlled_quantity = 0, outcome_label = 'Output corrected away', updated_at = clock_timestamp(),
          row_version = row_version + 1 WHERE id = $1`, [o.id]);
      for (const id of family) await client.query(`UPDATE tenant.quality_inspections SET workflow_status = 'CANCELLED', status = 'cancelled', cancel_reason = 'The production output was corrected to nothing',
          row_version = row_version + 1, updated_at = now() WHERE id = $1 AND disposition_status = 'NONE' AND workflow_status <> 'CANCELLED'`, [id]);
    } else {
      await client.query(`UPDATE tenant.quality_inspection_obligations SET controlled_quantity = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [o.id, String(next)]);
      if (o.inspection_id) await client.query(`UPDATE tenant.quality_inspections SET lot_quantity = LEAST(lot_quantity, $2), row_version = row_version + 1, updated_at = now() WHERE id = $1`, [o.inspection_id, String(next)]);
    }
    await recordQcpEvent(client, c, { pointId: o.control_point_id, versionId: o.qcp_version_id, obligationId: o.id, action: "SOURCE_CORRECTED", from: o.status, to: next <= EPS && decided <= EPS ? "CANCELLED" : o.status,
      details: { corrected: String(quantity), controlled: String(Math.max(next, 0)) } });
    for (const id of family) await recordEvent(client, c, "inspection", id, "quality.inprocess.source_corrected", { reason: `Production output corrected by ${quantity}; ${Math.max(next, 0)} remains controlled` });
  }
}
