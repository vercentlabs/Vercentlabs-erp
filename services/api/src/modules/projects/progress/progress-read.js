// Projects — Progress Tracking, the reads: one project's progress summary (task completion, required milestones, schedule, health with its
// reasons, effort used against estimate, scope against its baseline, what changed last), the trend and the explanation of every move, the
// breakdowns by assignee and by milestone, the portfolio, the reports and their export, a reconciliation of the recorded history against
// the records, and the job that records daily snapshots and sends the progress alerts. Every figure is computed from the tasks, milestones,
// lifecycle and approved time themselves — nothing here can be typed in, and nothing here changes a task, milestone or project.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { PROJECT, STATUS_LABEL, has, isoDay, projectSettings, seesAll, userNames, uuid, visibleProject } from "../project-core.js";
import { projectDirectory } from "../project-read.js";
import { healthContext } from "../project-summary.js";
import { getProjectCompletionReadiness } from "../status/index.js";
import { getProjectTimeSummary } from "../timesheets/index.js";
import { PROGRESS, companyDay, countsOf, latestSnapshot, recordProjectProgressSnapshot, sourceEventAt } from "./progress-record.js";
import {
  CALCULATION_VERSION, CHANGE_LABEL, changeKind, explainWindow, milestonePercent, percentText, progressError, scheduleOf, taskPercent, taskProgressOf,
} from "./progress-rules.js";

const day = (value) => (value ? isoDay(value) : null);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const label = (project) => `${project.project_code}${project.name ? ` · ${project.name}` : ""}`;
const TASKS_BASE = "/projects/tasks";

// The project as this person may see it; someone who may not see it learns nothing about it.
async function progressScope(client, c, projectId) {
  try {
    uuid(projectId, "Project");
    return await visibleProject(client, c, projectId);
  } catch (failure) {
    if (failure?.status === 403) throw progressError(403, "PROGRESS_ACCESS_DENIED");
    throw progressError(404, "PROGRESS_PROJECT_NOT_FOUND");
  }
}
const seesTasks = (c) => has(c, PROJECT.taskView);
const leads = (access) => access.all || access.manager;

// ------------------------------------------------------------------ the pieces
export function calculateProjectTaskProgress(counts) {
  return taskProgressOf({ total: counts.task_total, done: counts.task_done, toDo: counts.task_to_do, inProgress: counts.task_in_progress, blocked: counts.task_blocked,
    inReview: counts.task_in_review, overdue: counts.task_overdue, cancelled: counts.task_cancelled, openHigh: counts.open_high, openUrgent: counts.open_urgent });
}
const taskLinks = (projectId) => ({
  all: `${TASKS_BASE}?view=all&projectId=${projectId}`, done: `${TASKS_BASE}?view=completed&projectId=${projectId}`, toDo: `${TASKS_BASE}?view=all&status=TO_DO&projectId=${projectId}`,
  inProgress: `${TASKS_BASE}?view=all&status=IN_PROGRESS&projectId=${projectId}`, blocked: `${TASKS_BASE}?view=blocked&projectId=${projectId}`,
  inReview: `${TASKS_BASE}?view=in_review&projectId=${projectId}`, overdue: `${TASKS_BASE}?view=overdue&projectId=${projectId}`, cancelled: `${TASKS_BASE}?view=cancelled&projectId=${projectId}`,
});
// Required milestones accepted (a submitted one is not complete; a waived one is counted apart), and each milestone with its linked tasks.
export async function calculateMilestoneProgress(client, c, project, counts, today) {
  const rows = (await client.query(`SELECT milestone.id, milestone.milestone_code, milestone.name, milestone.status, milestone.approval_status, milestone.required_for_completion, milestone.waived_at,
      to_char(milestone.current_due_date, 'YYYY-MM-DD') AS due, milestone.customer_acceptance_required, milestone.owner_user_id, milestone.sequence,
      (SELECT count(*) FROM tenant.project_tasks task WHERE task.milestone_id = milestone.id AND task.status <> 'CANCELLED')::int AS tasks_total,
      (SELECT count(*) FROM tenant.project_tasks task WHERE task.milestone_id = milestone.id AND task.status = 'DONE')::int AS tasks_done,
      (SELECT count(*) FROM tenant.project_milestone_blockers blocker WHERE blocker.milestone_id = milestone.id AND blocker.resolved_at IS NULL)::int AS blockers
     FROM tenant.project_milestones milestone WHERE milestone.organization_id = $1 AND milestone.project_id = $2 ORDER BY milestone.sequence, milestone.current_due_date`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, rows.map((row) => row.owner_user_id));
  const open = (row) => !["COMPLETED", "CANCELLED"].includes(row.status);
  const next = rows.filter((row) => open(row) && !row.waived_at).sort((a, b) => a.due.localeCompare(b.due))[0] ?? null;
  return {
    measure: "Required milestones accepted", total: counts.milestone_total, completed: counts.milestone_completed,
    requiredTotal: counts.milestone_required_total, requiredCompleted: counts.milestone_required_completed, percent: milestonePercent(counts.milestone_required_completed, counts.milestone_required_total),
    text: counts.milestone_required_total ? `${counts.milestone_required_completed} of ${counts.milestone_required_total} required milestone${counts.milestone_required_total === 1 ? "" : "s"} accepted` : "No required milestones",
    waived: counts.milestone_waived, pendingApproval: counts.milestone_pending_approval, overdue: counts.milestone_overdue, blocked: counts.milestone_blocked,
    next: next ? { id: next.id, code: next.milestone_code, name: next.name, due: next.due, status: next.status, overdue: next.due < today } : null,
    rows: rows.map((row) => ({
      id: row.id, code: row.milestone_code, name: row.name, status: row.status, approvalStatus: row.approval_status, required: row.required_for_completion, waived: Boolean(row.waived_at),
      due: row.due, overdue: open(row) && !row.waived_at && row.due < today, owner: names.get(row.owner_user_id) ?? null, customerAcceptance: row.customer_acceptance_required,
      // Supporting work only: all linked tasks done never completes the milestone by itself.
      tasks: { total: row.tasks_total, done: row.tasks_done, percent: taskPercent(row.tasks_done, row.tasks_total) }, blockers: row.blockers,
      href: `/projects/milestones/${row.id}`,
    })),
  };
}
// The current assignee's open and finished work — for coordinating, never a performance score.
export async function calculateProgressByAssignee(client, c, projectIds, today) {
  if (!projectIds.length) return [];
  const rows = (await client.query(`SELECT task.assignee_user_id, count(*)::int AS total, count(*) FILTER (WHERE task.status = 'DONE')::int AS done,
      count(*) FILTER (WHERE task.status <> 'DONE')::int AS open, count(*) FILTER (WHERE task.status = 'BLOCKED')::int AS blocked,
      count(*) FILTER (WHERE task.status <> 'DONE' AND task.due_date < $3::date)::int AS overdue,
      bool_or(task.assignee_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = task.project_id AND member.user_id = task.assignee_user_id AND member.left_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM tenant.projects project WHERE project.id = task.project_id AND project.manager_user_id = task.assignee_user_id)) AS off_team
     FROM tenant.project_tasks task WHERE task.organization_id = $1 AND task.project_id = ANY($2::uuid[]) AND task.status <> 'CANCELLED' GROUP BY 1`, [c.organizationId, projectIds, today])).rows;
  const ids = rows.map((row) => row.assignee_user_id).filter(Boolean);
  const names = await userNames(client, ids);
  const active = new Set(ids.length ? (await client.query(`SELECT person.id FROM public.users person JOIN public.organization_memberships membership ON membership.user_id = person.id AND membership.organization_id = $1
      AND membership.status = 'active' WHERE person.status = 'active' AND person.id = ANY($2::uuid[])`, [c.organizationId, ids])).rows.map((row) => row.id) : []);
  const single = projectIds.length === 1 ? projectIds[0] : null;
  return rows.map((row) => ({
    assigneeId: row.assignee_user_id, assignee: row.assignee_user_id ? names.get(row.assignee_user_id) ?? "Former user" : "Unassigned", total: row.total, done: row.done, open: row.open,
    blocked: row.blocked, overdue: row.overdue, percent: taskPercent(row.done, row.total),
    // Work left with someone who left the company or the team needs a new owner.
    needsReassignment: Boolean(row.assignee_user_id) && row.open > 0 && (!active.has(row.assignee_user_id) || Boolean(row.off_team)),
    href: `${TASKS_BASE}?view=open${single ? `&projectId=${single}` : ""}${row.assignee_user_id ? `&assigneeId=${row.assignee_user_id}` : "&view=unassigned"}`,
  })).sort((a, b) => b.open - a.open || (a.assignee ?? "").localeCompare(b.assignee ?? ""));
}
export async function getProjectScheduleIndicators(client, c, project, today, settings) {
  const holds = (await client.query(`SELECT COALESCE(sum(GREATEST(0, (COALESCE(resolved_at, now())::date - started_at::date))), 0)::int AS days, count(*)::int AS n FROM tenant.project_holds
     WHERE organization_id = $1 AND project_id = $2`, [c.organizationId, project.id])).rows[0];
  const revisions = (await client.query(`SELECT to_char(from_date, 'YYYY-MM-DD') AS from_date, to_char(to_date, 'YYYY-MM-DD') AS to_date, reason, changed_by, changed_at FROM tenant.project_target_revisions
     WHERE organization_id = $1 AND project_id = $2 ORDER BY changed_at`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, revisions.map((row) => row.changed_by));
  const target = day(project.target_end_date);
  return {
    ...scheduleOf({ status: project.status, today, plannedStart: day(project.planned_start_date), actualStart: day(project.actual_start_date), target, completedAt: day(project.completed_at),
      dueSoonDays: settings.dueSoonDays }),
    plannedStart: day(project.planned_start_date), actualStart: day(project.actual_start_date), originalTarget: day(project.original_target_end_date) ?? (project.actual_start_date ? null : target),
    currentTarget: target, completedAt: day(project.completed_at), holdDays: holds.days, holds: holds.n,
    revisions: revisions.map((row) => ({ from: row.from_date, to: row.to_date, reason: row.reason, by: names.get(row.changed_by) ?? null, at: row.changed_at })),
  };
}
// Effort used against estimate: integer minutes, missing estimates shown as missing, never a completion percentage.
async function effortOf(client, c, project, counts) {
  let time = null;
  try { time = await getProjectTimeSummary(client, c, project.id); } catch { time = null; }
  if (!time || !time.team) return { available: false, reason: "Time figures are shown to the project's managers and people who review team time." };
  const approved = time.totals.approvedMinutes;
  const estimate = counts.estimate_minutes;
  const coverage = counts.task_total ? Math.floor((counts.estimated_tasks * 1000) / counts.task_total) / 10 : null;
  return {
    available: true, measure: "Effort used against estimate", estimateMinutes: counts.estimated_tasks ? estimate : null, estimatedTasks: counts.estimated_tasks, activeTasks: counts.task_total, coverage,
    approvedMinutes: approved, submittedMinutes: time.totals.submittedMinutes, approvedBillableMinutes: time.totals.approvedBillableMinutes,
    approvedNonBillableMinutes: approved - time.totals.approvedBillableMinutes,
    // Comparable only over the tasks that have an estimate.
    varianceMinutes: counts.estimated_tasks ? approved - estimate : null,
    note: counts.estimated_tasks < counts.task_total ? `${counts.task_total - counts.estimated_tasks} of ${counts.task_total} task(s) have no estimate — the estimate is incomplete, not zero.` : null,
  };
}
// The scope now against a baseline (the latest, or a given version).
export async function getBaselineComparison(client, c, projectOrId, { version = null } = {}) {
  const project = typeof projectOrId === "string" ? (await progressScope(client, c, projectOrId)).project : projectOrId;
  const baselines = (await client.query(`SELECT * FROM tenant.project_progress_baselines WHERE organization_id = $1 AND project_id = $2 ORDER BY version`, [c.organizationId, project.id])).rows;
  if (!baselines.length) return { set: false, code: "PROGRESS_BASELINE_NOT_SET", message: "This Project has no approved baseline yet.", versions: [] };
  const baseline = version ? baselines.find((row) => row.version === Number(version)) : baselines[baselines.length - 1];
  if (!baseline) throw progressError(404, "PROGRESS_BASELINE_NOT_SET");
  const tasks = (await client.query(`SELECT id, task_code, title, status, created_at FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2`, [c.organizationId, project.id])).rows;
  const milestones = (await client.query(`SELECT id, milestone_code, name, status, required_for_completion, waived_at FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2`,
    [c.organizationId, project.id])).rows;
  const inTasks = new Set(baseline.task_ids);
  const inMilestones = new Set(baseline.milestone_ids);
  const activeTasks = tasks.filter((row) => row.status !== "CANCELLED");
  const activeMilestones = milestones.filter((row) => row.status !== "CANCELLED" && row.required_for_completion && !row.waived_at);
  const titles = seesTasks(c);
  const taskView = (row) => ({ id: row.id, code: row.task_code, ...(titles ? { title: row.title } : {}), status: row.status });
  const added = activeTasks.filter((row) => !inTasks.has(row.id));
  const removed = tasks.filter((row) => inTasks.has(row.id) && row.status === "CANCELLED");
  const names = await userNames(client, baselines.map((row) => row.captured_by));
  return {
    set: true, version: baseline.version, source: baseline.source, capturedAt: baseline.captured_at, capturedBy: names.get(baseline.captured_by) ?? null, reason: baseline.reason,
    baselineTasks: baseline.task_count, currentTasks: activeTasks.length, addedTasks: added.length, removedTasks: removed.length, netTasks: activeTasks.length - baseline.task_count,
    baselineMilestones: baseline.milestone_count, currentMilestones: activeMilestones.length,
    addedMilestones: activeMilestones.filter((row) => !inMilestones.has(row.id)).length, removedMilestones: milestones.filter((row) => inMilestones.has(row.id) && (row.status === "CANCELLED" || row.waived_at || !row.required_for_completion)).length,
    baselineTarget: day(baseline.target_end_date), currentTarget: day(project.target_end_date),
    added: added.slice(0, 100).map(taskView), removed: removed.slice(0, 100).map(taskView),
    versions: baselines.map((row) => ({ version: row.version, source: row.source, capturedAt: row.captured_at, capturedBy: names.get(row.captured_by) ?? null, reason: row.reason, taskCount: row.task_count,
      milestoneCount: row.milestone_count, target: day(row.target_end_date) })),
  };
}

// ------------------------------------------------------------------ one project's progress
export async function getProjectProgressSummary(client, c, projectId) {
  const { project, access } = await progressScope(client, c, projectId);
  const today = await companyDay(client, c);
  const settings = await projectSettings(client, c);
  const counts = (await countsOf(client, c, [project.id], today)).get(project.id);
  const health = (await healthContext(client, c, [project])).of(project);
  const tasks = { ...calculateProjectTaskProgress(counts), links: taskLinks(project.id) };
  const latest = await latestSnapshot(client, c, project.id);
  const inSync = Boolean(latest) && latest.task_total === counts.task_total && latest.task_done === counts.task_done && latest.milestone_required_completed === counts.milestone_required_completed
    && latest.milestone_required_total === counts.milestone_required_total && latest.project_status === project.status;
  let completion = null;
  if (project.status === "IN_PROGRESS") {
    try {
      const ready = await getProjectCompletionReadiness(client, c, project.id);
      completion = { ready: ready.ready, blockers: ready.checks.filter((row) => row.state === "FAIL" && row.key !== "signoff").map((row) => ({ key: row.key, label: row.label, message: row.message })) };
    } catch { completion = null; }
  }
  const changes = await recentChanges(client, c, project.id, { limit: 6 });
  return {
    projectId: project.id, code: project.project_code, name: project.name, status: project.status, statusLabel: STATUS_LABEL[project.status],
    calculationVersion: CALCULATION_VERSION, calculatedAt: new Date().toISOString(), sourceEventAt: await sourceEventAt(client, c, project.id),
    tasks, milestones: await calculateMilestoneProgress(client, c, project, counts, today),
    schedule: await getProjectScheduleIndicators(client, c, project, today, settings),
    health: { state: health.state, label: health.label, reasons: health.reasons, codes: health.codes ?? [], final: Boolean(health.final) },
    effort: await effortOf(client, c, project, counts),
    baseline: await getBaselineComparison(client, c, project),
    assignees: await calculateProgressByAssignee(client, c, [project.id], today),
    changes,
    // The recorded history agrees with the records; when it does not, a lead can record the current figures (reconciliation).
    freshness: { lastRecordedAt: latest?.snapshot_at ?? null, inSync, message: inSync ? null : latest ? "Project work changed since progress was last recorded." : "Progress history has not been recorded for this project yet." },
    completion,
    // A completed or cancelled project keeps its final figures; the percentage is never forced to 100%.
    outcome: ["COMPLETED", "CANCELLED"].includes(project.status) ? await finalOutcome(client, c, project) : null,
    can: { baseline: has(c, PROGRESS.baseline) && leads(access) && !["DRAFT", "CANCELLED"].includes(project.status), export: has(c, PROGRESS.export), record: leads(access), tasks: seesTasks(c) },
  };
}
async function finalOutcome(client, c, project) {
  const final = (await client.query(`SELECT * FROM tenant.project_progress_snapshots WHERE organization_id = $1 AND project_id = $2 AND kind = 'LIFECYCLE' AND project_status = $3 ORDER BY sequence DESC LIMIT 1`,
    [c.organizationId, project.id, project.status])).rows[0];
  if (!final) return { recorded: false, message: "Recorded before progress history existed: the figures shown are today's." };
  return { recorded: true, at: final.snapshot_at, percent: taskPercent(final.task_done, final.task_total), done: final.task_done, total: final.task_total,
    requiredMilestones: final.milestone_required_total, requiredCompleted: final.milestone_required_completed, waived: final.milestone_waived, status: final.project_status };
}

// ------------------------------------------------------------------ history and explanations
// The recorded moves of a project's progress, newest first, each with what caused it.
async function recentChanges(client, c, projectId, { from = null, to = null, limit = 200 } = {}) {
  const rows = (await client.query(`SELECT * FROM tenant.project_progress_snapshots WHERE organization_id = $1 AND project_id = $2 AND kind IN ('CHANGE', 'LIFECYCLE', 'REBUILD')
      AND ($3::timestamptz IS NULL OR snapshot_at >= $3) AND ($4::timestamptz IS NULL OR snapshot_at < $4) ORDER BY sequence DESC LIMIT $5`,
  [c.organizationId, projectId, from, to, Math.min(1000, Math.max(1, limit)) + 1])).rows;
  const taskIds = rows.filter((row) => row.cause_type === "TASK").map((row) => row.cause_id);
  const tasks = taskIds.length ? new Map((await client.query(`SELECT id, task_code, title FROM tenant.project_tasks WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, taskIds])).rows.map((row) => [row.id, row])) : new Map();
  const milestoneIds = rows.filter((row) => row.cause_type === "MILESTONE").map((row) => row.cause_id);
  const milestones = milestoneIds.length ? new Map((await client.query(`SELECT id, milestone_code, name FROM tenant.project_milestones WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, milestoneIds])).rows.map((row) => [row.id, row])) : new Map();
  const names = await userNames(client, rows.map((row) => row.created_by));
  const titles = seesTasks(c);
  const out = [];
  for (let index = 0; index < Math.min(rows.length, limit); index += 1) {
    const row = rows[index];
    const before = rows[index + 1] ?? null;
    const kind = row.kind === "REBUILD" ? "OTHER" : changeKind(before, row, row.cause_action);
    const task = tasks.get(row.cause_id);
    const milestone = milestones.get(row.cause_id);
    const subject = task ? `${task.task_code}${titles ? ` ${task.title}` : ""}` : milestone ? `${milestone.milestone_code} ${milestone.name}` : row.cause_type === "PROJECT" ? `Project ${STATUS_LABEL[row.project_status]?.toLowerCase() ?? ""}` : null;
    const after = taskPercent(row.task_done, row.task_total);
    const prior = before ? taskPercent(before.task_done, before.task_total) : null;
    out.push({ id: row.id, at: row.snapshot_at, kind, kindLabel: CHANGE_LABEL[kind], subject, actor: names.get(row.created_by) ?? "System", cause: { type: row.cause_type, id: row.cause_id, action: row.cause_action },
      before: before ? { percent: prior, done: before.task_done, total: before.task_total } : null, after: { percent: after, done: row.task_done, total: row.task_total },
      text: before && prior !== after ? `Task completion ${percentText(prior)} → ${percentText(after)} (${row.task_done} of ${row.task_total} done)` : `${row.task_done} of ${row.task_total} done`,
      href: task ? `${TASKS_BASE}/${task.id}` : milestone ? `/projects/milestones/${milestone.id}` : null });
  }
  return out;
}
// filters: { from?, to? } (days). A summary sentence for the window and each move inside it.
export async function explainProgressChange(client, c, projectId, filters = {}) {
  const { project } = await progressScope(client, c, projectId);
  const from = filters.from ? isoDay(filters.from) : null;
  const to = filters.to ? isoDay(filters.to) : null;
  const tz = (await client.query(`SELECT COALESCE(timezone, 'UTC') AS tz FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0].tz;
  const bound = async (d) => (d ? (await client.query(`SELECT ($1::date::timestamp AT TIME ZONE $2) AS at`, [d, tz])).rows[0].at : null);
  const start = await bound(from);
  const end = await bound(to ? addDays(to, 1) : null);
  const changes = await recentChanges(client, c, project.id, { from: start, to: end, limit: 500 });
  // The state just before the window opened.
  const opening = start ? (await client.query(`SELECT * FROM tenant.project_progress_snapshots WHERE organization_id = $1 AND project_id = $2 AND snapshot_at < $3 ORDER BY sequence DESC LIMIT 1`,
    [c.organizationId, project.id, start])).rows[0] ?? null : null;
  if (!changes.length) return { projectId: project.id, summary: opening ? `No change between ${from ?? "the start"} and ${to ?? "today"}.` : "No progress history for this period.", changes: [], available: Boolean(opening) };
  const last = changes[0].after;
  const first = opening ? { task_done: opening.task_done, task_total: opening.task_total } : changes[changes.length - 1].before ?? { task_done: changes[changes.length - 1].after.done, task_total: changes[changes.length - 1].after.total };
  return { projectId: project.id, summary: explainWindow({ task_done: first.task_done ?? first.done, task_total: first.task_total ?? first.total }, { task_done: last.done, task_total: last.total }, changes.map((row) => row.kind)),
    changes, available: true };
}
// The trend: one point a day or a week. Each point is the figure as recorded then (from the snapshots) and as the records reconstruct it now
// (from the task events); a period before any record says so rather than inventing a number.
export async function getProjectProgressHistory(client, c, projectId, filters = {}) {
  const { project } = await progressScope(client, c, projectId);
  const interval = filters.interval === "day" ? 1 : 7;
  const count = Math.min(Math.max(Number(filters.points) || 12, 2), 104);
  const today = await companyDay(client, c);
  const tz = (await client.query(`SELECT COALESCE(timezone, 'UTC') AS tz FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0].tz;
  const events = (await client.query(`SELECT task_id, to_status, to_char((occurred_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day FROM tenant.project_task_events
     WHERE organization_id = $1 AND project_id = $2 AND to_status IS NOT NULL ORDER BY occurred_at, id`, [c.organizationId, project.id, tz])).rows;
  const snapshots = (await client.query(`SELECT task_done, task_total, to_char((snapshot_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, sequence FROM tenant.project_progress_snapshots
     WHERE organization_id = $1 AND project_id = $2 ORDER BY sequence`, [c.organizationId, project.id, tz])).rows;
  const created = (await client.query(`SELECT to_char((created_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d FROM tenant.projects WHERE id = $1`, [project.id, tz])).rows[0].d;
  const points = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const at = addDays(today, -index * interval);
    if (at < created) { points.push({ date: at, available: false, recorded: null, reconstructed: null }); continue; }
    const state = new Map();
    for (const event of events) if (event.day <= at) state.set(event.task_id, event.to_status);
    const active = [...state.values()].filter((status) => status !== "CANCELLED");
    const done = active.filter((status) => status === "DONE").length;
    const recordedRow = [...snapshots].reverse().find((row) => row.day <= at) ?? null;
    const reconstructed = { done, total: active.length, percent: taskPercent(done, active.length) };
    const recorded = recordedRow ? { done: recordedRow.task_done, total: recordedRow.task_total, percent: taskPercent(recordedRow.task_done, recordedRow.task_total) } : null;
    points.push({ date: at, available: true, recorded, reconstructed, corrected: Boolean(recorded) && (recorded.done !== reconstructed.done || recorded.total !== reconstructed.total) });
  }
  return { projectId: project.id, interval: interval === 1 ? "day" : "week", points, measure: "Task completion" };
}

// ------------------------------------------------------------------ reconciliation
// Recomputes the figures from the tasks and milestones, compares them with the recorded history and the task event history, and records the
// current figures. Never changes a task, milestone or project.
export async function rebuildProjectProgressProjection(client, c, projectId) {
  const { project, access } = await progressScope(client, c, projectId);
  if (!leads(access)) throw progressError(403, "PROGRESS_ACCESS_DENIED", "Only the project's managers can record its progress.");
  const latest = await latestSnapshot(client, c, project.id);
  const counts = (await countsOf(client, c, [project.id])).get(project.id);
  // Each task's last recorded status against its status now (a difference means a change reached the task outside its workflow).
  const drift = (await client.query(`SELECT task.id, task.task_code, task.status, last.to_status FROM tenant.project_tasks task
      LEFT JOIN LATERAL (SELECT to_status FROM tenant.project_task_events event WHERE event.task_id = task.id AND event.to_status IS NOT NULL ORDER BY occurred_at DESC, id DESC LIMIT 1) last ON true
     WHERE task.organization_id = $1 AND task.project_id = $2 AND last.to_status IS DISTINCT FROM task.status`, [c.organizationId, project.id])).rows;
  const recordedDiffers = Boolean(latest) && (latest.task_total !== counts.task_total || latest.task_done !== counts.task_done);
  const row = await recordProjectProgressSnapshot(client, c, project.id, { kind: "REBUILD" });
  return {
    projectId: project.id, consistent: !drift.length && !recordedDiffers, recordedDiffered: recordedDiffers,
    eventDrift: drift.map((task) => ({ taskId: task.id, code: task.task_code, status: task.status, lastEventStatus: task.to_status })),
    recorded: { percent: taskPercent(row.task_done, row.task_total), done: row.task_done, total: row.task_total, at: row.snapshot_at },
    message: drift.length ? "Some tasks changed outside their workflow; their history cannot explain every move. The current figures are recorded now." : recordedDiffers ? "The recorded figures were behind; the current figures are recorded now." : "The recorded history matches the tasks and milestones.",
  };
}

// ------------------------------------------------------------------ the portfolio
// filters: the project list's filters plus { attention: "1" } (at risk, blocked or overdue). Two aggregate measures, each named: the share of
// all active tasks done across the projects, and the unweighted average of the projects' percentages.
export async function getPortfolioProgress(client, c, filters = {}) {
  const { rows, settings, day: today } = await projectDirectory(client, c, { view: filters.view ?? "all", search: filters.search, status: filters.status, managerId: filters.managerId, customerId: filters.customerId,
    priority: filters.priority, health: filters.health });
  const open = rows.filter((row) => !row.archived_at && row.status !== "DRAFT");
  const counts = await countsOf(client, c, open.map((row) => row.id), today);
  const items = open.map((row) => {
    const n = counts.get(row.id);
    const schedule = scheduleOf({ status: row.status, today, plannedStart: day(row.planned_start_date), actualStart: day(row.actual_start_date), target: day(row.target_end_date), completedAt: day(row.completed_at),
      dueSoonDays: settings.dueSoonDays });
    return {
      id: row.id, code: row.project_code, name: row.name, manager: row.manager_name || row.manager_email || null, managerId: row.manager_user_id, status: row.status, statusLabel: STATUS_LABEL[row.status],
      health: row.health.state, healthLabel: row.health.label, healthReasons: row.health.reasons, customer: row.customer_name ?? null,
      percent: taskPercent(n.task_done, n.task_total), done: n.task_done, total: n.task_total, blocked: n.task_blocked, overdue: n.task_overdue, inReview: n.task_in_review,
      milestonesRequired: n.milestone_required_total, milestonesCompleted: n.milestone_required_completed, milestonePercent: milestonePercent(n.milestone_required_completed, n.milestone_required_total),
      target: day(row.target_end_date), schedule: schedule.indicator, scheduleLabel: schedule.label, remainingDays: schedule.remainingDays,
      attention: ["AT_RISK", "BLOCKED"].includes(row.health.state) || schedule.indicator === "OVERDUE",
    };
  });
  const shown = filters.attention ? items.filter((item) => item.attention) : items;
  const sort = { progress: (a, b) => (a.percent ?? -1) - (b.percent ?? -1), target: (a, b) => (a.target ?? "9999").localeCompare(b.target ?? "9999"), code: (a, b) => a.code.localeCompare(b.code),
    health: (a, b) => ["BLOCKED", "AT_RISK", "UNKNOWN", "ON_TRACK", "COMPLETED", "CANCELLED"].indexOf(a.health) - ["BLOCKED", "AT_RISK", "UNKNOWN", "ON_TRACK", "COMPLETED", "CANCELLED"].indexOf(b.health) }[filters.sort] ?? null;
  if (sort) shown.sort(filters.direction === "desc" ? (a, b) => sort(b, a) : sort);
  const live = items.filter((item) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(item.status));
  const done = live.reduce((sum, item) => sum + item.done, 0);
  const total = live.reduce((sum, item) => sum + item.total, 0);
  const measured = live.filter((item) => item.percent !== null);
  return {
    measures: {
      aggregate: { label: "Tasks done across active projects", percent: taskPercent(done, total), done, total },
      average: { label: "Unweighted average of project percentages", percent: measured.length ? Math.floor((measured.reduce((sum, item) => sum + item.percent, 0) * 10) / measured.length) / 10 : null, projects: measured.length },
    },
    totals: { projects: live.length, onTrack: live.filter((item) => item.health === "ON_TRACK").length, atRisk: live.filter((item) => item.health === "AT_RISK").length,
      blocked: live.filter((item) => item.health === "BLOCKED").length, overdue: live.filter((item) => item.schedule === "OVERDUE").length, dueSoon: live.filter((item) => item.schedule === "DUE_SOON").length,
      noTasks: live.filter((item) => !item.total).length, attention: live.filter((item) => item.attention).length },
    projects: shown, calculatedAt: new Date().toISOString(), can: { export: has(c, PROGRESS.export) },
  };
}

// ------------------------------------------------------------------ reports
export const PROGRESS_REPORTS = Object.freeze(["overview", "by-manager", "task-status", "milestones", "by-assignee", "overdue-blocked", "trend", "baseline", "near-deadline", "on-hold",
  "completed-outcomes", "reopened", "estimate-vs-approved", "exceptions"]);
export async function getProgressReport(client, c, kind = "overview", filters = {}) {
  if (!PROGRESS_REPORTS.includes(kind)) throw progressError(400, "PROGRESS_INPUT_INVALID", "Unknown report.");
  if (!has(c, PROJECT.view) && !seesAll(c)) throw progressError(403, "PROGRESS_ACCESS_DENIED");
  const portfolio = await getPortfolioProgress(client, c, { ...filters, view: ["completed-outcomes", "reopened"].includes(kind) ? "everything" : "all" });
  const projects = portfolio.projects;
  const today = await companyDay(client, c);
  switch (kind) {
    case "overview": return projects.filter((row) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status));
    case "by-manager": {
      const groups = new Map();
      for (const row of projects.filter((item) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(item.status))) {
        const key = row.managerId ?? "none";
        const group = groups.get(key) ?? { managerId: row.managerId, manager: row.manager ?? "No manager", projects: 0, done: 0, total: 0, atRisk: 0, overdue: 0 };
        group.projects += 1; group.done += row.done; group.total += row.total;
        if (["AT_RISK", "BLOCKED"].includes(row.health)) group.atRisk += 1;
        if (row.schedule === "OVERDUE") group.overdue += 1;
        groups.set(key, group);
      }
      return [...groups.values()].map((group) => ({ ...group, percent: taskPercent(group.done, group.total) })).sort((a, b) => b.projects - a.projects);
    }
    case "task-status": {
      const counts = await countsOf(client, c, projects.map((row) => row.id), today);
      return projects.filter((row) => row.total || row.status === "IN_PROGRESS").map((row) => {
        const n = counts.get(row.id);
        return { id: row.id, code: row.code, name: row.name, toDo: n.task_to_do, inProgress: n.task_in_progress, blocked: n.task_blocked, inReview: n.task_in_review, done: n.task_done, cancelled: n.task_cancelled,
          overdue: n.task_overdue, percent: row.percent };
      });
    }
    case "milestones": {
      const counts = await countsOf(client, c, projects.map((row) => row.id), today);
      return projects.filter((row) => counts.get(row.id).milestone_total).map((row) => {
        const n = counts.get(row.id);
        return { id: row.id, code: row.code, name: row.name, required: n.milestone_required_total, accepted: n.milestone_required_completed, percent: milestonePercent(n.milestone_required_completed, n.milestone_required_total),
          pendingApproval: n.milestone_pending_approval, overdue: n.milestone_overdue, waived: n.milestone_waived, blocked: n.milestone_blocked };
      });
    }
    case "by-assignee": return calculateProgressByAssignee(client, c, projects.filter((row) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status)).map((row) => row.id), today);
    case "overdue-blocked": return projects.filter((row) => row.overdue || row.blocked || row.schedule === "OVERDUE").map((row) => ({ ...row, projectOverdue: row.schedule === "OVERDUE" }));
    case "near-deadline": return projects.filter((row) => row.schedule === "DUE_SOON" || row.schedule === "OVERDUE").sort((a, b) => (a.remainingDays ?? 0) - (b.remainingDays ?? 0));
    case "on-hold": return projects.filter((row) => row.status === "ON_HOLD");
    case "trend": {
      // Task completion across the visible active projects, a point a week, from the recorded figures (the last record of each project by then).
      const ids = projects.filter((row) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status)).map((row) => row.id);
      const snaps = ids.length ? (await client.query(`SELECT project_id, task_done, task_total, snapshot_at FROM tenant.project_progress_snapshots WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) ORDER BY sequence`,
        [c.organizationId, ids])).rows : [];
      const out = [];
      for (let index = 11; index >= 0; index -= 1) {
        const at = addDays(today, -index * 7);
        const last = new Map();
        for (const row of snaps) if (isoDay(row.snapshot_at) <= at) last.set(row.project_id, row);
        const done = [...last.values()].reduce((sum, row) => sum + row.task_done, 0);
        const total = [...last.values()].reduce((sum, row) => sum + row.task_total, 0);
        out.push({ date: at, projects: last.size, done, total, percent: taskPercent(done, total) });
      }
      return out;
    }
    case "baseline": {
      const out = [];
      for (const row of projects.filter((item) => ["IN_PROGRESS", "ON_HOLD", "COMPLETED"].includes(item.status)).slice(0, 300)) {
        const project = (await client.query(`SELECT * FROM tenant.projects WHERE id = $1`, [row.id])).rows[0];
        const compare = await getBaselineComparison(client, c, project);
        out.push({ id: row.id, code: row.code, name: row.name, set: compare.set, version: compare.version ?? null, baselineTasks: compare.baselineTasks ?? null, currentTasks: compare.currentTasks ?? row.total,
          added: compare.addedTasks ?? null, removed: compare.removedTasks ?? null, net: compare.netTasks ?? null, baselineTarget: compare.baselineTarget ?? null, currentTarget: row.target });
      }
      return out;
    }
    case "completed-outcomes": {
      const out = [];
      for (const row of projects.filter((item) => item.status === "COMPLETED" || item.status === "CANCELLED")) {
        const project = (await client.query(`SELECT * FROM tenant.projects WHERE id = $1`, [row.id])).rows[0];
        const outcome = await finalOutcome(client, c, project);
        out.push({ id: row.id, code: row.code, name: row.name, status: row.status, statusLabel: row.statusLabel, completedAt: day(project.completed_at), target: row.target,
          schedule: row.scheduleLabel, finalPercent: outcome.recorded ? outcome.percent : row.percent, recorded: outcome.recorded, waived: outcome.recorded ? outcome.waived : null });
      }
      return out;
    }
    case "reopened": {
      const ids = projects.map((row) => row.id);
      const rows = ids.length ? (await client.query(`SELECT project_id, count(*)::int AS times, max(occurred_at) AS last_at FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = ANY($2::uuid[])
          AND action = 'REOPENED' GROUP BY 1`, [c.organizationId, ids])).rows : [];
      return rows.map((row) => {
        const project = projects.find((item) => item.id === row.project_id);
        return { id: row.project_id, code: project.code, name: project.name, status: project.statusLabel, times: row.times, lastAt: row.last_at, percent: project.percent };
      });
    }
    case "estimate-vs-approved": {
      const ids = projects.filter((row) => ["IN_PROGRESS", "ON_HOLD", "COMPLETED"].includes(row.status)).map((row) => row.id);
      if (!ids.length) return [];
      const lead = seesAll(c);
      const rows = (await client.query(`SELECT project.id, project.project_code, project.name,
          (SELECT COALESCE(sum(task.estimate_minutes), 0) FROM tenant.project_tasks task WHERE task.project_id = project.id AND task.status <> 'CANCELLED')::int AS estimate,
          (SELECT count(*) FROM tenant.project_tasks task WHERE task.project_id = project.id AND task.status <> 'CANCELLED' AND task.estimate_minutes IS NOT NULL)::int AS estimated,
          (SELECT count(*) FROM tenant.project_tasks task WHERE task.project_id = project.id AND task.status <> 'CANCELLED')::int AS tasks,
          (SELECT COALESCE(sum(entry.duration_minutes), 0) FROM tenant.project_time_entries entry WHERE entry.project_id = project.id AND entry.entry_status = 'APPROVED')::int AS approved
         FROM tenant.projects project WHERE project.organization_id = $1 AND project.id = ANY($2::uuid[]) AND ($3 OR project.manager_user_id = $4)`, [c.organizationId, ids, lead, c.userId ?? null])).rows;
      return rows.map((row) => ({ id: row.id, code: row.project_code, name: row.name, estimateMinutes: row.estimated ? row.estimate : null, estimatedTasks: row.estimated, tasks: row.tasks, approvedMinutes: row.approved,
        varianceMinutes: row.estimated ? row.approved - row.estimate : null }));
    }
    case "exceptions": {
      const live = projects.filter((row) => ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status));
      const out = [];
      for (const row of live) {
        const reasons = [];
        if (!row.total) reasons.push("No tasks — progress is unavailable");
        const latest = await latestSnapshot(client, c, row.id);
        if (row.status !== "PLANNED" && !latest) reasons.push("No progress history recorded yet");
        else if (latest && (latest.task_total !== row.total || latest.task_done !== row.done)) reasons.push("Recorded progress is behind the tasks — record it again");
        const baseline = (await client.query(`SELECT 1 FROM tenant.project_progress_baselines WHERE project_id = $1 LIMIT 1`, [row.id])).rows[0];
        if (row.status !== "PLANNED" && !baseline) reasons.push("No scope baseline");
        if (!row.target) reasons.push("No target date");
        if (reasons.length) out.push({ id: row.id, code: row.code, name: row.name, status: row.statusLabel, reasons });
      }
      return out;
    }
    default: return [];
  }
}
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportProjectProgress(client, c, filters = {}) {
  if (!has(c, PROGRESS.export)) throw progressError(403, "PROGRESS_ACCESS_DENIED", "Exporting progress needs the export permission.");
  const { projects } = await getPortfolioProgress(client, c, { ...filters, view: "all" });
  const header = ["Project", "Name", "Manager", "Status", "Health", "Task completion %", "Tasks done", "Active tasks", "Blocked", "Overdue tasks", "Required milestones accepted", "Required milestones",
    "Target date", "Schedule", "Calculation version"];
  const lines = projects.map((row) => [row.code, row.name ?? "", row.manager ?? "", row.statusLabel, row.healthLabel, row.percent ?? "Not available", row.done, row.total, row.blocked, row.overdue,
    row.milestonesCompleted, row.milestonesRequired, row.target ?? "", row.scheduleLabel, CALCULATION_VERSION]);
  return { fileName: `project-progress-${await companyDay(client, c)}.csv`, csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: projects.length };
}

// ------------------------------------------------------------------ the daily job: snapshots and alerts
// For a scheduler: records each running project's daily snapshot (with health) and tells its manager — once — when it turned at risk or
// blocked, when every completion check is met, and (if the company asks) a weekly summary on Mondays. Never changes the project.
export async function evaluateProjectProgress(client, c) {
  const settings = await projectSettings(client, c);
  const weekly = Boolean((await client.query(`SELECT progress_weekly_summary FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.progress_weekly_summary);
  const today = await companyDay(client, c);
  const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  const projects = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND deleted_at IS NULL AND archived_at IS NULL AND status IN ('PLANNED', 'IN_PROGRESS', 'ON_HOLD')`, [c.organizationId])).rows;
  let recorded = 0;
  let sent = 0;
  const tell = async (project, kind, title, message) => {
    if (!project.manager_user_id) return;
    const marker = `progress:${kind}:${project.id}:${today}`;
    const already = (await client.query(`SELECT 1 FROM notifications WHERE organization_id = $1 AND user_id = $2 AND entity_type = 'projects.progress' AND entity_id = $3 LIMIT 1`,
      [c.organizationId, project.manager_user_id, marker])).rows[0];
    if (already) return;
    if (await createNotification(client, { organizationId: c.organizationId, userId: project.manager_user_id, category: "project_progress", title, message, href: `/projects/${project.id}`,
      entityType: "projects.progress", entityId: marker })) sent += 1;
  };
  for (const project of projects) {
    const previous = await latestSnapshot(client, c, project.id, ["DAILY", "LIFECYCLE", "REBUILD"]);
    const row = await recordProjectProgressSnapshot(client, c, project.id, { kind: "DAILY" });
    if (!row || row.skipped) continue;
    recorded += 1;
    if (["AT_RISK", "BLOCKED"].includes(row.health) && previous?.health && !["AT_RISK", "BLOCKED"].includes(previous.health)) {
      const health = (await healthContext(client, c, [project])).of(project);
      await tell(project, "risk", `${project.project_code} is ${health.label.toLowerCase()}`, health.reasons.slice(0, 3).join(" "));
    }
    if (project.status === "IN_PROGRESS" && row.task_total > 0 && row.task_done === row.task_total && row.milestone_required_completed === row.milestone_required_total
      && !(previous && previous.task_total > 0 && previous.task_done === previous.task_total && previous.milestone_required_completed === previous.milestone_required_total)) {
      await tell(project, "ready", `${project.project_code}: every task and required milestone is complete`, "Review the completion checks and complete the project when ready — it is not completed automatically.");
    }
    if (weekly && monday) {
      await tell(project, "weekly", `${label(project)}: weekly progress`, `${percentText(taskPercent(row.task_done, row.task_total))} task completion (${row.task_done} of ${row.task_total}); ${row.milestone_required_completed} of ${row.milestone_required_total} required milestones accepted; ${row.task_overdue} task(s) overdue, ${row.task_blocked} blocked.`);
    }
  }
  return { checked: projects.length, recorded, sent, dueSoonDays: settings.dueSoonDays };
}

// ------------------------------------------------------------------ settings
export async function getProgressSettings(client, c) {
  const row = (await client.query(`SELECT progress_weekly_summary FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return { weeklySummary: Boolean(row?.progress_weekly_summary), calculationVersion: CALCULATION_VERSION, can: { manage: has(c, "projects.settings.manage") } };
}
export async function saveProgressSettings(client, c, input = {}) {
  if (!has(c, "projects.settings.manage")) throw progressError(403, "PROGRESS_ACCESS_DENIED");
  const weekly = Boolean(input.weeklySummary);
  await client.query(`INSERT INTO tenant.project_settings (organization_id, progress_weekly_summary) VALUES ($1,$2) ON CONFLICT (organization_id) DO UPDATE SET progress_weekly_summary = EXCLUDED.progress_weekly_summary`,
    [c.organizationId, weekly]);
  return { weeklySummary: weekly };
}
