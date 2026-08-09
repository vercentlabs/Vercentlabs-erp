import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// This is a NEW, structural test (not restored from git history — no such
// test existed before the Aug 2026 deletion). It statically verifies the
// row-level-security convention documented in docs/implementation/
// ERP_WEB_AUDIT_001.md, Section 9: every tenant-schema migration that
// creates a table also enables and FORCEs Postgres RLS on it.
//
// What this test CANNOT prove (documented, not faked): that RLS actually
// blocks a cross-tenant read/write at runtime. That requires a live
// PostgreSQL instance with two seeded organizations and is intentionally
// left as an integration-only check — see ERP_VERIFICATION_BASELINE_002.md,
// "Environment-Dependent Checks".

const root = path.resolve(import.meta.dirname, "../..");
const migrationsDir = path.join(root, "database/tenant/migrations");

test("every tenant migration that creates a table also enables and forces row-level security", () => {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0, "expected tenant migrations to exist");

  const missingEnable = [];
  const missingForce = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (!/CREATE TABLE/i.test(sql)) continue;
    if (!/ENABLE ROW LEVEL SECURITY/i.test(sql)) missingEnable.push(file);
    if (!/FORCE ROW LEVEL SECURITY/i.test(sql)) missingForce.push(file);
  }

  assert.deepEqual(missingEnable, [], "migrations creating tables without ENABLE ROW LEVEL SECURITY");
  assert.deepEqual(missingForce, [], "migrations creating tables without FORCE ROW LEVEL SECURITY");
});

test("the foundational tenant migration establishes the organization-scoped isolation policy", () => {
  const foundation = fs.readFileSync(
    path.join(migrationsDir, "001_business_data_foundation.sql"),
    "utf8",
  );
  assert.match(foundation, /CREATE POLICY tenant_organization_isolation/);
  assert.match(
    foundation,
    /USING \(organization_id = tenant\.current_organization_id\(\)\)/,
  );
  assert.match(
    foundation,
    /WITH CHECK \(organization_id = tenant\.current_organization_id\(\)\)/,
  );
});

test("tenant context is set through the single parameterized entry point, not string interpolation", () => {
  const source = fs.readFileSync(
    path.join(root, "packages/database/src/index.js"),
    "utf8",
  );
  assert.match(source, /set_config\('app\.current_organization_id', \$1, true\)/);
  // Guards against a regression where a future edit interpolates the
  // organization id directly into SQL instead of binding it as $1.
  assert.doesNotMatch(source, /set_config\('app\.current_organization_id',\s*\$\{/);
});
