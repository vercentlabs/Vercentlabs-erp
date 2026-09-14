#!/usr/bin/env node
// Fails if the active new-frontend source (apps/web, packages/design-system,
// packages/design-tokens) contains references to any retired frontend
// generation. See docs/frontend-rebuild/README.md and
// docs/ux/UI_REWRITE_TRACKER.md. Repo-root relative by construction, so it
// gives the same result regardless of which package's script invokes it.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_DIRS = [
  "apps/web/src",
  "apps/web/tests",
  "packages/design-system/src",
  "packages/design-tokens/src",
].map((d) => path.join(repoRoot, d));
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "playwright-report", "test-results", "storybook-static"]);

const FORBIDDEN_TERMS = [
  { term: "shared-ui", reason: "packages/shared-ui was deleted; use @vercentlabs/design-tokens" },
  { term: "ui-web", reason: "packages/ui-web was deleted; use @vercentlabs/design-system" },
  { term: "Experience Kernel", reason: "the old Experience Kernel component layer was deleted" },
  { term: "experience-kernel", reason: "the old Experience Kernel component layer was deleted" },
  { term: "workspace-redesign-v3", reason: "legacy CSS generation, deleted" },
  { term: "navigation-v2", reason: "legacy CSS generation, deleted" },
  { term: "leads-next", reason: "superseded golden-reference path; canonical route is /crm/leads" },
  { term: "operator-workbench.css", reason: "legacy global ERP CSS, deleted" },
  { term: "enterprise-modules.css", reason: "legacy global ERP CSS, deleted" },
  { term: "accounting-extension.css", reason: "legacy module CSS, deleted" },
  { term: "billing-extension.css", reason: "legacy module CSS, deleted" },
  { term: "business-data-extension.css", reason: "legacy module CSS, deleted" },
  { term: "procurement-extension.css", reason: "legacy module CSS, deleted" },
  { term: "sales-extension.css", reason: "legacy module CSS, deleted" },
  { term: "@base-ui-components", reason: "Base UI was superseded by React Aria Components — see ADR-003" },
  { term: "base-ui-components", reason: "Base UI was superseded by React Aria Components — see ADR-003" },
];

// --erp-* and --v2-* were the legacy custom-property prefixes; the new
// design-tokens pipeline emits plain Tailwind v4 @theme variables instead
// (--color-*, --spacing-*, etc.) — see scripts/design/generate-tailwind-theme.mjs.
const FORBIDDEN_PATTERNS = [
  { pattern: /--erp-[a-z-]+/i, reason: "legacy --erp-* custom property prefix" },
  { pattern: /--v2-[a-z-]+/i, reason: "legacy --v2-* custom property prefix" },
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".mjs", ".mts"]);

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

const files = SCAN_DIRS.flatMap((dir) => walk(dir, []));
const failures = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(repoRoot, file);
  for (const { term, reason } of FORBIDDEN_TERMS) {
    if (content.includes(term)) failures.push(`${rel}: contains "${term}" (${reason})`);
  }
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) failures.push(`${rel}: matches ${pattern} (${reason})`);
  }
}

if (failures.length > 0) {
  console.error(`verify:no-legacy-frontend failed with ${failures.length} violation(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`verify:no-legacy-frontend passed (${files.length} files scanned across apps/web, packages/design-system, packages/design-tokens — 0 legacy references).`);
}
