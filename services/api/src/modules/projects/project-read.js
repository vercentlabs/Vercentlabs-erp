// Projects — the reads: the directory (views, search, filters, sorting and paging, only what the person may see), one project with its team,
// health, progress, hold, approval and what the person may do; the workspace summary; the team and its history; links; notes; the activity
// timeline; the module overview; the overview reports; the directory export; the options a form needs; and the due-date and health alerts.
import {
  ACTIVE_STATUSES, PRIORITIES, PROJECT, ROLES, STATUS_LABEL, canView, eligibleUsers, ensureProjectTypes, has, isoDay, need, notifyProject, projectError, projectSettings, seesAll, text,
  today, userNames, uuid, visibilitySql, visibleProject,
} from "./project-core.js";
import { LINK_LABEL, cancellationReview, completionCheck, healthContext, progressOf, resolvedLinks } from "./project-summary.js";
import { LINK_SOURCES, validateProjectActivation } from "./project-service.js";

const PRIORITY_RANK = Object.freeze({ URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 });
const day = (value) => (value ? isoDay(value) : null);
const BASE_SELECT = `SELECT project.*, type.name AS type_name, type.code AS type_code, customer.display_name AS customer_name, customer.customer_number,
       manager.full_name AS manager_name, manager.email AS manager_email,
       (SELECT count(*)::int FROM tenant.project_members member WHERE member.project_id = project.id AND member.left_at IS NULL) AS member_count,
       (SELECT max(event.occurred_at) FROM tenant.project_events event WHERE event.project_id = project.id) AS last_activity_at
  FROM tenant.projects project
  LEFT JOIN tenant.project_types type ON type.id = project.project_type_id
  LEFT JOIN tenant.business_parties customer ON customer.id = project.customer_id
  LEFT JOIN public.users manager ON manager.id = project.manager_user_id`;

// ------------------------------------------------------------------ the directory
const VIEWS = Object.freeze({
  all: "project.archived_at IS NULL", active: "project.archived_at IS NULL AND project.status IN ('PLANNED', 'IN_PROGRESS')", on_hold: "project.status = 'ON_HOLD'",
  completed: "project.archived_at IS NULL AND project.status = 'COMPLETED'", cancelled: "project.archived_at IS NULL AND project.status = 'CANCELLED'",
  drafts: "project.status = 'DRAFT'", archived: "project.archived_at IS NOT NULL", mine: "project.archived_at IS NULL", everything: "TRUE",
});
const SORTS = Object.freeze({ code: (row) => row.project_code, name: (row) => (row.name ?? "").toLowerCase(), status: (row) => Object.keys(STATUS_LABEL).indexOf(row.status),
  priority: (row) => PRIORITY_RANK[row.priority], target: (row) => day(row.target_end_date) ?? "9999", start: (row) => day(row.planned_start_date) ?? "9999",
  customer: (row) => (row.customer_name ?? "").toLowerCase(), manager: (row) => (row.manager_name ?? "").toLowerCase(), updated: (row) => new Date(row.updated_at).getTime(),
  health: (row) => ["BLOCKED", "AT_RISK", "UNKNOWN", "ON_TRACK", "COMPLETED", "CANCELLED"].indexOf(row.health.state) });
// The visible projects matching the filters, with health computed (the same rules as on the project itself).
async function directory(client, c, filters = {}) {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? "00000000-0000-0000-0000-000000000000"];
  const view = VIEWS[filters.view] ? filters.view : "all";
  const where = ["project.organization_id = $1", "project.deleted_at IS NULL", visibilitySql(c, "project", "$2"), VIEWS[view]];
  if (view === "mine") where.push(`(project.manager_user_id = $2 OR EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = project.id AND member.user_id = $2 AND member.left_at IS NULL))`);
  const push = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.search) {
    const term = push(`%${text(filters.search, 100).toLowerCase()}%`);
    where.push(`(lower(project.project_code) LIKE ${term} OR lower(COALESCE(project.name, '')) LIKE ${term} OR lower(COALESCE(customer.display_name, '')) LIKE ${term}
      OR EXISTS (SELECT 1 FROM unnest(project.tags) tag WHERE lower(tag) LIKE ${term}))`);
  }
  const list = (value) => String(value ?? "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  if (filters.status) where.push(`project.status = ANY(${push(list(filters.status))}::text[])`);
  if (filters.priority) where.push(`project.priority = ANY(${push(list(filters.priority))}::text[])`);
  if (filters.classification) where.push(`project.classification = ${push(String(filters.classification).toUpperCase())}`);
  if (filters.managerId) where.push(`project.manager_user_id = ${push(uuid(filters.managerId, "Manager"))}`);
  if (filters.customerId) where.push(`project.customer_id = ${push(uuid(filters.customerId, "Customer"))}`);
  if (filters.typeId) where.push(`project.project_type_id = ${push(uuid(filters.typeId, "Project type"))}`);
  if (filters.tag) where.push(`EXISTS (SELECT 1 FROM unnest(project.tags) tag WHERE lower(tag) = lower(${push(text(filters.tag, 40))}))`);
  const rows = (await client.query(`${BASE_SELECT} WHERE ${where.join(" AND ")} ORDER BY project.updated_at DESC LIMIT 5000`, values)).rows;
  const health = await healthContext(client, c, rows);
  for (const row of rows) {
    row.health = health.of(row);
    row.target_in = row.target_end_date ? Math.round((Date.parse(`${day(row.target_end_date)}T00:00:00Z`) - Date.parse(`${health.day}T00:00:00Z`)) / 864e5) : null;
    row.progress = progressOf(health.work.get(row.id));
  }
  let out = rows;
  if (filters.health) out = out.filter((row) => list(filters.health).includes(row.health.state));
  const open = (row) => ACTIVE_STATUSES.includes(row.status);
  if (filters.due === "overdue") out = out.filter((row) => open(row) && row.target_in !== null && row.target_in < 0);
  if (filters.due === "soon") out = out.filter((row) => open(row) && row.target_in !== null && row.target_in >= 0 && row.target_in <= health.settings.dueSoonDays);
  return { rows: out, settings: health.settings, day: health.day };
}
const rowView = (row) => ({
  id: row.id, code: row.project_code, name: row.name, classification: row.classification, type: row.type_name ?? null, customer: row.customer_name ?? null, customerId: row.customer_id,
  managerId: row.manager_user_id, manager: row.manager_name || row.manager_email || null, status: row.status, statusLabel: STATUS_LABEL[row.status], priority: row.priority,
  plannedStartDate: day(row.planned_start_date), targetEndDate: day(row.target_end_date), actualStartDate: day(row.actual_start_date), completedAt: day(row.completed_at),
  health: row.health.state, healthLabel: row.health.label, healthReasons: row.health.reasons, progress: row.progress.percent, progressLabel: row.progress.label, tags: row.tags ?? [],
  members: row.member_count, archived: Boolean(row.archived_at), approval: row.approval_status, targetIn: row.target_in, overdue: ACTIVE_STATUSES.includes(row.status) && row.target_in !== null && row.target_in < 0,
  lastActivityAt: row.last_activity_at, updatedAt: row.updated_at,
});
// filters: { view, search, status, priority, classification, managerId, customerId, typeId, tag, health, due, sort, direction, page, pageSize }
export async function listProjects(client, c, filters = {}) {
  const { rows } = await directory(client, c, filters);
  const sort = SORTS[filters.sort] ?? SORTS.updated;
  const direction = filters.direction === "asc" ? 1 : filters.direction === "desc" ? -1 : filters.sort && filters.sort !== "updated" ? 1 : -1;
  rows.sort((a, b) => { const x = sort(a); const y = sort(b); return (x < y ? -1 : x > y ? 1 : 0) * direction || (a.project_code < b.project_code ? -1 : 1); });
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number(filters.page) || 1));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(rowView), total: rows.length, page, pageSize, pages,
    can: { create: has(c, PROJECT.create), export: has(c, PROJECT.export), viewAll: seesAll(c) } };
}
export const listMyProjects = (client, c, filters = {}) => listProjects(client, c, { ...filters, view: "mine" });

// ------------------------------------------------------------------ one project
export async function getProject(client, c, projectId) {
  const { access } = await visibleProject(client, c, projectId);
  const row = (await client.query(`${BASE_SELECT} WHERE project.organization_id = $1 AND project.id = $2`, [c.organizationId, uuid(projectId, "Project")])).rows[0];
  const health = await healthContext(client, c, [row]);
  const hold = health.holds.get(row.id) ?? null;
  const contact = row.customer_contact_id ? (await client.query(`SELECT id, COALESCE(NULLIF(display_name, ''), btrim(concat_ws(' ', first_name, last_name))) AS name, email, phone FROM tenant.contacts WHERE id = $1`,
    [row.customer_contact_id])).rows[0] : null;
  const names = await userNames(client, [row.created_by, row.approval_requested_by, row.approved_by, row.completed_by, row.cancelled_by, row.archived_by, row.health_noted_by, hold?.owner_user_id]);
  const activation = row.status === "DRAFT" ? await validateProjectActivation(client, c, row.id) : null;
  const settings = health.settings;
  const can = access.can;
  const status = row.status;
  return {
    id: row.id, code: row.project_code, name: row.name, description: row.description, classification: row.classification, typeId: row.project_type_id, type: row.type_name ?? null,
    customerId: row.customer_id, customer: row.customer_name ?? null, customerNumber: row.customer_number ?? null, contact: contact ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone } : null,
    managerId: row.manager_user_id, manager: row.manager_name || row.manager_email || null, managerActive: !row.manager_user_id || health.managers.has(row.manager_user_id),
    status, statusLabel: STATUS_LABEL[status], previousStatus: row.previous_status, priority: row.priority, source: row.source,
    plannedStartDate: day(row.planned_start_date), targetEndDate: day(row.target_end_date), actualStartDate: day(row.actual_start_date), completedAt: day(row.completed_at),
    completionNote: row.completion_note, completedBy: names.get(row.completed_by) ?? null, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, cancelledBy: names.get(row.cancelled_by) ?? null,
    approval: { status: row.approval_status, requestedBy: names.get(row.approval_requested_by) ?? null, requestedAt: row.approval_requested_at, approvedBy: names.get(row.approved_by) ?? null,
      approvedAt: row.approved_at, note: row.approval_note, required: settings.activationApprovalRequired,
      mayDecide: can.approve && row.approval_status === "PENDING" && (settings.selfApprovalAllowed || row.approval_requested_by !== c.userId) },
    risk: { flagged: row.risk_flagged, note: row.risk_note },
    health: { ...health.of(row), noteBy: names.get(row.health_noted_by) ?? null },
    progress: progressOf(health.work.get(row.id)),
    hold: hold ? { reason: hold.reason, owner: names.get(hold.owner_user_id) ?? null, startedAt: hold.started_at } : null,
    activation, tags: row.tags ?? [], template: row.template_name ? { id: row.template_id, name: row.template_name } : null,
    archived: Boolean(row.archived_at), archivedAt: row.archived_at, archivedBy: names.get(row.archived_by) ?? null,
    members: row.member_count, createdBy: names.get(row.created_by) ?? null, createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at, version: row.row_version,
    role: access.all && !access.role ? "COMPANY" : access.role, roleLabel: access.role ? ROLES[access.role] : access.all ? "Company access" : null,
    can: {
      ...can,
      edit: can.edit && !["COMPLETED", "CANCELLED"].includes(status) && !row.archived_at,
      activate: can.start && status === "DRAFT" && row.approval_status !== "PENDING", start: can.start && status === "PLANNED", hold: can.hold && ["PLANNED", "IN_PROGRESS"].includes(status) && !row.archived_at,
      resume: can.resume && status === "ON_HOLD", complete: can.complete && status === "IN_PROGRESS", reopen: can.reopen && status === "COMPLETED" && !row.archived_at,
      cancel: can.cancel && ["DRAFT", ...ACTIVE_STATUSES].includes(status), archive: can.archive && ["COMPLETED", "CANCELLED"].includes(status) && !row.archived_at,
      restore: can.archive && Boolean(row.archived_at), delete: status === "DRAFT" && (can.archive || (can.edit && row.created_by === c.userId)),
      members: can.members && !["COMPLETED", "CANCELLED"].includes(status), links: can.links,
    },
  };
}
// The workspace overview: progress, health, team, hold, linked records count, recent activity and the next action.
export async function getProjectSummary(client, c, projectId) {
  const project = await getProject(client, c, projectId);
  const links = (await client.query(`SELECT source_type, count(*)::int AS n FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND removed_at IS NULL GROUP BY 1`,
    [c.organizationId, project.id])).rows;
  const activity = await getProjectActivity(client, c, project.id, { limit: 8 });
  const next = project.status === "DRAFT" ? (project.activation?.ready ? (project.approval.status === "PENDING" ? "Waiting for approval" : "Activate the project") : project.activation?.problems[0]?.message ?? "Complete the setup")
    : project.status === "PLANNED" ? "Start the project when execution begins" : project.status === "ON_HOLD" ? "Resolve the hold and resume" : project.status === "IN_PROGRESS"
      ? (project.health.state === "AT_RISK" ? project.health.reasons[0] : "Keep delivering; complete when the closing checks pass") : project.status === "COMPLETED" ? "Archive it when no longer needed" : "Nothing more to do";
  return { project, links: links.map((row) => ({ type: row.source_type, label: LINK_LABEL[row.source_type], count: row.n })), activity, next };
}
export async function getProjectMembers(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const rows = (await client.query(`SELECT member.*, person.full_name, person.email FROM tenant.project_members member JOIN public.users person ON person.id = member.user_id
      WHERE member.organization_id = $1 AND member.project_id = $2 ORDER BY member.left_at NULLS FIRST, CASE member.role WHEN 'MANAGER' THEN 0 ELSE 1 END, member.joined_at`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.added_by, row.removed_by]));
  const active = await eligibleUsers(client, c, rows.filter((row) => !row.left_at).map((row) => row.user_id));
  return { members: rows.map((row) => ({ id: row.id, userId: row.user_id, name: row.full_name || row.email, email: row.email, role: row.role, roleLabel: ROLES[row.role],
    joinedAt: row.joined_at, addedBy: names.get(row.added_by) ?? null, leftAt: row.left_at, removedBy: names.get(row.removed_by) ?? null, removalNote: row.removal_note,
    active: !row.left_at, accountActive: row.left_at ? null : active.has(row.user_id) })),
    can: { manage: access.can.members && !["COMPLETED", "CANCELLED"].includes(project.status) } };
}
export async function getProjectLinks(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const links = await resolvedLinks(client, c, project.id, { financials: access.can.financials });
  const names = await userNames(client, links.map((link) => link.createdBy));
  return { links: links.map(({ raw, ...link }) => ({ ...link, createdBy: names.get(link.createdBy) ?? null })), financials: access.can.financials,
    can: { manage: access.can.links, types: Object.entries(LINK_SOURCES).filter(([, source]) => has(c, source.permission)).map(([type]) => ({ type, label: LINK_LABEL[type] })) } };
}
export async function getProjectNotes(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const rows = (await client.query(`SELECT * FROM tenant.project_notes WHERE organization_id = $1 AND project_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, rows.map((row) => row.author_user_id));
  return { notes: rows.map((row) => ({ id: row.id, body: row.body, author: names.get(row.author_user_id) ?? null, createdAt: row.created_at, editedAt: row.edited_at, version: row.row_version,
    mine: row.author_user_id === c.userId, mayRemove: row.author_user_id === c.userId || access.can.edit })), can: { add: access.can.contribute } };
}
export async function getProjectActivity(client, c, projectId, { limit = 300 } = {}) {
  const { project } = await visibleProject(client, c, projectId);
  const rows = (await client.query(`SELECT * FROM tenant.project_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at DESC LIMIT $3`, [c.organizationId, project.id, limit])).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ id: row.id, action: row.action, summary: row.summary, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
}
export async function getProjectStatusHistory(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  const rows = (await client.query(`SELECT * FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ action: row.action, from: row.from_status, to: row.to_status, reason: row.reason, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
}
export async function getProjectCompletionCheck(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return completionCheck(client, c, project, {}, { preview: true });
}
export async function getProjectCancellationReview(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  return cancellationReview(client, c, project);
}

// ------------------------------------------------------------------ the module overview and reports
export async function getProjectsOverview(client, c) {
  const { rows, settings } = await directory(client, c, { view: "everything" });
  const live = rows.filter((row) => !row.archived_at);
  const count = (predicate) => live.filter(predicate).length;
  const open = (row) => ACTIVE_STATUSES.includes(row.status);
  const mine = (row) => row.manager_user_id === c.userId;
  const ids = rows.map((row) => row.id);
  const recent = ids.length ? (await client.query(`SELECT event.*, project.project_code, project.name FROM tenant.project_events event JOIN tenant.projects project ON project.id = event.project_id
      WHERE event.organization_id = $1 AND event.project_id = ANY($2::uuid[]) ORDER BY event.occurred_at DESC LIMIT 15`, [c.organizationId, ids])).rows : [];
  const names = await userNames(client, recent.map((row) => row.actor_user_id));
  const month = (await today(client)).slice(0, 7);
  const attention = (predicate, reason) => live.filter(predicate).slice(0, 8).map((row) => ({ ...rowView(row), reason: reason(row) }));
  return {
    counts: { active: count((row) => ["PLANNED", "IN_PROGRESS"].includes(row.status)), inProgress: count((row) => row.status === "IN_PROGRESS"), onHold: count((row) => row.status === "ON_HOLD"),
      overdue: count((row) => open(row) && row.target_in !== null && row.target_in < 0), dueSoon: count((row) => open(row) && row.target_in !== null && row.target_in >= 0 && row.target_in <= settings.dueSoonDays),
      atRisk: count((row) => row.health.state === "AT_RISK"), drafts: count((row) => row.status === "DRAFT"), pendingApproval: count((row) => row.approval_status === "PENDING"),
      completedThisMonth: rows.filter((row) => row.status === "COMPLETED" && day(row.completed_at)?.slice(0, 7) === month).length, mine: count((row) => mine(row) && row.status !== "CANCELLED"),
      noManager: count((row) => open(row) && row.health.reasons.some((reason) => reason.startsWith("The Project Manager"))) },
    attention: [
      ...attention((row) => open(row) && row.target_in !== null && row.target_in < 0, (row) => `Overdue by ${-row.target_in} day(s)`),
      ...attention((row) => row.status === "ON_HOLD", (row) => row.health.reasons[0]),
      ...attention((row) => row.health.state === "AT_RISK" && !(row.target_in !== null && row.target_in < 0), (row) => row.health.reasons[0]),
      ...attention((row) => row.approval_status === "PENDING", () => "Waiting for activation approval"),
    ].slice(0, 12),
    byStatus: Object.keys(STATUS_LABEL).map((status) => ({ status, label: STATUS_LABEL[status], count: count((row) => row.status === status) })),
    recent: recent.map((row) => ({ id: row.id, projectId: row.project_id, project: `${row.project_code}${row.name ? ` · ${row.name}` : ""}`, action: row.action, summary: row.summary, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at })),
    can: { create: has(c, PROJECT.create), reports: has(c, PROJECT.reports), viewAll: seesAll(c) },
  };
}
export const PROJECT_REPORTS = Object.freeze(["by-status", "by-manager", "by-customer", "by-priority", "near-deadline", "overdue", "on-hold", "task-progress", "milestone-summary", "completed", "activity"]);
// The overview reports, over the projects the person may see (so they reconcile with the directory).
export async function getProjectReport(client, c, kind = "by-status", filters = {}) {
  need(c, PROJECT.reports);
  if (!PROJECT_REPORTS.includes(kind)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose a project report.");
  const { rows, settings } = await directory(client, c, { ...filters, view: ["completed", "activity"].includes(kind) ? "everything" : filters.view ?? "all" });
  const group = (key, labelOf) => {
    const map = new Map();
    for (const row of rows) {
      const id = key(row) ?? "—";
      const entry = map.get(id) ?? { key: id, label: labelOf(row), total: 0, draft: 0, active: 0, onHold: 0, completed: 0, cancelled: 0, overdue: 0, atRisk: 0 };
      entry.total += 1;
      if (row.status === "DRAFT") entry.draft += 1; else if (["PLANNED", "IN_PROGRESS"].includes(row.status)) entry.active += 1; else if (row.status === "ON_HOLD") entry.onHold += 1;
      else if (row.status === "COMPLETED") entry.completed += 1; else entry.cancelled += 1;
      if (ACTIVE_STATUSES.includes(row.status) && row.target_in !== null && row.target_in < 0) entry.overdue += 1;
      if (row.health.state === "AT_RISK") entry.atRisk += 1;
      map.set(id, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };
  const open = (row) => ACTIVE_STATUSES.includes(row.status);
  switch (kind) {
    case "by-status": return Object.keys(STATUS_LABEL).map((status) => ({ key: status, label: STATUS_LABEL[status], total: rows.filter((row) => row.status === status).length }));
    case "by-manager": return group((row) => row.manager_user_id, (row) => row.manager_name || row.manager_email || "No manager");
    case "by-customer": return group((row) => (row.classification === "INTERNAL" ? "INTERNAL" : row.customer_id), (row) => (row.classification === "INTERNAL" ? "Internal projects" : row.customer_name ?? "No customer yet"));
    case "by-priority": return PRIORITIES.map((priority) => ({ key: priority, label: priority.toLowerCase(), total: rows.filter((row) => row.priority === priority).length,
      active: rows.filter((row) => row.priority === priority && open(row)).length }));
    case "near-deadline": return rows.filter((row) => open(row) && row.target_in !== null && row.target_in >= 0 && row.target_in <= settings.dueSoonDays).sort((a, b) => a.target_in - b.target_in).map(rowView);
    case "overdue": return rows.filter((row) => open(row) && row.target_in !== null && row.target_in < 0).sort((a, b) => a.target_in - b.target_in).map(rowView);
    case "on-hold": {
      const holds = rows.length ? new Map((await client.query(`SELECT * FROM tenant.project_holds WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) AND resolved_at IS NULL`,
        [c.organizationId, rows.map((row) => row.id)])).rows.map((row) => [row.project_id, row])) : new Map();
      return rows.filter((row) => row.status === "ON_HOLD").map((row) => ({ ...rowView(row), holdReason: holds.get(row.id)?.reason ?? null, heldSince: holds.get(row.id)?.started_at ?? null }));
    }
    case "task-progress": return rows.filter(open).map((row) => ({ ...rowView(row), tasks: row.progress.tasks }));
    case "milestone-summary": return rows.filter(open).map((row) => ({ ...rowView(row), milestones: row.progress.milestones }));
    case "completed": return rows.filter((row) => row.status === "COMPLETED").sort((a, b) => String(day(b.completed_at)).localeCompare(String(day(a.completed_at))))
      .map((row) => ({ ...rowView(row), onTime: row.target_end_date ? day(row.completed_at) <= day(row.target_end_date) : null }));
    case "activity": {
      if (!rows.length) return [];
      const events = (await client.query(`SELECT event.*, project.project_code, project.name FROM tenant.project_events event JOIN tenant.projects project ON project.id = event.project_id
          WHERE event.organization_id = $1 AND event.project_id = ANY($2::uuid[]) ORDER BY event.occurred_at DESC LIMIT 500`, [c.organizationId, rows.map((row) => row.id)])).rows;
      const names = await userNames(client, events.map((row) => row.actor_user_id));
      return events.map((row) => ({ projectId: row.project_id, code: row.project_code, name: row.name, action: row.action, summary: row.summary, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
    }
    default: return [];
  }
}
// The directory as CSV (what the person may see, with the filters applied).
export async function exportProjects(client, c, filters = {}) {
  need(c, PROJECT.export);
  const { rows } = await directory(client, c, filters);
  const cell = (value) => { const raw = value === null || value === undefined ? "" : String(value); return /[",\n\r]/.test(raw) || /^[=+\-@]/.test(raw) ? `"${(/^[=+\-@]/.test(raw) ? `'${raw}` : raw).replace(/"/g, "\"\"")}"` : raw; };
  const header = ["Code", "Name", "Classification", "Type", "Customer", "Manager", "Status", "Priority", "Start", "Target", "Actual start", "Completed", "Health", "Progress", "Tags", "Archived"];
  const lines = rows.map((row) => [row.project_code, row.name, row.classification, row.type_name, row.customer_name, row.manager_name || row.manager_email, STATUS_LABEL[row.status], row.priority,
    day(row.planned_start_date), day(row.target_end_date), day(row.actual_start_date), day(row.completed_at), row.health.label, row.progress.percent === null ? "" : `${row.progress.percent}%`,
    (row.tags ?? []).join("; "), row.archived_at ? "yes" : ""].map(cell).join(","));
  return { fileName: `projects-${await today(client)}.csv`, csv: [header.join(","), ...lines].join("\r\n"), count: rows.length };
}

// ------------------------------------------------------------------ what a form needs
export async function getProjectOptions(client, c) {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  await ensureProjectTypes(client, c);
  const types = (await client.query(`SELECT id, code, name FROM tenant.project_types WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY sort_order, name`, [c.organizationId])).rows;
  const users = (await client.query(
    `SELECT DISTINCT person.id, COALESCE(NULLIF(person.full_name, ''), person.email) AS name, person.email FROM public.organization_memberships membership
       JOIN public.users person ON person.id = membership.user_id
       JOIN public.user_role_assignments assignment ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
        AND (assignment.starts_at IS NULL OR assignment.starts_at <= now()) AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND (role.slug IN ('organization_owner', 'system_administrator') OR EXISTS (SELECT 1 FROM public.role_permissions grant_row WHERE grant_row.role_id = role.id AND grant_row.permission_key IN ('projects.view', 'projects.view_all')))
      ORDER BY 2 LIMIT 1000`, [c.organizationId])).rows;
  return { types, users, priorities: PRIORITIES, roles: Object.entries(ROLES).filter(([code]) => code !== "MANAGER").map(([code, name]) => ({ code, name })),
    settings: await projectSettings(client, c), currentUserId: c.userId,
    can: { create: has(c, PROJECT.create), viewAll: seesAll(c), export: has(c, PROJECT.export), reports: has(c, PROJECT.reports), settings: has(c, PROJECT.settings),
      inviteUsers: has(c, "users.manage") } };
}
export async function searchProjectCustomers(client, c, search = "") {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  return (await client.query(`SELECT id, display_name AS name, customer_number AS number FROM tenant.business_parties WHERE organization_id = $1 AND status = 'active'
      AND (customer_number IS NOT NULL OR party_type IN ('customer', 'both')) AND ($2 = '' OR lower(display_name) LIKE $3 OR lower(COALESCE(customer_number, '')) LIKE $3)
      ORDER BY display_name LIMIT 30`, [c.organizationId, text(search, 100), `%${text(search, 100).toLowerCase()}%`])).rows;
}
export async function listProjectCustomerContacts(client, c, customerId) {
  if (!canView(c)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  return (await client.query(`SELECT DISTINCT contact.id, COALESCE(NULLIF(contact.display_name, ''), btrim(concat_ws(' ', contact.first_name, contact.last_name))) AS name, contact.email
      FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.archived_at IS NULL
        AND (contact.party_id = $2 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contact.id AND relation.party_id = $2))
      ORDER BY 2 LIMIT 100`, [c.organizationId, uuid(customerId, "Customer")])).rows;
}
const SEARCH = Object.freeze({
  CRM_ACCOUNT: `SELECT id, COALESCE(customer_number, code) AS number, display_name AS title, status FROM tenant.business_parties WHERE organization_id = $1 AND ($3::uuid IS NULL OR id = $3) AND (lower(display_name) LIKE $2 OR lower(COALESCE(code, '')) LIKE $2)`,
  CRM_CONTACT: `SELECT id, contact_number AS number, COALESCE(NULLIF(display_name, ''), btrim(concat_ws(' ', first_name, last_name))) AS title, status FROM tenant.contacts WHERE organization_id = $1
      AND ($3::uuid IS NULL OR party_id = $3 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contacts.id AND relation.party_id = $3))
      AND (lower(COALESCE(display_name, '')) LIKE $2 OR lower(concat_ws(' ', first_name, last_name)) LIKE $2 OR lower(COALESCE(email, '')) LIKE $2)`,
  CRM_OPPORTUNITY: `SELECT id, code AS number, name AS title, status FROM tenant.crm_opportunities WHERE organization_id = $1 AND ($3::uuid IS NULL OR party_id = $3) AND (lower(name) LIKE $2 OR lower(COALESCE(code, '')) LIKE $2)`,
  SALES_QUOTATION: `SELECT id, quotation_number AS number, NULL AS title, lifecycle_status AS status FROM tenant.sales_quotations WHERE organization_id = $1 AND ($3::uuid IS NULL OR party_id = $3) AND lower(quotation_number) LIKE $2`,
  SALES_ORDER: `SELECT id, sales_order_number AS number, NULL AS title, lifecycle_status AS status FROM tenant.sales_orders WHERE organization_id = $1 AND ($3::uuid IS NULL OR party_id = $3) AND lower(sales_order_number) LIKE $2`,
  SALES_INVOICE: `SELECT id, invoice_number AS number, NULL AS title, status FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND invoice_type <> 'credit_note' AND ($3::uuid IS NULL OR party_id = $3) AND lower(COALESCE(invoice_number, '')) LIKE $2`,
  PURCHASE_ORDER: `SELECT id, purchase_order_number AS number, NULL AS title, status FROM tenant.purchase_orders WHERE organization_id = $1 AND $3::uuid IS NOT DISTINCT FROM $3 AND lower(COALESCE(purchase_order_number, '')) LIKE $2`,
  SUPPLIER_BILL: `SELECT id, bill_number AS number, supplier_invoice_number AS title, status FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND $3::uuid IS NOT DISTINCT FROM $3 AND (lower(COALESCE(bill_number, '')) LIKE $2 OR lower(COALESCE(supplier_invoice_number, '')) LIKE $2)`,
});
// Records of a type the person may see and link to this project (a customer project offers its customer's records).
export async function searchLinkableRecords(client, c, projectId, type, search = "") {
  const { project } = await visibleProject(client, c, projectId);
  const key = String(type ?? "").toUpperCase();
  const source = LINK_SOURCES[key];
  if (!source) throw projectError(400, "PROJECT_LINK_INVALID", "Choose what kind of record to link.");
  if (!has(c, source.permission)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const customer = project.classification === "CUSTOMER" && project.customer_id && !["PURCHASE_ORDER", "SUPPLIER_BILL"].includes(key) ? project.customer_id : null;
  return (await client.query(`${SEARCH[key]} ORDER BY 2 DESC NULLS LAST LIMIT 30`, [c.organizationId, `%${text(search, 100).toLowerCase()}%`, customer])).rows;
}

// ------------------------------------------------------------------ alerts (the worker, daily)
// Approaching and passed target dates, and a project whose manager is no longer active — each told once (per target date or condition) to
// the manager (and, when overdue, the team).
export async function notifyProjectAlerts(client, c) {
  const settings = await projectSettings(client, c);
  const rows = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND deleted_at IS NULL AND status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD') AND archived_at IS NULL`, [c.organizationId])).rows;
  const health = await healthContext(client, c, rows);
  let sent = 0;
  const once = async (project, key) => Boolean((await client.query(`INSERT INTO tenant.project_alerts (organization_id, project_id, alert_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
    [c.organizationId, project.id, key])).rows[0]);
  for (const project of rows) {
    const target = day(project.target_end_date);
    const left = target ? Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${health.day}T00:00:00Z`)) / 864e5) : null;
    if (left !== null && left < 0 && await once(project, `overdue:${target}`)) {
      const team = (await client.query(`SELECT user_id FROM tenant.project_members WHERE project_id = $1 AND left_at IS NULL`, [project.id])).rows.map((row) => row.user_id);
      await notifyProject(client, c, project, [project.manager_user_id, ...team], { category: "project_alert", title: `${project.project_code} is past its target date`,
        message: `${project.name} was due on ${target}.` });
      sent += 1;
    } else if (left !== null && left >= 0 && left <= settings.dueSoonDays && await once(project, `due:${target}`)) {
      await notifyProject(client, c, project, [project.manager_user_id], { category: "project_alert", title: `${project.project_code} is due in ${left} day(s)`, message: `${project.name} — target ${target}.` });
      sent += 1;
    }
    if (project.manager_user_id && !health.managers.has(project.manager_user_id) && await once(project, `manager-inactive:${project.manager_user_id}`)) {
      const managers = (await client.query(`SELECT DISTINCT member.user_id FROM tenant.project_members member WHERE member.project_id = $1 AND member.left_at IS NULL AND member.role = 'MEMBER'`, [project.id])).rows;
      await notifyProject(client, c, project, managers.map((row) => row.user_id), { category: "project_alert", title: `${project.project_code} needs a new Project Manager`,
        message: "Its manager is no longer active. Someone who manages projects should assign a replacement." });
      sent += 1;
    }
  }
  return { checked: rows.length, sent };
}
