// Quality — Nonconformance (NCR): errors and messages, permissions, the workflow and its vocabularies, and small input helpers.
//
//   OPEN → UNDER_REVIEW → ACTION_REQUIRED → VERIFICATION_PENDING → RESOLVED → CLOSED        (CANCELLED from OPEN / UNDER_REVIEW)
//
//   OPEN                  raised (by hand, or from an inspection's disposition): what was found, where, how much is affected.
//   UNDER_REVIEW          an accountable owner investigates: containment of the affected population, then the root cause.
//   ACTION_REQUIRED       containment recorded, root cause recorded, at least one corrective action planned; actions are completed with evidence.
//   VERIFICATION_PENDING  every action done; someone who completed none of them verifies they were effective.
//   RESOLVED              verified effective, with the resolution recorded (outside dependencies may still be open, and stay visible).
//   CLOSED                authorized closure: dependencies marked as blocking are done; a major or critical NCR is closed by someone other
//                         than its owner. Reopening (with a reason) takes it back to UNDER_REVIEW; history is never rewritten.
export const NC = Object.freeze({
  view: "quality.nonconformance.view", manage: "quality.nonconformance.manage", verify: "quality.nonconformance.verify", close: "quality.nonconformance.close",
  export: "quality.nonconformance.export",
});
export const STATUS = Object.freeze({ OPEN: "Open", UNDER_REVIEW: "Under review", ACTION_REQUIRED: "Action required", VERIFICATION_PENDING: "Verification pending", RESOLVED: "Resolved",
  CLOSED: "Closed", CANCELLED: "Cancelled" });
export const SEVERITY = Object.freeze({ minor: "Minor", major: "Major", critical: "Critical" });
export const SOURCES = Object.freeze({ manual: "Raised by hand", procurement_receipt: "Goods receipt", production_entry: "Production", sales_delivery: "Delivery",
  customer_complaint: "Customer complaint", internal_audit: "Internal audit", supplier: "Supplier", other: "Other" });
export const ACTION_TYPES = Object.freeze({ CONTAINMENT: "Containment", CORRECTION: "Correction", CORRECTIVE: "Corrective action", PREVENTIVE: "Preventive action" });
export const METHODS = Object.freeze({ FIVE_WHYS: "5 Whys", FISHBONE: "Fishbone (Ishikawa)", FAULT_TREE: "Fault tree", EIGHT_D: "8D", OTHER: "Other" });
export const LINK_TYPES = Object.freeze({ SUPPLIER_CLAIM: "Supplier claim", CREDIT_NOTE: "Credit note", DEBIT_NOTE: "Debit note", CUSTOMER_COMPLAINT: "Customer complaint",
  PURCHASE_RETURN: "Purchase return", ACCOUNTING: "Accounting entry", OTHER: "Other" });
export const ACTIVE = Object.freeze(["OPEN", "UNDER_REVIEW", "ACTION_REQUIRED", "VERIFICATION_PENDING"]);

const MESSAGES = Object.freeze({
  QUALITY_NC_NOT_FOUND: "That nonconformance was not found.",
  QUALITY_NC_ACCESS_DENIED: "You do not have permission for this action.",
  QUALITY_NC_INVALID: "Review the nonconformance details.",
  QUALITY_NC_STATE: "The nonconformance cannot do that in its current state.",
  QUALITY_NC_CONCURRENT_CHANGE: "This nonconformance changed. Refresh before continuing.",
  QUALITY_NC_OWNER_REQUIRED: "Assign the accountable owner first.",
  QUALITY_NC_CONTAINMENT_REQUIRED: "Record the containment of the affected population first.",
  QUALITY_NC_ROOT_CAUSE_REQUIRED: "Record the root cause first.",
  QUALITY_NC_ACTION_REQUIRED: "Plan at least one corrective action.",
  QUALITY_NC_ACTIONS_OPEN: "Complete or cancel every action first.",
  QUALITY_NC_SELF_VERIFICATION: "Someone who completed an action does not verify it.",
  QUALITY_NC_SELF_CLOSURE: "A major or critical nonconformance is closed by someone other than its owner.",
  QUALITY_NC_DEPENDENCY_OPEN: "A dependency that blocks closure is still open.",
  QUALITY_NC_REASON_REQUIRED: "Give a reason.",
  QUALITY_NC_EVIDENCE_REQUIRED: "Describe what was done (and attach the evidence).",
});
export class QualityNcError extends Error {
  constructor(status, code, message, details) {
    super(message || MESSAGES[code] || "The nonconformance request could not be completed.");
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const ncError = (status, code, message, details) => new QualityNcError(status, code, message, details);
export const has = (c, p) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p));
export const need = (c, ...list) => {
  if (!list.some((p) => has(c, p))) throw ncError(403, "QUALITY_NC_ACCESS_DENIED");
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw ncError(400, "QUALITY_NC_INVALID", `${label} is invalid.`);
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const quantity = (value, label = "Quantity") => {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw ncError(400, "QUALITY_NC_INVALID", `${label} is zero or more.`);
  return Math.round(n * 1e6) / 1e6;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw ncError(400, "QUALITY_NC_INVALID", `${label} is not a valid date.`);
  return s;
};
export const oneOf = (value, map, label) => {
  const v = String(value ?? "");
  if (!Object.prototype.hasOwnProperty.call(map, v)) throw ncError(400, "QUALITY_NC_INVALID", `${label}: choose one of ${Object.values(map).join(", ")}.`);
  return v;
};
export const expectVersion = (row, input) => {
  if (input?.version !== undefined && input.version !== null && input.version !== "" && Number(input.version) !== Number(row.row_version)) throw ncError(409, "QUALITY_NC_CONCURRENT_CHANGE");
};
