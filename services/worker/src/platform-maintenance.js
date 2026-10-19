// Shared Platform maintenance on its own timer (like billing): platform-wide
// housekeeping that is not tenant job processing.
//   files  removes the bytes of expired artifacts (exports, report outputs);
//          the metadata row stays as evidence and downloads answer 410.
//   report schedules  queues one run per recipient for every due scheduled
//          report (each executed later with that recipient's own authority).
//   POS checkout holds  releases stock reserved by POS checkouts whose lease has passed (never one with a payment under way, within the
//          outlet's maximum hold), so expired reservations never keep stock from other bills.
//   live stock events  removes availability-changed events older than two days (they only drive live delivery).
import { closeDueWorkspaces, enqueueDueReportSchedules, prunePosInventoryEvents, purgeExpiredFileContent, sweepExpiredPosCheckoutReservations } from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

import { listActiveOrganizationIds, prunePlatformHistory, withTenantClient } from "./db.js";
import { buildSystemContext } from "./system-context.js";

const logger = createLogger("worker-platform");
let lastPruneDay = null;

// Per organisation, each in its own organisation-context transaction.
export async function runPlatformMaintenanceTick(pool, { limit = 100 } = {}) {
  let removed = 0;
  let holdsReleased = 0;
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
    try {
      const holds = await withTenantClient(pool, organizationId, (client) => sweepExpiredPosCheckoutReservations(client, buildSystemContext(organizationId)));
      holdsReleased += holds.released;
    } catch (error) {
      logger.error("POS checkout reservation sweep failed", { organizationId, error: redact(String(error?.message || error)) });
    }
    try {
      await withTenantClient(pool, organizationId, (client) => prunePosInventoryEvents(client, organizationId));
    } catch (error) {
      logger.error("inventory change event prune failed", { organizationId, error: redact(String(error?.message || error)) });
    }
  }
  // Workspaces whose closure waiting period ended are closed (organisation directory and sessions: no tenant context).
  let closed = 0;
  try {
    closed = await closeDueWorkspaces(pool);
    if (closed) logger.event("organization.workspaces_closed", { closed });
  } catch (error) {
    logger.error("workspace closure failed", { error: redact(String(error?.message || error)) });
  }
  // Finished jobs, events, automation runs, old notifications and mail log entries, once a day (Shared Platform plan 8).
  let pruned = null;
  const today = new Date().toISOString().slice(0, 10);
  if (lastPruneDay !== today) {
    try {
      pruned = await prunePlatformHistory(pool);
      lastPruneDay = today;
      if (Object.values(pruned).some((count) => count > 0)) logger.event("platform.history_pruned", pruned);
    } catch (error) {
      logger.error("history prune failed", { error: redact(String(error?.message || error)) });
    }
  }
  if (removed) logger.info("expired artifacts purged", { removed });
  if (holdsReleased) logger.info("expired POS checkout reservations released", { released: holdsReleased });
  return { files: { removed }, reports, posCheckoutHolds: { released: holdsReleased }, workspacesClosed: closed, pruned };
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
