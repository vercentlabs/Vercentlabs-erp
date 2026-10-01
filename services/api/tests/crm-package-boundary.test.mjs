// @vercentlabs/api/crm is the package-level CRM server contract: it resolves to
// the CRM module boundary (modules/crm/index.js + index.d.ts), its runtime and
// declared exports agree, and the package root keeps every legacy CRM name
// through modules/crm/index.js and compat/crm-root-legacy.js only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as root from "@vercentlabs/api";
import * as crmSubpath from "@vercentlabs/api/crm";
import * as crmModule from "../src/modules/crm/index.js";
import { checkApiRootCrmBoundary, API_ROOT_INDEX_FILES, CRM_ROOT_LEGACY_BARRELS } from "../../../scripts/validation/architecture-rules.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const apiSrc = path.join(repo, "services/api/src");
const snapshot = JSON.parse(fs.readFileSync(new URL("./snapshots/crm-public-api-exports.json", import.meta.url), "utf8"));
const ts = createRequire(path.join(repo, "apps/web/package.json"))("typescript");
const posix = (p) => p.split(path.sep).join("/");

function program(rootNames, host) {
  return ts.createProgram(rootNames, {
    noEmit: true,
    strict: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    types: [],
  }, host);
}

test("@vercentlabs/api/crm resolves at runtime to the CRM module boundary", () => {
  assert.deepEqual(Object.keys(crmSubpath).sort(), Object.keys(crmModule).sort());
  for (const name of Object.keys(crmModule)) assert.equal(crmSubpath[name], crmModule[name], name);
  assert.deepEqual(Object.keys(crmSubpath).sort(), [...snapshot.crmModuleIndex].sort(), "subpath names are the locked CRM module export set");
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, "services/api/package.json"), "utf8"));
  assert.deepEqual(manifest.exports["./crm"], { types: "./src/modules/crm/index.d.ts", default: "./src/modules/crm/index.js" });
});

test("the package root still exposes every CRM boundary binding and every locked legacy name", () => {
  for (const name of Object.keys(crmModule)) assert.equal(root[name], crmModule[name], name);
  const missing = snapshot.packageIndex.filter((name) => !(name in root));
  assert.deepEqual(missing, []);
});

test("CRM boundary declarations match its runtime exports one to one", () => {
  const file = posix(path.join(apiSrc, "modules/crm/index.d.ts"));
  const p = program([file]);
  const c = p.getTypeChecker();
  const values = c
    .getExportsOfModule(c.getSymbolAtLocation(p.getSourceFile(file)))
    .filter((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(symbol) : symbol;
      return Boolean(target.flags & ts.SymbolFlags.Value);
    })
    .map((symbol) => symbol.getName())
    .sort();
  assert.deepEqual(values, Object.keys(crmModule).sort(), "every runtime export is declared and every declared value exists at runtime");
});

test("representative CRM imports from @vercentlabs/api/crm type-check", () => {
  const fixture = posix(path.join(repo, "services/worker/src/__crm_subpath_fixture__.ts"));
  const source = [
    'import { createCrmCall, listCrmRecords, getCrmDashboard, listLeadStages, listCrmAccounts, CrmError } from "@vercentlabs/api/crm";',
    'import type { CrmFoundationContext, CrmCustomFieldDefinition } from "@vercentlabs/api/crm";',
    "export const commands = [createCrmCall, listCrmRecords, getCrmDashboard, listLeadStages, listCrmAccounts] as const;",
    "export const isCrmError = (value: unknown): value is CrmError => value instanceof CrmError;",
    "export type Context = CrmFoundationContext;",
    "export type FieldDefinition = CrmCustomFieldDefinition;",
    "// @ts-expect-error -- names outside the CRM contract are not on the subpath",
    'export { validateRazorpayConfig } from "@vercentlabs/api/crm";',
    "",
  ].join("\n");
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) => (posix(name) === fixture ? ts.createSourceFile(name, source, version) : getSourceFile(name, version));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => posix(name) === fixture || fileExists(name);
  const p = program([fixture], host);
  const errors = ts
    .getPreEmitDiagnostics(p)
    .filter((d) => d.file && posix(d.file.fileName) === fixture)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
  assert.deepEqual(errors, []);
  assert.ok(p.getSourceFiles().some((sf) => posix(sf.fileName).endsWith("services/api/src/modules/crm/index.d.ts")), "the subpath resolves to modules/crm/index.d.ts");
});

test("the package root reaches CRM only through the boundary and the legacy re-export barrel", () => {
  const files = [...API_ROOT_INDEX_FILES, ...CRM_ROOT_LEGACY_BARRELS].map((file) => ({ path: file, source: fs.readFileSync(path.join(repo, file), "utf8") }));
  assert.deepEqual(checkApiRootCrmBoundary(files), []);
  const legacy = fs.readFileSync(path.join(apiSrc, "compat/crm-root-legacy.js"), "utf8");
  const statements = legacy.match(/\bexport\s*(?:\*|\{[^}]*\})\s*from\s*"[^"]+";/g) ?? [];
  assert.ok(statements.length > 0);
  assert.ok(statements.every((statement) => statement.includes('"../modules/crm/')));
  // Declarations mirror the runtime barrel: no declared legacy file the runtime barrel does not re-export.
  const targets = (text) => new Set([...text.matchAll(/from\s*"(\.\.\/modules\/crm\/[^"]+)"/g)].map((m) => m[1]));
  const runtimeTargets = targets(legacy);
  const declaredTargets = targets(fs.readFileSync(path.join(apiSrc, "compat/crm-root-legacy.d.ts"), "utf8"));
  assert.deepEqual([...declaredTargets].filter((target) => !runtimeTargets.has(target)), []);
});
