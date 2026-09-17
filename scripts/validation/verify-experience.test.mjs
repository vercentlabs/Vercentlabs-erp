import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkDesignSystemConvergence, countColorLiterals, countRawTables } from "./verify-experience.mjs";

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vercent-convergence-"));
}

test("countColorLiterals finds hex/rgb/hsl literals", () => {
  assert.equal(countColorLiterals("body { color: #fff; background: rgb(0 0 0); }"), 2);
  assert.equal(countColorLiterals("body { color: var(--color-text); }"), 0);
});

test("countRawTables finds raw <table> elements, not styled components named Table", () => {
  assert.equal(countRawTables("<table><thead>"), 1);
  assert.equal(countRawTables("<TableRoot><TableHeader>"), 0);
});

test("passes on a clean fixture: generated token file exempt, globals.css imports it, no raw tables", () => {
  const root = fixtureRoot();
  write(root, "apps/web/src/app/tokens.css", "@theme { --color-brand: #3f46d8; }\n");
  write(root, "apps/web/src/app/globals.css", '@import "tailwindcss";\n@import "./tokens.css";\n');
  write(root, "apps/web/src/app/page.tsx", "export default function Page() { return <div className=\"bg-brand\" />; }\n");
  const { failures } = checkDesignSystemConvergence(root);
  assert.deepEqual(failures, []);
});

test("fails when a non-generated CSS file has a hardcoded color literal", () => {
  const root = fixtureRoot();
  write(root, "apps/web/src/app/tokens.css", "@theme { --color-brand: #3f46d8; }\n");
  write(root, "apps/web/src/app/globals.css", '@import "tailwindcss";\n@import "./tokens.css";\nbody { color: #111827; }\n');
  const { failures } = checkDesignSystemConvergence(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /hard-coded color literal/);
});

test("fails on a raw <table> outside EnterpriseDataGrid", () => {
  const root = fixtureRoot();
  write(root, "apps/web/src/app/globals.css", '@import "tailwindcss";\n@import "./tokens.css";\n');
  write(root, "apps/web/src/app/leads/page.tsx", "export default function Page() { return <table><tbody /></table>; }\n");
  const { failures } = checkDesignSystemConvergence(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /raw <table>/);
});

test("does not flag EnterpriseDataGrid's own <table> element", () => {
  const root = fixtureRoot();
  write(root, "apps/web/src/app/globals.css", '@import "tailwindcss";\n@import "./tokens.css";\n');
  write(
    root,
    "packages/design-system/src/enterprise/data-grid/EnterpriseDataGrid.tsx",
    "export function EnterpriseDataGrid() { return <table><thead /></table>; }\n",
  );
  const { failures } = checkDesignSystemConvergence(root);
  assert.deepEqual(failures, []);
});

test("fails when globals.css doesn't import the generated token file", () => {
  const root = fixtureRoot();
  write(root, "apps/web/src/app/globals.css", '@import "tailwindcss";\n');
  const { failures } = checkDesignSystemConvergence(root);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /must @import/);
});
