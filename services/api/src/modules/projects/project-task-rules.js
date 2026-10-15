// Projects — Tasks: what a task may be and do. The labels, who may act on one (company permission, intersected with project access and — for
// the assignee's own work — assignment), the extension points other features plug into (time entries and expenses that reference a task),
// and the one readiness check every completion path uses — the task page, the board and bulk changes alike. Readiness explains each
// condition; it never completes anything by itself.
import { PROJECT, has } from "./project-core.js";

export const TASK_STATUS_LABEL = Object.freeze({
  TO_DO: "To do", IN_PROGRESS: "In progress", BLOCKED: "Blocked", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" });
export const TASK_APPROVAL_LABEL = Object.freeze({
  NOT_REQUIRED: "No review", NOT_SUBMITTED: "Not submitted", PENDING: "Awaiting review", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected" });
export const TASK_TYPES = Object.freeze({
  GENERAL: "General", DESIGN: "Design", BUILD: "Build", CONFIGURATION: "Configuration", DATA: "Data", TESTING: "Testing", DOCUMENTATION: "Documentation", MEETING: "Meeting", OTHER: "Other" });
export const BLOCKER_REASONS = Object.freeze({
  CUSTOMER_RESPONSE: "Waiting for customer response", MISSING_REQUIREMENTS: "Missing requirements", WAITING_ON_TASK: "Awaiting another task", RESOURCE: "Resource unavailable",
  APPROVAL: "Pending approval", TECHNICAL: "Technical problem", OTHER: "Other" });
export const OPEN_TASK_STATUSES = Object.freeze(["TO_DO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"]);
export const TASK_ENTITY = "projects.task";

// ------------------------------------------------------------------ who may do what
// `access` is the project's (accessOf). A lead is the project's manager or someone who sees every project; the assignee works on their own
// task; a named reviewer reviews it. A project role never grants what the company role denies.
export function taskAccess(c, access, task = null) {
  const lead = access.all || access.manager;
  const assignee = Boolean(c.userId) && Boolean(task) && task.assignee_user_id === c.userId;
  const reviewer = Boolean(c.userId) && Boolean(task) && task.reviewer_user_id === c.userId;
  const may = (permission) => access.visible && has(c, permission);
  const contributor = access.can.contribute;
  return {
    lead, assignee, reviewer,
    view: may(PROJECT.taskView),
    create: may(PROJECT.taskCreate) && lead,
    edit: may(PROJECT.taskEdit) && lead,
    assign: may(PROJECT.taskAssign) && lead,
    start: may(PROJECT.taskStart) && contributor && (lead || assignee),
    block: may(PROJECT.taskBlock) && contributor && (lead || assignee),
    complete: may(PROJECT.taskComplete) && contributor && (lead || assignee),
    submit: may(PROJECT.taskSubmit) && contributor && (lead || assignee),
    approve: may(PROJECT.taskApprove) && (lead || reviewer),
    requestChanges: may(PROJECT.taskRequestChanges) && (lead || reviewer),
    reopen: may(PROJECT.taskReopen) && lead,
    cancel: may(PROJECT.taskCancel) && lead,
    bulk: may(PROJECT.taskBulk) && lead,
    export: may(PROJECT.taskExport),
    comment: may(PROJECT.taskView) && contributor,
    // An authorized exception (starting before a prerequisite is done): a lead who may edit the task.
    exception: may(PROJECT.taskEdit) && lead,
  };
}

// ------------------------------------------------------------------ records other features keep against a task
// Time Tracking and Expenses own their entries; each registers { key, label, summarize(client, c, taskIds) -> Map(taskId -> { count, label })
// }. A task never creates, moves or deletes them: reassigning or cancelling it leaves them where they are.
const RECORD_SOURCES = [];
export function registerTaskRecordSource(source) {
  if (source && typeof source.summarize === "function" && !RECORD_SOURCES.some((row) => row.key === source.key)) RECORD_SOURCES.push(source);
}
export const taskRecordSources = () => RECORD_SOURCES.slice();

// ------------------------------------------------------------------ dependencies
// Would `taskId` depending on `prerequisiteId` close a loop? `edges` are the project's active [task, prerequisite] pairs.
export function createsTaskCycle(edges, taskId, prerequisiteId) {
  const prerequisitesOf = new Map();
  for (const [task, prerequisite] of edges) prerequisitesOf.set(task, [...(prerequisitesOf.get(task) ?? []), prerequisite]);
  const seen = new Set();
  const stack = [prerequisiteId];
  while (stack.length) {
    const next = stack.pop();
    if (next === taskId) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(prerequisitesOf.get(next) ?? []));
  }
  return false;
}

// ------------------------------------------------------------------ readiness
// Each check: { key, label, state: PASS | FAIL | WAIVED, message, blocking }. `stage`: "start", "submit" (review not yet asked) or "complete".
// `exceptions` holds an authorized exception for prerequisites ({ dependencies: reason }); `evidence` what shows the work is done.
export function taskReadiness({ task, project, checklist, prerequisites, blockers, decision, files = 0, stage = "complete", exceptions = {} }) {
  const checks = [];
  const add = (key, label, state, message) => checks.push({ key, label, state, message, blocking: state === "FAIL" });
  if (project.status === "ON_HOLD") add("project", "Project", "FAIL", "The project is on Hold: task work is paused until it resumes.");
  else if (project.status !== "IN_PROGRESS") add("project", "Project", "FAIL", `The project is ${String(project.status).toLowerCase().replace(/_/g, " ")}: tasks are worked on while it is in progress.`);
  else add("project", "Project", "PASS", "The project is in progress.");

  const unmet = prerequisites.filter((row) => row.status !== "DONE");
  if (!unmet.length) add("dependencies", "Earlier tasks", "PASS", prerequisites.length ? "Every earlier task is done." : "No earlier tasks.");
  else if (exceptions.dependencies) add("dependencies", "Earlier tasks", "WAIVED", `Proceeding before ${unmet.map((row) => row.task_code).join(", ")} by authorized exception: ${exceptions.dependencies}`);
  else add("dependencies", "Earlier tasks", "FAIL", `Waiting for ${unmet.map((row) => `${row.task_code} ${row.title}`).join(", ")}.`);

  const active = blockers.filter((row) => row.status === "ACTIVE");
  add("blockers", "Blockers", active.length ? "FAIL" : "PASS", active.length ? `${active.length} active blocker(s): ${active.map((row) => row.description).slice(0, 2).join("; ")}.` : "No active blockers.");
  if (stage === "start") return { ready: !checks.some((row) => row.blocking), checks };

  const live = checklist.filter((row) => !row.removed_at);
  const open = live.filter((row) => row.is_required && row.status === "PENDING");
  add("checklist", "Checklist", open.length ? "FAIL" : "PASS", open.length
    ? `${open.length} required checklist item(s) outstanding: ${open.map((row) => row.title).slice(0, 3).join("; ")}.`
    : live.length ? "Every required checklist item is done or waived." : "No checklist.");
  if (task.evidence_required) {
    const proven = Boolean(String(task.completion_note ?? "").trim() || String(task.evidence_reference ?? "").trim() || files > 0);
    add("evidence", "Completion evidence", proven ? "PASS" : "FAIL", proven ? "Completion evidence is recorded." : "Add the completion evidence: a note, a file or a document reference.");
  }
  if (stage === "complete" && task.review_required) {
    const approved = decision?.decision === "APPROVED" && decision.review_id === task.current_review_id && decision.scope_version === task.scope_version;
    add("review", "Review", approved ? "PASS" : "FAIL", approved ? "Approved in review." : task.status === "IN_REVIEW" ? "Waiting for the review decision." : "Submit the task for review.");
  }
  return { ready: !checks.some((row) => row.blocking), checks };
}
