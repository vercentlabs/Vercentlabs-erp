// Projects — Project Status, the rules: the six statuses, the one state machine every status change goes through, the reasons a project is
// paused, cancelled or reopened, what each status lets the project's work do, and which status actions a person may take now (with the
// reason when they may not). Status is the project's lifecycle only; health, priority, progress, acceptance, money and the archive are
// separate facts.
import { STATUS_LABEL, projectError } from "../project-core.js";

export const PROJECT_STATUSES = Object.freeze(["DRAFT", "PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);

// action → the statuses it starts from and the status it leads to (resume returns to the status the hold interrupted).
export const TRANSITIONS = Object.freeze({
  activate: { from: ["DRAFT"], to: "PLANNED", label: "Mark as planned" },
  start: { from: ["PLANNED"], to: "IN_PROGRESS", label: "Start project" },
  hold: { from: ["PLANNED", "IN_PROGRESS"], to: "ON_HOLD", label: "Put on hold" },
  resume: { from: ["ON_HOLD"], to: null, label: "Resume" },
  complete: { from: ["IN_PROGRESS"], to: "COMPLETED", label: "Complete project" },
  cancel: { from: ["PLANNED", "IN_PROGRESS", "ON_HOLD"], to: "CANCELLED", label: "Cancel project" },
  reopen: { from: ["COMPLETED"], to: "IN_PROGRESS", label: "Reopen" },
});

export const HOLD_REASONS = Object.freeze({
  CUSTOMER_APPROVAL_PENDING: "Customer approval pending", RESOURCE_UNAVAILABLE: "Resource unavailable", REQUIREMENTS_CHANGE: "Requirements change",
  DEPENDENCY_BLOCKED: "Dependency blocked", TECHNICAL_ISSUE: "Technical issue", BUDGET_REVIEW: "Budget review", COMPLIANCE_OR_SAFETY: "Compliance or safety",
  MANAGEMENT_DECISION: "Management decision", OTHER: "Other",
});
export const HOLD_SEVERITIES = Object.freeze({ LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" });
export const CANCEL_REASONS = Object.freeze({
  CUSTOMER_CANCELLED: "Customer cancelled the engagement", NOT_REQUIRED: "Project no longer required", BUDGET_WITHDRAWN: "Budget withdrawn", DUPLICATE: "Duplicate project",
  SCOPE_CHANGED: "Scope fundamentally changed", CONTRACT_DISCONTINUED: "Contract discontinued", OTHER: "Other",
});
export const REOPEN_REASONS = Object.freeze({
  DELIVERY_CORRECTION: "Delivery correction", POST_COMPLETION_DEFECT: "Post-completion defect", MISSING_DELIVERABLE: "Missing deliverable",
  INCORRECT_COMPLETION: "Completed by mistake", CUSTOMER_AMENDMENT: "Customer-requested amendment", OTHER: "Other",
});

export const statusError = (status, code, message, details) => projectError(status, code, message, details);

// A reason code from one of the lists; "Other" (or no code) needs words of its own.
export function reasonOf(list, input, { required = true, field = "reason" } = {}) {
  const code = input.reasonCode ? String(input.reasonCode).toUpperCase() : null;
  if (code && !list[code]) throw statusError(400, "PROJECT_INPUT_INVALID", "Choose one of the listed reasons.", { field: "reasonCode" });
  const text = String(input.reason ?? input.reasonText ?? "").trim().slice(0, 2000);
  if (required && (!code || code === "OTHER") && text.length < 3) return { missing: true, code, text, field };
  return { missing: false, code: code ?? (text ? "OTHER" : null), text: text || (code ? list[code] : null) };
}

// What a project's status lets its work do: OPEN (in progress: plan and execute), NOT_STARTED (planned or draft: plan only), ON_HOLD (plan and
// administer, no new execution), CLOSED (completed, cancelled, archived or removed: read-only). Tasks, milestones and time ask here.
export function executionState(project) {
  if (["COMPLETED", "CANCELLED"].includes(project.status) || project.archived_at || project.deleted_at) return "CLOSED";
  if (project.status === "ON_HOLD") return "ON_HOLD";
  if (project.status !== "IN_PROGRESS") return "NOT_STARTED";
  return "OPEN";
}

// Why an action cannot be taken from the project's current status (null when it can, as far as status goes).
export function transitionRefusal(project, action) {
  const rule = TRANSITIONS[action];
  if (!rule) return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: "Unknown status action." };
  if (project.archived_at) return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: "The project is archived: restore it first." };
  if (project.deleted_at) return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: "The draft was removed." };
  if (rule.from.includes(project.status)) return null;
  if (action === "hold" && project.status === "ON_HOLD") return { code: "PROJECT_STATUS_HOLD_ALREADY_ACTIVE", message: undefined };
  if (action === "cancel" && project.status === "DRAFT") return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: "A draft is not cancelled: discard it instead." };
  if (action === "cancel" && project.status === "COMPLETED") return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: "A completed project is not cancelled: reopen it through the authorized workflow." };
  if (action === "reopen") return { code: "PROJECT_STATUS_REOPEN_NOT_ALLOWED", message: undefined };
  return { code: "PROJECT_STATUS_INVALID_TRANSITION", message: `The project is ${STATUS_LABEL[project.status].toLowerCase()}: "${rule.label}" is not available.` };
}
export function assertTransition(project, action) {
  const refusal = transitionRefusal(project, action);
  if (refusal) throw statusError(409, refusal.code, refusal.message);
}

// The status actions for the project header: each with whether the person may take it now and, when not, why — the server checks again.
// context: { can (access.can), approvalPending, mayDecide, openBlockers, activationProblems }
export function availableActions(project, { can, approvalPending = false, openBlockers = 0, activationProblems = [] }) {
  const list = [];
  const offer = (action, allowedByRole, extraReason = null) => {
    if (transitionRefusal(project, action)) return;
    const reason = !allowedByRole ? "You do not have permission for this action." : extraReason;
    list.push({ action, label: action === "activate" && approvalPending ? "Waiting for approval" : TRANSITIONS[action].label, allowed: !reason, reason });
  };
  offer("activate", can.start, approvalPending ? "Activation is waiting for approval." : activationProblems.length ? activationProblems[0].message : null);
  offer("start", can.start);
  offer("hold", can.hold);
  offer("resume", can.resume, openBlockers ? `${openBlockers} hold reason(s) are still open: resolve each one first.` : null);
  offer("complete", can.complete);
  offer("reopen", can.reopen);
  offer("cancel", can.cancel);
  return list;
}
