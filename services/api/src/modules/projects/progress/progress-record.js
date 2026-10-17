// Projects — Progress Tracking, the record: the counts as they stand now (one query over the tasks and milestones themselves), and the
// append-only snapshots of how they moved. A snapshot is written after every change of scope or state — a task added, done, reopened or
// cancelled; a milestone completed, reopened, cancelled or waived; the project held, resumed, completed, cancelled or reopened — in the
// same transaction as the change, so a failed change leaves no snapshot and a repeated one changes nothing. Also the scope baselines and
// the target-date revisions.
import { has, projectError, projectEvent, registerProgressListener, text, visibleProject } from "../project-core.js";
import { healthContext } from "../project-summary.js";
import { CALCULATION_VERSION, progressError } from "./progress-rules.js";

export const PROGRESS = Object.freeze({ baseline: "projects.progress.baseline", export: "projects.progress.export" });

export async function companyDay(client, c) {
  return (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`, [c.organizationId])).rows[0].d;
}

// ------------------------------------------------------------------ the counts now
// One rule, everywhere: a cancelled task drops out of the denominator; every other task counts once (a task under a milestone is still one
// task; checklist items are never tasks); a task in review is not done.
export async function countsOf(client, c, projectIds, day = null) {
  const ids = [...new Set(projectIds)];
  if (!ids.length) return new Map();
  const today = day ?? await companyDay(client, c);
  const tasks = (await client.query(`SELECT project_id,
      count(*) FILTER (WHERE status <> 'CANCELLED')::int AS task_total, count(*) FILTER (WHERE status = 'DONE')::int AS task_done,
      count(*) FILTER (WHERE status = 'TO_DO')::int AS task_to_do, count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS task_in_progress,
      count(*) FILTER (WHERE status = 'BLOCKED')::int AS task_blocked, count(*) FILTER (WHERE status = 'IN_REVIEW')::int AS task_in_review,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND due_date < $3::date)::int AS task_overdue,
      count(*) FILTER (WHERE status = 'CANCELLED')::int AS task_cancelled,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND priority = 'HIGH')::int AS open_high,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND priority = 'URGENT')::int AS open_urgent,
      count(*) FILTER (WHERE status = 'BLOCKED' AND priority IN ('HIGH', 'URGENT'))::int AS blocked_critical,
      COALESCE(sum(estimate_minutes) FILTER (WHERE status <> 'CANCELLED'), 0)::int AS estimate_minutes,
      count(*) FILTER (WHERE status <> 'CANCELLED' AND estimate_minutes IS NOT NULL)::int AS estimated_tasks
     FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) GROUP BY project_id`, [c.organizationId, ids, today])).rows;
  const milestones = (await client.query(`SELECT project_id,
      count(*) FILTER (WHERE status <> 'CANCELLED')::int AS milestone_total, count(*) FILTER (WHERE status = 'COMPLETED')::int AS milestone_completed,
      count(*) FILTER (WHERE status <> 'CANCELLED' AND required_for_completion AND waived_at IS NULL)::int AS milestone_required_total,
      count(*) FILTER (WHERE status = 'COMPLETED' AND required_for_completion AND waived_at IS NULL)::int AS milestone_required_completed,
      count(*) FILTER (WHERE status <> 'CANCELLED' AND required_for_completion AND waived_at IS NOT NULL)::int AS milestone_waived,
      count(*) FILTER (WHERE status = 'SUBMITTED' OR approval_status = 'PENDING')::int AS milestone_pending_approval,
      count(*) FILTER (WHERE status NOT IN ('COMPLETED', 'CANCELLED') AND waived_at IS NULL AND current_due_date < $3::date)::int AS milestone_overdue,
      count(*) FILTER (WHERE status = 'BLOCKED')::int AS milestone_blocked
     FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) GROUP BY project_id`, [c.organizationId, ids, today])).rows;
  const zero = { task_total: 0, task_done: 0, task_to_do: 0, task_in_progress: 0, task_blocked: 0, task_in_review: 0, task_overdue: 0, task_cancelled: 0, open_high: 0, open_urgent: 0,
    blocked_critical: 0, estimate_minutes: 0, estimated_tasks: 0, milestone_total: 0, milestone_completed: 0, milestone_required_total: 0, milestone_required_completed: 0, milestone_waived: 0,
    milestone_pending_approval: 0, milestone_overdue: 0, milestone_blocked: 0 };
  return new Map(ids.map((id) => {
    const { project_id: _t, ...t } = tasks.find((row) => row.project_id === id) ?? {};
    const { project_id: _m, ...m } = milestones.find((row) => row.project_id === id) ?? {};
    return [id, { ...zero, ...t, ...m }];
  }));
}
// The latest event among the project's tasks, milestones and lifecycle — the point the figures are consistent with.
export async function sourceEventAt(client, c, projectId) {
  return (await client.query(`SELECT GREATEST(
      (SELECT max(occurred_at) FROM tenant.project_task_events WHERE organization_id = $1 AND project_id = $2),
      (SELECT max(occurred_at) FROM tenant.project_milestone_events WHERE organization_id = $1 AND project_id = $2),
      (SELECT max(occurred_at) FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2)) AS at`, [c.organizationId, projectId])).rows[0].at;
}

// ------------------------------------------------------------------ snapshots
const COUNT_COLUMNS = ["task_total", "task_done", "task_to_do", "task_in_progress", "task_blocked", "task_in_review", "task_overdue", "task_cancelled",
  "milestone_required_total", "milestone_required_completed", "milestone_waived"];
export const latestSnapshot = async (client, c, projectId, kinds = null) => (await client.query(`SELECT * FROM tenant.project_progress_snapshots WHERE organization_id = $1 AND project_id = $2
    AND ($3::text[] IS NULL OR kind = ANY($3::text[])) ORDER BY sequence DESC LIMIT 1`, [c.organizationId, projectId, kinds])).rows[0] ?? null;
const baselineVersion = async (client, c, projectId) => (await client.query(`SELECT max(version) AS v FROM tenant.project_progress_baselines WHERE organization_id = $1 AND project_id = $2`,
  [c.organizationId, projectId])).rows[0].v ?? null;
// kind: CHANGE (after a change of scope or state; skipped when nothing a snapshot holds moved), LIFECYCLE, DAILY (one a day), REBUILD.
export async function recordProjectProgressSnapshot(client, c, projectId, { kind = "CHANGE", cause = null, withHealth = kind !== "CHANGE" } = {}) {
  const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, projectId])).rows[0];
  if (!project || project.deleted_at) return null;
  const day = await companyDay(client, c);
  const counts = (await countsOf(client, c, [project.id], day)).get(project.id);
  let health = null;
  let codes = [];
  if (withHealth) {
    const context = await healthContext(client, c, [project]);
    const of = context.of(project);
    health = of.state;
    codes = of.codes ?? [];
  }
  if (kind === "CHANGE") {
    const last = await latestSnapshot(client, c, project.id);
    if (last && last.project_status === project.status && COUNT_COLUMNS.every((column) => Number(last[column]) === Number(counts[column]))) return { skipped: true };
  }
  const row = (await client.query(`INSERT INTO tenant.project_progress_snapshots (organization_id, project_id, kind, snapshot_day, calculation_version, source_event_at, cause_type, cause_id, cause_action,
      ${COUNT_COLUMNS.join(", ")}, project_status, health, health_reason_codes, baseline_version, created_by)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,${COUNT_COLUMNS.map((_, index) => `$${10 + index}`).join(",")},$21,$22,$23::text[],$24,$25)
     ${kind === "DAILY" ? "ON CONFLICT (project_id, snapshot_day) WHERE kind = 'DAILY' DO NOTHING" : ""} RETURNING *`,
  [c.organizationId, project.id, kind, day, CALCULATION_VERSION, await sourceEventAt(client, c, project.id), cause?.type ?? null, cause?.id ?? null, cause?.action ?? null,
    ...COUNT_COLUMNS.map((column) => counts[column]), project.status, health, codes, await baselineVersion(client, c, project.id), c.userId ?? null])).rows[0];
  return row ?? { skipped: true };
}
// Every change of scope or state in Tasks, Milestones and the project lifecycle reaches here, inside its own transaction.
registerProgressListener(async (client, c, projectId, cause) => {
  await recordProjectProgressSnapshot(client, c, projectId, { kind: cause?.type === "PROJECT" ? "LIFECYCLE" : "CHANGE", cause });
});

// ------------------------------------------------------------------ baselines
const leads = (access) => access.all || access.manager;
// The scope the project commits to now: its tasks but the cancelled, its required milestones not cancelled or waived, and its target.
// input: { reason, idempotencyKey? } — a re-baseline is versioned; the first one is taken automatically when the project starts.
export async function captureProjectProgressBaseline(client, c, projectId, input = {}) {
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT project_id, version FROM tenant.project_progress_baselines WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { projectId: done.project_id, version: done.version, replayed: true };
  }
  let scope;
  try { scope = await visibleProject(client, c, projectId); } catch (failure) {
    if (failure?.status === 404) throw progressError(404, "PROGRESS_PROJECT_NOT_FOUND");
    throw failure;
  }
  const { project, access } = scope;
  if (!has(c, PROGRESS.baseline) || !leads(access)) throw progressError(403, "PROGRESS_BASELINE_PERMISSION_DENIED");
  if (["DRAFT", "CANCELLED"].includes(project.status)) throw progressError(409, "PROGRESS_INPUT_INVALID", "A baseline is taken from a planned or running project.");
  const reason = text(input.reason, 1000);
  if (!reason) throw progressError(400, "PROGRESS_INPUT_INVALID", "Say why the scope is re-baselined (for example, an approved change request).", { field: "reason" });
  const tasks = (await client.query(`SELECT id FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status <> 'CANCELLED' ORDER BY created_at`, [c.organizationId, project.id])).rows.map((row) => row.id);
  const milestones = (await client.query(`SELECT id FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND status <> 'CANCELLED' AND required_for_completion AND waived_at IS NULL ORDER BY sequence`,
    [c.organizationId, project.id])).rows.map((row) => row.id);
  // Serialized per project: two re-baselines at once get consecutive versions, or one waits.
  await client.query(`SELECT id FROM tenant.projects WHERE id = $1 FOR UPDATE`, [project.id]);
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM tenant.project_progress_baselines WHERE organization_id = $1 AND project_id = $2`, [c.organizationId, project.id])).rows[0].v);
  await client.query(`INSERT INTO tenant.project_progress_baselines (organization_id, project_id, version, source, task_ids, milestone_ids, task_count, milestone_count, target_end_date, reason, captured_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8,$9,$10,$11,$12)`,
  [c.organizationId, project.id, version, version === 1 ? "PROJECT_START" : "REBASELINE", tasks, milestones, tasks.length, milestones.length, project.target_end_date, reason, c.userId ?? null, key]);
  await projectEvent(client, c, project.id, "BASELINE_CAPTURED", `Scope baseline v${version}: ${tasks.length} task(s), ${milestones.length} required milestone(s) — ${reason}`);
  return { projectId: project.id, version, taskCount: tasks.length, milestoneCount: milestones.length };
}

// ------------------------------------------------------------------ target revisions
// A started project's target date moves only with a reason when it moves later; every move is kept.
export async function recordTargetRevision(client, c, project, toDate, reason) {
  const from = project.target_end_date ? (project.target_end_date instanceof Date ? project.target_end_date.toISOString().slice(0, 10) : String(project.target_end_date).slice(0, 10)) : null;
  if (!["IN_PROGRESS", "ON_HOLD"].includes(project.status) || from === (toDate ?? null)) return null;
  const why = text(reason, 1000);
  if (from && toDate && toDate > from && !why) {
    throw projectError(400, "PROJECT_INPUT_INVALID", "Say why the target date moves later (it is kept with the schedule history).", { field: "targetChangeReason" });
  }
  await client.query(`INSERT INTO tenant.project_target_revisions (organization_id, project_id, from_date, to_date, reason, project_status, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, project.id, from, toDate ?? null, why || null, project.status, c.userId ?? null]);
  return { from, to: toDate ?? null };
}
