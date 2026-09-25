import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ERP_MODULE_CATALOG } from "../../shared-types/src/modules.js";
import {
  ACCOUNTING_PERMISSIONS,
  ALL_PERMISSIONS,
  BILLING_PERMISSIONS,
  COMPANY_ADMINISTRATOR_PERMISSIONS,
  CORE_PERMISSIONS,
  CRM_PERMISSIONS,
  CURRENT_MODULE_KEYS,
  PROCUREMENT_PERMISSIONS,
  SALES_PERMISSIONS,
  MODULE_ACCESS_PERMISSIONS,
  PERMISSION_BYPASS_ROLE_SLUGS,
  ROLE_TEMPLATES,
  SOD_CONFLICTS,
  UNRESTRICTED_SCOPE_ROLE_SLUGS,
} from "../src/index.js";
import { compareLock, currentFingerprints, verifyLock } from "../../../scripts/access/role-template-lock.mjs";

// The canonical permission/role catalogue must stay internally consistent and
// consistent with the module catalogue and the platform migrations that
// register permission keys in the database. These are the drift guardrails
// behind `pnpm verify:access`.

const root = path.resolve(import.meta.dirname, "../../..");
const catalogueModuleKeys = ERP_MODULE_CATALOG.map((module) => module.key);
const known = new Set(ALL_PERMISSIONS);

test("permission keys are unique and well-formed", () => {
  assert.equal(known.size, ALL_PERMISSIONS.length, "duplicate permission key in ALL_PERMISSIONS");
  for (const key of ALL_PERMISSIONS) assert.match(key, /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/, `malformed permission key ${key}`);
});

test("every role permission exists and every role module key is a known module", () => {
  for (const role of ROLE_TEMPLATES) {
    assert.ok(CURRENT_MODULE_KEYS.includes(role.moduleKey), `${role.slug} has unknown moduleKey ${role.moduleKey}`);
    for (const permission of role.permissions) assert.ok(known.has(permission), `${role.slug} grants unknown ${permission}`);
  }
});

test("role slugs are unique", () => {
  const slugs = ROLE_TEMPLATES.map((role) => role.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("role module keys are exactly platform + the module catalogue", () => {
  assert.deepEqual([...CURRENT_MODULE_KEYS].sort(), ["platform", ...catalogueModuleKeys].sort());
});

test("every released module has at least one module-specific role that can open it", () => {
  for (const module of ERP_MODULE_CATALOG.filter((entry) => entry.availability === "released")) {
    const viewPermission = MODULE_ACCESS_PERMISSIONS[module.key];
    const roles = ROLE_TEMPLATES.filter((role) => role.moduleKey === module.key && role.permissions.includes(viewPermission));
    assert.ok(roles.length > 0, `${module.key} has no module-specific role granting ${viewPermission}`);
  }
});

test("module access permissions cover exactly the module catalogue with registered keys", () => {
  assert.deepEqual(Object.keys(MODULE_ACCESS_PERMISSIONS).sort(), [...catalogueModuleKeys].sort());
  for (const permission of Object.values(MODULE_ACCESS_PERMISSIONS)) assert.ok(known.has(permission), permission);
});

test("unrestricted/bypass role slugs are real templates", () => {
  const slugs = new Set(ROLE_TEMPLATES.map((role) => role.slug));
  for (const slug of [...UNRESTRICTED_SCOPE_ROLE_SLUGS, ...PERMISSION_BYPASS_ROLE_SLUGS]) assert.ok(slugs.has(slug), slug);
});

test("SoD conflicts reference registered permissions", () => {
  for (const conflict of SOD_CONFLICTS) {
    assert.ok(known.has(conflict.first), `${conflict.key}: ${conflict.first}`);
    assert.ok(known.has(conflict.second), `${conflict.key}: ${conflict.second}`);
  }
});

test("every canonical permission key is registered by a platform migration", () => {
  const directory = path.join(root, "database/platform/migrations");
  const sql = fs.readdirSync(directory).filter((name) => name.endsWith(".sql")).map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("\n");
  const unregistered = ALL_PERMISSIONS.filter((key) => !sql.includes(`'${key}'`));
  assert.deepEqual(unregistered, [], "add a new platform migration inserting these keys into permissions");
});

test("built-in role templates match their synchronization lock", () => {
  assert.deepEqual(verifyLock(), []);
});

test("changing a template without a synchronizing migration is rejected", () => {
  const fingerprints = currentFingerprints();
  const [slug] = Object.keys(fingerprints);
  const sync = "database/platform/migrations/999_canonical_system_role_sync.sql";
  const everySlug = Object.keys(fingerprints).map((key) => `'${key}'`).join(",");
  const lock = { roles: Object.fromEntries(Object.entries(fingerprints).map(([key, fingerprint]) => [key, { fingerprint, synchronizedBy: sync }])) };
  lock.roles[slug].fingerprint = "stale";
  const problems = compareLock(lock, fingerprints, { migrationExists: () => true, migrationSource: () => everySlug });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /template changed/);

  lock.roles[slug] = { fingerprint: fingerprints[slug], synchronizedBy: sync };
  const unrelated = compareLock(lock, fingerprints, { migrationExists: () => true, migrationSource: () => "-- touches nothing" });
  assert.match(unrelated[0], /never mentions this role slug/);
  assert.deepEqual(compareLock(lock, fingerprints, { migrationExists: () => true, migrationSource: () => everySlug }), []);
});

test("an unverified baseline is no longer an acceptable lock state", () => {
  const fingerprints = currentFingerprints();
  const lock = { roles: Object.fromEntries(Object.entries(fingerprints).map(([key, fingerprint]) => [key, { fingerprint, synchronizedBy: "baseline" }])) };
  const problems = compareLock(lock, fingerprints, { migrationExists: () => true, migrationSource: () => "" });
  assert.equal(problems.length, Object.keys(fingerprints).length);
  assert.match(problems[0], /unverified baseline/);
});

test("Company Administrator is least-privilege administration with no business, module, role-definition or billing authority", () => {
  const admin = ROLE_TEMPLATES.find((role) => role.slug === "company_administrator");
  assert.deepEqual([...admin.permissions].sort(), [...COMPANY_ADMINISTRATOR_PERMISSIONS].sort());
  for (const key of [CORE_PERMISSIONS.companyManage, CORE_PERMISSIONS.branchManage, CORE_PERMISSIONS.usersManage, CORE_PERMISSIONS.rolesAssign]) {
    assert.ok(admin.permissions.includes(key), `must keep ${key}`);
  }
  const forbidden = [
    CRM_PERMISSIONS.leadsManage,
    SALES_PERMISSIONS.orderCreate,
    ACCOUNTING_PERMISSIONS.journalCreate,
    PROCUREMENT_PERMISSIONS.poCreate,
    CORE_PERMISSIONS.modulesManage,
    CORE_PERMISSIONS.rolesManage,
    CORE_PERMISSIONS.organizationManage,
    CORE_PERMISSIONS.accessSodOverride,
    CORE_PERMISSIONS.auditView,
    ...Object.values(BILLING_PERMISSIONS),
  ];
  for (const key of forbidden) {
    assert.ok(key, "forbidden key constant must exist");
    assert.ok(!admin.permissions.includes(key), `must not include ${key}`);
  }
  // No permission belonging to any business module at all.
  const businessPrefixes = ["crm.", "sales.", "accounting.", "procurement.", "stock.", "manufacturing.", "projects.", "assets.", "pos.", "quality.", "support.", "hr_payroll.", "business_data.", "parties.", "items.", "billing."];
  assert.deepEqual(admin.permissions.filter((key) => businessPrefixes.some((prefix) => key.startsWith(prefix))), []);
});

test("Organization Owner and System Administrator keep full authority; owner alone is unassignable", () => {
  for (const slug of ["organization_owner", "system_administrator"]) {
    assert.deepEqual([...ROLE_TEMPLATES.find((role) => role.slug === slug).permissions].sort(), [...ALL_PERMISSIONS].sort(), slug);
  }
  assert.equal(ROLE_TEMPLATES.find((role) => role.slug === "organization_owner").assignable, false);
});
