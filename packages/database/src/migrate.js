// The migration runner: applies the expected migrations (migration-manifest.js) that a database does not have yet, in order, each in
// its own transaction, and records it in public.schema_migrations (most files record themselves; the runner records any that do not).
// One run at a time: a session advisory lock makes a second Job wait, then find nothing to do. A failed file rolls back alone and stops
// the run, so the database is left at the last good migration and the readiness check (runtime-checks.js) keeps the new release out.
//
// Used by the migration Job (services/worker/bin/migrate.mjs); never by the web or the worker at run time.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { EXPECTED_MIGRATIONS } from "./migration-manifest.js";

const LOCK_KEY = "vercentlabs.schema-migrations";

export class MigrationRunError extends Error {
  constructor(message, filename = null, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = "MigrationRunError";
    this.filename = filename;
  }
}

// A migration is plain SQL. pg_dump's \restrict / \unrestrict lines (psql-only guards in the baseline) are dropped; any other psql
// meta-command is refused, since only psql could run it.
export function migrationSql(filename, text) {
  const kept = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\\(un)?restrict\b/.test(line)) continue;
    if (line.startsWith("\\")) throw new MigrationRunError(`${filename} line ${index + 1} is a psql command (${line.slice(0, 20)}); migrations must be plain SQL.`, filename);
    kept.push(line);
  }
  return kept.join("\n");
}

async function appliedMigrations(client) {
  const exists = (await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`)).rows[0].present;
  if (!exists) return new Set();
  return new Set((await client.query(`SELECT filename FROM public.schema_migrations`)).rows.map((row) => row.filename));
}

/**
 * Applies what is missing. `client` is a single pg client connected as the migration (owner) role.
 * Returns { applied: [filenames], skipped: n }. `dryRun` lists what would run without running it.
 */
export async function applyPendingMigrations(client, { directory, expected = EXPECTED_MIGRATIONS, dryRun = false, log = () => {} } = {}) {
  if (!directory) throw new MigrationRunError("The migrations directory is required.");
  await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [LOCK_KEY]);
  try {
    const done = await appliedMigrations(client);
    const pending = expected.filter((filename) => !done.has(filename));
    if (!done.size && pending[0] !== expected[0]) throw new MigrationRunError("An empty database must start from the baseline.", pending[0] ?? null);
    if (dryRun) return { applied: [], pending, skipped: expected.length - pending.length };
    const applied = [];
    for (const filename of pending) {
      const sql = migrationSql(filename, await readFile(path.join(directory, filename), "utf8"));
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 32);
      const started = Date.now();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO public.schema_migrations (filename, checksum)
           SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE filename = $1)`, [filename, checksum]);
        await client.query("COMMIT");
        // A file may change session settings (the baseline empties search_path); the next one starts clean.
        await client.query("RESET ALL");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new MigrationRunError(`${filename} failed: ${error?.message ?? error}`, filename, error);
      }
      applied.push(filename);
      log({ filename, milliseconds: Date.now() - started });
    }
    return { applied, pending: [], skipped: expected.length - pending.length };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [LOCK_KEY]).catch(() => {});
  }
}
