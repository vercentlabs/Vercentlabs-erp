#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { Client } = require("pg");
const { config: loadDotEnv } = require("dotenv");

for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const scope = process.argv[2];
const baselineExisting = process.argv.includes("--baseline-existing");
if (!new Set(["platform", "tenant"]).has(scope)) {
  throw new Error("Usage: migrate.mjs <platform|tenant> [--baseline-existing]");
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");

const directory = path.join(root, "database", scope, "migrations");
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");

function migrationBody(sql, filename) {
  const trimmed = sql.trim();
  if (!/^BEGIN;\s*/i.test(trimmed) || !/\s*COMMIT;\s*$/i.test(trimmed)) {
    throw new Error(`${scope}/${filename} must be wrapped by BEGIN; ... COMMIT;`);
  }
  return trimmed.replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "").trim();
}

const client = new Client({ connectionString, application_name: `vercentlabs-migrate-${scope}` });

async function hasExistingSchema() {
  if (scope === "platform") {
    const { rows } = await client.query("SELECT to_regclass('public.organizations') IS NOT NULL AS present");
    return Boolean(rows[0]?.present);
  }
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='tenant') AS present",
  );
  return Boolean(rows[0]?.present);
}

async function main() {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [`vercentlabs:migrate:${scope}`]);
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

    const { rows: appliedRows } = await client.query(
      "SELECT filename, checksum FROM public.schema_migrations WHERE scope=$1 ORDER BY filename",
      [scope],
    );
    const applied = new Map(appliedRows.map((row) => [row.filename, row.checksum]));

    if (applied.size === 0 && files.length && (await hasExistingSchema())) {
      if (!baselineExisting) {
        throw new Error(
          `${scope} already contains application objects but has no migration history.\n` +
          `If and only if this development database already has every current migration applied, run:\n` +
          `  pnpm db:baseline:${scope}`,
        );
      }
      await client.query("BEGIN");
      try {
        for (const filename of files) {
          const sql = fs.readFileSync(path.join(directory, filename), "utf8");
          migrationBody(sql, filename); // validate structure before recording it
          await client.query(
            `INSERT INTO public.schema_migrations(scope,filename,checksum)
             VALUES($1,$2,$3) ON CONFLICT (scope,filename) DO NOTHING`,
            [scope, filename, checksum(sql)],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      console.log(`BASELINED ${scope}: ${files.length} migration(s)`);
      return;
    }

    for (const filename of files) {
      const sql = fs.readFileSync(path.join(directory, filename), "utf8");
      const digest = checksum(sql);
      const previous = applied.get(filename);
      if (previous !== undefined) {
        if (previous && previous !== digest) {
          throw new Error(`Applied migration changed on disk: ${scope}/${filename}`);
        }
        if (!previous) {
          await client.query(
            "UPDATE public.schema_migrations SET checksum=$3 WHERE scope=$1 AND filename=$2 AND checksum IS NULL",
            [scope, filename, digest],
          );
        }
        console.log(`SKIP  ${scope}/${filename}`);
        continue;
      }

      const body = migrationBody(sql, filename);
      console.log(`APPLY ${scope}/${filename}`);
      await client.query("BEGIN");
      try {
        if (body) await client.query(body);
        await client.query(
          "INSERT INTO public.schema_migrations(scope,filename,checksum) VALUES($1,$2,$3)",
          [scope, filename, digest],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`${scope}/${filename} failed: ${error?.message || error}`, { cause: error });
      }
    }
    console.log(`CURRENT ${scope}: ${files.length} migration(s)`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`vercentlabs:migrate:${scope}`]).catch(() => undefined);
  }
}

main()
  .finally(() => client.end().catch(() => undefined))
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
