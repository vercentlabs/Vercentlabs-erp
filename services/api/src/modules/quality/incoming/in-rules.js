// Quality — Incoming Inspection: errors and messages, permissions, the workflow and disposition vocabularies, and small input helpers.
// Inspection execution (status) and the lot's disposition are separate: completing an inspection never accepts or releases stock.
export const IN = Object.freeze({
  view: "quality.incoming.view", create: "quality.incoming.create", assign: "quality.incoming.assign", start: "quality.incoming.start", record: "quality.incoming.record_result",
  submit: "quality.incoming.submit", review: "quality.incoming.review", requestChanges: "quality.incoming.request_changes", complete: "quality.incoming.complete",
  reinspect: "quality.incoming.reinspect", correct: "quality.incoming.correct", cancel: "quality.incoming.cancel", export: "quality.incoming.export", audit: "quality.incoming.view_audit",
  dispose: "quality.disposition.approve", waive: "quality.disposition.waive", nonconformance: "quality.nonconformance.manage",
});
// In-process inspections (MVP 32) are worked under their own keys; the disposition and the waiver are shared by every kind of inspection.
export const IP = Object.freeze({
  view: "quality.inprocess.view", create: "quality.inprocess.create", assign: "quality.inprocess.assign", start: "quality.inprocess.start", record: "quality.inprocess.record_result",
  submit: "quality.inprocess.submit", review: "quality.inprocess.review", requestChanges: "quality.inprocess.request_changes", complete: "quality.inprocess.complete",
  reinspect: "quality.inprocess.reinspect", correct: "quality.inprocess.correct", cancel: "quality.inprocess.cancel", export: "quality.inprocess.export", audit: "quality.inprocess.view_audit",
  dispose: IN.dispose, waive: IN.waive, nonconformance: IN.nonconformance,
});
// Final inspections (MVP 33) likewise.
export const FP = Object.freeze({
  view: "quality.final.view", create: "quality.final.create", assign: "quality.final.assign", start: "quality.final.start", record: "quality.final.record_result",
  submit: "quality.final.submit", review: "quality.final.review", requestChanges: "quality.final.request_changes", complete: "quality.final.complete",
  reinspect: "quality.final.reinspect", correct: "quality.final.correct", cancel: "quality.final.cancel", export: "quality.final.export", audit: "quality.final.view_audit",
  dispose: IN.dispose, waive: IN.waive, nonconformance: IN.nonconformance,
});
// Pre-dispatch inspections of Sales deliveries (MVP 34) likewise.
export const DP = Object.freeze({
  view: "quality.dispatch.view", create: "quality.dispatch.create", assign: "quality.dispatch.assign", start: "quality.dispatch.start", record: "quality.dispatch.record_result",
  submit: "quality.dispatch.submit", review: "quality.dispatch.review", requestChanges: "quality.dispatch.request_changes", complete: "quality.dispatch.complete",
  reinspect: "quality.dispatch.reinspect", correct: "quality.dispatch.correct", cancel: "quality.dispatch.cancel", export: "quality.dispatch.export", audit: "quality.dispatch.view_audit",
  dispose: IN.dispose, waive: IN.waive, nonconformance: IN.nonconformance,
});
const KEYS = { in_process: IP, final: FP, pre_dispatch: DP };
export const permsOf = (row) => KEYS[row?.inspection_type] ?? IN;
// The workspace route of each kind of inspection.
export const routeOf = (type) => ({ in_process: "in-process", final: "final", pre_dispatch: "dispatch" }[type] ?? "incoming");
const MESSAGES = Object.freeze({
  QUALITY_INCOMING_RECEIPT_INVALID: "Select a valid Goods Receipt.",
  QUALITY_INCOMING_SOURCE_CHANGED: "The receipt changed. Review the inspection scope.",
  QUALITY_INCOMING_SPEC_MISSING: "An approved inspection standard is missing.",
  QUALITY_INCOMING_SPEC_NOT_APPLICABLE: "This specification does not apply to the selected receipt.",
  QUALITY_INCOMING_HOLD_PENDING: "The stock restriction requires reconciliation.",
  QUALITY_INCOMING_SAMPLE_COUNT_INVALID: "Review the number of samples.",
  QUALITY_INCOMING_RESULT_MISSING: "Complete the required checks.",
  QUALITY_INCOMING_RESULT_INVALID: "Review the recorded value.",
  QUALITY_INCOMING_EVIDENCE_MISSING: "Attach the required evidence.",
  QUALITY_INCOMING_CRITICAL_FAILURE: "A critical check failed. Quality review is required.",
  QUALITY_INCOMING_REVIEW_REQUIRED: "Submit the inspection for review.",
  QUALITY_INCOMING_DISPOSITION_PENDING: "Quality clearance has not yet been authorized.",
  QUALITY_INCOMING_QUANTITY_MISMATCH: "Inspection and received quantities do not agree.",
  QUALITY_INCOMING_COMPANY_MISMATCH: "This receipt belongs to another Company.",
  QUALITY_INCOMING_ACCESS_DENIED: "You do not have permission for this action.",
  QUALITY_INCOMING_CONCURRENT_CHANGE: "This inspection changed. Refresh before continuing.",
  QUALITY_INCOMING_OUTCOME_UNKNOWN: "The last action is being verified. Do not submit it again.",
  QUALITY_INCOMING_NOT_FOUND: "That inspection was not found.",
  QUALITY_INCOMING_STATE: "The inspection cannot do that in its current state.",
  QUALITY_INCOMING_SELF_DECISION: "The inspector cannot decide their own inspection.",
  QUALITY_INCOMING_REASON_REQUIRED: "Give a reason.",
  // In-process inspection (MVP 32).
  QUALITY_IPQC_PRODUCTION_INVALID: "Select a valid Production Order.",
  QUALITY_IPQC_OPERATION_INVALID: "This production operation is not available for inspection.",
  QUALITY_IPQC_WIP_INVALID: "The selected work-in-progress quantity is invalid.",
  QUALITY_IPQC_SPEC_MISSING: "No approved inspection standard is available.",
  QUALITY_IPQC_GATE_ACTIVE: "This production quantity is awaiting Quality clearance.",
  QUALITY_IPQC_DISPOSITION_PENDING: "The inspected WIP has not received an authorized outcome.",
  QUALITY_IPQC_REWORK_PENDING: "Rework is still pending.",
  QUALITY_IPQC_QUANTITY_MISMATCH: "Production and Quality quantities do not agree.",
  QUALITY_IPQC_SOURCE_CHANGED: "Production information changed. Review the inspection scope.",
  QUALITY_IPQC_PERMISSION_DENIED: "You cannot perform this Quality action.",
  // Final inspection (MVP 33).
  QUALITY_FINAL_STOCK_GATE_ACTIVE: "This finished-goods quantity remains restricted.",
  QUALITY_FINAL_OUTPUT_INVALID: "Select a valid finished-production output.",
  QUALITY_FINAL_POPULATION_INVALID: "The finished-goods quantity or lot is invalid.",
  QUALITY_FINAL_SPEC_MISSING: "No approved Final Inspection Specification is available.",
  // Inspection linked to delivery (MVP 34).
  QUALITY_DISPATCH_GATE_ACTIVE: "This delivery is awaiting Quality clearance before dispatch.",
  QUALITY_DISPATCH_DELIVERY_INVALID: "Select a valid delivery line.",
  QUALITY_DISPATCH_QUANTITY_MISMATCH: "The delivery and Quality quantities do not agree.",
  QUALITY_DISPATCH_SPEC_MISSING: "No approved pre-dispatch inspection standard is available.",
});
export class QualityIncomingError extends Error {
  constructor(status, code, message, details) {
    super(message || MESSAGES[code] || "The inspection request could not be completed.");
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const inError = (status, code, message, details) => new QualityIncomingError(status, code, message, details);
export const has = (c, p) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p));
export const need = (c, ...list) => {
  if (!list.some((p) => has(c, p))) throw inError(403, "QUALITY_INCOMING_ACCESS_DENIED");
};
export const WORKFLOW = Object.freeze({ PENDING: "Awaiting inspection", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", AWAITING_REVIEW: "Awaiting review", CHANGES_REQUESTED: "Changes requested",
  EVALUATED: "Evaluated", COMPLETED: "Completed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Recovery required" });
export const RECORDABLE = Object.freeze(["IN_PROGRESS", "CHANGES_REQUESTED"]);
export const DECISIONS = Object.freeze({ ACCEPT: "Accept", PARTIAL_ACCEPT: "Partly accept", REJECT: "Reject", REINSPECT: "Reinspect", CONDITIONAL_ACCEPT: "Conditional acceptance (deviation)",
  RETURN_TO_SUPPLIER: "Return to supplier", SCRAP: "Scrap", HOLD_FOR_REVIEW: "Hold for review" });
export const OUTCOMES = Object.freeze({ PASS: "Pass", FAIL: "Fail", NOT_EVALUATED: "Not evaluated", NOT_APPLICABLE: "Not applicable", REQUIRES_REVIEW: "Requires review", RECORDED: "Recorded" });
export const PRIORITY_DAYS = Object.freeze({ URGENT: 0, HIGH: 1, NORMAL: null, LOW: 5 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", `${label} is invalid.`);
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const num = (value) => (value === undefined || value === null || value === "" ? 0 : Number(value));
export const EPS = 1e-9;
export const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;
export const expectVersion = (row, input) => {
  if (input?.version !== undefined && input.version !== null && input.version !== "" && Number(input.version) !== Number(row.row_version)) throw inError(409, "QUALITY_INCOMING_CONCURRENT_CHANGE");
};
// The legacy status other modules read (receipts, receiving rejections, stock holds), kept in step with the workflow and the disposition.
export function legacyStatus(row, totals) {
  if (row.workflow_status === "CANCELLED") return "cancelled";
  if (totals && totals.accept + totals.conditional + totals.reject > EPS) return totals.reject > EPS ? "failed" : totals.conditional > EPS ? "conditionally_accepted" : "passed";
  if (["PENDING", "ASSIGNED"].includes(row.workflow_status)) return "draft";
  return "in_progress";
}
