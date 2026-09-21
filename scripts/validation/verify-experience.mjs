#!/usr/bin/env node
// Design-system convergence check for the clean-slate frontend.
//
// This is a rewrite, not the original script: the pre-rebuild version
// enforced convergence toward a specific "Experience Kernel" component set
// (apps/web/src/shared/design/*.tsx, --erp-* tokens) with a baseline
// debt-ratchet mechanism calibrated to ~9,000 lines of legacy CSS. Both the
// Experience Kernel and that legacy CSS were deleted wholesale in the
// clean-slate rebuild (see docs/frontend-rebuild/README.md) — there is no
// more grandfathered debt to ratchet down, so that machinery is gone too.
// What's rewritten and kept is the actual invariant that mattered: no
// hardcoded color literals outside the generated token file, and no raw
// <table> elements outside the canonical EnterpriseDataGrid.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COLOR_LITERAL_PATTERN =
  /(?<![\w-])(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))(?![\w-])/g;
export const RAW_TABLE_PATTERN = /<table(?:\s|>)/g;

/** Number of hardcoded color literals in a CSS source string. */
export function countColorLiterals(source) {
  return [...source.matchAll(COLOR_LITERAL_PATTERN)].length;
}

/** Number of raw <table> elements in a TSX/JSX source string. */
export function countRawTables(source) {
  return [...source.matchAll(RAW_TABLE_PATTERN)].length;
}

function walk(dir, predicate, acc = [], skipDirNames) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirNames.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, acc, skipDirNames);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

function posix(p) {
  return p.split(path.sep).join("/");
}

/**
 * Runs the convergence checks against a given repo root. Kept separate from
 * process.exit/console so it's directly unit-testable against a fixture
 * root, not just runnable as a CLI.
 */
export function checkDesignSystemConvergence(root) {
  const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "storybook-static", "playwright-report", "test-results"]);
  const CSS_SCAN_DIRS = ["apps/web/src"];
  const TSX_SCAN_DIRS = ["apps/web/src", "packages/design-system/src"];
  // Files allowed to contain raw hex/rgb/hsl literals because they ARE the
  // token source or are mechanically generated from it.
  const COLOR_LITERAL_EXEMPT_FILES = new Set([
    "packages/design-tokens/tokens/theme.json",
    "apps/web/src/app/tokens.css",
  ]);
  // The places a real <table> element is expected: the grid primitive, and the design system's own Table primitive that
  // owns the markup of small static tables. Screens use one of those two and never write the element themselves.
  const RAW_TABLE_EXEMPT_FILES = new Set([
    "packages/design-system/src/enterprise/data-grid/EnterpriseDataGrid.tsx",
    "packages/design-system/src/data-display/Table.tsx",
  ]);

  const failures = [];

  const cssFiles = CSS_SCAN_DIRS.flatMap((dir) => walk(path.join(root, dir), (f) => f.endsWith(".css"), [], SKIP_DIR_NAMES));
  for (const file of cssFiles) {
    const rel = posix(path.relative(root, file));
    if (COLOR_LITERAL_EXEMPT_FILES.has(rel)) continue;
    const count = countColorLiterals(fs.readFileSync(file, "utf8"));
    if (count > 0) {
      failures.push(`${rel}: ${count} hard-coded color literal(s); consume packages/design-tokens via a Tailwind utility or var(--color-*) instead`);
    }
  }

  const tsxFiles = TSX_SCAN_DIRS.flatMap((dir) => walk(path.join(root, dir), (f) => f.endsWith(".tsx") || f.endsWith(".jsx"), [], SKIP_DIR_NAMES));
  for (const file of tsxFiles) {
    const rel = posix(path.relative(root, file));
    if (RAW_TABLE_EXEMPT_FILES.has(rel)) continue;
    const count = countRawTables(fs.readFileSync(file, "utf8"));
    if (count > 0) {
      failures.push(`${rel}: ${count} raw <table> element(s); use packages/design-system's EnterpriseDataGrid (interactive lists) or Table (small static tables) instead`);
    }
  }

  const globalsCssPath = path.join(root, "apps/web/src/app/globals.css");
  if (fs.existsSync(globalsCssPath)) {
    const globals = fs.readFileSync(globalsCssPath, "utf8");
    if (!/@import\s+["']\.\/tokens\.css["']/.test(globals)) {
      failures.push('apps/web/src/app/globals.css: must @import "./tokens.css" (the generated design-tokens theme)');
    }
  }

  return { failures, cssFileCount: cssFiles.length, tsxFileCount: tsxFiles.length };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../..");
  const { failures, cssFileCount, tsxFileCount } = checkDesignSystemConvergence(root);

  if (failures.length) {
    console.error("\nDESIGN-SYSTEM CONVERGENCE VIOLATIONS\n");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`\n${failures.length} violation(s) detected.`);
    process.exit(1);
  }

  console.log("DESIGN-SYSTEM CONVERGENCE VALIDATION PASSED");
  console.log(` - ${cssFileCount} CSS file(s) scanned for hardcoded color literals`);
  console.log(` - ${tsxFileCount} .tsx/.jsx file(s) scanned for raw <table> usage`);
  console.log(" - globals.css imports the generated token file");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
