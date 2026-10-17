// Quality — Inspection Specifications: every change. A specification starts as a draft version; its checks, sampling and decision rule are
// edited only while it is a draft (or returned for changes); it is validated, submitted, reviewed and approved by someone other than its
// preparer (when the Company's policy says so), then published — effective from its date. Changing approved criteria means a new version;
// the earlier version stays, with its approvals, for every inspection that used it. Applicability rules decide which items, categories,
// suppliers and sites a specification serves, and two equally specific rules for the same stage are refused.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { qx } from "../common.js";
import { companyRow, loadChecks, loadSpec, loadVersion, recordSpecEvent, settingsOf, today, unitsOf } from "./qs-data.js";
import { activateDueVersions, ensureMirrorPlan } from "./qs-resolver.js";
import {
  CHECK_TYPES, CRITICALITY, DECISIONS, EDITABLE, METHOD_OF, QS, ROUNDING, SAMPLING, SCOPES, STAGES, bool, contentHash, dateOrNull, dec, expectVersion, has, intOrNull, isDecimal,
  need, oneOf, specError, text, textOrNull, tierOf, uuid, uuidOrNull, validateVersion,
} from "./qs-rules.js";

export const SPEC_FILE_ENTITY = "quality.specification";
const editable = (version) => {
  if (!EDITABLE.includes(version.status)) throw specError(409, "QUALITY_SPEC_VERSION_IMMUTABLE");
};
const bump = (client, table, id) => client.query(`UPDATE tenant.${table} SET row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`, [id]);
const dbError = (error) => {
  if (String(error?.message ?? "").startsWith("QUALITY_SPEC_VERSION_IMMUTABLE")) throw specError(409, "QUALITY_SPEC_VERSION_IMMUTABLE");
  throw error;
};

// ------------------------------------------------------------------ input normalisation of one check
async function checkRow(client, c, input, units, fallbackCode) {
  const type = oneOf(input.checkType ?? input.type ?? "VISUAL", CHECK_TYPES, "QUALITY_SPEC_INVALID", "Check type");
  const name = text(input.name, 200);
  if (!name) throw specError(400, "QUALITY_SPEC_NAME_REQUIRED", "Enter what to check.");
  const code = text(input.code ?? input.characteristicCode, 30).toUpperCase() || fallbackCode;
  if (code !== null && !/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) throw specError(400, "QUALITY_SPEC_INVALID", `${code} is not a valid check code (letters, digits, - or _).`);
  const numeric = type === "NUMERIC_RANGE" || type === "NUMERIC_TARGET_TOLERANCE";
  const num = (v, label) => {
    if (v === undefined || v === null || v === "") return null;
    if (!isDecimal(v)) throw specError(400, "QUALITY_SPEC_LIMITS_INVALID", `${name}: ${label} must be a number.`);
    dec(String(v));
    return String(v).trim();
  };
  let uomId = null;
  let unitCode = null;
  if (numeric) {
    if (input.uomId) {
      const u = units.get(String(input.uomId));
      if (!u) throw specError(400, "QUALITY_SPEC_UOM_INVALID");
      uomId = u.id;
      unitCode = u.code;
    } else if (input.unitCode || input.unit) {
      const wanted = text(input.unitCode ?? input.unit, 12).toUpperCase();
      const u = [...units.values()].find((x) => String(x.code).toUpperCase() === wanted);
      if (!u) throw specError(400, "QUALITY_SPEC_UOM_INVALID", `${wanted} is not one of the Company's units.`);
      uomId = u.id;
      unitCode = u.code;
    }
  }
  const row = {
    characteristic_code: code, name, check_type: type, instructions: text(input.instructions, 2000), acceptance_text: textOrNull(input.acceptanceText ?? input.acceptable, 500),
    evidence_note: textOrNull(input.evidenceNote, 500), uom_id: uomId, unit_code: unitCode,
    target_value: type === "NUMERIC_TARGET_TOLERANCE" ? num(input.targetValue ?? input.target, "the target") : null,
    lower_tolerance: type === "NUMERIC_TARGET_TOLERANCE" ? num(input.lowerTolerance, "the lower tolerance") : null,
    upper_tolerance: type === "NUMERIC_TARGET_TOLERANCE" ? num(input.upperTolerance, "the upper tolerance") : null,
    lower_limit: type === "NUMERIC_RANGE" ? num(input.lowerLimit ?? input.min, "the minimum") : null,
    upper_limit: type === "NUMERIC_RANGE" ? num(input.upperLimit ?? input.max, "the maximum") : null,
    lower_inclusive: bool(input.lowerInclusive, true), upper_inclusive: bool(input.upperInclusive, true),
    decimal_places: input.decimalPlaces === undefined || input.decimalPlaces === "" ? 2 : Number(input.decimalPlaces),
    measurement_rounding: input.measurementRounding === "HALF_UP" ? "HALF_UP" : "NONE",
    expected_boolean: type === "BOOLEAN" ? (input.expectedBoolean === undefined || input.expectedBoolean === null || input.expectedBoolean === "" ? true : bool(input.expectedBoolean)) : null,
    allowed_values: type === "ENUM" ? (Array.isArray(input.allowedValues) ? input.allowedValues : []).map((a) => (typeof a === "string"
      ? { value: text(a.replace(/\*$/, ""), 120), label: text(a.replace(/\*$/, ""), 120), acceptable: a.endsWith("*") }
      : { value: text(a.value ?? a.label, 120), label: text(a.label ?? a.value, 120), acceptable: Boolean(a.acceptable) })).filter((a) => a.value) : [],
    judgement: type === "TEXT_OBSERVATION" ? (input.judgement === "INSPECTOR_JUDGEMENT" ? "INSPECTOR_JUDGEMENT" : "INFORMATIONAL") : null,
    criticality: oneOf(input.criticality ?? (type === "TEXT_OBSERVATION" && input.judgement !== "INSPECTOR_JUDGEMENT" ? "INFORMATIONAL" : "MAJOR"), CRITICALITY, "QUALITY_SPEC_INVALID", "Criticality"),
    is_required: bool(input.required ?? input.isRequired, true), allow_na: bool(input.allowNa, false), evidence_required: bool(input.evidenceRequired, false),
    instrument_note: textOrNull(input.instrumentNote ?? input.instrument, 500),
  };
  if (!Number.isInteger(row.decimal_places) || row.decimal_places < 0 || row.decimal_places > 10) throw specError(400, "QUALITY_SPEC_LIMITS_INVALID", `${name}: precision is 0 to 10 decimal places.`);
  if (row.lower_limit !== null && row.upper_limit !== null && dec(row.lower_limit) > dec(row.upper_limit)) throw specError(400, "QUALITY_SPEC_LIMITS_INVALID", `${name}: the minimum must not exceed the maximum.`);
  return row;
}
const CHECK_COLUMNS = ["characteristic_code", "name", "check_type", "instructions", "acceptance_text", "evidence_note", "uom_id", "unit_code", "target_value", "lower_tolerance", "upper_tolerance",
  "lower_limit", "upper_limit", "lower_inclusive", "upper_inclusive", "decimal_places", "measurement_rounding", "expected_boolean", "allowed_values", "judgement", "criticality", "is_required",
  "allow_na", "evidence_required", "instrument_note"];
async function insertCheck(client, c, versionId, sequence, row) {
  const values = CHECK_COLUMNS.map((k) => (k === "allowed_values" ? JSON.stringify(row[k] ?? []) : row[k] ?? null));
  try {
    return (await client.query(`INSERT INTO tenant.quality_inspection_characteristics (organization_id, version_id, sequence, ${CHECK_COLUMNS.join(", ")})
      VALUES ($1, $2, $3, ${CHECK_COLUMNS.map((_, i) => `$${i + 4}${CHECK_COLUMNS[i] === "allowed_values" ? "::jsonb" : ""}`).join(", ")}) RETURNING id`,
      [c.organizationId, versionId, sequence, ...values])).rows[0].id;
  } catch (error) {
    if (error.code === "23505") throw specError(409, "QUALITY_SPEC_INVALID", `Check code ${row.characteristic_code} is already used in this version.`);
    return dbError(error);
  }
}
const nextCode = (used) => {
  for (let i = 1; i < 1000; i += 1) {
    const code = `C${String(i).padStart(2, "0")}`;
    if (!used.has(code)) { used.add(code); return code; }
  }
  throw specError(400, "QUALITY_SPEC_INVALID", "Too many checks.");
};

// ------------------------------------------------------------------ version content
function samplingFields(input, base = {}) {
  const pick = (k, alt) => (input[k] !== undefined ? input[k] : base[alt]);
  const method = oneOf(pick("samplingMethod", "sampling_method") ?? "ALL_UNITS", SAMPLING, "QUALITY_SPEC_SAMPLING_INVALID", "Sampling method");
  const value = pick("sampleValue", "sample_value");
  if (value !== null && value !== undefined && value !== "" && !isDecimal(value)) throw specError(400, "QUALITY_SPEC_SAMPLING_INVALID");
  const int = (v) => {
    const n = intOrNull(v);
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw specError(400, "QUALITY_SPEC_SAMPLING_INVALID", "Sample counts are whole numbers.");
    return n;
  };
  return {
    sampling_method: method, inspection_method: METHOD_OF[method],
    sample_value: ["FIXED_COUNT", "PERCENTAGE"].includes(method) && value !== "" && value !== null && value !== undefined ? String(value) : null,
    sample_minimum: int(pick("sampleMinimum", "sample_minimum")), sample_maximum: int(pick("sampleMaximum", "sample_maximum")),
    rounding_rule: oneOf(pick("roundingRule", "rounding_rule") ?? "UP", ROUNDING, "QUALITY_SPEC_SAMPLING_INVALID", "Rounding"),
    sampling_basis: ["RECEIVED_QUANTITY", "LOT", "SOURCE_LINE"].includes(pick("samplingBasis", "sampling_basis")) ? pick("samplingBasis", "sampling_basis") : "RECEIVED_QUANTITY",
    sampling_instructions: textOrNull(pick("samplingInstructions", "sampling_instructions"), 2000),
    decision_rule: oneOf(pick("decisionRule", "decision_rule") ?? "ALL_REQUIRED_PASS", DECISIONS, "QUALITY_SPEC_ACCEPTANCE_INVALID", "Decision rule"),
    allowed_major_defects: int(pick("allowedMajorDefects", "allowed_major_defects")), allowed_minor_defects: int(pick("allowedMinorDefects", "allowed_minor_defects")),
    lot_context: ["NONE", "PER_LOT", "PER_SERIAL"].includes(pick("lotContext", "lot_context")) ? pick("lotContext", "lot_context") : "NONE",
  };
}
const VERSION_COLUMNS = ["inspection_method", "sampling_method", "sampling_basis", "sample_value", "sample_minimum", "sample_maximum", "rounding_rule", "sampling_instructions", "decision_rule",
  "allowed_major_defects", "allowed_minor_defects", "lot_context"];
async function insertVersion(client, c, spec, number, fields, extra = {}) {
  const cols = [...VERSION_COLUMNS, "effective_from", "effective_until", "revision_reason", "supersedes_version_id", "idempotency_key"];
  const values = [...VERSION_COLUMNS.map((k) => fields[k] ?? null), extra.effectiveFrom, extra.effectiveUntil ?? null, extra.reason ?? null, extra.supersedes ?? null, extra.idempotencyKey ?? null];
  return (await client.query(`INSERT INTO tenant.quality_inspection_spec_versions (organization_id, specification_id, version_number, inspection_stage, created_by, ${cols.join(", ")})
    VALUES ($1, $2, $3, $4, $5, ${cols.map((_, i) => `$${i + 6}`).join(", ")}) RETURNING id`, [c.organizationId, spec.id, number, spec.inspection_stage, c.userId ?? null, ...values])).rows[0].id;
}
async function copyChecks(client, c, fromVersionId, toVersionId) {
  await client.query(`INSERT INTO tenant.quality_inspection_characteristics (organization_id, version_id, sequence, ${CHECK_COLUMNS.join(", ")})
    SELECT organization_id, $3, sequence, ${CHECK_COLUMNS.join(", ")} FROM tenant.quality_inspection_characteristics WHERE organization_id = $1 AND version_id = $2`,
  [c.organizationId, fromVersionId, toVersionId]);
}

async function scopeRefs(client, c, input) {
  const itemId = uuidOrNull(input.itemId, "Item");
  const groupId = itemId ? null : uuidOrNull(input.itemGroupId ?? input.categoryId, "Category");
  if (itemId && !(await companyRow(client, c, "items", itemId))) throw specError(400, "QUALITY_SPEC_PRODUCT_INVALID");
  if (groupId && !(await companyRow(client, c, "item_groups", groupId))) throw specError(400, "QUALITY_SPEC_PRODUCT_INVALID");
  return { itemId, groupId };
}
async function addScopeRule(client, c, spec, { itemId, groupId }, effectiveFrom) {
  if (spec.is_template || (!itemId && !groupId)) return;
  const scope = itemId ? "ITEM" : "CATEGORY";
  const clash = await sameKeyRule(client, c, { stage: spec.inspection_stage, scope, itemId, groupId, supplierId: null, warehouseId: null, from: effectiveFrom, until: null, specId: spec.id });
  if (clash) return; // the identical scope already belongs to another specification: Quality decides through the applicability rules
  await client.query(`INSERT INTO tenant.quality_spec_applicability_rules (organization_id, specification_id, inspection_stage, scope_kind, item_id, item_group_id, effective_from, specificity, reason, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Created with the specification', $9)`,
  [c.organizationId, spec.id, spec.inspection_stage, scope, itemId, groupId, effectiveFrom, tierOf(scope, null, null), c.userId ?? null]);
}

// ------------------------------------------------------------------ create, edit, checks
export async function createInspectionSpecification(client, c, input = {}) {
  need(c, QS.create);
  const key = textOrNull(input.idempotencyKey, 120);
  if (key) {
    const prior = (await client.query(`SELECT id, specification_code, current_version_id FROM tenant.quality_inspection_specifications WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { specificationId: prior.id, code: prior.specification_code, versionId: prior.current_version_id, replayed: true };
  }
  const name = text(input.name, 200);
  if (!name) throw specError(400, "QUALITY_SPEC_NAME_REQUIRED");
  const stage = oneOf(input.stage ?? input.inspectionStage, STAGES, "QUALITY_SPEC_STAGE_INVALID");
  const refs = await scopeRefs(client, c, input);
  const fields = samplingFields(input);
  const effectiveFrom = dateOrNull(input.effectiveFrom, "Effective from") ?? (await today(client));
  const effectiveUntil = dateOrNull(input.effectiveUntil, "Effective until");
  const code = await nextDocumentNumber(client, c, { documentType: "quality_specification" });
  const spec = (await qx(client, `INSERT INTO tenant.quality_inspection_specifications (organization_id, specification_code, name, description, inspection_stage, item_id, item_group_id, is_template,
      copied_from_id, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
  [c.organizationId, code, name, text(input.description, 2000), stage, refs.itemId, refs.groupId, bool(input.isTemplate), uuidOrNull(input.copiedFromId, "Source"), key, c.userId ?? null])).rows[0];
  const versionId = await insertVersion(client, c, spec, 1, fields, { effectiveFrom, effectiveUntil });
  await client.query(`UPDATE tenant.quality_inspection_specifications SET current_version_id = $2 WHERE id = $1`, [spec.id, versionId]);
  // The scope applies from today; which version is in force on a date is decided by the versions' own effective dates.
  await addScopeRule(client, c, spec, refs, await today(client));
  if (Array.isArray(input.checks) && input.checks.length) await addChecks(client, c, versionId, input.checks);
  await recordSpecEvent(client, c, { specId: spec.id, versionId, action: input.copiedFromId ? "COPIED" : "CREATED", to: "DRAFT", details: { code, stage, template: spec.is_template } });
  return { specificationId: spec.id, code, versionId, href: `/quality/specifications/${spec.id}` };
}

export async function updateInspectionSpecificationDraft(client, c, specId, versionId, input = {}) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId, { lock: true });
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  editable(version);
  expectVersion(version, input);
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  const changed = [];
  if (input.name !== undefined || input.description !== undefined) {
    const name = input.name === undefined ? spec.name : text(input.name, 200);
    if (!name) throw specError(400, "QUALITY_SPEC_NAME_REQUIRED");
    await client.query(`UPDATE tenant.quality_inspection_specifications SET name = $2, description = $3 WHERE id = $1`, [spec.id, name, input.description === undefined ? spec.description : text(input.description, 2000)]);
    changed.push("name");
  }
  if ((input.itemId !== undefined || input.itemGroupId !== undefined) && (input.itemId ?? null) !== spec.item_id) {
    const versions = (await client.query(`SELECT count(*)::int AS n FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1`, [spec.id])).rows[0].n;
    if (versions > 1 || version.approved_at) throw specError(409, "QUALITY_SPEC_VERSION_IMMUTABLE", "The product of an approved specification cannot change: copy it for another product.");
    const refs = await scopeRefs(client, c, input);
    await client.query(`UPDATE tenant.quality_inspection_specifications SET item_id = $2, item_group_id = $3 WHERE id = $1`, [spec.id, refs.itemId, refs.groupId]);
    await client.query(`UPDATE tenant.quality_spec_applicability_rules SET status = 'INACTIVE', deactivated_at = clock_timestamp(), deactivated_by = $2, deactivation_reason = 'Product changed'
      WHERE specification_id = $1 AND reason = 'Created with the specification' AND status = 'ACTIVE'`, [spec.id, c.userId ?? null]);
    await addScopeRule(client, c, { ...spec, item_id: refs.itemId }, refs, await today(client));
    changed.push("product");
  }
  const fields = samplingFields(input, version);
  const effectiveFrom = input.effectiveFrom === undefined ? version.effective_from : dateOrNull(input.effectiveFrom, "Effective from") ?? version.effective_from;
  const effectiveUntil = input.effectiveUntil === undefined ? version.effective_until : dateOrNull(input.effectiveUntil, "Effective until");
  if (effectiveUntil && effectiveUntil < effectiveFrom) throw specError(400, "QUALITY_SPEC_INVALID", "The end date is before the start date.");
  const reason = input.revisionReason === undefined ? version.revision_reason : textOrNull(input.revisionReason, 1000);
  const cols = [...VERSION_COLUMNS, "effective_from", "effective_until", "revision_reason"];
  const vals = [...VERSION_COLUMNS.map((k) => fields[k]), effectiveFrom, effectiveUntil, reason];
  await client.query(`UPDATE tenant.quality_inspection_spec_versions SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`,
    [version.id, ...vals]).catch(dbError);
  for (const k of cols) if (String(version[k] ?? "") !== String(vals[cols.indexOf(k)] ?? "")) changed.push(k);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "DRAFT_UPDATED", details: { changed } });
  return { specificationId: spec.id, versionId: version.id, changed };
}

async function addChecks(client, c, versionId, list) {
  const units = await unitsOf(client, c);
  const existing = await loadChecks(client, c, versionId);
  const used = new Set(existing.map((x) => x.characteristic_code));
  let sequence = existing.reduce((m, x) => Math.max(m, x.sequence), 0);
  const ids = [];
  for (const [index, raw] of list.entries()) {
    let row;
    try { row = await checkRow(client, c, raw, units, null); } catch (error) { if (list.length > 1) error.message = `Line ${index + 1}: ${error.message}`; throw error; }
    if (!row.characteristic_code) row.characteristic_code = nextCode(used); else used.add(row.characteristic_code);
    sequence += 1;
    ids.push(await insertCheck(client, c, versionId, sequence, row));
  }
  return ids;
}
// One check or many (bulk entry): input.checks = [...] or the fields of one check.
export async function addInspectionCharacteristics(client, c, specId, versionId, input = {}) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId);
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  editable(version);
  const list = Array.isArray(input.checks) ? input.checks : [input];
  if (!list.length) throw specError(400, "QUALITY_SPEC_NO_CHECKS");
  const ids = await addChecks(client, c, version.id, list);
  await bump(client, "quality_inspection_spec_versions", version.id);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "CHECKS_ADDED", details: { count: ids.length } });
  return { versionId: version.id, characteristicIds: ids };
}
export async function updateInspectionCharacteristic(client, c, specId, versionId, characteristicId, input = {}) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId);
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  editable(version);
  const current = (await qx(client, `SELECT * FROM tenant.quality_inspection_characteristics WHERE organization_id = $1 AND version_id = $2 AND id = $3`,
    [c.organizationId, version.id, uuid(characteristicId, "Check")])).rows[0];
  if (!current) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That check was not found.");
  const camel = { characteristicCode: current.characteristic_code, name: current.name, checkType: current.check_type, instructions: current.instructions, acceptanceText: current.acceptance_text,
    evidenceNote: current.evidence_note, uomId: current.uom_id, unitCode: current.unit_code, targetValue: current.target_value, lowerTolerance: current.lower_tolerance, upperTolerance: current.upper_tolerance,
    lowerLimit: current.lower_limit, upperLimit: current.upper_limit, lowerInclusive: current.lower_inclusive, upperInclusive: current.upper_inclusive, decimalPlaces: current.decimal_places,
    measurementRounding: current.measurement_rounding, expectedBoolean: current.expected_boolean, allowedValues: current.allowed_values, judgement: current.judgement, criticality: current.criticality,
    required: current.is_required, allowNa: current.allow_na, evidenceRequired: current.evidence_required, instrumentNote: current.instrument_note };
  const merged = { ...camel, ...input };
  if (input.uomId === undefined && input.unitCode !== undefined) merged.uomId = undefined;
  const row = await checkRow(client, c, merged, await unitsOf(client, c), current.characteristic_code);
  await client.query(`UPDATE tenant.quality_inspection_characteristics SET ${CHECK_COLUMNS.map((k, i) => `${k} = $${i + 2}${k === "allowed_values" ? "::jsonb" : ""}`).join(", ")}, updated_at = clock_timestamp()
    WHERE id = $1`, [current.id, ...CHECK_COLUMNS.map((k) => (k === "allowed_values" ? JSON.stringify(row[k] ?? []) : row[k] ?? null))]).catch((error) => {
    if (error.code === "23505") throw specError(409, "QUALITY_SPEC_INVALID", `Check code ${row.characteristic_code} is already used in this version.`);
    return dbError(error);
  });
  await bump(client, "quality_inspection_spec_versions", version.id);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "CHECK_UPDATED", details: { code: row.characteristic_code } });
  return { characteristicId: current.id };
}
export async function removeInspectionCharacteristic(client, c, specId, versionId, characteristicId) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId);
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  editable(version);
  const gone = (await client.query(`DELETE FROM tenant.quality_inspection_characteristics WHERE organization_id = $1 AND version_id = $2 AND id = $3 RETURNING characteristic_code`,
    [c.organizationId, version.id, uuid(characteristicId, "Check")]).catch(dbError)).rows[0];
  if (!gone) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That check was not found.");
  await resequence(client, c, version.id, (await loadChecks(client, c, version.id)).map((x) => x.id));
  await bump(client, "quality_inspection_spec_versions", version.id);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "CHECK_REMOVED", details: { code: gone.characteristic_code } });
  return { removed: gone.characteristic_code };
}
async function resequence(client, c, versionId, ids) {
  for (const [i, id] of ids.entries()) await client.query(`UPDATE tenant.quality_inspection_characteristics SET sequence = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, id, i + 1]);
}
export async function reorderInspectionCharacteristics(client, c, specId, versionId, input = {}) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId);
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  editable(version);
  const current = await loadChecks(client, c, version.id);
  const order = (Array.isArray(input.order) ? input.order : []).map(String);
  if (order.length !== current.length || new Set(order).size !== order.length || !current.every((x) => order.includes(x.id)))
    throw specError(400, "QUALITY_SPEC_INVALID", "List every check of this version exactly once.");
  await client.query(`SET CONSTRAINTS tenant.quality_inspection_characteristics_sequence_key DEFERRED`);
  await resequence(client, c, version.id, order);
  await client.query(`SET CONSTRAINTS tenant.quality_inspection_characteristics_sequence_key IMMEDIATE`);
  await bump(client, "quality_inspection_spec_versions", version.id);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "CHECKS_REORDERED" });
  return { versionId: version.id };
}

// ------------------------------------------------------------------ validation, review, approval, publication
async function issuesOf(client, c, spec, version) {
  const checks = await loadChecks(client, c, version.id);
  const item = spec.item_id ? (await client.query(`SELECT id FROM tenant.items WHERE organization_id = $1 AND id = $2 AND COALESCE(status, 'active') = 'active'`, [c.organizationId, spec.item_id])).rows[0] ?? null : undefined;
  return { checks, issues: validateVersion(spec, version, checks, { units: await unitsOf(client, c), item }) };
}
export async function validateSpecificationVersion(client, c, specId, versionId) {
  need(c, QS.view);
  const spec = await loadSpec(client, c, specId);
  const version = await loadVersion(client, c, spec.id, versionId);
  const { issues } = await issuesOf(client, c, spec, version);
  if (version.version_number > 1 && !version.revision_reason) issues.push({ code: "QUALITY_SPEC_REASON_REQUIRED", message: "Give the reason for this revision." });
  const conflicts = spec.is_template ? [] : await ruleConflicts(client, c, spec.id);
  return { valid: issues.length === 0, issues, conflicts };
}
export async function submitSpecificationForReview(client, c, specId, versionId, input = {}) {
  need(c, QS.submit);
  const spec = await loadSpec(client, c, specId, { lock: true });
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  if (version.status === "PENDING_REVIEW" && version.submitted_by === c.userId) return { versionId: version.id, status: version.status, replayed: true };
  editable(version);
  expectVersion(version, input);
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  const { issues } = await issuesOf(client, c, spec, version);
  if (version.version_number > 1 && !version.revision_reason) issues.push({ code: "QUALITY_SPEC_REASON_REQUIRED", message: "Give the reason for this revision." });
  if (issues.length) throw specError(400, issues[0].code, issues[0].message, { issues });
  await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = 'PENDING_REVIEW', submitted_by = $2, submitted_at = clock_timestamp(), review_note = NULL, row_version = row_version + 1,
    updated_at = clock_timestamp() WHERE id = $1`, [version.id, c.userId ?? null]);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "SUBMITTED", from: version.status, to: "PENDING_REVIEW", note: textOrNull(input.note, 1000) });
  return { versionId: version.id, status: "PENDING_REVIEW" };
}
async function reviewTransition(client, c, specId, versionId, input, to, action) {
  need(c, QS.review);
  const note = text(input.note ?? input.reason, 1000);
  if (!note) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", to === "REJECTED" ? "Say why the version is rejected." : "Say what needs to change.");
  const spec = await loadSpec(client, c, specId, { lock: true });
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  if (version.status !== "PENDING_REVIEW") throw specError(409, "QUALITY_SPEC_STATE", "Only a version waiting for review can be returned or rejected.");
  expectVersion(version, input);
  await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = $2, reviewed_by = $3, reviewed_at = clock_timestamp(), review_note = $4, row_version = row_version + 1,
    updated_at = clock_timestamp() WHERE id = $1`, [version.id, to, c.userId ?? null, note]);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action, from: "PENDING_REVIEW", to, note });
  return { versionId: version.id, status: to };
}
export const requestSpecificationChanges = (client, c, specId, versionId, input = {}) => reviewTransition(client, c, specId, versionId, input, "CHANGES_REQUESTED", "CHANGES_REQUESTED");
export const rejectSpecificationVersion = (client, c, specId, versionId, input = {}) => reviewTransition(client, c, specId, versionId, input, "REJECTED", "REJECTED");

export async function approveSpecificationVersion(client, c, specId, versionId, input = {}) {
  need(c, QS.approve);
  const spec = await loadSpec(client, c, specId, { lock: true });
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  if (["APPROVED", "ACTIVE"].includes(version.status) && version.approved_by === c.userId) return { versionId: version.id, status: version.status, contentHash: version.content_hash, replayed: true };
  if (version.status !== "PENDING_REVIEW") throw specError(409, EDITABLE.includes(version.status) ? "QUALITY_SPEC_APPROVAL_REQUIRED" : "QUALITY_SPEC_STATE",
    EDITABLE.includes(version.status) ? "Submit this version for review first." : undefined);
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  const policy = await settingsOf(client, c);
  if (policy.prohibitSelfApproval && c.userId && [version.created_by, version.submitted_by].includes(c.userId)) throw specError(403, "QUALITY_SPEC_SELF_APPROVAL");
  const note = textOrNull(input.note, 1000);
  if (policy.approvalNoteRequired && !note) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", "Add an approval note.");
  const { checks, issues } = await issuesOf(client, c, spec, version);
  if (issues.length) throw specError(400, issues[0].code, issues[0].message, { issues });
  const hash = contentHash(version, checks);
  if (input.contentHash && input.contentHash !== hash) throw specError(409, "QUALITY_SPEC_VERSION_CONFLICT");
  await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), approval_note = $3, content_hash = $4,
    row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`, [version.id, c.userId ?? null, note, hash]);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "APPROVED", from: "PENDING_REVIEW", to: "APPROVED", note, details: { contentHash: hash } });
  if (input.publish && has(c, QS.activate)) return { ...(await publishSpecificationVersion(client, c, spec.id, version.id, {})), contentHash: hash };
  return { versionId: version.id, status: "APPROVED", contentHash: hash };
}

// Publication makes an approved version effective from its date (at once when that date has come). Repeating it changes nothing.
export async function publishSpecificationVersion(client, c, specId, versionId, input = {}) {
  need(c, QS.activate);
  const spec = await loadSpec(client, c, specId, { lock: true });
  const version = await loadVersion(client, c, spec.id, versionId, { lock: true });
  if (version.published_at) return { versionId: version.id, status: version.status, effectiveFrom: version.effective_from, replayed: true };
  if (version.status !== "APPROVED") throw specError(409, "QUALITY_SPEC_APPROVAL_REQUIRED");
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  if (spec.is_template) throw specError(409, "QUALITY_SPEC_STATE", "A template is copied, not published.");
  expectVersion(version, input);
  const conflicts = await ruleConflicts(client, c, spec.id);
  if (conflicts.length) throw specError(409, "QUALITY_SPEC_APPLICABILITY_CONFLICT", undefined, { conflicts });
  await client.query(`UPDATE tenant.quality_inspection_spec_versions SET published_by = $2, published_at = clock_timestamp(), row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`,
    [version.id, c.userId ?? null]);
  // A newer publication overtakes any older published version that has not yet taken effect.
  await recordSpecEvent(client, c, { specId: spec.id, versionId: version.id, action: "PUBLISHED", details: { effectiveFrom: version.effective_from } });
  await activateDueVersions(client, c, { specId: spec.id });
  const now = (await qx(client, `SELECT status, effective_from FROM tenant.quality_inspection_spec_versions WHERE id = $1`, [version.id])).rows[0];
  if (now.status === "APPROVED") await ensureMirrorPlan(client, c, version.id);
  return { versionId: version.id, status: now.status, effectiveFrom: now.effective_from, scheduled: now.status === "APPROVED" };
}

// ------------------------------------------------------------------ revision, copy, retirement
export async function createSpecificationRevision(client, c, specId, input = {}) {
  need(c, QS.revise);
  const key = textOrNull(input.idempotencyKey, 120);
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { specificationId: specId, versionId: prior.id, replayed: true };
  }
  const reason = text(input.reason ?? input.revisionReason, 1000);
  if (!reason) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", "Say why the specification is being revised.");
  const spec = await loadSpec(client, c, specId, { lock: true });
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  const versions = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1 ORDER BY version_number DESC`, [spec.id])).rows;
  if (versions.some((v) => ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED"].includes(v.status))) throw specError(409, "QUALITY_SPEC_STATE", "A revision of this specification is already in progress.");
  const base = versions.find((v) => ["ACTIVE", "APPROVED"].includes(v.status)) ?? versions.find((v) => v.status === "SUPERSEDED") ?? versions[0];
  const day = await today(client);
  const id = await insertVersion(client, c, spec, versions[0].version_number + 1, base, {
    effectiveFrom: dateOrNull(input.effectiveFrom, "Effective from") ?? (base.effective_from > day ? base.effective_from : day), reason, supersedes: base.id, idempotencyKey: key });
  await copyChecks(client, c, base.id, id);
  await recordSpecEvent(client, c, { specId: spec.id, versionId: id, action: "REVISION_CREATED", to: "DRAFT", note: reason, details: { from: base.version_number } });
  return { specificationId: spec.id, versionId: id, versionNumber: versions[0].version_number + 1 };
}
export async function copyInspectionSpecification(client, c, specId, input = {}) {
  need(c, QS.copy);
  need(c, QS.create);
  const source = await loadSpec(client, c, specId);
  const versions = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1 ORDER BY version_number DESC`, [source.id])).rows;
  const base = versions.find((v) => v.id === input.versionId) ?? versions.find((v) => ["ACTIVE", "APPROVED"].includes(v.status)) ?? versions[0];
  const made = await createInspectionSpecification(client, c, {
    name: input.name ?? `${source.name} (copy)`, description: input.description ?? source.description, stage: input.stage ?? source.inspection_stage,
    itemId: input.itemId === undefined ? (source.is_template ? null : source.item_id) : input.itemId, itemGroupId: input.itemGroupId === undefined ? (source.is_template ? null : source.item_group_id) : input.itemGroupId,
    isTemplate: input.asTemplate ?? false, copiedFromId: source.id, idempotencyKey: input.idempotencyKey, effectiveFrom: input.effectiveFrom,
    samplingMethod: base.sampling_method, sampleValue: base.sample_value, sampleMinimum: base.sample_minimum, sampleMaximum: base.sample_maximum, roundingRule: base.rounding_rule,
    samplingBasis: base.sampling_basis, samplingInstructions: base.sampling_instructions, decisionRule: base.decision_rule, allowedMajorDefects: base.allowed_major_defects,
    allowedMinorDefects: base.allowed_minor_defects, lotContext: base.lot_context,
  });
  if (!made.replayed) await copyChecks(client, c, base.id, made.versionId);
  return { ...made, copiedFrom: source.specification_code };
}
export async function retireInspectionSpecification(client, c, specId, input = {}) {
  need(c, QS.retire);
  const reason = text(input.reason, 1000);
  if (!reason) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", "Say why the specification is retired.");
  const spec = await loadSpec(client, c, specId, { lock: true });
  if (spec.status === "RETIRED") return { specificationId: spec.id, status: "RETIRED", replayed: true };
  expectVersion(spec, input);
  const versions = (await qx(client, `SELECT id, status FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1`, [spec.id])).rows;
  for (const v of versions) {
    const to = ["ACTIVE", "APPROVED"].includes(v.status) ? "RETIRED" : ["DRAFT", "PENDING_REVIEW", "CHANGES_REQUESTED"].includes(v.status) ? "REJECTED" : null;
    if (!to) continue;
    await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = $2, retired_at = CASE WHEN $2 = 'RETIRED' THEN clock_timestamp() END,
      review_note = CASE WHEN $2 = 'REJECTED' THEN 'The specification was retired' ELSE review_note END, row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1`, [v.id, to]);
    await client.query(`UPDATE tenant.quality_plans SET status = 'obsolete', updated_at = now() WHERE spec_version_id = $1`, [v.id]);
  }
  await client.query(`UPDATE tenant.quality_inspection_specifications SET status = 'RETIRED', retired_at = clock_timestamp(), retired_by = $2, retire_reason = $3, row_version = row_version + 1,
    updated_at = clock_timestamp() WHERE id = $1`, [spec.id, c.userId ?? null, reason]);
  await client.query(`UPDATE tenant.quality_spec_applicability_rules SET status = 'INACTIVE', deactivated_at = clock_timestamp(), deactivated_by = $2, deactivation_reason = 'Specification retired'
    WHERE specification_id = $1 AND status = 'ACTIVE'`, [spec.id, c.userId ?? null]);
  await recordSpecEvent(client, c, { specId: spec.id, action: "RETIRED", from: "ACTIVE", to: "RETIRED", note: reason });
  return { specificationId: spec.id, status: "RETIRED" };
}

// ------------------------------------------------------------------ applicability
// Another active specification's rule with exactly the same scope, stage, supplier and site over overlapping dates.
async function sameKeyRule(client, c, { stage, scope, itemId, groupId, supplierId, warehouseId, from, until, specId, excludeRuleId = null }) {
  return (await client.query(`SELECT r.id, s.specification_code, s.id AS specification_id FROM tenant.quality_spec_applicability_rules r JOIN tenant.quality_inspection_specifications s ON s.id = r.specification_id
      WHERE r.organization_id = $1 AND r.status = 'ACTIVE' AND s.status = 'ACTIVE' AND NOT s.is_template AND r.inspection_stage = $2 AND r.scope_kind = $3
        AND r.item_id IS NOT DISTINCT FROM $4 AND r.item_group_id IS NOT DISTINCT FROM $5 AND r.supplier_id IS NOT DISTINCT FROM $6 AND r.warehouse_id IS NOT DISTINCT FROM $7
        AND r.effective_from <= COALESCE($9::date, 'infinity'::date) AND COALESCE(r.effective_until, 'infinity'::date) >= $8::date
        AND ($10::uuid IS NULL OR r.id <> $10) AND r.specification_id <> $11 LIMIT 1`,
  [c.organizationId, stage, scope, itemId, groupId, supplierId, warehouseId, from, until, excludeRuleId, specId])).rows[0] ?? null;
}
export async function ruleConflicts(client, c, specId) {
  const rules = (await qx(client, `SELECT * FROM tenant.quality_spec_applicability_rules WHERE organization_id = $1 AND specification_id = $2 AND status = 'ACTIVE'`, [c.organizationId, specId])).rows;
  const out = [];
  for (const r of rules) {
    const clash = await sameKeyRule(client, c, { stage: r.inspection_stage, scope: r.scope_kind, itemId: r.item_id, groupId: r.item_group_id, supplierId: r.supplier_id, warehouseId: r.warehouse_id,
      from: r.effective_from, until: r.effective_until, specId });
    if (clash) out.push({ ruleId: r.id, conflictsWith: clash.specification_code, conflictingSpecificationId: clash.specification_id, conflictingRuleId: clash.id });
  }
  return out;
}
export async function addApplicabilityRule(client, c, specId, input = {}) {
  need(c, QS.applicability);
  const spec = await loadSpec(client, c, specId, { lock: true });
  if (spec.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
  if (spec.is_template) throw specError(409, "QUALITY_SPEC_STATE", "A template has no applicability; copy it first.");
  const scope = oneOf(input.scope ?? input.scopeKind ?? (input.itemId ? "ITEM" : input.itemGroupId ? "CATEGORY" : "COMPANY_DEFAULT"), SCOPES, "QUALITY_SPEC_PRODUCT_INVALID", "Scope");
  const refs = scope === "ITEM" ? await scopeRefs(client, c, { itemId: input.itemId }) : scope === "CATEGORY" ? await scopeRefs(client, c, { itemGroupId: input.itemGroupId }) : { itemId: null, groupId: null };
  if ((scope === "ITEM" && !refs.itemId) || (scope === "CATEGORY" && !refs.groupId)) throw specError(400, "QUALITY_SPEC_PRODUCT_INVALID");
  const supplierId = uuidOrNull(input.supplierId, "Supplier");
  const warehouseId = uuidOrNull(input.warehouseId, "Site");
  if (supplierId && !(await companyRow(client, c, "procurement_suppliers", supplierId))) throw specError(400, "QUALITY_SPEC_COMPANY_MISMATCH");
  if (warehouseId && !(await companyRow(client, c, "warehouses", warehouseId))) throw specError(400, "QUALITY_SPEC_COMPANY_MISMATCH");
  if (supplierId && spec.inspection_stage !== "INCOMING") throw specError(400, "QUALITY_SPEC_INVALID", "A supplier-specific rule applies to incoming inspection.");
  if (supplierId && !text(input.reason)) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", "Say why this supplier needs its own specification.");
  const from = dateOrNull(input.effectiveFrom, "Effective from") ?? (await today(client));
  const until = dateOrNull(input.effectiveUntil, "Effective until");
  if (until && until < from) throw specError(400, "QUALITY_SPEC_INVALID", "The end date is before the start date.");
  const own = (await client.query(`SELECT id FROM tenant.quality_spec_applicability_rules WHERE specification_id = $1 AND status = 'ACTIVE' AND scope_kind = $2 AND item_id IS NOT DISTINCT FROM $3
      AND item_group_id IS NOT DISTINCT FROM $4 AND supplier_id IS NOT DISTINCT FROM $5 AND warehouse_id IS NOT DISTINCT FROM $6`, [spec.id, scope, refs.itemId, refs.groupId, supplierId, warehouseId])).rows[0];
  if (own) throw specError(409, "QUALITY_SPEC_STATE", "This specification already has that rule.");
  const clash = await sameKeyRule(client, c, { stage: spec.inspection_stage, scope, itemId: refs.itemId, groupId: refs.groupId, supplierId, warehouseId, from, until, specId: spec.id });
  if (clash) throw specError(409, "QUALITY_SPEC_APPLICABILITY_CONFLICT", `${clash.specification_code} already applies to this ${scope === "ITEM" ? "item" : scope === "CATEGORY" ? "category" : "Company"} and stage. Resolve the conflict.`,
    { conflictsWith: clash.specification_code, conflictingSpecificationId: clash.specification_id });
  const tier = tierOf(scope, supplierId, warehouseId);
  const id = (await client.query(`INSERT INTO tenant.quality_spec_applicability_rules (organization_id, specification_id, inspection_stage, scope_kind, item_id, item_group_id, supplier_id, warehouse_id,
      effective_from, effective_until, specificity, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
  [c.organizationId, spec.id, spec.inspection_stage, scope, refs.itemId, refs.groupId, supplierId, warehouseId, from, until, tier, textOrNull(input.reason, 500), c.userId ?? null])).rows[0].id;
  await recordSpecEvent(client, c, { specId: spec.id, action: "RULE_ADDED", details: { ruleId: id, scope, itemId: refs.itemId, itemGroupId: refs.groupId, supplierId, warehouseId, from, until, tier } });
  return { ruleId: id, specificity: tier };
}
export async function deactivateApplicabilityRule(client, c, specId, ruleId, input = {}) {
  need(c, QS.applicability);
  const reason = text(input.reason, 500);
  if (!reason) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED");
  const spec = await loadSpec(client, c, specId);
  const row = (await client.query(`UPDATE tenant.quality_spec_applicability_rules SET status = 'INACTIVE', deactivated_at = clock_timestamp(), deactivated_by = $3, deactivation_reason = $4
    WHERE specification_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING id`, [spec.id, uuid(ruleId, "Rule"), c.userId ?? null, reason])).rows[0];
  if (!row) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That rule was not found or is already inactive.");
  await recordSpecEvent(client, c, { specId: spec.id, action: "RULE_DEACTIVATED", note: reason, details: { ruleId: row.id } });
  return { ruleId: row.id, status: "INACTIVE" };
}

// ------------------------------------------------------------------ Quality settings: approval policy and inspection requirements
export async function saveSpecificationPolicy(client, c, input = {}) {
  need(c, QS.settings);
  await client.query(`INSERT INTO tenant.quality_settings (organization_id, spec_prohibit_self_approval, spec_approval_note_required) VALUES ($1, $2, $3)
    ON CONFLICT (organization_id) DO UPDATE SET spec_prohibit_self_approval = EXCLUDED.spec_prohibit_self_approval, spec_approval_note_required = EXCLUDED.spec_approval_note_required, updated_at = now()`,
  [c.organizationId, bool(input.prohibitSelfApproval, true), bool(input.approvalNoteRequired, false)]);
  return settingsOf(client, c);
}
export async function resolveSpecificationException(client, c, exceptionId, input = {}) {
  need(c, QS.applicability, QS.settings);
  const note = text(input.note, 1000);
  if (!note) throw specError(400, "QUALITY_SPEC_REASON_REQUIRED", "Say how the exception was resolved.");
  const status = input.dismiss ? "DISMISSED" : "RESOLVED";
  const row = (await client.query(`UPDATE tenant.quality_spec_exceptions SET status = $3, resolved_by = $4, resolved_at = clock_timestamp(), resolution_note = $5 WHERE organization_id = $1 AND id = $2
    AND status = 'OPEN' RETURNING id`, [c.organizationId, uuid(exceptionId, "Exception"), status, c.userId ?? null, note])).rows[0];
  if (!row) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That exception was not found or is already closed.");
  return { exceptionId: row.id, status };
}

// ------------------------------------------------------------------ documents (kept as evidence: archived, never deleted)
export async function uploadSpecificationFile(client, c, specId, input = {}, options = {}) {
  need(c, QS.editDraft, QS.create);
  const spec = await loadSpec(client, c, specId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: SPEC_FILE_ENTITY, entityId: spec.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await recordSpecEvent(client, c, { specId: spec.id, action: "DOCUMENT_ADDED", details: { fileId: file.id, fileName: file.fileName ?? file.file_name } });
  return { id: file.id, fileName: file.fileName ?? file.file_name };
}
export async function listSpecificationFiles(client, c, specId) {
  need(c, QS.evidence);
  const spec = await loadSpec(client, c, specId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: SPEC_FILE_ENTITY, entityId: spec.id });
  return rows.map((row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes ?? 0), uploadedAt: row.createdAt }));
}
export async function readSpecificationFile(client, c, specId, fileId, options = {}) {
  need(c, QS.evidence);
  const spec = await loadSpec(client, c, specId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4`,
    [c.organizationId, SPEC_FILE_ENTITY, String(spec.id), uuid(fileId, "File")])).rows[0];
  if (!row) throw specError(404, "QUALITY_SPEC_NOT_FOUND", "That document was not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: SPEC_FILE_ENTITY, entityId: spec.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}
export async function archiveSpecificationFile(client, c, specId, fileId) {
  need(c, QS.editDraft);
  const spec = await loadSpec(client, c, specId);
  await archiveFile(client, { organizationId: c.organizationId, entityType: SPEC_FILE_ENTITY, entityId: spec.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await recordSpecEvent(client, c, { specId: spec.id, action: "DOCUMENT_ARCHIVED", details: { fileId } });
  return { archived: true };
}
export const canEditSpecs = (c) => has(c, QS.editDraft);
