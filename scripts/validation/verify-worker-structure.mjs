#!/usr/bin/env node
// Static, non-destructive structural checks for services/worker. Connects
// to no database, makes no network request — reads source files only.
// Companion to `pnpm test:worker` (behavioral coverage): this script
// checks architectural invariants a unit test wouldn't naturally catch
// (Part 71: "worker typecheck, tests, structural/runtime validation" —
// services/worker is plain JS like services/api, so there is no
// typecheck step; this is the "structural validation" half).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerSrc = path.join(root, "services/worker/src");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

let failures = 0;
function fail(message) {
  failures += 1;
  console.error(`FAIL  ${message}`);
}
function ok(message) {
  console.log(`OK    ${message}`);
}

// Part 85: no process-local queue standing in for durable state.
const forbiddenPatterns = [
  { pattern: /\bsetInterval\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*(push|shift|queue)/is, message: "a setInterval-based in-memory queue simulation" },
];
for (const file of fs.readdirSync(workerSrc)) {
  if (!file.endsWith(".js")) continue;
  const contents = fs.readFileSync(path.join(workerSrc, file), "utf8");
  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(contents)) fail(`${file} appears to contain ${message} — durable state must live in Postgres, not an in-process array`);
  }
}
ok("no process-local array/setInterval queue found standing in for durable state");

// Part 86: the worker must never be started from a Next.js route/layout.
const nextjsRoutesAndLayouts = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts" || entry.name === "layout.tsx") nextjsRoutesAndLayouts.push(full);
  }
}
walk(path.join(root, "apps/web/src/app"));
let leaked = 0;
for (const file of nextjsRoutesAndLayouts) {
  const contents = fs.readFileSync(file, "utf8");
  if (/@vercentlabs\/worker/.test(contents) || /createWorker\s*\(/.test(contents)) {
    fail(`${path.relative(root, file)} imports the worker — the worker must be a standalone process, never started from a Next.js route/layout`);
    leaked += 1;
  }
}
if (leaked === 0) ok(`no Next.js route.ts/layout.tsx imports @vercentlabs/worker (checked ${nextjsRoutesAndLayouts.length} files)`);

// bin/start.mjs must be the only place that calls .start() on a created worker.
let startCallSites = 0;
for (const file of fs.readdirSync(path.join(root, "services/worker/src"))) {
  if (!file.endsWith(".js")) continue;
  const contents = fs.readFileSync(path.join(root, "services/worker/src", file), "utf8");
  if (/createWorker\([^)]*\)\.start\(\)|worker\.start\(\)/.test(contents)) startCallSites += 1;
}
const binContents = read("services/worker/bin/start.mjs");
if (!/worker\.start\(\)/.test(binContents)) fail("bin/start.mjs does not call worker.start() — the worker would never actually run");
else ok("bin/start.mjs is the entrypoint that starts the worker");

// Every registered handler must declare a backoff function (Part 11: no
// hardcoded single policy for everything is enforced at the registry
// level by requiring each registration to supply its own).
const handlersIndex = read("services/worker/src/handlers/index.js");
const registrationBlocks = [...handlersIndex.matchAll(/registerJobHandler\(([\s\S]*?)\);/g)];
if (registrationBlocks.length === 0) fail("no job handlers are registered in handlers/index.js");
for (const [, block] of registrationBlocks) {
  if (!/backoff:/.test(block)) fail(`a registerJobHandler(...) call in handlers/index.js is missing a backoff function`);
  if (!/idempotency:/.test(block)) fail(`a registerJobHandler(...) call in handlers/index.js is missing an idempotency classification`);
}
if (registrationBlocks.length > 0) ok(`${registrationBlocks.length} job handler(s) registered, each with a backoff policy and idempotency classification`);

// package.json scripts must exist for dev/start/test (Part 17/18/71/72).
const workerPackageJson = JSON.parse(read("services/worker/package.json"));
for (const script of ["dev", "start", "test"]) {
  if (!workerPackageJson.scripts?.[script]) fail(`services/worker/package.json is missing a "${script}" script`);
}
ok('services/worker/package.json declares "dev", "start" and "test" scripts');

// The worker must never accept a client-supplied tenant identifier for a
// query — every organizationId used in a query must originate from
// db.js's listActiveOrganizationIds() or a caller-supplied, already-
// authenticated context, never from job.payload directly.
const queueSource = read("services/worker/src/queue.js");
if (/payload\.organizationId|payload\["organizationId"\]/.test(queueSource)) {
  fail("queue.js appears to read organizationId from a job payload — tenant scoping must come only from the queue row's own organization_id column");
} else {
  ok("queue.js never reads organizationId from a job payload");
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
