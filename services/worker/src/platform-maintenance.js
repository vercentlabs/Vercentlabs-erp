// Shared Platform maintenance on its own timer (like billing): platform-wide
// housekeeping that is not tenant job processing.
//   files  removes the bytes of expired artifacts (exports, report outputs);
//          the metadata row stays as evidence and downloads answer 410.
//   report schedules  queues one run per recipient for every due scheduled
//          report (each executed later with that recipient's own authority).
import { enqueueDueReportSchedules, purgeExpiredFileContent } from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

import { listActiveOrganizationIds, withTenantClient } from "./db.js";

const logger = createLogger("worker-platform");

// Per organisation, each in its own organisation-context transaction.
export async function runPlatformMaintenanceTick(pool, { limit = 100 } = {}) {
  let removed = 0;
  const reports = { schedules: 0, queued: 0, skipped: 0 };
  for (const organizationId of await listActiveOrganizationIds(pool)) {
    try {
      const due = await withTenantClient(pool, organizationId, (client) => enqueueDueReportSchedules(client, organizationId));
      reports.schedules += due.schedules;
      reports.queued += due.queued;
      reports.skipped += due.skipped;
      if (due.schedules) logger.event("report.scheduled_runs_queued", { organizationId, ...due });
    } catch (error) {
      logger.error("scheduled report dispatch failed", { organizationId, error: redact(String(error?.message || error)) });
    }
    try {
      const files = await withTenantClient(pool, organizationId, (client) => purgeExpiredFileContent(client, { organizationId, limit }));
      removed += files.removed;
    } catch (error) {
      logger.error("expired artifact purge failed", { organizationId, error: redact(String(error?.message || error)) });
    }
  }
  if (removed) logger.info("expired artifacts purged", { removed });
  return { files: { removed }, reports };
}

export function createPlatformMaintenanceLoop(getPool, config) {
  let timer;
  let stopped = false;
  let active = Promise.resolve();
  const tick = async () => {
    if (stopped) return;
    active = (async () => {
      try {
        await runPlatformMaintenanceTick(await getPool());
      } catch (error) {
        logger.error("platform maintenance tick crashed", { error: redact(String(error?.message || error)) });
      }
    })();
    await active;
    if (!stopped) timer = setTimeout(tick, config.worker.schedulerTickMilliseconds);
  };
  return {
    start() {
      timer = setTimeout(tick, 0);
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active.catch(() => undefined);
    },
  };
}
