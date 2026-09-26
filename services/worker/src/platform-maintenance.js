// Shared Platform maintenance on its own timer (like billing): platform-wide
// housekeeping that is not tenant job processing.
//   files  removes the bytes of expired artifacts (exports, report outputs);
//          the metadata row stays as evidence and downloads answer 410.
import { purgeExpiredFileContent } from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

const logger = createLogger("worker-platform");

export async function runPlatformMaintenanceTick(pool, { limit = 100 } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const files = await purgeExpiredFileContent(client, { limit });
    await client.query("COMMIT");
    if (files.removed) logger.info("expired artifacts purged", { removed: files.removed });
    return { files };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
