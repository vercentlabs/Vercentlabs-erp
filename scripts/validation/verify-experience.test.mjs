import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeExperience,
  normalizeMediaQuery,
  validateExperience,
} from "./verify-experience.mjs";

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-experience-"));

  write(
    root,
    "apps/web/src/app/layout.tsx",
    'import "../shared/design/tokens.css";\nimport "./globals.css";\n',
  );
  write(
    root,
    "apps/web/src/shared/design/tokens.css",
    ":root { --erp-color-surface: #fff; }\n",
  );
  write(
    root,
    "apps/web/src/app/globals.css",
    ":root { --legacy: #fff; }\n@media (max-width: 760px) { .x { color: #111; } }\n",
  );
  write(root, "apps/web/src/app/page.tsx", "export default function Page(){ return null; }\n");

  const baseline = {
    canonicalTokenFile: "apps/web/src/shared/design/tokens.css",
    canonicalMediaQueries: [
      "(max-width:479px)",
      "(max-width:767px)",
      "(min-width:768px)and(max-width:1023px)",
      "(min-width:1024px)",
      "(min-width:1440px)",
      "(prefers-reduced-motion:reduce)",
      "print",
    ],
    legacyAppCssFiles: ["apps/web/src/app/globals.css"],
    rootLayoutLegacyCssImports: ["./globals.css"],
    legacyRootBlocksByFile: { "apps/web/src/app/globals.css": 1 },
    legacyMediaQueriesByFile: {
      "apps/web/src/app/globals.css": ["(max-width:760px)"],
    },
    legacyHardcodedColorLiteralsByFile: {
      "apps/web/src/app/globals.css": 2,
    },
    legacyRawTableCountsByFile: {},
    canonicalComponentFiles: [],
    canonicalStyleFiles: [],
    canonicalRawTableCountsByFile: {},
  };

  return { root, baseline };
}

test("normalizes equivalent media-query spacing", () => {
  assert.equal(
    normalizeMediaQuery("(max-width: 760px)"),
    normalizeMediaQuery("(max-width:760px)"),
  );
});

test("reviewed legacy debt passes and canonical tokens are allowed", () => {
  const { root, baseline } = fixture();
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.deepEqual(failures, []);
});

test("new global CSS fails closed", () => {
  const { root, baseline } = fixture();
  write(root, "apps/web/src/app/another-global.css", ".new { color: #222; }\n");
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(failures.some((failure) => failure.includes("new application-global CSS")));
});

test("new CSS Module must use canonical colors and media queries", () => {
  const { root, baseline } = fixture();
  write(
    root,
    "apps/web/src/modules/crm/new.module.css",
    ".x { color: #123456; }\n@media (max-width: 700px) { .x { display: block; } }\n",
  );
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(failures.some((failure) => failure.includes("hard-coded color")));
  assert.ok(failures.some((failure) => failure.includes("noncanonical media query")));
});

test("new raw table fails closed", () => {
  const { root, baseline } = fixture();
  write(
    root,
    "apps/web/src/modules/crm/new-table.tsx",
    "export function NewTable(){ return <table><tbody /></table>; }\n",
  );
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(failures.some((failure) => failure.includes("raw <table> debt increased")));
});

test("canonical data-grid primitive may own one raw table while consumers may not", () => {
  const { root, baseline } = fixture();
  const grid = "apps/web/src/shared/design/enterprise-data-grid.tsx";
  write(root, grid, "export function Grid(){ return <table><tbody /></table>; }\n");
  baseline.canonicalComponentFiles = [grid];
  baseline.canonicalRawTableCountsByFile = { [grid]: 1 };

  const canonicalFailures = validateExperience(analyzeExperience(root), baseline);
  assert.deepEqual(canonicalFailures, []);

  write(
    root,
    "apps/web/src/modules/crm/consumer-table.tsx",
    "export function Consumer(){ return <table><tbody /></table>; }\n",
  );
  const consumerFailures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(
    consumerFailures.some((failure) => failure.includes("raw <table> debt increased")),
  );
});

test("missing canonical Experience Kernel component fails closed", () => {
  const { root, baseline } = fixture();
  baseline.canonicalComponentFiles = [
    "apps/web/src/shared/design/page-header.tsx",
  ];
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(
    failures.some((failure) =>
      failure.includes("missing canonical Experience Kernel component"),
    ),
  );
});

test("missing canonical Experience Kernel stylesheet fails closed", () => {
  const { root, baseline } = fixture();
  baseline.canonicalStyleFiles = [
    "apps/web/src/shared/design/experience-kernel.module.css",
  ];
  const failures = validateExperience(analyzeExperience(root), baseline);
  assert.ok(
    failures.some((failure) =>
      failure.includes("missing canonical Experience Kernel stylesheet"),
    ),
  );
});
