#!/usr/bin/env node
// The migration Job's entrypoint (infrastructure/kubernetes/jobs/migration.yaml): applies the database migrations this release expects,
// then exits 0, or 1 on the first failure (that file rolled back; the release's readiness check then keeps it out of service).
// Configuration: MIGRATION_DATABASE_URL (the owner role; only this Job receives it), optionally via MIGRATION_DATABASE_URL_FILE.
// MIGRATIONS_DIR overrides the directory (default: the image's /app/database/migrations, or the repo's database/migrations).
// `--dry-run` lists what would run.
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { loadSecretFiles, validateRuntimeEnvironment } from "@vercentlabs/config/production";
import { applyPendingMigrations, resolveDbSsl } from "@vercentlabs/database";
import { createLogger } from "@vercentlabs/observability";

const logger = createLogger("migration-job");
const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  loadSecretFiles(process.env);
  const config = validateRuntimeEnvironment("migration", process.env);
  const directory = process.env.MIGRATIONS_DIR || path.resolve(here, "../../../database/migrations");
  const dryRun = process.argv.includes("--dry-run");
  const client = new pg.Client({ connectionString: config.database.connectionString, ssl: resolveDbSsl(process.env), statement_timeout: 0 });
  await client.connect();
  try {
    const result = await applyPendingMigrations(client, {
      directory, dryRun,
      log: ({ filename, milliseconds }) => logger.info("migration applied", { filename, milliseconds }),
    });
    if (dryRun) logger.info("dry run", { pending: result.pending, alreadyApplied: result.skipped });
    else logger.info("migrations complete", { applied: result.applied.length, alreadyApplied: result.skipped });
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  logger.error("migration job failed", { filename: error?.filename ?? null, error: String(error?.message || error) });
  process.exit(1);
});
