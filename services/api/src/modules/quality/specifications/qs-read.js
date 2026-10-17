// Quality — Inspection Specifications: the directory and its views, one specification (its versions, checks, sampling, applicability,
// history, documents and usage), the inspector preview, conflicts and configuration exceptions, reports, the export and the settings. Readers
// who may only view see approved specifications; drafts and reviews are for those who prepare, review or approve them.
import { qx } from "../common.js";
import { loadChecks, loadSpec, loadVersion, settingsOf, unitsOf } from "./qs-data.js";
import { activateDueVersions, resolveSpecification } from "./qs-resolver.js";
import { ruleConflicts } from "./qs-commands.js";
import { specificationForControlPoint } from "../control-points/qcp-engine.js";
import { TRIGGERS as QUALITY_QCP_TRIGGERS } from "../control-points/qcp-rules.js";
import {
  CHECK_TYPES, CRITICALITY, DECISIONS, EDITABLE, METHODS, OPERATIONAL_STAGES, QS, ROUNDING, SAMPLING, SCOPES, STAGES, STATUS, compareVersions, criterionText, has, need, samplingSentence,
  contentHash, specError, text, validateVersion,
} from "./qs-rules.js";

const seesDrafts = (c) => [QS.create, QS.editDraft, QS.submit, QS.review, QS.approve, QS.activate, QS.revise].some((p) => has(c, p));
const SUPPLIER = `(SELECT COALESCE(bp.display_name, s.supplier_number) FROM tenant.procurement_suppliers s LEFT JOIN tenant.business_parties bp ON bp.id = s.party_id WHERE s.id = %s)`;
const supplierName = (col) => SUPPLIER.replace("%s", col);
const can = (c, spec, version, open) => ({
  edit: has(c, QS.editDraft) && spec.status === "ACTIVE" && Boolean(version && EDITABLE.includes(version.status)),
  submit: has(c, QS.submit) && spec.status === "ACTIVE" && Boolean(version && EDITABLE.includes(version.status)),
  review: has(c, QS.review) && version?.status === "PENDING_REVIEW",
  approve: has(c, QS.approve) && version?.status === "PENDING_REVIEW",
  publish: has(c, QS.activate) && version?.status === "APPROVED" && !version?.published_at && !spec.is_template,
  revise: has(c, QS.revise) && spec.status === "ACTIVE" && !open,
  copy: has(c, QS.copy) && has(c, QS.create),
  retire: has(c, QS.retire) && spec.status === "ACTIVE",
  applicability: has(c, QS.applicability) && spec.status === "ACTIVE" && !spec.is_template,
  history: has(c, QS.history),
  documents: has(c, QS.evidence),
  upload: has(c, QS.editDraft) && spec.status === "ACTIVE",
  export: has(c, QS.export),
});

// ------------------------------------------------------------------ the directory
const VIEWS = {
  all: "TRUE",
  drafts: "open.status IN ('DRAFT', 'CHANGES_REQUESTED')",
  pending: "open.status = 'PENDING_REVIEW'",
  active: "s.status = 'ACTIVE' AND act.id IS NOT NULL",
  scheduled: "EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions x WHERE x.specification_id = s.id AND x.status = 'APPROVED')",
  retired: "(s.status = 'RETIRED' OR (act.id IS NULL AND EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions x WHERE x.specification_id = s.id AND x.status = 'SUPERSEDED')))",
  templates: "s.is_template",
};
export async function listInspectionSpecifications(client, c, filters = {}) {
  need(c, QS.view);
  await activateDueVersions(client, c);
  const view = VIEWS[filters.view] ? filters.view : "all";
  const flags = { create: has(c, QS.create), export: has(c, QS.export), drafts: seesDrafts(c) };
  if (!seesDrafts(c) && ["drafts", "pending"].includes(view)) return { rows: [], view, can: flags };
  const params = [c.organizationId];
  const where = [VIEWS[view], view === "templates" ? "TRUE" : view === "all" ? "TRUE" : "NOT s.is_template"];
  if (!seesDrafts(c)) where.push("EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions x WHERE x.specification_id = s.id AND x.published_at IS NOT NULL)");
  const search = text(filters.search ?? filters.q, 120);
  if (search) { params.push(`%${search}%`); where.push(`(s.specification_code ILIKE $${params.length} OR s.name ILIKE $${params.length} OR i.code ILIKE $${params.length} OR i.name ILIKE $${params.length}
    OR s.description ILIKE $${params.length})`); }
  if (filters.stage && STAGES[filters.stage]) { params.push(filters.stage); where.push(`s.inspection_stage = $${params.length}`); }
  if (filters.itemId) { params.push(String(filters.itemId)); where.push(`(s.item_id = $${params.length}::uuid OR EXISTS (SELECT 1 FROM tenant.quality_spec_applicability_rules r WHERE r.specification_id = s.id AND r.item_id = $${params.length}::uuid AND r.status = 'ACTIVE'))`); }
  if (filters.supplierId) { params.push(String(filters.supplierId)); where.push(`EXISTS (SELECT 1 FROM tenant.quality_spec_applicability_rules r WHERE r.specification_id = s.id AND r.supplier_id = $${params.length}::uuid AND r.status = 'ACTIVE')`); }
  const sort = { name: "s.name", stage: "s.inspection_stage, s.specification_code", updated: "s.updated_at DESC", code: "s.specification_code" }[filters.sort] ?? "s.specification_code";
  const { rows } = await qx(client, `SELECT s.*, i.code AS item_code, i.name AS item_name, g.name AS group_name,
      act.id AS active_id, act.version_number AS active_number, act.effective_from AS active_from,
      open.id AS open_id, open.version_number AS open_number, open.status AS open_status,
      cur.version_number AS current_number, cur.status AS current_status, cur.effective_from AS current_from,
      (SELECT count(*)::int FROM tenant.quality_inspection_characteristics ch WHERE ch.version_id = COALESCE(act.id, cur.id)) AS checks,
      (SELECT count(*)::int FROM tenant.quality_spec_applicability_rules r WHERE r.specification_id = s.id AND r.status = 'ACTIVE') AS rules,
      EXISTS (SELECT 1 FROM tenant.quality_spec_applicability_rules r WHERE r.specification_id = s.id AND r.status = 'ACTIVE' AND r.supplier_id IS NOT NULL) AS supplier_specific
    FROM tenant.quality_inspection_specifications s
    LEFT JOIN tenant.items i ON i.id = s.item_id LEFT JOIN tenant.item_groups g ON g.id = s.item_group_id
    LEFT JOIN tenant.quality_inspection_spec_versions act ON act.specification_id = s.id AND act.status = 'ACTIVE'
    LEFT JOIN tenant.quality_inspection_spec_versions open ON open.specification_id = s.id AND open.status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED')
    LEFT JOIN tenant.quality_inspection_spec_versions cur ON cur.id = s.current_version_id
    WHERE s.organization_id = $1 AND ${where.join(" AND ")} ORDER BY ${sort} LIMIT 500`, params);
  return { view, rows: rows.map((s) => ({
    id: s.id, code: s.specification_code, name: s.name, description: s.description, stage: s.inspection_stage, stageLabel: STAGES[s.inspection_stage],
    item: s.item_id ? `${s.item_code} · ${s.item_name}` : null, category: s.group_name, template: s.is_template, status: s.status, statusLabel: s.status === "RETIRED" ? "Retired" : null,
    active: s.active_id ? { id: s.active_id, number: s.active_number, effectiveFrom: s.active_from } : null,
    open: s.open_id && seesDrafts(c) ? { id: s.open_id, number: s.open_number, status: s.open_status, statusLabel: STATUS[s.open_status] } : null,
    current: s.current_number ? { number: s.current_number, status: s.current_status, statusLabel: STATUS[s.current_status], effectiveFrom: s.current_from } : null,
    checks: s.checks, rules: s.rules, supplierSpecific: s.supplier_specific, updatedAt: s.updated_at, href: `/quality/specifications/${s.id}`,
  })), can: flags };
}

// ------------------------------------------------------------------ one specification
const versionView = (v) => ({
  id: v.id, number: v.version_number, status: v.status, statusLabel: STATUS[v.status], stage: v.inspection_stage, method: v.inspection_method, methodLabel: METHODS[v.inspection_method],
  sampling: { method: v.sampling_method, label: SAMPLING[v.sampling_method], value: v.sample_value, minimum: v.sample_minimum, maximum: v.sample_maximum, rounding: v.rounding_rule,
    roundingLabel: ROUNDING[v.rounding_rule], basis: v.sampling_basis, lotContext: v.lot_context, instructions: v.sampling_instructions, sentence: samplingSentence(v) },
  decision: { rule: v.decision_rule, label: DECISIONS[v.decision_rule], allowedMajor: v.allowed_major_defects, allowedMinor: v.allowed_minor_defects },
  effectiveFrom: v.effective_from, effectiveUntil: v.effective_until, revisionReason: v.revision_reason, supersedesVersionId: v.supersedes_version_id,
  submittedAt: v.submitted_at, reviewedAt: v.reviewed_at, reviewNote: v.review_note, approvedAt: v.approved_at, approvalNote: v.approval_note, publishedAt: v.published_at,
  activatedAt: v.activated_at, supersededAt: v.superseded_at, retiredAt: v.retired_at, contentHash: v.content_hash, createdAt: v.created_at, legacy: Boolean(v.legacy_plan_id), version: v.row_version,
});
const checkView = (ch) => ({
  id: ch.id, code: ch.characteristic_code, sequence: ch.sequence, name: ch.name, type: ch.check_type, typeLabel: CHECK_TYPES[ch.check_type], instructions: ch.instructions,
  acceptanceText: ch.acceptance_text, acceptable: criterionText(ch), evidenceNote: ch.evidence_note, uomId: ch.uom_id, unit: ch.unit_code, targetValue: ch.target_value,
  lowerTolerance: ch.lower_tolerance, upperTolerance: ch.upper_tolerance, lowerLimit: ch.lower_limit, upperLimit: ch.upper_limit, lowerInclusive: ch.lower_inclusive, upperInclusive: ch.upper_inclusive,
  decimalPlaces: ch.decimal_places, measurementRounding: ch.measurement_rounding, expectedBoolean: ch.expected_boolean, allowedValues: ch.allowed_values, judgement: ch.judgement,
  criticality: ch.criticality, criticalityLabel: CRITICALITY[ch.criticality], required: ch.is_required, allowNa: ch.allow_na, evidenceRequired: ch.evidence_required, instrument: ch.instrument_note,
});
async function rulesOf(client, c, specId) {
  return (await qx(client, `SELECT r.*, i.code AS item_code, i.name AS item_name, g.name AS group_name, w.code AS warehouse_code, w.name AS warehouse_name, ${supplierName("r.supplier_id")} AS supplier_name
      FROM tenant.quality_spec_applicability_rules r LEFT JOIN tenant.items i ON i.id = r.item_id LEFT JOIN tenant.item_groups g ON g.id = r.item_group_id LEFT JOIN tenant.warehouses w ON w.id = r.warehouse_id
     WHERE r.organization_id = $1 AND r.specification_id = $2 ORDER BY r.status, r.specificity, r.created_at`, [c.organizationId, specId])).rows.map((r) => ({
    id: r.id, scope: r.scope_kind, scopeLabel: SCOPES[r.scope_kind], item: r.item_id ? `${r.item_code} · ${r.item_name}` : null, itemId: r.item_id, category: r.group_name, itemGroupId: r.item_group_id,
    supplier: r.supplier_name, supplierId: r.supplier_id, site: r.warehouse_id ? `${r.warehouse_code} · ${r.warehouse_name}` : null, warehouseId: r.warehouse_id,
    effectiveFrom: r.effective_from, effectiveUntil: r.effective_until, specificity: r.specificity, status: r.status, reason: r.reason, deactivationReason: r.deactivation_reason,
    describe: [r.scope_kind === "ITEM" ? `${r.item_code} · ${r.item_name}` : r.scope_kind === "CATEGORY" ? `Category ${r.group_name}` : "Every item (Company default)",
      r.supplier_id ? `from ${r.supplier_name}` : null, r.warehouse_id ? `at ${r.warehouse_code}` : null].filter(Boolean).join(" "),
  }));
}
async function snapshot(client, c, v) {
  return { version: v, checks: await loadChecks(client, c, v.id) };
}
export async function getInspectionSpecification(client, c, specId, { versionId = null } = {}) {
  need(c, QS.view);
  await activateDueVersions(client, c, { specId });
  const spec = await loadSpec(client, c, specId);
  const all = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1 ORDER BY version_number DESC`, [spec.id])).rows;
  const visible = seesDrafts(c) ? all : all.filter((v) => v.published_at);
  if (!visible.length) throw specError(404, "QUALITY_SPEC_NOT_FOUND");
  const open = all.find((v) => ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED"].includes(v.status)) ?? null;
  const active = all.find((v) => v.status === "ACTIVE") ?? null;
  const selected = (versionId && visible.find((v) => v.id === versionId)) || (seesDrafts(c) && open) || active || visible[0];
  const checks = await loadChecks(client, c, selected.id);
  const item = spec.item_id ? (await client.query(`SELECT id, code, name, COALESCE(status, 'active') AS status FROM tenant.items WHERE id = $1`, [spec.item_id])).rows[0] : null;
  const group = spec.item_group_id ? (await client.query(`SELECT id, name FROM tenant.item_groups WHERE id = $1`, [spec.item_group_id])).rows[0] : null;
  const issues = EDITABLE.includes(selected.status) || selected.status === "PENDING_REVIEW"
    ? validateVersion(spec, selected, checks, { units: await unitsOf(client, c), item: spec.item_id ? (item?.status === "active" ? item : null) : undefined }) : [];
  const predecessor = selected.supersedes_version_id ? all.find((v) => v.id === selected.supersedes_version_id) : null;
  const comparison = predecessor ? { from: predecessor.version_number, ...compareVersions(await snapshot(client, c, predecessor), { version: selected, checks }) } : null;
  const usage = (await client.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('draft', 'in_progress'))::int AS open FROM tenant.quality_inspections
    WHERE organization_id = $1 AND spec_version_id = ANY($2::uuid[])`, [c.organizationId, all.map((v) => v.id)])).rows[0];
  const people = await client.query(`SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`,
    [[spec.created_by, selected.created_by, selected.submitted_by, selected.reviewed_by, selected.approved_by, selected.published_by, spec.retired_by].filter(Boolean)]);
  const who = (id) => people.rows.find((p) => p.id === id)?.full_name ?? null;
  const policy = await settingsOf(client, c);
  const flags = can(c, spec, selected, open);
  if (flags.approve && policy.prohibitSelfApproval && c.userId && [selected.created_by, selected.submitted_by].includes(c.userId)) flags.approve = false;
  return {
    id: spec.id, code: spec.specification_code, name: spec.name, description: spec.description, stage: spec.inspection_stage, stageLabel: STAGES[spec.inspection_stage],
    operational: Boolean(OPERATIONAL_STAGES[spec.inspection_stage]), integration: OPERATIONAL_STAGES[spec.inspection_stage] ?? null,
    item: item ? { id: item.id, code: item.code, name: item.name, active: item.status === "active" } : null, category: group ? { id: group.id, name: group.name } : null,
    template: spec.is_template, status: spec.status, retiredAt: spec.retired_at, retiredBy: who(spec.retired_by), retireReason: spec.retire_reason, legacyPlanCode: spec.legacy_plan_code,
    createdBy: who(spec.created_by), createdAt: spec.created_at, version: spec.row_version,
    selected: { ...versionView(selected), checks: checks.map(checkView), issues, valid: issues.length === 0, comparison, createdBy: who(selected.created_by), submittedBy: who(selected.submitted_by),
      reviewedBy: who(selected.reviewed_by), approvedBy: who(selected.approved_by), publishedBy: who(selected.published_by),
      integrity: selected.content_hash ? { recorded: selected.content_hash, intact: contentHash(selected, checks) === selected.content_hash } : null },
    versions: visible.map((v) => ({ id: v.id, number: v.version_number, status: v.status, statusLabel: STATUS[v.status], effectiveFrom: v.effective_from, effectiveUntil: v.effective_until,
      approvedAt: v.approved_at, revisionReason: v.revision_reason, current: v.id === selected.id })),
    active: active ? { id: active.id, number: active.version_number, effectiveFrom: active.effective_from } : null,
    open: open && seesDrafts(c) ? { id: open.id, number: open.version_number, status: open.status } : null,
    rules: spec.is_template ? [] : await rulesOf(client, c, spec.id),
    conflicts: spec.is_template ? [] : await ruleConflicts(client, c, spec.id),
    usage: { inspections: usage.n, open: usage.open },
    policy, can: flags, href: `/quality/specifications/${spec.id}`,
  };
}

// What an inspector will see: plain instructions, the acceptable result, the proof needed — for an approved version, or a draft for its editors.
export async function previewInspectionSpecification(client, c, specId, versionId) {
  need(c, QS.view);
  const spec = await loadSpec(client, c, specId);
  const v = await loadVersion(client, c, spec.id, versionId);
  if (!v.published_at && !seesDrafts(c)) throw specError(404, "QUALITY_SPEC_NOT_FOUND");
  const checks = await loadChecks(client, c, v.id);
  return {
    title: spec.name, code: spec.specification_code, version: v.version_number, status: STATUS[v.status], stage: STAGES[spec.inspection_stage], method: METHODS[v.inspection_method],
    sampling: samplingSentence(v) + (v.sampling_instructions ? ` ${v.sampling_instructions}` : ""), decision: DECISIONS[v.decision_rule]
      + (v.decision_rule === "COUNT_BASED" ? ` (up to ${v.allowed_major_defects ?? 0} major and ${v.allowed_minor_defects ?? 0} minor defective samples)` : ""),
    draft: !v.published_at,
    rows: checks.map((ch) => ({ sequence: ch.sequence, check: ch.name, what: ch.name, how: [ch.instructions, ch.instrument_note ? `Use: ${ch.instrument_note}` : null].filter(Boolean).join(" ") || "As instructed",
      acceptable: criterionText(ch), proof: ch.evidence_required ? ch.evidence_note || "Photo or record required" : null, critical: ch.criticality === "CRITICAL",
      required: ch.is_required, notApplicableAllowed: ch.allow_na, informational: ch.criticality === "INFORMATIONAL" })),
  };
}

export async function getSpecificationVersionHistory(client, c, specId) {
  need(c, QS.history);
  const spec = await loadSpec(client, c, specId);
  const events = (await qx(client, `SELECT e.*, v.version_number, u.full_name FROM tenant.quality_spec_events e LEFT JOIN tenant.quality_inspection_spec_versions v ON v.id = e.version_id
      LEFT JOIN public.users u ON u.id = e.actor_user_id WHERE e.organization_id = $1 AND e.specification_id = $2 ORDER BY e.occurred_at DESC, e.id LIMIT 500`, [c.organizationId, spec.id])).rows;
  const versions = (await qx(client, `SELECT v.*, a.full_name AS approver, p.full_name AS preparer FROM tenant.quality_inspection_spec_versions v LEFT JOIN public.users a ON a.id = v.approved_by
      LEFT JOIN public.users p ON p.id = v.created_by WHERE v.specification_id = $1 ORDER BY v.version_number DESC`, [spec.id])).rows;
  return {
    versions: versions.map((v) => ({ ...versionView(v), approver: v.approver, preparer: v.preparer })),
    events: events.map((e) => ({ id: e.id, action: e.action, version: e.version_number, from: e.from_status, to: e.to_status, note: e.note, details: e.details, by: e.full_name ?? "System", at: e.occurred_at })),
  };
}
export async function compareSpecificationVersions(client, c, specId, fromVersionId, toVersionId) {
  need(c, QS.history);
  const spec = await loadSpec(client, c, specId);
  const a = await loadVersion(client, c, spec.id, fromVersionId);
  const b = await loadVersion(client, c, spec.id, toVersionId);
  return { from: a.version_number, to: b.version_number, ...compareVersions(await snapshot(client, c, a), await snapshot(client, c, b)) };
}

export async function getSpecificationUsage(client, c, specId) {
  need(c, QS.view);
  const spec = await loadSpec(client, c, specId);
  const inspections = (await qx(client, `SELECT q.id, q.inspection_number, q.status, q.source_type, q.lot_quantity, q.sample_quantity, q.created_at, q.spec_resolution, v.version_number, i.code AS item_code
      FROM tenant.quality_inspections q JOIN tenant.quality_inspection_spec_versions v ON v.id = q.spec_version_id LEFT JOIN tenant.items i ON i.id = q.item_id
     WHERE q.organization_id = $1 AND v.specification_id = $2 ORDER BY q.created_at DESC LIMIT 500`, [c.organizationId, spec.id])).rows;
  return { inspections: inspections.map((q) => ({ id: q.id, number: q.inspection_number, status: q.status, source: q.source_type, item: q.item_code, version: q.version_number, lot: q.lot_quantity,
    sample: q.sample_quantity, method: q.spec_resolution?.method ?? null, at: q.created_at, href: `/quality/inspection/${q.id}` })) };
}

// ------------------------------------------------------------------ conflicts and exceptions
export async function listSpecificationConflicts(client, c) {
  need(c, QS.view);
  // Equally specific rules of different specifications for the same stage and item / category / company, over overlapping dates, that one
  // source could match at once (the same supplier and site, or one rule naming the supplier and the other the site).
  const { rows } = await qx(client, `SELECT a.id AS a_rule, b.id AS b_rule, a.inspection_stage, a.scope_kind, a.specificity, sa.specification_code AS a_code, sa.name AS a_name, sa.id AS a_spec,
      sb.specification_code AS b_code, sb.name AS b_name, sb.id AS b_spec, i.code AS item_code, i.name AS item_name, g.name AS group_name
    FROM tenant.quality_spec_applicability_rules a JOIN tenant.quality_spec_applicability_rules b ON b.organization_id = a.organization_id AND b.inspection_stage = a.inspection_stage
      AND b.scope_kind = a.scope_kind AND b.specificity = a.specificity AND b.id > a.id AND b.specification_id <> a.specification_id
      AND b.item_id IS NOT DISTINCT FROM a.item_id AND b.item_group_id IS NOT DISTINCT FROM a.item_group_id
      AND (a.supplier_id IS NULL OR b.supplier_id IS NULL OR a.supplier_id = b.supplier_id) AND (a.warehouse_id IS NULL OR b.warehouse_id IS NULL OR a.warehouse_id = b.warehouse_id)
      AND a.effective_from <= COALESCE(b.effective_until, 'infinity'::date) AND b.effective_from <= COALESCE(a.effective_until, 'infinity'::date)
    JOIN tenant.quality_inspection_specifications sa ON sa.id = a.specification_id JOIN tenant.quality_inspection_specifications sb ON sb.id = b.specification_id
    LEFT JOIN tenant.items i ON i.id = a.item_id LEFT JOIN tenant.item_groups g ON g.id = a.item_group_id
    WHERE a.organization_id = $1 AND a.status = 'ACTIVE' AND b.status = 'ACTIVE' AND sa.status = 'ACTIVE' AND sb.status = 'ACTIVE' AND NOT sa.is_template AND NOT sb.is_template
    ORDER BY a.inspection_stage, a_code`, [c.organizationId]);
  const exceptions = await listSpecificationExceptions(client, c, { status: "OPEN" });
  return {
    conflicts: rows.map((r) => ({ stage: r.inspection_stage, stageLabel: STAGES[r.inspection_stage], scope: r.scope_kind === "ITEM" ? `${r.item_code} · ${r.item_name}` : r.scope_kind === "CATEGORY" ? `Category ${r.group_name}` : "Company default",
      first: { code: r.a_code, name: r.a_name, href: `/quality/specifications/${r.a_spec}?tab=applicability` }, second: { code: r.b_code, name: r.b_name, href: `/quality/specifications/${r.b_spec}?tab=applicability` },
      message: "Two equally specific specifications apply. Make one more specific, end one, or deactivate a rule." })),
    exceptions: exceptions.rows,
  };
}
const EXCEPTION_LABEL = { SPEC_MISSING: "Inspection required but no approved specification applies", APPLICABILITY_CONFLICT: "Two applicable specifications were found",
  SPEC_NOT_EFFECTIVE: "The specification is not yet effective", SPEC_RETIRED: "The specification is retired" };
export async function listSpecificationExceptions(client, c, filters = {}) {
  need(c, QS.view);
  const status = ["OPEN", "RESOLVED", "DISMISSED"].includes(filters.status) ? filters.status : null;
  const { rows } = await qx(client, `SELECT e.*, i.code AS item_code, i.name AS item_name, w.code AS warehouse_code, ${supplierName("e.supplier_id")} AS supplier_name, u.full_name AS resolver
      FROM tenant.quality_spec_exceptions e LEFT JOIN tenant.items i ON i.id = e.item_id LEFT JOIN tenant.warehouses w ON w.id = e.warehouse_id LEFT JOIN public.users u ON u.id = e.resolved_by
     WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2) ORDER BY e.created_at DESC LIMIT 500`, [c.organizationId, status]);
  return { rows: rows.map((e) => ({ id: e.id, code: e.exception_code, label: EXCEPTION_LABEL[e.exception_code], stage: STAGES[e.inspection_stage] ?? e.inspection_stage,
    item: e.item_id ? `${e.item_code} · ${e.item_name}` : null, supplier: e.supplier_name, site: e.warehouse_code, source: e.source_label ?? e.source_type,
    sourceHref: e.source_type === "goods_receipt" && e.source_id ? `/procurement/goods-receipts/${e.source_id}` : null, detail: e.detail, status: e.status, resolvedBy: e.resolver,
    resolution: e.resolution_note, raisedAt: e.created_at, resolvedAt: e.resolved_at })),
  can: { resolve: has(c, QS.applicability) || has(c, QS.settings) } };
}

// ------------------------------------------------------------------ the Quality overview, reports and the export
export async function getSpecificationOverview(client, c) {
  need(c, QS.view);
  await activateDueVersions(client, c);
  const drafts = seesDrafts(c);
  const k = (await client.query(`SELECT
      count(*) FILTER (WHERE s.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status = 'ACTIVE') AND NOT s.is_template)::int AS active,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status IN ('DRAFT', 'CHANGES_REQUESTED')))::int AS drafts,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status = 'PENDING_REVIEW'))::int AS pending,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status = 'APPROVED' AND v.published_at IS NOT NULL))::int AS scheduled,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status = 'APPROVED' AND v.published_at IS NULL))::int AS unpublished,
      count(*) FILTER (WHERE s.status = 'RETIRED')::int AS retired, count(*) FILTER (WHERE s.is_template)::int AS templates
    FROM tenant.quality_inspection_specifications s WHERE s.organization_id = $1`, [c.organizationId])).rows[0];
  const conflicts = await listSpecificationConflicts(client, c);
  const pending = drafts ? (await qx(client, `SELECT s.id, s.specification_code, s.name, v.version_number, v.submitted_at FROM tenant.quality_inspection_spec_versions v
      JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id WHERE v.organization_id = $1 AND v.status = 'PENDING_REVIEW' ORDER BY v.submitted_at LIMIT 10`, [c.organizationId])).rows : [];
  return {
    counts: { active: k.active, templates: k.templates, retired: k.retired, ...(drafts ? { drafts: k.drafts, pending: k.pending, scheduled: k.scheduled, unpublished: k.unpublished } : {}),
      conflicts: conflicts.conflicts.length, exceptions: conflicts.exceptions.length },
    pending: pending.map((p) => ({ id: p.id, code: p.specification_code, name: p.name, version: p.version_number, submittedAt: p.submitted_at, href: `/quality/specifications/${p.id}` })),
    can: { create: has(c, QS.create), review: has(c, QS.review) || has(c, QS.approve), settings: has(c, QS.settings), export: has(c, QS.export) },
  };
}

export const SPEC_REPORTS = Object.freeze({
  register: "Inspection Specification Register", active: "Active Approved Specifications", backlog: "Draft / Pending Approval", "by-item": "Specifications by Item",
  "by-stage": "Specifications by Stage", "supplier-specific": "Supplier-Specific Specifications", "missing-criteria": "Specifications Missing Required Criteria",
  conflicts: "Conflicting Applicability Rules", revisions: "Specification Revision History", usage: "Specifications Used in Inspections", retired: "Retired / Superseded Specifications",
  "coverage-gaps": "Inspection Coverage Gaps",
});
export async function getSpecificationReport(client, c, kind) {
  need(c, QS.view);
  if (!SPEC_REPORTS[kind]) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "Unknown report.");
  await activateDueVersions(client, c);
  const title = SPEC_REPORTS[kind];
  const org = [c.organizationId];
  const drafts = seesDrafts(c);
  const published = drafts ? "TRUE" : "v.published_at IS NOT NULL";
  let columns;
  let rows;
  if (["register", "active", "backlog", "retired", "by-stage"].includes(kind)) {
    const filter = { register: "TRUE", active: "v.status = 'ACTIVE'", backlog: drafts ? "v.status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED')" : "FALSE",
      retired: "(s.status = 'RETIRED' OR v.status IN ('SUPERSEDED', 'RETIRED'))", "by-stage": "v.status = 'ACTIVE'" }[kind];
    rows = (await qx(client, `SELECT s.specification_code AS code, s.name, s.inspection_stage AS stage, v.version_number AS version, v.status, v.effective_from, v.effective_until,
        COALESCE(i.code, g.name, CASE WHEN s.is_template THEN 'Template' ELSE 'Company default' END) AS scope, s.id
      FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id LEFT JOIN tenant.items i ON i.id = s.item_id
      LEFT JOIN tenant.item_groups g ON g.id = s.item_group_id WHERE v.organization_id = $1 AND ${filter} AND ${published}
      ORDER BY ${kind === "by-stage" ? "s.inspection_stage, " : ""}s.specification_code, v.version_number DESC`, org)).rows
      .map((r) => ({ ...r, stage: STAGES[r.stage], status: STATUS[r.status], href: `/quality/specifications/${r.id}` }));
    columns = ["code", "name", "stage", "version", "status", "effective_from", "effective_until", "scope"];
  } else if (kind === "by-item" || kind === "supplier-specific") {
    rows = (await qx(client, `SELECT COALESCE(i.code || ' · ' || i.name, 'Category ' || g.name, 'Company default') AS applies_to, r.inspection_stage AS stage, s.specification_code AS code, s.name,
        ${supplierName("r.supplier_id")} AS supplier, w.code AS site, r.effective_from, r.effective_until, r.reason, s.id
      FROM tenant.quality_spec_applicability_rules r JOIN tenant.quality_inspection_specifications s ON s.id = r.specification_id LEFT JOIN tenant.items i ON i.id = r.item_id
      LEFT JOIN tenant.item_groups g ON g.id = r.item_group_id LEFT JOIN tenant.warehouses w ON w.id = r.warehouse_id
      WHERE r.organization_id = $1 AND r.status = 'ACTIVE' AND s.status = 'ACTIVE' ${kind === "supplier-specific" ? "AND r.supplier_id IS NOT NULL" : ""} ORDER BY applies_to, r.inspection_stage`, org)).rows
      .map((r) => ({ ...r, stage: STAGES[r.stage], href: `/quality/specifications/${r.id}` }));
    columns = ["applies_to", "stage", "code", "name", "supplier", "site", "effective_from", "effective_until", "reason"];
  } else if (kind === "missing-criteria") {
    if (!drafts) return { kind, title, columns: [], rows: [] };
    const open = (await qx(client, `SELECT v.*, s.name, s.specification_code, s.item_id, s.id AS spec_id FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
        WHERE v.organization_id = $1 AND v.status IN ('DRAFT', 'CHANGES_REQUESTED', 'PENDING_REVIEW') ORDER BY s.specification_code`, org)).rows;
    const units = await unitsOf(client, c);
    rows = [];
    for (const v of open) {
      const issues = validateVersion({ name: v.name, item_id: v.item_id }, v, await loadChecks(client, c, v.id), { units });
      if (issues.length) rows.push({ code: v.specification_code, name: v.name, version: v.version_number, status: STATUS[v.status], issues: issues.map((x) => x.message).join("; "), href: `/quality/specifications/${v.spec_id}` });
    }
    columns = ["code", "name", "version", "status", "issues"];
  } else if (kind === "conflicts") {
    const x = await listSpecificationConflicts(client, c);
    rows = x.conflicts.map((r) => ({ stage: r.stageLabel, applies_to: r.scope, first: r.first.code, second: r.second.code, href: r.first.href }));
    columns = ["stage", "applies_to", "first", "second"];
  } else if (kind === "revisions") {
    if (!has(c, QS.history)) throw specError(403, "QUALITY_SPEC_PERMISSION_DENIED");
    rows = (await qx(client, `SELECT s.specification_code AS code, s.name, v.version_number AS version, v.status, v.revision_reason AS reason, v.approved_at, u.full_name AS approved_by, v.effective_from, s.id
      FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id LEFT JOIN public.users u ON u.id = v.approved_by
      WHERE v.organization_id = $1 AND ${published} ORDER BY s.specification_code, v.version_number DESC`, org)).rows.map((r) => ({ ...r, status: STATUS[r.status], href: `/quality/specifications/${r.id}` }));
    columns = ["code", "name", "version", "status", "reason", "approved_by", "approved_at", "effective_from"];
  } else if (kind === "usage") {
    rows = (await qx(client, `SELECT s.specification_code AS code, s.name, v.version_number AS version, count(q.id)::int AS inspections, count(q.id) FILTER (WHERE q.status IN ('draft', 'in_progress'))::int AS open,
        max(q.created_at) AS last_used, s.id
      FROM tenant.quality_inspections q JOIN tenant.quality_inspection_spec_versions v ON v.id = q.spec_version_id JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
      WHERE q.organization_id = $1 GROUP BY s.id, s.specification_code, s.name, v.version_number ORDER BY s.specification_code, v.version_number DESC`, org)).rows.map((r) => ({ ...r, href: `/quality/specifications/${r.id}?tab=usage` }));
    columns = ["code", "name", "version", "inspections", "open", "last_used"];
  } else {
    // Coverage gaps: only where a mandatory Quality Control Point requires an inspection. An item without a specification is not, by itself, a defect.
    const points = (await qx(client, `SELECT v.*, p.qcp_code, r.scope_kind, r.item_id AS rule_item, r.item_group_id AS rule_group, r.supplier_id AS rule_supplier, r.warehouse_id AS rule_site
        FROM tenant.quality_control_point_versions v JOIN tenant.quality_control_points p ON p.id = v.control_point_id AND p.status = 'ACTIVE'
        JOIN tenant.quality_control_point_rules r ON r.version_id = v.id WHERE v.organization_id = $1 AND v.status = 'ACTIVE' AND v.requirement_type = 'MANDATORY'`, org)).rows;
    rows = [];
    const day = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
    for (const r of points) {
      const items = (await client.query(r.scope_kind === "ITEM" ? `SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND id = $2`
        : r.scope_kind === "CATEGORY" ? `SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND group_id = $2 AND COALESCE(status, 'active') = 'active' ORDER BY code LIMIT 300`
          : `SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active' AND item_type <> 'service' AND ($2::uuid IS NULL OR TRUE) ORDER BY code LIMIT 300`,
      [c.organizationId, r.rule_item ?? r.rule_group ?? null])).rows;
      for (const it of items) {
        const out = await specificationForControlPoint(client, c, r, { itemId: it.id, supplierId: r.rule_supplier, warehouseId: r.rule_site, date: day });
        if (!out.versionId) rows.push({ item: `${it.code} · ${it.name}`, stage: STAGES[r.inspection_stage], requirement: r.qcp_code, problem: out.reason });
      }
    }
    columns = ["item", "stage", "requirement", "problem"];
  }
  return { kind, title, columns, rows };
}
export async function exportInspectionSpecifications(client, c, { kind = "register" } = {}) {
  need(c, QS.export);
  const report = await getSpecificationReport(client, c, kind);
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [report.columns.join(","), ...report.rows.map((r) => report.columns.map((k) => cell(r[k])).join(","))].join("\n");
  return { fileName: `${kind}.csv`, mimeType: "text/csv", body };
}

// ------------------------------------------------------------------ options and settings
export async function listSpecificationOptions(client, c) {
  need(c, QS.view);
  const org = [c.organizationId];
  const [items, groups, suppliers, sites, units] = [
    (await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active' ORDER BY code LIMIT 2000`, org)).rows,
    (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active' ORDER BY name LIMIT 1000`, org)).rows,
    (await client.query(`SELECT s.id, COALESCE(bp.display_name, s.supplier_number) AS name FROM tenant.procurement_suppliers s LEFT JOIN tenant.business_parties bp ON bp.id = s.party_id
      WHERE s.organization_id = $1 AND s.status NOT IN ('blocked', 'inactive', 'archived') ORDER BY 2 LIMIT 2000`, org)).rows,
    (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 ORDER BY code LIMIT 500`, org)).rows,
    (await client.query(`SELECT u.id, u.code, u.name, x.dimension FROM tenant.units_of_measure u LEFT JOIN public.uom_standard_conversions x ON x.code = upper(u.code)
      WHERE u.organization_id = $1 AND COALESCE(u.status, 'active') = 'active' ORDER BY u.code`, org)).rows,
  ];
  const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
  return {
    items: items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })), categories: groups.map((g) => ({ value: g.id, label: g.name })),
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })), sites: sites.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` })),
    units: units.map((u) => ({ value: u.id, label: `${u.code} · ${u.name}`, code: u.code, dimension: u.dimension })),
    stages: opts(STAGES), checkTypes: opts(CHECK_TYPES), criticality: opts(CRITICALITY), sampling: opts(SAMPLING), decisions: opts(DECISIONS), rounding: opts(ROUNDING), scopes: opts(SCOPES),
  };
}
export async function getSpecificationSettings(client, c) {
  need(c, QS.view);
  const policy = await settingsOf(client, c);
  return {
    policy,
    stages: Object.entries(STAGES).map(([value, label]) => ({ value, label, operational: Boolean(OPERATIONAL_STAGES[value]), integration: OPERATIONAL_STAGES[value]
      ?? "Defined; resolved automatically once its source workflow is connected" })),
    gates: Object.entries(QUALITY_QCP_TRIGGERS).map(([value, t]) => ({ value, label: t.label, stage: STAGES[t.stage], enabled: t.enabled, gates: t.gates })),
    can: { manage: has(c, QS.settings) },
  };
}
