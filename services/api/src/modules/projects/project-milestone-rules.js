// Projects — Milestones: what a milestone may be and do. The labels, who may act on one (company permission, intersected with project
// access and — for the owner's own work — ownership), where the project's tasks come from (the Tasks feature registers a source), the
// dependency cycle check, and the readiness check that decides whether a milestone may be submitted or completed. Readiness explains every
// condition; it never completes anything by itself.
import { PROJECT, has } from "./project-core.js";

export const MILESTONE_STATUS_LABEL = Object.freeze({
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", BLOCKED: "Blocked", SUBMITTED: "Submitted", COMPLETED: "Completed", CANCELLED: "Cancelled" });
export const APPROVAL_LABEL = Object.freeze({
  NOT_REQUIRED: "No approval needed", NOT_SUBMITTED: "Not submitted", PENDING: "Pending review", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", REJECTED: "Rejected" });
export const MILESTONE_TYPES = Object.freeze({ DELIVERABLE: "Deliverable", APPROVAL: "Approval", PHASE_GATE: "Phase gate", OTHER: "Other" });
export const BLOCKER_CATEGORIES = Object.freeze({
  CUSTOMER_FEEDBACK: "Customer feedback pending", TASK_DELAYED: "Required task delayed", DOCUMENT_MISSING: "Required document missing", DEPENDENCY: "Dependency incomplete",
  RESOURCE: "Resource unavailable", APPROVAL: "Approval pending", OTHER: "Other" });
export const OPEN_STATUSES = Object.freeze(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "SUBMITTED"]);
// The customer's people who may accept a milestone: an active project contact in any role.
export const MILESTONE_ENTITY = "projects.milestone";

// ------------------------------------------------------------------ who may do what
// `access` is the project's (accessOf); a project lead is its manager or someone who sees every project. The owner works on their own
// milestone (deliverables, evidence, blockers, start, submit, complete) with the company permission for it; leads plan and decide.
export function milestoneAccess(c, access, milestone = null) {
  const lead = access.all || access.manager;
  const owner = Boolean(c.userId) && Boolean(milestone) && milestone.owner_user_id === c.userId;
  const may = (permission) => access.visible && has(c, permission);
  return {
    lead, owner,
    view: may(PROJECT.milestoneView),
    create: may(PROJECT.milestoneCreate) && lead,
    edit: may(PROJECT.milestoneEdit) && lead,
    assign: may(PROJECT.milestoneAssign) && lead,
    links: may(PROJECT.milestoneLinks) && lead,
    work: may(PROJECT.milestoneView) && access.can.contribute && (lead || owner),
    submit: may(PROJECT.milestoneSubmit) && (lead || owner),
    approve: may(PROJECT.milestoneApprove),
    customer: may(PROJECT.milestoneCustomer) && (lead || owner || access.role === "MANAGER"),
    waive: may(PROJECT.milestoneWaive) && lead,
    complete: may(PROJECT.milestoneComplete) && (lead || owner),
    reopen: may(PROJECT.milestoneReopen) && lead,
    cancel: may(PROJECT.milestoneCancel) && lead,
    billing: may(PROJECT.milestoneBilling),
    billingRequest: may(PROJECT.milestoneComplete) && lead,
    export: may(PROJECT.milestoneExport),
  };
}

// ------------------------------------------------------------------ the project's tasks
// The Tasks feature owns tasks. It registers one source: { load(client, c, projectId, taskIds) -> Map(id -> { id, projectId, title, code, status,
// completed, cancelled }), search(client, c, projectId, term) -> [task] }. Until one is registered, milestones link no tasks and readiness says so.
let TASK_SOURCE = null;
export function registerMilestoneTaskSource(source) {
  if (source && typeof source.load === "function") TASK_SOURCE = source;
}
export const taskSource = () => TASK_SOURCE;

// ------------------------------------------------------------------ dependencies
// Would `milestoneId` depending on `prerequisiteId` close a loop? `edges` are the project's active [milestone, prerequisite] pairs.
export function createsCycle(edges, milestoneId, prerequisiteId) {
  const prerequisitesOf = new Map();
  for (const [milestone, prerequisite] of edges) prerequisitesOf.set(milestone, [...(prerequisitesOf.get(milestone) ?? []), prerequisite]);
  // A loop exists if the prerequisite (transitively) already depends on the milestone.
  const seen = new Set();
  const stack = [prerequisiteId];
  while (stack.length) {
    const next = stack.pop();
    if (next === milestoneId) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(prerequisitesOf.get(next) ?? []));
  }
  return false;
}

// ------------------------------------------------------------------ readiness
// Each check: { key, label, state: PASS | FAIL | NOT_TRACKED | WAIVED, message, blocking }. `stage` is "submit" (approvals not yet asked) or
// "complete". `exceptions` holds an authorized exception for prerequisites ({ dependencies: reason }).
export function readinessOf({ milestone, project, criteria, tasks, prerequisites, blockers, approvals, stage = "complete", exceptions = {} }) {
  const checks = [];
  const add = (key, label, state, message) => checks.push({ key, label, state, message, blocking: state === "FAIL" });
  if (project.status === "ON_HOLD") add("project", "Project", "FAIL", "Project work is on Hold.");
  else if (project.status !== "IN_PROGRESS") add("project", "Project", "FAIL", `The project is ${String(project.status).toLowerCase().replace(/_/g, " ")}: milestones are submitted and completed while it is in progress.`);
  else add("project", "Project", "PASS", "The project is in progress.");

  const live = criteria.filter((row) => !row.removed_at);
  if (!live.length) add("criteria", "Completion criteria", "FAIL", "Add at least one completion criterion.");
  else {
    const open = live.filter((row) => row.is_required && row.status === "PENDING");
    const waived = live.filter((row) => row.status === "WAIVED").length;
    add("criteria", "Completion criteria", open.length ? "FAIL" : "PASS", open.length
      ? `${open.length} required deliverable(s) outstanding: ${open.map((row) => row.description).slice(0, 3).join("; ")}.`
      : `Every required deliverable is complete${waived ? ` (${waived} waived)` : ""}.`);
    const unproven = live.filter((row) => row.status === "COMPLETED" && row.evidence_required && !row.evidence_file_id && !String(row.evidence_note ?? "").trim());
    add("evidence", "Evidence", unproven.length ? "FAIL" : "PASS", unproven.length ? `Evidence is missing for: ${unproven.map((row) => row.description).join("; ")}.` : "Required evidence is attached.");
  }

  if (tasks === null) add("tasks", "Required tasks", "NOT_TRACKED", "Project tasks are not tracked yet; the milestone does not wait for them.");
  else {
    const required = tasks.filter((row) => row.is_required);
    const open = required.filter((row) => !row.task?.completed && !(row.task?.cancelled && String(row.disposition ?? "").trim().length >= 3));
    const undisposed = required.filter((row) => row.task?.cancelled && String(row.disposition ?? "").trim().length < 3);
    add("tasks", "Required tasks", open.length ? "FAIL" : "PASS", open.length
      ? `${open.length} required task(s) not complete${undisposed.length ? ` (${undisposed.length} cancelled without a disposition)` : ""}.`
      : required.length ? "Every required task is complete or resolved." : "No required tasks are linked.");
  }

  const unmet = prerequisites.filter((row) => row.status !== "COMPLETED");
  if (!unmet.length) add("dependencies", "Prerequisite milestones", "PASS", prerequisites.length ? "Every prerequisite milestone is complete." : "No prerequisites.");
  else if (exceptions.dependencies) add("dependencies", "Prerequisite milestones", "WAIVED", `Proceeding before ${unmet.map((row) => row.milestone_code).join(", ")} by authorized exception: ${exceptions.dependencies}`);
  else add("dependencies", "Prerequisite milestones", "FAIL", `Waiting for ${unmet.map((row) => `${row.milestone_code} ${row.name}`).join(", ")}.`);

  const open = blockers.filter((row) => row.status === "OPEN");
  add("blockers", "Blockers", open.length ? "FAIL" : "PASS", open.length ? `${open.length} open blocker(s): ${open.map((row) => row.description).slice(0, 2).join("; ")}.` : "No open blockers.");

  if (stage === "complete") {
    const current = approvals.filter((row) => row.submission_id === milestone.current_submission_id && row.scope_version === milestone.scope_version);
    if (milestone.internal_approval_required) {
      const decision = current.find((row) => row.reviewer_type === "INTERNAL");
      add("internal", "Internal approval", decision?.decision === "APPROVED" ? "PASS" : "FAIL",
        decision?.decision === "APPROVED" ? "Approved internally." : milestone.status === "SUBMITTED" ? "Waiting for internal approval." : "Submit the milestone for internal approval.");
    }
    if (milestone.customer_acceptance_required) {
      const decision = current.find((row) => row.reviewer_type === "CUSTOMER");
      add("customer", "Customer acceptance", decision?.decision === "APPROVED" ? "PASS" : "FAIL",
        decision?.decision === "APPROVED" ? "The customer's acceptance is recorded." : "Record the customer's acceptance from the evidence received.");
    }
  }
  return { ready: !checks.some((row) => row.blocking), checks };
}

// The approval state after a decision on the current submission: PENDING until every required decision is APPROVED.
export function approvalAfter(milestone, approvals) {
  const current = approvals.filter((row) => row.submission_id === milestone.current_submission_id);
  if (current.some((row) => row.decision === "REJECTED")) return "REJECTED";
  if (current.some((row) => row.decision === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  const internal = !milestone.internal_approval_required || current.some((row) => row.reviewer_type === "INTERNAL" && row.decision === "APPROVED");
  const customer = !milestone.customer_acceptance_required || current.some((row) => row.reviewer_type === "CUSTOMER" && row.decision === "APPROVED");
  return internal && customer ? "APPROVED" : "PENDING";
}
export const needsApproval = (milestone) => Boolean(milestone.internal_approval_required || milestone.customer_acceptance_required);
