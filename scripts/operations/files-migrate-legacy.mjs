#!/usr/bin/env node
// pnpm files:migrate-legacy [--dry-run] [--batch-size=50] [--max-batches=20]
// Moves attachments.content (storage_mode='database_legacy') into object
// storage. Idempotent and resumable: re-run until "remaining" is 0, then run
// pnpm files:reconcile before the contract migration that drops the column.
import { flags, loadEnvironment, report, withOperationsClient } from "./lib.mjs";

loadEnvironment();
const options = flags();
const { countLegacyFileRows, migrateLegacyFiles } = await import("../../services/api/src/core/platform/files/index.js");
await withOperationsClient(async ({ client, withTransaction }) => {
  const before = await countLegacyFileRows(client);
  const summary = await migrateLegacyFiles(withTransaction, { batchSize: options.batchSize, maxBatches: Number(options.maxBatches ?? 20), dryRun: Boolean(options.dryRun) });
  const after = await countLegacyFileRows(client);
  const failed = summary.hashMismatch.length > 0 || summary.verifyFailed.length > 0;
  report("files:migrate-legacy", { dryRun: Boolean(options.dryRun), before, ...summary, remaining: after }, { failed });
});
