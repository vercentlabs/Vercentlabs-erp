import { createLogger } from "@vercentlabs/observability";

import { enqueueJob } from "./queue.js";
import { withTenantClient, listActiveOrganizationIds } from "./db.js";
import { JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE } from "./handlers/crm-follow-up-reminder-dispatch.js";
import { JOB_TYPE as TASK_OVERDUE_JOB_TYPE } from "./handlers/crm-task-overdue.js";
import { JOB_TYPE as REORDER_RECONCILE_JOB_TYPE } from "./handlers/stock-reorder-reconcile.js";
import { JOB_TYPE as LOW_STOCK_DISPATCH_JOB_TYPE } from "./handlers/stock-low-stock-dispatch.js";
import { JOB_TYPE as HOLD_OVERDUE_JOB_TYPE } from "./handlers/manufacturing-hold-overdue.js";
import { JOB_TYPE as PROJECT_ALERTS_JOB_TYPE } from "./handlers/projects-alerts.js";
import { JOB_TYPE as DEPRECIATION_AUTOMATION_JOB_TYPE } from "./handlers/assets-depreciation-automation.js";
import { JOB_TYPE as MAINTENANCE_SCHEDULE_JOB_TYPE } from "./handlers/assets-maintenance.js";
import { JOB_TYPE as LEAD_CONNECTORS_POLL_JOB_TYPE } from "./handlers/crm-lead-connectors-poll.js";
import { JOB_TYPE as LEAD_RESPONSE_WATCH_JOB_TYPE } from "./handlers/crm-lead-response-watch.js";
import { JOB_TYPE as CALENDAR_SYNC_JOB_TYPE } from "./handlers/crm-calendar-sync.js";
import { JOB_TYPE as MAILINGS_SEND_JOB_TYPE } from "./handlers/crm-mailings-send.js";
import { JOB_TYPE as BROADCASTS_SEND_JOB_TYPE } from "./handlers/crm-whatsapp-broadcasts-send.js";
import { JOB_TYPE as QUOTATION_EXPIRY_JOB_TYPE } from "./handlers/sales-quotation-expiry.js";
import { JOB_TYPE as FISCAL_YEAR_AHEAD_JOB_TYPE } from "./handlers/platform-fiscal-year-ahead.js";
import { JOB_TYPE as EXCHANGE_RATE_FEED_JOB_TYPE } from "./handlers/platform-exchange-rate-feed.js";
import { exchangeRateFeedConfigured, fiscalYearsRunningOut } from "@vercentlabs/api";
import { JOB_TYPE as WORKFLOW_TIME_TRIGGERS_JOB_TYPE } from "./handlers/platform-workflow-time-triggers.js";
import { JOB_TYPE as NOTIFICATION_DIGEST_JOB_TYPE } from "./handlers/platform-notification-digest.js";
import { JOB_TYPE as RECORD_ACTIVITY_REMINDER_JOB_TYPE } from "./handlers/platform-record-activity-reminders.js";
import { hasCalendarConnections, hasDueBroadcasts, hasDueMailings, listDueLeadConnectors } from "@vercentlabs/api/crm";

const logger = createLogger("worker-scheduler");

// Every scheduled job, with the app it belongs to: a company only gets the jobs of the apps it has switched on, so a POS-only company
// is never sent CRM, stock or projects work. `every: "tick"` jobs are keyed by `bucket` (one per tick); `every: "day"` jobs by the
// company's local calendar date, so "once a day" starts at the company's midnight, not UTC's. `when` (optional) skips a company with
// nothing to do (no campaign due, no calendar connected, no connector due).
export const SCHEDULED_JOBS = Object.freeze([
  // F016: reminders need per-tick checking; claimDueReminders() only claims rows whose fire_at has passed, so an idle tick is cheap.
  { name: "follow-up reminders", module: "crm", every: "tick", jobType: FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, key: "follow-up-reminder-dispatch-tick", maxAttempts: 3 },
  // Each overdue task's assignee is told once.
  { name: "overdue tasks", module: "crm", every: "tick", jobType: TASK_OVERDUE_JOB_TYPE, key: "task-overdue-tick", maxAttempts: 3 },
  // Response times, overdue escalation and the assignment re-run (each notice once, by its stamp).
  { name: "lead response watch", module: "crm", every: "tick", jobType: LEAD_RESPONSE_WATCH_JOB_TYPE, key: "crm-lead-response-watch", maxAttempts: 3 },
  { name: "campaign emails", module: "crm", every: "tick", jobType: MAILINGS_SEND_JOB_TYPE, key: "crm-mailings-send", maxAttempts: 2, when: hasDueMailings },
  { name: "WhatsApp broadcasts", module: "crm", every: "tick", jobType: BROADCASTS_SEND_JOB_TYPE, key: "crm-whatsapp-broadcasts-send", maxAttempts: 2, when: hasDueBroadcasts },
  { name: "calendar sync", module: "crm", every: "tick", jobType: CALENDAR_SYNC_JOB_TYPE, key: "crm-calendar-sync", maxAttempts: 2, when: hasCalendarConnections },
  { name: "lead connectors", module: "crm", every: "tick", jobType: LEAD_CONNECTORS_POLL_JOB_TYPE, key: "crm-lead-connectors-poll", maxAttempts: 2,
    when: async (client, organizationId) => (await listDueLeadConnectors(client, organizationId)).length > 0 },
  // Low-stock alerts (an idle tick finds nothing pending) and the daily reorder reconciliation.
  { name: "low-stock alerts", module: "stock", every: "tick", jobType: LOW_STOCK_DISPATCH_JOB_TYPE, key: "low-stock-dispatch-tick", maxAttempts: 3 },
  { name: "reorder reconciliation", module: "stock", every: "day", jobType: REORDER_RECONCILE_JOB_TYPE, key: "reorder-reconcile-tick", maxAttempts: 3 },
  // Production holds past the company's limit (each hold is told once).
  { name: "production hold overdue", module: "manufacturing", every: "tick", jobType: HOLD_OVERDUE_JOB_TYPE, key: "hold-overdue-tick", maxAttempts: 3 },
  // Project due-date and health alerts (each alert is sent once anyway).
  { name: "project alerts", module: "projects", every: "day", jobType: PROJECT_ALERTS_JOB_TYPE, key: "project-alerts", maxAttempts: 3 },
  // Automatic depreciation: the month is decided by the company's policy and Finance's calendar, claimed once per book and month.
  { name: "depreciation automation", module: "assets", every: "day", jobType: DEPRECIATION_AUTOMATION_JOB_TYPE, key: "depreciation-automation", maxAttempts: 3 },
  // Due preventive services become work orders once each, then overdue work is notified.
  { name: "asset maintenance", module: "assets", every: "day", jobType: MAINTENANCE_SCHEDULE_JOB_TYPE, key: "asset-maintenance", maxAttempts: 3 },
  // Activities on records (calls, meetings, to-dos) that fall due are reminded to their assignee. Every company (module null).
  { name: "record activity reminders", module: null, every: "day", jobType: RECORD_ACTIVITY_REMINDER_JOB_TYPE, key: "record-activity-reminders", maxAttempts: 3 },
  // Automations on a date ("3 days after an invoice is due"). Every company; the job does nothing without such an automation.
  { name: "automation time triggers", module: null, every: "day", jobType: WORKFLOW_TIME_TRIGGERS_JOB_TYPE, key: "workflow-time-triggers", maxAttempts: 3 },
  // Reference exchange rates, when the operator set a feed (EXCHANGE_RATE_FEED_URL). Every company with a foreign currency.
  { name: "exchange rate feed", module: null, every: "day", jobType: EXCHANGE_RATE_FEED_JOB_TYPE, key: "exchange-rate-feed", maxAttempts: 3,
    when: async (client, organizationId) => exchangeRateFeedConfigured()
      && Boolean((await client.query(`SELECT 1 FROM tenant.currencies currency JOIN public.organizations organization ON organization.id = currency.organization_id
        WHERE currency.organization_id = $1 AND currency.status = 'active' AND currency.code <> organization.base_currency LIMIT 1`, [organizationId])).rows[0]) },
  // The next financial year, opened 60 days before the current one ends. Every company — Sales and Stock post to the ledger without the
  // Accounting app, and nobody else would open it (Sales audit B3).
  { name: "next financial year", module: null, every: "day", jobType: FISCAL_YEAR_AHEAD_JOB_TYPE, key: "fiscal-year-ahead", maxAttempts: 3,
    when: (client, organizationId) => fiscalYearsRunningOut(client, organizationId) },
  // The daily digest email of unread notifications, for those who asked for it. Every company.
  { name: "notification digest", module: null, every: "day", jobType: NOTIFICATION_DIGEST_JOB_TYPE, key: "notification-digest", maxAttempts: 3 },
  // Quotations past their Valid Until date become Expired.
  { name: "expired quotations", module: "sales", every: "day", jobType: QUOTATION_EXPIRY_JOB_TYPE, key: "sales-quotation-expiry", maxAttempts: 3 },
]);

// What the company has: its switched-on apps and its time zone (organization_modules is tenant-scoped, so this runs in the company's
// own transaction).
async function companyProfile(client, organizationId) {
  const modules = await client.query(`SELECT module_key FROM public.organization_modules WHERE organization_id = $1 AND status = 'enabled'`, [organizationId]);
  const organization = await client.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS timezone FROM public.organizations WHERE id = $1`, [organizationId]);
  return { modules: new Set(modules.rows.map((row) => row.module_key)), timeZone: organization.rows[0]?.timezone ?? "Asia/Kolkata" };
}

// The company's calendar date ("YYYY-MM-DD") at `now`; an unknown zone falls back to India.
export function companyDay(timeZone, now = new Date()) {
  const day = (zone) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try { return day(timeZone); } catch { return day("Asia/Kolkata"); }
}

// Duplicate-occurrence prevention across several scheduler instances reuses ordinary job idempotency: `bucket` and the local day are
// deterministic, so two schedulers enqueueing for the same company and period collide on tenant.background_jobs's
// UNIQUE(organization_id, idempotency_key) and the loser resolves to the winner's row (queue.js's enqueueJob).
//
// One transaction per company per tick (it used to be one per job); each job sits in its own savepoint, so one failing job never
// stops the others.
export async function runSchedulerTick(pool, config, { now = new Date() } = {}) {
  const bucket = Math.floor(now.getTime() / config.worker.schedulerTickMilliseconds);
  const organizationIds = await listActiveOrganizationIds(pool);
  let enqueued = 0;
  let deduped = 0;
  let skipped = 0;
  for (const organizationId of organizationIds) {
    try {
      const result = await withTenantClient(pool, organizationId, (client) => scheduleCompany(client, organizationId, { bucket, now }));
      enqueued += result.enqueued;
      deduped += result.deduped;
      skipped += result.skipped;
    } catch (error) {
      logger.error("scheduler tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, skipped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped, skipped };
}

export async function scheduleCompany(client, organizationId, { bucket, now = new Date() }) {
  const profile = await companyProfile(client, organizationId);
  const day = companyDay(profile.timeZone, now);
  const counts = { enqueued: 0, deduped: 0, skipped: 0 };
  for (const job of SCHEDULED_JOBS) {
    if (job.module && !profile.modules.has(job.module)) { counts.skipped += 1; continue; }
    await client.query("SAVEPOINT scheduled_job");
    try {
      if (job.when && !(await job.when(client, organizationId))) {
        await client.query("RELEASE SAVEPOINT scheduled_job");
        continue;
      }
      const daily = job.every === "day";
      const { deduped: wasDeduped } = await enqueueJob(client, organizationId, {
        jobType: job.jobType,
        idempotencyKey: `${job.key}:${daily ? day : bucket}`,
        ...(daily ? { payload: { date: day } } : {}),
        maxAttempts: job.maxAttempts,
      });
      await client.query("RELEASE SAVEPOINT scheduled_job");
      if (wasDeduped) counts.deduped += 1;
      else counts.enqueued += 1;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT scheduled_job");
      logger.error(`${job.name} tick failed for organization`, { organizationId, error: String(error?.message || error) });
    }
  }
  return counts;
}
