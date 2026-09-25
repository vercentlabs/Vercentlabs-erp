#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/modules.js";
import fs from "node:fs";
import path from "node:path";

import { checkApiCoreLayout, checkCrossFeatureImports, checkWebRetiredAliases, checkWebTopLevel } from "./architecture-rules.mjs";

const root = process.cwd();
const modules = ERP_MODULE_CATALOG.map((module) => module.key);
const trackedPaths = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
let failures = 0;
const fail = (message) => { failures += 1; console.error(`FAIL  ${message}`); };
const ok = (message) => console.log(`OK    ${message}`);

// Canonical structure: docs/01-standards/PROJECT_STRUCTURE_CONSTITUTION.md
// and SHARED_PLATFORM_ARCHITECTURE.md. apps/web/src is exactly
// {app, core, features, shell, shared}; business modules live in
// apps/web/src/features/<module> (NOT apps/web/src/modules).
const required = [
  "README.md",
  "docs/01-standards/PROJECT_STRUCTURE_CONSTITUTION.md",
  "apps/web/src/app",
  "apps/web/src/core",
  "apps/web/src/features",
  "apps/web/src/features/settings",
  "apps/web/src/shell",
  "apps/web/src/shared",
  "docs/01-standards/SHARED_PLATFORM_ARCHITECTURE.md",
  "services/api/src/core",
  "services/api/src/core/access/index.js",
  "services/api/src/modules",
  "services/api/src/orchestration",
  "database/platform/migrations",
  "database/tenant/migrations",
  "packages/shared-types/src/modules.js",
  "packages/permissions",
  "scripts/database/migrate.mjs",
  "scripts/database/provision-runtime-role.mjs",
];
const forbidden = [
  "apps/web/src/lib",
  "apps/web/src/components",
  "apps/web/src/modules",
  "scripts/validation/verify-web-boundaries.mjs",
  "database/control-plane",
  "packages/erp-registry",
  "scripts/validation/.generated",
  "vercentlabs-full-code.txt",
  ...modules.map((m) => `services/api/src/${m}`),
];
for (const item of required) if (!fs.existsSync(path.join(root, item))) fail(`missing required path: ${item}`);
for (const item of forbidden) {
  if (
    trackedPaths.some(
      (trackedPath) => trackedPath === item || trackedPath.startsWith(`${item}/`),
    )
  ) {
    fail(`retired path remains: ${item}`);
  }
}
// Frontend top level and retired aliases; backend core domain layout.
for (const problem of checkWebTopLevel(fs.readdirSync(path.join(root, "apps/web/src")))) fail(problem);
for (const problem of checkApiCoreLayout(
  fs.readdirSync(path.join(root, "services/api/src/core"), { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })),
)) fail(problem);
for (const module of modules) {
  for (const item of [`services/api/src/modules/${module}`]) {
    if (!fs.existsSync(path.join(root, item))) fail(`module boundary missing: ${item}`);
  }
}

function walk(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full, extensions));
    else if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) output.push(full);
  }
  return output;
}

const importPattern = /(?:from\s*|import\s*\(\s*|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*)["']([^"']+)["']/g;
const sourceExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const resolutionExtensions = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css"];

function resolveLocal(file, specifier) {
  let base;
  if (specifier.startsWith("@/") && file.startsWith(path.join(root, "apps/web/src"))) {
    base = path.join(root, "apps/web/src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(file), specifier);
  } else {
    return null;
  }
  const candidates = [];
  for (const ext of resolutionExtensions) candidates.push(base + ext);
  for (const ext of resolutionExtensions.slice(1)) candidates.push(path.join(base, "index" + ext));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || false;
}

const webFiles = walk(path.join(root, "apps/web/src"), [".ts", ".tsx"]);
const webRecords = webFiles.map((file) => ({ path: path.relative(root, file).split(path.sep).join("/"), source: fs.readFileSync(file, "utf8") }));
for (const problem of checkWebRetiredAliases(webRecords)) fail(problem);
for (const problem of checkCrossFeatureImports(webRecords)) fail(problem);
for (const file of webFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const resolved = resolveLocal(file, match[1]);
    if (resolved === false) fail(`${path.relative(root, file)} has unresolved local import: ${match[1]}`);
  }
}

for (const base of ["services/api/src", "services/worker/src"]) {
  for (const file of walk(path.join(root, base), [".js", ".mjs"])) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveLocal(file, match[1]);
      if (resolved === false) fail(`${path.relative(root, file)} has unresolved local import: ${match[1]}`);
    }
  }
}

const apiModuleRoot = path.join(root, "services/api/src/modules");
for (const module of modules) {
  const moduleRoot = path.join(apiModuleRoot, module);
  for (const file of walk(moduleRoot, [".js", ".mjs"])) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      if (!match[1].startsWith(".")) continue;
      const resolved = resolveLocal(file, match[1]);
      if (!resolved || !resolved.startsWith(apiModuleRoot)) continue;
      const relative = path.relative(apiModuleRoot, resolved).split(path.sep);
      const targetModule = relative[0];
      if (!modules.includes(targetModule) || targetModule === module) continue;
      const publicIndex = path.join(apiModuleRoot, targetModule, "index.js");
      if (path.normalize(resolved) !== path.normalize(publicIndex)) {
        fail(`${path.relative(root, file)} imports private ${targetModule} implementation: ${match[1]}`);
      }
    }
  }
}

const deadCommands = [
  "scripts/process-crm-jobs.mjs",
  "scripts/deliver-crm-outbox.mjs",
  "scripts/reconcile-razorpay-billing.mjs",
  "scripts/retry-razorpay-webhooks.mjs",
];
for (const file of walk(path.join(root, "infrastructure"), [".yml", ".yaml", "Dockerfile", ".web", ".worker", ".migration"])) {
  const source = fs.readFileSync(file, "utf8");
  for (const command of deadCommands) if (source.includes(command)) fail(`${path.relative(root, file)} references nonexistent ${command}`);
  if (source.includes("db:migrate:control")) fail(`${path.relative(root, file)} uses retired db:migrate:control`);
}

const activeDocs = ["README.md", "apps/web/README.md"];
for (const doc of activeDocs) {
  const full = path.join(root, doc);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, "utf8");
  if (/db:migrate:control|report:419|verify:419|four business modules/i.test(source)) fail(`${doc} contains retired program/setup language`);
}

// --- CRM vNext: frozen eight-capability source architecture -------------
// CRM is now fully migrated. The only permitted top-level files are the
// stable public module boundaries; every implementation file must live in
// exactly one of the eight capability directories below. This is a hard
// invariant rather than a debt counter.
const CRM_CAPABILITY_DIRECTORIES = Object.freeze([
  "prospect-and-relationship-master-data",
  "lead-lifecycle-qualification-and-prioritization",
  "opportunity-and-pipeline-governance",
  "seller-activity-and-follow-up-workspace",
  "sales-organization-and-coverage",
  "crm-data-operations-and-customization",
  "crm-conversion-and-sales-handoff",
  "pipeline-analytics-and-forecasting",
]);
const CRM_WEB_PUBLIC_BOUNDARY = Object.freeze(["index.ts"]);
const CRM_API_PUBLIC_BOUNDARY = Object.freeze(["index.js", "index.d.ts"]);

function checkCrmCapabilityArchitecture(crmRoot, publicBoundary, label, additionalTopLevelDirectories = []) {
  if (!fs.existsSync(crmRoot)) {
    fail(`CRM capability architecture: missing module root ${path.relative(root, crmRoot)}`);
    return;
  }
  for (const capability of CRM_CAPABILITY_DIRECTORIES) {
    const target = path.join(crmRoot, capability);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      fail(`CRM capability architecture: missing frozen capability directory ${path.relative(root, target)}`);
    }
  }
  const allowed = new Set([...CRM_CAPABILITY_DIRECTORIES, ...additionalTopLevelDirectories, ...publicBoundary]);
  const entries = fs.readdirSync(crmRoot, { withFileTypes: true });
  let capabilityFileCount = 0;
  for (const entry of entries) {
    if (!allowed.has(entry.name)) {
      fail(
        `CRM capability architecture: legacy/ad-hoc top-level entry ${path.relative(root, path.join(crmRoot, entry.name))} is forbidden after the CRM v2 migration`,
      );
      continue;
    }
    if (CRM_CAPABILITY_DIRECTORIES.includes(entry.name)) {
      capabilityFileCount += walk(path.join(crmRoot, entry.name)).length;
    }
  }
  for (const boundaryFile of publicBoundary) {
    const target = path.join(crmRoot, boundaryFile);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      fail(`CRM capability architecture: missing public boundary ${path.relative(root, target)}`);
    }
  }
  ok(`${label} CRM capability architecture (0 legacy files; ${capabilityFileCount} capability-owned files)`);
}

// Backend CRM capability architecture (the web CRM feature follows the
// features/crm convention and is checked by the frontend rules above).
checkCrmCapabilityArchitecture(
  path.join(root, "services/api/src/modules/crm"),
  CRM_API_PUBLIC_BOUNDARY,
  "api",
);

if (failures) {
  console.error(`\n${failures} architecture failure(s).`);
  process.exit(1);
}
ok("modular ERP directory boundaries");
ok("frontend structure: apps/web/src/{app,core,features,shell,shared}");
ok("backend core domains: services/api/src/core/{access,auth,organization,billing,platform,security}");
ok("cross-feature imports go through public feature boundaries");
ok("all 12 backend module roots (services/api)");
ok("local import resolution");
ok("public cross-module API contracts");
ok("deployment command references");
ok("active documentation paths");
