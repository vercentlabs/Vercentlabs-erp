// Projects — Milestones, read: one milestone with its deliverables, task links, dependencies, blockers, submissions and decisions, billing and
// readiness; a project's milestones (list and timeline); the company-wide queue; reports; export; deadline alerts; and the work source that
// feeds project progress, health and the completion check. Everything is rebuilt from the milestone's own records on each read.
import { createNotification } from "../../core/platform/notifications/index.js";
import { PROJECT, has, isoDay, projectError, text, userNames, uuid, visibleProject, visibilitySql } from "./project-core.js";
import { registerProjectWorkSource } from "./project-summary.js";
import {
  APPROVAL_LABEL, BLOCKER_CATEGORIES, MILESTONE_STATUS_LABEL, MILESTONE_TYPES, OPEN_STATUSES, milestoneAccess, readinessOf, taskSource,
} from "./project-milestone-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const day = (value) => (value ? isoDay(value) : null);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

// Today in the organization's time zone.
export async function orgDay(client, c) {
  return (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`,
    [c.organizationId])).rows[0].d;
}

// ------------------------------------------------------------------ loading
// The milestone, its project and what the person may do on it. Someone who may not see it learns nothing about it.
export async function milestoneScope(client, c, milestoneId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.project_milestones WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(milestoneId, "Milestone")])).rows[0];
  if (!row) throw err(404, "MILESTONE_NOT_FOUND");
  let scope;
  try { scope = await visibleProject(client, c, row.project_id); } catch (failure) {
    if (failure?.status === 404) throw err(404, "MILESTONE_NOT_FOUND");
    if (failure?.status === 403) throw err(403, "MILESTONE_PERMISSION_DENIED");
    throw failure;
  }
  const can = milestoneAccess(c, scope.access, row);
  if (!can.view) throw err(has(c, PROJECT.milestoneView) ? 404 : 403, has(c, PROJECT.milestoneView) ? "MILESTONE_NOT_FOUND" : "MILESTONE_PERMISSION_DENIED");
  return { milestone: row, project: scope.project, access: scope.access, can };
}
// The project, for its milestone list or a new milestone.
export async function projectScope(client, c, projectId) {
  let scope;
  try { scope = await visibleProject(client, c, projectId); } catch (failure) {
    if (failure?.status === 404) throw err(404, "MILESTONE_PROJECT_INVALID");
    throw failure;
  }
  const can = milestoneAccess(c, scope.access);
  if (!can.view) throw err(403, "MILESTONE_PERMISSION_DENIED");
  return { project: scope.project, access: scope.access, can };
}

export const criteriaOf = async (client, c, milestoneId) => (await client.query(
  `SELECT * FROM tenant.project_milestone_criteria WHERE organization_id = $1 AND milestone_id = $2 AND removed_at IS NULL ORDER BY sequence, created_at`, [c.organizationId, milestoneId])).rows;
// The linked tasks as the Tasks feature holds them; null while no task source is installed.
export async function tasksOf(client, c, milestone) {
  const source = taskSource();
  if (!source) return null;
  const links = (await client.query(`SELECT * FROM tenant.project_milestone_task_links WHERE organization_id = $1 AND milestone_id = $2 AND removed_at IS NULL ORDER BY created_at`,
    [c.organizationId, milestone.id])).rows;
  const tasks = links.length ? await source.load(client, c, milestone.project_id, links.map((row) => row.task_id)) : new Map();
  return links.map((link) => ({ ...link, task: tasks.get(link.task_id) ?? null }));
}
export const prerequisitesOf = async (client, c, milestoneId) => (await client.query(
  `SELECT dependency.id AS dependency_id, prerequisite.* FROM tenant.project_milestone_dependencies dependency
     JOIN tenant.project_milestones prerequisite ON prerequisite.id = dependency.prerequisite_id
    WHERE dependency.organization_id = $1 AND dependency.milestone_id = $2 AND dependency.removed_at IS NULL ORDER BY prerequisite.sequence`, [c.organizationId, milestoneId])).rows;
export const dependentsOf = async (client, c, milestoneId) => (await client.query(
  `SELECT dependency.id AS dependency_id, dependent.* FROM tenant.project_milestone_dependencies dependency
     JOIN tenant.project_milestones dependent ON dependent.id = dependency.milestone_id
    WHERE dependency.organization_id = $1 AND dependency.prerequisite_id = $2 AND dependency.removed_at IS NULL ORDER BY dependent.sequence`, [c.organizationId, milestoneId])).rows;
export const blockersOf = async (client, c, milestoneId) => (await client.query(
  `SELECT * FROM tenant.project_milestone_blockers WHERE organization_id = $1 AND milestone_id = $2 ORDER BY status, raised_at DESC`, [c.organizationId, milestoneId])).rows;
// Decisions with the scope of the submission they were made on.
export const approvalsOf = async (client, c, milestoneId) => (await client.query(
  `SELECT approval.*, submission.scope_version, submission.submission_number FROM tenant.project_milestone_approvals approval
     JOIN tenant.project_milestone_submissions submission ON submission.id = approval.submission_id
    WHERE approval.organization_id = $1 AND approval.milestone_id = $2 ORDER BY approval.recorded_at`, [c.organizationId, milestoneId])).rows;
export const submissionsOf = async (client, c, milestoneId) => (await client.query(
  `SELECT * FROM tenant.project_milestone_submissions WHERE organization_id = $1 AND milestone_id = $2 ORDER BY submission_number DESC`, [c.organizationId, milestoneId])).rows;
export const billingRequestOf = async (client, c, milestoneId) => (await client.query(
  `SELECT * FROM tenant.project_milestone_billing_requests WHERE organization_id = $1 AND milestone_id = $2 AND status <> 'WITHDRAWN' ORDER BY requested_at DESC LIMIT 1`,
  [c.organizationId, milestoneId])).rows[0] ?? null;

export async function readinessFor(client, c, milestone, project, { stage = "complete", exceptions = {} } = {}) {
  const [criteria, tasks, prerequisites, blockers, approvals] = await Promise.all([criteriaOf(client, c, milestone.id), tasksOf(client, c, milestone),
    prerequisitesOf(client, c, milestone.id), blockersOf(client, c, milestone.id), approvalsOf(client, c, milestone.id)]);
  return { ...readinessOf({ milestone, project, criteria, tasks, prerequisites, blockers, approvals, stage, exceptions }), criteria, tasks, prerequisites, blockers, approvals };
}

// The Sales billing stage as Sales holds it: the order (number, status, billing status) and, for those who may see amounts, the line value.
export async function billingStageOf(client, c, milestone, { amounts = false } = {}) {
  if (!milestone.sales_order_id) return null;
  const order = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number AS number, sales_order.lifecycle_status, sales_order.billing_status, sales_order.party_id, sales_order.current_version_id
       FROM tenant.sales_orders sales_order WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [c.organizationId, milestone.sales_order_id])).rows[0];
  if (!order) return { missing: true };
  const line = milestone.sales_order_line_id ? await currentLineOf(client, c, order, milestone.sales_order_line_id) : null;
  return {
    salesOrderId: order.id, number: order.number, status: order.lifecycle_status, billingStatus: order.billing_status, href: `/sales/orders/${order.id}`,
    line: line ? { id: line.id, sequence: line.sequence, item: line.item_name_snapshot, description: line.description_snapshot, current: line.current,
      amount: amounts ? Number(line.line_total).toFixed(2) : null } : milestone.sales_order_line_id ? { missing: true } : null,
    reference: milestone.billing_reference,
  };
}
// A billing stage line, found again in the order's current version (a revision replaces the lines; the same sequence and item is the same stage).
export async function currentLineOf(client, c, order, lineId) {
  const original = (await client.query(`SELECT * FROM tenant.sales_order_lines WHERE organization_id = $1 AND id = $2`, [c.organizationId, lineId])).rows[0];
  if (!original) return null;
  if (original.sales_order_version_id === order.current_version_id) return { ...original, current: true };
  const now = (await client.query(`SELECT * FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = $2 AND sequence = $3 AND item_id = $4`,
    [c.organizationId, order.current_version_id, original.sequence, original.item_id])).rows[0];
  return now ? { ...now, current: true, revisedFrom: original.id } : { ...original, current: false };
}

// ------------------------------------------------------------------ shaping
const progressOfCriteria = (criteria) => {
  const live = criteria.filter((row) => !row.removed_at);
  const done = live.filter((row) => row.status !== "PENDING").length;
  return { total: live.length, done, percent: live.length ? Math.floor((done / live.length) * 100) : null };
};
const taskProgress = (tasks) => {
  if (tasks === null) return { tracked: false, total: 0, completed: 0, percent: null, label: "Tasks are not tracked for projects yet" };
  const required = tasks.filter((row) => row.is_required && !(row.task?.cancelled && String(row.disposition ?? "").trim()));
  const completed = required.filter((row) => row.task?.completed).length;
  const percent = required.length ? Math.floor((completed / required.length) * 100) : null;
  return { tracked: true, total: required.length, completed, percent, label: required.length ? `${completed} of ${required.length} required task(s) complete (${percent}%)` : "No required tasks linked" };
};
const dueState = (row, today) => {
  if (!OPEN_STATUSES.includes(row.status)) return { overdue: false, dueIn: null };
  const due = day(row.current_due_date);
  const left = daysBetween(today, due);
  return { overdue: left < 0, dueIn: left };
};
function listRow(row, names, today, extra = {}) {
  const due = dueState(row, today);
  return {
    id: row.id, code: row.milestone_code, name: row.name, projectId: row.project_id, type: row.milestone_type, typeLabel: MILESTONE_TYPES[row.milestone_type],
    ownerId: row.owner_user_id, owner: names.get(row.owner_user_id) ?? null, status: row.status, statusLabel: MILESTONE_STATUS_LABEL[row.status],
    approvalStatus: row.approval_status, approvalLabel: APPROVAL_LABEL[row.approval_status], priority: row.priority, sequence: row.sequence,
    plannedStartDate: day(row.planned_start_date), originalDueDate: day(row.original_due_date), dueDate: day(row.current_due_date), completedAt: row.completed_at,
    rescheduled: day(row.original_due_date) !== day(row.current_due_date), overdue: due.overdue, dueIn: due.dueIn,
    requiredForCompletion: row.required_for_completion, waived: Boolean(row.waived_at), customerAcceptanceRequired: row.customer_acceptance_required,
    internalApprovalRequired: row.internal_approval_required, version: row.row_version, ...extra,
  };
}

// ------------------------------------------------------------------ a project's milestones
export async function getProjectMilestones(client, c, projectId, { includeCancelled = true } = {}) {
  const { project, can } = await projectScope(client, c, projectId);
  const rows = (await client.query(`SELECT * FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2${includeCancelled ? "" : " AND status <> 'CANCELLED'"} ORDER BY sequence, current_due_date, created_at`,
    [c.organizationId, project.id])).rows;
  const ids = rows.map((row) => row.id);
  const criteria = ids.length ? (await client.query(`SELECT milestone_id, count(*)::int AS total, count(*) FILTER (WHERE status <> 'PENDING')::int AS done FROM tenant.project_milestone_criteria
    WHERE organization_id = $1 AND milestone_id = ANY($2::uuid[]) AND removed_at IS NULL GROUP BY milestone_id`, [c.organizationId, ids])).rows : [];
  const deps = ids.length ? (await client.query(`SELECT milestone_id, prerequisite_id FROM tenant.project_milestone_dependencies WHERE organization_id = $1 AND milestone_id = ANY($2::uuid[]) AND removed_at IS NULL`,
    [c.organizationId, ids])).rows : [];
  const blockers = ids.length ? (await client.query(`SELECT milestone_id, count(*)::int AS n FROM tenant.project_milestone_blockers WHERE organization_id = $1 AND milestone_id = ANY($2::uuid[]) AND status = 'OPEN' GROUP BY milestone_id`,
    [c.organizationId, ids])).rows : [];
  const names = await userNames(client, rows.map((row) => row.owner_user_id));
  const today = await orgDay(client, c);
  const byCriteria = new Map(criteria.map((row) => [row.milestone_id, row]));
  const openBlockers = new Map(blockers.map((row) => [row.milestone_id, row.n]));
  const milestones = rows.map((row) => {
    const counts = byCriteria.get(row.id) ?? { total: 0, done: 0 };
    return listRow(row, names, today, {
      criteria: { total: counts.total, done: counts.done, percent: counts.total ? Math.floor((counts.done / counts.total) * 100) : null },
      prerequisiteIds: deps.filter((dependency) => dependency.milestone_id === row.id).map((dependency) => dependency.prerequisite_id), openBlockers: openBlockers.get(row.id) ?? 0,
    });
  });
  const live = milestones.filter((row) => row.status !== "CANCELLED");
  return {
    projectId: project.id, projectCode: project.project_code, projectStatus: project.status, targetEndDate: day(project.target_end_date), plannedStartDate: day(project.planned_start_date),
    classification: project.classification, milestones,
    summary: { total: live.length, completed: live.filter((row) => row.status === "COMPLETED").length, overdue: live.filter((row) => row.overdue).length,
      blocked: live.filter((row) => row.status === "BLOCKED").length, pendingApproval: live.filter((row) => row.status === "SUBMITTED").length },
    can: { create: can.create && !["COMPLETED", "CANCELLED"].includes(project.status) && !project.archived_at, export: can.export },
    tasksTracked: Boolean(taskSource()),
  };
}

// ------------------------------------------------------------------ one milestone
export async function getMilestoneDetails(client, c, milestoneId) {
  const { milestone, project, access, can } = await milestoneScope(client, c, milestoneId);
  const readiness = await readinessFor(client, c, milestone, project, { stage: milestone.status === "SUBMITTED" || !milestone.internal_approval_required && !milestone.customer_acceptance_required ? "complete" : "submit" });
  const [dependents, submissions, billingRequest] = await Promise.all([dependentsOf(client, c, milestone.id), submissionsOf(client, c, milestone.id), billingRequestOf(client, c, milestone.id)]);
  const today = await orgDay(client, c);
  const contactIds = [milestone.customer_contact_id, ...readiness.approvals.map((row) => row.customer_contact_id)].filter(Boolean);
  const contacts = contactIds.length ? new Map((await client.query(`SELECT id, COALESCE(NULLIF(display_name, ''), btrim(concat_ws(' ', first_name, last_name))) AS name FROM tenant.contacts WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [c.organizationId, contactIds])).rows.map((row) => [row.id, row.name])) : new Map();
  const names = await userNames(client, [milestone.owner_user_id, milestone.created_by, milestone.completed_by, milestone.cancelled_by, milestone.waived_by,
    ...readiness.criteria.flatMap((row) => [row.completed_by, row.waived_by]), ...readiness.blockers.flatMap((row) => [row.owner_user_id, row.raised_by, row.resolved_by]),
    ...readiness.approvals.map((row) => row.recorded_by), ...submissions.map((row) => row.submitted_by), billingRequest?.requested_by, billingRequest?.closed_by, project.manager_user_id]);
  const amounts = can.billing && (access.can.financials || access.all);
  const billing = can.billing ? await billingStageOf(client, c, milestone, { amounts }) : null;
  const files = (await client.query(`SELECT id, file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = 'projects.milestone' AND entity_id = $2 AND is_current AND lifecycle_status <> 'archived'`,
    [c.organizationId, milestone.id])).rows;
  const fileName = new Map(files.map((row) => [row.id, row.file_name]));
  const status = milestone.status;
  const open = OPEN_STATUSES.includes(status);
  const projectOpen = !["COMPLETED", "CANCELLED"].includes(project.status) && !project.archived_at;
  const working = project.status === "IN_PROGRESS";
  const lastSubmission = submissions[0] ?? null;
  const internalDecided = readiness.approvals.some((row) => row.submission_id === milestone.current_submission_id && row.reviewer_type === "INTERNAL");
  const customerDecided = readiness.approvals.some((row) => row.submission_id === milestone.current_submission_id && row.reviewer_type === "CUSTOMER");
  const selfApproval = (await client.query(`SELECT milestone_self_approval_allowed FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.milestone_self_approval_allowed ?? false;
  const due = dueState(milestone, today);
  return {
    ...listRow(milestone, names, today),
    description: milestone.description, projectCode: project.project_code, projectName: project.name, projectStatus: project.status, projectClassification: project.classification,
    projectTargetEndDate: day(project.target_end_date), projectManager: names.get(project.manager_user_id) ?? null,
    customerContactId: milestone.customer_contact_id, customerContact: contacts.get(milestone.customer_contact_id) ?? null,
    startedAt: milestone.started_at, submittedAt: milestone.submitted_at, completedBy: names.get(milestone.completed_by) ?? null,
    cancelledAt: milestone.cancelled_at, cancelReason: milestone.cancel_reason, cancelledBy: names.get(milestone.cancelled_by) ?? null,
    waiver: milestone.waived_at ? { at: milestone.waived_at, by: names.get(milestone.waived_by) ?? null, reason: milestone.waiver_reason } : null,
    createdBy: names.get(milestone.created_by) ?? null, createdAt: milestone.created_at, updatedAt: milestone.updated_at, scopeVersion: milestone.scope_version,
    previousStatus: milestone.previous_status, overdue: due.overdue, dueIn: due.dueIn,
    criteria: readiness.criteria.map((row) => ({
      id: row.id, sequence: row.sequence, description: row.description, required: row.is_required, evidenceRequired: row.evidence_required, status: row.status,
      evidenceFileId: row.evidence_file_id, evidenceFile: fileName.get(row.evidence_file_id) ?? null, evidenceNote: row.evidence_note,
      completedBy: names.get(row.completed_by) ?? null, completedAt: row.completed_at, waivedBy: names.get(row.waived_by) ?? null, waivedAt: row.waived_at, waiverReason: row.waiver_reason, version: row.row_version,
    })),
    criteriaProgress: progressOfCriteria(readiness.criteria),
    tasks: readiness.tasks === null ? null : readiness.tasks.map((row) => ({ linkId: row.id, taskId: row.task_id, required: row.is_required, disposition: row.disposition,
      task: row.task ? { title: row.task.title, code: row.task.code ?? null, status: row.task.status, completed: Boolean(row.task.completed), cancelled: Boolean(row.task.cancelled) } : null })),
    taskProgress: taskProgress(readiness.tasks),
    prerequisites: readiness.prerequisites.map((row) => ({ dependencyId: row.dependency_id, id: row.id, code: row.milestone_code, name: row.name, status: row.status, statusLabel: MILESTONE_STATUS_LABEL[row.status], dueDate: day(row.current_due_date) })),
    dependents: dependents.map((row) => ({ dependencyId: row.dependency_id, id: row.id, code: row.milestone_code, name: row.name, status: row.status, statusLabel: MILESTONE_STATUS_LABEL[row.status] })),
    blockers: readiness.blockers.map((row) => ({ id: row.id, category: row.category, categoryLabel: BLOCKER_CATEGORIES[row.category], description: row.description, owner: names.get(row.owner_user_id) ?? null,
      ownerId: row.owner_user_id, status: row.status, resolution: row.resolution, raisedBy: names.get(row.raised_by) ?? null, raisedAt: row.raised_at, resolvedBy: names.get(row.resolved_by) ?? null, resolvedAt: row.resolved_at })),
    submissions: submissions.map((row) => ({
      id: row.id, number: row.submission_number, scopeVersion: row.scope_version, note: row.note, submittedBy: names.get(row.submitted_by) ?? null, submittedAt: row.submitted_at,
      current: row.id === milestone.current_submission_id, stale: row.scope_version !== milestone.scope_version, snapshot: row.snapshot,
      decisions: readiness.approvals.filter((approval) => approval.submission_id === row.id).map((approval) => ({
        id: approval.id, reviewerType: approval.reviewer_type, decision: approval.decision, note: approval.note, recordedBy: names.get(approval.recorded_by) ?? null, recordedAt: approval.recorded_at,
        customerContact: contacts.get(approval.customer_contact_id) ?? null, customerDecisionDate: day(approval.customer_decision_date), evidenceFileId: approval.evidence_file_id,
        evidenceFile: fileName.get(approval.evidence_file_id) ?? null, evidenceReference: approval.evidence_reference })),
    })),
    readiness: { ready: readiness.ready, checks: readiness.checks },
    billing: can.billing ? {
      stage: billing, amountsVisible: amounts,
      request: billingRequest ? { id: billingRequest.id, status: billingRequest.status, requestedBy: names.get(billingRequest.requested_by) ?? null, requestedAt: billingRequest.requested_at,
        note: billingRequest.note, closedBy: names.get(billingRequest.closed_by) ?? null, closedAt: billingRequest.closed_at, closeNote: billingRequest.close_note } : null,
    } : { stage: billingRequest || milestone.sales_order_id ? { restricted: true } : null, amountsVisible: false, request: billingRequest ? { status: billingRequest.status } : null },
    files: files.map((row) => ({ id: row.id, fileName: row.file_name })),
    can: {
      edit: can.edit && open && projectOpen, assign: can.assign && open && projectOpen, links: can.links && open && projectOpen, work: can.work && open && status !== "SUBMITTED" && projectOpen,
      evidence: can.work && open && projectOpen,
      start: can.work && status === "NOT_STARTED" && working,
      block: can.work && ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED"].includes(status) && projectOpen,
      submit: can.submit && status === "IN_PROGRESS" && working && (milestone.internal_approval_required || milestone.customer_acceptance_required),
      withdraw: (can.submit || can.edit) && status === "SUBMITTED",
      approve: can.approve && status === "SUBMITTED" && milestone.internal_approval_required && !internalDecided && projectOpen
        && (selfApproval || lastSubmission?.submitted_by !== c.userId),
      customerAcceptance: can.customer && status === "SUBMITTED" && milestone.customer_acceptance_required && !customerDecided && projectOpen,
      complete: can.complete && working && ((status === "SUBMITTED" && milestone.approval_status === "APPROVED") || (["NOT_STARTED", "IN_PROGRESS"].includes(status) && !milestone.internal_approval_required && !milestone.customer_acceptance_required)),
      reopen: can.reopen && status === "COMPLETED" && projectOpen, cancel: can.cancel && open && projectOpen,
      waive: can.waive && open && projectOpen, waiveForCompletion: can.waive && open && milestone.required_for_completion && !milestone.waived_at && projectOpen,
      billingStage: can.links && status !== "CANCELLED" && projectOpen && project.classification === "CUSTOMER",
      billingRequest: can.billingRequest && status === "COMPLETED" && Boolean(milestone.sales_order_id) && !billingRequest,
      billingWithdraw: can.billingRequest && billingRequest?.status === "OPEN",
      billingAcknowledge: has(c, "sales.invoice.create") && billingRequest?.status === "OPEN",
      note: access.can.contribute, viewBilling: can.billing,
    },
    tasksTracked: Boolean(taskSource()),
  };
}

export async function getMilestoneActivity(client, c, milestoneId) {
  const { milestone } = await milestoneScope(client, c, milestoneId);
  const rows = (await client.query(`SELECT * FROM tenant.project_milestone_events WHERE organization_id = $1 AND milestone_id = $2 ORDER BY occurred_at DESC LIMIT 300`,
    [c.organizationId, milestone.id])).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ id: row.id, action: row.action, summary: row.summary, from: row.from_status, to: row.to_status, details: row.details, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
}
export async function getMilestoneNotes(client, c, milestoneId) {
  const { milestone } = await milestoneScope(client, c, milestoneId);
  const rows = (await client.query(`SELECT * FROM tenant.project_notes WHERE organization_id = $1 AND milestone_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`, [c.organizationId, milestone.id])).rows;
  const names = await userNames(client, rows.map((row) => row.author_user_id));
  return rows.map((row) => ({ id: row.id, body: row.body, author: names.get(row.author_user_id) ?? null, createdAt: row.created_at, mine: row.author_user_id === c.userId }));
}
// Tasks of the milestone's project that may be linked (not yet counted toward a milestone).
export async function searchMilestoneTasks(client, c, milestoneId, term = "") {
  const { milestone } = await milestoneScope(client, c, milestoneId);
  const source = taskSource();
  if (!source?.search) return { tracked: false, tasks: [] };
  const taken = new Set((await client.query(`SELECT task_id FROM tenant.project_milestone_task_links WHERE organization_id = $1 AND removed_at IS NULL`, [c.organizationId])).rows.map((row) => row.task_id));
  const tasks = (await source.search(client, c, milestone.project_id, text(term, 100))).filter((task) => !taken.has(task.id));
  return { tracked: true, tasks: tasks.slice(0, 30) };
}

// ------------------------------------------------------------------ the company-wide queue
const QUEUE_SORT = { due: "milestone.current_due_date", code: "milestone.milestone_code", project: "project.project_code", status: "milestone.status", priority: "milestone.priority", updated: "milestone.updated_at" };
// filters: { view: all | mine | upcoming | overdue | pending_approval | pending_customer | blocked | completed, search, projectId, ownerId, status, sort, direction, page, pageSize }
export async function listMilestoneQueue(client, c, filters = {}) {
  if (!has(c, PROJECT.milestoneView) || !(has(c, PROJECT.view) || has(c, PROJECT.viewAll))) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null];
  const where = ["milestone.organization_id = $1", "project.deleted_at IS NULL", visibilitySql(c, "project", "$2")];
  const today = await orgDay(client, c);
  const dueSoon = Number((await client.query(`SELECT due_soon_days FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.due_soon_days ?? 7);
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const open = `milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED')`;
  const view = String(filters.view ?? "all");
  if (view === "mine") where.push("milestone.owner_user_id = $2", open);
  if (view === "upcoming") { const from = bind(today); where.push(open, `milestone.current_due_date BETWEEN ${from}::date AND ${from}::date + ${bind(dueSoon)}::int`); }
  if (view === "overdue") where.push(open, `milestone.current_due_date < ${bind(today)}::date`);
  if (view === "pending_approval") where.push("milestone.status = 'SUBMITTED'", "milestone.internal_approval_required",
    "NOT EXISTS (SELECT 1 FROM tenant.project_milestone_approvals approval WHERE approval.submission_id = milestone.current_submission_id AND approval.reviewer_type = 'INTERNAL')");
  if (view === "pending_customer") where.push("milestone.status = 'SUBMITTED'", "milestone.customer_acceptance_required",
    "NOT EXISTS (SELECT 1 FROM tenant.project_milestone_approvals approval WHERE approval.submission_id = milestone.current_submission_id AND approval.reviewer_type = 'CUSTOMER')");
  if (view === "blocked") where.push("milestone.status = 'BLOCKED'");
  if (view === "completed") where.push("milestone.status = 'COMPLETED'");
  if (view === "all") where.push("milestone.status <> 'CANCELLED'");
  if (filters.projectId) { values.push(uuid(filters.projectId, "Project")); where.push(`milestone.project_id = $${values.length}`); }
  if (filters.ownerId) { values.push(uuid(filters.ownerId, "Owner")); where.push(`milestone.owner_user_id = $${values.length}`); }
  if (filters.status && MILESTONE_STATUS_LABEL[String(filters.status).toUpperCase()]) { values.push(String(filters.status).toUpperCase()); where.push(`milestone.status = $${values.length}`); }
  if (filters.search) {
    values.push(`%${text(filters.search, 100).replace(/[%_]/g, "\\$&")}%`);
    where.push(`(milestone.name ILIKE $${values.length} OR milestone.milestone_code ILIKE $${values.length} OR project.project_code ILIKE $${values.length} OR project.name ILIKE $${values.length})`);
  }
  const sort = QUEUE_SORT[filters.sort] ?? QUEUE_SORT.due;
  const direction = String(filters.direction).toLowerCase() === "desc" ? "DESC" : "ASC";
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 200);
  const page = Math.max(Number(filters.page) || 1, 1);
  const from = `FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id AND project.organization_id = milestone.organization_id WHERE ${where.join(" AND ")}`;
  const total = Number((await client.query(`SELECT count(*) AS n ${from}`, values)).rows[0].n);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = (await client.query(`SELECT milestone.*, project.project_code, project.name AS project_name ${from} ORDER BY ${sort} ${direction}, milestone.milestone_code LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const names = await userNames(client, rows.map((row) => row.owner_user_id));
  return { rows: rows.map((row) => listRow(row, names, today, { projectCode: row.project_code, projectName: row.project_name })), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
    can: { export: has(c, PROJECT.milestoneExport) } };
}

// ------------------------------------------------------------------ reports
export const MILESTONE_REPORTS = Object.freeze(["by-project", "upcoming", "overdue", "by-owner", "completed", "blocked", "pending-internal", "pending-customer", "schedule-changes",
  "billing-eligibility", "completion-history"]);
export async function getMilestoneReport(client, c, kind = "by-project", filters = {}) {
  if (!MILESTONE_REPORTS.includes(kind)) throw err(400, "MILESTONE_INPUT_INVALID", "Unknown milestone report.");
  if (!has(c, PROJECT.reports) && !has(c, PROJECT.milestoneView)) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const queue = (view, extra = {}) => listMilestoneQueue(client, c, { view, pageSize: 200, ...filters, ...extra }).then((result) => result.rows);
  if (kind === "upcoming") return queue("upcoming");
  if (kind === "overdue") return queue("overdue");
  if (kind === "completed") return queue("completed", { sort: "updated", direction: "desc" });
  if (kind === "blocked") return queue("blocked");
  if (kind === "pending-internal") return queue("pending_approval");
  if (kind === "pending-customer") return queue("pending_customer");
  const values = [c.organizationId, c.userId ?? null];
  const visible = `project.deleted_at IS NULL AND ${visibilitySql(c, "project", "$2")}`;
  if (kind === "by-project") {
    return (await client.query(`SELECT project.id AS project_id, project.project_code, project.name AS project_name, count(*) FILTER (WHERE milestone.status <> 'CANCELLED')::int AS total,
        count(*) FILTER (WHERE milestone.status = 'COMPLETED')::int AS completed, count(*) FILTER (WHERE milestone.status = 'BLOCKED')::int AS blocked,
        count(*) FILTER (WHERE milestone.status = 'SUBMITTED')::int AS submitted,
        count(*) FILTER (WHERE milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED') AND milestone.current_due_date < (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date)::int AS overdue
       FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id
      WHERE milestone.organization_id = $1 AND ${visible} GROUP BY project.id, project.project_code, project.name ORDER BY project.project_code`, values)).rows
      .map((row) => ({ projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name, total: row.total, completed: row.completed, blocked: row.blocked, submitted: row.submitted, overdue: row.overdue }));
  }
  if (kind === "by-owner") {
    const rows = (await client.query(`SELECT milestone.owner_user_id, count(*) FILTER (WHERE milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED'))::int AS open,
        count(*) FILTER (WHERE milestone.status = 'COMPLETED')::int AS completed,
        count(*) FILTER (WHERE milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED') AND milestone.current_due_date < (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date)::int AS overdue
       FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id
      WHERE milestone.organization_id = $1 AND milestone.status <> 'CANCELLED' AND ${visible} GROUP BY milestone.owner_user_id`, values)).rows;
    const names = await userNames(client, rows.map((row) => row.owner_user_id));
    return rows.map((row) => ({ ownerId: row.owner_user_id, owner: names.get(row.owner_user_id) ?? "Unassigned", open: row.open, completed: row.completed, overdue: row.overdue }))
      .sort((a, b) => b.open - a.open || a.owner.localeCompare(b.owner));
  }
  if (kind === "schedule-changes") {
    const rows = (await client.query(`SELECT event.*, milestone.milestone_code, milestone.name, project.project_code FROM tenant.project_milestone_events event
        JOIN tenant.project_milestones milestone ON milestone.id = event.milestone_id JOIN tenant.projects project ON project.id = milestone.project_id
       WHERE event.organization_id = $1 AND event.action = 'DUE_DATE_CHANGED' AND ${visible} ORDER BY event.occurred_at DESC LIMIT 500`, values)).rows;
    const names = await userNames(client, rows.map((row) => row.actor_user_id));
    return rows.map((row) => ({ milestoneId: row.milestone_id, code: row.milestone_code, name: row.name, projectCode: row.project_code, from: row.details?.from ?? null, to: row.details?.to ?? null,
      reason: row.details?.reason ?? null, changedBy: names.get(row.actor_user_id) ?? null, at: row.occurred_at }));
  }
  if (kind === "billing-eligibility") {
    if (!has(c, PROJECT.milestoneBilling)) throw err(403, "MILESTONE_PERMISSION_DENIED");
    const rows = (await client.query(`SELECT milestone.id, milestone.milestone_code, milestone.name, milestone.status, milestone.completed_at, project.project_code, sales_order.sales_order_number,
        sales_order.billing_status, request.status AS request_status, request.requested_at
       FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.id = milestone.sales_order_id
       LEFT JOIN tenant.project_milestone_billing_requests request ON request.milestone_id = milestone.id AND request.status <> 'WITHDRAWN'
      WHERE milestone.organization_id = $1 AND milestone.sales_order_id IS NOT NULL AND milestone.status <> 'CANCELLED' AND ${visible} ORDER BY milestone.current_due_date`, values)).rows;
    return rows.map((row) => ({ milestoneId: row.id, code: row.milestone_code, name: row.name, status: row.status, statusLabel: MILESTONE_STATUS_LABEL[row.status], completedAt: row.completed_at,
      projectCode: row.project_code, salesOrder: row.sales_order_number, salesBillingStatus: row.billing_status, request: row.request_status ?? (row.status === "COMPLETED" ? "ELIGIBLE" : "NOT_YET"), requestedAt: row.requested_at }));
  }
  // completion-history
  const rows = (await client.query(`SELECT event.*, milestone.milestone_code, milestone.name, project.project_code FROM tenant.project_milestone_events event
      JOIN tenant.project_milestones milestone ON milestone.id = event.milestone_id JOIN tenant.projects project ON project.id = milestone.project_id
     WHERE event.organization_id = $1 AND event.action IN ('COMPLETED', 'REOPENED', 'CANCELLED', 'WAIVED_FOR_COMPLETION') AND ${visible} ORDER BY event.occurred_at DESC LIMIT 500`, values)).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ milestoneId: row.milestone_id, code: row.milestone_code, name: row.name, projectCode: row.project_code, action: row.action, summary: row.summary, actor: names.get(row.actor_user_id) ?? null, at: row.occurred_at }));
}

const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportMilestones(client, c, filters = {}) {
  if (!has(c, PROJECT.milestoneExport)) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const { rows } = await listMilestoneQueue(client, c, { ...filters, pageSize: 200 });
  const header = ["Code", "Milestone", "Project", "Owner", "Status", "Approval", "Original due", "Current due", "Overdue", "Completed"];
  const lines = rows.map((row) => [row.code, row.name, row.projectCode, row.owner, row.statusLabel, row.approvalLabel, row.originalDueDate, row.dueDate, row.overdue ? "Yes" : "No", row.completedAt ? isoDay(row.completedAt) : ""]);
  return { fileName: `milestones-${await orgDay(client, c)}.csv`, csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n") };
}

// ------------------------------------------------------------------ deadline alerts (each once)
export async function evaluateMilestoneDeadlines(client, c) {
  const today = await orgDay(client, c);
  const dueSoon = Number((await client.query(`SELECT due_soon_days FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.due_soon_days ?? 7);
  const rows = (await client.query(`SELECT milestone.*, project.manager_user_id, project.project_code FROM tenant.project_milestones milestone JOIN tenant.projects project ON project.id = milestone.project_id
     WHERE milestone.organization_id = $1 AND milestone.status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED') AND project.status IN ('PLANNED', 'IN_PROGRESS') AND project.deleted_at IS NULL`, [c.organizationId])).rows;
  let sent = 0;
  const once = async (row, key) => Boolean((await client.query(`INSERT INTO tenant.project_alerts (organization_id, project_id, alert_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
    [c.organizationId, row.project_id, key])).rows[0]);
  const tell = async (row, userIds, title, message) => {
    for (const userId of new Set(userIds.filter(Boolean))) {
      await createNotification(client, { organizationId: c.organizationId, userId, category: "project_milestone_alert", title, message, href: `/projects/milestones/${row.id}`, entityType: "projects.milestone", entityId: row.id });
    }
  };
  for (const row of rows) {
    const due = day(row.current_due_date);
    const left = daysBetween(today, due);
    if (left < 0 && await once(row, `milestone:${row.id}:overdue:${due}`)) {
      await tell(row, [row.owner_user_id, row.manager_user_id], `${row.milestone_code} is overdue`, `${row.name} (${row.project_code}) was due on ${due}.`);
      sent += 1;
    } else if (left >= 0 && left <= dueSoon && await once(row, `milestone:${row.id}:due:${due}`)) {
      await tell(row, [row.owner_user_id], `${row.milestone_code} is due in ${left} day(s)`, `${row.name} (${row.project_code}) — due ${due}.`);
      sent += 1;
    }
  }
  return { checked: rows.length, sent };
}

// ------------------------------------------------------------------ the project's milestone work (progress, health, completion check)
registerProjectWorkSource(async (client, c, projectIds, map) => {
  if (!projectIds.length) return;
  const today = await orgDay(client, c);
  const rows = (await client.query(`SELECT project_id, milestone_code, name, status, required_for_completion, waived_at, current_due_date FROM tenant.project_milestones
     WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) AND status <> 'CANCELLED'`, [c.organizationId, projectIds])).rows;
  for (const id of projectIds) {
    const own = rows.filter((row) => row.project_id === id);
    const open = own.filter((row) => row.status !== "COMPLETED");
    const required = open.filter((row) => row.required_for_completion && !row.waived_at);
    const entry = map.get(id);
    if (!entry) continue;
    entry.milestones = {
      total: own.length, completed: own.length - open.length, open: open.length,
      overdue: required.filter((row) => day(row.current_due_date) < today).length,
      openRequired: required.length, openRequiredNames: required.map((row) => `${row.milestone_code} ${row.name}`),
    };
  }
});
