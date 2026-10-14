// Material Consumption Variance — the shared calculator. For each material line of an order: what its frozen BOM revision expects for the
// chosen output basis (yield, batches and the BOM's allowance included, exactly as the BOM engine explodes it, matched line by line), what
// was actually used (posted consumption net of corrections) and lost as material scrap (a separate loss, never counted twice), the
// difference in quantity, percent and value at the line's reference cost, the actual cost from the posted consumption and scrap, and the
// band under the tolerance in force (the company's, overridden per item group or item; critical materials stricter). Issued, returned and
// in-custody material is shown but never treated as use. Nothing is written here.
import { createHash } from "node:crypto";

import { explodeRevision } from "../boms/bom-engine.js";
import { D, MO, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, max, moError, mul, q, settingsOf, sub, text, uuid } from "../orders/mo-core.js";

export const VAR = Object.freeze({
  view: "manufacturing.variance.view", investigate: "manufacturing.variance.investigate", submit: "manufacturing.variance.submit", approve: "manufacturing.variance.approve",
  resolve: "manufacturing.variance.resolve", costView: "manufacturing.variance.cost_view", export: "manufacturing.variance.export", policy: "manufacturing.variance.policy",
});
export const BASES = Object.freeze({ REPORTED_OUTPUT: "Output reported (good and rejected attempts)", GOOD_OUTPUT: "Good output only", ORIGINAL_PLAN: "Original plan",
  AUTHORIZED_PLAN: "Authorized plan (with approved extra material)" });
export const BAND_LABEL = Object.freeze({ NOT_CALCULABLE: "Not calculable", NO_OUTPUT: "Used before output was reported", WITHIN: "Within tolerance", REVIEW: "Review",
  APPROVAL: "Approval required", UNPLANNED: "Unplanned material", SAVING_REVIEW: "Under the BOM — check for missing consumption", INCOMPLETE: "Under the BOM — material still in production" });
export const NEEDS_REVIEW = new Set(["REVIEW", "APPROVAL", "UNPLANNED", "SAVING_REVIEW"]);
export const NEEDS_APPROVAL = new Set(["APPROVAL", "UNPLANNED"]);
export const REASONS = Object.freeze({ PROCESS_WASTE: "Process waste", MATERIAL_DAMAGE: "Material damage", QUALITY_REJECTION: "Quality rejection", REWORK: "Rework",
  OPERATOR_ERROR: "Operator error", MEASUREMENT_ERROR: "Measurement error", BOM_STANDARD_INACCURATE: "BOM standard inaccurate", PRODUCTION_PLAN_CHANGE: "Production plan change",
  MISSING_CONSUMPTION: "Missing consumption", OTHER: "Other" });

const MESSAGES = Object.freeze({
  MFG_VAR_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_VAR_NOT_FOUND: "The variance exception could not be found.",
  MFG_VAR_OUTPUT_INCOMPLETE: "Production information is incomplete. The variance is provisional.",
  MFG_VAR_EXPECTED_UNAVAILABLE: "Expected material usage could not be calculated.",
  MFG_VAR_UOM_INVALID: "The material units cannot be compared.",
  MFG_VAR_COST_UNAVAILABLE: "Material cost information is unavailable.",
  MFG_VAR_TOLERANCE_EXCEEDED: "Material usage is outside the allowed limit.",
  MFG_VAR_REASON_REQUIRED: "Explain the difference before submitting.",
  MFG_VAR_APPROVAL_REQUIRED: "Supervisor approval is required.",
  MFG_VAR_APPROVAL_STALE: "Material usage changed. Review and approve the updated variance.",
  MFG_VAR_SOURCE_CHANGED: "Production or consumption records changed. Refresh the variance.",
  MFG_VAR_ALREADY_RESOLVED: "This exception has already been resolved.",
  MFG_VAR_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_VAR_RECOVERY_REQUIRED: "Source records need reconciliation before this variance can be finalized.",
  MFG_VAR_STATE_INVALID: "This action is not available in the exception's current status.",
  MFG_VAR_POLICY_INVALID: "The tolerance is not valid.",
});
export const varError = (status, code, message, details) => moError(status, code, message ?? MESSAGES[code], details);
export const needVar = (c, permission) => { if (!has(c, permission)) throw varError(403, "MFG_VAR_PERMISSION_DENIED"); };
export const canSeeVarianceCost = (c) => has(c, VAR.costView) || has(c, MO.costView);

export async function loadVarOrder(client, c, orderId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(orderId, "Manufacturing order")])).rows[0];
  if (!row) throw varError(404, "MFG_VAR_MO_NOT_FOUND");
  return row;
}

// ------------------------------------------------------------------ the tolerance in force
export async function companyPolicy(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT mc_variance_warning_pct, mc_variance_approval_pct, mv_saving_review_pct, mv_approval_value_above, mv_block_completion, mc_self_approval_allowed
      FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { warningPct: D(row.mc_variance_warning_pct ?? 2), approvalPct: D(row.mc_variance_approval_pct ?? 5), savingReviewPct: D(row.mv_saving_review_pct ?? 5),
    valueAbove: row.mv_approval_value_above === null || row.mv_approval_value_above === undefined ? null : D(row.mv_approval_value_above),
    blockCompletion: Boolean(row.mv_block_completion), selfApproval: Boolean(row.mc_self_approval_allowed), varianceSelfApproval: settings.varianceSelfApproval };
}
// The overrides for a set of items: item first, then its group.
export async function overridesFor(client, c, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = (await client.query(
    `SELECT item.id AS item_id, tolerance.* FROM tenant.items item JOIN tenant.manufacturing_variance_tolerances tolerance
        ON tolerance.organization_id = item.organization_id AND tolerance.status = 'ACTIVE'
       AND ((tolerance.scope = 'ITEM' AND tolerance.item_id = item.id) OR (tolerance.scope = 'GROUP' AND tolerance.item_group_id = item.group_id))
      WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[]) ORDER BY (tolerance.scope = 'ITEM') DESC`, [c.organizationId, itemIds])).rows;
  const out = new Map();
  for (const row of rows) if (!out.has(row.item_id)) out.set(row.item_id, row);
  return out;
}
export function policyFor(company, override) {
  const policy = override ? {
    source: override.scope === "ITEM" ? "ITEM" : "GROUP", toleranceId: override.id, version: override.version, warningPct: D(override.warning_pct), approvalPct: D(override.approval_pct),
    savingReviewPct: override.saving_review_pct === null ? company.savingReviewPct : D(override.saving_review_pct),
    valueAbove: override.approval_value_above === null ? company.valueAbove : D(override.approval_value_above),
    quantityAbove: override.approval_quantity_above === null ? null : D(override.approval_quantity_above), critical: Boolean(override.critical),
  } : { source: "COMPANY", toleranceId: null, version: null, warningPct: company.warningPct, approvalPct: company.approvalPct, savingReviewPct: company.savingReviewPct,
    valueAbove: company.valueAbove, quantityAbove: null, critical: false };
  const wire = { source: policy.source, toleranceId: policy.toleranceId, version: policy.version, warningPct: q(policy.warningPct), approvalPct: q(policy.approvalPct),
    savingReviewPct: q(policy.savingReviewPct), valueAbove: policy.valueAbove === null ? null : q(policy.valueAbove), quantityAbove: policy.quantityAbove === null ? null : q(policy.quantityAbove),
    critical: policy.critical };
  return { ...policy, wire, hash: createHash("sha256").update(JSON.stringify(wire)).digest("hex").slice(0, 16) };
}

// ------------------------------------------------------------------ expected use
// What the BOM expects per BOM line for `basis` units: { required (with allowance), productive (before it) } keyed by the revision line.
export async function expectedByBomLine(client, c, order, basis) {
  if (!order.bom_revision_id) throw varError(409, "MFG_VAR_EXPECTED_UNAVAILABLE", `${order.mo_number} has no BOM revision.`);
  const out = new Map();
  if (basis <= ZERO) return out;
  const explosion = await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(basis), policy: "USE_STOCKED_SUBASSEMBLIES" });
  const top = Math.min(...explosion.lines.map((row) => row.level));
  for (const row of explosion.lines.filter((entry) => entry.level === top)) {
    const current = out.get(row.lineId) ?? { required: ZERO, productive: ZERO };
    out.set(row.lineId, { required: add(current.required, D(row.required)), productive: add(current.productive, D(row.beforeAllowance)) });
  }
  return out;
}

// Actual cost: posted consumption (net of corrections, at the issue cost it carried) and posted, unreversed material scrap, per material line.
async function actualCosts(client, c, orderId) {
  const consumption = (await client.query(
    `SELECT line.material_id, sum(CASE WHEN line.total_cost IS NULL THEN NULL ELSE line.total_cost * (line.base_quantity - line.corrected_quantity) / line.base_quantity END) AS cost,
            bool_or(line.total_cost IS NULL) AS missing, count(DISTINCT note.id)::int AS notes
       FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
      WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND note.status = 'POSTED' GROUP BY line.material_id`, [c.organizationId, orderId])).rows;
  const scrap = (await client.query(
    `SELECT line.material_id, sum(line.total_cost) AS cost, bool_or(line.total_cost IS NULL) AS missing FROM tenant.manufacturing_scrap_lines line JOIN tenant.manufacturing_scraps scrap ON scrap.id = line.scrap_id
      WHERE scrap.organization_id = $1 AND scrap.manufacturing_order_id = $2 AND scrap.status = 'POSTED' AND scrap.correction_status <> 'REVERSED' AND line.material_id IS NOT NULL GROUP BY line.material_id`,
    [c.organizationId, orderId])).rows;
  const drafts = (await client.query(
    `SELECT line.material_id, count(*)::int AS n FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
      WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND note.status IN ('DRAFT', 'PENDING_APPROVAL', 'POSTING', 'RECOVERY_REQUIRED') GROUP BY line.material_id`,
    [c.organizationId, orderId])).rows;
  return { consumption: new Map(consumption.map((row) => [row.material_id, row])), scrap: new Map(scrap.map((row) => [row.material_id, row])), drafts: new Map(drafts.map((row) => [row.material_id, row.n])) };
}
const money = (value) => (value === null ? null : q(value, 2));
const pctOf = (part, whole) => (whole > ZERO ? div(mul(part, 100n * 1_000_000n), whole) : null);

// ------------------------------------------------------------------ the evaluation
// Every material line of the order on one basis, with the three other bases' expectations for comparison.
// extraConsumed (material id → quantity) projects use not yet posted (the closing declaration of what is still in production).
export async function evaluateOrder(client, c, order, { basis = "REPORTED_OUTPUT", extraConsumed = null } = {}) {
  if (!BASES[basis]) throw varError(400, "MFG_VAR_EXPECTED_UNAVAILABLE", "Choose a comparison basis.");
  const materials = await loadMaterials(client, c, order.id);
  const company = await companyPolicy(client, c);
  const overrides = await overridesFor(client, c, [...new Set(materials.map((row) => row.component_item_id))]);
  const costs = await actualCosts(client, c, order.id);
  const quantities = { REPORTED_OUTPUT: D(order.reported_quantity), GOOD_OUTPUT: D(order.accepted_quantity), ORIGINAL_PLAN: D(order.planned_base_quantity) };
  const expectations = {};
  let failure = null;
  for (const key of Object.keys(quantities)) {
    try { expectations[key] = await expectedByBomLine(client, c, order, quantities[key]); } catch (error) { failure = failure ?? error.message; expectations[key] = null; }
  }
  const final = order.status === "COMPLETED";
  const recovery = Number((await client.query(
    `SELECT (SELECT count(*) FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'RECOVERY_REQUIRED')
          + (SELECT count(*) FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'RECOVERY_REQUIRED')
          + (SELECT count(*) FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'RECOVERY_REQUIRED') AS n`, [c.organizationId, order.id])).rows[0].n);
  const lines = materials.map((material) => {
    const projected = extraConsumed?.get(material.id) ?? ZERO;
    const base = lineFigures(material);
    const figures = projected > ZERO ? { ...base, consumed: add(base.consumed, projected), custody: sub(base.custody, projected) } : base;
    const policy = policyFor(company, overrides.get(material.component_item_id));
    const forBasis = (key) => {
      if (key === "AUTHORIZED_PLAN") return { required: figures.required, productive: figures.required };
      const map = expectations[key];
      if (!map) return null;
      return material.bom_line_id ? map.get(material.bom_line_id) ?? { required: ZERO, productive: ZERO } : { required: ZERO, productive: ZERO };
    };
    const expectedAt = forBasis(basis);
    const basisQuantity = basis === "AUTHORIZED_PLAN" ? null : quantities[basis];
    const actual = add(figures.consumed, figures.scrapped);
    const consumptionCost = costs.consumption.get(material.id);
    const scrapCost = costs.scrap.get(material.id);
    const drafts = costs.drafts.get(material.id) ?? 0;
    const ref = material.estimated_unit_cost === null || material.estimated_unit_cost === undefined ? null : D(material.estimated_unit_cost);
    let status = final ? "FINAL" : "PROVISIONAL";
    let band;
    let variance = null;
    let pct = null;
    const notes = [];
    if (!expectedAt) { status = "NOT_CALCULABLE"; band = "NOT_CALCULABLE"; notes.push(failure ?? MESSAGES.MFG_VAR_EXPECTED_UNAVAILABLE); }
    else if (basisQuantity !== null && basisQuantity <= ZERO && actual === ZERO) { status = "NOT_CALCULABLE"; band = "NOT_CALCULABLE"; notes.push("Nothing produced or used yet."); }
    else if (basisQuantity !== null && basisQuantity <= ZERO) { band = "NO_OUTPUT"; notes.push(MESSAGES.MFG_VAR_OUTPUT_INCOMPLETE); }
    else {
      variance = sub(actual, expectedAt.required);
      pct = pctOf(variance, expectedAt.required);
      const cost = ref === null ? null : mul(variance, ref);
      if (expectedAt.required === ZERO && actual > ZERO) band = "UNPLANNED";
      else if (variance >= ZERO) {
        band = pct === null || pct <= policy.warningPct ? "WITHIN" : pct <= policy.approvalPct ? "REVIEW" : "APPROVAL";
        if (variance > ZERO && policy.quantityAbove !== null && variance > policy.quantityAbove) band = "APPROVAL";
        if (variance > ZERO && policy.valueAbove !== null && cost !== null && cost > policy.valueAbove) band = "APPROVAL";
        if (policy.critical && band === "REVIEW") band = "APPROVAL";
      } else {
        // Less than expected: while material is still in production custody (or consumption awaits posting) it is not a saving yet.
        const short = sub(ZERO, pct ?? ZERO);
        band = short <= policy.savingReviewPct ? "WITHIN" : !final && (figures.custody > ZERO || drafts > 0) ? "INCOMPLETE" : "SAVING_REVIEW";
      }
    }
    if (drafts) notes.push(`${drafts} consumption line(s) not yet posted are not counted.`);
    if (figures.custody > ZERO && !final) notes.push(`${q(figures.custody)} ${material.uom_code} is still in production custody (issued, not yet used).`);
    const usageCost = variance !== null && ref !== null ? mul(variance, ref) : null;
    const expectedCost = expectedAt && ref !== null ? mul(expectedAt.required, ref) : null;
    const costMissing = Boolean(consumptionCost?.missing || scrapCost?.missing);
    const actualCost = costMissing ? null : add(D(consumptionCost?.cost ?? 0), D(scrapCost?.cost ?? 0));
    const totalCostVariance = actualCost !== null && expectedCost !== null ? sub(actualCost, expectedCost) : null;
    const sourceVersions = { material: Number(material.version ?? 0), reported: q(D(order.reported_quantity)), accepted: q(D(order.accepted_quantity)), consumed: q(figures.consumed), scrapped: q(figures.scrapped) };
    const content = { material: material.id, basis, basisQuantity: basisQuantity === null ? null : q(basisQuantity), expected: expectedAt ? q(expectedAt.required) : null,
      consumed: q(figures.consumed), scrapped: q(figures.scrapped), policy: policy.hash, revision: order.bom_revision_id };
    const explanation = band === "NOT_CALCULABLE" ? notes[0] : band === "NO_OUTPUT"
      ? `${q(actual)} ${material.uom_code} used so far; no output reported yet, so the variance is provisional.`
      : `Expected ${q(expectedAt.required)} ${material.uom_code} of ${material.item_code} for ${basisQuantity === null ? "the authorized plan" : `${q(basisQuantity)} produced`}${expectedAt.required !== expectedAt.productive ? ` (including ${q(sub(expectedAt.required, expectedAt.productive))} allowed waste)` : ""}. Actual use was ${q(actual)}${figures.scrapped > ZERO ? ` (${q(figures.consumed)} consumed + ${q(figures.scrapped)} scrapped)` : ""}. ${variance === ZERO ? "That is exactly as expected." : variance > ZERO ? `That is ${q(variance)} more than expected.` : `That is ${q(sub(ZERO, variance))} less than expected.`}`;
    return {
      material, figures, policy, band, status, variance, pct, expected: expectedAt?.required ?? null, productive: expectedAt?.productive ?? null, actual, basisQuantity,
      reference: ref, usageCost, expectedCost, actualCost, totalCostVariance, priceVariance: totalCostVariance !== null && usageCost !== null ? sub(totalCostVariance, usageCost) : null,
      scrapCost: scrapCost?.cost === undefined || scrapCost?.cost === null ? null : D(scrapCost.cost), drafts, notes, explanation, sourceVersions,
      hash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      bases: Object.fromEntries(Object.keys(BASES).map((key) => { const value = forBasis(key); return [key, value ? q(value.required) : null]; })),
      classification: variance === null || variance === ZERO || band === "INCOMPLETE" ? "NONE" : variance > ZERO ? "UNFAVORABLE" : "FAVORABLE",
    };
  });
  return { order, basis, basisLabel: BASES[basis], final, failure, recovery, company, lines, quantities };
}

// The wire form of one evaluated line (cost only for those who may see it).
export function lineView(line, c) {
  const cost = canSeeVarianceCost(c);
  const m = line.material;
  return {
    materialId: m.id, lineNumber: m.line_number, itemId: m.component_item_id, code: m.item_code, name: m.item_name, uom: m.uom_code, kind: m.kind ?? null, origin: m.origin ?? "RECIPE",
    trackingType: m.tracking_type, bomLineId: m.bom_line_id,
    basisQuantity: line.basisQuantity === null ? null : q(line.basisQuantity), expected: line.expected === null ? null : q(line.expected),
    expectedProductive: line.productive === null ? null : q(line.productive), allowance: line.expected === null || line.productive === null ? null : q(sub(line.expected, line.productive)),
    consumed: q(line.figures.consumed), scrapped: q(line.figures.scrapped), actual: q(line.actual), issued: q(D(m.issued_quantity)), returned: q(D(m.returned_quantity)),
    netIssued: q(line.figures.netIssued), inCustody: q(line.figures.custody), planned: q(D(m.planned_quantity)), authorizedExtra: q(D(m.authorized_extra_quantity ?? 0)),
    variance: line.variance === null ? null : q(line.variance), variancePct: line.pct === null ? null : q(line.pct, 2), classification: line.classification,
    band: line.band, bandLabel: BAND_LABEL[line.band], status: line.status, needsReview: NEEDS_REVIEW.has(line.band), needsApproval: NEEDS_APPROVAL.has(line.band),
    policy: line.policy.wire, policyHash: line.policy.hash, notes: line.notes, explanation: line.explanation, hash: line.hash, bases: line.bases,
    cost: cost ? { reference: line.reference === null ? null : q(line.reference), usage: money(line.usageCost), expected: money(line.expectedCost), actual: money(line.actualCost),
      total: money(line.totalCostVariance), price: money(line.priceVariance), scrap: money(line.scrapCost), available: line.actualCost !== null && line.reference !== null } : null,
  };
}

// The snapshot of one line, kept when someone acts on it.
export async function snapshot(client, c, order, line, purpose) {
  const row = (await client.query(
    `INSERT INTO tenant.manufacturing_material_variance_evaluations (organization_id, manufacturing_order_id, material_id, component_item_id, bom_revision_id, bom_snapshot_id, basis,
       output_basis_quantity, expected_quantity, expected_productive_quantity, consumed_quantity, scrap_quantity, variance_quantity, variance_pct, reference_unit_cost, usage_cost_variance,
       actual_cost, expected_cost, calculation_status, band, policy, policy_hash, source_versions, content_hash, purpose, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'REPORTED_OUTPUT',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb,$23,$24,$25) RETURNING id`,
    [c.organizationId, order.id, line.material.id, line.material.component_item_id, order.bom_revision_id ?? null, order.bom_snapshot_id ?? null,
      line.basisQuantity === null ? null : q(line.basisQuantity), line.expected === null ? null : q(line.expected), line.productive === null ? null : q(line.productive),
      q(line.figures.consumed), q(line.figures.scrapped), line.variance === null ? null : q(line.variance), line.pct === null ? null : q(line.pct, 4),
      line.reference === null ? null : q(line.reference), money(line.usageCost), money(line.actualCost), money(line.expectedCost), line.status, line.band, JSON.stringify(line.policy.wire),
      line.policy.hash, JSON.stringify(line.sourceVersions), line.hash, purpose, c.userId ?? null])).rows[0];
  return row.id;
}
export async function varianceEvent(client, c, orderId, action, { exceptionId = null, evaluationId = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_material_variance_events (organization_id, manufacturing_order_id, exception_id, evaluation_id, action, summary, details, actor_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [c.organizationId, orderId, exceptionId, evaluationId, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}

export { D, MO, STATUS_LABEL, ZERO, add, div, has, max, mul, q, sub, text, uuid };
