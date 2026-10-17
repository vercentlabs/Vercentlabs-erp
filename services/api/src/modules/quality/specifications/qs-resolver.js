// Quality — Inspection Specifications: effective-date activation, the deterministic resolver and the mirror inspection plan.
//
// Activation: a published version becomes ACTIVE on its effective date (checked whenever specifications are read or resolved), and the
// version it replaces is SUPERSEDED for new work from that day. Resolution: for a stage and a source (item, its category, supplier, site,
// date) the applicable rules are ranked by specificity — item + supplier + site, then item + supplier or site, then item, then the same over
// the item's category (nearest category first), then the Company default. The most specific rank must name exactly one specification:
// two equally specific specifications are a conflict reported to Quality, never a silent choice. The specification's version effective on
// the date is the one bound; nothing approved later changes an inspection already created.
import { qx } from "../common.js";
import { loadChecks, recordSpecEvent, today } from "./qs-data.js";
import { STAGES, criterionText, has, intervalOf, need, oneOf, QS, sampleSize, samplingSentence, specError, uuid, uuidOrNull, decText, dateOrNull } from "./qs-rules.js";

const PUBLISHED = ["APPROVED", "ACTIVE", "SUPERSEDED"];

// ------------------------------------------------------------------ activation on the effective date
export async function activateDueVersions(client, context, { specId = null, date = null } = {}) {
  const c = { ...context, userId: null }; // the effective date, not a person, activates a version
  const day = date ?? (await today(client));
  const due = (await qx(client, `SELECT v.* FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
      WHERE v.organization_id = $1 AND v.status = 'APPROVED' AND v.published_at IS NOT NULL AND v.effective_from <= $2::date AND s.status = 'ACTIVE'
        AND ($3::uuid IS NULL OR v.specification_id = $3) ORDER BY v.specification_id, v.version_number DESC`, [c.organizationId, day, specId])).rows;
  const seen = new Set();
  const activated = [];
  for (const v of due) {
    if (seen.has(v.specification_id)) {
      // An older published version overtaken by a newer one before it ever took effect.
      await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = 'SUPERSEDED', superseded_at = clock_timestamp(), updated_at = clock_timestamp(), row_version = row_version + 1
        WHERE id = $1`, [v.id]);
      await recordSpecEvent(client, c, { specId: v.specification_id, versionId: v.id, action: "SUPERSEDED", from: "APPROVED", to: "SUPERSEDED", note: "Replaced before it took effect" });
      await retireMirror(client, c, v.id);
      continue;
    }
    seen.add(v.specification_id);
    await client.query(`SELECT id FROM tenant.quality_inspection_specifications WHERE id = $1 FOR UPDATE`, [v.specification_id]);
    const previous = (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE specification_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [v.specification_id])).rows[0];
    if (previous) {
      await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = 'SUPERSEDED', superseded_at = clock_timestamp(), superseded_by_version_id = $2,
          effective_until = CASE WHEN effective_until IS NULL OR effective_until >= $3::date THEN GREATEST(effective_from, $3::date - 1) ELSE effective_until END,
          updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [previous.id, v.id, v.effective_from]);
      await recordSpecEvent(client, c, { specId: v.specification_id, versionId: previous.id, action: "SUPERSEDED", from: "ACTIVE", to: "SUPERSEDED", details: { by: v.version_number } });
      await retireMirror(client, c, previous.id);
    }
    await client.query(`UPDATE tenant.quality_inspection_spec_versions SET status = 'ACTIVE', activated_at = clock_timestamp(), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.id]);
    await client.query(`UPDATE tenant.quality_inspection_specifications SET current_version_id = $2, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [v.specification_id, v.id]);
    await recordSpecEvent(client, c, { specId: v.specification_id, versionId: v.id, action: "ACTIVATED", from: "APPROVED", to: "ACTIVE", details: { effectiveFrom: v.effective_from } });
    await ensureMirrorPlan(client, c, v.id);
    activated.push(v.id);
  }
  return activated;
}

// ------------------------------------------------------------------ the mirror inspection plan (the inspection screens' view of a version)
const PLAN_TYPE = { INCOMING: "incoming", IN_PROCESS: "in_process", FINAL: "final", PRE_DISPATCH: "final", RETURN: "customer_return", MANUAL: "stock_audit" };
const RESULT_TYPE = { NUMERIC_RANGE: "numeric", NUMERIC_TARGET_TOLERANCE: "numeric", BOOLEAN: "boolean", VISUAL: "boolean", ENUM: "selection", TEXT_OBSERVATION: "text" };
export async function ensureMirrorPlan(client, c, versionId) {
  const existing = (await client.query(`SELECT id, status FROM tenant.quality_plans WHERE organization_id = $1 AND spec_version_id = $2`, [c.organizationId, versionId])).rows[0];
  const v = (await qx(client, `SELECT v.*, s.specification_code, s.legacy_plan_code, s.name, s.description, s.status AS spec_status FROM tenant.quality_inspection_spec_versions v
    JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id WHERE v.organization_id = $1 AND v.id = $2`, [c.organizationId, versionId])).rows[0];
  const usable = v.spec_status === "ACTIVE" && v.status === "ACTIVE";
  if (existing) {
    const want = usable ? "active" : "obsolete";
    if (existing.status !== want) await client.query(`UPDATE tenant.quality_plans SET status = $2, updated_at = now() WHERE id = $1`, [existing.id, want]);
    return existing.id;
  }
  const sampling = { ALL_UNITS: ["full", "100"], FIXED_COUNT: ["fixed_quantity", String(v.sample_value ?? 1)], PERCENTAGE: ["percentage", String(v.sample_value ?? 100)],
    DOCUMENT_ONLY: ["fixed_quantity", "0"], MANUAL_APPROVED_COUNT: ["full", "100"] }[v.sampling_method];
  const plan = (await client.query(`INSERT INTO tenant.quality_plans (organization_id, code, name, description, plan_type, version, status, effective_from, effective_to, sampling_method,
      sampling_value, created_by, approved_by, approved_at, spec_version_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [c.organizationId, v.legacy_plan_code ?? v.specification_code, v.name, v.description || null, PLAN_TYPE[v.inspection_stage], v.version_number, usable ? "active" : "inactive",
      v.effective_from, v.effective_until, sampling[0], sampling[1], v.created_by ?? c.userId, v.approved_by, v.approved_at, v.id])).rows[0];
  for (const ch of await loadChecks(client, c, v.id)) {
    let lower = null;
    let upper = null;
    if (RESULT_TYPE[ch.check_type] === "numeric") {
      const iv = intervalOf(ch);
      lower = iv.lower === null ? null : decText(iv.lower);
      upper = iv.upper === null ? null : decText(iv.upper);
    }
    await client.query(`INSERT INTO tenant.quality_inspection_points (organization_id, plan_id, sequence, characteristic, inspection_method, result_type, lower_limit, target_value, upper_limit,
        unit, allowed_values, critical, destructive, instructions, spec_characteristic_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, false, $13, $14)`,
      [c.organizationId, plan.id, ch.sequence, ch.name, ch.instrument_note || (ch.check_type === "VISUAL" ? "Visual" : "As instructed"), RESULT_TYPE[ch.check_type], lower, ch.target_value, upper,
        ch.unit_code, JSON.stringify((ch.allowed_values ?? []).map((a) => a.value)), ch.criticality === "CRITICAL",
        [ch.instructions, `Acceptable: ${criterionText(ch)}`, ch.evidence_required ? `Evidence: ${ch.evidence_note || "required"}` : null].filter(Boolean).join("\n"), ch.id]);
  }
  return plan.id;
}
async function retireMirror(client, c, versionId) {
  await client.query(`UPDATE tenant.quality_plans SET status = 'obsolete', updated_at = now() WHERE organization_id = $1 AND spec_version_id = $2 AND status <> 'obsolete'`, [c.organizationId, versionId]);
}

// ------------------------------------------------------------------ resolution
async function categoryChain(client, c, groupId) {
  const chain = [];
  let id = groupId;
  while (id && chain.length < 20 && !chain.includes(id)) {
    chain.push(id);
    id = (await client.query(`SELECT parent_id FROM tenant.item_groups WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0]?.parent_id ?? null;
  }
  return chain;
}
async function effectiveVersion(client, c, specId, day) {
  return (await qx(client, `SELECT * FROM tenant.quality_inspection_spec_versions WHERE organization_id = $1 AND specification_id = $2 AND status = ANY($3) AND published_at IS NOT NULL
      AND effective_from <= $4::date AND (effective_until IS NULL OR effective_until >= $4::date) ORDER BY version_number DESC LIMIT 1`, [c.organizationId, specId, PUBLISHED, day])).rows[0] ?? null;
}
async function packageOf(client, c, spec, version, quantity, approvedCount) {
  const checks = await loadChecks(client, c, version.id);
  return {
    specification: { id: spec.id, code: spec.specification_code, name: spec.name, stage: spec.inspection_stage },
    version: { id: version.id, number: version.version_number, status: version.status, effectiveFrom: version.effective_from, effectiveUntil: version.effective_until, contentHash: version.content_hash },
    stage: version.inspection_stage,
    sampling: { method: version.sampling_method, value: version.sample_value, minimum: version.sample_minimum, maximum: version.sample_maximum, rounding: version.rounding_rule,
      basis: version.sampling_basis, lotContext: version.lot_context, instructions: version.sampling_instructions, sentence: samplingSentence(version),
      ...(quantity === null || quantity === undefined ? {} : { computed: sampleSize(version, quantity, { approvedCount }) }) },
    decision: { rule: version.decision_rule, allowedMajor: version.allowed_major_defects, allowedMinor: version.allowed_minor_defects },
    characteristics: checks.map((ch) => ({ id: ch.id, code: ch.characteristic_code, sequence: ch.sequence, name: ch.name, type: ch.check_type, instructions: ch.instructions,
      acceptable: criterionText(ch), unit: ch.unit_code, criticality: ch.criticality, required: ch.is_required, allowNa: ch.allow_na, evidenceRequired: ch.evidence_required,
      evidenceNote: ch.evidence_note, instrument: ch.instrument_note })),
    evidenceRequired: checks.filter((ch) => ch.evidence_required).map((ch) => ch.characteristic_code),
    _version: version,
  };
}

// input: { stage, itemId, supplierId, warehouseId, date, quantity, specVersionId (an explicit, authorized selection), approvedCount }.
// Returns { status: RESOLVED | CONFLICT | NONE, ... }. Throws for an explicit selection that cannot be used.
export async function resolveSpecification(client, c, input = {}) {
  const stage = oneOf(input.stage ?? "INCOMING", STAGES, "QUALITY_SPEC_STAGE_INVALID");
  const day = dateOrNull(input.date, "Date") ?? (await today(client));
  await activateDueVersions(client, c, { date: day });
  if (input.specVersionId) {
    const v = (await qx(client, `SELECT v.*, s.status AS spec_status FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_specifications s ON s.id = v.specification_id
        WHERE v.organization_id = $1 AND v.id = $2`, [c.organizationId, uuid(input.specVersionId, "Specification version")])).rows[0];
    if (!v) throw specError(404, "QUALITY_SPEC_NOT_FOUND");
    if (v.spec_status === "RETIRED" || v.status === "RETIRED") throw specError(409, "QUALITY_SPEC_RETIRED");
    if (!PUBLISHED.includes(v.status) || !v.published_at) throw specError(409, "QUALITY_SPEC_APPROVAL_REQUIRED");
    if (v.inspection_stage !== stage) throw specError(409, "QUALITY_SPEC_STAGE_INVALID", `This specification is for ${STAGES[v.inspection_stage].toLowerCase()}, not ${STAGES[stage].toLowerCase()}.`);
    if (v.effective_from > day || (v.effective_until && v.effective_until < day)) throw specError(409, "QUALITY_SPEC_NOT_EFFECTIVE");
    const spec = (await qx(client, `SELECT * FROM tenant.quality_inspection_specifications WHERE id = $1`, [v.specification_id])).rows[0];
    return { status: "RESOLVED", ...(await packageOf(client, c, spec, v, input.quantity, input.approvedCount)), trace: { method: "EXPLICIT", date: day, stage } };
  }
  const itemId = uuidOrNull(input.itemId, "Item");
  const supplierId = uuidOrNull(input.supplierId, "Supplier");
  const warehouseId = uuidOrNull(input.warehouseId, "Site");
  const item = itemId ? (await client.query(`SELECT id, group_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0] : null;
  if (itemId && !item) throw specError(400, "QUALITY_SPEC_COMPANY_MISMATCH");
  const chain = item?.group_id ? await categoryChain(client, c, item.group_id) : [];
  const rules = (await qx(client, `SELECT r.*, s.specification_code, s.name FROM tenant.quality_spec_applicability_rules r JOIN tenant.quality_inspection_specifications s ON s.id = r.specification_id
      WHERE r.organization_id = $1 AND r.status = 'ACTIVE' AND r.inspection_stage = $2 AND s.status = 'ACTIVE' AND NOT s.is_template
        AND r.effective_from <= $3::date AND (r.effective_until IS NULL OR r.effective_until >= $3::date)
        AND ((r.scope_kind = 'ITEM' AND r.item_id = $4) OR (r.scope_kind = 'CATEGORY' AND r.item_group_id = ANY($5::uuid[])) OR r.scope_kind = 'COMPANY_DEFAULT')
        AND (r.supplier_id IS NULL OR r.supplier_id = $6) AND (r.warehouse_id IS NULL OR r.warehouse_id = $7)`,
    [c.organizationId, stage, day, itemId, chain, supplierId, warehouseId])).rows;
  const candidates = [];
  const notEffective = [];
  for (const r of rules) {
    const version = await effectiveVersion(client, c, r.specification_id, day);
    if (!version) { notEffective.push({ code: r.specification_code, name: r.name }); continue; }
    candidates.push({ rule: r, version, rank: [r.specificity, r.scope_kind === "CATEGORY" ? chain.indexOf(r.item_group_id) : 0] });
  }
  if (!candidates.length) return { status: "NONE", stage, date: day, notEffective };
  candidates.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  const best = candidates.filter((x) => x.rank[0] === candidates[0].rank[0] && x.rank[1] === candidates[0].rank[1]);
  const specs = [...new Set(best.map((x) => x.rule.specification_id))];
  if (specs.length > 1)
    return { status: "CONFLICT", stage, date: day, code: "QUALITY_SPEC_APPLICABILITY_CONFLICT", message: `${specs.length} applicable specifications were found. Ask Quality to resolve the conflict.`,
      candidates: best.map((x) => ({ specificationId: x.rule.specification_id, code: x.rule.specification_code, name: x.rule.name, ruleId: x.rule.id, tier: x.rule.specificity })) };
  const chosen = best[0];
  const spec = (await qx(client, `SELECT * FROM tenant.quality_inspection_specifications WHERE id = $1`, [chosen.rule.specification_id])).rows[0];
  return { status: "RESOLVED", ...(await packageOf(client, c, spec, chosen.version, input.quantity, input.approvedCount)),
    trace: { method: "RULE", date: day, stage, ruleId: chosen.rule.id, tier: chosen.rule.specificity, scope: chosen.rule.scope_kind, itemId, supplierId, warehouseId,
      considered: candidates.length } };
}
// The API's view of the resolver (Quality and the source workflows' readers).
export async function resolveApplicableInspectionSpecification(client, c, input = {}) {
  need(c, QS.view);
  const out = await resolveSpecification(client, c, input);
  if (out._version) delete out._version;
  return out;
}

// A configuration exception met by a source workflow (once per source line while open).
export async function recordSpecException(client, c, { code, stage, itemId = null, supplierId = null, warehouseId = null, sourceType, sourceId = null, sourceLineId = null, sourceLabel = null, detail = {},
  controlPointId = null, obligationId = null }) {
  const { rows } = await client.query(`INSERT INTO tenant.quality_spec_exceptions (organization_id, exception_code, inspection_stage, item_id, supplier_id, warehouse_id, source_type, source_id,
      source_line_id, source_label, detail, control_point_id, obligation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
    ON CONFLICT (organization_id, exception_code, source_line_id) WHERE status = 'OPEN' AND source_line_id IS NOT NULL DO NOTHING RETURNING id`,
    [c.organizationId, code, stage, itemId, supplierId, warehouseId, sourceType, sourceId, sourceLineId, sourceLabel, JSON.stringify(detail), controlPointId, obligationId]);
  return rows[0]?.id ?? null;
}

// What a goods receipt's inspection hold needs from Quality: the bound version (and its mirror plan), a recorded exception, or nothing.
// A missing specification never means the goods are accepted, and nothing here places or releases stock.
export async function specificationForSource(client, c, { stage, itemId, supplierId, warehouseId, date, quantity, sourceType, sourceId, sourceLineId, sourceLabel }) {
  const out = await resolveSpecification(client, c, { stage, itemId, supplierId, warehouseId, date, quantity });
  if (out.status === "RESOLVED") {
    const planId = await ensureMirrorPlan(client, c, out.version.id);
    return { status: "RESOLVED", planId, versionId: out.version.id, sampleQuantity: out.sampling.computed?.size ?? null,
      resolution: { ...out.trace, specification: out.specification.code, version: out.version.number, contentHash: out.version.contentHash, sampling: out.sampling.computed ?? null } };
  }
  if (out.status === "CONFLICT") {
    const exceptionId = await recordSpecException(client, c, { code: "APPLICABILITY_CONFLICT", stage, itemId, supplierId, warehouseId, sourceType, sourceId, sourceLineId, sourceLabel,
      detail: { candidates: out.candidates, date: out.date } });
    return { status: "CONFLICT", exceptionId };
  }
  // Where an inspection is required, a Quality Control Point says so (and records the exception); here no specification simply means none.
  return { status: "NONE" };
}
export const canSeeEvidence = (c) => has(c, "quality.spec.view_evidence");
