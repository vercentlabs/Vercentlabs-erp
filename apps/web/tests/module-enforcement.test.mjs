import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const listFiles = (dir, matches = []) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(rel, matches);
    else if (entry.name === "route.ts") matches.push(rel);
  }
  return matches;
};

// ---------------------------------------------------------------------
// Core primitive: apps/web/src/core/module-access.ts's server-boundary
// guards (Prompt 5 additions on top of Prompt 4's resolveModuleAccess).
// ---------------------------------------------------------------------

test("module-access: assertModuleAccessible fails closed — throws on any non-accessible result, never swallows", () => {
  const source = read("apps/web/src/core/module-access.ts");
  assert.match(
    source,
    /export async function assertModuleAccessible[\s\S]*?if \(access\.accessible\) return;[\s\S]*?throw new HttpError/,
    "assertModuleAccessible must return early only on accessible=true and otherwise unconditionally throw",
  );
});

test("module-access: every ModuleAccessReason maps to a distinct machine-readable code", () => {
  const source = read("apps/web/src/core/module-access.ts");
  for (const [reason, code] of [
    ["not_released", "MODULE_NOT_AVAILABLE"],
    ["disabled", "MODULE_DISABLED"],
    ["not_entitled", "MODULE_NOT_ENTITLED"],
    ["not_permitted", "MODULE_NOT_PERMITTED"],
  ]) {
    assert.match(
      source,
      new RegExp(`${reason}:\\s*"${code}"`),
      `REASON_CODES is missing ${reason} -> ${code}`,
    );
  }
});

test("module-access: requireModuleWorkspace composes requireApiWorkspace + assertModuleAccessible (no bespoke session logic)", () => {
  const source = read("apps/web/src/core/module-access.ts");
  assert.match(
    source,
    /export async function requireModuleWorkspace[\s\S]*?requireApiWorkspace\(\)[\s\S]*?assertModuleAccessible\(session, moduleId\)/,
  );
});

test("http: HttpError carries an optional machine-readable code, and errorResponse surfaces it without touching any of the 279 route catch blocks", () => {
  const httpSource = read("apps/web/src/core/http.ts");
  assert.match(httpSource, /public readonly code\?:\s*string/);
  assert.match(httpSource, /export function errorResponse[\s\S]*?failWithCode\(error\)/);
  // Integrity closeout (Prompts 1-5): failWithCode was widened to also merge
  // an optional HttpError.details payload (e.g. CRM_OPPORTUNITY_STAGE_EXIT_
  // BLOCKED's structured missingRequirements list) into the response body
  // alongside code — the code-forwarding contract itself is unchanged.
  assert.match(httpSource, /public readonly details\?: Record<string, unknown>/);
  assert.match(
    httpSource,
    /export function failWithCode[\s\S]*?error\.code \|\| error\.details/,
  );
});

// ---------------------------------------------------------------------
// Group A — accounting, procurement, stock, sales: the four modules with
// a pre-existing shared *Session() route-context builder. One check per
// file gates every route under that module.
// ---------------------------------------------------------------------

const groupA = [
  ["apps/web/src/modules/accounting/server.ts", "accounting"],
  ["apps/web/src/modules/procurement/server.ts", "procurement"],
  ["apps/web/src/modules/stock/server.ts", "stock"],
  ["apps/web/src/modules/sales/server.ts", "sales"],
];

for (const [file, moduleId] of groupA) {
  test(`group A: ${file} gates its module's *Session() helper with assertModuleAccessible("${moduleId}")`, () => {
    const source = read(file);
    assert.match(source, /import \{ assertModuleAccessible \} from "@\/core\/module-access";/);
    assert.match(
      source,
      new RegExp(`assertModuleAccessible\\(session as WorkspaceSessionContext,\\s*"${moduleId}"\\)`),
    );
  });
}

// ---------------------------------------------------------------------
// Group C — manufacturing, projects, assets, point-of-sale, quality,
// support, hr-payroll: no pre-existing *-route.ts helper, so every route
// file was migrated from requireApiWorkspace() to requireModuleWorkspace
// (moduleId). Verify zero stragglers and full coverage per module.
// ---------------------------------------------------------------------

const groupC = [
  ["apps/web/src/app/api/manufacturing", "manufacturing", 6],
  ["apps/web/src/app/api/projects", "projects", 4],
  ["apps/web/src/app/api/assets", "assets", 3],
  ["apps/web/src/app/api/point-of-sale", "point-of-sale", 6],
  ["apps/web/src/app/api/quality", "quality", 4],
  ["apps/web/src/app/api/support", "support", 4],
  ["apps/web/src/app/api/hr-payroll", "hr-payroll", 4],
];

for (const [dir, moduleId, expectedFileCount] of groupC) {
  test(`group C: every route.ts under ${dir} uses requireModuleWorkspace("${moduleId}"), none use bare requireApiWorkspace`, () => {
    const files = listFiles(dir);
    assert.equal(files.length, expectedFileCount, `expected ${expectedFileCount} route.ts files under ${dir}`);
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /requireApiWorkspace/,
        `${file} still calls the module-agnostic requireApiWorkspace() directly`,
      );
      assert.match(
        source,
        new RegExp(`requireModuleWorkspace\\("${moduleId}"\\)`),
        `${file} does not call requireModuleWorkspace("${moduleId}")`,
      );
      assert.match(
        source,
        /try \{[\s\S]*\} catch \(error\) \{\s*return errorResponse\(error\);\s*\}/,
        `${file} does not wrap its handler(s) in try/catch + errorResponse — a denial would surface as a bare 500`,
      );
    }
  });
}

// ---------------------------------------------------------------------
// CRM — entitlement is centralized in the capability-owned request context.
// The root CRM module is intentionally only a stable re-export boundary.
// ---------------------------------------------------------------------

test("crm: capability request context wraps crmContext with assertModuleAccessible(\"crm\")", () => {
  const source = read("apps/web/src/modules/crm/crm-data-operations-and-customization/request-context.ts");
  assert.match(source, /export function crmContext\(session: SessionContext\): CrmContext/);
  assert.match(source, /export async function crmApiContext\(/);
  assert.match(
    source,
    /await assertModuleAccessible\(session as WorkspaceSessionContext, "crm"\)/,
  );
  assert.match(source, /return crmContext\(session\)/);
});

test("crm: no API route under apps/web/src/app/api/crm or api/mobile/v1/**crm** calls the unguarded sync crmContext()", () => {
  const dirs = ["apps/web/src/app/api/crm", "apps/web/src/app/api/mobile/v1"];
  let checked = 0;
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      const source = read(file);
      if (!/crmApiContext|crmContext/.test(source)) continue;
      checked += 1;
      assert.doesNotMatch(
        source,
        /[^.\w]crmContext\(/,
        `${file} calls the unguarded sync crmContext() instead of crmApiContext()`,
      );
    }
  }
  assert.ok(checked >= 70, `expected to check the retained CRM API surface, only checked ${checked}`);
});

test("crm: the approval-command registry's CRM mutations (opportunity stage change, activity completion) are module-gated too", () => {
  const source = read("apps/web/src/orchestration/approvals.ts");
  assert.doesNotMatch(source, /[^.\w]crmContext\(/, "approval-commands.ts must not call the unguarded crmContext()");
  const crmExecuteCount = (source.match(/await crmApiContext\(session\)/g) ?? []).length;
  assert.equal(crmExecuteCount, 2, "expected both CRM approval commands (opportunity.stage_change, activity.complete) to use crmApiContext");
});

test("crm: server-rendered CRM pages use the entitlement-gated crmApiContext", () => {
  const pagesDir = path.join(root, "apps/web/src/app/(app)/crm");
  const pageFiles = fs.readdirSync(pagesDir, { recursive: true }).filter((f) => String(f).endsWith("page.tsx"));
  assert.ok(pageFiles.length > 0, "expected CRM page.tsx files to exist");
  let gated = 0;
  for (const relative of pageFiles) {
    const source = fs.readFileSync(path.join(pagesDir, String(relative)), "utf8");
    assert.doesNotMatch(source, /[^.\w]crmContext\(session\)/, String(relative) + " must not use un-gated crmContext(session)");
    if (/crmApiContext\(session\)/.test(source)) {
      gated += 1;
      assert.match(source, /await crmApiContext\(session\)/, String(relative) + " must await the entitlement gate");
    }
  }
  assert.ok(gated >= 8, "expected the CRM server pages with data access to use crmApiContext");
});

// ---------------------------------------------------------------------
// Direct-bypass coverage: the modules Prompt 5 explicitly calls out
// (CRM, Accounting, Procurement, Manufacturing, HR & Payroll) must have
// their write-path (POST/PATCH) routes covered, not just GET/dashboard.
// ---------------------------------------------------------------------

test("bypass coverage: accounting write routes cannot reach services/api without accountingSession()'s module gate", () => {
  const files = listFiles("apps/web/src/app/api/accounting");
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = read(file);
    if (!/accountingSession\(/.test(source)) continue;
    assert.doesNotMatch(source, /getSessionContext\(\)[\s\S]{0,120}accountingContext\(/, `${file} appears to bypass accountingSession() and build accountingContext() from a raw session`);
  }
});

test("bypass coverage: procurement, manufacturing, hr-payroll write routes all resolve through a module-gated session helper", () => {
  const cases = [
    ["apps/web/src/app/api/procurement", /procurementSession\(/],
    ["apps/web/src/app/api/manufacturing", /requireModuleWorkspace\("manufacturing"\)/],
    ["apps/web/src/app/api/hr-payroll", /requireModuleWorkspace\("hr-payroll"\)/],
  ];
  for (const [dir, pattern] of cases) {
    const files = listFiles(dir);
    assert.ok(files.length > 0, `expected route.ts files under ${dir}`);
    for (const file of files) {
      assert.match(read(file), pattern, `${file} does not use the module-gated session helper for its module`);
    }
  }
});

// ---------------------------------------------------------------------
// Admin/system exceptions must remain correctly un-gated by their own
// target module (Part 6): the module enable/disable route must not
// require the module it is about to enable to already be enabled.
// ---------------------------------------------------------------------

test("admin exception: the module enable/disable route is gated by modules.manage permission, not by resolveModuleAccess against its own target module", () => {
  const source = read("apps/web/src/app/api/modules/[key]/route.ts");
  assert.match(source, /requireApiPermission\("modules\.manage"\)/);
  assert.doesNotMatch(source, /resolveModuleAccess|assertModuleAccessible|requireModuleWorkspace|canUserAccessModule/);
});

test("public exception: known unauthenticated CRM endpoints (lead capture, webhooks, booking, chat) remain session-less and untouched by the module gate", () => {
  const publicFiles = [
    "apps/web/src/app/api/crm/public/capture/[key]/route.ts",
    "apps/web/src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts",
    "apps/web/src/app/api/crm/lead-acquisition/webhooks/[provider]/route.ts",
    "apps/web/src/app/api/crm/communications/webhooks/[provider]/route.ts",
  ];
  for (const file of publicFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /assertModuleAccessible|requireModuleWorkspace|crmApiContext/,
      `${file} is a public/system endpoint and must not depend on a user-session module gate`,
    );
  }
});

// ---------------------------------------------------------------------
// Entitlement-transition semantics inherited from Prompt 4's resolver:
// module-access.ts is the sole authority; Prompt 5 does not duplicate
// entitlement logic anywhere it wires the guard in.
// ---------------------------------------------------------------------

test("entitlement transition: no Group A/C/CRM call site re-implements entitlement or enablement logic — resolveModuleAccess stays the single source of truth", () => {
  const dirs = [
    "apps/web/src/app/api/manufacturing",
    "apps/web/src/app/api/hr-payroll",
    "apps/web/src/app/api/point-of-sale",
  ];
  for (const dir of dirs) {
    for (const file of listFiles(dir)) {
      const source = read(file);
      assert.doesNotMatch(source, /organization_modules/, `${file} must not query organization_modules directly`);
      assert.doesNotMatch(source, /getBillingSummary/, `${file} must not call getBillingSummary directly`);
    }
  }
});
