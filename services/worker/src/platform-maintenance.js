// Shared Platform maintenance on its own timer (like billing): platform-wide
// housekeeping that is not tenant job processing.
//   files  removes the bytes of expired artifacts (exports, report outputs);
//          the metadata row stays as evidence and downloads answer 410.
import { purgeExpiredFileContent } from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

import { listActiveOrganizationIds, withTenantClient } from "./db.js";

const logger = createLogger("worker-platform");

// Per organisation, each in its own organisation-context transaction.
export async function runPlatformMaintenanceTick(pool, { limit = 100 } = {}) {
  let removed = 0;
  for (const organizationId of await listActiveOrganizationIds(pool)) {
    try {
      const files = await withTenantClient(pool, organizationId, (client) => purgeExpiredFileContent(client, { organizationId, limit }));
      removed += files.removed;
    } catch (error) {
      logger.error("expired artifact purge failed", { organizationId, error: redact(String(error?.message || error)) });
    }
  }
  if (removed) logger.info("expired artifacts purged", { removed });
  return { files: { removed } };
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
