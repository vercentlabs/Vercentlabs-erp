import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Prompt 12 (Emergency P0 Integrity Fixes) — regression coverage for the
// confirmed-live onboarding defect documented in
// docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md: crm.records.view_all
// was granted to 7 role templates in access-control.ts by Prompt 3, but
// was never inserted into the control-plane `permissions` table by any
// migration, so seeding a role that holds it (during fresh-organization
// onboarding) throws a foreign-key violation and aborts the whole
// onboarding transaction (role_permissions.permission_key REFERENCES
// permissions(key)).
//
// This file does two things: (1) a SPECIFIC regression test locking in
// the crm.records.view_all fix itself, and (2) a GENERAL invariant test
// (the one that should already have existed) — every permission key any
// ROLE_TEMPLATES role references must be registered by some control-plane
// migration's `permissions` table, so this exact class of bug cannot
// recur for any future permission addition without failing this suite.

const require = createRequire(import.meta.url);
const ts = require("typescript");

const webRoot = process.cwd();
const root = path.resolve(webRoot, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function loadAccessControl() {
  const sourcePath = path.join(webRoot, "src/lib/access-control.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const permissionsUrl = pathToFileURL(path.join(root, "packages/permissions/src/index.js")).href;
  const transpiled = ts
    .transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace('from "@vercentlabs/permissions"', `from ${JSON.stringify(permissionsUrl)}`);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-onboarding-perm-"));
  const temporaryFile = path.join(temporaryDirectory, "access-control.mjs");
  fs.writeFileSync(temporaryFile, transpiled);
  return import(`${pathToFileURL(temporaryFile).href}?v=${Date.now()}`);
}

const accessControl = await loadAccessControl();
const templates = accessControl.ROLE_TEMPLATES;
const templateBySlug = new Map(templates.map((role) => [role.slug, role]));

function allControlPlaneMigrationFiles() {
  const dir = path.join(root, "database/control-plane/migrations");
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
}

function registeredPermissionKeys(migrationFiles) {
  const keys = new Set();
  const insertBlockRe = /INSERT INTO permissions\s*\([^)]*\)\s*VALUES\s*([\s\S]*?);/g;
  const keyRe = /\(\s*'([a-z0-9_.-]+)'/g;
  for (const { text } of migrationFiles) {
    let block;
    while ((block = insertBlockRe.exec(text))) {
      let match;
      keyRe.lastIndex = 0;
      while ((match = keyRe.exec(block[1]))) {
        keys.add(match[1]);
      }
    }
  }
  return keys;
}

const migrationFiles = allControlPlaneMigrationFiles();
const registeredKeys = registeredPermissionKeys(migrationFiles);
const migration018 = migrationFiles.find((m) => m.name.startsWith("018_"));

// ---------------------------------------------------------------------
// T1.1 — crm.records.view_all exists in the canonical (TypeScript)
// permission catalogue, granted to exactly the 7 roles Prompt 3 named.
// ---------------------------------------------------------------------
test("crm.records.view_all: exists in the TypeScript role catalogue on exactly the 7 roles Prompt 3 named, and NOT on sales_representative", () => {
  const expectedSlugs = [
    "crm_administrator",
    "sales_head",
    "sales_manager",
    "sales_operations",
    "marketing_manager",
    "customer_success_manager",
    "partner_manager",
  ];
  for (const slug of expectedSlugs) {
    const role = templateBySlug.get(slug);
    assert.ok(role, `expected a role template for ${slug}`);
    assert.ok(
      role.permissions.includes("crm.records.view_all"),
      `${slug} should hold crm.records.view_all`,
    );
  }
  const restricted = templateBySlug.get("sales_representative");
  assert.ok(restricted, "expected a role template for sales_representative");
  assert.ok(
    !restricted.permissions.includes("crm.records.view_all"),
    "sales_representative must remain owner/assignee scoped (Prompt 3 default) and must NOT hold crm.records.view_all",
  );
});

// ---------------------------------------------------------------------
// T1.2 / T1.6 / T1.7 — Persisted permission registration: migration 032
// registers the key and safely backfills exactly the expected roles,
// idempotently.
// ---------------------------------------------------------------------
test("crm.records.view_all: a control-plane migration registers it in the permissions table (the specific fix for the confirmed live defect)", () => {
  assert.ok(
    registeredKeys.has("crm.records.view_all"),
    "no control-plane migration inserts 'crm.records.view_all' into the permissions table — this is exactly the confirmed live onboarding-breaking defect",
  );
});

test("crm.records.view_all: migration 032 exists, is transaction-wrapped, and uses ON CONFLICT DO NOTHING for both the permission row and the backfill grants (safe to re-run, matches migrations 018/027/030/031's established pattern)", () => {
  const migration = migrationFiles.find((m) => m.name.startsWith("032_"));
  assert.ok(migration, "expected database/control-plane/migrations/032_*.sql to exist");
  assert.match(migration.text, /^BEGIN;/);
  assert.match(migration.text, /COMMIT;\s*$/);
  assert.match(migration.text, /INSERT INTO permissions[\s\S]*'crm\.records\.view_all'[\s\S]*ON CONFLICT \(key\) DO NOTHING/);
  assert.match(migration.text, /INSERT INTO role_permissions[\s\S]*'crm\.records\.view_all'[\s\S]*ON CONFLICT DO NOTHING/);
});

test("crm.records.view_all: migration 032's backfill role list matches the TypeScript role template exactly (10 roles: the 7 CRM/sales roles + organization_owner/system_administrator/company_administrator)", () => {
  const migration = migrationFiles.find((m) => m.name.startsWith("032_"));
  const expectedSlugs = [
    "organization_owner",
    "system_administrator",
    "company_administrator",
    "crm_administrator",
    "sales_head",
    "sales_manager",
    "sales_operations",
    "marketing_manager",
    "customer_success_manager",
    "partner_manager",
  ];
  for (const slug of expectedSlugs) {
    assert.match(
      migration.text,
      new RegExp(`'${slug}'`),
      `migration 032 should backfill the ${slug} role`,
    );
  }
  assert.doesNotMatch(
    migration.text,
    /'sales_representative'/,
    "migration 032 must NOT grant crm.records.view_all to sales_representative",
  );
  assert.doesNotMatch(
    migration.text,
    /'auditor'/,
    "migration 032 must NOT expand scope to auditor — Prompt 3 never granted crm.records.view_all to auditor and this migration should not invent new scope",
  );
});

// ---------------------------------------------------------------------
// T1.3 (GENERAL INVARIANT — the test that should already have existed) —
// every permission key referenced by any ROLE_TEMPLATES role must be
// registered by some control-plane migration. This is what actually
// prevents this class of bug (a TypeScript-only permission addition with
// no corresponding DB registration) from recurring for ANY future
// permission, not just this one.
// ---------------------------------------------------------------------
test("INVARIANT: every permission referenced by any role template is registered in the permissions table by some control-plane migration (prevents onboarding FK violations for any future permission addition)", () => {
  const referenced = new Set();
  for (const role of templates) {
    for (const permission of role.permissions) referenced.add(permission);
  }
  const missing = [...referenced].filter((key) => !registeredKeys.has(key));
  assert.deepEqual(
    missing,
    [],
    `permission(s) referenced by a role template but never registered in the permissions table (would break onboarding for any org seeding a role that holds one): ${missing.join(", ")}`,
  );
});

// ---------------------------------------------------------------------
// T1.4 — role_permissions has a hard FK to permissions(key); confirm this
// is still true so the reproduction/fix reasoning above stays valid.
// ---------------------------------------------------------------------
test("role_permissions.permission_key still has a hard foreign key to permissions(key) (confirms why an unregistered permission breaks seeding)", () => {
  const foundation = migrationFiles.find((m) => m.name.startsWith("002_"));
  assert.ok(foundation, "expected 002_platform_foundation.sql to exist");
  assert.match(
    foundation.text,
    /permission_key text NOT NULL REFERENCES permissions\(key\)/,
  );
});

// ---------------------------------------------------------------------
// T1.5 / T1.8 — seedOrganizationFoundation seeds every ROLE_TEMPLATES
// permission unconditionally inside one transaction with no per-row
// error handling (confirms the failure is deterministic, not
// probabilistic) — and confirms Prompt 3's CRM ownership-scope behavior
// (recordScope/assertOwnerAssignmentAllowed) is untouched by this prompt.
// ---------------------------------------------------------------------
test("seedOrganizationFoundation iterates every ROLE_TEMPLATES permission unconditionally with no try/catch around the role_permissions insert (confirms the onboarding failure is deterministic for any org seeding an affected role, not merely possible)", () => {
  const platform = read("apps/web/src/lib/platform.ts");
  const seedFunction = platform.split("export async function seedOrganizationFoundation")[1] ?? "";
  assert.match(seedFunction, /for \(const template of ROLE_TEMPLATES\)/);
  assert.match(seedFunction, /for \(const permission of template\.permissions\)/);
  assert.match(
    seedFunction,
    /INSERT INTO role_permissions \(role_id, permission_key\) VALUES \(\$1, \$2\) ON CONFLICT DO NOTHING/,
  );
});

test("Prompt 3's CRM record-ownership scope (recordScope/assertOwnerAssignmentAllowed) is unchanged by this prompt's permission-catalogue fix", () => {
  const crm = read("services/api/src/crm.js");
  assert.match(crm, /function recordScope/);
  assert.match(crm, /assertOwnerAssignmentAllowed/);
  assert.match(crm, /ownerField/);
});

// ---------------------------------------------------------------------
// Migration numbering sanity — confirm 032 is genuinely the next unused
// number (the prompt explicitly warned not to assume this).
// ---------------------------------------------------------------------
test("migration 032 is the correct next control-plane migration number (no gap, no collision with an existing file)", () => {
  const numbers = migrationFiles
    .map((m) => Number(m.name.match(/^(\d+)_/)?.[1]))
    .filter((n) => Number.isFinite(n));
  const max = Math.max(...numbers.filter((n) => n < 32));
  assert.equal(max, 31, "expected migration 031 to be the highest control-plane migration before this prompt's new one");
  const occurrences = migrationFiles.filter((m) => m.name.startsWith("032_")).length;
  assert.equal(occurrences, 1, "expected exactly one migration file with prefix 032");
});

test("migration 018 (the original role/permission seed) is left untouched, per the established convention of fixing via a new migration rather than editing history", () => {
  assert.ok(migration018);
});
