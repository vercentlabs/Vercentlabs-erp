// Receiving rejections, the shared core: the reasons and outcomes, loading a
// case under the caller's scope, its history, opening a case (idempotent per
// source) and recording an outcome. Goods receipts, purchase returns and the
// rejection commands all use it; none of them duplicates another's stock or
// document logic.
import { add, decimal, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { poCan, poScopeSql } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, fail, requireUuid, text } from "./constants.js";

export const REJECTION_REASONS = Object.freeze([
  { code: "damaged_goods", label: "Damaged goods" }, { code: "defective_product", label: "Defective product" }, { code: "wrong_product", label: "Wrong product" },
  { code: "wrong_specification", label: "Wrong specification" }, { code: "poor_quality", label: "Poor quality" }, { code: "expired_product", label: "Expired product" },
  { code: "incorrect_quantity", label: "Incorrect quantity" }, { code: "packaging_damage", label: "Packaging damage" },
  { code: "missing_documentation", label: "Missing documentation" }, { code: "failed_inspection", label: "Failed inspection" }, { code: "other", label: "Other" },
]);
export const RESOLUTION_TYPES = Object.freeze([
  { code: "replacement_received", label: "Replacement received", stage: "before_custody" },
  { code: "outstanding_qty_cancelled", label: "Outstanding quantity cancelled", stage: "before_custody" },
  { code: "refusal_closed", label: "Refusal closed", stage: "before_custody" },
  { code: "quality_accepted", label: "Accepted after review", stage: "after_custody" },
  { code: "purchase_return_posted", label: "Returned to supplier", stage: "after_custody" },
  { code: "authorized_disposal", label: "Disposed of (authorised)", stage: "after_custody" },
]);
export const EXPECTED_RESOLUTIONS = Object.freeze([
  { code: "replacement_expected", label: "Supplier to send a replacement" }, { code: "cancel_outstanding", label: "Cancel the outstanding quantity" },
  { code: "close_refusal", label: "Close the refusal" }, { code: "quality_review", label: "Awaiting quality review" },
  { code: "purchase_return", label: "Return to the supplier" }, { code: "disposal", label: "Dispose of the goods" },
]);
export const STAGE_LABELS = Object.freeze({ before_custody: "Refused at the dock (never received)", after_custody: "Rejected after receipt" });
export const SOURCE_LABELS = Object.freeze({ dock: "Refused at the dock", inspection_hold: "Inspection hold", damaged_at_receipt: "Damaged at receipt", usable_stock: "Usable stock" });
export const reasonLabel = (code) => REJECTION_REASONS.find((entry) => entry.code === code)?.label ?? code;

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

// The reason, the optional extra tags and the explanation ("Other" needs one).
export function readRejectionReason(input, { defaultReason = null } = {}) {
  const reason = text(input.reason ?? input.rejectionReason, 40) ?? defaultReason;
  if (!REJECTION_REASONS.some((entry) => entry.code === reason)) fail("Choose the reason for the rejection.", "reason", "REJECTION_REASON_REQUIRED");
  const tags = [...new Set((Array.isArray(input.reasonTags) ? input.reasonTags : []).map((tag) => text(tag, 40)).filter(Boolean))];
  if (tags.some((tag) => !REJECTION_REASONS.some((entry) => entry.code === tag))) fail("Choose the additional reasons from the list.", "reasonTags");
  const description = text(input.description ?? input.notes, 2000);
  if (reason === "other" && (!description || description.length < 3)) fail("Explain the rejection: the reason is Other.", "description", "REJECTION_EXPLANATION_REQUIRED");
  return { reason, tags: tags.filter((tag) => tag !== reason), description };
}

export function readExpectedResolution(value, stage) {
  if (value === undefined || value === null || value === "") return null;
  const code = text(value, 40);
  if (!EXPECTED_RESOLUTIONS.some((entry) => entry.code === code)) fail("Choose the expected resolution.", "expectedResolution");
  const dock = ["replacement_expected", "cancel_outstanding", "close_refusal"];
  if (stage === "before_custody" && !dock.includes(code)) fail("Goods refused at the dock were never received: expect a replacement, a cancellation, or close the refusal.", "expectedResolution");
  if (stage === "after_custody" && ["cancel_outstanding", "close_refusal"].includes(code))
    fail("Goods already received are returned, disposed of or accepted; the order's outstanding quantity is not involved.", "expectedResolution");
  return code;
}

// Who sees which cases: everyone (view-all), or the cases on the orders they see and the ones they reported.
export function requireRejectionAccess(context) {
  if (!poCan(context, PO_PERMISSIONS.rejectionsView) && !poCan(context, PO_PERMISSIONS.rejectionsViewAll))
    throw new PurchaseOrderError(403, "You do not have permission to view receiving rejections.", "PERMISSION_DENIED");
}
export function rejectionScopeSql(context, values, alias = "rejection", orderAlias = "po") {
  if (poCan(context, PO_PERMISSIONS.rejectionsViewAll) || poCan(context, PO_PERMISSIONS.viewAll)) return "";
  const scope = poScopeSql(context, values, orderAlias);
  return ` AND ((TRUE${scope}) OR ${alias}.reported_by_user_id = $${values.length} OR ${alias}.created_by = $${values.length})`;
}

export async function loadRejection(client, context, rejectionId, { lock = false } = {}) {
  requireRejectionAccess(context);
  const values = [context.organizationId, requireUuid(rejectionId, "Rejection")];
  const scope = rejectionScopeSql(context, values);
  const row = (await client.query(
    `SELECT rejection.* FROM tenant.receiving_rejections rejection
       JOIN tenant.purchase_orders po ON po.organization_id = rejection.organization_id AND po.id = rejection.purchase_order_id
      WHERE rejection.organization_id = $1 AND rejection.id = $2${scope}${lock ? " FOR UPDATE OF rejection" : ""}`, values)).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Rejection not found.", "REJECTION_NOT_FOUND");
  return row;
}

export async function recordRejectionEvent(client, context, rejectionId, eventType, summary, details = {}) {
  await client.query(
    `INSERT INTO tenant.receiving_rejection_events (organization_id, receiving_rejection_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, rejectionId, eventType, summary, JSON.stringify(details), context.userId ?? null]);
}

// openRejectionCase: one numbered case. With a sourceKey (a receipt line's refusal or damage, a Quality decision) a retry returns the case already open.
export async function openRejectionCase(client, context, fields) {
  if (fields.sourceKey) {
    const existing = (await client.query(`SELECT id, rejection_number FROM tenant.receiving_rejections WHERE organization_id = $1 AND source_key = $2`,
      [context.organizationId, fields.sourceKey])).rows[0];
    if (existing) return { id: existing.id, rejectionNumber: existing.rejection_number, replayed: true };
  }
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "receiving_rejection", at: new Date(fields.observedAt ?? Date.now()) });
  const factor = decimal(fields.conversionFactor ?? "1");
  const row = (await client.query(
    `INSERT INTO tenant.receiving_rejections (organization_id, rejection_number, purchase_order_id, purchase_order_line_id, goods_receipt_id, goods_receipt_line_id, disposition_id,
       supplier_id, warehouse_id, location_id, source_location_id, product_id, product_type, product_snapshot, description_snapshot, rejection_stage, stock_source, rejection_reason,
       reason_tags, presented_quantity, rejected_quantity, uom_id, uom_snapshot, conversion_factor, base_quantity, batch_id, batch_number, expiry_date, serial_numbers,
       delivered_product_description, description, quality_inspection_id, expected_resolution, stock_movement_ids, evidence_file_ids, source_key, observed_at,
       reported_by_user_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33,
       $34, $35, $36, $37, $38, $39, $39) RETURNING id, rejection_number`,
    [context.organizationId, number, fields.purchaseOrderId, fields.purchaseOrderLineId, fields.goodsReceiptId ?? null, fields.goodsReceiptLineId ?? null, fields.dispositionId ?? null,
      fields.supplierId, fields.warehouseId ?? null, fields.locationId ?? null, fields.sourceLocationId ?? null, fields.productId ?? null, fields.productType,
      JSON.stringify(fields.productSnapshot ?? {}), fields.description_snapshot ?? fields.descriptionSnapshot, fields.stage, fields.stockSource, fields.reason, fields.tags ?? [],
      fields.presentedQuantity === null || fields.presentedQuantity === undefined ? null : formatDecimal(fields.presentedQuantity), formatDecimal(fields.quantity), fields.uomId ?? null,
      JSON.stringify(fields.uomSnapshot ?? {}), formatDecimal(factor), formatDecimal(roundMoney(mul(fields.quantity, factor), 6)), fields.batchId ?? null, fields.batchNumber ?? null,
      fields.expiryDate ?? null, fields.serialNumbers ?? [], fields.deliveredProductDescription ?? null, fields.description ?? null, fields.qualityInspectionId ?? null,
      fields.expectedResolution ?? null, fields.stockMovementIds ?? [], fields.evidenceFileIds ?? [], fields.sourceKey ?? null, fields.observedAt ?? new Date().toISOString(),
      fields.reportedByUserId ?? context.userId ?? null, context.userId ?? null])).rows[0];
  await recordRejectionEvent(client, context, row.id, "rejection.recorded",
    `${STAGE_LABELS[fields.stage]}: ${dec(fields.quantity)} ${fields.uomSnapshot?.code ?? ""} — ${reasonLabel(fields.reason)}${fields.description ? ` (${fields.description})` : ""}`.replace(/\s+—/, " —"),
    { stage: fields.stage, source: fields.stockSource, quantity: dec(fields.quantity), sourceKey: fields.sourceKey ?? null });
  return { id: row.id, rejectionNumber: row.rejection_number, replayed: false };
}

// What is still unresolved on a case.
export const openQuantityOf = (rejection) => sub(rejection.rejected_quantity, rejection.resolved_quantity);
// What of an after-custody case is still physically held (blocked) for it.
export const blockedQuantityOf = (rejection) => sub(sub(sub(rejection.rejected_quantity, rejection.returned_quantity), rejection.released_quantity), rejection.disposed_quantity);

// applyResolution: one documented outcome for part or all of a case; the case resolves when nothing is left.
export async function applyResolution(client, context, rejection, { type, quantity, notes, documentType = null, documentId = null, movementIds = [], counter = null }) {
  const open = openQuantityOf(rejection);
  if (quantity <= 0n) fail("Enter the quantity resolved.", "quantity");
  if (quantity > open) throw new PurchaseOrderError(409, `Only ${dec(open)} of ${rejection.rejection_number} is still unresolved.`, "REJECTION_RESOLUTION_EXCEEDS_OPEN");
  const resolutionNotes = text(notes, 2000);
  if (!resolutionNotes || resolutionNotes.length < 3) fail("Describe the resolution.", "notes", "REJECTION_RESOLUTION_NOTES_REQUIRED");
  await client.query(
    `INSERT INTO tenant.receiving_rejection_resolutions (organization_id, receiving_rejection_id, resolution_type, quantity_resolved, related_document_type, related_document_id,
       resolution_notes, stock_movement_ids, resolved_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [context.organizationId, rejection.id, type, formatDecimal(quantity), documentType, documentId, resolutionNotes, movementIds, context.userId ?? null]);
  const resolved = add(rejection.resolved_quantity, quantity);
  const done = resolved === decimal(rejection.rejected_quantity);
  const types = (await client.query(`SELECT DISTINCT resolution_type FROM tenant.receiving_rejection_resolutions WHERE organization_id = $1 AND receiving_rejection_id = $2`,
    [context.organizationId, rejection.id])).rows.map((row) => row.resolution_type);
  const counterSql = counter ? `, ${counter} = ${counter} + $8` : "";
  await client.query(
    `UPDATE tenant.receiving_rejections SET resolved_quantity = $3, status = CASE WHEN $4 THEN 'resolved' ELSE status END, resolution_type = $5,
            resolution_notes = CASE WHEN $4 THEN $6 ELSE resolution_notes END, resolved_by = CASE WHEN $4 THEN $7::uuid ELSE resolved_by END,
            resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END, updated_by = $7, updated_at = now()${counterSql}
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, rejection.id, formatDecimal(resolved), done, types.length === 1 ? types[0] : "multiple", resolutionNotes, context.userId ?? null,
      ...(counter ? [formatDecimal(quantity)] : [])]);
  const label = RESOLUTION_TYPES.find((entry) => entry.code === type)?.label ?? type;
  await recordRejectionEvent(client, context, rejection.id, done ? "rejection.resolved" : "rejection.partly_resolved",
    `${label}: ${dec(quantity)}${done ? " — case resolved" : ` — ${dec(sub(open, quantity))} still open`}. ${resolutionNotes}`, { type, quantity: dec(quantity), documentType, documentId });
  return { resolved: done, open: dec(sub(open, quantity)) };
}
