// Manufacturing Scrap — the shared core: permissions, errors, the scrap note and its lines, which orders may scrap, the sources (issued material
// still in production custody, per batch and serial unit; rejected output not yet disposed of, per production entry), the lines as entered
// checked against them, the destination of recoverable scrap, the value the scrap carries, the company's approval policy and the content
// hash an approval binds to.
import { createHash } from "node:crypto";

import { normalizeQuantityToBase } from "../../products/uom.js";
import { custodyOf } from "../consumption/consumption-core.js";
import { MoError, STATUS_LABEL, div, lineFigures, loadMaterials, money, mul, settingsOf, unitMaterialCost, wipBalance } from "../orders/mo-core.js";
import { D, ZERO, add, decisionsOf, entryFigures, has, loadProductionOrder, max, outputQuantity, q, sub, text, uuid } from "../production/production-core.js";

export const SCRAP = Object.freeze({
  view: "manufacturing.scrap.view", create: "manufacturing.scrap.create", editDraft: "manufacturing.scrap.edit_draft", submit: "manufacturing.scrap.submit",
  approve: "manufacturing.scrap.approve", post: "manufacturing.scrap.post", correct: "manufacturing.scrap.correct", export: "manufacturing.scrap.export", costView: "manufacturing.scrap.cost_view",
});
export const SCRAP_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", POSTING: "Posting", POSTED: "Posted", CANCELLED: "Cancelled",
  RECOVERY_REQUIRED: "Recovery required" });
export const REASONS = Object.freeze({ DAMAGED_DURING_PRODUCTION: "Damaged during production", MANUFACTURING_DEFECT: "Manufacturing defect", CONTAMINATION: "Contamination / unusable",
  PROCESS_LOSS: "Process loss", MACHINE_FAILURE: "Machine failure", HANDLING_DAMAGE: "Handling damage", EXPIRED: "Expired", QUALITY_REJECTION: "Rejected by quality", OTHER: "Other" });
export const UNPOSTED = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED"]);
export const isoDay = (value) => {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const MESSAGES = Object.freeze({
  MFG_SCRAP_MO_INVALID: "Select a valid Manufacturing Order.",
  MFG_SCRAP_NOT_FOUND: "The scrap note was not found.",
  MFG_SCRAP_SOURCE_REQUIRED: "Select the material or production output being scrapped.",
  MFG_SCRAP_QTY_INVALID: "Enter a valid scrap quantity.",
  MFG_SCRAP_EXCEEDS_CUSTODY: "The requested quantity exceeds unused issued material.",
  MFG_SCRAP_OUTPUT_NOT_REJECTED: "This output has not been approved for scrap.",
  MFG_SCRAP_ALREADY_DISPOSED: "This quantity has already been disposed of.",
  MFG_SCRAP_BATCH_INVALID: "The selected batch is not eligible.",
  MFG_SCRAP_SERIAL_INVALID: "One or more serial numbers are invalid.",
  MFG_SCRAP_APPROVAL_REQUIRED: "A manager must approve this scrap.",
  MFG_SCRAP_APPROVAL_STALE: "Scrap details changed. Request approval again.",
  MFG_SCRAP_APPROVAL_SELF: "Someone other than the requester approves this scrap.",
  MFG_SCRAP_WAREHOUSE_INVALID: "Select an authorized location.",
  MFG_SCRAP_VALUATION_MISSING: "Scrap cost cannot be verified.",
  MFG_SCRAP_SOURCE_CHANGED: "Source quantities changed. Review the record.",
  MFG_SCRAP_ALREADY_POSTED: "This scrap has already been posted.",
  MFG_SCRAP_OUTCOME_UNKNOWN: "Checking the previous posting. Do not submit it again.",
  MFG_SCRAP_CORRECTION_BLOCKED: "The physical or financial disposition cannot be reversed directly.",
  MFG_SCRAP_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_SCRAP_REASON_REQUIRED: "Give a reason.",
  MFG_SCRAP_STATE_INVALID: "This action is not available in the scrap note's current status.",
  MFG_SCRAP_DOCUMENT_CHANGED: "The scrap note changed since it was checked. Review it and retry.",
});
export const scrapError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needScrap = (c, permission) => { if (!has(c, permission)) throw scrapError(403, "MFG_SCRAP_PERMISSION_DENIED"); };
export const canSeeScrapCost = (c) => has(c, SCRAP.costView) || has(c, "manufacturing.mo.cost_view");

export async function loadScrapOrder(client, c, orderId, options) {
  try { return await loadProductionOrder(client, c, uuid(orderId, "Manufacturing order"), options); } catch (error) {
    if (["MFG_PARTIAL_MO_NOT_FOUND", "MFG_MO_NOT_FOUND"].includes(error.code)) throw scrapError(404, "MFG_SCRAP_MO_INVALID");
    throw error;
  }
}
export async function loadScrap(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Scrap note")])).rows[0];
  if (!row) throw scrapError(404, "MFG_SCRAP_NOT_FOUND");
  return row;
}
export async function loadScrapLines(client, c, scrapId) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.tracking_type, uom.code AS uom_code, base.code AS base_uom_code, entry.entry_number, batch.batch_number,
            pbatch.batch_reference AS production_batch
       FROM tenant.manufacturing_scrap_lines line JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
       JOIN tenant.units_of_measure base ON base.id = item.uom_id LEFT JOIN tenant.manufacturing_production_entries entry ON entry.id = line.production_entry_id
       LEFT JOIN tenant.manufacturing_production_batches pbatch ON pbatch.id = entry.production_batch_id LEFT JOIN tenant.stock_batches batch ON batch.id = line.batch_id
      WHERE line.organization_id = $1 AND line.scrap_id = $2 ORDER BY line.line_number`, [c.organizationId, scrapId])).rows;
}

// Issued material can be scrapped while it is in production custody (from release until completion); rejected output once production runs.
export function requireScrappable(order, type) {
  const allowed = type === "REJECTED_OUTPUT" ? ["IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING"] : ["RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING"];
  if (allowed.includes(order.status)) return;
  throw scrapError(409, "MFG_SCRAP_MO_INVALID", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: ${type === "REJECTED_OUTPUT" ? "rejected output is scrapped while the order is in production" : "issued material is scrapped while it is in production custody"}.`);
}

export async function scrapSettings(client, c) {
  const settings = await settingsOf(client, c);
  const row = (await client.query(`SELECT scrap_approval_value_above, scrap_output_requires_approval, scrap_abnormal_requires_approval FROM tenant.manufacturing_settings WHERE organization_id = $1`,
    [c.organizationId])).rows[0] ?? {};
  return { ...settings, valueAbove: row.scrap_approval_value_above === null || row.scrap_approval_value_above === undefined ? null : D(row.scrap_approval_value_above),
    outputRequiresApproval: row.scrap_output_requires_approval ?? true, abnormalRequiresApproval: row.scrap_abnormal_requires_approval ?? true };
}

// ------------------------------------------------------------------ sources
// Rejected output per reported entry: rejected, already scrapped (net) and still undisposed, with the latest decision that rejected it.
export async function rejectedSources(client, c, order, { lock = false } = {}) {
  const rows = (await client.query(
    `SELECT entry.*, batch.batch_reference,
            (SELECT decision.id FROM tenant.manufacturing_quality_decisions decision WHERE decision.organization_id = entry.organization_id AND decision.production_entry_id = entry.id
               AND decision.rejected_quantity > 0 ORDER BY decision.decided_at DESC LIMIT 1) AS quality_decision_id,
            (SELECT COALESCE(decision.rejection_disposition, decision.disposition) FROM tenant.manufacturing_quality_decisions decision WHERE decision.organization_id = entry.organization_id
               AND decision.production_entry_id = entry.id AND decision.rejected_quantity > 0 ORDER BY decision.decided_at DESC LIMIT 1) AS quality_disposition
       FROM tenant.manufacturing_production_entries entry LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = entry.production_batch_id
      WHERE entry.organization_id = $1 AND entry.manufacturing_order_id = $2 AND entry.status IN ('REPORTED', 'RECOVERY_REQUIRED')
      ORDER BY entry.posted_at, entry.entry_number${lock ? " FOR UPDATE OF entry" : ""}`, [c.organizationId, order.id])).rows;
  const decided = await decisionsOf(client, c, rows.map((row) => row.id));
  return rows.map((row) => ({ row, figures: entryFigures(row, decided.get(row.id)) }));
}

// The lines as entered, checked against what is still there to scrap: for issued material the line's production custody (and, for a batch or
// serial unit, that identity's custody), for output the entry's rejected, undisposed quantity. Several lines on one source add up.
export async function resolveLines(client, c, order, type, input = []) {
  const requested = Array.isArray(input) ? input.filter((line) => line && (line.materialId || line.productionEntryId || line.quantity)) : [];
  if (!requested.length) throw scrapError(400, "MFG_SCRAP_SOURCE_REQUIRED");
  if (requested.length > 200) throw scrapError(400, "MFG_SCRAP_QTY_INVALID", "One scrap note holds at most 200 lines.");
  const lines = [];
  if (type === "ISSUED_MATERIAL") {
    const materials = await loadMaterials(client, c, order.id);
    const held = await custodyOf(client, c, order, materials);
    const claimed = new Map();
    for (const [index, line] of requested.entries()) {
      const material = materials.find((row) => row.id === line.materialId);
      if (!material) throw scrapError(400, "MFG_SCRAP_SOURCE_REQUIRED", `Line ${index + 1}: choose a material of ${order.mo_number}.`);
      const raw = String(line.quantity ?? "").trim();
      if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw scrapError(400, "MFG_SCRAP_QTY_INVALID", `${material.item_code}: enter a quantity more than zero.`);
      const uomId = line.uomId ? uuid(line.uomId, "Unit") : material.uom_id;
      const converted = await normalizeQuantityToBase(client, c.organizationId, material.component_item_id, uomId, raw, { purpose: "inventory" });
      if (!converted.ok) throw scrapError(400, "MFG_SCRAP_QTY_INVALID", `${material.item_code}: ${converted.message}`);
      const base = converted.baseQuantity;
      const custody = max(lineFigures(material).custody, ZERO);
      const total = add(claimed.get(material.id) ?? ZERO, base);
      if (total > custody) {
        throw scrapError(409, "MFG_SCRAP_EXCEEDS_CUSTODY", `${material.item_code}: ${q(custody)} ${material.uom_code} is still in production custody (issued, not used, scrapped or returned); ${q(total)} asked.`,
          { materialId: material.id, custody: q(custody) });
      }
      claimed.set(material.id, total);
      const pools = held.get(material.id)?.pools ?? new Map();
      let batchId = null;
      let serialIds = null;
      if (material.tracking_type === "batch") {
        if (!line.batchId) throw scrapError(400, "MFG_SCRAP_BATCH_INVALID", `${material.item_code} is batch-tracked: name the batch scrapped.`);
        batchId = uuid(line.batchId, "Batch");
        const pool = pools.get(batchId);
        if (!pool) throw scrapError(409, "MFG_SCRAP_BATCH_INVALID", `${material.item_code}: that batch was not issued to ${order.mo_number}.`);
        if (base > pool.available) throw scrapError(409, "MFG_SCRAP_EXCEEDS_CUSTODY", `${material.item_code}: ${q(pool.available)} of that batch is in production custody.`);
      } else if (material.tracking_type === "serial") {
        serialIds = (Array.isArray(line.serialIds) ? line.serialIds : []).filter(Boolean).map((value) => uuid(value, "Serial"));
        if (!serialIds.length || D(String(serialIds.length)) !== base) throw scrapError(400, "MFG_SCRAP_SERIAL_INVALID", `${material.item_code} is serial-numbered: choose exactly ${q(base)} serial unit(s).`);
        if (new Set(serialIds).size !== serialIds.length) throw scrapError(400, "MFG_SCRAP_SERIAL_INVALID", `${material.item_code}: a serial unit appears twice.`);
        for (const serialId of serialIds) {
          const pool = pools.get(serialId);
          if (!pool || pool.available < 1_000_000n) throw scrapError(409, "MFG_SCRAP_SERIAL_INVALID", `${material.item_code}: a chosen serial unit is not in ${order.mo_number}'s production custody.`);
        }
      } else if (line.batchId || (Array.isArray(line.serialIds) && line.serialIds.length)) {
        throw scrapError(400, "MFG_SCRAP_BATCH_INVALID", `${material.item_code} is not batch or serial tracked.`);
      }
      // Its value: Inventory's valuation when it was issued (the line's average issue cost) — never zero by default.
      const issued = D(material.issued_quantity);
      const rate = issued > ZERO && D(material.issued_cost) > ZERO ? div(D(material.issued_cost), issued) : null;
      lines.push({ material, itemId: material.component_item_id, code: material.item_code, uom: material.uom_code, trackingType: material.tracking_type, quantity: raw, uomId,
        factor: converted.factor, baseQuantity: base, batchId, serialIds, rate, notes: text(line.notes, 500) || null });
    }
    return { lines, materials };
  }
  const sources = await rejectedSources(client, c, order);
  const claimed = new Map();
  for (const [index, line] of requested.entries()) {
    const source = sources.find((entry) => entry.row.id === line.productionEntryId);
    if (!source) throw scrapError(400, "MFG_SCRAP_SOURCE_REQUIRED", `Line ${index + 1}: choose a reported production entry of ${order.mo_number}.`);
    let amount;
    try { amount = await outputQuantity(client, c, order, line.quantity, line.uomId || undefined); } catch (error) {
      throw scrapError(400, "MFG_SCRAP_QTY_INVALID", `${source.row.entry_number}: ${error.message}`);
    }
    if (source.figures.rejected === ZERO) throw scrapError(409, "MFG_SCRAP_OUTPUT_NOT_REJECTED", `${source.row.entry_number} has no rejected output: only output Quality rejected is scrapped here.`);
    const total = add(claimed.get(source.row.id) ?? ZERO, amount.base);
    if (total > source.figures.undisposed) {
      throw scrapError(409, source.figures.undisposed === ZERO ? "MFG_SCRAP_ALREADY_DISPOSED" : "MFG_SCRAP_EXCEEDS_CUSTODY",
        `${source.row.entry_number}: ${q(source.figures.undisposed)} rejected output is not yet disposed of (${q(source.figures.rejected)} rejected, ${q(source.figures.scrapped)} already scrapped).`,
        { entryId: source.row.id, undisposed: q(source.figures.undisposed) });
    }
    claimed.set(source.row.id, total);
    lines.push({ source, entryId: source.row.id, itemId: order.finished_item_id, code: null, qualityDecisionId: source.row.quality_decision_id ?? null, quantity: amount.entered,
      uomId: amount.uomId, factor: amount.factor, baseQuantity: amount.base, batchId: null, serialIds: null, rate: null, notes: text(line.notes, 500) || null });
  }
  // Output carries the recipe's material per unit at its actual average issue cost — the same basis a finished-goods receipt uses.
  const unit = unitMaterialCost(order, await loadMaterials(client, c, order.id));
  for (const line of lines) line.rate = unit.unitCost;
  return { lines, materials: null, missing: unit.missing };
}

// The value of the lines and whether it can leave work in progress (it cannot exceed what work in progress still holds).
export function costOf(order, lines, header) {
  const missing = lines.filter((line) => line.rate === null);
  if (missing.length) return { status: "MISSING", total: null, perLine: lines.map(() => null), message: "No cost is known for part of this scrap: it was issued without a valuation. Give the item a cost first." };
  const perLine = lines.map((line) => D(money(mul(line.rate, line.baseQuantity))));
  const total = perLine.reduce((sum, value) => add(sum, value), ZERO);
  const leaves = header.disposition === "RECOVERABLE" || header.loss_class === "ABNORMAL";
  if (leaves && total > add(wipBalance(order), D("0.01"))) {
    return { status: "BLOCKED", total, perLine, message: `This scrap carries ₹${money(total)}; work in progress holds ₹${money(wipBalance(order))}.` };
  }
  return { status: "VALUED", total, perLine, leaves };
}

// Why this note needs an approval under the company's policy (empty: none needed).
export function approvalReasons(settings, header, total) {
  const reasons = [];
  if (header.scrap_type === "REJECTED_OUTPUT" && settings.outputRequiresApproval) reasons.push("Scrapping production output");
  if (header.loss_class === "ABNORMAL" && settings.abnormalRequiresApproval) reasons.push("Abnormal loss");
  if (settings.valueAbove !== null && total !== null && total > settings.valueAbove) reasons.push(`Value above ₹${money(settings.valueAbove)}`);
  return reasons;
}

// The destination of recoverable scrap: a stock location set aside for damaged (or quarantined) stock — never usable, sellable stock.
export async function resolveDestination(client, c, order, header) {
  if (header.disposition !== "RECOVERABLE") return { warehouseId: null, locationId: null };
  if (!header.destinationLocationId) throw scrapError(400, "MFG_SCRAP_WAREHOUSE_INVALID", "Recoverable scrap goes to a bin set aside for damaged stock: choose it.");
  const location = (await client.query(`SELECT location.id, location.warehouse_id, location.disposition, location.status, location.allow_stock, warehouse.status AS warehouse_status
      FROM tenant.warehouse_locations location JOIN tenant.warehouses warehouse ON warehouse.id = location.warehouse_id WHERE location.organization_id = $1 AND location.id = $2`,
    [c.organizationId, uuid(header.destinationLocationId, "Scrap location")])).rows[0];
  if (!location || location.status !== "active" || !location.allow_stock || location.warehouse_status !== "active") throw scrapError(400, "MFG_SCRAP_WAREHOUSE_INVALID");
  if (!["damaged", "quarantined"].includes(location.disposition)) throw scrapError(400, "MFG_SCRAP_WAREHOUSE_INVALID", "Recoverable scrap is kept apart from usable stock: choose a damaged-stock or quarantine bin.");
  return { warehouseId: location.warehouse_id, locationId: location.id };
}

export function contentHash(header, lines) {
  const base = (line) => (line.baseQuantity !== undefined ? q(line.baseQuantity) : q(D(line.base_quantity)));
  return createHash("sha256").update(JSON.stringify({
    order: header.manufacturing_order_id, type: header.scrap_type, disposition: header.disposition, loss: header.loss_class, reason: header.reason_code, bin: header.destination_location_id ?? null,
    lines: lines.map((line) => [line.material_id ?? line.material?.id ?? null, line.production_entry_id ?? line.entryId ?? null, base(line), line.uom_id ?? line.uomId, line.batch_id ?? line.batchId ?? null,
      [...(line.serial_ids ?? line.serialIds ?? [])].sort()]),
  })).digest("hex");
}

// The planned allowance of a material line: the part of its planned quantity its BOM line's scrap allowance added.
export function plannedAllowance(material, pct) {
  const share = D(String(pct ?? 0));
  if (share <= ZERO) return ZERO;
  return div(mul(D(material.planned_quantity), share), add(100_000_000n, share));
}

export { D, MoError, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, max, money, mul, q, sub, text, uuid, wipBalance };
