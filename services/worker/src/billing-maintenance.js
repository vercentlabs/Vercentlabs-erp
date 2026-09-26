// Platform billing maintenance: the runtime owner of billing webhook
// processing, retries, dead letters, checkout/seat/cancellation recovery and
// scheduled provider reconciliation (replacing the old cron-secret HTTP
// endpoint). Billing tables are platform data, so this uses a plain pooled
// client: no tenant RLS context and no tenant.background_jobs rows. It runs on
// its own timer, separate from tenant job processing and its transactions.
import { createRazorpayProvider, runBillingMaintenance } from "@vercentlabs/api";
import { createLogger, redact } from "@vercentlabs/observability";

const logger = createLogger("worker-billing");

export async function runBillingMaintenanceTick(pool, config, { workerId, provider = createRazorpayProvider(process.env), steps = null } = {}) {
  return runBillingMaintenance({
    connect: () => pool.connect(),
    provider,
    workerId,
    batchSize: config.worker.billingBatchSize,
    leaseSeconds: Math.max(30, Math.round(config.worker.leaseMilliseconds / 1000)),
    steps,
  });
}

export function createBillingMaintenanceLoop(getPool, config, { workerId, provider } = {}) {
  let timer;
  let stopped = false;
  let active = Promise.resolve();
  const tick = async () => {
    if (stopped) return;
    active = (async () => {
      try {
        const pool = await getPool();
        await runBillingMaintenanceTick(pool, config, { workerId, provider });
      } catch (error) {
        logger.error("billing maintenance tick crashed", { error: redact(String(error?.message || error)) });
      }
    })();
    await active;
    if (!stopped) timer = setTimeout(tick, config.worker.billingMaintenanceIntervalMilliseconds);
  };
  return {
    start() {
      if (!config.worker.billingMaintenanceEnabled) {
        logger.info("billing maintenance disabled (BILLING_MAINTENANCE_ENABLED=false)");
        return;
      }
      timer = setTimeout(tick, 0);
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active.catch(() => undefined);
    },
  };
}
