#!/usr/bin/env node
// Runs the Playwright specs one file at a time, clearing the login rate limiter before each.
//
// Why: the login route allows 10 attempts per 300 seconds per IP, and every spec signs in with fresh users from the
// same machine. Run back to back, a long suite trips the limiter and the later specs fail on "login must succeed",
// which says nothing about the product. Clearing auth_rate_limits between files (a test-database-only action) makes a
// full run measure the product instead of the limiter. Refuses a non-local database unless E2E_SEED_ALLOW_REMOTE=1.
//
// Usage: node scripts/qa/run-e2e-per-spec.mjs [spec-file ...]   (no arguments = every spec in apps/web/e2e)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const webDir = path.join(root, "apps/web");
for (const file of [path.join(webDir, ".env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString) && process.env.E2E_SEED_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to clear rate limits on a non-local database. Set E2E_SEED_ALLOW_REMOTE=1 for a throwaway CI database.");
}

const requested = process.argv.slice(2);
const specs = requested.length
  ? requested
  : fs.readdirSync(path.join(webDir, "e2e")).filter((name) => name.endsWith(".spec.ts") && !name.startsWith("_")).sort();

async function clearRateLimits() {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query("DELETE FROM auth_rate_limits");
  } finally {
    await db.end();
  }
}

const failureDir = path.join(os.tmpdir(), "e2e-failures");
const results = [];
for (const spec of specs) {
  await clearRateLimits();
  const started = Date.now();
  const run = spawnSync("npx", ["playwright", "test", spec, "--reporter=line"], { cwd: webDir, shell: process.platform === "win32", encoding: "utf8", env: process.env });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const passed = Number(/(\d+) passed/.exec(output)?.[1] ?? 0);
  const failed = Number(/(\d+) failed/.exec(output)?.[1] ?? 0);
  const flaky = Number(/(\d+) flaky/.exec(output)?.[1] ?? 0);
  results.push({ spec, status: run.status, passed, failed, flaky, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${run.status === 0 ? "PASS" : "FAIL"}  ${spec}  passed=${passed} failed=${failed} flaky=${flaky} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (run.status !== 0) {
    fs.mkdirSync(failureDir, { recursive: true });
    fs.writeFileSync(path.join(failureDir, spec + ".log"), output);
  }
}

const failedSpecs = results.filter((r) => r.status !== 0);
console.log(`\n${results.length - failedSpecs.length}/${results.length} spec files passed.`);
if (failedSpecs.length) {
  console.log("Failed: " + failedSpecs.map((r) => r.spec).join(", "));
  console.log("Output of each failure: " + failureDir);
}
process.exit(failedSpecs.length ? 1 : 0);
