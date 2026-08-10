#!/usr/bin/env node
// Production and development entrypoint (pnpm start:worker / pnpm
// dev:worker). Deliberately a standalone process, never started via a
// Next.js route/layout/module import (Part 86) — this file is the only
// thing that ever calls createWorker().start().
import { createLogger } from "@vercentlabs/observability";

import { getWorkerConfig } from "../src/db.js";
import { createWorker } from "../src/worker.js";
import { registerBuiltinHandlers } from "../src/handlers/index.js";

const logger = createLogger("worker-bootstrap");

async function main() {
  const config = getWorkerConfig();
  if (!config.worker.enabled) {
    logger.info("WORKER_ENABLED is false — exiting without starting.");
    return;
  }
  registerBuiltinHandlers();
  const worker = createWorker(config);
  await worker.start();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("received shutdown signal", { signal });
    worker
      .stop()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error("error during shutdown", { error: String(error?.message || error) });
        process.exit(1);
      });
    // Do not hang forever if a claimed job never resolves.
    setTimeout(() => {
      logger.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 30_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error("worker failed to start", { error: String(error?.message || error) });
  process.exitCode = 1;
});
