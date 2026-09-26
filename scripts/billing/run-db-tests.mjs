#!/usr/bin/env node
// `pnpm test:billing:db` — the real-PostgreSQL SaaS billing suite (checkout
// saga, webhooks, leasing, recovery, seats, cancellation, reconciliation,
// entitlements) against the real Razorpay adapter and a local stand-in. Unlike the general integration run, this command FAILS when the
// database is unreachable and FAILS if any test in the suite is skipped, so a
// green result always means the invariants ran against PostgreSQL.
//
// Requires MIGRATION_DATABASE_URL (migration/owner role) and DATABASE_URL (the
// restricted runtime role provisioned by `pnpm db:provision:runtime-role`).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}

// Every suite here must talk to PostgreSQL; add new billing DB tests here.
export const BILLING_DB_TEST_FILES = Object.freeze([
  "tests/integration/billing/billing-commercial-db.test.mjs",
  "tests/integration/billing/billing-checkout-db.test.mjs",
  "tests/integration/billing/billing-webhooks-db.test.mjs",
  "tests/integration/billing/billing-subscription-db.test.mjs",
  "tests/integration/billing-entitlement-sp011.test.mjs",
  "tests/integration/organization-subscription-auto-provision.test.mjs",
]);

async function assertReachable(name) {
  const connectionString = String(process.env[name] || "").trim();
  if (!connectionString) throw new Error(`${name} is not set. Run \`pnpm infra:up && pnpm db:setup\` (or configure CI) first.`);
  const client = new pg.Client({ connectionString, application_name: "vercentlabs-billing-db-preflight" });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch (error) {
    throw new Error(`${name} is unreachable: ${error.message || error.code || error}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  await assertReachable("MIGRATION_DATABASE_URL");
  await assertReachable("DATABASE_URL");
  for (const file of BILLING_DB_TEST_FILES) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`missing billing DB test file: ${file}`);
  }

  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...BILLING_DB_TEST_FILES], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");

  const count = (label) => Number((result.stdout || "").match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? NaN);
  const skipped = count("skipped");
  const todo = count("todo");
  const passed = count("pass");
  if (result.status !== 0) throw new Error(`billing DB suite failed (exit ${result.status}).`);
  if (!Number.isFinite(passed) || passed === 0) throw new Error("billing DB suite reported no passing tests.");
  if (!Number.isFinite(skipped) || !Number.isFinite(todo)) throw new Error("could not read the TAP summary (skipped/todo counts).");
  if (skipped !== 0 || todo !== 0) throw new Error(`billing DB suite skipped ${skipped} and left ${todo} todo test(s) — every billing DB test must run against PostgreSQL.`);
  console.log(`\nBilling DB suite: ${passed} passed, 0 skipped, against a real PostgreSQL.`);
}

main().catch((error) => {
  console.error(`\nFAIL  ${error.message}`);
  process.exit(1);
});
