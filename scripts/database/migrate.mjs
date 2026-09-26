#!/usr/bin/env node
// Two deployment phases, one checksummed history (public.schema_migrations):
//
//   expand    database/<scope>/migrations/*.sql — backward compatible; safe
//             while the previous application version is still running.
//             `pnpm db:migrate` (the migration Job on every release).
//   contract  database/<scope>/contracts/*.sql — destructive cleanup (drops).
//             NEVER run by db:migrate/db:setup. Only after the new code is
//             everywhere and backfills/reconciliation passed:
//               pnpm db:migrate:contract:plan   (dry run: preconditions only)
//               pnpm db:migrate:contract        (applies, needs --confirm)
//             Every contract file carries its own preconditions (DO blocks that
//             RAISE EXCEPTION when the data is not ready), so a contract can
//             never succeed merely because its file exists. Recorded as
//             "contracts/<file>".
//
// Shipped files are immutable: a changed checksum aborts. Two concurrent
// runners serialize on a per-scope advisory lock.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config as loadDotEnv } from "dotenv";

import { loadSecretFiles } from "../../packages/config/src/production.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
// Deployed (the migration Job): connection strings are mounted as files
// (Secret Manager) and passed as NAME_FILE.
loadSecretFiles(process.env);

const scope = process.argv[2];
const args = new Set(process.argv.slice(3));
const baselineExisting = args.has("--baseline-existing");
const contract = args.has("--contract");
const plan = args.has("--plan");
const confirm = args.has("--confirm");
if (!new Set(["platform", "tenant"]).has(scope)) {
  throw new Error("Usage: migrate.mjs <platform|tenant> [--baseline-existing] | [--contract (--plan | --confirm)]");
}
if (contract && !plan && !confirm) throw new Error("Contract migrations are destructive: run with --plan to check preconditions, or --confirm to apply.");

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");

const sqlFiles = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort() : []);
const expandDirectory = path.join(root, "database", scope, "migrations");
const contractDirectory = path.join(root, "database", scope, "contracts");
const expandFiles = sqlFiles(expandDirectory);
const contractFiles = sqlFiles(contractDirectory);
const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");

function migrationBody(sql, filename) {
  const trimmed = sql.trim();
  if (!/^BEGIN;\s*/i.test(trimmed) || !/\s*COMMIT;\s*$/i.test(trimmed)) {
    throw new Error(`${scope}/${filename} must be wrapped by BEGIN; ... COMMIT;`);
  }
  return trimmed.replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "").trim();
}

const client = new Client({ connectionString, application_name: `vercentlabs-migrate-${scope}${contract ? "-contract" : ""}` });

async function hasExistingSchema() {
  if (scope === "platform") {
    const { rows } = await client.query("SELECT to_regclass('public.organizations') IS NOT NULL AS present");
    return Boolean(rows[0]?.present);
  }
  const { rows } = await client.query("SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='tenant') AS present");
  return Boolean(rows[0]?.present);
}

async function applyOne(recordedName, sql, { dryRun = false } = {}) {
  const body = migrationBody(sql, recordedName);
  await client.query("BEGIN");
  try {
    if (body) await client.query(body);
    if (dryRun) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query("INSERT INTO public.schema_migrations(scope,filename,checksum) VALUES($1,$2,$3)", [scope, recordedName, checksum(sql)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`${scope}/${recordedName} failed: ${error?.message || error}`, { cause: error });
  }
}

function verifyChecksums(applied, names, readSql) {
  for (const name of names) {
    const previous = applied.get(name);
    if (previous && previous !== checksum(readSql(name))) throw new Error(`Applied migration changed on disk: ${scope}/${name}`);
  }
}

async function runExpand(applied) {
  if (applied.size === 0 && expandFiles.length && (await hasExistingSchema())) {
    if (!baselineExisting) {
      throw new Error(
        `${scope} already contains application objects but has no migration history.\n` +
          `If and only if this development database already has every current migration applied, run:\n` +
          `  pnpm db:baseline:${scope}`,
      );
    }
    await client.query("BEGIN");
    try {
      for (const filename of expandFiles) {
        const sql = fs.readFileSync(path.join(expandDirectory, filename), "utf8");
        migrationBody(sql, filename);
        await client.query(`INSERT INTO public.schema_migrations(scope,filename,checksum) VALUES($1,$2,$3) ON CONFLICT (scope,filename) DO NOTHING`, [scope, filename, checksum(sql)]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    console.log(`BASELINED ${scope}: ${expandFiles.length} migration(s)`);
    return;
  }
  for (const filename of expandFiles) {
    const sql = fs.readFileSync(path.join(expandDirectory, filename), "utf8");
    const previous = applied.get(filename);
    if (previous !== undefined) {
      if (previous && previous !== checksum(sql)) throw new Error(`Applied migration changed on disk: ${scope}/${filename}`);
      if (!previous) await client.query("UPDATE public.schema_migrations SET checksum=$3 WHERE scope=$1 AND filename=$2 AND checksum IS NULL", [scope, filename, checksum(sql)]);
      console.log(`SKIP  ${scope}/${filename}`);
      continue;
    }
    console.log(`APPLY ${scope}/${filename}`);
    await applyOne(filename, sql);
  }
  console.log(`CURRENT ${scope}: ${expandFiles.length} expand migration(s)`);
}

async function runContract(applied) {
  const missingExpand = expandFiles.filter((filename) => !applied.has(filename));
  if (missingExpand.length) throw new Error(`Apply every expand migration first (pnpm db:migrate); ${scope} is missing ${missingExpand.join(", ")}.`);
  verifyChecksums(applied, contractFiles.map((file) => `contracts/${file}`), (name) => fs.readFileSync(path.join(contractDirectory, name.slice("contracts/".length)), "utf8"));
  const pending = contractFiles.filter((file) => !applied.has(`contracts/${file}`));
  if (!pending.length) {
    console.log(`CURRENT ${scope}: no pending contract migrations`);
    return;
  }
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(contractDirectory, file), "utf8");
    if (!/RAISE EXCEPTION/i.test(sql)) throw new Error(`${scope}/contracts/${file} has no precondition (a DO block that RAISE EXCEPTIONs when the data is not ready).`);
    if (plan) {
      await applyOne(`contracts/${file}`, sql, { dryRun: true });
      console.log(`READY ${scope}/contracts/${file} (preconditions pass; rolled back)`);
    } else {
      console.log(`APPLY ${scope}/contracts/${file}`);
      await applyOne(`contracts/${file}`, sql);
    }
  }
}

async function main() {
  await client.connect();
  const lock = `vercentlabs:migrate:${scope}`;
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lock]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        scope text NOT NULL CHECK (scope IN ('platform','tenant')),
        filename text NOT NULL,
        checksum text,
        applied_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope, filename)
      )
    `);
    await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum text");
    const { rows } = await client.query("SELECT filename, checksum FROM public.schema_migrations WHERE scope=$1 ORDER BY filename", [scope]);
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));
    if (contract) await runContract(applied);
    else await runExpand(applied);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]).catch(() => undefined);
  }
}

main()
  .finally(() => client.end().catch(() => undefined))
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
