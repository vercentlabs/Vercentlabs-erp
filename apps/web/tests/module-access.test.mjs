import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sharedTypes = await import(
  pathToFileURL(path.join(root, "packages/shared-types/src/index.js")).href
);

async function loadAccessControl() {
  const sourcePath = path.join(root, "apps/web/src/lib/access-control.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const permissionsUrl = pathToFileURL(
    path.join(root, "packages/permissions/src/index.js"),
  ).href;
  const transpiled = ts
    .transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace('from "@vercentlabs/permissions"', `from ${JSON.stringify(permissionsUrl)}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-module-access-"));
  const file = path.join(dir, "access-control.mjs");
  fs.writeFileSync(file, transpiled);
  return import(`${pathToFileURL(file).href}?v=${Date.now()}`);
}

const accessControl = await loadAccessControl();
const templates = accessControl.ROLE_TEMPLATES;

// ---------------------------------------------------------------------
// Part 16 "Catalogue" — the canonical business-module list.
// ---------------------------------------------------------------------

test("catalogue: exactly 12 canonical business modules with stable, non-duplicate IDs", () => {
  const catalog = sharedTypes.ERP_MODULE_CATALOG;
  assert.equal(catalog.length, 12);
  const keys = catalog.map((module) => module.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate module keys found");
  for (const erpModule of catalog) {
    assert.equal(typeof erpModule.key, "string");
    assert.ok(erpModule.key.length > 0);
    assert.equal(typeof erpModule.name, "string");
  }
});

test("catalogue: Accounting is present and first-class (not roadmap, not platform-only)", () => {
  const accounting = sharedTypes.getErpModule("accounting");
  assert.ok(accounting, "accounting must exist in ERP_MODULE_CATALOG");
  assert.equal(accounting.availability, "released");
  assert.equal(sharedTypes.isReleasedModule("accounting"), true);
});

test("catalogue: every module is currently released (no roadmap/unreleased state contradicting the 12-module product)", () => {
  assert.equal(sharedTypes.ROADMAP_MODULE_KEYS.length, 0);
  assert.equal(sharedTypes.RELEASED_MODULE_KEYS.length, 12);
  assert.equal(sharedTypes.TOTAL_MODULE_COUNT, 12);
});

test("catalogue: platform capability identifiers do not collide with business module keys", () => {
  // Shared platform areas (per docs/implementation/ERP_AUTHORIZATION_MODEL_004.md,
  // Part 2) are never entries in ERP_MODULE_CATALOG — "platform" itself is
  // reserved for cross-module/administrative roles in access-control.ts's
  // AccessModuleKey, and must not appear as a business module key.
  const businessKeys = new Set(sharedTypes.ERP_MODULE_CATALOG.map((module) => module.key));
  const platformCapabilityIds = [
    "billing",
    "audit-logs",
    "compliance",
    "settings",
    "automation",
    "reports",
    "integrations",
    "data-management",
    "security",
    "platform",
  ];
  for (const id of platformCapabilityIds) {
    assert.equal(businessKeys.has(id), false, `platform capability "${id}" must not collide with a business module key`);
  }
});

// ---------------------------------------------------------------------
// Part 17 — the single most important invariant this prompt establishes.
// ---------------------------------------------------------------------

test("invariant: every released business module resolves through catalogue -> permissions -> role assignment", () => {
  const permissions = require(path.join(root, "packages/permissions/src/index.js"));
  const known = new Set(permissions.ALL_PERMISSIONS);
  const assignableModuleKeys = new Set(
    templates.filter((role) => role.assignable && role.moduleKey !== "platform").map((role) => role.moduleKey),
  );

  for (const erpModule of sharedTypes.ERP_MODULE_CATALOG) {
    // 1. catalogue -> the module must have a base ".view"-shaped permission
    // registered in the canonical permission catalogue.
    const viewPermission =
      erpModule.key === "point-of-sale"
        ? "pos.view"
        : erpModule.key === "hr-payroll"
          ? "hr_payroll.view"
          : `${erpModule.key}.view`;
    assert.ok(
      known.has(viewPermission),
      `${erpModule.key}: no ${viewPermission} permission registered`,
    );

    // 2. permissions -> role assignment: at least one ASSIGNABLE role must
    // be scoped to this module and must actually carry that permission.
    assert.ok(
      assignableModuleKeys.has(erpModule.key),
      `${erpModule.key}: released module has no assignable role — impossible for any non-system user to access`,
    );
    const roleForModule = templates.find(
      (role) => role.assignable && role.moduleKey === erpModule.key,
    );
    assert.ok(
      roleForModule.permissions.includes(viewPermission),
      `${erpModule.key}: assignable role "${roleForModule.slug}" does not carry ${viewPermission}`,
    );
  }
});

// ---------------------------------------------------------------------
// Part 9 — the resolver's own source, statically checked (see module-
// access.ts's own doc comment: full DB-backed behavioral testing needs a
// live Postgres + billing fixture, which is out of scope for this
// offline test tier — same documented limitation as tests/security/
// tenant-isolation-rls.test.mjs from Prompt 3).
// ---------------------------------------------------------------------

test("resolver: every catalogue module has a base view-permission mapping (no silent fall-through)", () => {
  const source = read("apps/web/src/lib/module-access.ts");
  for (const erpModule of sharedTypes.ERP_MODULE_CATALOG) {
    const escaped = erpModule.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Valid-identifier keys are written bare (crm:), hyphenated keys are
    // quoted ("point-of-sale":) — accept either form.
    assert.match(
      source,
      new RegExp(`"?${escaped}"?:\\s*PERMISSIONS\\.`),
      `module-access.ts: MODULE_VIEW_PERMISSIONS is missing an entry for "${erpModule.key}"`,
    );
  }
});

test("resolver: fails closed on lookup errors rather than defaulting to access", () => {
  const source = read("apps/web/src/lib/module-access.ts");
  // Every catch block touching enabled/entitled must resolve to a
  // denying value, never true/entitled/accessible.
  const catchBlocks = source.match(/catch \{[^}]*\}/g) ?? [];
  assert.ok(catchBlocks.length >= 3, "expected fail-closed catch blocks around tenant/entitlement lookups");
  // "enforced = true" inside a catch block is fail-closed (it makes a
  // subsequent entitlement mismatch block access, see entitlementBlocks
  // below) — only the actual access-granting variables must never be set
  // to true on an error path.
  for (const block of catchBlocks) {
    for (const grantingVariable of ["enabled", "entitled", "permitted", "accessible"]) {
      assert.doesNotMatch(
        block,
        new RegExp(`\\b${grantingVariable}\\s*=\\s*true\\b`),
        `a catch block defaults ${grantingVariable} to granting access: ${block}`,
      );
    }
  }
});

test("resolver: company/branch scope is never consulted by module access resolution (module access is not record access)", () => {
  const source = read("apps/web/src/lib/module-access.ts");
  // Checks actual field access (session.activeCompanyId), not prose — this
  // file's own doc comment legitimately names both fields when explaining
  // why they're deliberately out of scope (Part 10).
  assert.doesNotMatch(source, /\.activeCompanyId\b/);
  assert.doesNotMatch(source, /\.activeBranchId\b/);
});

// ---------------------------------------------------------------------
// Part 4 — obsolete four-module runtime remnants.
// ---------------------------------------------------------------------

test("no runtime code special-cases the four originally-launched modules as un-disable-able", () => {
  const route = read("apps/web/src/app/api/modules/[key]/route.ts");
  assert.doesNotMatch(
    route,
    /\["crm",\s*"sales",\s*"accounting",\s*"procurement"\]/,
    "the module-status route must not hardcode the retired four-module launch cohort",
  );
  assert.match(route, /SET status=\$3/, "the route must persist the actually-requested status, not force 'enabled'");
});

// ---------------------------------------------------------------------
// Post-Prompt-7 bug fix — organization_modules was never flipped to
// 'enabled' for existing organizations when the 8 "later" modules
// released. Found via a live sidebar screenshot showing only crm/sales/
// accounting/procurement (the original four-module launch cohort) for an
// existing org, even though role/permission access for the other 8
// modules was already fixed by migration 027. Root cause, confirmed
// against the running local database: migration 009 (crm release) seeded
// every existing organization with a row for all 12 modules at once — crm
// 'enabled', every other module explicitly 'disabled' (correct at the
// time — only CRM was released). Migrations 012/013/014 (sales/
// accounting/procurement) each correctly flipped their own module's row
// to 'enabled' for every existing org; migrations 019-026 (stock through
// hr-payroll) added PERMISSIONS rows but never performed the equivalent
// flip, leaving those 8 rows stuck at status='disabled', enabled_at=NULL
// forever — a state otherwise unreachable through the app's own code
// (PATCH /api/modules/[key] never nulls enabled_at when disabling an
// already-enabled module). New organizations were never affected —
// platform.ts's seedOrganizationFoundation() already iterates the full,
// current ERP_MODULE_CATALOG for every new org.
// ---------------------------------------------------------------------

test("a later migration re-enables organization_modules rows still stuck in their pristine, never-enabled post-009-seed state, and backfills any that are missing outright, for all 8 modules released after the original four-module cohort", () => {
  const migration = read(
    "database/control-plane/migrations/028_organization_modules_backfill.sql",
  );
  for (const moduleKey of [
    "stock", "manufacturing", "projects", "assets",
    "point-of-sale", "quality", "support", "hr-payroll",
  ]) {
    assert.match(
      migration,
      new RegExp(`'${moduleKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`),
      `migration 028 must cover "${moduleKey}"`,
    );
  }
  // The UPDATE path only ever matches a row that has never been touched by
  // any admin action (enabled_at IS NULL is otherwise unreachable) — it
  // can never silently override a module an administrator deliberately
  // enabled-then-disabled, since that path preserves enabled_at.
  assert.match(
    migration,
    /UPDATE organization_modules\s*SET status = 'enabled', enabled_at = now\(\), updated_at = now\(\)\s*FROM module_seed seed\s*WHERE organization_modules\.module_key = seed\.module_key\s*AND organization_modules\.status = 'disabled'\s*AND organization_modules\.enabled_at IS NULL;/,
  );
  // The INSERT path only covers a row missing outright, and must never
  // overwrite an existing explicit row (whatever its status).
  assert.match(migration, /FROM organizations organization\s*CROSS JOIN module_seed seed\s*ON CONFLICT \(organization_id, module_key\) DO NOTHING;/);
});

// ---------------------------------------------------------------------
// Part 1/9 — single source of truth for org provisioning.
// ---------------------------------------------------------------------

test("organization provisioning seeds roles from the canonical ROLE_TEMPLATES, not a separate hand-maintained list", () => {
  const source = read("apps/web/src/lib/platform.ts");
  assert.match(source, /import \{ ROLE_TEMPLATES \} from "@\/lib\/access-control"/);
  assert.doesNotMatch(source, /const roleSeed = \[/, "platform.ts must not keep its own duplicate role seed list");
  assert.doesNotMatch(source, /function permissionsForRole/, "platform.ts must not keep its own duplicate permission resolver");
});

test("mobile's native-readiness flag is sourced from shared-types, not a second hardcoded module list", () => {
  const source = read("apps/mobile/src/core/modules/catalog.ts");
  assert.match(source, /NATIVE_OPERATIONAL_MODULE_KEYS/);
  assert.doesNotMatch(source, /\["crm","procurement"\]\.includes/);
});
