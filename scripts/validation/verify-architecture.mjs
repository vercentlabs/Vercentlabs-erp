#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/modules.js";
import fs from "node:fs";
import path from "node:path";

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

const required = [
  "README.md",
  "docs/01-standards/PROJECT_STRUCTURE_CONSTITUTION.md",
  "apps/web/src/app",
  "apps/web/src/core",
  "apps/web/src/modules",
  "apps/web/src/shared",
  "services/api/src/core",
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
for (const module of modules) {
  for (const item of [`apps/web/src/modules/${module}`, `services/api/src/modules/${module}`, `apps/web/src/app/(app)/${module}/layout.tsx`]) {
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
for (const file of webFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/from\s+["']@\/lib\//.test(source) || /from\s+["']@\/components\//.test(source)) {
    fail(`${path.relative(root, file)} imports a retired web alias`);
  }
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

if (failures) {
  console.error(`\n${failures} architecture failure(s).`);
  process.exit(1);
}
ok("modular ERP directory boundaries");
ok("all 12 module roots and route guards");
ok("local import resolution");
ok("public cross-module API contracts");
ok("deployment command references");
ok("active documentation paths");
