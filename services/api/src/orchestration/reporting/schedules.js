// Scheduled report delivery (daily / weekly / monthly, in the schedule's own
// time zone). At each occurrence every recipient gets their OWN report run,
// executed later by the worker with that recipient's CURRENT authority, so a
// scheduled report never delivers rows a recipient could not open. A
// recipient who lost access is skipped (recorded with the reason), never sent
// the owner's data. Occurrences are idempotent: one run per (schedule,
// occurrence, recipient), enforced by a unique key and the job idempotency key.
import { buildWorkspaceAccessSnapshot, hasSessionPermission } from "../../core/access/index.js";
import { createNotification } from "../../core/platform/notifications/index.js";
import { resolveMemberExecutionContext } from "../../core/platform/reporting/execution-context.js";
import { audit } from "../../core/security/request-security.js";
import { getReportDataset } from "./datasets.js";
import { REPORT_RUN_JOB_TYPE, ReportError } from "./service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FREQUENCIES = new Set(["daily", "weekly", "monthly"]);
const MAX_RECIPIENTS = 25;

function localParts(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

function offsetMs(instantMs, timeZone) {
  const local = localParts(new Date(instantMs), timeZone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - Math.floor(instantMs / 60000) * 60000;
}

// Wall-clock time in a zone -> the UTC instant (DST-safe: re-checks the offset
// at the candidate instant; a wall time skipped by a spring-forward gap moves
// to the first valid minute after it).
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMs(guess, timeZone);
  const corrected = guess - offsetMs(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** The first occurrence strictly after `after` for a schedule. */
export function nextScheduleOccurrence(schedule, after = new Date()) {
  const [hour, minute] = String(schedule.timeOfDay ?? schedule.time_of_day).split(":").map(Number);
  const timeZone = schedule.timezone;
  const weekday = schedule.weekday ?? null;
  const monthDay = schedule.monthDay ?? schedule.month_day ?? null;
  const start = localParts(after, timeZone);
  for (let offset = 0; offset <= 62; offset += 1) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const matches =
      schedule.frequency === "daily" ||
      (schedule.frequency === "weekly" && date.getUTCDay() === Number(weekday)) ||
      (schedule.frequency === "monthly" && date.getUTCDate() === Number(monthDay));
    if (!matches) continue;
    const instant = zonedTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
    if (instant.getTime() > after.getTime()) return instant;
  }
  throw new ReportError(500, "Could not compute the next report run.", "REPORT_SCHEDULE_INVALID");
}

function normalizeSchedule(input) {
  const frequency = String(input?.frequency ?? "");
  if (!FREQUENCIES.has(frequency)) throw new ReportError(400, "Choose daily, weekly or monthly.", "REPORT_SCHEDULE_INVALID");
  const timeOfDay = String(input?.timeOfDay ?? "");
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(timeOfDay)) throw new ReportError(400, "Choose a time as HH:MM.", "REPORT_SCHEDULE_INVALID");
  const timezone = String(input?.timezone ?? "").slice(0, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new ReportError(400, "Choose a valid time zone.", "REPORT_SCHEDULE_TIMEZONE_INVALID");
  }
  if (!timezone) throw new ReportError(400, "Choose a valid time zone.", "REPORT_SCHEDULE_TIMEZONE_INVALID");
  const weekday = frequency === "weekly" ? Number(input?.weekday) : null;
  if (frequency === "weekly" && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new ReportError(400, "Choose a day of the week.", "REPORT_SCHEDULE_INVALID");
  const monthDay = frequency === "monthly" ? Number(input?.monthDay) : null;
  if (frequency === "monthly" && !(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 28)) throw new ReportError(400, "Choose a day of the month from 1 to 28.", "REPORT_SCHEDULE_INVALID");
  const recipients = [...new Set((Array.isArray(input?.recipients) ? input.recipients : []).map(String))];
  if (!recipients.length || recipients.length > MAX_RECIPIENTS) throw new ReportError(400, `Choose 1 to ${MAX_RECIPIENTS} recipients.`, "REPORT_SCHEDULE_RECIPIENTS_INVALID");
  if (recipients.some((id) => !UUID.test(id))) throw new ReportError(400, "A recipient is invalid.", "REPORT_SCHEDULE_RECIPIENTS_INVALID");
  return { frequency, timeOfDay, timezone, weekday, monthDay, recipients };
}

// Can this member run the dataset right now (module + dataset permissions)?
async function memberCanRun(client, organizationId, userId, dataset, { env = process.env } = {}) {
  const context = await resolveMemberExecutionContext(client, organizationId, { userId });
  if (!context) return { ok: false, reason: "No longer an active member of the organization." };
  const snapshot = await buildWorkspaceAccessSnapshot(client, context, { env });
  if (!new Set(snapshot.accessibleModules || []).has(dataset.moduleKey)) return { ok: false, reason: "No access to the module." };
  if (!dataset.requiredPermissions.every((permission) => hasSessionPermission(context, permission))) return { ok: false, reason: "No permission for this report." };
  return { ok: true, context };
}

async function loadDefinition(client, session, definitionId) {
  if (!UUID.test(String(definitionId || ""))) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
  const definition = (await client.query(`SELECT * FROM report_definitions WHERE organization_id=$1 AND id=$2 AND status='active'`, [session.organizationId, definitionId])).rows[0];
  if (!definition) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
  return definition;
}

/** Schedules a saved report for recurring delivery. */
export async function createReportSchedule(client, session, accessibleModules, input, { env = process.env, now = new Date() } = {}) {
  const definition = await loadDefinition(client, session, input?.definitionId);
  const dataset = getReportDataset(definition.dataset_key);
  if (!dataset || !new Set(accessibleModules || []).has(dataset.moduleKey) || !dataset.requiredPermissions.every((permission) => hasSessionPermission(session, permission)))
    throw new ReportError(403, "You cannot schedule this report.", "REPORT_SCHEDULE_FORBIDDEN");
  const schedulePermission = dataset.schedulePermission ?? "platform.reports.manage";
  if (!hasSessionPermission(session, schedulePermission)) throw new ReportError(403, "You cannot schedule this report.", "REPORT_SCHEDULE_FORBIDDEN");
  if (definition.created_by !== session.userId && !hasSessionPermission(session, "platform.reports.manage"))
    throw new ReportError(403, "Only the report's owner can schedule it.", "REPORT_SCHEDULE_FORBIDDEN");
  const schedule = normalizeSchedule(input);
  const refused = [];
  for (const recipient of schedule.recipients) {
    const check = await memberCanRun(client, session.organizationId, recipient, dataset, { env });
    if (!check.ok) refused.push(recipient);
  }
  if (refused.length) throw new ReportError(400, "Some recipients cannot receive this report (they lack access to it).", "REPORT_SCHEDULE_RECIPIENTS_INVALID", { recipients: refused });
  const nextRunAt = nextScheduleOccurrence(schedule, now);
  const { rows } = await client.query(
    `INSERT INTO report_schedules (organization_id, report_definition_id, frequency, time_of_day, weekday, month_day, timezone, recipients, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10) RETURNING *`,
    [session.organizationId, definition.id, schedule.frequency, schedule.timeOfDay, schedule.weekday, schedule.monthDay, schedule.timezone, schedule.recipients, nextRunAt, session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "report.schedule_created", entityType: "report_schedule", entityId: rows[0].id, afterData: { definitionId: definition.id, ...schedule } });
  return projectSchedule(rows[0]);
}

function projectSchedule(row) {
  return {
    id: row.id,
    definitionId: row.report_definition_id,
    definitionName: row.definition_name ?? null,
    frequency: row.frequency,
    timeOfDay: row.time_of_day,
    weekday: row.weekday,
    monthDay: row.month_day,
    timezone: row.timezone,
    recipients: row.recipients,
    status: row.status,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    isMine: row.is_mine ?? undefined,
  };
}

/** Schedules the caller owns or receives (all for a reports administrator), with recent deliveries. */
export async function listReportSchedules(client, session) {
  const manager = hasSessionPermission(session, "platform.reports.manage");
  const { rows } = await client.query(
    `SELECT schedule.*, definition.name AS definition_name, schedule.created_by = $2 AS is_mine,
            COALESCE((SELECT json_agg(json_build_object('occurrenceAt', delivery.occurrence_at, 'recipientUserId', delivery.recipient_user_id, 'status', delivery.status, 'reason', delivery.reason, 'reportRunId', delivery.report_run_id) ORDER BY delivery.occurrence_at DESC)
                        FROM (SELECT * FROM report_deliveries d WHERE d.organization_id=schedule.organization_id AND d.schedule_id=schedule.id
                                AND ($3::boolean OR schedule.created_by=$2 OR d.recipient_user_id=$2) ORDER BY d.occurrence_at DESC LIMIT 20) delivery), '[]') AS deliveries
       FROM report_schedules schedule JOIN report_definitions definition ON definition.id=schedule.report_definition_id
      WHERE schedule.organization_id=$1 AND schedule.status<>'cancelled' AND ($3::boolean OR schedule.created_by=$2 OR $2 = ANY(schedule.recipients))
      ORDER BY schedule.created_at DESC LIMIT 100`,
    [session.organizationId, session.userId, manager],
  );
  return rows.map((row) => ({ ...projectSchedule(row), deliveries: row.deliveries }));
}

export async function setReportScheduleStatus(client, session, scheduleId, status, { now = new Date() } = {}) {
  if (!["active", "paused", "cancelled"].includes(status)) throw new ReportError(400, "Unsupported status.", "REPORT_SCHEDULE_INVALID");
  if (!UUID.test(String(scheduleId || ""))) throw new ReportError(404, "Schedule not found.", "REPORT_SCHEDULE_NOT_FOUND");
  const manager = hasSessionPermission(session, "platform.reports.manage");
  const current = (await client.query(`SELECT * FROM report_schedules WHERE organization_id=$1 AND id=$2 AND ($3::boolean OR created_by=$4) FOR UPDATE`, [session.organizationId, scheduleId, manager, session.userId])).rows[0];
  if (!current || current.status === "cancelled") throw new ReportError(404, "Schedule not found.", "REPORT_SCHEDULE_NOT_FOUND");
  const nextRunAt = status === "active" ? nextScheduleOccurrence(current, now) : null;
  const { rows } = await client.query(`UPDATE report_schedules SET status=$3, next_run_at=$4, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [session.organizationId, scheduleId, status, nextRunAt]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "report.schedule_status_changed", entityType: "report_schedule", entityId: scheduleId, beforeData: { status: current.status }, afterData: { status } });
  return projectSchedule(rows[0]);
}

/**
 * Worker tick (organisation transaction): claims due schedules and queues
 * one run per recipient for the occurrence, then advances next_run_at. A
 * missed window (worker down) runs once, not once per missed occurrence.
 */
export async function enqueueDueReportSchedules(client, organizationId, { now = new Date(), env = process.env, limit = 50 } = {}) {
  const due = await client.query(
    `SELECT * FROM report_schedules WHERE organization_id=$1 AND status='active' AND next_run_at <= $2 ORDER BY next_run_at LIMIT $3 FOR UPDATE SKIP LOCKED`,
    [organizationId, now, limit],
  );
  let queued = 0;
  let skipped = 0;
  for (const schedule of due.rows) {
    const occurrenceAt = schedule.next_run_at;
    const definition = (await client.query(`SELECT * FROM report_definitions WHERE organization_id=$1 AND id=$2`, [organizationId, schedule.report_definition_id])).rows[0];
    const dataset = definition ? getReportDataset(definition.dataset_key) : null;
    for (const recipient of schedule.recipients) {
      const record = async (status, reason = null, runId = null) =>
        client.query(
          `INSERT INTO report_deliveries (organization_id, schedule_id, occurrence_at, recipient_user_id, report_run_id, status, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (schedule_id, occurrence_at, recipient_user_id) DO NOTHING RETURNING id`,
          [organizationId, schedule.id, occurrenceAt, recipient, runId, status, reason],
        );
      if (!definition || definition.status !== "active" || !dataset) {
        await record("skipped", "The saved report no longer exists.");
        skipped += 1;
        continue;
      }
      const check = await memberCanRun(client, organizationId, recipient, dataset, { env });
      if (!check.ok) {
        await record("skipped", check.reason);
        skipped += 1;
        continue;
      }
      const run = (
        await client.query(
          `INSERT INTO report_runs (organization_id, report_definition_id, dataset_key, filters, columns, status, requested_by, schedule_id, occurrence_at)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'queued',$6,$7,$8) RETURNING id`,
          [organizationId, definition.id, definition.dataset_key, JSON.stringify(definition.filters ?? {}), JSON.stringify(definition.columns ?? []), recipient, schedule.id, occurrenceAt],
        )
      ).rows[0];
      const delivery = await record("queued", null, run.id);
      if (!delivery.rows[0]) continue; // this occurrence was already queued for the recipient
      const job = (
        await client.query(
          `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, run_at, priority, max_attempts, requested_by, idempotency_key, progress, result_manifest)
           VALUES ($1,$2,$3::jsonb,'pending',now(),70,3,$4,$5,'{}'::jsonb,'{}'::jsonb)
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`,
          [organizationId, REPORT_RUN_JOB_TYPE, JSON.stringify({ reportRunId: run.id }), recipient, `report-schedule:${schedule.id}:${new Date(occurrenceAt).toISOString()}:${recipient}`],
        )
      ).rows[0];
      if (job) await client.query(`UPDATE report_runs SET job_id=$2 WHERE id=$1`, [run.id, job.id]);
      queued += 1;
    }
    await client.query(`UPDATE report_schedules SET last_run_at=$3, next_run_at=$4, updated_at=now() WHERE organization_id=$1 AND id=$2`, [organizationId, schedule.id, occurrenceAt, nextScheduleOccurrence(schedule, now)]);
  }
  return { schedules: due.rows.length, queued, skipped };
}

/** After a scheduled run: tell the recipient (in-app) and record the delivery. */
export async function deliverScheduledReportRun(client, organizationId, runId) {
  const run = (await client.query(`SELECT run.*, definition.name AS definition_name FROM report_runs run LEFT JOIN report_definitions definition ON definition.id=run.report_definition_id WHERE run.organization_id=$1 AND run.id=$2`, [organizationId, runId])).rows[0];
  if (!run?.schedule_id) return { delivered: false };
  const dataset = getReportDataset(run.dataset_key);
  const href = dataset?.moduleKey === "crm" ? `/crm/reports?run=${run.id}` : null;
  const notified = await createNotification(client, {
    organizationId,
    userId: run.requested_by,
    category: "report_delivered",
    title: `${run.definition_name ?? "Scheduled report"} is ready`,
    message: `${run.row_count ?? 0} rows. The file is available to download for a limited time.`,
    href,
    entityType: "report_run",
    entityId: run.id,
  });
  await client.query(
    `UPDATE report_deliveries SET status='delivered', delivered_at=now(), reason=$3, updated_at=now() WHERE organization_id=$1 AND report_run_id=$2 AND status='queued'`,
    [organizationId, run.id, notified ? null : "Notification turned off by the recipient; the file is still in their report history."],
  );
  return { delivered: true };
}

export async function failScheduledReportDelivery(client, organizationId, runId, error) {
  await client.query(
    `UPDATE report_deliveries SET status='failed', reason=$3, updated_at=now() WHERE organization_id=$1 AND report_run_id=$2 AND status='queued'`,
    [organizationId, runId, String(error?.message || error).slice(0, 500)],
  );
}
