import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const layout = read("apps/web/src/app/layout.tsx");
const shell = read("apps/web/src/components/app-shell.tsx");
const contextBar = read("apps/web/src/components/module-context-bar.tsx");
const styles = read("apps/web/src/app/enterprise-modules.css");
const crm = read("apps/web/src/app/(app)/crm/page.tsx");
const sales = read("apps/web/src/app/(app)/sales/page.tsx");
const accounting = read("apps/web/src/app/(app)/accounting/page.tsx");
const procurement = read(
  "apps/web/src/components/procurement/procurement-workspace.tsx",
);
const salesReports = read("apps/web/src/app/(app)/sales/reports/page.tsx");
const salesEditor = read("apps/web/src/components/sales-document-editor.tsx");

test("released modules share one final enterprise experience layer", () => {
  assert.match(layout, /enterprise-modules\.css/);
  assert.match(shell, /ModuleContextBar/);
  assert.match(contextBar, /CRM/);
  assert.match(contextBar, /Sales/);
  assert.match(contextBar, /Procurement/);
  assert.match(contextBar, /Accounting/);
  for (const token of [
    "--module-crm",
    "--module-sales",
    "--module-procurement",
    "--module-accounting",
    ".module-context-bar",
    ".enterprise-document-editor",
    ".enterprise-report-layout",
  ]) {
    assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("each released module has a workflow-led dashboard", () => {
  assert.match(crm, /module-workbench crm-workbench/);
  assert.match(crm, /Pipeline health/);
  assert.match(crm, /workflow-launchpad/);
  assert.match(styles, /\.workflow-launchpad > a/);
  assert.match(styles, /\.workflow-step-number/);

  assert.match(styles, /\/\* Shared form alignment \*\//);
  assert.match(styles, /height: 42px/);
  assert.match(styles, /\.checkbox-row/);
  assert.match(styles, /\.checkbox-row \+ \.checkbox-row/);
  assert.match(styles, /\/\* Empty-state spacing only/);
  assert.match(styles, /\.empty-state:not\(\.compact\)/);
  assert.match(sales, /module-workbench sales-workbench/);
  assert.match(sales, /process-rail/);
  assert.match(accounting, /module-workbench accounting-workbench/);
  assert.match(accounting, /Record-to-report/);
  assert.match(procurement, /module-workbench procurement-workbench/);
  assert.match(procurement, /Source-to-pay/);
});

test("technical report and matching JSON is not exposed to operators", () => {
  assert.doesNotMatch(salesReports, /JSON\.stringify\(rows/);
  assert.doesNotMatch(salesReports, /<pre/);
  assert.doesNotMatch(procurement, /procurement-json/);
  assert.doesNotMatch(procurement, /JSON\.stringify\(result/);
  assert.match(salesReports, /enterprise-data-table/);
  assert.match(procurement, /match-result-card/);
});

test("sales creation is a guided document workflow", () => {
  assert.match(salesEditor, /document-stepper/);
  assert.match(salesEditor, /Customer and operating company/);
  assert.match(salesEditor, /Pricing and tax/);
  assert.match(salesEditor, /Document lines/);
  assert.match(salesEditor, /Customer promise/);
  assert.match(salesEditor, /Preview pricing/);
  assert.match(salesEditor, /AbortController/);
});

test("module design remains accessible and responsive", () => {
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /min-height: 42px/);
  assert.match(contextBar, /aria-current/);
  assert.match(salesEditor, /aria-label="Document creation steps"/);
});
