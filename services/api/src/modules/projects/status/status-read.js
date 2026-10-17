// Projects — Project Status, the reads: whether a draft is ready to activate, the hold and its blockers, whether a held project may resume,
// whether an in-progress project may complete (and what a completion would record), what a cancellation or a reopening touches, the
// actions a person may take now, the status timeline and the status reports. Nothing here changes anything.
import {
  PROJECT, STATUS_LABEL, eligibleUsers, has, isoDay, projectSettings, today, userNames, visibilitySql, visibleProject,
} from "../project-core.js";
import { contactRecord, customerRecord, projectParty } from "../project-customer-rules.js";
import { mismatchedLinks } from "../project-service.js";
import { resolvedLinks, workSummaries } from "../project-summary.js";
import { CANCEL_REASONS, HOLD_REASONS, HOLD_SEVERITIES, REOPEN_REASONS, availableActions, statusError } from "./status-rules.js";

const day = (value) => (value ? isoDay(value) : null);
const OPEN_TASKS = `('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW')`;
const OPEN_MILESTONES = `('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED')`;

// ------------------------------------------------------------------ activation
// What activation needs, each problem with the field to fix. Tasks and milestones are not needed: planning may start before the work is broken down.
export function activationProblems(project, settings = {}) {
  const problems = [];
  if (!project.name) problems.push({ code: "PROJECT_STATUS_ACTIVATION_INCOMPLETE", field: "name", message: "Enter a project name." });
  if (!project.project_type_id) problems.push({ code: "PROJECT_STATUS_ACTIVATION_INCOMPLETE", field: "projectTypeId", message: "Choose the project type." });
  if (project.classification === "CUSTOMER" && !project.customer_id) {
    problems.push(project.crm_account_id ? { code: "PROJECT_CUSTOMER_MAPPING_UNRESOLVED", field: "customerId", message: "The CRM Account must be linked to a valid Customer record before activation." }
      : { code: "PROJECT_CUSTOMER_REQUIRED", field: "customerId", message: "Select a customer before activating this project." });
  }
  if (project.classification === "CUSTOMER" && project.customer_id && settings.primaryContactRequired && !project.customer_contact_id) {
    problems.push({ code: "PROJECT_CUSTOMER_CONTACT_INVALID", field: "customerContactId", message: "Choose the customer's primary contact before activating this project." });
  }
  if (!project.manager_user_id) problems.push({ code: "PROJECT_STATUS_MANAGER_REQUIRED", field: "managerUserId", message: "Assign a Project Manager before activating this project." });
  if (!project.planned_start_date) problems.push({ code: "PROJECT_STATUS_ACTIVATION_INCOMPLETE", field: "plannedStartDate", message: "Enter the planned start date." });
  if (!project.target_end_date) problems.push({ code: "PROJECT_STATUS_ACTIVATION_INCOMPLETE", field: "targetEndDate", message: "Enter the target end date." });
  return problems;
}
export async function activationReadiness(client, c, project) {
  const settings = await projectSettings(client, c);
  const problems = activationProblems(project, settings);
  if (project.manager_user_id && !(await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id)) {
    problems.push({ code: "PROJECT_STATUS_MANAGER_REQUIRED", field: "managerUserId", message: "The Project Manager is no longer an active, authorized member: assign an active Project Manager." });
  }
  if (project.customer_id) {
    try { await customerRecord(client, c, project.customer_id, { purpose: "new", settings }); } catch (error) {
      problems.push({ code: error.code ?? "PROJECT_CUSTOMER_NOT_FOUND", field: "customerId", message: error.message });
    }
    if (project.customer_contact_id) {
      try { await contactRecord(client, c, project.customer_contact_id, project.customer_id); } catch (error) {
        problems.push({ code: "PROJECT_CUSTOMER_CONTACT_INVALID", field: "customerContactId", message: `The primary contact is no longer an active contact of the customer: ${error.message}` });
      }
    }
  }
  if (project.classification === "CUSTOMER" && projectParty(project)) {
    for (const mismatch of await mismatchedLinks(client, c, project, projectParty(project))) {
      problems.push({ code: "PROJECT_CUSTOMER_SALES_MISMATCH", field: "links", message: `${mismatch.label} belongs to another customer: unlink it before activating.` });
    }
  }
  return { ready: problems.length === 0, problems, approvalRequired: settings.activationApprovalRequired };
}
export async function validateProjectActivation(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return activationReadiness(client, c, project);
}

// ------------------------------------------------------------------ hold
// The active hold episode and every blocker in it (resolved or not), or null.
export async function holdOf(client, c, projectId) {
  const hold = (await client.query(`SELECT * FROM tenant.project_holds WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`, [c.organizationId, projectId])).rows[0];
  if (!hold) return null;
  const reasons = (await client.query(`SELECT * FROM tenant.project_hold_reasons WHERE organization_id = $1 AND hold_id = $2 ORDER BY added_at`, [c.organizationId, hold.id])).rows;
  const sources = await sourceLabels(client, c, reasons);
  const names = await userNames(client, [hold.started_by, hold.owner_user_id, ...reasons.flatMap((row) => [row.owner_user_id, row.added_by, row.resolved_by])]);
  return {
    id: hold.id, previousStatus: hold.previous_status, previousStatusLabel: STATUS_LABEL[hold.previous_status], startedAt: hold.started_at, startedBy: names.get(hold.started_by) ?? null,
    owner: names.get(hold.owner_user_id) ?? null, expectedResolutionDate: day(hold.expected_resolution_date), summary: hold.reason,
    reasons: reasons.map((row) => ({
      id: row.id, reasonCode: row.reason_code, reasonLabel: HOLD_REASONS[row.reason_code], description: row.description, severity: row.severity, severityLabel: HOLD_SEVERITIES[row.severity],
      ownerUserId: row.owner_user_id, owner: names.get(row.owner_user_id) ?? null, source: row.source_type ? { type: row.source_type, id: row.source_id, label: sources.get(row.source_id) ?? null } : null,
      evidence: row.evidence, addedAt: row.added_at, addedBy: names.get(row.added_by) ?? null,
      resolved: Boolean(row.resolved_at), resolvedAt: row.resolved_at, resolvedBy: names.get(row.resolved_by) ?? null, resolution: row.resolution, resolutionEvidence: row.resolution_evidence,
    })),
    open: reasons.filter((row) => !row.resolved_at).length,
  };
}
async function sourceLabels(client, c, reasons) {
  const tasks = reasons.filter((row) => row.source_type === "TASK").map((row) => row.source_id);
  const milestones = reasons.filter((row) => row.source_type === "MILESTONE").map((row) => row.source_id);
  const rows = [
    ...(tasks.length ? (await client.query(`SELECT id, task_code || ' ' || title AS label FROM tenant.project_tasks WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, tasks])).rows : []),
    ...(milestones.length ? (await client.query(`SELECT id, milestone_code || ' ' || name AS label FROM tenant.project_milestones WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, milestones])).rows : []),
  ];
  return new Map(rows.map((row) => [row.id, row.label]));
}
// Whether a held project may resume now, and to which status.
export async function resumeReadiness(client, c, project) {
  const hold = await holdOf(client, c, project.id);
  const checks = [];
  const add = (key, label, pass, message) => checks.push({ key, label, state: pass ? "PASS" : "FAIL", message, blocking: !pass });
  add("status", "On hold", project.status === "ON_HOLD", project.status === "ON_HOLD" ? "The project is on hold." : `The project is ${STATUS_LABEL[project.status].toLowerCase()}.`);
  if (hold) add("blockers", "Hold reasons", hold.open === 0, hold.open ? `${hold.open} hold reason(s) are still open: ${hold.reasons.filter((row) => !row.resolved).map((row) => row.reasonLabel).join(", ")}.` : "Every hold reason is resolved.");
  const managerActive = Boolean(project.manager_user_id) && (await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id);
  add("manager", "Project Manager", managerActive, managerActive ? "The Project Manager is active." : "Assign an active Project Manager before resuming.");
  return { ready: !checks.some((row) => row.blocking), resumesTo: hold?.previousStatus ?? project.previous_status, resumesToLabel: STATUS_LABEL[hold?.previousStatus ?? project.previous_status] ?? null, checks, hold };
}

// ------------------------------------------------------------------ completion
const OPEN_PO = (status) => !["closed", "cancelled"].includes(String(status ?? "").toLowerCase());
// Each check: { key, label, state: PASS | FAIL | WARN | NOT_TRACKED | TO_CONFIRM, message, blocking }. In a preview (no input) what the person
// confirms at completion is TO_CONFIRM. input: { waivers?: [{ taskId, reason, impact }], deliverablesConfirmed, closingNote, customerAcceptance?,
// acknowledgeOutstanding?, completionDate? }
export async function completionReadiness(client, c, project, input = {}, { preview = false, access = null } = {}) {
  const settings = await projectSettings(client, c);
  const day0 = await today(client);
  const work = (await workSummaries(client, c, [project.id])).get(project.id);
  const links = await resolvedLinks(client, c, project.id, { financials: true });
  const checks = [];
  const add = (key, label, state, message, blocking = state === "FAIL", code = null) => checks.push({ key, label, state, message, blocking, ...(code ? { code } : {}) });
  add("status", "In progress", project.status === "IN_PROGRESS" ? "PASS" : "FAIL", project.status === "IN_PROGRESS" ? "The project is in progress." : `The project is ${STATUS_LABEL[project.status].toLowerCase()}.`,
    project.status !== "IN_PROGRESS", "PROJECT_STATUS_INVALID_TRANSITION");

  // Tasks: every open task is done, cancelled, or waived here (a waiver says what, why and its impact; an Urgent task is never waived).
  const openTasks = (await client.query(`SELECT id, task_code, title, priority FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status IN ${OPEN_TASKS}
      AND archived_at IS NULL ORDER BY task_code`, [c.organizationId, project.id])).rows;
  const waivers = [];
  for (const waiver of Array.isArray(input.waivers) ? input.waivers : []) {
    const task = openTasks.find((row) => row.id === waiver?.taskId);
    if (!task) continue;
    const reason = String(waiver.reason ?? "").trim();
    if (task.priority === "URGENT") throw statusError(400, "PROJECT_STATUS_REQUIRED_TASKS_OPEN", `${task.task_code} is Urgent: it is completed or cancelled, never waived.`);
    if (reason.length < 3) throw statusError(400, "PROJECT_INPUT_INVALID", `Say why ${task.task_code} is waived.`, { field: "waivers" });
    waivers.push({ type: "TASK", id: task.id, code: task.task_code, title: task.title, reason, impact: String(waiver.impact ?? "").trim() || null });
  }
  const unwaived = openTasks.filter((row) => !waivers.some((waiver) => waiver.id === row.id));
  if (!work.tasks) add("tasks", "Required tasks", "NOT_TRACKED", "Tasks are not tracked for projects yet.");
  else add("tasks", "Required tasks", unwaived.length ? "FAIL" : "PASS", unwaived.length
    ? `${unwaived.length} task(s) are still open: ${unwaived.slice(0, 5).map((row) => row.task_code).join(", ")}. Complete or cancel them, or waive one that no longer needs doing.`
    : openTasks.length ? `Every open task is waived (${waivers.length}).` : work.tasks.total ? "Every task is done (cancelled tasks do not count)." : "The project has no tasks.", undefined, "PROJECT_STATUS_REQUIRED_TASKS_OPEN");

  if (!work.milestones) add("milestones", "Required milestones", "NOT_TRACKED", "Milestones are not tracked for projects yet.");
  else add("milestones", "Required milestones", work.milestones.openRequired ? "FAIL" : "PASS", work.milestones.openRequired
    ? `${work.milestones.openRequired} required milestone(s) are still open${work.milestones.openRequiredNames?.length ? `: ${work.milestones.openRequiredNames.slice(0, 5).join(", ")}` : ""}. Complete them, or waive them on the milestone with a reason.`
    : work.milestones.total ? "Every required milestone is complete or waived." : "The project has no milestones.", undefined, "PROJECT_STATUS_MILESTONES_OPEN");

  // Customer acceptance comes from the milestones that need it — never from the project completion itself, and no project waiver replaces it.
  const awaiting = (await client.query(`SELECT milestone_code FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND customer_acceptance_required
      AND status IN ${OPEN_MILESTONES} ORDER BY milestone_code`, [c.organizationId, project.id])).rows;
  add("customer-acceptance", "Customer acceptance", awaiting.length ? "FAIL" : "PASS", awaiting.length
    ? `The customer has not accepted ${awaiting.map((row) => row.milestone_code).join(", ")}. Record the acceptance on each milestone first.` : "No milestone waits for the customer's acceptance.",
    undefined, "PROJECT_STATUS_CUSTOMER_ACCEPTANCE");

  const blockers = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_task_blockers blocker JOIN tenant.project_tasks task ON task.id = blocker.task_id
      WHERE blocker.organization_id = $1 AND task.project_id = $2 AND blocker.status = 'ACTIVE' AND task.status IN ${OPEN_TASKS}`, [c.organizationId, project.id])).rows[0].n);
  add("blockers", "Critical blockers", project.risk_flagged || blockers ? "FAIL" : "PASS", project.risk_flagged ? `A delivery risk is flagged: ${project.risk_note ?? ""} Clear it first.`
    : blockers ? `${blockers} task blocker(s) are active.` : "No blocker is open.");
  add("time", "Time entries and expenses", "NOT_TRACKED", "Time and expenses are not tracked for projects yet; nothing to process.", false);
  const openPurchases = links.filter((link) => link.sourceType === "PURCHASE_ORDER" && link.raw && OPEN_PO(link.raw.status));
  add("procurement", "Project purchasing", openPurchases.length ? "WARN" : "PASS", openPurchases.length ? `Open purchase order(s): ${openPurchases.map((link) => link.raw.number).join(", ")}. Procurement keeps them; completing the project does not close them.` : "No open project purchase orders.", false);
  // Delivery is not held back by collection: outstanding billing is acknowledged, never required to be paid.
  const unbilled = links.filter((link) => (link.sourceType === "SALES_ORDER" && link.raw && !["fully_invoiced", "not_billable"].includes(link.raw.billing_status))
    || (link.sourceType === "SALES_INVOICE" && link.raw && Number(link.raw.outstanding ?? 0) > 0));
  if (unbilled.length) {
    const acknowledged = Boolean(input.acknowledgeOutstanding);
    add("financial", "Billing and collection", acknowledged ? "PASS" : preview ? "TO_CONFIRM" : "FAIL",
      `${unbilled.map((link) => `${link.raw.number} (${link.sourceType === "SALES_ORDER" ? String(link.raw.billing_status).replace(/_/g, " ") : "outstanding"})`).join(", ")} — acknowledge that billing or collection continues after completion.`, !preview && !acknowledged);
  } else add("financial", "Billing and collection", "PASS", "Nothing outstanding on the linked sales records.");
  const confirm = (key, labelText, given, message) => add(key, labelText, given ? "PASS" : preview ? "TO_CONFIRM" : "FAIL", message, !preview && !given);
  confirm("deliverables", "Deliverables confirmed", Boolean(input.deliverablesConfirmed), "Confirm the project's deliverables were delivered.");
  if (settings.customerAcceptanceRequired && project.classification === "CUSTOMER") {
    confirm("acceptance", "Customer sign-off", String(input.customerAcceptance ?? "").trim().length >= 3, "Record the customer's sign-off (who accepted and how).");
  }
  confirm("note", "Closing notes", String(input.closingNote ?? "").trim().length >= 3, "Write the closing notes.");
  // The sign-off: the Project Manager, or someone who approves projects.
  if (access) {
    const mayApprove = access.manager || access.can.approve;
    add("signoff", "Project Manager sign-off", mayApprove ? "PASS" : "FAIL", mayApprove ? "You sign the completion off." : "The Project Manager or an authorized approver completes the project.",
      !mayApprove, "PROJECT_STATUS_COMPLETION_APPROVAL");
  }
  let completionDate = day0;
  if (input.completionDate) {
    completionDate = isoDay(input.completionDate);
    const started = day(project.actual_start_date);
    if (completionDate > day0) add("date", "Completion date", "FAIL", "The completion date cannot be in the future.");
    else if (started && completionDate < started) add("date", "Completion date", "FAIL", `The completion date cannot be before the start (${started}).`);
    else add("date", "Completion date", "PASS", `Completed on ${completionDate}.`);
  } else add("date", "Completion date", "PASS", `Completed today (${day0}) unless another date is given.`);
  return {
    checks, completionDate, waivers, ready: !checks.some((row) => row.blocking || (preview && row.state === "FAIL")),
    openTasks: openTasks.map((row) => ({ id: row.id, code: row.task_code, title: row.title, priority: row.priority, waivable: row.priority !== "URGENT" })),
    outstanding: checks.filter((row) => ["WARN", "NOT_TRACKED"].includes(row.state)).map((row) => ({ key: row.key, label: row.label, message: row.message })),
  };
}

// ------------------------------------------------------------------ cancellation and reopening
// What a cancellation touches — all of it stays as it is: open work, the team, recorded time, linked commercial records, an open hold.
export async function cancellationReview(client, c, project) {
  const links = await resolvedLinks(client, c, project.id, { financials: false });
  const dependencies = links.filter((link) => ["SALES_QUOTATION", "SALES_ORDER", "SALES_INVOICE", "PURCHASE_ORDER", "SUPPLIER_BILL"].includes(link.sourceType))
    .map((link) => ({ type: link.typeLabel, number: link.raw?.number ?? null, status: link.raw?.status ?? null,
      message: `${link.typeLabel} ${link.raw?.number ?? ""} stays as ${link.sourceModule === "PROCUREMENT" ? "Procurement" : link.sourceModule === "FINANCE" ? "Finance" : "Sales"} keeps it.` }));
  const members = Number((await client.query(`SELECT count(*) AS n FROM tenant.project_members WHERE project_id = $1 AND left_at IS NULL`, [project.id])).rows[0].n);
  const hold = await holdOf(client, c, project.id);
  const counts = (await client.query(`SELECT
      (SELECT count(*) FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status IN ${OPEN_TASKS})::int AS open_tasks,
      (SELECT count(DISTINCT assignee_user_id) FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status IN ${OPEN_TASKS})::int AS assignees,
      (SELECT count(*) FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND status IN ${OPEN_MILESTONES})::int AS open_milestones,
      (SELECT count(*) FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND id IN (SELECT milestone_id FROM tenant.project_milestone_billing_requests WHERE status = 'OPEN'))::int AS billing`,
    [c.organizationId, project.id])).rows[0];
  return {
    dependencies, members, hold: hold?.summary ?? null, openTasks: counts.open_tasks, openMilestones: counts.open_milestones, assignedPeople: counts.assignees,
    reasons: Object.entries(CANCEL_REASONS).map(([code, label]) => ({ code, label })),
    notes: [
      "Cancelling deletes nothing: tasks, milestones, linked documents, notes, files and history stay.",
      members > 1 ? `${members} people are on the team; they keep read access to the history.` : null,
      hold ? `The open hold is closed with the cancellation (${hold.summary}).` : null,
      counts.open_milestones ? `${counts.open_milestones} open milestone(s) stay as they are, read-only, with their history.` : null,
      counts.open_tasks ? `${counts.open_tasks} open task(s) for ${counts.assignees} person(s) stay as they are, read-only; time entries and expenses stay in their own modules.` : null,
      counts.billing ? `${counts.billing} milestone billing request(s) are still open with Sales; Sales decides on them.` : null,
      "Sales orders, invoices and payments are not reversed: Sales and Finance handle any amendment, credit note or refund.",
    ].filter(Boolean),
  };
}
// What a reopening must be reviewed against: accepted milestones (they stay accepted), done tasks (they stay done), issued billing (it stays).
export async function reopenReview(client, c, project) {
  const milestones = (await client.query(`SELECT milestone_code, name FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND status = 'COMPLETED' ORDER BY milestone_code`,
    [c.organizationId, project.id])).rows;
  const done = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status = 'DONE'`, [c.organizationId, project.id])).rows[0].n);
  const links = await resolvedLinks(client, c, project.id, { financials: false });
  const billing = links.filter((link) => ["SALES_ORDER", "SALES_INVOICE"].includes(link.sourceType)).map((link) => `${link.typeLabel} ${link.raw?.number ?? ""}`.trim());
  const completions = (await client.query(`SELECT completion_date, signed_off_at FROM tenant.project_completion_reviews WHERE organization_id = $1 AND project_id = $2 ORDER BY signed_off_at`,
    [c.organizationId, project.id])).rows;
  return {
    acceptedMilestones: milestones.map((row) => `${row.milestone_code} ${row.name}`), doneTasks: done, billing, reopenCount: project.reopen_count ?? 0,
    completedOn: day(project.completed_at), previousCompletions: completions.map((row) => day(row.completion_date)),
    reasons: Object.entries(REOPEN_REASONS).map(([code, label]) => ({ code, label })),
    needsAcknowledgement: milestones.length > 0 || billing.length > 0,
    notes: [
      "The original completion stays in the history; reopening adds a new event.",
      milestones.length ? `${milestones.length} accepted milestone(s) stay accepted with their evidence; add new milestones for new work.` : null,
      done ? `${done} done task(s) stay done unless someone reopens one of them.` : null,
      billing.length ? `Issued billing stays as it is (${billing.join(", ")}); Finance handles any adjustment.` : null,
    ].filter(Boolean),
  };
}

// ------------------------------------------------------------------ the status view
export async function getProjectStatus(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const hold = project.status === "ON_HOLD" ? await holdOf(client, c, project.id) : null;
  const activation = project.status === "DRAFT" ? await activationReadiness(client, c, project) : null;
  return {
    projectId: project.id, code: project.project_code, status: project.status, statusLabel: STATUS_LABEL[project.status], previousStatus: project.previous_status,
    archived: Boolean(project.archived_at), plannedStartDate: day(project.planned_start_date), actualStartDate: day(project.actual_start_date), targetEndDate: day(project.target_end_date),
    completedAt: day(project.completed_at), reopenCount: project.reopen_count ?? 0, lastReopenedAt: project.last_reopened_at, version: project.row_version, hold, activation,
    actions: availableActions(project, { can: access.can, approvalPending: project.approval_status === "PENDING", openBlockers: hold?.open ?? 0, activationProblems: activation?.problems ?? [] }),
  };
}
export async function getAvailableProjectActions(client, c, projectId) {
  return (await getProjectStatus(client, c, projectId)).actions;
}
export async function getProjectHold(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return holdOf(client, c, project.id);
}
export async function getProjectResumeReadiness(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return resumeReadiness(client, c, project);
}
export async function getProjectCompletionReadiness(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId);
  return completionReadiness(client, c, project, {}, { preview: true, access });
}
export async function getProjectCancellationReview(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return cancellationReview(client, c, project);
}
export async function getProjectReopenReview(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return reopenReview(client, c, project);
}
// Every status change, oldest first: from, to, why (code and words), who, when, the version it applied to; plus each completion's review.
export async function getProjectStatusHistory(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  const rows = (await client.query(`SELECT * FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at`, [c.organizationId, project.id])).rows;
  const reviews = (await client.query(`SELECT * FROM tenant.project_completion_reviews WHERE organization_id = $1 AND project_id = $2 ORDER BY signed_off_at`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, [...rows.map((row) => row.actor_user_id), ...reviews.map((row) => row.signed_off_by)]);
  return {
    transitions: rows.map((row) => ({ action: row.action, from: row.from_status, fromLabel: STATUS_LABEL[row.from_status] ?? null, to: row.to_status, toLabel: STATUS_LABEL[row.to_status],
      reasonCode: row.reason_code, reason: row.reason, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at, version: row.project_version })),
    completions: reviews.map((row) => ({ completionDate: day(row.completion_date), signedOffBy: names.get(row.signed_off_by) ?? null, signedOffAt: row.signed_off_at, closingNote: row.closing_note,
      customerAcceptance: row.customer_acceptance, waivers: row.waivers ?? [], outstanding: row.outstanding ?? [] })),
  };
}
// Whether a status command sent with this key was applied (after a lost answer: check, never resend blindly).
export async function getTransitionOutcome(client, c, projectId, key) {
  const { project } = await visibleProject(client, c, projectId);
  const row = key ? (await client.query(`SELECT action, to_status, occurred_at FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2 AND idempotency_key = $3`,
    [c.organizationId, project.id, String(key).slice(0, 200)])).rows[0] : null;
  return row ? { applied: true, action: row.action, status: row.to_status, at: row.occurred_at } : { applied: false, status: project.status };
}

// ------------------------------------------------------------------ reports
export const STATUS_REPORTS = Object.freeze(["by-status", "active", "planned", "on-hold", "completed", "cancelled", "status-changes", "hold-duration", "completion-exceptions", "reopened"]);
export async function getProjectStatusReport(client, c, kind = "by-status") {
  if (!STATUS_REPORTS.includes(kind)) throw statusError(400, "PROJECT_INPUT_INVALID", "Unknown status report.");
  if (!has(c, PROJECT.reports) && !has(c, PROJECT.viewAll)) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null];
  const visible = `project.deleted_at IS NULL AND ${visibilitySql(c, "project", "$2")}`;
  const manager = `(SELECT COALESCE(NULLIF(full_name, ''), email) FROM public.users WHERE id = project.manager_user_id)`;
  const base = `SELECT project.id, project.project_code, project.name, project.status, project.target_end_date, project.actual_start_date, project.completed_at, project.cancel_reason,
      project.cancelled_at, project.reopen_count, project.last_reopened_at, project.archived_at, ${manager} AS manager FROM tenant.projects project WHERE project.organization_id = $1 AND ${visible}`;
  const shape = (row) => ({ id: row.id, code: row.project_code, name: row.name, status: row.status, statusLabel: STATUS_LABEL[row.status], manager: row.manager,
    targetEndDate: day(row.target_end_date), actualStartDate: day(row.actual_start_date), completedAt: day(row.completed_at), archived: Boolean(row.archived_at) });
  if (kind === "by-status") {
    const rows = (await client.query(`SELECT project.status, count(*)::int AS n, count(*) FILTER (WHERE project.archived_at IS NOT NULL)::int AS archived FROM tenant.projects project
        WHERE project.organization_id = $1 AND ${visible} GROUP BY project.status`, values)).rows;
    return Object.keys(STATUS_LABEL).map((status) => ({ status, label: STATUS_LABEL[status], total: rows.find((row) => row.status === status)?.n ?? 0, archived: rows.find((row) => row.status === status)?.archived ?? 0 }));
  }
  const byStatus = { active: "IN_PROGRESS", planned: "PLANNED", completed: "COMPLETED", cancelled: "CANCELLED" };
  if (byStatus[kind]) {
    const rows = (await client.query(`${base} AND project.status = $3 ORDER BY project.target_end_date NULLS LAST, project.project_code`, [...values, byStatus[kind]])).rows;
    return rows.map((row) => ({ ...shape(row), ...(kind === "cancelled" ? { cancelReason: row.cancel_reason, cancelledAt: row.cancelled_at } : {}) }));
  }
  if (kind === "on-hold" || kind === "hold-duration") {
    const rows = (await client.query(`SELECT hold.*, project.project_code, project.name, project.status, ${manager} AS manager,
        (SELECT count(*) FROM tenant.project_hold_reasons reason WHERE reason.hold_id = hold.id)::int AS reasons,
        (SELECT count(*) FROM tenant.project_hold_reasons reason WHERE reason.hold_id = hold.id AND reason.resolved_at IS NULL)::int AS open_reasons,
        (SELECT string_agg(reason.description, '; ' ORDER BY reason.added_at) FROM tenant.project_hold_reasons reason WHERE reason.hold_id = hold.id AND reason.resolved_at IS NULL) AS open_text
       FROM tenant.project_holds hold JOIN tenant.projects project ON project.id = hold.project_id
      WHERE hold.organization_id = $1 AND ${visible} ${kind === "on-hold" ? "AND hold.resolved_at IS NULL" : ""} ORDER BY hold.started_at DESC LIMIT 500`, values)).rows;
    const now = Date.now();
    return rows.map((row) => ({ projectId: row.project_id, code: row.project_code, name: row.name, status: row.status, statusLabel: STATUS_LABEL[row.status], manager: row.manager,
      startedAt: row.started_at, endedAt: row.resolved_at, days: Math.max(0, Math.round(((row.resolved_at ? new Date(row.resolved_at).getTime() : now) - new Date(row.started_at).getTime()) / 864e5)),
      reasons: row.reasons, openReasons: row.open_reasons, openText: row.open_text ?? null, summary: row.reason }));
  }
  if (kind === "status-changes") {
    const rows = (await client.query(`SELECT event.*, project.project_code, project.name FROM tenant.project_status_events event JOIN tenant.projects project ON project.id = event.project_id
        WHERE event.organization_id = $1 AND ${visible} ORDER BY event.occurred_at DESC LIMIT 500`, values)).rows;
    const names = await userNames(client, rows.map((row) => row.actor_user_id));
    return rows.map((row) => ({ projectId: row.project_id, code: row.project_code, name: row.name, action: row.action, fromLabel: STATUS_LABEL[row.from_status] ?? null, toLabel: STATUS_LABEL[row.to_status],
      reasonCode: row.reason_code, reason: row.reason, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
  }
  if (kind === "completion-exceptions") {
    // Completions that waived work or left something to acknowledge (billing, purchasing, untracked time).
    const rows = (await client.query(`SELECT review.*, project.project_code, project.name, project.status FROM tenant.project_completion_reviews review JOIN tenant.projects project ON project.id = review.project_id
        WHERE review.organization_id = $1 AND ${visible} AND (jsonb_array_length(review.waivers) > 0 OR jsonb_array_length(review.outstanding) > 0) ORDER BY review.signed_off_at DESC LIMIT 500`, values)).rows;
    const names = await userNames(client, rows.map((row) => row.signed_off_by));
    return rows.map((row) => ({ projectId: row.project_id, code: row.project_code, name: row.name, statusLabel: STATUS_LABEL[row.status], completionDate: day(row.completion_date),
      signedOffBy: names.get(row.signed_off_by) ?? null, waivers: row.waivers ?? [], outstanding: row.outstanding ?? [] }));
  }
  // reopened
  const rows = (await client.query(`${base} AND project.reopen_count > 0 ORDER BY project.last_reopened_at DESC NULLS LAST`, values)).rows;
  return rows.map((row) => ({ ...shape(row), reopenCount: row.reopen_count, lastReopenedAt: row.last_reopened_at }));
}
