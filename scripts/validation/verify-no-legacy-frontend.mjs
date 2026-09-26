#!/usr/bin/env node
// Fails if ACTIVE frontend infrastructure — source, config, scripts, or CI —
// contains a dependency/path reference to any retired frontend generation.
// See docs/frontend-rebuild/README.md and docs/ux/UI_REWRITE_TRACKER.md.
// Repo-root relative by construction, so it gives the same result
// regardless of which package's script invokes it.
//
// Deliberately NOT an indiscriminate repository-wide grep: docs/ (including
// this repo's own ADRs and the UI rewrite tracker) is explicitly allowed to
// discuss retired systems as history, and comments explaining *why* a term
// is forbidden (like the ones in this very file, or in crm-ci.yml's "do not
// resurrect the old apps/web/src/app/(app)/crm/** path" note) would
// self-trigger a naive text scan. Comments are stripped from scanned code
// before matching for exactly this reason — this scans active
// code/config/paths, not prose about them.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(SELF_PATH), "../..");

const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "playwright-report", "test-results", "storybook-static"]);

// Directories scanned recursively for source-extension files.
const SCAN_DIRS = [
  "apps/web/src",
  "apps/web/tests",
  "packages/design-system/src",
  "packages/design-tokens/src",
  "scripts/design",
  "scripts/validation",
  ".github/workflows",
].map((d) => path.join(repoRoot, d));

// Individual config files scanned directly (not directories).
const SCAN_FILES = ["package.json", "apps/web/package.json", "apps/web/tsconfig.json", "pnpm-workspace.yaml"].map((f) =>
  path.join(repoRoot, f),
);

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
  { term: "apps/web/src/app/(app)/", reason: "old route-group convention, retired with the deleted frontend" },
  { term: "apps/web/src/modules/", reason: "old per-module web convention, retired with the deleted frontend" },
];

// --erp-* and --v2-* were the legacy custom-property prefixes; the new
// design-tokens pipeline emits plain Tailwind v4 @theme variables instead
// (--color-*, --spacing-*, etc.) — see scripts/design/generate-tailwind-theme.mjs.
const FORBIDDEN_PATTERNS = [
  { pattern: /--erp-[a-z-]+/i, reason: "legacy --erp-* custom property prefix" },
  { pattern: /--v2-[a-z-]+/i, reason: "legacy --v2-* custom property prefix" },
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".mjs", ".mts", ".yml", ".yaml"]);

// Files allowed to name retired systems verbatim because they exist
// specifically to document the retirement — not active code/config.
const DOCUMENTATION_EXEMPT_FILES = new Set([path.relative(repoRoot, SELF_PATH)]);

function isExempt(relPath) {
  const posixRel = relPath.split(path.sep).join("/");
  return [...DOCUMENTATION_EXEMPT_FILES].some((exempt) => posixRel === exempt || posixRel.startsWith(`${exempt}/`));
}

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

/** Strips comments before matching, so explanatory prose about a retired
 * term (in a code comment or a YAML `#` comment) doesn't self-trigger —
 * this scans active code/config, not documentation about it. JSON files
 * have no comment syntax, so they pass through unchanged. */
function stripComments(source, ext) {
  if (ext === ".yml" || ext === ".yaml") {
    return source
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n");
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".css"].includes(ext)) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (avoid eating URLs' //)
  }
  return source;
}

const scannedFiles = [...SCAN_DIRS.flatMap((dir) => walk(dir, [])), ...SCAN_FILES.filter((f) => fs.existsSync(f))];
const failures = [];

for (const file of scannedFiles) {
  const rel = path.relative(repoRoot, file);
  if (isExempt(rel)) continue;
  const ext = path.extname(file);
  const raw = fs.readFileSync(file, "utf8");
  const content = ext === ".json" ? raw : stripComments(raw, ext);
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
  console.log(
    `verify:no-legacy-frontend passed (${scannedFiles.length} files scanned across apps/web, packages/design-system, packages/design-tokens, scripts/design, scripts/validation, .github/workflows, and root/web config — 0 legacy references).`,
  );
}
