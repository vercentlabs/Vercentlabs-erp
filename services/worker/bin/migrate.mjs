#!/usr/bin/env node
// The migration Job's entrypoint (infrastructure/kubernetes/jobs/migration.yaml): applies the database migrations this release expects,
// then exits 0, or 1 on the first failure (that file rolled back; the release's readiness check then keeps it out of service).
// Configuration: MIGRATION_DATABASE_URL (the owner role; only this Job receives it), optionally via MIGRATION_DATABASE_URL_FILE.
// MIGRATIONS_DIR overrides the directory (default: the image's /app/database/migrations, or the repo's database/migrations).
// `--dry-run` lists what would run.
// Runtime logins: with APP_DB_PASSWORD and WORKER_DB_PASSWORD set (Cloud Run deploy), the restricted runtime roles vercent_app (web) and
// vercent_worker (worker) are then made LOGIN NOINHERIT with those passwords, so the web and worker pass their restricted-role check.
// Run every time; it only (re)sets the two roles' login and password.
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
    else {
      logger.info("migrations complete", { applied: result.applied.length, alreadyApplied: result.skipped });
      await provisionRuntimeLogins(client);
    }
  } finally {
    await client.end();
  }
}

// ALTER ROLE takes no bind parameters: the password is quoted as a literal by the driver.
async function provisionRuntimeLogins(client) {
  const logins = [["vercent_app", process.env.APP_DB_PASSWORD], ["vercent_worker", process.env.WORKER_DB_PASSWORD]].filter(([, password]) => password);
  for (const [role, password] of logins) {
    if (String(password).length < 24) throw new Error(`The password for ${role} must be at least 24 characters.`);
    // Only what the migration owner may change on Cloud SQL (no superuser there): the roles were created NOSUPERUSER NOBYPASSRLS
    // NOCREATEDB NOCREATEROLE by the baseline, and the web and worker check those again at start.
    await client.query(`ALTER ROLE ${role} LOGIN NOINHERIT PASSWORD ${client.escapeLiteral(String(password))}`);
    logger.info("runtime login ready", { role });
  }
}

main().catch((error) => {
  logger.error("migration job failed", { filename: error?.filename ?? null, error: String(error?.message || error) });
  process.exit(1);
});
