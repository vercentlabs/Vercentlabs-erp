// Assets — Asset Disposal, the rules: permissions, disposal types and states, the approval policy and the errors. An asset is not disposed of
// because someone clicked Dispose: authorization, the physical exit (or confirmed loss) and Finance's derecognition are reconciled first.
import { AssetError, has } from "../common.js";

export const DX = Object.freeze({
  view: "assets.disposal.view", create: "assets.disposal.create", submit: "assets.disposal.submit", approve: "assets.disposal.approve", reject: "assets.disposal.reject",
  handover: "assets.disposal.confirm_handover", financials: "assets.disposal.view_financials", financeReview: "assets.disposal.finance_review",
  derecognize: "assets.disposal.request_derecognition", complete: "assets.disposal.complete", cancel: "assets.disposal.cancel", correct: "assets.disposal.correct",
  bulk: "assets.disposal.bulk", reconcile: "assets.disposal.reconcile", export: "assets.disposal.export", audit: "assets.disposal.view_audit",
});
// Finance's own journal rights: approving a disposal never implies them.
export const FINANCE_POST = "accounting.journal.post";
export const seesDisposals = (c) => Object.values(DX).some((k) => has(c, k));

export const TYPES = ["SALE", "SCRAP", "DONATION", "WRITE_OFF_LOST", "WRITE_OFF_DAMAGED", "OTHER_APPROVED_EXIT"];
export const TYPE_LABEL = Object.freeze({ SALE: "Sale", SCRAP: "Scrap", DONATION: "Donation", WRITE_OFF_LOST: "Write-off (lost)", WRITE_OFF_DAMAGED: "Write-off (damaged / destroyed)",
  OTHER_APPROVED_EXIT: "Other approved exit" });
// The types that may bring money in; the others never have proceeds.
export const WITH_PROCEEDS = ["SALE", "SCRAP", "OTHER_APPROVED_EXIT"];
export const REASONS = Object.freeze({ OBSOLETE: "Obsolete / replaced", BEYOND_REPAIR: "Beyond economical repair", SURPLUS: "Surplus to requirements", LOST: "Confirmed lost",
  DESTROYED: "Destroyed / damaged", END_OF_LIFE: "End of useful life", SALE_OPPORTUNITY: "Sale opportunity", DONATION: "Donation", OTHER: "Other", CARRIED_OVER: "Carried over" });
export const CASE_STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected", APPROVED: "Approved — pending execution",
  PENDING_HANDOVER: "Pending physical handover", PENDING_FINANCE: "Pending Finance", POSTING: "Posting", COMPLETED: "Completed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Being verified" });
export const LINE_STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", REJECTED: "Rejected", PENDING_HANDOVER: "Pending handover", PENDING_FINANCE: "Pending Finance",
  POSTING: "Posting", COMPLETED: "Disposed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Being verified", REINSTATED: "Reinstated" });
export const LIVE_LINE = ["DRAFT", "PENDING_APPROVAL", "PENDING_HANDOVER", "PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED"];
export const EXECUTING = ["PENDING_HANDOVER", "PENDING_FINANCE", "POSTING", "RECOVERY_REQUIRED"];
export const HANDOVER_KINDS = Object.freeze({ BUYER_DELIVERY: "Delivered to the buyer", RECYCLER_RECEIPT: "Received by the recycler", DONATION_RECEIPT: "Received by the recipient",
  DESTRUCTION: "Destroyed under supervision", OTHER_EXIT: "Other authorized exit", LOSS_EVIDENCE: "Confirmed loss (no handover)" });
export const LEVEL_LABEL = Object.freeze({ OPERATIONAL: "Asset approval", FINANCE: "Finance approval", MANAGEMENT: "Management approval" });

const MESSAGES = Object.freeze({
  ASSET_DISPOSAL_ASSET_INVALID: "Select a valid asset.",
  ASSET_DISPOSAL_ALREADY_ACTIVE: "A disposal request already exists for this asset.",
  ASSET_DISPOSAL_ALREADY_COMPLETED: "This asset has already been disposed of.",
  ASSET_DISPOSAL_CUSTODY_UNRESOLVED: "Resolve the outstanding custody before disposal.",
  ASSET_DISPOSAL_TRANSFER_ACTIVE: "An asset transfer is still in progress.",
  ASSET_DISPOSAL_MAINTENANCE_ACTIVE: "Maintenance is still in progress on this asset.",
  ASSET_DISPOSAL_APPROVAL_REQUIRED: "This disposal needs authorization.",
  ASSET_DISPOSAL_HANDOVER_REQUIRED: "Confirm the asset's physical exit or valid loss evidence.",
  ASSET_DISPOSAL_SALE_INVOICE_REQUIRED: "Create or link the required Sales Invoice.",
  ASSET_DISPOSAL_FINAL_DEPRECIATION_PENDING: "Complete the required final depreciation review.",
  ASSET_DISPOSAL_CARRYING_VALUE_UNCONFIRMED: "Finance has not confirmed the disposal carrying value.",
  ASSET_DISPOSAL_DERECOGNITION_PENDING: "Finance has not yet posted the derecognition.",
  ASSET_DISPOSAL_GL_MAPPING_MISSING: "Configure the disposal accounting accounts.",
  ASSET_DISPOSAL_PERIOD_CLOSED: "The accounting period is closed.",
  ASSET_DISPOSAL_ALREADY_POSTED: "Derecognition has already been posted.",
  ASSET_DISPOSAL_RECONCILIATION_FAILED: "The physical and financial disposal records do not agree.",
  ASSET_DISPOSAL_COMPANY_MISMATCH: "This asset belongs to a different Company.",
  ASSET_DISPOSAL_PERMISSION_DENIED: "You cannot perform this disposal action.",
  ASSET_DISPOSAL_VERSION_CONFLICT: "This disposal changed. Refresh and review.",
  ASSET_DISPOSAL_OUTCOME_UNKNOWN: "The prior operation is being verified. Do not post it again.",
  ASSET_DISPOSAL_NOT_FOUND: "This disposal is not available.",
  ASSET_DISPOSAL_INVALID: "Check the details and try again.",
});
export const DISPOSAL_MESSAGES = MESSAGES;
export const dxError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireDx = (c, key) => { if (!has(c, key)) throw dxError(403, "ASSET_DISPOSAL_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
// Exact money: integer paise, rounded half-up from whatever precision the database returns.
export function toPaise(value) {
  const s = String(value ?? "0").trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw dxError(400, "ASSET_DISPOSAL_INVALID", `Not an amount: ${s}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let p = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) p += 1n;
  return m[1] ? -p : p;
}
export const fromPaise = (p) => { const neg = p < 0n; const v = neg ? -p : p; return `${neg ? "-" : ""}${v / 100n}.${String(v % 100n).padStart(2, "0")}`; };
// The case status from its asset lines: completion is per asset, so a bulk case shows its least advanced live line.
export function caseStatusOf(lines, current) {
  if (!lines.length) return current;
  const live = lines.filter((l) => !["CANCELLED", "REJECTED"].includes(l.line_status));
  if (!live.length) return lines.every((l) => l.line_status === "REJECTED") ? "REJECTED" : "CANCELLED";
  if (live.every((l) => ["COMPLETED", "REINSTATED"].includes(l.line_status))) return "COMPLETED";
  const open = live.filter((l) => !["COMPLETED", "REINSTATED"].includes(l.line_status));
  if (open.some((l) => ["DRAFT"].includes(l.line_status))) return ["CHANGES_REQUESTED", "DRAFT"].includes(current) ? current : "DRAFT";
  if (open.some((l) => l.line_status === "PENDING_APPROVAL")) return "PENDING_APPROVAL";
  if (open.some((l) => l.line_status === "RECOVERY_REQUIRED")) return "RECOVERY_REQUIRED";
  if (open.some((l) => l.line_status === "POSTING")) return "POSTING";
  if (open.some((l) => l.line_status === "PENDING_HANDOVER")) return open.every((l) => l.line_status === "PENDING_HANDOVER" && !l.handover_at) && live.length === open.length ? "APPROVED" : "PENDING_HANDOVER";
  return "PENDING_FINANCE";
}
