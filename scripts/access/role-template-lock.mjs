#!/usr/bin/env node
// Built-in role template drift guard.
//
// packages/permissions/src/roles.js (ROLE_TEMPLATES) is the canonical source
// for every built-in role. New organizations receive it at bootstrap, but
// bootstrap only ever INSERTs — existing tenants keep whatever grants they
// were seeded with (the reason platform migration 058 had to reconcile CRM
// grants after the fact). This lock records a fingerprint of every template;
// changing a template without a synchronization migration fails
// `pnpm verify:access`.
//
// Workflow when a built-in role template must change:
//   1. edit packages/permissions/src/roles.js;
//   2. `node scripts/database/generate-canonical-role-sync-migration.mjs --write`
//      (a NEW platform migration reconciling every tenant's built-in roles;
//      never edit a shipped migration);
//   3. `node scripts/access/role-template-lock.mjs --write --synchronized-by <that migration>`.
// The validator then requires every role to point at that migration, the
// migration to exist, to name every slug, and to be byte-identical to what
// the generator produces from the current templates.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ROLE_TEMPLATES } from "../../packages/permissions/src/roles.js";
import { buildMigration } from "../database/generate-canonical-role-sync-migration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOCK_PATH = path.join(root, "packages/permissions/role-templates.lock.json");
// Accepted only by compareLock's unit tests; the committed lock must name a
// real synchronization migration for every role.
export const BASELINE = "baseline";

export function fingerprintTemplate(template) {
  const canonical = JSON.stringify({
    slug: template.slug,
    moduleKey: template.moduleKey,
    riskLevel: template.riskLevel,
    assignable: template.assignable,
    permissions: [...template.permissions].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function currentFingerprints(templates = ROLE_TEMPLATES) {
  return Object.fromEntries(
    [...templates].sort((a, b) => a.slug.localeCompare(b.slug)).map((template) => [template.slug, fingerprintTemplate(template)]),
  );
}

export function readLock(lockPath = LOCK_PATH) {
  return JSON.parse(fs.readFileSync(lockPath, "utf8"));
}

// Pure comparison so it is unit-testable: returns human-readable problems.
export function compareLock(lock, fingerprints, { migrationExists, migrationSource }) {
  const problems = [];
  const lockedSlugs = Object.keys(lock.roles || {});
  for (const slug of Object.keys(fingerprints)) {
    const entry = lock.roles?.[slug];
    if (!entry) {
      problems.push(`${slug}: new built-in role template is not in the lock — add a platform migration that provisions it for existing tenants, then re-run the lock writer with --synchronized-by.`);
      continue;
    }
    if (entry.fingerprint !== fingerprints[slug]) {
      problems.push(`${slug}: template changed since it was locked — existing tenants will silently drift. Add a NEW platform migration reconciling this role and re-run the lock writer with --synchronized-by.`);
      continue;
    }
    if (entry.synchronizedBy === BASELINE) {
      problems.push(`${slug}: locked as an unverified baseline — generate a canonical role sync migration and re-lock with --synchronized-by.`);
    } else {
      if (!migrationExists(entry.synchronizedBy)) {
        problems.push(`${slug}: synchronizedBy names a missing migration (${entry.synchronizedBy}).`);
      } else if (!migrationSource(entry.synchronizedBy).includes(slug)) {
        problems.push(`${slug}: synchronizing migration ${entry.synchronizedBy} never mentions this role slug.`);
      }
    }
  }
  for (const slug of lockedSlugs) {
    if (!(slug in fingerprints)) problems.push(`${slug}: locked role no longer exists in ROLE_TEMPLATES — removing a built-in role needs an explicit migration and lock update.`);
  }
  return problems;
}

export function verifyLock() {
  const migrationPath = (relative) => path.join(root, relative);
  const lock = readLock();
  const problems = compareLock(lock, currentFingerprints(), {
    migrationExists: (relative) => /^database\/platform\/migrations\/[^/]+\.sql$/.test(relative) && fs.existsSync(migrationPath(relative)),
    migrationSource: (relative) => fs.readFileSync(migrationPath(relative), "utf8"),
  });
  // Sync migrations reconcile EVERY built-in role, so every entry must point
  // at the same (latest) one, and it must be exactly the generator's output.
  const targets = [...new Set(Object.values(lock.roles || {}).map((entry) => entry.synchronizedBy))];
  if (targets.length !== 1) {
    problems.push(`all roles must reference one canonical sync migration; found ${targets.join(", ")}`);
  } else if (fs.existsSync(migrationPath(targets[0])) && fs.readFileSync(migrationPath(targets[0]), "utf8").replace(/\r\n/g, "\n") !== buildMigration()) {
    problems.push(`${targets[0]} does not match the generator output for the current templates — regenerate into a NEW migration and re-lock.`);
  }
  return problems;
}

function writeLock(synchronizedBy) {
  const fingerprints = currentFingerprints();
  const previous = fs.existsSync(LOCK_PATH) ? readLock() : { roles: {} };
  const roles = {};
  for (const [slug, fingerprint] of Object.entries(fingerprints)) {
    const before = previous.roles?.[slug];
    const unchanged = before && before.fingerprint === fingerprint;
    if (!unchanged && !synchronizedBy) {
      throw new Error(`${slug} changed: pass --synchronized-by database/platform/migrations/<new sync migration>.sql`);
    }
    // A sync migration reconciles every built-in role, so it becomes the
    // reference for all of them.
    roles[slug] = { fingerprint, synchronizedBy: synchronizedBy || before.synchronizedBy };
  }
  const lock = {
    description: "Fingerprints of packages/permissions ROLE_TEMPLATES. Generated by scripts/access/role-template-lock.mjs — do not edit by hand.",
    roles,
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(roles).length} role fingerprints to ${path.relative(root, LOCK_PATH)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    const index = args.indexOf("--synchronized-by");
    writeLock(index === -1 ? undefined : args[index + 1]);
  } else {
    const problems = verifyLock();
    if (problems.length) {
      for (const problem of problems) console.error(`FAIL  ${problem}`);
      process.exit(1);
    }
    console.log("OK    built-in role templates match their synchronization lock");
  }
}
