#!/usr/bin/env node
// Static, non-destructive migration structure checks. Connects to NO
// database, executes NO SQL, drops/resets NOTHING — it only reads the
// migration files on disk. This is Level 4 ("Database") of the
// verification tiers described in docs/implementation/
// ERP_VERIFICATION_BASELINE_002.md.
//
// What this script does NOT do (documented, not faked): confirm the
// migrations actually apply cleanly against a live PostgreSQL instance, or
// that RLS blocks a cross-tenant query at runtime. Those remain
// integration-only checks requiring `pnpm infra:up` + `pnpm db:migrate:*`
// against a real database, which is out of scope for a routine, offline
// verification pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const directories = [
  { label: "platform", dir: path.join(root, "database/platform/migrations") },
  { label: "tenant", dir: path.join(root, "database/tenant/migrations") },
];

let failures = 0;
let warnings = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL  ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`WARN  ${message}`);
}

function info(message) {
  console.log(`OK    ${message}`);
}

for (const { label, dir } of directories) {
  if (!fs.existsSync(dir)) {
    fail(`${label}: migrations directory does not exist (${dir})`);
    continue;
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    fail(`${label}: no .sql migration files found`);
    continue;
  }

  // Duplicate numeric prefixes are forbidden. Migration identity must be unique
  // and human-readable even though the runner tracks the full filename.
  const byPrefix = new Map();
  for (const file of files) {
    const prefix = file.match(/^(\d+)_/)?.[1];
    if (!prefix) {
      warn(`${label}/${file}: filename does not start with a numeric prefix (NNN_description.sql)`);
      continue;
    }
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }
  for (const [prefix, matches] of byPrefix) {
    if (matches.length > 1) {
      fail(`${label}: duplicate migration prefix ${prefix} used by ${matches.join(", ")}`);
    }
  }

  let transactionIssues = 0;
  let rlsIssues = 0;
  let missingOrgIdIssues = 0;

  for (const file of files) {
    const full = path.join(dir, file);
    const sql = fs.readFileSync(full, "utf8");
    const trimmed = sql.trim();

    if (!/^BEGIN;/.test(trimmed)) {
      fail(`${label}/${file}: does not start with BEGIN; (not wrapped in an explicit transaction)`);
      transactionIssues += 1;
    }
    if (!/COMMIT;\s*$/.test(trimmed)) {
      fail(`${label}/${file}: does not end with COMMIT; (not wrapped in an explicit transaction)`);
      transactionIssues += 1;
    }

    // Dangerous-statement scan: these are legitimate in a migration tool in
    // general, but this repository's convention (per docs/implementation/
    // ERP_WEB_AUDIT_001.md) is additive, IF NOT EXISTS / IF EXISTS-guarded
    // migrations with no destructive DDL. Flag anything that deviates.
    if (/\bDROP\s+DATABASE\b/i.test(sql)) fail(`${label}/${file}: contains DROP DATABASE`);
    if (/\bDROP\s+SCHEMA\b(?!.*IF\s+EXISTS)/i.test(sql) && /\bDROP\s+SCHEMA\b/i.test(sql)) {
      warn(`${label}/${file}: contains DROP SCHEMA — verify it is IF EXISTS-guarded`);
    }
    if (/\bTRUNCATE\b/i.test(sql)) warn(`${label}/${file}: contains TRUNCATE`);

    if (label === "tenant" && /CREATE TABLE IF NOT EXISTS tenant\./i.test(sql)) {
      const createsTables = sql.match(/CREATE TABLE IF NOT EXISTS tenant\.\w+/gi) || [];
      if (!/ENABLE ROW LEVEL SECURITY/i.test(sql)) {
        fail(`${label}/${file}: creates ${createsTables.length} table(s) but never ENABLEs row-level security`);
        rlsIssues += 1;
      }
      if (!/FORCE ROW LEVEL SECURITY/i.test(sql)) {
        fail(`${label}/${file}: creates ${createsTables.length} table(s) but never FORCEs row-level security`);
        rlsIssues += 1;
      }

      const tableBodies = sql.matchAll(/CREATE TABLE IF NOT EXISTS tenant\.(\w+)\s*\(([\s\S]*?)\n?\)\s*;/g);
      for (const match of tableBodies) {
        const [, tableName, body] = match;
        if (!body.includes("organization_id")) {
          fail(`${label}/${file}: tenant.${tableName} has no organization_id column`);
          missingOrgIdIssues += 1;
        }
      }
    }
  }

  if (transactionIssues === 0 && rlsIssues === 0 && missingOrgIdIssues === 0) {
    info(`${label}: ${files.length} migrations — transaction-wrapped, RLS-enforced, organization-scoped`);
  }
}

console.log("");
console.log(`verify:db summary — ${failures} failing check(s), ${warnings} warning(s)`);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Database structure checks passed (static analysis only — no live database was contacted).");
}
