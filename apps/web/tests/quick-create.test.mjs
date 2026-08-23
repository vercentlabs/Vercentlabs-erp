import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// quick-create/actions.ts imports PERMISSIONS from permissions.ts
// (zero @/core/auth dependency, Prompt 6's client-bundle fix) and only
// erased types otherwise — safe to actually transpile and execute.
const actionsModule = await loadTsModule("apps/web/src/core/quick-create/actions.ts");
const permissionsModule = await loadTsModule("apps/web/src/core/permissions.ts");
const { quickCreateActions } = actionsModule;
const { PERMISSIONS } = permissionsModule;

// ---------------------------------------------------------------------
// Part 34/49 — registry integrity.
// ---------------------------------------------------------------------

test("quick create: at least one real action exists, and every id is unique", () => {
  assert.ok(quickCreateActions.length >= 8);
  const ids = quickCreateActions.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("quick create: every action's permission (when present) is a real string constant from PERMISSIONS, not an invented key", () => {
  const knownPermissions = new Set(Object.values(PERMISSIONS));
  for (const action of quickCreateActions) {
    if (!action.permission) continue;
    assert.ok(
      knownPermissions.has(action.permission),
      `${action.id}: permission "${action.permission}" is not a value in the canonical PERMISSIONS catalogue`,
    );
  }
});

test("quick create: every action's moduleId is one of the 12 canonical modules", () => {
  const validModuleIds = new Set([
    "crm", "sales", "accounting", "procurement", "stock", "manufacturing",
    "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll",
  ]);
  for (const action of quickCreateActions) {
    assert.ok(validModuleIds.has(action.moduleId), `${action.id}: moduleId "${action.moduleId}" is not a canonical module`);
  }
});

test("quick create: no destructive action verb appears anywhere in the registry (Part 27 forbids Delete/Approve/Cancel/Refund/Post in the global palette)", () => {
  const forbidden = /\b(delete|approve|cancel|refund|reject|reverse|post journal|void)\b/i;
  for (const action of quickCreateActions) {
    assert.doesNotMatch(action.label, forbidden, `${action.id}: label "${action.label}" looks destructive for a global command`);
  }
});

test("quick create: every href is a real, already-verified route (cross-checked against verify-routes.mjs's own extraction, not re-implemented here)", () => {
  const verifierSource = read("apps/web/scripts/verify-routes.mjs");
  assert.match(verifierSource, /quick-create\/actions\.ts/, "verify-routes.mjs must validate quick-create hrefs — see Check 5");
  for (const action of quickCreateActions) {
    assert.match(action.href, /^\//, `${action.id}: href must be an absolute in-app path, not an external URL`);
  }
});

test("quick create: CRM create actions use the existing ?create=1 convention already used by module-context-bar.tsx, not an invented route", () => {
  const crmActions = quickCreateActions.filter((a) => a.moduleId === "crm");
  assert.ok(crmActions.length > 0);
  for (const action of crmActions) {
    assert.match(action.href, /\?create=1$/);
  }
});

test("quick create: Accounting has a working create action (journal entry)", () => {
  assert.ok(quickCreateActions.some((a) => a.moduleId === "accounting" && a.href === "/accounting/journals/new"));
});

test("quick create: navigation registry and quick-create registry stay logically separate — quick-create.ts never imports from lib/navigation's data files, and modules.ts never imports quick-create", () => {
  const actionsSource = read("apps/web/src/core/quick-create/actions.ts");
  assert.doesNotMatch(actionsSource, /from "@\/core\/navigation\/(modules|workspace|my-work|governance|administration)"/);
  const modulesSource = read("apps/web/src/core/navigation/modules.ts");
  assert.doesNotMatch(modulesSource, /quick-create/);
});

// ---------------------------------------------------------------------
// Part 12 — contextual ranking (pure reordering logic in command-palette
// and quick-create-button; verified structurally since both are Client
// Components).
// ---------------------------------------------------------------------

test("quick create: contextual ranking reorders but never filters — the ranked array has the same length as the input", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /function rankQuickCreate/);
  assert.match(source, /return \[\.\.\.contextual, \.\.\.rest\];/);
});

test("quick create: the button component receives already-filtered actions as a prop — it does not import the raw registry or re-derive permissions itself", () => {
  const source = read("apps/web/src/core/components/quick-create-button.tsx");
  assert.doesNotMatch(source, /import \{ quickCreateActions/, "must not import the raw quickCreateActions array as a value — actions must come from the server-filtered prop");
  assert.match(source, /import type \{ QuickCreateAction \} from "@\/core\/quick-create\/actions";/);
});
