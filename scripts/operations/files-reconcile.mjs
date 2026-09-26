#!/usr/bin/env node
// pnpm files:reconcile [--batch-size=200] [--max-rows=10000] [--after=<uuid>]
// Proves every object-backed file still exists in object storage with the
// recorded size/checksum. Exits non-zero on any missing or drifted object.
import { flags, loadEnvironment, report, withOperationsClient } from "./lib.mjs";

loadEnvironment();
const options = flags();
const { reconcileObjectStorage } = await import("../../services/api/src/core/platform/files/index.js");
await withOperationsClient(async ({ client }) => {
  const summary = await reconcileObjectStorage(client, { batchSize: options.batchSize, maxRows: Number(options.maxRows ?? 10_000), after: options.after || null });
  report("files:reconcile", summary, { failed: !summary.healthy });
});
