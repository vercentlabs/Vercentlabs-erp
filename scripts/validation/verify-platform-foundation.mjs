#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/modules.js";

const root = process.cwd();
let failures = 0;

const fail = (message) => {
  failures += 1;
  console.error(`FAIL  ${message}`);
};
const ok = (message) => console.log(`OK    ${message}`);

const moduleKeys = ERP_MODULE_CATALOG.map((module) => module.key);
const boundaryDebt = JSON.parse(
  fs.readFileSync(
    path.join(root, "scripts/validation/module-boundary-debt.json"),
    "utf8",
  ),
);
const allowedImportDebt = new Set(
  (boundaryDebt.imports || []).map(({ path: filePath, specifier }) =>
    JSON.stringify({ path: filePath, specifier }),
  ),
);

function reportImportDebt(file, specifier, message) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const encoded = JSON.stringify({ path: relative, specifier });
  if (!allowedImportDebt.has(encoded)) fail(`${relative}: ${message} ${specifier}`);
}

const expectedModules = [
  "accounting",
  "procurement",
  "sales",
  "crm",
  "stock",
  "manufacturing",
  "projects",
  "assets",
  "point-of-sale",
  "quality",
  "support",
  "hr-payroll",
].sort();

if (
  JSON.stringify([...moduleKeys].sort()) !== JSON.stringify(expectedModules)
) {
  fail("ERP_MODULE_CATALOG must contain exactly the permanent 12 ERP modules.");
} else {
  ok("canonical 12-module catalogue");
}

// apps/web/src/{core,modules} and the core/*.ts security modules below were
// required here against the old frontend architecture (deleted wholesale
// in the clean-slate rebuild — see docs/frontend-rebuild/README.md; the
// real logic that lived in the *.ts files was recovered, not lost, into
// the recovered pre-rebuild snapshot (last present at commit d4df5eb1),  pending a real port). The
// new apps/web uses src/{app,features,shell,platform,shared,server} per
// the rebuild brief; re-add the real equivalents once they exist rather
// than guessing the convention now.
const required = [
  "apps/web/src/app",
  "apps/web/src/shared",

  "services/api/src/core",
  "services/api/src/modules",
  "services/api/src/orchestration",

  "services/worker/bin/start.mjs",
  "services/worker/src/queue.js",
  "services/worker/src/registry.js",
  "services/worker/src/worker.js",
  "services/worker/src/ssrf.js",
  "services/worker/src/webhook-delivery.js",

  "packages/config",
  "packages/database",
  "packages/permissions",
  "packages/workflows",
  "packages/reporting-engine",
  "packages/document-engine",
  "packages/observability",
  "packages/localization",
  "packages/shared-types",
  "packages/design-tokens",
  "packages/shared-sdk",

  "database/platform/migrations",
  "database/tenant/migrations",

  "scripts/database/migrate.mjs",
  "scripts/database/provision-runtime-role.mjs",
  "scripts/validation/module-boundary-debt.json",
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) {
    fail(`required platform path missing: ${relative}`);
  }
}

const forbidden = [
  "apps/web/src/lib",
  "apps/web/src/components",
  "database/control-plane",
  "packages/erp-registry",
];

for (const relative of forbidden) {
  if (fs.existsSync(path.join(root, relative))) {
    fail(`retired architecture path remains: ${relative}`);
  }
}

// Web-side per-module root deferred for the same reason as `required`
// above; services/api's is real and unaffected.
for (const moduleKey of moduleKeys) {
  for (const relative of [`services/api/src/modules/${moduleKey}`]) {
    if (!fs.existsSync(path.join(root, relative))) {
      fail(`module root missing: ${relative}`);
    }
  }
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(target));
    else result.push(target);
  }
  return result;
}

function importSpecifiers(source) {
  const result = [];
  const pattern =
    /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) result.push(match[1]);
  return result;
}

for (const file of walk(path.join(root, "apps/web/src/shared")).filter((file) =>
  /\.(ts|tsx|js|mjs)$/.test(file),
)) {
  const source = fs.readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (
      specifier.startsWith("@/core/") ||
      specifier.startsWith("@/modules/")
    ) {
      reportImportDebt(file, specifier, "shared code may not import");
    }
  }
}

for (const file of walk(path.join(root, "apps/web/src/core")).filter((file) =>
  /\.(ts|tsx|js|mjs)$/.test(file),
)) {
  const source = fs.readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith("@/modules/")) {
      reportImportDebt(file, specifier, "core may not import business module");
    }
  }
}

for (const relative of [
  "scripts/database/migrate.mjs",
  "scripts/database/provision-runtime-role.mjs",
]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  if (
    source.includes("apps/web/package.json") ||
    source.includes("createRequire(")
  ) {
    fail(`${relative}: database tooling still resolves dependencies via apps/web`);
  }
  if (!source.includes('from "pg"')) {
    fail(`${relative}: pg must be imported directly from root tooling dependencies`);
  }
}

for (const relative of [
  "packages/permissions/src/index.js",
  "packages/permissions/src/index.d.ts",
]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  if (source.includes("buildPermissionKey")) {
    fail(`${relative}: obsolete tenant:resource:action permission helper remains`);
  }
}

const observability = fs.readFileSync(
  path.join(root, "packages/observability/src/index.js"),
  "utf8",
);
for (const requiredExport of [
  "createLogger",
  "createMetricRegistry",
  "withSpan",
  "normalizeError",
  "reportError",
]) {
  if (!observability.includes(requiredExport)) {
    fail(`observability does not export ${requiredExport}`);
  }
}

const prefixes = new Map([
  ["crm", "crm_"],
  ["sales", "sales_"],
  ["procurement", "procurement_"],
  ["stock", "stock_"],
  ["manufacturing", "manufacturing_"],
  ["quality", "quality_"],
  ["projects", "projects_"],
  ["assets", "assets_"],
  ["point-of-sale", "pos_"],
  ["support", "support_"],
  ["hr-payroll", "hr_"],
  ["accounting", "accounting_"],
]);

function ownerOfTable(table) {
  for (const [moduleKey, prefix] of prefixes) {
    if (table.startsWith(prefix)) return moduleKey;
  }
  return null;
}

const dmlPattern =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+tenant\.([a-zA-Z0-9_]+)/gi;

const currentDebt = [];

for (const moduleKey of moduleKeys) {
  const directory = path.join(root, "services/api/src/modules", moduleKey);

  for (const file of walk(directory).filter((entry) => entry.endsWith(".js"))) {
    const source = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(dmlPattern)) {
      const operation = match[1].replace(/\s+/g, " ").toUpperCase();
      const table = match[2];
      const owner = ownerOfTable(table);

      if (owner && owner !== moduleKey) {
        currentDebt.push({
          sourceModule: moduleKey,
          ownerModule: owner,
          path: path.relative(root, file).split(path.sep).join("/"),
          operation,
          table: `tenant.${table}`,
        });
      }
    }
  }
}

const encode = (item) =>
  JSON.stringify({
    sourceModule: item.sourceModule,
    ownerModule: item.ownerModule,
    path: item.path,
    operation: item.operation,
    table: item.table,
  });

const baseline = boundaryDebt.entries;

const allowed = new Set(baseline.map(encode));

for (const item of currentDebt) {
  const encoded = encode(item);
  if (!allowed.has(encoded)) {
    fail(`new cross-module DML introduced after platform freeze: ${encoded}`);
  }
}

if (!failures) {
  ok("platform directory boundaries");
  ok("database tooling independence");
  ok("permission convention");
  ok("observability primitives");
  ok("no new platform-boundary imports or cross-module DML");
  console.log("\nPlatform foundation verification passed.");
  process.exit(0);
}

console.error(`\n${failures} platform foundation failure(s).`);
process.exit(1);
