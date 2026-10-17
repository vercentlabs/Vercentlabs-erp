// Quality — Quality Control Points: the engine. Activation on the effective date; deterministic matching of a source event to the control
// points that apply (the most specific overriding point per inspection purpose, plus every additional required check; two equally specific
// overriding points are a conflict, never a silent choice); durable, idempotent inspection obligations bound to the exact control point and
// specification versions; and the fail-safe quality gate: held stock of a source line is released only up to what every blocking obligation
// allows (passed, partly accepted or formally waived). Quality decides; Inventory keeps the quantities.
import { qx } from "../common.js";
import { ensureMirrorPlan, recordSpecException, resolveSpecification } from "../specifications/qs-resolver.js";
import { QCP, STAGES, TRIGGERS, has, need, qcpError, text, textOrNull, uuid, uuidOrNull } from "./qcp-rules.js";

const EPS = 1e-9;
const PUBLISHED = ["APPROVED", "ACTIVE", "SUPERSEDED"];
export const today = async (client) => (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
export async function recordQcpEvent(client, c, { pointId = null, versionId = null, obligationId = null, action, from = null, to = null, note = null, details = {} }) {
  await client.query(`INSERT INTO tenant.quality_qcp_events (organization_id, control_point_id, version_id, obligation_id, action, from_status, to_status, note, details, actor_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`, [c.organizationId, pointId, versionId, obligationId, action, from, to, note, JSON.stringify(details), c.userId ?? null]);
}

// ------------------------------------------------------------------ activation on the effective date
export async function activateDueQcps(client, context, { pointId = null, date = null } = {}) {
  const c = { ...context, userId: null };
  const day = date ?? (await today(client));
  const due = (await qx(client, `SELECT v.* FROM tenant.quality_control_point_versions v JOIN tenant.quality_control_points p ON p.id = v.control_point_id
      WHERE v.organization_id = $1 AND v.status = 'APPROVED' AND v.published_at IS NOT NULL AND v.effective_from <= $2::date AND p.status = 'ACTIVE' AND ($3::uuid IS NULL OR v.control_point_id = $3)
      ORDER BY v.control_point_id, v.version_number DESC`, [c.organizationId, day, pointId])).rows;
  const seen = new Set();
  for (const v of due) {
    if (seen.has(v.control_point_id)) {
      await client.query(`UPDATE tenant.quality_control_point_versions SET status = 'SUPERSEDED', superseded_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.id]);
      await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: v.id, action: "SUPERSEDED", from: "APPROVED", to: "SUPERSEDED", note: "Replaced before it took effect" });
      continue;
    }
    seen.add(v.control_point_id);
    await client.query(`SELECT id FROM tenant.quality_control_points WHERE id = $1 FOR UPDATE`, [v.control_point_id]);
    const previous = (await qx(client, `SELECT * FROM tenant.quality_control_point_versions WHERE control_point_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [v.control_point_id])).rows[0];
    if (previous) {
      await client.query(`UPDATE tenant.quality_control_point_versions SET status = 'SUPERSEDED', superseded_at = clock_timestamp(), superseded_by_version_id = $2,
          effective_until = CASE WHEN effective_until IS NULL OR effective_until >= $3::date THEN GREATEST(effective_from, $3::date - 1) ELSE effective_until END, row_version = row_version + 1
        WHERE id = $1`, [previous.id, v.id, v.effective_from]);
      await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: previous.id, action: "SUPERSEDED", from: "ACTIVE", to: "SUPERSEDED", details: { by: v.version_number } });
    }
    await client.query(`UPDATE tenant.quality_control_point_versions SET status = 'ACTIVE', activated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.id]);
    await client.query(`UPDATE tenant.quality_control_points SET current_version_id = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.control_point_id, v.id]);
    await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: v.id, action: "ACTIVATED", from: "APPROVED", to: "ACTIVE", details: { effectiveFrom: v.effective_from } });
  }
}

// ------------------------------------------------------------------ matching
async function categoryChain(client, c, groupId) {
  const chain = [];
  let id = groupId;
  while (id && chain.length < 20 && !chain.includes(id)) {
    chain.push(id);
    id = (await client.query(`SELECT parent_id FROM tenant.item_groups WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0]?.parent_id ?? null;
  }
  return chain;
}
// The control points that apply to one source event on its date: { selected, conflicts, candidates }. Only approved, published versions in
// force on the date are considered (the effective-date policy is the source document's date).
export async function matchControlPoints(client, c, { trigger, itemId = null, supplierId = null, warehouseId = null, date = null, pointIds = null }) {
  const day = date ?? (await today(client));
  await activateDueQcps(client, c, { date: day });
  const item = itemId ? (await client.query(`SELECT id, group_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0] : null;
  if (itemId && !item) throw qcpError(400, "QUALITY_QCP_COMPANY_MISMATCH");
  const chain = item?.group_id ? await categoryChain(client, c, item.group_id) : [];
  const versions = (await qx(client, `SELECT DISTINCT ON (v.control_point_id) v.*, p.qcp_code, p.name FROM tenant.quality_control_point_versions v
      JOIN tenant.quality_control_points p ON p.id = v.control_point_id
     WHERE v.organization_id = $1 AND v.trigger_event = $2 AND p.status = 'ACTIVE' AND v.status = ANY($3) AND v.published_at IS NOT NULL
       AND v.effective_from <= $4::date AND (v.effective_until IS NULL OR v.effective_until >= $4::date) AND ($5::uuid[] IS NULL OR v.control_point_id = ANY($5))
     ORDER BY v.control_point_id, v.version_number DESC`, [c.organizationId, trigger, PUBLISHED, day, pointIds])).rows;
  const candidates = [];
  for (const v of versions) {
    const rules = (await qx(client, `SELECT * FROM tenant.quality_control_point_rules WHERE version_id = $1
        AND ((scope_kind = 'ITEM' AND item_id = $2) OR (scope_kind = 'CATEGORY' AND item_group_id = ANY($3::uuid[])) OR scope_kind = 'COMPANY_DEFAULT')
        AND (supplier_id IS NULL OR supplier_id = $4) AND (warehouse_id IS NULL OR warehouse_id = $5)`, [v.id, itemId, chain, supplierId, warehouseId])).rows;
    if (!rules.length && !(trigger === "QUALITY_MANUAL_INSPECTION_REQUESTED" && pointIds)) continue;
    const ranked = rules.map((r) => ({ rule: r, rank: [r.specificity, r.scope_kind === "CATEGORY" ? chain.indexOf(r.item_group_id) : 0] }))
      .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])[0] ?? { rule: null, rank: [9, 0] };
    candidates.push({ version: v, rule: ranked.rule, rank: ranked.rank });
  }
  const selected = candidates.filter((x) => x.version.match_mode === "ADDITIONAL_REQUIRED_CHECK");
  const conflicts = [];
  const byPurpose = new Map();
  for (const x of candidates.filter((y) => y.version.match_mode === "OVERRIDE_DEFAULT")) byPurpose.set(x.version.purpose_code, [...(byPurpose.get(x.version.purpose_code) ?? []), x]);
  for (const [purpose, list] of byPurpose) {
    list.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
    const best = list.filter((x) => x.rank[0] === list[0].rank[0] && x.rank[1] === list[0].rank[1]);
    if (best.length > 1) conflicts.push({ purpose, candidates: best });
    else selected.push(best[0]);
  }
  return { date: day, selected, conflicts, candidates };
}
const describe = (x) => ({ controlPointId: x.version.control_point_id, code: x.version.qcp_code, name: x.version.name, version: x.version.version_number, versionId: x.version.id,
  requirement: x.version.requirement_type, gate: x.version.gate_type, mode: x.version.match_mode, purpose: x.version.purpose_code, tier: x.rule?.specificity ?? null, ruleId: x.rule?.id ?? null });
const blocks = (v) => v.requirement_type === "MANDATORY" && v.gate_type === "HOLD_STOCK";

// ------------------------------------------------------------------ the specification an obligation uses
export async function specificationForControlPoint(client, c, v, scope) {
  return specVersionFor(client, c, v, scope);
}
async function specVersionFor(client, c, v, { itemId, supplierId, warehouseId, date }) {
  if (v.spec_binding === "LOCKED") {
    const row = (await qx(client, `SELECT x.*, s.status AS spec_status FROM tenant.quality_inspection_spec_versions x JOIN tenant.quality_inspection_specifications s ON s.id = x.specification_id
      WHERE x.organization_id = $1 AND x.id = $2`, [c.organizationId, v.spec_version_id])).rows[0];
    if (!row || row.spec_status === "RETIRED" || !PUBLISHED.includes(row.status) || !row.published_at || row.effective_from > date || (row.effective_until && row.effective_until < date))
      return { versionId: null, reason: "The locked specification version is not usable on this date." };
    return { versionId: row.id, method: "LOCKED" };
  }
  if (v.spec_binding === "FAMILY") {
    const spec = (await qx(client, `SELECT status FROM tenant.quality_inspection_specifications WHERE organization_id = $1 AND id = $2`, [c.organizationId, v.specification_id])).rows[0];
    if (!spec || spec.status === "RETIRED") return { versionId: null, reason: "The specification is retired." };
    const row = (await qx(client, `SELECT id FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND specification_id = $2 AND status = ANY($3) AND published_at IS NOT NULL
        AND effective_from <= $4::date AND (effective_until IS NULL OR effective_until >= $4::date) ORDER BY version_number DESC LIMIT 1`, [c.organizationId, v.specification_id, PUBLISHED, date])).rows[0];
    return row ? { versionId: row.id, method: "FAMILY" } : { versionId: null, reason: "No approved version of the specification is in force on this date." };
  }
  const out = await resolveSpecification(client, c, { stage: v.inspection_stage, itemId, supplierId, warehouseId, date });
  if (out.status === "RESOLVED") return { versionId: out.version.id, method: "RESOLVE", trace: out.trace };
  return { versionId: null, reason: out.status === "CONFLICT" ? "Two applicable specifications were found." : "No approved specification applies." };
}

async function openObligationInspection(client, c, ob, { sourceType, sourceId, lotQuantity, batchId, resolution }) {
  const { createInspection } = await import("../inspections.js");
  const planId = await ensureMirrorPlan(client, c, ob.spec_version_id);
  const inspection = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: (await qx(client, `SELECT inspection_stage FROM tenant.quality_control_point_versions WHERE id = $1`, [ob.qcp_version_id])).rows[0].inspection_stage === "INCOMING" ? "incoming" : "stock_audit",
    sourceType, sourceId, itemId: ob.item_id, supplierId: ob.supplier_id, warehouseId: ob.warehouse_id, batchId, lotQuantity, specResolution: resolution,
  }, { boundVersionId: ob.spec_version_id, allowPendingSample: true });
  await client.query(`UPDATE tenant.quality_inspection_obligations SET inspection_id = $2, status = 'PENDING', exception_code = NULL, updated_at = clock_timestamp(), row_version = row_version + 1
    WHERE id = $1`, [ob.id, inspection.id]);
  return inspection.id;
}

// ------------------------------------------------------------------ goods receipts
// Before a stocked receipt line posts: which control points apply, and whether its whole received quantity must go on hold.
export async function planReceiptLineQuality(client, c, { itemId, supplierId, warehouseId, date }) {
  const match = await matchControlPoints(client, c, { trigger: "INVENTORY_GOODS_RECEIPT_CONFIRMED", itemId, supplierId, warehouseId, date });
  const forceHold = match.selected.some((x) => blocks(x.version)) || match.conflicts.some((k) => k.candidates.some((x) => blocks(x.version)));
  return { ...match, forceHold, itemId, supplierId, warehouseId };
}
// After the line posted: one obligation per selected control point (and per conflicting candidate, as an exception), each with its own
// inspection. Returns the first inspection (the receipt's hold shows it) and the obligations. Idempotent per receipt line and control point.
export async function createReceiptObligations(client, c, plan, { receipt, line, dispositionId = null, heldBase, receivedBase, batchId = null }) {
  const key = `goods_receipt_line:${line.id}`;
  const label = `${receipt.receipt_number} line ${line.line_number}`;
  const ids = [];
  let firstInspection = null;
  const insert = async (x, fields) => {
    const v = x.version;
    const controlled = blocks(v) || v.quantity_scope === "HELD_QUANTITY" ? heldBase : receivedBase;
    const row = (await qx(client, `INSERT INTO tenant.quality_inspection_obligations (organization_id, control_point_id, qcp_version_id, spec_version_id, source_type, source_document_id,
        source_line_id, source_label, source_event_key, purpose_code, item_id, supplier_id, warehouse_id, batch_id, controlled_quantity, blocking, status, exception_code, disposition_id, resolution, created_by)
      VALUES ($1, $2, $3, $4, 'goods_receipt', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
      ON CONFLICT (organization_id, source_event_key, control_point_id) WHERE status <> 'CANCELLED' DO NOTHING RETURNING *`,
    [c.organizationId, v.control_point_id, v.id, fields.specVersionId ?? null, receipt.id, line.id, label, key, v.purpose_code, plan.itemId, plan.supplierId, plan.warehouseId, batchId,
      String(controlled), blocks(v), fields.status, fields.exceptionCode ?? null, dispositionId, JSON.stringify({ ...describe(x), date: plan.date, ...fields.resolution }), c.userId ?? null])).rows[0];
    if (!row) return null;
    ids.push(row.id);
    await recordQcpEvent(client, c, { pointId: v.control_point_id, versionId: v.id, obligationId: row.id, action: "REQUIREMENT_CREATED", to: row.status, details: { source: label } });
    return row;
  };
  let missing = false;
  for (const x of plan.selected) {
    const spec = await specVersionFor(client, c, x.version, { itemId: plan.itemId, supplierId: plan.supplierId, warehouseId: plan.warehouseId, date: plan.date });
    const ob = await insert(x, spec.versionId ? { status: "PENDING", specVersionId: spec.versionId, resolution: { specification: spec.method } }
      : { status: "EXCEPTION", exceptionCode: "SPEC_MISSING", resolution: { problem: spec.reason } });
    if (!ob) continue;
    if (!spec.versionId) {
      missing = true;
      await recordSpecException(client, c, { code: "SPEC_MISSING", stage: x.version.inspection_stage, itemId: plan.itemId, supplierId: plan.supplierId, warehouseId: plan.warehouseId,
        sourceType: "goods_receipt", sourceId: receipt.id, sourceLineId: line.id, sourceLabel: label, detail: { controlPoint: x.version.qcp_code, problem: spec.reason },
        controlPointId: x.version.control_point_id, obligationId: ob.id });
      continue;
    }
    const lot = Number(ob.controlled_quantity) > 0 ? ob.controlled_quantity : String(receivedBase);
    const id = await openObligationInspection(client, c, ob, { sourceType: "procurement_receipt", sourceId: receipt.id, lotQuantity: lot, batchId,
      resolution: { method: "CONTROL_POINT", controlPoint: x.version.qcp_code, controlPointVersion: x.version.version_number, binding: x.version.spec_binding, date: plan.date, ...(spec.trace ?? {}) } });
    firstInspection ??= id;
  }
  for (const k of plan.conflicts) {
    for (const x of k.candidates) {
      const ob = await insert(x, { status: "EXCEPTION", exceptionCode: "RULE_CONFLICT", resolution: { problem: "Two equally specific control points apply", others: k.candidates.map((y) => y.version.qcp_code) } });
      if (ob) await recordSpecException(client, c, { code: "APPLICABILITY_CONFLICT", stage: x.version.inspection_stage, itemId: plan.itemId, supplierId: plan.supplierId, warehouseId: plan.warehouseId,
        sourceType: "goods_receipt", sourceId: receipt.id, sourceLineId: line.id, sourceLabel: label, detail: { controlPoints: k.candidates.map((y) => y.version.qcp_code), purpose: k.purpose },
        controlPointId: x.version.control_point_id, obligationId: ob.id });
    }
  }
  const outcome = !plan.candidates.length ? "NO_MATCH" : plan.conflicts.length ? "CONFLICT" : missing ? "SPEC_MISSING" : ids.length ? "REQUIREMENTS_CREATED" : "ALREADY_EVALUATED";
  await client.query(`INSERT INTO tenant.quality_qcp_evaluations (organization_id, trigger_event, source_type, source_document_id, source_line_id, source_label, effective_date, outcome, candidates,
      obligation_ids, forced_hold, details, actor_user_id) VALUES ($1, 'INVENTORY_GOODS_RECEIPT_CONFIRMED', 'goods_receipt', $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11)`,
  [c.organizationId, receipt.id, line.id, label, plan.date, outcome, JSON.stringify(plan.candidates.map(describe)), ids, plan.forceHold,
    JSON.stringify({ selected: plan.selected.map((x) => x.version.qcp_code), conflicts: plan.conflicts.map((k) => ({ purpose: k.purpose, controlPoints: k.candidates.map((x) => x.version.qcp_code) })),
      heldBase: String(heldBase), receivedBase: String(receivedBase) }), c.userId ?? null]);
  return { obligationIds: ids, firstInspection };
}

// ------------------------------------------------------------------ the quality gate (called by Inventory before held stock becomes available)
export async function releaseAllowance(client, c, sourceLineId) {
  const obligations = (await qx(client, `SELECT o.*, p.qcp_code FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id
      WHERE o.organization_id = $1 AND o.source_line_id = $2 AND o.blocking AND o.status <> 'CANCELLED'`, [c.organizationId, sourceLineId])).rows;
  if (!obligations.length) return null;
  const released = Number((await client.query(`SELECT COALESCE(sum(r.quantity), 0) AS q FROM tenant.inventory_stock_hold_resolutions r JOIN tenant.inventory_stock_holds h ON h.id = r.hold_id
      WHERE h.organization_id = $1 AND h.source_document_type = 'goods_receipt' AND h.source_line_id = $2 AND r.action = 'released'`, [c.organizationId, sourceLineId])).rows[0].q);
  const allowance = Math.min(...obligations.map((o) => (["SATISFIED", "FAILED", "WAIVED"].includes(o.status) ? Number(o.allowance_quantity) : 0)));
  return { obligations, released, allowance, open: obligations.filter((o) => ["PENDING", "EXCEPTION"].includes(o.status)) };
}
export async function assertQualityRelease(client, c, { sourceLineId, quantity }) {
  if (!sourceLineId) return;
  const gate = await releaseAllowance(client, c, sourceLineId);
  if (!gate) return;
  if (gate.released + Number(quantity) > gate.allowance + EPS) {
    const pending = gate.open.map((o) => o.qcp_code);
    throw qcpError(409, "QUALITY_QCP_GATE_ACTIVE", pending.length
      ? `This stock is awaiting required Quality clearance (${[...new Set(pending)].join(", ")}).`
      : `Quality has cleared ${Math.max(gate.allowance - gate.released, 0)} of this stock for release; the rest stays restricted.`,
    { allowance: gate.allowance, released: gate.released, pending });
  }
}

// ------------------------------------------------------------------ outcomes (the inspection's own requirement only)
export async function noteObligationInspection(client, c, inspectionId, { overall, accepted, rejected }) {
  const rows = (await client.query(`UPDATE tenant.quality_inspection_obligations SET status = $2, allowance_quantity = $3, accepted_quantity = $3, rejected_quantity = $4, outcome_label = $5,
      resolved_at = clock_timestamp(), resolved_by = $6, updated_at = clock_timestamp(), row_version = row_version + 1
    WHERE organization_id = $1 AND inspection_id = $7 AND status = 'PENDING' RETURNING id, control_point_id, qcp_version_id, status`,
  [c.organizationId, overall === "failed" ? "FAILED" : "SATISFIED", String(Math.max(Number(accepted), 0)), String(Math.max(Number(rejected), 0)),
    overall === "failed" ? (Number(accepted) > 0 ? "Partly accepted by inspection" : "Rejected by inspection") : "Inspection passed", c.userId ?? null, inspectionId])).rows;
  for (const r of rows) await recordQcpEvent(client, c, { pointId: r.control_point_id, versionId: r.qcp_version_id, obligationId: r.id, action: "INSPECTION_COMPLETED", from: "PENDING", to: r.status,
    details: { inspectionId, accepted: String(accepted), rejected: String(rejected) } });
}

// A reversed receipt: its open obligations end (their draft inspections are cancelled with them); completed ones stay, marked as linked to
// a reversed source. An inspection in progress blocks the reversal.
export async function reconcileReversedReceipt(client, c, receiptId) {
  const rows = (await qx(client, `SELECT o.*, i.status AS inspection_status FROM tenant.quality_inspection_obligations o LEFT JOIN tenant.quality_inspections i ON i.id = o.inspection_id
      WHERE o.organization_id = $1 AND o.source_type = 'goods_receipt' AND o.source_document_id = $2 AND o.status <> 'CANCELLED'`, [c.organizationId, receiptId])).rows;
  if (rows.some((o) => o.inspection_status === "in_progress")) throw qcpError(409, "QUALITY_QCP_STATE", "Quality has started an inspection this receipt requires. Finish or cancel it first.");
  const { cancelInspection } = await import("../inspections.js");
  for (const o of rows) {
    if (["PENDING", "EXCEPTION"].includes(o.status)) {
      if (o.inspection_id && o.inspection_status === "draft") await cancelInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, o.inspection_id, "Goods receipt reversed");
      await client.query(`UPDATE tenant.quality_inspection_obligations SET status = 'CANCELLED', source_reversed = true, outcome_label = 'Source reversed', updated_at = clock_timestamp(),
        row_version = row_version + 1 WHERE id = $1`, [o.id]);
      await client.query(`UPDATE tenant.quality_spec_exceptions SET status = 'RESOLVED', resolved_at = clock_timestamp(), resolution_note = 'The goods receipt was reversed' WHERE obligation_id = $1 AND status = 'OPEN'`, [o.id]);
      await recordQcpEvent(client, c, { pointId: o.control_point_id, versionId: o.qcp_version_id, obligationId: o.id, action: "SOURCE_REVERSED", from: o.status, to: "CANCELLED" });
    } else {
      await client.query(`UPDATE tenant.quality_inspection_obligations SET source_reversed = true, updated_at = clock_timestamp() WHERE id = $1`, [o.id]);
    }
  }
}

// ------------------------------------------------------------------ recovery: re-evaluate an exception, decide a conflict
async function loadObligation(client, c, id, { lock = false } = {}) {
  const row = (await qx(client, `SELECT o.*, v.inspection_stage, v.spec_binding, v.specification_id, v.spec_version_id AS locked_version_id, v.requirement_type, v.gate_type
      FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_point_versions v ON v.id = o.qcp_version_id
     WHERE o.organization_id = $1 AND o.id = $2${lock ? " FOR UPDATE OF o" : ""}`, [c.organizationId, uuid(id, "Requirement")])).rows[0];
  if (!row) throw qcpError(404, "QUALITY_QCP_NOT_FOUND", "That inspection requirement was not found.");
  return row;
}
export { loadObligation };
export async function reevaluateObligation(client, c, obligationId, input = {}) {
  need(c, QCP.reevaluate);
  const ob = await loadObligation(client, c, obligationId, { lock: true });
  if (ob.status !== "EXCEPTION") throw qcpError(409, "QUALITY_QCP_STATE", "Only a requirement held by a configuration exception is re-evaluated.");
  if (ob.exception_code === "RULE_CONFLICT") throw qcpError(409, "QUALITY_QCP_RULE_CONFLICT", "Decide the conflict first: keep this control point, or mark it not applicable to this source.");
  return reopenWithSpecification(client, c, ob, textOrNull(input.note, 1000));
}
async function reopenWithSpecification(client, c, ob, note) {
  const v = { spec_binding: ob.spec_binding, specification_id: ob.specification_id, spec_version_id: ob.locked_version_id, inspection_stage: ob.inspection_stage };
  const date = ob.resolution?.date ?? (await today(client));
  const spec = await specVersionFor(client, c, v, { itemId: ob.item_id, supplierId: ob.supplier_id, warehouseId: ob.warehouse_id, date });
  if (!spec.versionId) {
    await client.query(`INSERT INTO tenant.quality_qcp_evaluations (organization_id, trigger_event, source_type, source_document_id, source_line_id, source_label, effective_date, outcome, obligation_ids, details, actor_user_id)
      VALUES ($1, 'INVENTORY_GOODS_RECEIPT_CONFIRMED', $2, $3, $4, $5, $6, 'SPEC_MISSING', ARRAY[$7::uuid], $8::jsonb, $9)`,
    [c.organizationId, ob.source_type, ob.source_document_id, ob.source_line_id, ob.source_label, date, ob.id, JSON.stringify({ problem: spec.reason, reevaluation: true }), c.userId ?? null]);
    throw qcpError(409, "QUALITY_QCP_SPEC_MISSING", `${spec.reason} The requirement stays blocked.`);
  }
  await client.query(`UPDATE tenant.quality_inspection_obligations SET spec_version_id = $2 WHERE id = $1`, [ob.id, spec.versionId]);
  const inspectionId = await openObligationInspection(client, c, { ...ob, spec_version_id: spec.versionId }, { sourceType: ob.source_type === "goods_receipt" ? "procurement_receipt" : "manual",
    sourceId: ob.source_document_id, lotQuantity: ob.controlled_quantity, batchId: ob.batch_id, resolution: { method: "CONTROL_POINT", reevaluated: true, date, binding: ob.spec_binding } });
  await client.query(`UPDATE tenant.quality_spec_exceptions SET status = 'RESOLVED', resolved_by = $2, resolved_at = clock_timestamp(), resolution_note = $3 WHERE obligation_id = $1 AND status = 'OPEN'`,
    [ob.id, c.userId ?? null, note ?? "Re-evaluated: an approved specification now applies"]);
  await client.query(`INSERT INTO tenant.quality_qcp_evaluations (organization_id, trigger_event, source_type, source_document_id, source_line_id, source_label, effective_date, outcome, obligation_ids, details, actor_user_id)
    VALUES ($1, 'INVENTORY_GOODS_RECEIPT_CONFIRMED', $2, $3, $4, $5, $6, 'REEVALUATED', ARRAY[$7::uuid], $8::jsonb, $9)`,
  [c.organizationId, ob.source_type, ob.source_document_id, ob.source_line_id, ob.source_label, date, ob.id, JSON.stringify({ inspectionId, specVersionId: spec.versionId }), c.userId ?? null]);
  await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "REEVALUATED", from: "EXCEPTION", to: "PENDING", note });
  return { obligationId: ob.id, status: "PENDING", inspectionId };
}
export async function decideObligationConflict(client, c, obligationId, input = {}) {
  need(c, QCP.reevaluate);
  need(c, QCP.review, QCP.approve);
  const note = text(input.note, 1000);
  if (!note) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Say why this control point applies (or does not) to this source.");
  const ob = await loadObligation(client, c, obligationId, { lock: true });
  if (ob.status !== "EXCEPTION" || ob.exception_code !== "RULE_CONFLICT") throw qcpError(409, "QUALITY_QCP_STATE", "This requirement has no conflict to decide.");
  if (input.decision === "NOT_APPLICABLE") {
    await client.query(`UPDATE tenant.quality_inspection_obligations SET status = 'CANCELLED', outcome_label = 'Not applicable (conflict decided)', resolved_by = $2, resolved_at = clock_timestamp(),
      updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ob.id, c.userId ?? null]);
    await client.query(`UPDATE tenant.quality_spec_exceptions SET status = 'RESOLVED', resolved_by = $2, resolved_at = clock_timestamp(), resolution_note = $3 WHERE obligation_id = $1 AND status = 'OPEN'`,
      [ob.id, c.userId ?? null, note]);
    await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "CONFLICT_DECIDED", from: "EXCEPTION", to: "CANCELLED", note });
    return { obligationId: ob.id, status: "CANCELLED" };
  }
  if (input.decision !== "KEEP") throw qcpError(400, "QUALITY_QCP_INVALID", "Keep this control point, or mark it not applicable.");
  await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "CONFLICT_DECIDED", note, details: { decision: "KEEP" } });
  return reopenWithSpecification(client, c, ob, note);
}

// ------------------------------------------------------------------ manual inspection under a control point
export async function requestManualInspection(client, c, pointId, input = {}) {
  need(c, QCP.view);
  if (!has(c, "quality.inspect")) throw qcpError(403, "QUALITY_QCP_PERMISSION_DENIED", "Only people who inspect may start an inspection.");
  const key = `manual:${text(input.idempotencyKey, 120) || crypto.randomUUID()}`;
  const prior = (await client.query(`SELECT id, inspection_id FROM tenant.quality_inspection_obligations WHERE organization_id = $1 AND source_event_key = $2 AND status <> 'CANCELLED'`, [c.organizationId, key])).rows[0];
  if (prior) return { obligationId: prior.id, inspectionId: prior.inspection_id, replayed: true };
  const reason = text(input.reason, 1000);
  if (!reason) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Say why the inspection is requested.");
  const itemId = uuidOrNull(input.itemId, "Item");
  const warehouseId = uuidOrNull(input.warehouseId, "Site");
  if (itemId && !(await client.query(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0]) throw qcpError(400, "QUALITY_QCP_COMPANY_MISMATCH");
  if (warehouseId && !(await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, warehouseId])).rows[0]) throw qcpError(400, "QUALITY_QCP_COMPANY_MISMATCH");
  const quantity = Number(input.quantity ?? 1);
  if (!(quantity > 0)) throw qcpError(400, "QUALITY_QCP_INVALID", "Enter the quantity to inspect.");
  const match = await matchControlPoints(client, c, { trigger: "QUALITY_MANUAL_INSPECTION_REQUESTED", itemId, warehouseId, pointIds: [uuid(pointId, "Control point")] });
  const x = match.candidates[0];
  if (!x) throw qcpError(409, "QUALITY_QCP_NOT_EFFECTIVE", "This control point is not an active manual inspection rule for that item and site today.");
  const spec = await specVersionFor(client, c, x.version, { itemId, supplierId: null, warehouseId, date: match.date });
  if (!spec.versionId) throw qcpError(409, "QUALITY_QCP_SPEC_MISSING", spec.reason);
  const ob = (await qx(client, `INSERT INTO tenant.quality_inspection_obligations (organization_id, control_point_id, qcp_version_id, spec_version_id, source_type, source_label, source_event_key, purpose_code,
      item_id, warehouse_id, controlled_quantity, blocking, status, resolution, created_by) VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, false, 'PENDING', $11::jsonb, $12) RETURNING *`,
  [c.organizationId, x.version.control_point_id, x.version.id, spec.versionId, `Requested: ${reason}`.slice(0, 200), key, x.version.purpose_code, itemId, warehouseId, String(quantity),
    JSON.stringify({ ...describe(x), date: match.date, reason }), c.userId ?? null])).rows[0];
  const inspectionId = await openObligationInspection(client, c, ob, { sourceType: "manual", sourceId: null, lotQuantity: String(quantity), batchId: uuidOrNull(input.batchId, "Batch"),
    resolution: { method: "CONTROL_POINT", controlPoint: x.version.qcp_code, manual: true, reason } });
  await recordQcpEvent(client, c, { pointId: x.version.control_point_id, versionId: x.version.id, obligationId: ob.id, action: "MANUAL_INSPECTION_REQUESTED", note: reason });
  return { obligationId: ob.id, inspectionId };
}

// What would happen for an example source (nothing is created).
export async function previewQualityControlPoints(client, c, input = {}) {
  need(c, QCP.view);
  const trigger = TRIGGERS[input.trigger] ? input.trigger : "INVENTORY_GOODS_RECEIPT_CONFIRMED";
  const match = await matchControlPoints(client, c, { trigger, itemId: uuidOrNull(input.itemId, "Item"), supplierId: uuidOrNull(input.supplierId, "Supplier"),
    warehouseId: uuidOrNull(input.warehouseId, "Site"), date: input.date || null });
  const out = [];
  for (const x of match.selected) {
    const spec = await specVersionFor(client, c, x.version, { itemId: input.itemId || null, supplierId: input.supplierId || null, warehouseId: input.warehouseId || null, date: match.date });
    const code = spec.versionId ? (await client.query(`SELECT s.specification_code, v.version_number FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id WHERE v.id = $1`,
      [spec.versionId])).rows[0] : null;
    out.push({ ...describe(x), specification: code ? `${code.specification_code} v${code.version_number}` : null, problem: spec.versionId ? null : spec.reason });
  }
  return { date: match.date, stage: STAGES[TRIGGERS[trigger].stage], trigger: TRIGGERS[trigger].label, requirements: out, conflicts: match.conflicts.map((k) => ({ purpose: k.purpose, controlPoints: k.candidates.map(describe) })),
    holdsStock: out.some((x) => x.requirement === "MANDATORY" && x.gate === "HOLD_STOCK") || match.conflicts.some((k) => k.candidates.some((x) => blocks(x.version))),
    considered: match.candidates.map(describe) };
}
