// Quality — Quality Control Points: every change. A control point starts as a draft version (stage, trigger, mandatory / advisory / manual,
// gate, specification binding, applicability); it is validated, submitted, approved by someone other than its preparer (the Company's
// policy), and published — effective from its date. Approved versions never change: a revision is a new version, and obligations already
// created keep the version that created them. Retiring stops new matching; it never releases stock held under the rule. Waivers are
// requested and approved by different authorized people, and never for a failed critical check.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { qx } from "../common.js";
import { activateDueQcps, loadObligation, recordQcpEvent, today } from "./qcp-engine.js";
import {
  BINDINGS, EDITABLE, GATES, MATCH_MODES, QCP, REQUIREMENTS, SCOPES, STAGES, TRIGGERS, bool, dateOrNull, expectVersion, has, need, oneOf, qcpContentHash, qcpError, text, textOrNull,
  tierOf, uuid, uuidOrNull, validateQcpVersion,
} from "./qcp-rules.js";

const FIELDS = ["inspection_stage", "trigger_event", "requirement_type", "gate_type", "spec_binding", "specification_id", "spec_version_id", "match_mode", "purpose_code", "quantity_scope",
  "lot_context", "waiver_allowed", "effective_from", "effective_until", "revision_reason"];
export async function loadPoint(client, c, id, { lock = false } = {}) {
  const row = (await qx(client, `SELECT * FROM tenant.quality_control_points WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Control point")])).rows[0];
  if (!row) throw qcpError(404, "QUALITY_QCP_NOT_FOUND");
  return row;
}
export async function loadQcpVersion(client, c, pointId, versionId, { lock = false } = {}) {
  const row = (await qx(client, `SELECT * FROM tenant.quality_control_point_versions WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(versionId, "Version")])).rows[0];
  if (!row || (pointId && row.control_point_id !== pointId)) throw qcpError(404, "QUALITY_QCP_NOT_FOUND", "That control point version was not found.");
  return row;
}
export const rulesOfVersion = async (client, c, versionId) => (await qx(client, `SELECT * FROM tenant.quality_control_point_rules WHERE organization_id = $1 AND version_id = $2 ORDER BY specificity, created_at`,
  [c.organizationId, versionId])).rows;
const editable = (v) => {
  if (!EDITABLE.includes(v.status)) throw qcpError(409, "QUALITY_QCP_VERSION_IMMUTABLE");
};
const dbError = (error) => {
  if (String(error?.message ?? "").startsWith("QUALITY_QCP_VERSION_IMMUTABLE")) throw qcpError(409, "QUALITY_QCP_VERSION_IMMUTABLE");
  throw error;
};
async function policyOf(client, c) {
  const row = (await client.query(`SELECT spec_prohibit_self_approval, spec_approval_note_required FROM tenant.quality_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { prohibitSelfApproval: row ? row.spec_prohibit_self_approval : true, approvalNoteRequired: row ? row.spec_approval_note_required : false };
}

// ------------------------------------------------------------------ input
async function fieldsOf(client, c, input, base = {}) {
  const pick = (k, alt) => (input[k] !== undefined ? input[k] : base[alt]);
  const trigger = oneOf(pick("triggerEvent", "trigger_event") ?? "INVENTORY_GOODS_RECEIPT_CONFIRMED", TRIGGERS, "QUALITY_QCP_TRIGGER_UNAVAILABLE", "Trigger");
  const stage = oneOf(pick("stage", "inspection_stage") ?? TRIGGERS[trigger].stage, STAGES, "QUALITY_QCP_STAGE_INVALID");
  const requirement = oneOf(pick("requirementType", "requirement_type") ?? (trigger === "QUALITY_MANUAL_INSPECTION_REQUESTED" ? "MANUAL" : "MANDATORY"), REQUIREMENTS, "QUALITY_QCP_INVALID", "Requirement");
  const gate = oneOf(pick("gateType", "gate_type") ?? "NONE", GATES, "QUALITY_QCP_INVALID", "Gate");
  if (gate !== (base.gate_type ?? "NONE") && !has(c, QCP.manageGate)) throw qcpError(403, "QUALITY_QCP_PERMISSION_DENIED", "Configuring a quality gate needs the Configure quality gates permission.");
  const binding = oneOf(pick("specBinding", "spec_binding") ?? "FAMILY", BINDINGS, "QUALITY_QCP_SPEC_MISSING", "Specification binding");
  let specificationId = uuidOrNull(pick("specificationId", "specification_id"), "Specification");
  let specVersionId = binding === "LOCKED" ? uuidOrNull(pick("specVersionId", "spec_version_id"), "Specification version") : null;
  if (binding === "RESOLVE") specificationId = null;
  if (specVersionId) {
    const sv = (await client.query(`SELECT specification_id FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND id = $2`, [c.organizationId, specVersionId])).rows[0];
    if (!sv) throw qcpError(400, "QUALITY_QCP_SPEC_MISSING");
    specificationId = sv.specification_id;
  }
  if (specificationId && !(await client.query(`SELECT 1 FROM tenant.quality_inspection_specifications WHERE organization_id = $1 AND id = $2`, [c.organizationId, specificationId])).rows[0])
    throw qcpError(400, "QUALITY_QCP_SPEC_MISSING");
  const purpose = text(pick("purposeCode", "purpose_code") ?? "GENERAL", 30).toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "GENERAL";
  return {
    inspection_stage: stage, trigger_event: trigger, requirement_type: requirement, gate_type: gate, spec_binding: binding, specification_id: specificationId, spec_version_id: specVersionId,
    match_mode: oneOf(pick("matchMode", "match_mode") ?? "OVERRIDE_DEFAULT", MATCH_MODES, "QUALITY_QCP_INVALID", "Match mode"), purpose_code: purpose,
    quantity_scope: pick("quantityScope", "quantity_scope") === "HELD_QUANTITY" ? "HELD_QUANTITY" : "RECEIVED_QUANTITY",
    lot_context: ["NONE", "PER_LOT", "PER_SERIAL"].includes(pick("lotContext", "lot_context")) ? pick("lotContext", "lot_context") : "NONE",
    waiver_allowed: bool(pick("waiverAllowed", "waiver_allowed"), true),
    effective_from: dateOrNull(pick("effectiveFrom", "effective_from"), "Effective from") ?? base.effective_from ?? (await today(client)),
    effective_until: dateOrNull(pick("effectiveUntil", "effective_until"), "Effective until"),
    revision_reason: textOrNull(pick("revisionReason", "revision_reason"), 1000),
  };
}
async function ruleRow(client, c, input) {
  const scope = oneOf(input.scope ?? input.scopeKind ?? (input.itemId ? "ITEM" : input.itemGroupId ? "CATEGORY" : "COMPANY_DEFAULT"), SCOPES, "QUALITY_QCP_APPLICABILITY_INVALID", "Applies to");
  const itemId = scope === "ITEM" ? uuidOrNull(input.itemId, "Item") : null;
  const groupId = scope === "CATEGORY" ? uuidOrNull(input.itemGroupId, "Category") : null;
  if ((scope === "ITEM" && !itemId) || (scope === "CATEGORY" && !groupId)) throw qcpError(400, "QUALITY_QCP_APPLICABILITY_INVALID");
  const supplierId = uuidOrNull(input.supplierId, "Supplier");
  const warehouseId = uuidOrNull(input.warehouseId, "Site");
  const exists = async (table, id) => !id || Boolean((await client.query(`SELECT 1 FROM tenant.${table} WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0]);
  if (!(await exists("items", itemId)) || !(await exists("item_groups", groupId)) || !(await exists("procurement_suppliers", supplierId)) || !(await exists("warehouses", warehouseId)))
    throw qcpError(400, "QUALITY_QCP_COMPANY_MISMATCH", "The selected product, category, supplier or site belongs to another Company or does not exist.");
  return { scope_kind: scope, item_id: itemId, item_group_id: groupId, supplier_id: supplierId, warehouse_id: warehouseId, specificity: tierOf(scope, supplierId, warehouseId) };
}
async function insertRules(client, c, versionId, list) {
  for (const raw of list) {
    const r = await ruleRow(client, c, raw);
    await client.query(`INSERT INTO tenant.quality_control_point_rules (organization_id, version_id, scope_kind, item_id, item_group_id, supplier_id, warehouse_id, specificity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [c.organizationId, versionId, r.scope_kind, r.item_id, r.item_group_id, r.supplier_id, r.warehouse_id, r.specificity]).catch(dbError);
  }
}
async function insertVersion(client, c, pointId, number, f, key = null) {
  return (await client.query(`INSERT INTO tenant.quality_control_point_versions (organization_id, control_point_id, version_number, ${FIELDS.join(", ")}, idempotency_key, created_by)
    VALUES ($1, $2, $3, ${FIELDS.map((_, i) => `$${i + 4}`).join(", ")}, $${FIELDS.length + 4}, $${FIELDS.length + 5}) RETURNING id`,
  [c.organizationId, pointId, number, ...FIELDS.map((k) => f[k] ?? null), key, c.userId ?? null])).rows[0].id;
}

// ------------------------------------------------------------------ create, edit
export async function createQualityControlPoint(client, c, input = {}) {
  need(c, QCP.create);
  const key = textOrNull(input.idempotencyKey, 120);
  if (key) {
    const prior = (await client.query(`SELECT id, qcp_code, current_version_id FROM tenant.quality_control_points WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { controlPointId: prior.id, code: prior.qcp_code, versionId: prior.current_version_id, replayed: true };
  }
  const name = text(input.name, 200);
  if (!name) throw qcpError(400, "QUALITY_QCP_INVALID", "Enter a name.");
  const f = await fieldsOf(client, c, input);
  const code = await nextDocumentNumber(client, c, { documentType: "quality_control_point" });
  const point = (await client.query(`INSERT INTO tenant.quality_control_points (organization_id, qcp_code, name, description, copied_from_id, idempotency_key, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [c.organizationId, code, name, text(input.description, 2000), uuidOrNull(input.copiedFromId, "Source"), key, c.userId ?? null])).rows[0];
  const versionId = await insertVersion(client, c, point.id, 1, f);
  await client.query(`UPDATE tenant.quality_control_points SET current_version_id = $2 WHERE id = $1`, [point.id, versionId]);
  if (Array.isArray(input.rules)) await insertRules(client, c, versionId, input.rules);
  await recordQcpEvent(client, c, { pointId: point.id, versionId, action: input.copiedFromId ? "COPIED" : "CREATED", to: "DRAFT", details: { code } });
  return { controlPointId: point.id, versionId, code, href: `/quality/control-points/${point.id}` };
}
export async function updateQualityControlPointDraft(client, c, pointId, versionId, input = {}) {
  need(c, QCP.editDraft);
  const point = await loadPoint(client, c, pointId, { lock: true });
  const v = await loadQcpVersion(client, c, point.id, versionId, { lock: true });
  editable(v);
  expectVersion(v, input);
  if (point.status === "RETIRED") throw qcpError(409, "QUALITY_QCP_STATE", "This control point is retired.");
  if (input.name !== undefined || input.description !== undefined) {
    const name = input.name === undefined ? point.name : text(input.name, 200);
    if (!name) throw qcpError(400, "QUALITY_QCP_INVALID", "Enter a name.");
    await client.query(`UPDATE tenant.quality_control_points SET name = $2, description = $3, updated_at = clock_timestamp() WHERE id = $1`,
      [point.id, name, input.description === undefined ? point.description : text(input.description, 2000)]);
  }
  const f = await fieldsOf(client, c, input, v);
  if (f.effective_until && f.effective_until < f.effective_from) throw qcpError(400, "QUALITY_QCP_INVALID", "The end date is before the start date.");
  await client.query(`UPDATE tenant.quality_control_point_versions SET ${FIELDS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`,
    [v.id, ...FIELDS.map((k) => f[k] ?? null)]).catch(dbError);
  if (Array.isArray(input.rules)) {
    await client.query(`DELETE FROM tenant.quality_control_point_rules WHERE organization_id = $1 AND version_id = $2`, [c.organizationId, v.id]).catch(dbError);
    await insertRules(client, c, v.id, input.rules);
  }
  await recordQcpEvent(client, c, { pointId: point.id, versionId: v.id, action: "DRAFT_UPDATED" });
  return { controlPointId: point.id, versionId: v.id };
}

// ------------------------------------------------------------------ validation, review, approval, publication
async function issuesOf(client, c, point, v) {
  const rules = await rulesOfVersion(client, c, v.id);
  const spec = v.specification_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_specifications WHERE organization_id = $1 AND id = $2`, [c.organizationId, v.specification_id])).rows[0] : null;
  const lockedVersion = v.spec_version_id ? (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND id = $2`, [c.organizationId, v.spec_version_id])).rows[0] : null;
  const issues = validateQcpVersion(point, v, rules, { spec, lockedVersion });
  if (v.version_number > 1 && !v.revision_reason) issues.push({ code: "QUALITY_QCP_REASON_REQUIRED", message: "Give the reason for this revision." });
  return { rules, issues };
}
export async function validateQualityControlPoint(client, c, pointId, versionId) {
  need(c, QCP.view);
  const point = await loadPoint(client, c, pointId);
  const v = await loadQcpVersion(client, c, point.id, versionId);
  const { issues } = await issuesOf(client, c, point, v);
  return { valid: issues.length === 0, issues, conflicts: await duplicateRules(client, c, point.id, v) };
}
export async function submitQualityControlPoint(client, c, pointId, versionId, input = {}) {
  need(c, QCP.submit);
  const point = await loadPoint(client, c, pointId, { lock: true });
  const v = await loadQcpVersion(client, c, point.id, versionId, { lock: true });
  if (v.status === "PENDING_APPROVAL" && v.submitted_by === c.userId) return { versionId: v.id, status: v.status, replayed: true };
  editable(v);
  expectVersion(v, input);
  const { issues } = await issuesOf(client, c, point, v);
  if (issues.length) throw qcpError(400, issues[0].code, issues[0].message, { issues });
  await client.query(`UPDATE tenant.quality_control_point_versions SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_at = clock_timestamp(), review_note = NULL, row_version = row_version + 1
    WHERE id = $1`, [v.id, c.userId ?? null]);
  await recordQcpEvent(client, c, { pointId: point.id, versionId: v.id, action: "SUBMITTED", from: v.status, to: "PENDING_APPROVAL", note: textOrNull(input.note, 1000) });
  return { versionId: v.id, status: "PENDING_APPROVAL" };
}
async function review(client, c, pointId, versionId, input, to) {
  need(c, QCP.review);
  const note = text(input.note, 1000);
  if (!note) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED");
  const point = await loadPoint(client, c, pointId, { lock: true });
  const v = await loadQcpVersion(client, c, point.id, versionId, { lock: true });
  if (v.status !== "PENDING_APPROVAL") throw qcpError(409, "QUALITY_QCP_STATE", "Only a version waiting for approval can be returned or rejected.");
  await client.query(`UPDATE tenant.quality_control_point_versions SET status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(), review_note = $4, row_version = row_version + 1 WHERE id = $1`,
    [v.id, to, c.userId ?? null, note]);
  await recordQcpEvent(client, c, { pointId: point.id, versionId: v.id, action: to, from: "PENDING_APPROVAL", to, note });
  return { versionId: v.id, status: to };
}
export const requestQualityControlPointChanges = (client, c, pointId, versionId, input = {}) => review(client, c, pointId, versionId, input, "CHANGES_REQUESTED");
export const rejectQualityControlPointVersion = (client, c, pointId, versionId, input = {}) => review(client, c, pointId, versionId, input, "REJECTED");
export async function approveQualityControlPointVersion(client, c, pointId, versionId, input = {}) {
  need(c, QCP.approve);
  const point = await loadPoint(client, c, pointId, { lock: true });
  const v = await loadQcpVersion(client, c, point.id, versionId, { lock: true });
  if (["APPROVED", "ACTIVE"].includes(v.status) && v.approved_by === c.userId) return { versionId: v.id, status: v.status, replayed: true };
  if (v.status !== "PENDING_APPROVAL") throw qcpError(409, EDITABLE.includes(v.status) ? "QUALITY_QCP_APPROVAL_REQUIRED" : "QUALITY_QCP_STATE");
  const policy = await policyOf(client, c);
  if (policy.prohibitSelfApproval && c.userId && [v.created_by, v.submitted_by].includes(c.userId)) throw qcpError(403, "QUALITY_QCP_SELF_APPROVAL");
  const note = textOrNull(input.note, 1000);
  if (policy.approvalNoteRequired && !note) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Add an approval note.");
  const { rules, issues } = await issuesOf(client, c, point, v);
  if (issues.length) throw qcpError(400, issues[0].code, issues[0].message, { issues });
  const hash = qcpContentHash(v, rules);
  await client.query(`UPDATE tenant.quality_control_point_versions SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), approval_note = $3, content_hash = $4, row_version = row_version + 1
    WHERE id = $1`, [v.id, c.userId ?? null, note, hash]);
  await recordQcpEvent(client, c, { pointId: point.id, versionId: v.id, action: "APPROVED", from: "PENDING_APPROVAL", to: "APPROVED", note, details: { contentHash: hash } });
  if (input.publish && has(c, QCP.activate)) return { ...(await activateQualityControlPointVersion(client, c, point.id, v.id)), contentHash: hash };
  return { versionId: v.id, status: "APPROVED", contentHash: hash };
}
// Another active overriding control point with exactly the same trigger, purpose and scope (the same source would always match both).
async function duplicateRules(client, c, pointId, v) {
  if (v.match_mode !== "OVERRIDE_DEFAULT") return [];
  return (await client.query(`SELECT DISTINCT p.qcp_code, p.id FROM tenant.quality_control_point_rules mine
      JOIN tenant.quality_control_point_rules other ON other.organization_id = mine.organization_id AND other.scope_kind = mine.scope_kind AND other.item_id IS NOT DISTINCT FROM mine.item_id
        AND other.item_group_id IS NOT DISTINCT FROM mine.item_group_id AND other.supplier_id IS NOT DISTINCT FROM mine.supplier_id AND other.warehouse_id IS NOT DISTINCT FROM mine.warehouse_id
      JOIN tenant.quality_control_point_versions ov ON ov.id = other.version_id AND ov.status IN ('ACTIVE', 'APPROVED') AND ov.published_at IS NOT NULL AND ov.trigger_event = $3
        AND ov.purpose_code = $4 AND ov.match_mode = 'OVERRIDE_DEFAULT' AND ov.control_point_id <> $2
        AND ov.effective_from <= COALESCE($6::date, 'infinity'::date) AND COALESCE(ov.effective_until, 'infinity'::date) >= $5::date
      JOIN tenant.quality_control_points p ON p.id = ov.control_point_id AND p.status = 'ACTIVE'
     WHERE mine.organization_id = $1 AND mine.version_id = $7`, [c.organizationId, pointId, v.trigger_event, v.purpose_code, v.effective_from, v.effective_until, v.id])).rows
    .map((r) => ({ conflictsWith: r.qcp_code, controlPointId: r.id }));
}
export async function activateQualityControlPointVersion(client, c, pointId, versionId, input = {}) {
  need(c, QCP.activate);
  const point = await loadPoint(client, c, pointId, { lock: true });
  const v = await loadQcpVersion(client, c, point.id, versionId, { lock: true });
  if (v.published_at) return { versionId: v.id, status: v.status, effectiveFrom: v.effective_from, replayed: true };
  if (v.status !== "APPROVED") throw qcpError(409, "QUALITY_QCP_APPROVAL_REQUIRED");
  if (point.status === "RETIRED") throw qcpError(409, "QUALITY_QCP_STATE", "This control point is retired.");
  expectVersion(v, input);
  if (!TRIGGERS[v.trigger_event]?.enabled) throw qcpError(409, "QUALITY_QCP_TRIGGER_UNAVAILABLE");
  const duplicates = await duplicateRules(client, c, point.id, v);
  if (duplicates.length) throw qcpError(409, "QUALITY_QCP_RULE_CONFLICT", `${duplicates.map((d) => d.conflictsWith).join(", ")} already applies to exactly the same products, suppliers and sites for this purpose.`, { conflicts: duplicates });
  await client.query(`UPDATE tenant.quality_control_point_versions SET published_by = $2, published_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.id, c.userId ?? null]);
  await recordQcpEvent(client, c, { pointId: point.id, versionId: v.id, action: "PUBLISHED", details: { effectiveFrom: v.effective_from } });
  await activateDueQcps(client, c, { pointId: point.id });
  const now = (await qx(client, `SELECT status, effective_from FROM tenant.quality_control_point_versions WHERE id = $1`, [v.id])).rows[0];
  return { versionId: v.id, status: now.status, effectiveFrom: now.effective_from, scheduled: now.status === "APPROVED" };
}

// ------------------------------------------------------------------ revision, copy, retirement
export async function createQualityControlPointRevision(client, c, pointId, input = {}) {
  need(c, QCP.revise);
  const key = textOrNull(input.idempotencyKey, 120);
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_control_point_versions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { controlPointId: pointId, versionId: prior.id, replayed: true };
  }
  const reason = text(input.reason, 1000);
  if (!reason) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Say why the control point is revised.");
  const point = await loadPoint(client, c, pointId, { lock: true });
  if (point.status === "RETIRED") throw qcpError(409, "QUALITY_QCP_STATE", "This control point is retired.");
  const versions = (await qx(client, `SELECT * FROM tenant.quality_control_point_versions WHERE control_point_id = $1 ORDER BY version_number DESC`, [point.id])).rows;
  if (versions.some((x) => ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(x.status))) throw qcpError(409, "QUALITY_QCP_STATE", "A revision of this control point is already in progress.");
  const base = versions.find((x) => ["ACTIVE", "APPROVED"].includes(x.status)) ?? versions[0];
  const day = await today(client);
  const f = { ...Object.fromEntries(FIELDS.map((k) => [k, base[k]])), effective_from: dateOrNull(input.effectiveFrom, "Effective from") ?? (base.effective_from > day ? base.effective_from : day),
    effective_until: null, revision_reason: reason };
  const id = await insertVersion(client, c, point.id, versions[0].version_number + 1, f, key);
  await client.query(`UPDATE tenant.quality_control_point_versions SET supersedes_version_id = $2 WHERE id = $1`, [id, base.id]);
  await client.query(`INSERT INTO tenant.quality_control_point_rules (organization_id, version_id, scope_kind, item_id, item_group_id, supplier_id, warehouse_id, specificity)
    SELECT organization_id, $2, scope_kind, item_id, item_group_id, supplier_id, warehouse_id, specificity FROM tenant.quality_control_point_rules WHERE version_id = $1`, [base.id, id]);
  await recordQcpEvent(client, c, { pointId: point.id, versionId: id, action: "REVISION_CREATED", to: "DRAFT", note: reason, details: { from: base.version_number } });
  return { controlPointId: point.id, versionId: id, versionNumber: versions[0].version_number + 1 };
}
export async function copyQualityControlPoint(client, c, pointId, input = {}) {
  need(c, QCP.copy);
  need(c, QCP.create);
  const source = await loadPoint(client, c, pointId);
  const versions = (await qx(client, `SELECT * FROM tenant.quality_control_point_versions WHERE control_point_id = $1 ORDER BY version_number DESC`, [source.id])).rows;
  const base = versions.find((x) => ["ACTIVE", "APPROVED"].includes(x.status)) ?? versions[0];
  const rules = await rulesOfVersion(client, c, base.id);
  return createQualityControlPoint(client, c, {
    name: input.name ?? `${source.name} (copy)`, description: source.description, copiedFromId: source.id, idempotencyKey: input.idempotencyKey,
    triggerEvent: base.trigger_event, stage: base.inspection_stage, requirementType: base.requirement_type, gateType: has(c, QCP.manageGate) ? base.gate_type : "NONE", specBinding: base.spec_binding,
    specificationId: base.specification_id, specVersionId: base.spec_version_id, matchMode: base.match_mode, purposeCode: base.purpose_code, quantityScope: base.quantity_scope,
    lotContext: base.lot_context, waiverAllowed: base.waiver_allowed,
    rules: input.rules ?? rules.map((r) => ({ scope: r.scope_kind, itemId: r.item_id, itemGroupId: r.item_group_id, supplierId: r.supplier_id, warehouseId: r.warehouse_id })),
  });
}
export async function retireQualityControlPoint(client, c, pointId, input = {}) {
  need(c, QCP.retire);
  const reason = text(input.reason, 1000);
  if (!reason) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Say why the control point is retired.");
  const point = await loadPoint(client, c, pointId, { lock: true });
  if (point.status === "RETIRED") return { controlPointId: point.id, status: "RETIRED", replayed: true };
  for (const v of (await qx(client, `SELECT id, status FROM tenant.quality_control_point_versions WHERE control_point_id = $1`, [point.id])).rows) {
    const to = ["ACTIVE", "APPROVED"].includes(v.status) ? "RETIRED" : EDITABLE.includes(v.status) || v.status === "PENDING_APPROVAL" ? "REJECTED" : null;
    if (to) await client.query(`UPDATE tenant.quality_control_point_versions SET status = $2, retired_at = CASE WHEN $2 = 'RETIRED' THEN clock_timestamp() END,
      review_note = CASE WHEN $2 = 'REJECTED' THEN 'The control point was retired' ELSE review_note END, row_version = row_version + 1 WHERE id = $1`, [v.id, to]);
  }
  await client.query(`UPDATE tenant.quality_control_points SET status = 'RETIRED', retired_at = clock_timestamp(), retired_by = $2, retire_reason = $3, row_version = row_version + 1, updated_at = clock_timestamp()
    WHERE id = $1`, [point.id, c.userId ?? null, reason]);
  // Existing obligations and the stock held under them are resolved through their own workflows: retiring releases nothing.
  await recordQcpEvent(client, c, { pointId: point.id, action: "RETIRED", from: "ACTIVE", to: "RETIRED", note: reason });
  return { controlPointId: point.id, status: "RETIRED" };
}

// ------------------------------------------------------------------ waivers (approved deviations)
async function criticalFailure(client, c, inspectionId) {
  if (!inspectionId) return false;
  return Boolean((await client.query(`SELECT 1 FROM tenant.quality_inspection_results r JOIN tenant.quality_inspection_points p ON p.id = r.inspection_point_id
    WHERE r.organization_id = $1 AND r.inspection_id = $2 AND r.result_status = 'fail' AND p.critical LIMIT 1`, [c.organizationId, inspectionId])).rows[0]);
}
export async function requestQualityWaiver(client, c, obligationId, input = {}) {
  need(c, QCP.requestWaiver);
  const key = textOrNull(input.idempotencyKey, 120);
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_qcp_waivers WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { waiverId: prior.id, replayed: true };
  }
  const ob = await loadObligation(client, c, obligationId, { lock: true });
  if (!["PENDING", "FAILED", "EXCEPTION"].includes(ob.status)) throw qcpError(409, "QUALITY_QCP_STATE", "Only an open or failed requirement can be waived.");
  const version = (await qx(client, `SELECT waiver_allowed FROM tenant.quality_control_point_versions WHERE id = $1`, [ob.qcp_version_id])).rows[0];
  if (!version.waiver_allowed) throw qcpError(403, "QUALITY_QCP_WAIVER_NOT_AUTHORIZED", "This control point does not allow waivers.");
  if (await criticalFailure(client, c, ob.inspection_id)) throw qcpError(403, "QUALITY_QCP_WAIVER_NOT_AUTHORIZED", "A failed critical check cannot be waived; the goods follow the rejection or disposition workflow.");
  const reason = text(input.reason, 1000);
  const risk = text(input.riskJustification ?? input.risk, 1000);
  if (!reason || !risk) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED", "Give the reason and the risk justification.");
  const disposition = input.requestedDisposition === "CONDITIONAL_USE" ? "CONDITIONAL_USE" : "RELEASE";
  const quantity = Number(input.quantity ?? ob.controlled_quantity);
  if (!(quantity > 0) || quantity > Number(ob.controlled_quantity) + 1e-9) throw qcpError(400, "QUALITY_QCP_INVALID", `The waiver covers up to ${Number(ob.controlled_quantity)}.`);
  const id = (await client.query(`INSERT INTO tenant.quality_qcp_waivers (organization_id, obligation_id, requested_disposition, quantity, reason, risk_justification, conditions, evidence_reference,
      requested_by, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
  [c.organizationId, ob.id, disposition, String(quantity), reason, risk, textOrNull(input.conditions, 1000), textOrNull(input.evidenceReference, 500), c.userId ?? null, key])
    .catch((error) => { if (error.code === "23505") throw qcpError(409, "QUALITY_QCP_STATE", "A waiver request for this requirement is already waiting for a decision."); throw error; })).rows[0].id;
  await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: "WAIVER_REQUESTED", note: reason, details: { waiverId: id, quantity, disposition } });
  return { waiverId: id, status: "REQUESTED" };
}
export async function decideQualityWaiver(client, c, waiverId, input = {}) {
  need(c, QCP.approveWaiver);
  const w = (await qx(client, `SELECT * FROM tenant.quality_qcp_waivers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(waiverId, "Waiver")])).rows[0];
  if (!w) throw qcpError(404, "QUALITY_QCP_NOT_FOUND", "That waiver was not found.");
  const approve = input.decision === "APPROVE";
  if (w.status !== "REQUESTED") {
    if ((w.status === "APPROVED") === approve && w.decided_by === c.userId) return { waiverId: w.id, status: w.status, replayed: true };
    throw qcpError(409, "QUALITY_QCP_STATE", "This waiver was already decided.");
  }
  if (w.requested_by && w.requested_by === c.userId) throw qcpError(403, "QUALITY_QCP_WAIVER_NOT_AUTHORIZED", "Someone other than the requester must decide a waiver.");
  const note = text(input.note, 1000);
  if (!note) throw qcpError(400, "QUALITY_QCP_REASON_REQUIRED");
  const ob = await loadObligation(client, c, w.obligation_id, { lock: true });
  if (approve && (await criticalFailure(client, c, ob.inspection_id))) throw qcpError(403, "QUALITY_QCP_WAIVER_NOT_AUTHORIZED", "A failed critical check cannot be waived.");
  await client.query(`UPDATE tenant.quality_qcp_waivers SET status = $2, decided_by = $3, decided_at = clock_timestamp(), decision_note = $4 WHERE id = $1`,
    [w.id, approve ? "APPROVED" : "REJECTED", c.userId ?? null, note]);
  if (approve) {
    const allowance = Math.min(Number(ob.controlled_quantity), Number(w.quantity) + (ob.status === "FAILED" ? Number(ob.allowance_quantity) : 0));
    await client.query(`UPDATE tenant.quality_inspection_obligations SET status = 'WAIVED', allowance_quantity = $2, outcome_label = $3, resolved_by = $4, resolved_at = clock_timestamp(),
      updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
    [ob.id, String(allowance), w.requested_disposition === "CONDITIONAL_USE" ? "Released for conditional use under approved deviation" : "Released under approved deviation", c.userId ?? null]);
    await client.query(`UPDATE tenant.quality_spec_exceptions SET status = 'RESOLVED', resolved_by = $2, resolved_at = clock_timestamp(), resolution_note = 'Waived under an approved deviation'
      WHERE obligation_id = $1 AND status = 'OPEN'`, [ob.id, c.userId ?? null]);
  }
  await recordQcpEvent(client, c, { pointId: ob.control_point_id, versionId: ob.qcp_version_id, obligationId: ob.id, action: approve ? "WAIVER_APPROVED" : "WAIVER_REJECTED", from: ob.status,
    to: approve ? "WAIVED" : ob.status, note, details: { waiverId: w.id } });
  return { waiverId: w.id, status: approve ? "APPROVED" : "REJECTED", obligationStatus: approve ? "WAIVED" : ob.status };
}
