#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_SOURCE_EXTENSIONS = new Set([".tsx", ".jsx"]);
const COLOR_LITERAL_PATTERN =
  /(?<![\w-])(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))(?![\w-])/g;
const RAW_TABLE_PATTERN = /<table(?:\s|>)/g;
const MEDIA_PATTERN = /@media\s*([^{]+)\{/g;

export function normalizeMediaQuery(query) {
  return query
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")");
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function walk(directory, predicate = () => true) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(full, predicate));
    } else if (predicate(full)) {
      output.push(full);
    }
  }
  return output;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function mediaQueries(source) {
  return new Set(
    [...source.matchAll(MEDIA_PATTERN)].map((match) =>
      normalizeMediaQuery(match[1]),
    ),
  );
}

function read(relativePath, root) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function cssImportsFromRootLayout(root) {
  const layout = read("apps/web/src/app/layout.tsx", root);
  return [...layout.matchAll(/import\s+["'](.+?\.css)["'];/g)].map(
    (match) => match[1],
  );
}

export function analyzeExperience(root) {
  const appRoot = path.join(root, "apps/web/src/app");
  const webRoot = path.join(root, "apps/web/src");
  const canonicalTokenFile = "apps/web/src/shared/design/tokens.css";

  const appCssFiles = walk(
    appRoot,
    (file) => path.dirname(file) === appRoot && file.endsWith(".css"),
  )
    .map((file) => posix(path.relative(root, file)))
    .sort();

  const allCssFiles = walk(webRoot, (file) => file.endsWith(".css"))
    .map((file) => posix(path.relative(root, file)))
    .sort();

  const rootBlocksByFile = {};
  const mediaQueriesByFile = {};
  const hardcodedColorLiteralsByFile = {};

  for (const relativePath of allCssFiles) {
    const source = read(relativePath, root);
    const rootCount = countMatches(source, /:root/g);
    const queries = [...mediaQueries(source)].sort();
    const colors = countMatches(source, COLOR_LITERAL_PATTERN);

    if (rootCount) rootBlocksByFile[relativePath] = rootCount;
    if (queries.length) mediaQueriesByFile[relativePath] = queries;
    if (colors) hardcodedColorLiteralsByFile[relativePath] = colors;
  }

  const rawTableCountsByFile = {};
  for (const file of walk(webRoot, (candidate) =>
    UI_SOURCE_EXTENSIONS.has(path.extname(candidate)),
  )) {
    const relativePath = posix(path.relative(root, file));
    const count = countMatches(fs.readFileSync(file, "utf8"), RAW_TABLE_PATTERN);
    if (count) rawTableCountsByFile[relativePath] = count;
  }

  return {
    canonicalTokenFile,
    appCssFiles,
    allCssFiles,
    rootLayoutCssImports: cssImportsFromRootLayout(root),
    rootBlocksByFile,
    mediaQueriesByFile,
    hardcodedColorLiteralsByFile,
    rawTableCountsByFile,
  };
}

function setDifference(actual, allowed) {
  const allow = new Set(allowed);
  return actual.filter((item) => !allow.has(item));
}

export function validateExperience(analysis, baseline) {
  const failures = [];
  const canonicalTokenFile = baseline.canonicalTokenFile;
  const legacyAppCss = new Set(baseline.legacyAppCssFiles);
  const canonicalMedia = new Set(baseline.canonicalMediaQueries);

  if (!analysis.allCssFiles.includes(canonicalTokenFile)) {
    failures.push(`missing canonical token file: ${canonicalTokenFile}`);
  }

  const newAppGlobalCss = analysis.appCssFiles.filter(
    (file) => !legacyAppCss.has(file),
  );
  for (const file of newAppGlobalCss) {
    failures.push(
      `${file}: new application-global CSS is forbidden; use a shared/design or module *.module.css`,
    );
  }

  for (const file of analysis.allCssFiles) {
    if (file === canonicalTokenFile || legacyAppCss.has(file)) continue;
    if (!file.endsWith(".module.css")) {
      failures.push(
        `${file}: new web CSS outside the canonical token file must use *.module.css`,
      );
    }
  }

  const expectedCanonicalImport = "../shared/design/tokens.css";
  const tokenImportIndex = analysis.rootLayoutCssImports.indexOf(
    expectedCanonicalImport,
  );
  if (tokenImportIndex !== 0) {
    failures.push(
      `apps/web/src/app/layout.tsx: ${expectedCanonicalImport} must be the first CSS import`,
    );
  }

  const allowedRootImports = new Set([
    expectedCanonicalImport,
    ...baseline.rootLayoutLegacyCssImports,
  ]);
  for (const specifier of analysis.rootLayoutCssImports) {
    if (!allowedRootImports.has(specifier)) {
      failures.push(
        `apps/web/src/app/layout.tsx: new global CSS import ${specifier} is forbidden`,
      );
    }
  }

  for (const [file, count] of Object.entries(analysis.rootBlocksByFile)) {
    if (file === canonicalTokenFile) {
      if (count !== 1) {
        failures.push(
          `${file}: canonical token file must own exactly one :root block; found ${count}`,
        );
      }
      continue;
    }

    const legacyLimit = baseline.legacyRootBlocksByFile[file] ?? 0;
    if (count > legacyLimit) {
      failures.push(
        `${file}: :root debt increased from ${legacyLimit} to ${count}`,
      );
    }
  }

  for (const [file, queries] of Object.entries(analysis.mediaQueriesByFile)) {
    if (legacyAppCss.has(file)) {
      const legacyQueries = baseline.legacyMediaQueriesByFile[file] ?? [];
      for (const query of setDifference(queries, legacyQueries)) {
        failures.push(
          `${file}: new legacy media query "${query}" is forbidden; migrate toward canonical breakpoints`,
        );
      }
      continue;
    }

    if (file === canonicalTokenFile) {
      if (queries.length) {
        failures.push(`${file}: token file must not own media queries`);
      }
      continue;
    }

    for (const query of setDifference(queries, [...canonicalMedia])) {
      failures.push(
        `${file}: noncanonical media query "${query}"; use the Experience Kernel breakpoint policy`,
      );
    }
  }

  for (const [file, count] of Object.entries(
    analysis.hardcodedColorLiteralsByFile,
  )) {
    if (file === canonicalTokenFile) continue;

    if (legacyAppCss.has(file)) {
      const legacyLimit =
        baseline.legacyHardcodedColorLiteralsByFile[file] ?? 0;
      if (count > legacyLimit) {
        failures.push(
          `${file}: hard-coded color debt increased from ${legacyLimit} to ${count}`,
        );
      }
      continue;
    }

    if (count > 0) {
      failures.push(
        `${file}: ${count} hard-coded color literal(s); new CSS must consume --erp-* tokens`,
      );
    }
  }

  for (const [file, count] of Object.entries(analysis.rawTableCountsByFile)) {
    const legacyLimit = baseline.legacyRawTableCountsByFile[file] ?? 0;
    if (count > legacyLimit) {
      failures.push(
        `${file}: raw <table> debt increased from ${legacyLimit} to ${count}; use the canonical data-grid/table primitive`,
      );
    }
  }

  return failures;
}

function summarize(analysis, baseline) {
  const legacyCss = new Set(baseline.legacyAppCssFiles);
  const rootBlocks = Object.entries(analysis.rootBlocksByFile)
    .filter(([file]) => legacyCss.has(file))
    .reduce((sum, [, count]) => sum + count, 0);
  const mediaPairs = Object.entries(analysis.mediaQueriesByFile)
    .filter(([file]) => legacyCss.has(file))
    .reduce((sum, [, queries]) => sum + queries.length, 0);
  const mediaDistinct = new Set(
    Object.entries(analysis.mediaQueriesByFile)
      .filter(([file]) => legacyCss.has(file))
      .flatMap(([, queries]) => queries),
  ).size;
  const hardcodedColors = Object.entries(
    analysis.hardcodedColorLiteralsByFile,
  )
    .filter(([file]) => legacyCss.has(file))
    .reduce((sum, [, count]) => sum + count, 0);
  const rawTables = Object.values(analysis.rawTableCountsByFile).reduce(
    (sum, count) => sum + count,
    0,
  );

  return {
    legacyAppCssFiles: analysis.appCssFiles.filter((file) =>
      legacyCss.has(file),
    ).length,
    legacyRootBlocks: rootBlocks,
    legacyDistinctMediaQueries: mediaDistinct,
    legacyMediaQueryFilePairs: mediaPairs,
    legacyHardcodedColorLiterals: hardcodedColors,
    legacyRawTableOccurrences: rawTables,
    legacyRawTableFiles: Object.keys(analysis.rawTableCountsByFile).length,
  };
}

function main() {
  const root = process.cwd();
  const baselinePath = path.join(
    root,
    "scripts/validation/experience-debt-baseline.json",
  );

  if (!fs.existsSync(baselinePath)) {
    console.error("FAIL  missing scripts/validation/experience-debt-baseline.json");
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const analysis = analyzeExperience(root);
  const failures = validateExperience(analysis, baseline);
  const summary = summarize(analysis, baseline);

  if (failures.length) {
    console.error("\nEXPERIENCE KERNEL CONVERGENCE VIOLATIONS\n");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`\n${failures.length} experience violation(s) detected.`);
    process.exit(1);
  }

  console.log("EXPERIENCE KERNEL CONVERGENCE VALIDATION PASSED");
  console.log(` - legacy application CSS files: ${summary.legacyAppCssFiles}`);
  console.log(` - legacy :root blocks: ${summary.legacyRootBlocks}`);
  console.log(
    ` - normalized legacy media queries: ${summary.legacyDistinctMediaQueries} distinct / ${summary.legacyMediaQueryFilePairs} file-query pairs`,
  );
  console.log(
    ` - legacy hard-coded color literals: ${summary.legacyHardcodedColorLiterals}`,
  );
  console.log(
    ` - raw table debt: ${summary.legacyRawTableOccurrences} occurrence(s) across ${summary.legacyRawTableFiles} file(s)`,
  );
  console.log(
    " - policy: grandfathered debt may decrease; new design-system debt is fail-closed",
  );
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
