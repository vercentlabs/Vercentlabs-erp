// Purchase Returns: goods sent back to the supplier after they were received. Shared constants, errors and small readers.
export const RETURN_PERMISSIONS = Object.freeze({
  view: "procurement.returns.view",
  manage: "procurement.returns.manage",
  post: "procurement.returns.post",
  reverse: "procurement.returns.reverse",
  commercial: "procurement.returns.commercial",
  resolve: "procurement.returns.resolve",
  poView: "procurement.po.view",
  poViewAll: "procurement.po.view_all",
  poCreate: "procurement.po.create",
  payables: "accounting.payables.manage",
});

// Structured reasons, one per line. "other" needs an explanation; excess and surplus are commercial returns of good stock (authorised).
export const RETURN_REASONS = Object.freeze([
  { code: "damaged_goods", label: "Damaged goods" }, { code: "defective_product", label: "Defective product" },
  { code: "failed_quality_inspection", label: "Failed quality inspection" }, { code: "wrong_product", label: "Wrong product" },
  { code: "wrong_specification", label: "Wrong specification" }, { code: "expired_goods", label: "Expired goods" }, { code: "near_expiry", label: "Near expiry" },
  { code: "incorrect_variant", label: "Incorrect size / variant" }, { code: "excess_goods", label: "Excess goods" }, { code: "supplier_recall", label: "Supplier recall" },
  { code: "surplus_goods", label: "Surplus goods" }, { code: "other", label: "Other" },
]);
export const REASON_LABELS = Object.freeze(Object.fromEntries(RETURN_REASONS.map((entry) => [entry.code, entry.label])));
export const COMMERCIAL_REASONS = Object.freeze(["excess_goods", "surplus_goods"]);

export const EXPECTED_RESOLUTIONS = Object.freeze({ supplier_credit: "Supplier credit", supplier_refund: "Refund", replacement: "Replacement", no_resolution: "No resolution expected" });
export const RESOLUTION_TYPES = Object.freeze({ supplier_credit: "Supplier credit", supplier_refund: "Supplier refund", replacement_received: "Replacement received",
  other_authorized_resolution: "Other authorised resolution" });
export const DOCUMENT_STATUS_LABELS = Object.freeze({ draft: "Draft", posted: "Posted", cancelled: "Cancelled", reversed: "Reversed" });
export const RESOLUTION_STATUS_LABELS = Object.freeze({ pending: "Pending", partially_resolved: "Partially resolved", resolved: "Resolved", not_applicable: "Not applicable" });
export const FINANCIAL_STATUS_LABELS = Object.freeze({ not_required: "Not required", pending: "Pending", partially_reconciled: "Partially reconciled", reconciled: "Reconciled",
  not_applicable: "Not applicable" });
export const REPLACEMENT_STATUS_LABELS = Object.freeze({ not_required: "Not required", awaiting: "Awaiting", partially_received: "Partially received", completed: "Completed" });

export const RETURN_VIEWS = Object.freeze([
  { key: "all", label: "All Returns" }, { key: "draft", label: "Draft" }, { key: "posted", label: "Posted" }, { key: "cancelled_reversed", label: "Cancelled / Reversed" },
  { key: "awaiting_resolution", label: "Awaiting Supplier Resolution" }, { key: "awaiting_financial", label: "Awaiting Financial Adjustment" },
  { key: "awaiting_replacement", label: "Awaiting Replacement" },
]);

export class PurchaseReturnError extends Error {
  constructor(status, message, code = "PURCHASE_RETURN_ERROR", details = undefined) {
    super(message);
    this.name = "PurchaseReturnError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const fail = (message, field, code = "PURCHASE_RETURN_VALIDATION", status = 400) => {
  throw new PurchaseReturnError(status, message, code, field ? { field, issues: [{ field, message }] } : undefined);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID.test(value);
export function requireUuid(value, label = "Identifier") {
  if (!isUuid(value)) throw new PurchaseReturnError(404, `${label} not found.`, "PURCHASE_RETURN_NOT_FOUND");
  return value;
}
export function optionalUuid(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) fail(`${label} is not valid.`, label);
  return value;
}
export const text = (value, max = 1000) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
export const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
export { dayOf } from "../purchase-orders/constants.js";
export function readDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) fail(`${label}: enter a valid date.`, label);
  return raw;
}
