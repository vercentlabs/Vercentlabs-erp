// Quality — Quality Control Points: the directory and its views, one control point (versions, applicability, standard, gate, trigger
// history, linked inspections, activity), inspection requirements (obligations) with their gate and waivers, conflicts and exceptions,
// reports, the export, the Quality overview queues and the options.
import { qx } from "../common.js";
import { activateDueQcps, releaseAllowance } from "./qcp-engine.js";
import { loadPoint, loadQcpVersion, rulesOfVersion } from "./qcp-commands.js";
import {
  BINDINGS, CHECKPOINTS, EDITABLE, GATES, MATCH_MODES, OBLIGATION, QCP, REQUIREMENTS, SCOPES, STAGES, STATUS, TRIGGERS, compareQcpVersions, has, need, qcpContentHash, qcpError, text, uuid, validateQcpVersion,
} from "./qcp-rules.js";

const prepares = (c) => [QCP.create, QCP.editDraft, QCP.submit, QCP.review, QCP.approve, QCP.activate, QCP.revise].some((p) => has(c, p));
const SUPPLIER = (col) => `(SELECT COALESCE(bp.display_name, s.supplier_number) FROM tenant.procurement_suppliers s LEFT JOIN tenant.business_parties bp ON bp.id = s.party_id WHERE s.id = ${col})`;
async function describeRules(client, c, versionId) {
  return (await qx(client, `SELECT r.*, i.code AS item_code, i.name AS item_name, g.name AS group_name, w.code AS warehouse_code, ${SUPPLIER("r.supplier_id")} AS supplier_name
      FROM tenant.quality_control_point_rules r LEFT JOIN tenant.items i ON i.id = r.item_id LEFT JOIN tenant.item_groups g ON g.id = r.item_group_id LEFT JOIN tenant.warehouses w ON w.id = r.warehouse_id
     WHERE r.organization_id = $1 AND r.version_id = $2 ORDER BY r.specificity, r.created_at`, [c.organizationId, versionId])).rows.map((r) => ({
    id: r.id, scope: r.scope_kind, scopeLabel: SCOPES[r.scope_kind], itemId: r.item_id, itemGroupId: r.item_group_id, supplierId: r.supplier_id, warehouseId: r.warehouse_id, specificity: r.specificity,
    describe: [r.scope_kind === "ITEM" ? `${r.item_code} · ${r.item_name}` : r.scope_kind === "CATEGORY" ? `Category ${r.group_name}` : "Every item (Company default)",
      r.supplier_id ? `from ${r.supplier_name}` : null, r.warehouse_id ? `at ${r.warehouse_code}` : null].filter(Boolean).join(" "),
  }));
}
const versionView = (v) => ({
  id: v.id, number: v.version_number, status: v.status, statusLabel: STATUS[v.status], stage: v.inspection_stage, stageLabel: STAGES[v.inspection_stage], trigger: v.trigger_event,
  triggerLabel: TRIGGERS[v.trigger_event]?.label ?? v.trigger_event, triggerEnabled: Boolean(TRIGGERS[v.trigger_event]?.enabled), requirement: v.requirement_type, requirementLabel: REQUIREMENTS[v.requirement_type],
  gate: v.gate_type, gateLabel: GATES[v.gate_type], binding: v.spec_binding, bindingLabel: BINDINGS[v.spec_binding], specificationId: v.specification_id, specVersionId: v.spec_version_id,
  matchMode: v.match_mode, matchModeLabel: MATCH_MODES[v.match_mode], purpose: v.purpose_code, quantityScope: v.quantity_scope, lotContext: v.lot_context, waiverAllowed: v.waiver_allowed,
  checkpoint: v.checkpoint_type ?? null, checkpointLabel: v.checkpoint_type ? CHECKPOINTS[v.checkpoint_type] : null, checkpointInterval: v.checkpoint_interval === null || v.checkpoint_interval === undefined ? null : Number(v.checkpoint_interval),
  operationLabel: v.operation_label ?? null,
  effectiveFrom: v.effective_from, effectiveUntil: v.effective_until, revisionReason: v.revision_reason, submittedAt: v.submitted_at, reviewNote: v.review_note, approvedAt: v.approved_at,
  approvalNote: v.approval_note, publishedAt: v.published_at, activatedAt: v.activated_at, supersededAt: v.superseded_at, contentHash: v.content_hash, version: v.row_version,
});

// ------------------------------------------------------------------ the directory
const VIEWS = {
  all: "TRUE", drafts: "open.status IN ('DRAFT', 'CHANGES_REQUESTED')", pending: "open.status = 'PENDING_APPROVAL'", active: "p.status = 'ACTIVE' AND act.id IS NOT NULL",
  future: "EXISTS (SELECT 1 FROM tenant.quality_control_point_versions x WHERE x.control_point_id = p.id AND x.status = 'APPROVED')",
  retired: "(p.status = 'RETIRED' OR (act.id IS NULL AND EXISTS (SELECT 1 FROM tenant.quality_control_point_versions x WHERE x.control_point_id = p.id AND x.status = 'SUPERSEDED')))",
};
export async function listQualityControlPoints(client, c, filters = {}) {
  need(c, QCP.view);
  await activateDueQcps(client, c);
  const flags = { create: has(c, QCP.create), export: has(c, QCP.export), drafts: prepares(c) };
  const view = VIEWS[filters.view] ? filters.view : "all";
  if (!prepares(c) && ["drafts", "pending", "future"].includes(view)) return { view, rows: [], can: flags };
  const params = [c.organizationId];
  const where = [VIEWS[view]];
  if (!prepares(c)) where.push("EXISTS (SELECT 1 FROM tenant.quality_control_point_versions x WHERE x.control_point_id = p.id AND x.published_at IS NOT NULL)");
  const search = text(filters.search, 120);
  if (search) { params.push(`%${search}%`); where.push(`(p.qcp_code ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
  if (filters.stage && STAGES[filters.stage]) { params.push(filters.stage); where.push(`COALESCE(act.inspection_stage, cur.inspection_stage) = $${params.length}`); }
  const { rows } = await qx(client, `SELECT p.*, act.id AS active_id, act.version_number AS active_number, act.effective_from AS active_from,
      open.id AS open_id, open.version_number AS open_number, open.status AS open_status, COALESCE(act.inspection_stage, cur.inspection_stage) AS stage,
      COALESCE(act.trigger_event, cur.trigger_event) AS trigger_event, COALESCE(act.requirement_type, cur.requirement_type) AS requirement_type, COALESCE(act.gate_type, cur.gate_type) AS gate_type,
      COALESCE(act.match_mode, cur.match_mode) AS match_mode, s.specification_code,
      (SELECT count(*)::int FROM tenant.quality_control_point_rules r WHERE r.version_id = COALESCE(act.id, cur.id)) AS rules,
      (SELECT count(*)::int FROM tenant.quality_inspection_obligations o WHERE o.control_point_id = p.id AND o.status IN ('PENDING', 'EXCEPTION')) AS open_requirements
    FROM tenant.quality_control_points p
    LEFT JOIN tenant.quality_control_point_versions act ON act.control_point_id = p.id AND act.status = 'ACTIVE'
    LEFT JOIN tenant.quality_control_point_versions open ON open.control_point_id = p.id AND open.status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED')
    LEFT JOIN tenant.quality_control_point_versions cur ON cur.id = p.current_version_id
    LEFT JOIN tenant.quality_inspection_specifications s ON s.id = COALESCE(act.specification_id, cur.specification_id)
    WHERE p.organization_id = $1 AND ${where.join(" AND ")} ORDER BY p.qcp_code LIMIT 500`, params);
  return { view, can: flags, rows: rows.map((p) => ({
    id: p.id, code: p.qcp_code, name: p.name, description: p.description, status: p.status, stage: p.stage, stageLabel: STAGES[p.stage], trigger: TRIGGERS[p.trigger_event]?.label ?? p.trigger_event,
    requirement: REQUIREMENTS[p.requirement_type], gate: GATES[p.gate_type], mode: MATCH_MODES[p.match_mode], specification: p.specification_code, rules: p.rules, openRequirements: p.open_requirements,
    active: p.active_id ? { id: p.active_id, number: p.active_number, effectiveFrom: p.active_from } : null,
    open: p.open_id && prepares(c) ? { id: p.open_id, number: p.open_number, status: p.open_status, statusLabel: STATUS[p.open_status] } : null, href: `/quality/control-points/${p.id}`,
  })) };
}

// ------------------------------------------------------------------ one control point
export async function getQualityControlPoint(client, c, pointId, { versionId = null } = {}) {
  need(c, QCP.view);
  await activateDueQcps(client, c, { pointId });
  const point = await loadPoint(client, c, pointId);
  const all = (await qx(client, `SELECT * FROM tenant.quality_control_point_versions WHERE control_point_id = $1 ORDER BY version_number DESC`, [point.id])).rows;
  const visible = prepares(c) ? all : all.filter((v) => v.published_at);
  if (!visible.length) throw qcpError(404, "QUALITY_QCP_NOT_FOUND");
  const open = all.find((v) => ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(v.status)) ?? null;
  const active = all.find((v) => v.status === "ACTIVE") ?? null;
  const selected = (versionId && visible.find((v) => v.id === versionId)) || (prepares(c) && open) || active || visible[0];
  const rules = await rulesOfVersion(client, c, selected.id);
  const spec = selected.specification_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_specifications WHERE id = $1`, [selected.specification_id])).rows[0] : null;
  const locked = selected.spec_version_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE id = $1`, [selected.spec_version_id])).rows[0] : null;
  const specActive = spec ? (await qx(client, `SELECT version_number, effective_from FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1 AND status = 'ACTIVE'`, [spec.id])).rows[0] : null;
  const issues = EDITABLE.includes(selected.status) || selected.status === "PENDING_APPROVAL" ? validateQcpVersion(point, selected, rules, { spec, lockedVersion: locked }) : [];
  if (issues && selected.version_number > 1 && !selected.revision_reason && EDITABLE.includes(selected.status)) issues.push({ code: "QUALITY_QCP_REASON_REQUIRED", message: "Give the reason for this revision." });
  const predecessor = selected.supersedes_version_id ? all.find((v) => v.id === selected.supersedes_version_id) : null;
  const comparison = predecessor ? { from: predecessor.version_number, ...compareQcpVersions({ version: predecessor, rules: await describeRules(client, c, predecessor.id) }, { version: selected, rules: await describeRules(client, c, selected.id) }) } : null;
  const counts = (await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('PENDING', 'EXCEPTION'))::int AS open FROM tenant.quality_inspection_obligations WHERE control_point_id = $1`, [point.id])).rows[0];
  const policy = (await client.query(`SELECT spec_prohibit_self_approval FROM tenant.quality_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const self = (policy?.spec_prohibit_self_approval ?? true) && c.userId && [selected.created_by, selected.submitted_by].includes(c.userId);
  const can = {
    edit: has(c, QCP.editDraft) && point.status === "ACTIVE" && EDITABLE.includes(selected.status), gate: has(c, QCP.manageGate), submit: has(c, QCP.submit) && point.status === "ACTIVE" && EDITABLE.includes(selected.status),
    review: has(c, QCP.review) && selected.status === "PENDING_APPROVAL", approve: has(c, QCP.approve) && selected.status === "PENDING_APPROVAL" && !self,
    publish: has(c, QCP.activate) && selected.status === "APPROVED" && !selected.published_at, revise: has(c, QCP.revise) && point.status === "ACTIVE" && !open,
    copy: has(c, QCP.copy) && has(c, QCP.create), retire: has(c, QCP.retire) && point.status === "ACTIVE", history: has(c, QCP.history), export: has(c, QCP.export),
    manual: selected.trigger_event === "QUALITY_MANUAL_INSPECTION_REQUESTED" && selected.status === "ACTIVE" && has(c, "quality.inspect"),
  };
  return {
    id: point.id, code: point.qcp_code, name: point.name, description: point.description, status: point.status, retiredAt: point.retired_at, retireReason: point.retire_reason,
    carriedOver: Boolean(point.legacy_requirement_id), createdAt: point.created_at, version: point.row_version,
    selected: { ...versionView(selected), rules: await describeRules(client, c, selected.id), issues, valid: issues.length === 0, comparison,
      integrity: selected.content_hash ? { intact: qcpContentHash(selected, rules) === selected.content_hash } : null,
      standard: spec ? { id: spec.id, code: spec.specification_code, name: spec.name, stage: spec.inspection_stage, status: spec.status, activeVersion: specActive?.version_number ?? null,
        lockedVersion: locked ? locked.version_number : null, href: `/quality/specifications/${spec.id}` } : null },
    versions: visible.map((v) => ({ id: v.id, number: v.version_number, status: v.status, statusLabel: STATUS[v.status], effectiveFrom: v.effective_from, effectiveUntil: v.effective_until,
      revisionReason: v.revision_reason, current: v.id === selected.id })),
    active: active ? { id: active.id, number: active.version_number } : null, open: open && prepares(c) ? { id: open.id, number: open.version_number, status: open.status } : null,
    requirements: counts, can, href: `/quality/control-points/${point.id}`,
  };
}
export async function getQualityControlPointHistory(client, c, pointId) {
  need(c, QCP.history);
  const point = await loadPoint(client, c, pointId);
  const events = (await qx(client, `SELECT e.*, v.version_number, u.full_name FROM tenant.quality_qcp_events e LEFT JOIN tenant.quality_control_point_versions v ON v.id = e.version_id
      LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.organization_id = $1 AND e.control_point_id = $2 ORDER BY e.occurred_at DESC LIMIT 500`, [c.organizationId, point.id])).rows;
  const triggers = (await qx(client, `SELECT * FROM tenant.quality_qcp_evaluations WHERE organization_id = $1 AND candidates @> $2::jsonb ORDER BY occurred_at DESC LIMIT 300`,
    [c.organizationId, JSON.stringify([{ controlPointId: point.id }])])).rows;
  return {
    events: events.map((e) => ({ id: e.id, action: e.action, version: e.version_number, from: e.from_status, to: e.to_status, note: e.note, details: e.details, by: e.full_name ?? "System", at: e.occurred_at })),
    triggers: triggers.map(evaluationView),
  };
}
const OUTCOME = { NO_MATCH: "No control point applied", REQUIREMENTS_CREATED: "Inspection required", CONFLICT: "Configuration exception (conflict)", SPEC_MISSING: "Configuration exception (no specification)",
  ALREADY_EVALUATED: "Already evaluated", REEVALUATED: "Re-evaluated", FAILED: "Evaluation failed" };
const evaluationView = (e) => ({ id: e.id, source: e.source_label, sourceHref: e.source_type === "goods_receipt" && e.source_document_id ? `/procurement/goods-receipts/${e.source_document_id}` : null,
  date: e.effective_date, outcome: e.outcome, outcomeLabel: OUTCOME[e.outcome] ?? e.outcome, forcedHold: e.forced_hold, controlPoints: (e.candidates ?? []).map((x) => x.code), requirements: e.obligation_ids.length, at: e.occurred_at });

// ------------------------------------------------------------------ inspection requirements (obligations)
const obligationView = (o) => ({
  id: o.id, controlPoint: o.qcp_code, controlPointId: o.control_point_id, version: o.qcp_version_number, purpose: o.purpose_code, source: o.source_label, sourceType: o.source_type,
  sourceHref: o.source_type === "goods_receipt" && o.source_document_id ? `/procurement/goods-receipts/${o.source_document_id}` : null, item: o.item_code ? `${o.item_code} · ${o.item_name}` : null,
  specification: o.specification_code ? `${o.specification_code} v${o.spec_version_number}` : null, specificationHref: o.specification_id ? `/quality/specifications/${o.specification_id}` : null,
  controlled: o.controlled_quantity, blocking: o.blocking, status: o.status, statusLabel: OBLIGATION[o.status], outcome: o.outcome_label, exception: o.exception_code, allowance: o.allowance_quantity,
  accepted: o.accepted_quantity, rejected: o.rejected_quantity, inspection: o.inspection_number ? { id: o.inspection_id, number: o.inspection_number, status: o.inspection_status, href: `/quality/inspection/${o.inspection_id}` } : null,
  holdHref: o.hold_id ? `/inventory/quality-holds/${o.hold_id}` : null, sourceReversed: o.source_reversed, createdAt: o.created_at, href: `/quality/control-points/requirements/${o.id}`,
});
const OBLIGATION_SQL = `SELECT o.*, p.qcp_code, v.version_number AS qcp_version_number, i.code AS item_code, i.name AS item_name, sv.version_number AS spec_version_number, s.specification_code, s.id AS specification_id,
    q.inspection_number, q.status AS inspection_status,
    (SELECT h.id FROM tenant.inventory_stock_holds h WHERE h.organization_id = o.organization_id AND h.source_document_type = 'goods_receipt' AND h.source_line_id = o.source_line_id LIMIT 1) AS hold_id
  FROM tenant.quality_inspection_obligations o JOIN tenant.quality_control_points p ON p.id = o.control_point_id JOIN tenant.quality_control_point_versions v ON v.id = o.qcp_version_id
  LEFT JOIN tenant.items i ON i.id = o.item_id LEFT JOIN tenant.quality_inspection_spec_versions sv ON sv.id = o.spec_version_id
  LEFT JOIN tenant.quality_inspection_specifications s ON s.id = sv.specification_id LEFT JOIN tenant.quality_inspections q ON q.id = o.inspection_id`;
export async function listInspectionObligations(client, c, filters = {}) {
  need(c, QCP.view);
  const params = [c.organizationId];
  const where = ["o.organization_id = $1"];
  if (filters.status && OBLIGATION[filters.status]) { params.push(filters.status); where.push(`o.status = $${params.length}`); }
  if (filters.view === "open") where.push(`o.status IN ('PENDING', 'EXCEPTION')`);
  if (filters.view === "awaiting-clearance") where.push(`o.blocking AND o.status IN ('PENDING', 'EXCEPTION')`);
  if (filters.controlPointId) { params.push(uuid(filters.controlPointId, "Control point")); where.push(`o.control_point_id = $${params.length}`); }
  if (filters.sourceLineId) { params.push(uuid(filters.sourceLineId, "Source line")); where.push(`o.source_line_id = $${params.length}`); }
  const rows = (await qx(client, `${OBLIGATION_SQL} WHERE ${where.join(" AND ")} ORDER BY o.created_at DESC LIMIT 500`, params)).rows;
  return { rows: rows.map(obligationView), can: { waive: has(c, QCP.requestWaiver), reevaluate: has(c, QCP.reevaluate) } };
}
export async function getInspectionObligation(client, c, obligationId) {
  need(c, QCP.view);
  const o = (await qx(client, `${OBLIGATION_SQL} WHERE o.organization_id = $1 AND o.id = $2`, [c.organizationId, uuid(obligationId, "Requirement")])).rows[0];
  if (!o) throw qcpError(404, "QUALITY_QCP_NOT_FOUND", "That inspection requirement was not found.");
  const waivers = (await qx(client, `SELECT w.*, r.full_name AS requester, d.full_name AS decider FROM tenant.quality_qcp_waivers w LEFT JOIN public.users r ON r.id = w.requested_by
      LEFT JOIN public.users d ON d.id = w.decided_by WHERE w.obligation_id = $1 ORDER BY w.requested_at DESC`, [o.id])).rows;
  const events = (await qx(client, `SELECT e.*, u.full_name FROM tenant.quality_qcp_events e LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.obligation_id = $1 ORDER BY e.occurred_at DESC`, [o.id])).rows;
  const gate = o.source_line_id ? await releaseAllowance(client, c, o.source_line_id) : null;
  const open = waivers.find((w) => w.status === "REQUESTED");
  return {
    ...obligationView(o), resolution: o.resolution,
    gate: gate ? { allowance: gate.allowance, released: gate.released, blockingRequirements: gate.obligations.length, open: gate.open.map((x) => x.qcp_code) } : null,
    waivers: waivers.map((w) => ({ id: w.id, status: w.status, disposition: w.requested_disposition, quantity: w.quantity, reason: w.reason, risk: w.risk_justification, conditions: w.conditions,
      evidence: w.evidence_reference, requestedBy: w.requester, requestedAt: w.requested_at, decidedBy: w.decider, decidedAt: w.decided_at, note: w.decision_note })),
    events: events.map((e) => ({ id: e.id, action: e.action, from: e.from_status, to: e.to_status, note: e.note, by: e.full_name ?? "System", at: e.occurred_at })),
    can: {
      waive: has(c, QCP.requestWaiver) && ["PENDING", "FAILED", "EXCEPTION"].includes(o.status) && !open, decide: has(c, QCP.approveWaiver) && Boolean(open) && open.requested_by !== c.userId,
      reevaluate: has(c, QCP.reevaluate) && o.status === "EXCEPTION" && o.exception_code !== "RULE_CONFLICT",
      decideConflict: has(c, QCP.reevaluate) && (has(c, QCP.review) || has(c, QCP.approve)) && o.status === "EXCEPTION" && o.exception_code === "RULE_CONFLICT",
    },
    openWaiverId: open?.id ?? null,
  };
}

// ------------------------------------------------------------------ conflicts and exceptions
export async function listQualityControlPointConflicts(client, c) {
  need(c, QCP.view);
  const exceptions = (await qx(client, `${OBLIGATION_SQL} WHERE o.organization_id = $1 AND o.status = 'EXCEPTION' ORDER BY o.created_at DESC LIMIT 300`, [c.organizationId])).rows.map(obligationView);
  // Two active overriding points for the same trigger and purpose with equally specific rules over the same item / category / Company default
  // that one source can match at once.
  const overlaps = (await qx(client, `SELECT DISTINCT pa.qcp_code AS a_code, pa.id AS a_id, pb.qcp_code AS b_code, pb.id AS b_id, va.trigger_event, va.purpose_code, ra.specificity
      FROM tenant.quality_control_point_rules ra JOIN tenant.quality_control_point_versions va ON va.id = ra.version_id AND va.status = 'ACTIVE' AND va.match_mode = 'OVERRIDE_DEFAULT'
      JOIN tenant.quality_control_point_rules rb ON rb.organization_id = ra.organization_id AND rb.specificity = ra.specificity AND rb.scope_kind = ra.scope_kind
        AND rb.item_id IS NOT DISTINCT FROM ra.item_id AND rb.item_group_id IS NOT DISTINCT FROM ra.item_group_id
        AND (ra.supplier_id IS NULL OR rb.supplier_id IS NULL OR ra.supplier_id = rb.supplier_id) AND (ra.warehouse_id IS NULL OR rb.warehouse_id IS NULL OR ra.warehouse_id = rb.warehouse_id)
      JOIN tenant.quality_control_point_versions vb ON vb.id = rb.version_id AND vb.status = 'ACTIVE' AND vb.match_mode = 'OVERRIDE_DEFAULT' AND vb.trigger_event = va.trigger_event
        AND vb.purpose_code = va.purpose_code AND vb.control_point_id > va.control_point_id
      JOIN tenant.quality_control_points pa ON pa.id = va.control_point_id AND pa.status = 'ACTIVE' JOIN tenant.quality_control_points pb ON pb.id = vb.control_point_id AND pb.status = 'ACTIVE'
     WHERE ra.organization_id = $1`, [c.organizationId])).rows;
  return {
    overlaps: overlaps.map((r) => ({ trigger: TRIGGERS[r.trigger_event]?.label ?? r.trigger_event, purpose: r.purpose_code, first: { code: r.a_code, href: `/quality/control-points/${r.a_id}` },
      second: { code: r.b_code, href: `/quality/control-points/${r.b_id}` }, message: "Both replace the general rule for the same scope: make one more specific, end one, or make one an additional check." })),
    exceptions,
  };
}

// ------------------------------------------------------------------ the Quality overview queues
export async function getQualityControlOverview(client, c) {
  need(c, QCP.view);
  await activateDueQcps(client, c);
  const k = (await client.query(`SELECT
      count(*) FILTER (WHERE status = 'PENDING')::int AS required, count(*) FILTER (WHERE status = 'EXCEPTION')::int AS exceptions,
      count(*) FILTER (WHERE blocking AND status IN ('PENDING', 'EXCEPTION'))::int AS awaiting, COALESCE(sum(controlled_quantity) FILTER (WHERE blocking AND status IN ('PENDING', 'EXCEPTION')), 0) AS awaiting_quantity,
      (SELECT count(*)::int FROM tenant.quality_qcp_waivers w WHERE w.organization_id = $1 AND w.status = 'REQUESTED') AS waivers,
      (SELECT count(*)::int FROM tenant.quality_control_point_versions v WHERE v.organization_id = $1 AND v.status = 'PENDING_APPROVAL') AS approvals,
      (SELECT count(*)::int FROM tenant.quality_control_points p WHERE p.organization_id = $1 AND p.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM tenant.quality_control_point_versions v WHERE v.control_point_id = p.id AND v.status = 'ACTIVE')) AS active
    FROM tenant.quality_inspection_obligations WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { counts: { inspectionsRequired: k.required, awaitingClearance: k.awaiting, awaitingQuantity: k.awaiting_quantity, exceptions: k.exceptions, waiversPending: k.waivers,
    approvalsPending: prepares(c) ? k.approvals : undefined, activeControlPoints: k.active }, can: { create: has(c, QCP.create), approveWaivers: has(c, QCP.approveWaiver) } };
}

// ------------------------------------------------------------------ reports and the export
export const QCP_REPORTS = Object.freeze({
  register: "Quality Control Point Register", "by-stage": "Active QCPs by Inspection Stage", "by-item": "QCPs by Product / Category", "supplier-specific": "Supplier-Specific QCPs",
  "gate-coverage": "Quality Gate Coverage", triggers: "Trigger Execution History", requirements: "Quality Inspection Requirements", "awaiting-clearance": "Goods Awaiting Quality Clearance",
  conflicts: "QCP Configuration Conflicts", "missing-specifications": "Missing Approved Specifications", inspections: "Inspections Created by QCP", waivers: "Quality Waivers / Deviations",
  "failed-evaluations": "Failed / Recovered Evaluations", versions: "Rule Version History",
});
export async function getQualityControlPointReport(client, c, kind) {
  need(c, QCP.view);
  if (!QCP_REPORTS[kind]) throw qcpError(404, "QUALITY_QCP_NOT_FOUND", "Unknown report.");
  const org = [c.organizationId];
  const title = QCP_REPORTS[kind];
  const pub = prepares(c) ? "TRUE" : "v.published_at IS NOT NULL";
  let columns;
  let rows;
  const href = (r, id) => ({ ...r, href: `/quality/control-points/${id}` });
  if (["register", "by-stage", "gate-coverage", "versions"].includes(kind)) {
    const filter = { register: "TRUE", "by-stage": "v.status = 'ACTIVE'", "gate-coverage": "v.status = 'ACTIVE' AND v.requirement_type = 'MANDATORY'", versions: "TRUE" }[kind];
    rows = (await qx(client, `SELECT p.qcp_code AS code, p.name, v.version_number AS version, v.status, v.inspection_stage AS stage, v.trigger_event, v.requirement_type AS requirement, v.gate_type AS gate,
        v.match_mode AS mode, v.effective_from, v.effective_until, v.revision_reason AS reason, a.full_name AS approved_by, v.approved_at, p.id
      FROM tenant.quality_control_point_versions v JOIN tenant.quality_control_points p ON p.id = v.control_point_id LEFT JOIN public.users a ON a.id = v.approved_by
      WHERE v.organization_id = $1 AND ${filter} AND ${pub} AND (${kind === "versions" ? "TRUE" : "v.id = COALESCE((SELECT x.id FROM tenant.quality_control_point_versions x WHERE x.control_point_id = p.id AND x.status = 'ACTIVE'), p.current_version_id)"})
      ORDER BY ${kind === "by-stage" ? "v.inspection_stage, " : ""}p.qcp_code, v.version_number DESC`, org)).rows
      .map((r) => href({ ...r, status: STATUS[r.status], stage: STAGES[r.stage], trigger_event: TRIGGERS[r.trigger_event]?.label, requirement: REQUIREMENTS[r.requirement], gate: GATES[r.gate], mode: MATCH_MODES[r.mode] }, r.id));
    columns = kind === "versions" ? ["code", "name", "version", "status", "reason", "approved_by", "approved_at", "effective_from"]
      : kind === "gate-coverage" ? ["code", "name", "stage", "trigger_event", "gate", "effective_from"] : ["code", "name", "version", "status", "stage", "trigger_event", "requirement", "gate", "mode"];
  } else if (kind === "by-item" || kind === "supplier-specific") {
    rows = (await qx(client, `SELECT COALESCE(i.code || ' · ' || i.name, 'Category ' || g.name, 'Company default') AS applies_to, ${SUPPLIER("r.supplier_id")} AS supplier, w.code AS site,
        p.qcp_code AS code, p.name, v.inspection_stage AS stage, v.gate_type AS gate, p.id
      FROM tenant.quality_control_point_rules r JOIN tenant.quality_control_point_versions v ON v.id = r.version_id AND v.status = 'ACTIVE' JOIN tenant.quality_control_points p ON p.id = v.control_point_id
      LEFT JOIN tenant.items i ON i.id = r.item_id LEFT JOIN tenant.item_groups g ON g.id = r.item_group_id LEFT JOIN tenant.warehouses w ON w.id = r.warehouse_id
      WHERE r.organization_id = $1 ${kind === "supplier-specific" ? "AND r.supplier_id IS NOT NULL" : ""} ORDER BY applies_to`, org)).rows.map((r) => href({ ...r, stage: STAGES[r.stage], gate: GATES[r.gate] }, r.id));
    columns = ["applies_to", "supplier", "site", "code", "name", "stage", "gate"];
  } else if (kind === "triggers" || kind === "failed-evaluations") {
    if (!has(c, QCP.history)) throw qcpError(403, "QUALITY_QCP_PERMISSION_DENIED");
    rows = (await qx(client, `SELECT * FROM tenant.quality_qcp_evaluations WHERE organization_id = $1 ${kind === "failed-evaluations" ? "AND outcome IN ('CONFLICT', 'SPEC_MISSING', 'FAILED', 'REEVALUATED')" : ""}
      ORDER BY occurred_at DESC LIMIT 500`, org)).rows.map((e) => { const x = evaluationView(e); return { source: x.source, date: x.date, outcome: x.outcomeLabel, control_points: x.controlPoints.join(", "),
        requirements: x.requirements, forced_hold: x.forcedHold ? "Yes" : "No", at: x.at, href: x.sourceHref }; });
    columns = ["source", "date", "outcome", "control_points", "requirements", "forced_hold", "at"];
  } else if (["requirements", "awaiting-clearance", "missing-specifications", "inspections"].includes(kind)) {
    const filter = { requirements: "TRUE", "awaiting-clearance": "o.blocking AND o.status IN ('PENDING', 'EXCEPTION')", "missing-specifications": "o.status = 'EXCEPTION' AND o.exception_code = 'SPEC_MISSING'",
      inspections: "o.inspection_id IS NOT NULL" }[kind];
    rows = (await qx(client, `${OBLIGATION_SQL} WHERE o.organization_id = $1 AND ${filter} ORDER BY o.created_at DESC LIMIT 500`, org)).rows.map(obligationView)
      .map((o) => ({ requirement: o.controlPoint, source: o.source, item: o.item, specification: o.specification, inspection: o.inspection?.number ?? null, status: o.statusLabel,
        controlled: o.controlled, accepted: o.accepted, rejected: o.rejected, allowance: o.allowance, href: o.href }));
    columns = ["requirement", "source", "item", "specification", "inspection", "status", "controlled", "accepted", "rejected", "allowance"];
  } else if (kind === "conflicts") {
    const x = await listQualityControlPointConflicts(client, c);
    rows = [...x.overlaps.map((o) => ({ kind: "Overlapping rules", first: o.first.code, second: o.second.code, detail: `${o.trigger} · ${o.purpose}`, href: o.first.href })),
      ...x.exceptions.filter((o) => o.exception === "RULE_CONFLICT").map((o) => ({ kind: "Conflict on a source", first: o.controlPoint, second: o.source, detail: o.item, href: o.href }))];
    columns = ["kind", "first", "second", "detail"];
  } else {
    rows = (await qx(client, `SELECT w.*, o.source_label, p.qcp_code, r.full_name AS requester, d.full_name AS decider FROM tenant.quality_qcp_waivers w JOIN tenant.quality_inspection_obligations o ON o.id = w.obligation_id
        JOIN tenant.quality_control_points p ON p.id = o.control_point_id LEFT JOIN public.users r ON r.id = w.requested_by LEFT JOIN public.users d ON d.id = w.decided_by
       WHERE w.organization_id = $1 ORDER BY w.requested_at DESC`, org)).rows.map((w) => ({ requirement: w.qcp_code, source: w.source_label, status: w.status, disposition: w.requested_disposition,
      quantity: w.quantity, reason: w.reason, requested_by: w.requester, decided_by: w.decider, decided_at: w.decided_at, href: `/quality/control-points/requirements/${w.obligation_id}` }));
    columns = ["requirement", "source", "status", "disposition", "quantity", "reason", "requested_by", "decided_by", "decided_at"];
  }
  return { kind, title, columns, rows };
}
export async function exportQualityControlPoints(client, c, { kind = "register" } = {}) {
  need(c, QCP.export);
  const report = await getQualityControlPointReport(client, c, kind);
  const cell = (v) => { const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return { fileName: `${kind}.csv`, body: [report.columns.join(","), ...report.rows.map((r) => report.columns.map((k) => cell(r[k])).join(","))].join("\n") };
}
export async function listQualityControlPointOptions(client, c) {
  need(c, QCP.view);
  const org = [c.organizationId];
  const specs = (await client.query(`SELECT s.id, s.specification_code, s.name, s.inspection_stage FROM tenant.quality_inspection_specifications s WHERE s.organization_id = $1 AND s.status = 'ACTIVE' AND NOT s.is_template
      ORDER BY s.specification_code`, org)).rows;
  const versions = (await client.query(`SELECT v.id, s.specification_code, v.version_number, v.status FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
      WHERE v.organization_id = $1 AND v.published_at IS NOT NULL AND v.status IN ('APPROVED', 'ACTIVE', 'SUPERSEDED') AND s.status = 'ACTIVE' ORDER BY s.specification_code, v.version_number DESC`, org)).rows;
  const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label: typeof label === "string" ? label : `${label.label}${label.enabled ? "" : " (not yet connected)"}` }));
  return {
    specifications: specs.map((s) => ({ value: s.id, label: `${s.specification_code} · ${s.name}`, stage: s.inspection_stage })),
    specVersions: versions.map((v) => ({ value: v.id, label: `${v.specification_code} v${v.version_number} (${STATUS[v.status]})` })),
    triggers: opts(TRIGGERS), requirements: opts(REQUIREMENTS), gates: opts(GATES), checkpoints: opts(CHECKPOINTS), bindings: opts(BINDINGS), matchModes: opts(MATCH_MODES), scopes: opts(SCOPES), stages: opts(STAGES),
  };
}
