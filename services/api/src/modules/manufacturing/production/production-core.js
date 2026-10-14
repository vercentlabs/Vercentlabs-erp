// Partial Production — the shared core: permissions, errors, the authorized output target, a production entry's own figures (reported,
// accepted, rejected, awaiting inspection, received, corrected — all from its posted record and its quality decisions), and material
// readiness for cumulative output (the BOM exploded for everything reported so far plus the next batch, against what is issued and reserved —
// so fixed-per-batch material is never counted once per entry).
import { normalizeQuantityToBase } from "../../products/uom.js";
import { explodeRevision } from "../boms/bom-engine.js";
import {
  D, MO, MoError, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, loadOrder, max, mul, q, reservedByItem, reservedPerLine, settingsOf, sub, text, uuid,
} from "../orders/mo-core.js";
import { heldRefusal } from "../holds/hold-core.js";

export const PRODUCTION = Object.freeze({ editDraft: "manufacturing.production.edit_draft", post: "manufacturing.production.post", correct: "manufacturing.production.correct",
  export: "manufacturing.production.export" });
export const ENTRY_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", REPORTED: "Reported", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Recovery required" });
export const DISPOSITIONS = new Set(["QUARANTINE", "SCRAP", "REWORK"]);

const MESSAGES = Object.freeze({
  MFG_PARTIAL_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_PARTIAL_MO_STATUS_INVALID: "Production cannot be recorded in this order's current status.",
  MFG_PARTIAL_NOT_FOUND: "The production entry was not found.",
  MFG_PARTIAL_QTY_INVALID: "Enter a valid produced quantity.",
  MFG_PARTIAL_UOM_INVALID: "The selected unit of measurement is not valid.",
  MFG_PARTIAL_MATERIAL_NOT_READY: "Required materials are not ready for this production batch.",
  MFG_PARTIAL_BATCH_INVALID: "Select a valid production batch.",
  MFG_PARTIAL_OUTPUT_EXCEEDS: "Production exceeds the allowed output.",
  MFG_PARTIAL_APPROVAL_REQUIRED: "A manager must approve the additional production.",
  MFG_PARTIAL_QUALITY_EXCEEDS: "Inspection quantity exceeds remaining uninspected output.",
  MFG_PARTIAL_RECEIPT_EXCEEDS: "The requested receipt exceeds accepted, unreceived goods.",
  MFG_PARTIAL_BATCH_TRACKING_REQUIRED: "Enter the required finished-goods batch details.",
  MFG_PARTIAL_SERIAL_INVALID: "One or more finished-goods serial numbers are invalid or already used.",
  MFG_PARTIAL_ENTRY_ALREADY_POSTED: "This production entry is already recorded.",
  MFG_PARTIAL_SOURCE_CHANGED: "Manufacturing Order information changed. Review and retry.",
  MFG_PARTIAL_CORRECTION_RESTRICTED: "The production record has downstream stock or accounting effects.",
  MFG_PARTIAL_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_PARTIAL_REASON_REQUIRED: "Give a reason.",
  MFG_PARTIAL_STATE_INVALID: "This action is not available in the entry's current status.",
});
export const productionError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needProduction = (c, permission) => { if (!has(c, permission)) throw productionError(403, "MFG_PARTIAL_PERMISSION_DENIED"); };

export async function loadProductionOrder(client, c, orderId, options) {
  try { return await loadOrder(client, c, orderId, options); } catch (error) {
    if (error.code === "MFG_MO_NOT_FOUND") throw productionError(404, "MFG_PARTIAL_MO_NOT_FOUND");
    throw error;
  }
}
export async function loadEntry(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Production entry")])).rows[0];
  if (!row) throw productionError(404, "MFG_PARTIAL_NOT_FOUND");
  return row;
}
export function requireProducing(order, { drafts = false } = {}) {
  const held = heldRefusal(order, drafts ? "batch" : "produce");
  if (held) throw productionError(409, "MFG_PARTIAL_MO_STATUS_INVALID", held);
  const allowed = drafts ? ["RELEASED", "IN_PROGRESS"] : ["IN_PROGRESS"];
  if (!allowed.includes(order.status)) {
    throw productionError(409, "MFG_PARTIAL_MO_STATUS_INVALID", order.status === "RELEASED"
      ? `${order.mo_number} is released: start production before reporting output.`
      : `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: production is recorded while an order is ${drafts ? "released or " : ""}in progress.`);
  }
}

// The most good output the order may accept: the plan, its tolerance and any approved overproduction allowance.
export function authorizedTarget(order, settings) {
  const planned = D(order.planned_base_quantity);
  return add(add(planned, div(mul(planned, settings.tolerancePct), 100n * 1_000_000n)), D(order.overproduction_allowance_quantity ?? 0));
}

// An entry's figures from its own record and its quality decisions.
export async function decisionsOf(client, c, entryIds) {
  if (!entryIds.length) return new Map();
  const rows = (await client.query(`SELECT production_entry_id, COALESCE(sum(accepted_quantity), 0) AS accepted, COALESCE(sum(rejected_quantity), 0) AS rejected, count(*)::int AS decisions
      FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND production_entry_id = ANY($2::uuid[]) GROUP BY 1`, [c.organizationId, entryIds])).rows;
  return new Map(rows.map((row) => [row.production_entry_id, { accepted: D(row.accepted), rejected: D(row.rejected), decisions: row.decisions }]));
}
export function entryFigures(entry, decided = { accepted: ZERO, rejected: ZERO, decisions: 0 }) {
  const correctedPending = D(entry.corrected_pending_quantity ?? 0);
  const correctedAccepted = D(entry.corrected_accepted_quantity ?? 0);
  // Quality corrections after finalization move output between accepted and rejected (Production Quality Inspection, 0120).
  const movedToRejected = D(entry.quality_moved_to_rejected ?? 0);
  const movedToAccepted = D(entry.quality_moved_to_accepted ?? 0);
  const accepted = sub(add(sub(add(D(entry.accepted_quantity), decided.accepted), correctedAccepted), movedToAccepted), movedToRejected);
  const rejected = sub(add(add(D(entry.rejected_quantity), decided.rejected), movedToRejected), movedToAccepted);
  const pending = D(entry.pending_remaining);
  const reported = sub(sub(D(entry.reported_quantity), correctedPending), correctedAccepted);
  // Net received: receipts less what approved receipt reversals took back (Finished-Goods Receipt).
  const received = sub(D(entry.received_quantity ?? 0), D(entry.receipt_reversed_quantity ?? 0));
  // Rejected output disposed of as scrap (net of reversals) and what is still undisposed (Scrap, 0119).
  const scrapped = sub(D(entry.output_scrapped_quantity ?? 0), D(entry.output_scrap_reversed_quantity ?? 0));
  return { reported, accepted, rejected, pending, received, receivable: max(sub(accepted, received), ZERO), held: D(entry.quality_hold_quantity ?? 0), scrapped, undisposed: max(sub(rejected, scrapped), ZERO), correctedPending, correctedAccepted, decisions: decided.decisions,
    inspection: pending > ZERO ? (accepted > ZERO || rejected > ZERO ? "PARTIALLY_INSPECTED" : "PENDING") : rejected > ZERO && accepted === ZERO ? "REJECTED" : accepted > ZERO && rejected > ZERO ? "PARTIALLY_ACCEPTED" : accepted > ZERO ? "ACCEPTED" : "NONE",
    receipt: accepted === ZERO ? "NONE" : received === ZERO ? "NOT_RECEIVED" : received < accepted ? "PARTIALLY_RECEIVED" : "RECEIVED" };
}

// The output quantity as entered (in the order's output unit unless another is named), in the finished item's base unit.
export async function outputQuantity(client, c, order, raw, uomId) {
  const value = String(raw ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(value) || !(Number(value) > 0)) throw productionError(400, "MFG_PARTIAL_QTY_INVALID");
  // undefined: the order's output unit; null: the finished item's base unit (corrections, batch plans and allowances are counted in it).
  const unit = uomId === null ? (await client.query(`SELECT uom_id FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0]?.uom_id : uomId ?? order.output_uom_id;
  const converted = await normalizeQuantityToBase(client, c.organizationId, order.finished_item_id, unit, value, {});
  if (!converted.ok) {
    throw productionError(400, ["quantity_invalid", "precision", "serial_fraction", "base_precision"].includes(converted.reason) ? "MFG_PARTIAL_QTY_INVALID" : "MFG_PARTIAL_UOM_INVALID", converted.message);
  }
  return { entered: value, uomId: converted.unit.uomId, factor: converted.factor, base: converted.baseQuantity };
}

// How the reported quantity splits: accepted, rejected, awaiting inspection. With inspection required, everything waits for it.
export function splitOf(reported, input, settings) {
  const given = ["acceptedQuantity", "rejectedQuantity", "pendingQuantity"].some((field) => input[field] !== undefined && input[field] !== null && input[field] !== "");
  const part = (field) => (input[field] === undefined || input[field] === null || input[field] === "" ? ZERO : D(String(input[field])));
  let accepted = given ? part("acceptedQuantity") : settings.requireInspection ? ZERO : reported;
  const rejected = given ? part("rejectedQuantity") : ZERO;
  let pending = given ? part("pendingQuantity") : settings.requireInspection ? reported : ZERO;
  if (given && (input.pendingQuantity === undefined || input.pendingQuantity === null || input.pendingQuantity === "") && input.acceptedQuantity !== undefined) pending = sub(reported, add(accepted, rejected));
  if (given && (input.acceptedQuantity === undefined || input.acceptedQuantity === null || input.acceptedQuantity === "") && input.pendingQuantity !== undefined) accepted = sub(reported, add(pending, rejected));
  if (accepted < ZERO || rejected < ZERO || pending < ZERO || add(add(accepted, rejected), pending) !== reported) {
    throw productionError(400, "MFG_PARTIAL_QTY_INVALID", "Accepted, rejected and awaiting inspection must add up to the quantity reported.");
  }
  if (settings.requireInspection && accepted > ZERO) throw new MoError(409, "MFG_MO_INSPECTION_REQUIRED", "Every unit produced waits for a quality decision before it is accepted.");
  const reason = text(input.rejectionReason, 500) || null;
  if (rejected > ZERO && (!reason || reason.length < 3)) throw productionError(400, "MFG_PARTIAL_REASON_REQUIRED", "Say why output was rejected.");
  return { accepted, rejected, pending, reason };
}

// Materials for cumulative output: what the BOM needs for `cumulative` units (yield, batches and allowances included) against what the order
// has issued (used, scrapped or in custody) or holds reserved — per material line. A preview for the batch alone shows its own expectation.
export async function materialReadiness(client, c, order, cumulative, batch = null) {
  if (!order.bom_revision_id) return { ready: true, lines: [], cumulative: q(cumulative) };
  const materials = await loadMaterials(client, c, order.id);
  const reserved = reservedPerLine(materials, await reservedByItem(client, c, order));
  const need = cumulative > ZERO ? (await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(cumulative), policy: "USE_STOCKED_SUBASSEMBLIES" })).consumed : [];
  const forBatch = batch && batch > ZERO ? (await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(batch), policy: "USE_STOCKED_SUBASSEMBLIES" })).consumed : [];
  const lines = [];
  for (const material of materials.filter((row) => row.origin === "RECIPE")) {
    const required = need.filter((row) => row.itemId === material.component_item_id).reduce((sum, row) => add(sum, D(row.required)), ZERO);
    const figures = lineFigures(material);
    const issued = figures.netIssued;
    const held = reserved.get(material.id) ?? ZERO;
    const available = add(issued, held);
    lines.push({ materialId: material.id, code: material.item_code, name: material.item_name, uom: material.uom_code, requiredForCumulative: q(required),
      batchExpected: forBatch.length ? q(forBatch.filter((row) => row.itemId === material.component_item_id).reduce((sum, row) => add(sum, D(row.required)), ZERO)) : null,
      issued: q(issued), consumed: q(figures.consumed), inCustody: q(max(figures.custody, ZERO)), reserved: q(held), short: q(max(sub(required, available), ZERO)),
      status: required <= issued ? "ISSUED" : required <= available ? "RESERVED" : "SHORT" });
  }
  return { ready: lines.every((row) => row.status !== "SHORT"), staged: lines.every((row) => row.status === "ISSUED"), lines, cumulative: q(cumulative) };
}

export async function productionSettings(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT mo_production_material_check FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { ...settings, materialCheck: row?.mo_production_material_check ?? "WARN" };
}

export { D, MO, STATUS_LABEL, ZERO, add, has, max, q, sub, text, uuid };
