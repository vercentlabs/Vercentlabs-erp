// Bill of Materials — the engine: what a revision needs, checked and calculated. Validation (items, units, quantities, subassemblies, cycles),
// deterministic selection of the effective revision, multilevel explosion with yield, batches and extra-material allowance, availability
// against Inventory, an estimated material cost from Inventory valuation, revision comparison and the frozen recipe a production order
// keeps. Nothing here moves stock, reserves it, buys it or posts to Finance.
import { createHash } from "node:crypto";

import { add, decimal, div, formatDecimal, mul, sub } from "../../../core/decimal.js";
import { normalizeQuantityToBase, resolveItemUnit } from "../../products/uom.js";
import { getAvailabilityBreakdown } from "../../stock/balances.js";
import { currentValuationRate } from "../../stock/valuation-engine.js";
import { has } from "../common.js";

const SCALE = 1_000_000n;
const ZERO = 0n;
const HUNDRED = decimal(100);
export const BOM_PERMISSIONS = Object.freeze({
  view: "manufacturing.bom.view", create: "manufacturing.bom.create", editDraft: "manufacturing.bom.edit_draft", submit: "manufacturing.bom.submit",
  approve: "manufacturing.bom.approve", activate: "manufacturing.bom.activate", revise: "manufacturing.bom.revise", obsolete: "manufacturing.bom.obsolete",
  costView: "manufacturing.bom.cost_view", export: "manufacturing.bom.export", moUse: "manufacturing.bom.mo_use",
});

// The messages a person sees, by code.
const MESSAGES = Object.freeze({
  MFG_BOM_PRODUCT_REQUIRED: "Select the product you want to manufacture.",
  MFG_BOM_PRODUCT_INVALID: "This product cannot be manufactured from a BOM.",
  MFG_BOM_OUTPUT_INVALID: "Enter a valid production quantity.",
  MFG_BOM_COMPONENT_REQUIRED: "Add at least one required material.",
  MFG_BOM_COMPONENT_INVALID: "One of the selected materials cannot be used.",
  MFG_BOM_QTY_INVALID: "Enter a valid material quantity.",
  MFG_BOM_UOM_INVALID: "The unit of measurement is not compatible.",
  MFG_BOM_CONVERSION_MISSING: "A material's unit conversion is missing.",
  MFG_BOM_CIRCULAR_REFERENCE: "This recipe creates a circular product dependency.",
  MFG_BOM_CHILD_NOT_APPROVED: "Approve the subassembly recipe before using it.",
  MFG_BOM_REVISION_CONFLICT: "Another user changed this draft. Refresh before saving.",
  MFG_BOM_NOT_APPROVED: "This BOM must be approved before production.",
  MFG_BOM_ACTIVE_CONFLICT: "Another BOM revision is already active for this period.",
  MFG_BOM_COST_MISSING: "Cost information is missing for some materials.",
  MFG_BOM_STOCK_UNAVAILABLE: "Stock availability cannot be checked currently.",
  MFG_BOM_APPROVAL_REQUIRED: "An authorized manager must approve this recipe.",
  MFG_BOM_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_BOM_IN_USE: "This BOM is used by Manufacturing Orders and cannot be deleted.",
  MFG_BOM_SNAPSHOT_FAILED: "The production recipe could not be prepared. Try recovery.",
  MFG_BOM_VERSION_STALE: "This version is no longer current.",
  MFG_BOM_CALCULATION_ERROR: "Material requirements could not be calculated.",
  MFG_BOM_YIELD_INVALID: "Expected yield must be more than 0% and at most 100%.",
  MFG_BOM_SCRAP_INVALID: "The extra-material allowance must be between 0% and 500%.",
  MFG_BOM_BATCH_REQUIRED: "Enter the batch size: a fixed-per-batch material is counted once per batch.",
  MFG_BOM_DATES_INVALID: "The effective dates are not valid.",
  MFG_BOM_NOT_FOUND: "The BOM was not found.",
  MFG_BOM_VALIDATION_FAILED: "The BOM has problems to fix first.",
  MFG_BOM_REV_NOT_FOUND: "This BOM revision could not be found.",
  MFG_BOM_REV_NOT_EDITABLE: "Only Draft revisions can be edited.",
  MFG_BOM_REV_DUPLICATE: "This revision number already exists.",
  MFG_BOM_REV_SOURCE_INVALID: "Select a valid source revision.",
  MFG_BOM_REV_CHANGE_REASON_REQUIRED: "Explain why the recipe is changing.",
  MFG_BOM_REV_VALIDATION_FAILED: "Some materials or quantities need correction.",
  MFG_BOM_REV_CIRCULAR_DEPENDENCY: "This change creates a circular BOM dependency.",
  MFG_BOM_REV_CHILD_INVALID: "A referenced subassembly revision is not valid.",
  MFG_BOM_REV_APPROVAL_REQUIRED: "This revision needs approval.",
  MFG_BOM_REV_APPROVAL_STALE: "The recipe changed. Request approval again.",
  MFG_BOM_REV_EFFECTIVITY_OVERLAP: "Another BOM revision is already scheduled for this period.",
  MFG_BOM_REV_NOT_ACTIVE: "This revision is not eligible for the selected production date.",
  MFG_BOM_REV_IN_USE: "This revision is used by Manufacturing Orders and cannot be deleted.",
  MFG_BOM_REV_VERSION_CONFLICT: "Another user changed this revision. Refresh and try again.",
  MFG_BOM_REV_PERMISSION_DENIED: "You cannot perform this action.",
  MFG_BOM_REV_OUTCOME_UNKNOWN: "Checking the previous operation. Do not repeat it yet.",
});

export class BomError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message ?? MESSAGES[code] ?? "The BOM action failed.");
    this.name = "BomError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const bomError = (status, code, message, details) => new BomError(status, code, message, details);
export const needBom = (c, permission) => { if (!has(c, permission)) throw bomError(403, "MFG_BOM_PERMISSION_DENIED"); };

// ------------------------------------------------------------------ decimal helpers
export const D = (value) => decimal(value ?? 0);
export const out = (value, places = 6) => formatDecimal(value, places).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
// Up to the next multiple of 10^-places (a value within one millionth of a boundary counts as on it, so rounding noise never adds a unit).
export function ceilTo(value, places) {
  const step = 10n ** BigInt(6 - Math.max(0, Math.min(6, Number(places))));
  const remainder = value % step;
  if (remainder === ZERO || remainder <= 1n) return value - remainder;
  return value - remainder + step;
}
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
};
export const hashOf = (value) => createHash("sha256").update(stableJson(value)).digest("hex");

// ------------------------------------------------------------------ reading
export async function loadItem(client, organizationId, itemId) {
  return (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.status, item.lifecycle_status, item.track_inventory, item.tracking_type, item.is_variant_template,
            item.uom_id, item.standard_cost, uom.code AS uom_code, uom.decimal_places AS uom_decimals
       FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = $2`, [organizationId, itemId])).rows[0] ?? null;
}

export async function loadRevision(client, organizationId, revisionId, { lock = false } = {}) {
  const row = (await client.query(
    `SELECT revision.*, master.bom_number, master.finished_item_id, master.archived_at, master.name AS bom_name
       FROM tenant.manufacturing_bom_revisions revision JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id
      WHERE revision.organization_id = $1 AND revision.id = $2${lock ? " FOR UPDATE OF revision" : ""}`, [organizationId, revisionId])).rows[0];
  if (!row) throw bomError(404, "MFG_BOM_REV_NOT_FOUND");
  return row;
}

export async function loadLines(client, organizationId, revisionId) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.tracking_type, item.uom_id AS item_base_uom_id, uom.code AS uom_code,
            child.revision_number AS child_revision_number, child.status AS child_status, child_master.bom_number AS child_bom_number
       FROM tenant.manufacturing_bom_lines line
       JOIN tenant.items item ON item.id = line.component_item_id
       JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
       LEFT JOIN tenant.manufacturing_bom_revisions child ON child.id = line.child_bom_revision_id
       LEFT JOIN tenant.manufacturing_bom_masters child_master ON child_master.id = child.bom_id
      WHERE line.organization_id = $1 AND line.revision_id = $2 ORDER BY line.line_number`, [organizationId, revisionId])).rows;
}

// The recipe's content as the approval binds to it: header and lines in a canonical form.
export function revisionContent(revision, lines) {
  return {
    finishedItemId: revision.finished_item_id, outputQuantity: out(D(revision.output_quantity)), outputUomId: revision.output_uom_id,
    expectedYieldPct: out(D(revision.expected_yield_pct)), batchSize: revision.batch_size === null || revision.batch_size === undefined ? null : out(D(revision.batch_size)),
    description: revision.description ?? null,
    lines: lines.map((line) => ({ lineNumber: Number(line.line_number), componentItemId: line.component_item_id, quantity: out(D(line.quantity)), uomId: line.uom_id,
      consumptionMode: line.consumption_mode, scrapAllowancePct: out(D(line.scrap_allowance_pct)), childBomRevisionId: line.child_bom_revision_id ?? null, notes: line.notes ?? null })),
  };
}

// ------------------------------------------------------------------ effective revision (deterministic)
// Effectivity moves with the clock: a schedule whose start has come makes its approved revision active; an active window whose end has
// passed ends, and its revision is superseded by the one that starts there. Recorded as system events. Safe to run concurrently (each row
// changes once, under its row lock).
export async function settleBomStatuses(client, organizationId, bomId = null) {
  const started = (await client.query(
    `UPDATE tenant.manufacturing_bom_effectivities SET status = 'ACTIVE', started_at = effective_from, version = version + 1
      WHERE organization_id = $1 AND ($2::uuid IS NULL OR bom_id = $2) AND status = 'SCHEDULED' AND effective_from <= clock_timestamp()
      RETURNING bom_id, revision_id, effective_from, effective_to, scheduled_by`, [organizationId, bomId])).rows;
  for (const row of started) {
    const changed = (await client.query(
      `UPDATE tenant.manufacturing_bom_revisions SET status = 'ACTIVE', activated_at = COALESCE(activated_at, $3), activated_by = COALESCE(activated_by, $4), version = version + 1
        WHERE organization_id = $1 AND id = $2 AND status = 'APPROVED' RETURNING approved_content_hash`, [organizationId, row.revision_id, row.effective_from, row.scheduled_by])).rows[0];
    if (changed) await systemEvent(client, organizationId, row.bom_id, row.revision_id, "BECAME_EFFECTIVE", "APPROVED", "ACTIVE", { effectiveFrom: row.effective_from, effectiveTo: row.effective_to }, changed.approved_content_hash);
  }
  const ended = (await client.query(
    `UPDATE tenant.manufacturing_bom_effectivities SET status = 'ENDED', ended_at = effective_to, version = version + 1
      WHERE organization_id = $1 AND ($2::uuid IS NULL OR bom_id = $2) AND status = 'ACTIVE' AND effective_to IS NOT NULL AND effective_to <= clock_timestamp()
      RETURNING bom_id, revision_id, finished_item_id, scope_key, effective_to`, [organizationId, bomId])).rows;
  for (const row of ended) {
    const next = (await client.query(
      `SELECT revision_id FROM tenant.manufacturing_bom_effectivities WHERE organization_id = $1 AND finished_item_id = $2 AND scope_key = $3 AND effective_from = $4
          AND status IN ('SCHEDULED', 'ACTIVE') LIMIT 1`, [organizationId, row.finished_item_id, row.scope_key, row.effective_to])).rows[0];
    const changed = (await client.query(
      `UPDATE tenant.manufacturing_bom_revisions SET status = 'SUPERSEDED', superseded_at = COALESCE(superseded_at, $3), superseded_by_revision_id = COALESCE(superseded_by_revision_id, $4),
              version = version + 1 WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING id`, [organizationId, row.revision_id, row.effective_to, next?.revision_id ?? null])).rows[0];
    if (changed) await systemEvent(client, organizationId, row.bom_id, row.revision_id, "SUPERSEDED", "ACTIVE", "SUPERSEDED", { effectiveTo: row.effective_to, byRevisionId: next?.revision_id ?? null });
  }
}

async function systemEvent(client, organizationId, bomId, revisionId, action, fromStatus, toStatus, details, contentHash = null) {
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_events (organization_id, bom_id, revision_id, action, from_status, to_status, content_hash, details, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL)`, [organizationId, bomId, revisionId, action, fromStatus, toStatus, contentHash, JSON.stringify(details)]);
}

// The live effectivity window of an item's BOM at a moment (scheduled or active, [from, to)), or null. Two would be a data error, never a choice.
export async function effectiveWindowAt(client, organizationId, itemId, at = null) {
  const rows = (await client.query(
    `SELECT effectivity.*, revision.revision_number FROM tenant.manufacturing_bom_effectivities effectivity
       JOIN tenant.manufacturing_bom_masters master ON master.id = effectivity.bom_id JOIN tenant.manufacturing_bom_revisions revision ON revision.id = effectivity.revision_id
      WHERE effectivity.organization_id = $1 AND effectivity.finished_item_id = $2 AND effectivity.scope_key = 'DEFAULT' AND master.archived_at IS NULL
        AND effectivity.status IN ('SCHEDULED', 'ACTIVE') AND revision.status IN ('APPROVED', 'ACTIVE')
        AND effectivity.effective_from <= COALESCE($3::timestamptz, clock_timestamp()) AND (effectivity.effective_to IS NULL OR effectivity.effective_to > COALESCE($3::timestamptz, clock_timestamp()))`,
    [organizationId, itemId, at])).rows;
  if (rows.length > 1) throw bomError(409, "MFG_BOM_REV_EFFECTIVITY_OVERLAP", "Two revisions are effective for this product at once; retire one before using it.");
  return rows[0] ?? null;
}

// The revision of an item's BOM used for production at a moment (default now), or null.
export async function resolveEffectiveBom(client, organizationId, itemId, at = null) {
  return (await effectiveWindowAt(client, organizationId, itemId, at))?.revision_id ?? null;
}

// ------------------------------------------------------------------ validation
const ELIGIBLE_COMPONENT = new Set(["product", "consumable"]);

// Every revision reachable from an item through its recipes: the effective (or most recent approved, or under-review) revision of its BOM.
async function recipesOf(client, organizationId, itemId) {
  return (await client.query(
    `SELECT revision.id, revision.status FROM tenant.manufacturing_bom_revisions revision JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id
      WHERE revision.organization_id = $1 AND master.finished_item_id = $2 AND master.archived_at IS NULL AND revision.status IN ('PENDING_APPROVAL', 'APPROVED', 'ACTIVE')`,
    [organizationId, itemId])).rows;
}

// Would `finishedItemId`'s recipe, using these component items, reach itself? Follows every recipe a component may be made by.
async function cycleThrough(client, organizationId, finishedItemId, componentItemIds, pinned = new Map()) {
  const visiting = new Set();
  const visit = async (itemId, path) => {
    if (itemId === finishedItemId) return path;
    if (visiting.has(itemId)) return null;
    visiting.add(itemId);
    const revisions = pinned.has(itemId) ? [{ id: pinned.get(itemId) }] : await recipesOf(client, organizationId, itemId);
    for (const revision of revisions) {
      const children = (await client.query(`SELECT component_item_id, child_bom_revision_id FROM tenant.manufacturing_bom_lines WHERE revision_id = $1`, [revision.id])).rows;
      for (const child of children) {
        const found = await visit(child.component_item_id, [...path, child.component_item_id]);
        if (found) return found;
      }
    }
    return null;
  };
  for (const itemId of componentItemIds) {
    const found = await visit(itemId, [itemId]);
    if (found) return found;
  }
  return null;
}

// Every problem with a revision: { issues: [{ severity: "error" | "warning", code, message, lineNumber? }], valid }. Errors block submitting,
// approving and activating; warnings (a material used on two lines, a material that is not stocked) are shown.
export async function validateRevisionContent(client, organizationId, revision, lines) {
  const issues = [];
  const error = (code, message, lineNumber) => issues.push({ severity: "error", code, message: message ?? MESSAGES[code], ...(lineNumber ? { lineNumber } : {}) });
  const warning = (code, message, lineNumber) => issues.push({ severity: "warning", code, message, ...(lineNumber ? { lineNumber } : {}) });
  const finished = revision.finished_item_id ? await loadItem(client, organizationId, revision.finished_item_id) : null;
  if (!finished) error("MFG_BOM_PRODUCT_REQUIRED");
  else if (finished.item_type !== "product" || finished.is_variant_template || !finished.track_inventory)
    error("MFG_BOM_PRODUCT_INVALID", `${finished.code} · ${finished.name} is not a stocked product, so it cannot be manufactured from a BOM.`);
  else if (finished.status !== "active" || finished.lifecycle_status === "inactive") error("MFG_BOM_PRODUCT_INVALID", `${finished.code} · ${finished.name} is inactive.`);
  if (!(D(revision.output_quantity) > ZERO)) error("MFG_BOM_OUTPUT_INVALID");
  else if (finished) {
    const output = await normalizeQuantityToBase(client, organizationId, finished.id, revision.output_uom_id, out(D(revision.output_quantity)), { allowInactive: true });
    if (!output.ok) error(output.reason === "no_conversion" || output.reason === "unit_not_found" ? "MFG_BOM_UOM_INVALID" : "MFG_BOM_OUTPUT_INVALID", `Output: ${output.message}`);
  }
  const yieldPct = D(revision.expected_yield_pct ?? 100);
  if (!(yieldPct > ZERO && yieldPct <= HUNDRED)) error("MFG_BOM_YIELD_INVALID");
  if (revision.batch_size !== null && revision.batch_size !== undefined && !(D(revision.batch_size) > ZERO)) error("MFG_BOM_BATCH_REQUIRED", "The batch size must be more than zero.");
  if (revision.effective_from && revision.effective_to && new Date(revision.effective_to) <= new Date(revision.effective_from)) error("MFG_BOM_DATES_INVALID");
  if (!lines.length) error("MFG_BOM_COMPONENT_REQUIRED");
  const seen = new Map();
  const pinned = new Map();
  for (const line of lines) {
    const n = Number(line.line_number);
    const item = await loadItem(client, organizationId, line.component_item_id);
    if (!item) { error("MFG_BOM_COMPONENT_INVALID", `Line ${n}: the material was not found.`, n); continue; }
    const label = `Line ${n} (${item.code})`;
    if (!ELIGIBLE_COMPONENT.has(item.item_type) || item.is_variant_template) error("MFG_BOM_COMPONENT_INVALID", `${label}: ${item.item_type === "service" ? "a service" : "a variant template"} cannot be a material.`, n);
    else if (item.status !== "active" || item.lifecycle_status === "inactive") error("MFG_BOM_COMPONENT_INVALID", `${label}: ${item.name} is inactive.`, n);
    if (!item.track_inventory) warning("MFG_BOM_COMPONENT_NOT_STOCKED", `${label}: ${item.name} is not stocked, so availability cannot be checked.`, n);
    if (finished && item.id === finished.id) error("MFG_BOM_CIRCULAR_REFERENCE", `${label}: a product cannot be a material of itself.`, n);
    if (!(D(line.quantity) > ZERO)) error("MFG_BOM_QTY_INVALID", `${label}: enter a quantity more than zero.`, n);
    else {
      const unit = await normalizeQuantityToBase(client, organizationId, item.id, line.uom_id, out(D(line.quantity)), { allowInactive: true });
      if (!unit.ok) {
        const code = unit.reason === "no_conversion" ? "MFG_BOM_CONVERSION_MISSING" : unit.reason === "unit_not_found" ? "MFG_BOM_UOM_INVALID" : "MFG_BOM_QTY_INVALID";
        error(code, `${label}: ${unit.message}`, n);
      }
    }
    const scrap = D(line.scrap_allowance_pct ?? 0);
    if (scrap < ZERO || scrap > decimal(500)) error("MFG_BOM_SCRAP_INVALID", `${label}: ${MESSAGES.MFG_BOM_SCRAP_INVALID}`, n);
    if (line.consumption_mode === "FIXED_PER_BATCH" && !(revision.batch_size && D(revision.batch_size) > ZERO)) error("MFG_BOM_BATCH_REQUIRED", `${label}: ${MESSAGES.MFG_BOM_BATCH_REQUIRED}`, n);
    if (line.child_bom_revision_id) {
      const child = (await client.query(
        `SELECT revision.status, revision.revision_number, master.finished_item_id, master.bom_number FROM tenant.manufacturing_bom_revisions revision
           JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id WHERE revision.organization_id = $1 AND revision.id = $2`,
        [organizationId, line.child_bom_revision_id])).rows[0];
      if (!child || child.finished_item_id !== item.id) error("MFG_BOM_COMPONENT_INVALID", `${label}: the subassembly recipe is not a recipe of ${item.name}.`, n);
      else if (!["APPROVED", "ACTIVE", "SUPERSEDED"].includes(child.status))
        error("MFG_BOM_CHILD_NOT_APPROVED", `${label}: ${child.bom_number} revision ${child.revision_number} is ${child.status.toLowerCase().replace("_", " ")}. ${MESSAGES.MFG_BOM_CHILD_NOT_APPROVED}`, n);
      else pinned.set(item.id, line.child_bom_revision_id);
    }
    if (seen.has(item.id)) warning("MFG_BOM_DUPLICATE_COMPONENT", `${label}: ${item.name} is also on line ${seen.get(item.id)}; both lines are counted.`, n);
    else seen.set(item.id, n);
  }
  if (finished && lines.length) {
    const cycle = await cycleThrough(client, organizationId, finished.id, [...new Set(lines.map((line) => line.component_item_id))], pinned);
    if (cycle) {
      const names = (await client.query(`SELECT id, code FROM tenant.items WHERE id = ANY($1::uuid[])`, [cycle])).rows;
      const code = (id) => names.find((row) => row.id === id)?.code ?? "?";
      error("MFG_BOM_CIRCULAR_REFERENCE", `${MESSAGES.MFG_BOM_CIRCULAR_REFERENCE} ${finished.code} → ${cycle.map(code).join(" → ")}.`);
    }
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}

// ------------------------------------------------------------------ explosion
// policy: "MANUFACTURE_REQUIRED_SUBASSEMBLIES" (default: a subassembly with a recipe is made, its materials counted) or
// "USE_STOCKED_SUBASSEMBLIES" (a subassembly is consumed from stock). choices: { [itemId]: "MAKE" | "USE_STOCK" | { useFromStock } } — the
// planner's explicit decision per subassembly; a subassembly is either consumed from stock or made, never both for the same units.
export async function explodeRevision(client, organizationId, revisionId, input = {}) {
  const policy = input.policy === "USE_STOCKED_SUBASSEMBLIES" ? "USE_STOCKED_SUBASSEMBLIES" : "MANUFACTURE_REQUIRED_SUBASSEMBLIES";
  const choices = input.choices && typeof input.choices === "object" ? input.choices : {};
  const at = input.at ?? null;
  const consumed = new Map();
  const manufactured = [];
  const lines = [];
  const issues = [];
  const childRevisions = [];

  const explode = async (revision, plannedBase, level, path) => {
    const revisionLines = await loadLines(client, organizationId, revision.id);
    const finished = await loadItem(client, organizationId, revision.finished_item_id);
    // The planned output in the recipe's output unit, then the nominal production quantity the expected yield needs (whole units for a
    // count unit), and the number of batches.
    const outputUnit = await resolveItemUnit(client, organizationId, finished.id, revision.output_uom_id, { allowInactive: true });
    if (!outputUnit.ok) throw bomError(409, "MFG_BOM_UOM_INVALID", `${finished.code}: ${outputUnit.message}`);
    const factor = D(outputUnit.unit.factor);
    const plannedInOutput = div(plannedBase, factor);
    const yieldPct = D(revision.expected_yield_pct);
    let nominal = yieldPct === HUNDRED ? plannedInOutput : div(mul(plannedInOutput, HUNDRED), yieldPct);
    nominal = ceilTo(nominal, Number(outputUnit.unit.decimals ?? 6));
    const batchSize = revision.batch_size === null ? null : D(revision.batch_size);
    const batches = batchSize ? ceilTo(div(nominal, batchSize), 0) / SCALE : 1n;
    const ratio = div(nominal, D(revision.output_quantity));
    for (const line of revisionLines) {
      const component = await loadItem(client, organizationId, line.component_item_id);
      const unit = await resolveItemUnit(client, organizationId, component.id, line.uom_id, { allowInactive: true });
      if (!unit.ok) throw bomError(409, "MFG_BOM_CONVERSION_MISSING", `${component.code}: ${unit.message}`);
      const base = line.consumption_mode === "FIXED_PER_BATCH" ? mul(D(line.quantity), batches * SCALE) : mul(D(line.quantity), ratio);
      const allowance = D(line.scrap_allowance_pct);
      const withAllowance = allowance === ZERO ? base : mul(base, div(add(HUNDRED, allowance), HUNDRED));
      const requiredBase = ceilTo(mul(withAllowance, D(unit.unit.factor)), Number(component.uom_decimals ?? 6));
      const linePath = [...path, `${line.line_number}`];
      if (path.includes(component.id)) throw bomError(409, "MFG_BOM_CIRCULAR_REFERENCE", `${MESSAGES.MFG_BOM_CIRCULAR_REFERENCE} (${component.code})`);
      const childRevisionId = line.child_bom_revision_id ?? await resolveEffectiveBom(client, organizationId, component.id, at);
      const entry = { level, path: linePath.join("."), lineId: line.id, lineageId: line.lineage_id, lineNumber: Number(line.line_number), parentItemId: finished.id, parentCode: finished.code,
        itemId: component.id, code: component.code, name: component.name, trackingType: component.tracking_type, baseUomId: component.uom_id, baseUom: component.uom_code,
        quantity: out(D(line.quantity)), uom: line.uom_code, mode: line.consumption_mode, scrapAllowancePct: out(allowance),
        beforeAllowance: out(ceilTo(mul(base, D(unit.unit.factor)), 6)), required: out(requiredBase), kind: childRevisionId ? "subassembly" : "material", conversionToBase: unit.unit.factor };
      lines.push(entry);
      let makeBase = ZERO;
      if (childRevisionId) {
        const choice = choices[component.id];
        const useAll = choice === "USE_STOCK" || (choice === undefined && policy === "USE_STOCKED_SUBASSEMBLIES");
        const fromStock = useAll ? requiredBase : choice && typeof choice === "object" && choice.useFromStock !== undefined
          ? (D(choice.useFromStock) > requiredBase ? requiredBase : (D(choice.useFromStock) < ZERO ? ZERO : D(choice.useFromStock))) : ZERO;
        makeBase = sub(requiredBase, fromStock);
        entry.fromStock = out(fromStock);
        entry.toMake = out(makeBase);
        entry.decision = useAll ? "USE_STOCK" : makeBase === requiredBase ? "MAKE" : "PARTIAL";
        if (fromStock > ZERO) addConsumed(consumed, component, fromStock, "subassembly");
        if (makeBase > ZERO) {
          const child = await loadRevision(client, organizationId, childRevisionId);
          if (!["APPROVED", "ACTIVE", "SUPERSEDED"].includes(child.status)) {
            issues.push({ severity: "error", code: "MFG_BOM_CHILD_NOT_APPROVED", message: `${component.code}: ${MESSAGES.MFG_BOM_CHILD_NOT_APPROVED}` });
          } else {
            entry.childRevisionId = child.id;
            entry.childBom = `${child.bom_number} rev ${child.revision_number}`;
            childRevisions.push({ itemId: component.id, revisionId: child.id, bomNumber: child.bom_number, revisionNumber: child.revision_number });
            manufactured.push({ itemId: component.id, code: component.code, name: component.name, quantity: out(makeBase), baseUom: component.uom_code, revision: `${child.bom_number} rev ${child.revision_number}`, level: level + 1 });
            await explode(child, makeBase, level + 1, [...path, component.id]);
          }
        }
      } else {
        addConsumed(consumed, component, requiredBase, "material");
      }
    }
    return { nominal, batches, ratio };
  };

  const revision = await loadRevision(client, organizationId, revisionId);
  const finished = await loadItem(client, organizationId, revision.finished_item_id);
  const plannedUom = input.uomId || revision.output_uom_id;
  const planned = await normalizeQuantityToBase(client, organizationId, finished.id, plannedUom, String(input.plannedQuantity ?? revision.output_quantity), { allowInactive: true });
  if (!planned.ok) throw bomError(400, "MFG_BOM_OUTPUT_INVALID", `Planned quantity: ${planned.message}`);
  if (!(planned.baseQuantity > ZERO)) throw bomError(400, "MFG_BOM_OUTPUT_INVALID");
  const top = await explode(revision, planned.baseQuantity, 1, [finished.id]);
  return {
    revisionId: revision.id, bomId: revision.bom_id, bomNumber: revision.bom_number, revisionNumber: revision.revision_number, status: revision.status,
    finishedItem: { id: finished.id, code: finished.code, name: finished.name, baseUom: finished.uom_code },
    plannedQuantity: out(planned.quantity), plannedUom: planned.unit.code, plannedUomId: planned.unit.uomId, plannedBaseQuantity: out(planned.baseQuantity),
    nominalQuantity: out(top.nominal), batches: Number(top.batches), expectedYieldPct: out(D(revision.expected_yield_pct)), batchSize: revision.batch_size === null ? null : out(D(revision.batch_size)),
    policy, choices, lines, manufactured, childRevisions,
    consumed: [...consumed.values()].map((row) => ({ ...row, required: out(row.required) })),
    assumptions: [
      `Expected yield ${out(D(revision.expected_yield_pct))}%: ${out(planned.quantity)} ${planned.unit.code} good output needs ${out(top.nominal)} produced.`,
      revision.batch_size ? `Batch size ${out(D(revision.batch_size))}: ${top.batches} batch(es) for fixed-per-batch materials.` : "No batch size: fixed-per-batch materials are not used.",
      "Extra-material allowance is added once to each line's base quantity; required quantities are rounded up to each material's unit precision.",
      policy === "USE_STOCKED_SUBASSEMBLIES" ? "Subassemblies are consumed from stock unless you choose to make them." : "Subassemblies with an effective recipe are made, unless you choose to use stock.",
    ],
    issues,
  };
}

function addConsumed(map, component, quantityBase, kind) {
  const row = map.get(component.id) ?? { itemId: component.id, code: component.code, name: component.name, baseUom: component.uom_code, trackingType: component.tracking_type,
    kind, required: ZERO };
  row.required += quantityBase;
  map.set(component.id, row);
}

// ------------------------------------------------------------------ availability and cost
const stockContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.view"])] });

// Free stock (eligible on hand less reservations; quarantined and held stock excluded) of each consumed material, at a warehouse or across
// the warehouses the person may see.
export async function availabilityOf(client, c, explosion, warehouseId = null) {
  const checkedAt = new Date().toISOString();
  const rows = [];
  for (const row of explosion.consumed) {
    let available = null;
    try {
      const breakdown = await getAvailabilityBreakdown(client, stockContext(c), { itemId: row.itemId, warehouseId });
      available = decimal(String(breakdown.total.available));
    } catch {
      available = null;
    }
    const required = D(row.required);
    rows.push({ ...row, available: available === null ? null : out(available), shortage: available === null ? null : out(required > available ? sub(required, available) : ZERO),
      status: available === null ? "unknown" : required <= available ? "available" : "short" });
  }
  return { checkedAt, warehouseId, lines: rows, hasShortages: rows.some((row) => row.status === "short"), unknown: rows.some((row) => row.status === "unknown") };
}

// The estimated cost of one base unit of an item: the warehouse's valuation rate, else the company's average valuation, else the item's
// standard cost — never a selling price. Null when there is none.
async function unitCostOf(client, organizationId, item, warehouseId, staleAfterDays, rates = null) {
  const cacheKey = `${item.id}:${warehouseId ?? ""}`;
  if (rates?.has(cacheKey)) return rates.get(cacheKey);
  const result = await lookUpUnitCost(client, organizationId, item, warehouseId, staleAfterDays);
  rates?.set(cacheKey, result);
  return result;
}
async function lookUpUnitCost(client, organizationId, item, warehouseId, staleAfterDays) {
  let rate = null;
  let basis = null;
  if (warehouseId) {
    const value = await currentValuationRate(client, organizationId, warehouseId, item.id);
    if (value > 0) { rate = decimal(String(value)); basis = "Warehouse valuation"; }
  }
  if (rate === null) {
    const row = (await client.query(
      `SELECT CASE WHEN sum(base_quantity) > 0 THEN sum(inventory_value) / sum(base_quantity) ELSE max(moving_average_cost) END AS rate
         FROM tenant.inventory_valuation_balances WHERE organization_id = $1 AND item_id = $2`, [organizationId, item.id])).rows[0];
    if (row?.rate !== null && row?.rate !== undefined && Number(row.rate) > 0) { rate = decimal(Number(row.rate).toFixed(6)); basis = "Average valuation"; }
  }
  if (rate === null && Number(item.standard_cost) > 0) { rate = D(item.standard_cost); basis = "Standard cost"; }
  if (rate === null) return { rate: null, basis: null, stale: false, asOf: null };
  const last = (await client.query(`SELECT max(created_at) AS at FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND item_id = $2`, [organizationId, item.id])).rows[0]?.at ?? null;
  const stale = basis !== "Standard cost" && last !== null && (Date.now() - new Date(last).getTime()) > staleAfterDays * 86_400_000;
  return { rate, basis, stale, asOf: last };
}

// Material cost of what the explosion consumes (made subassemblies are costed by their own materials, never twice), per material and per
// finished unit. Missing costs are listed and never counted as zero. `rates` (a Map) shares unit costs between estimates, so two revisions
// compared are priced on the same basis at the same moment.
export async function estimateCost(client, c, explosion, warehouseId = null, rates = null) {
  const settings = (await client.query(`SELECT bom_cost_stale_after_days FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const staleAfterDays = Number(settings?.bom_cost_stale_after_days ?? 90);
  const lines = [];
  let total = ZERO;
  for (const row of explosion.consumed) {
    const item = await loadItem(client, c.organizationId, row.itemId);
    const cost = await unitCostOf(client, c.organizationId, item, warehouseId, staleAfterDays, rates);
    const amount = cost.rate === null ? null : mul(D(row.required), cost.rate);
    if (amount !== null) total += amount;
    lines.push({ itemId: row.itemId, code: row.code, name: row.name, kind: row.kind, required: row.required, baseUom: row.baseUom, unitCost: cost.rate === null ? null : out(cost.rate, 6),
      amount: amount === null ? null : formatDecimal(amount, 2), basis: cost.basis, costAsOf: cost.asOf, stale: cost.stale, missing: cost.rate === null });
  }
  const missing = lines.filter((line) => line.missing);
  const planned = D(explosion.plannedQuantity);
  return {
    calculatedAt: new Date().toISOString(), currency: "INR", lines, totalMaterialCost: formatDecimal(total, 2), perUnit: planned > ZERO ? formatDecimal(div(total, planned), 2) : null,
    complete: missing.length === 0, missing: missing.map((line) => line.code), stale: lines.filter((line) => line.stale).map((line) => line.code),
    warnings: [
      ...(missing.length ? [`${MESSAGES.MFG_BOM_COST_MISSING} (${missing.map((line) => line.code).join(", ")}) — the total is incomplete.`] : []),
      ...(lines.some((line) => line.stale) ? [`Costs older than ${staleAfterDays} days: ${lines.filter((line) => line.stale).map((line) => line.code).join(", ")}.`] : []),
    ],
    note: "Estimated material cost only: labour and overhead are not included, and nothing is posted.",
  };
}

// ------------------------------------------------------------------ comparison
// What changed between two revisions of one BOM: header values, and each line added, removed, modified or unchanged. Lines are paired by
// lineage (a copied line keeps its lineage), then — only where it is unambiguous, one line of that material on each side — by material; a
// material on two lines stays two lines. Quantities are also compared in the material's base unit, so a unit or conversion change shows.
export async function compareRevisions(client, organizationId, fromRevisionId, toRevisionId) {
  const [from, to] = [await loadRevision(client, organizationId, fromRevisionId), await loadRevision(client, organizationId, toRevisionId)];
  if (from.bom_id !== to.bom_id) throw bomError(400, "MFG_BOM_REV_SOURCE_INVALID", "Compare two revisions of the same BOM.");
  const [fromLines, toLines] = [await loadLines(client, organizationId, from.id), await loadLines(client, organizationId, to.id)];
  const units = new Map((await client.query(`SELECT id, code FROM tenant.units_of_measure WHERE id = ANY($1::uuid[])`, [[from.output_uom_id, to.output_uom_id]])).rows.map((row) => [row.id, row.code]));
  const header = [];
  const headerValue = (revision, key) => {
    const value = revision[key];
    if (value === null || value === undefined) return null;
    if (key === "description") return value;
    if (key === "output_uom_id") return units.get(value) ?? value;
    return out(D(value));
  };
  for (const [label, key] of [["Output quantity", "output_quantity"], ["Output unit", "output_uom_id"], ["Expected yield %", "expected_yield_pct"], ["Batch size", "batch_size"], ["Instructions", "description"]]) {
    const a = headerValue(from, key);
    const b = headerValue(to, key);
    if (a !== b) header.push({ field: label, from: a, to: b });
  }
  const view = async (line) => {
    const unit = await resolveItemUnit(client, organizationId, line.component_item_id, line.uom_id, { allowInactive: true });
    return { lineId: line.id, lineNumber: line.line_number, quantity: out(D(line.quantity)), uom: line.uom_code, baseQuantity: unit.ok ? out(mul(D(line.quantity), D(unit.unit.factor))) : null,
      mode: line.consumption_mode, scrapAllowancePct: out(D(line.scrap_allowance_pct)), childRevisionId: line.child_bom_revision_id ?? null,
      childRevision: line.child_bom_number ? `${line.child_bom_number} rev ${line.child_revision_number}` : null, notes: line.notes ?? null };
  };
  const pairs = [];
  const left = new Map(fromLines.map((line) => [line.id, line]));
  const unpaired = [];
  for (const line of toLines) {
    const match = fromLines.find((candidate) => left.has(candidate.id) && candidate.lineage_id === line.lineage_id && candidate.component_item_id === line.component_item_id);
    if (match) { pairs.push({ before: match, after: line, matchedBy: "lineage" }); left.delete(match.id); } else unpaired.push(line);
  }
  const added = [];
  for (const line of unpaired) {
    const sameItemLeft = [...left.values()].filter((candidate) => candidate.component_item_id === line.component_item_id);
    const sameItemRight = unpaired.filter((candidate) => candidate.component_item_id === line.component_item_id);
    if (sameItemLeft.length === 1 && sameItemRight.length === 1) { pairs.push({ before: sameItemLeft[0], after: line, matchedBy: "material" }); left.delete(sameItemLeft[0].id); }
    else added.push(line);
  }
  const FIELDS = ["quantity", "uom", "baseQuantity", "mode", "scrapAllowancePct", "childRevisionId", "notes"];
  const changes = [];
  const entry = (line, change, extra) => ({ itemId: line.component_item_id, code: line.item_code, name: line.item_name, lineageId: line.lineage_id, matchedBy: null, change, fields: [],
    childRevisionChanged: false, from: null, to: null, ...extra });
  for (const pair of pairs) {
    const [before, after] = [await view(pair.before), await view(pair.after)];
    const fields = FIELDS.filter((key) => before[key] !== after[key]);
    changes.push(entry(pair.after, fields.length ? "changed" : "unchanged", { matchedBy: pair.matchedBy, fields, childRevisionChanged: fields.includes("childRevisionId"), from: before, to: after }));
  }
  for (const line of added) changes.push(entry(line, "added", { to: await view(line) }));
  for (const line of left.values()) changes.push(entry(line, "removed", { from: await view(line) }));
  const order = ["added", "removed", "changed", "unchanged"];
  changes.sort((x, y) => (order.indexOf(x.change) - order.indexOf(y.change)) || x.code.localeCompare(y.code) || ((x.to ?? x.from).lineNumber - (y.to ?? y.from).lineNumber));
  const count = (kind) => changes.filter((row) => row.change === kind).length;
  const side = (revision) => ({ id: revision.id, revisionNumber: revision.revision_number, status: revision.status, effectiveFrom: revision.effective_from, effectiveTo: revision.effective_to,
    changeReason: revision.change_reason });
  return { bomId: from.bom_id, bomNumber: from.bom_number, from: side(from), to: side(to), header, lines: changes,
    summary: { added: count("added"), removed: count("removed"), changed: count("changed"), unchanged: count("unchanged") } };
}
