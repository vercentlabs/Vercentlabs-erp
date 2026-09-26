#!/usr/bin/env node
// pnpm ops:status — production readiness facts that are not visible to the
// Kubernetes readiness probe: migrations (expand and pending contracts),
// legacy file bytes still in PostgreSQL, legacy-encrypted secrets, and the
// secret key inventory. Read-only. Exit code 0 always; "blockers" lists what
// must reach zero before the matching contract migration may run.
import { loadEnvironment, report, withOperationsClient } from "./lib.mjs";

loadEnvironment();
const { EXPECTED_MIGRATIONS, readMigrationStatus } = await import("../../packages/database/src/index.js");
const { countLegacyFileRows } = await import("../../services/api/src/core/platform/files/index.js");
const { secretInventory } = await import("../../services/api/src/core/platform/secrets/index.js");
await withOperationsClient(async ({ client }) => {
  const migrations = await readMigrationStatus(client);
  const { rows } = await client.query(`SELECT scope, filename FROM public.schema_migrations WHERE filename LIKE 'contracts/%'`);
  const appliedContracts = new Set(rows.map((row) => `${row.scope}/${row.filename}`));
  const pendingContracts = ["platform", "tenant"].flatMap((scope) => EXPECTED_MIGRATIONS.contracts[scope].map((file) => `${scope}/contracts/${file}`)).filter((name) => !appliedContracts.has(name));
  const legacyFiles = await countLegacyFileRows(client);
  const inventory = await secretInventory(client);
  const legacySecrets = inventory.filter((entry) => entry.keyReference === "legacy").reduce((sum, entry) => sum + entry.count, 0);
  const blockers = [];
  if (!migrations.ready) blockers.push(`expand migrations missing: ${migrations.missing.join(", ")}`);
  if (legacyFiles.rows) blockers.push(`${legacyFiles.rows} attachment(s) still hold bytes in PostgreSQL (pnpm files:migrate-legacy)`);
  if (legacySecrets) blockers.push(`${legacySecrets} secret(s) still use the legacy key (pnpm secrets:migrate-legacy)`);
  report("ops:status", { migrations, pendingContracts, legacyFiles, legacySecrets, inventory, blockers });
});
