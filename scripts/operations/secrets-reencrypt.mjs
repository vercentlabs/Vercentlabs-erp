#!/usr/bin/env node
// pnpm secrets:reencrypt [--dry-run] [--batch-size=100] [--max-batches=50]
//   Rewrites every stored secret that is not on the CURRENT key version
//   (after a Cloud KMS primary-version rotation) into a fresh envelope.
// pnpm secrets:migrate-legacy [--dry-run] ...
//   Rewrites only rows still encrypted with the legacy
//   INTEGRATION_TOKEN_ENCRYPTION_KEY (needs that key configured, decrypt-only).
// Resumable and idempotent: re-run until the inventory shows nothing left.
// Never disable an old KMS key version until the inventory shows zero rows on it.
import { flags, loadEnvironment, report, withOperationsClient } from "./lib.mjs";

loadEnvironment();
const options = flags();
const mode = options.legacy ? "legacy" : "rotate";
const { reencryptSecrets, secretInventory } = await import("../../services/api/src/core/platform/secrets/index.js");
await withOperationsClient(async ({ client, withTransaction }) => {
  const summary = await reencryptSecrets(withTransaction, { mode, dryRun: Boolean(options.dryRun), batchSize: Number(options.batchSize ?? 100), maxBatches: Number(options.maxBatches ?? 50) });
  const inventory = await secretInventory(client);
  const failed = summary.columns.some((column) => column.failed > 0);
  report(mode === "legacy" ? "secrets:migrate-legacy" : "secrets:reencrypt", { ...summary, inventory }, { failed });
});
