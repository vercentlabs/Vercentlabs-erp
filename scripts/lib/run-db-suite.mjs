// Shared runner for the real-PostgreSQL suites (access, billing, shared
// runtime, platform services, production). Unlike the general integration
// run, a suite FAILS when a required database is unreachable and FAILS if any
// test is skipped, so a green result always means the invariants ran against
// PostgreSQL. Mail is forced offline (tests/support/offline-mail.mjs).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import { applyOfflineMail } from "../../tests/support/offline-mail.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadSuiteEnvironment() {
  for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
    if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
  }
  applyOfflineMail(process.env);
}

async function assertReachable(name) {
  const connectionString = String(process.env[name] || "").trim();
  if (!connectionString) throw new Error(`${name} is not set. Run \`pnpm infra:up && pnpm db:setup\` (or configure CI) first.`);
  const client = new pg.Client({ connectionString, application_name: `vercentlabs-${name.toLowerCase()}-preflight` });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    throw new Error(`${name} is unreachable: ${error.message || error.code || error}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runDbSuite({ name, files, requiredUrls = ["MIGRATION_DATABASE_URL", "DATABASE_URL"], env = {} }) {
  loadSuiteEnvironment();
  try {
    for (const url of requiredUrls) await assertReachable(url);
    for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`missing ${name} DB test file: ${file}`);
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...files], {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    const count = (label) => Number((result.stdout || "").match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? NaN);
    const skipped = count("skipped");
    const todo = count("todo");
    const passed = count("pass");
    if (result.status !== 0) throw new Error(`${name} DB suite failed (exit ${result.status}).`);
    if (!Number.isFinite(passed) || passed === 0) throw new Error(`${name} DB suite reported no passing tests.`);
    if (!Number.isFinite(skipped) || !Number.isFinite(todo)) throw new Error("could not read the TAP summary (skipped/todo counts).");
    if (skipped !== 0 || todo !== 0) throw new Error(`${name} DB suite skipped ${skipped} and left ${todo} todo test(s) — every test must run against PostgreSQL.`);
    console.log(`\n${name} DB suite: ${passed} passed, 0 skipped, against a real PostgreSQL.`);
  } catch (error) {
    console.error(`\nFAIL  ${error.message}`);
    process.exit(1);
  }
}
