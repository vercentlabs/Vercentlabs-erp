import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("module and workflow navigation share one readable spacing scale", () => {
  const modules = read("apps/web/src/app/enterprise-modules.css");
  const crm = read("apps/web/src/app/crm-product.css");

  for (const token of [
    "--workspace-nav-title-size: 15px",
    "--workspace-nav-copy-size: 13px",
    "--workspace-nav-tab-size: 14px",
    "--workspace-nav-tab-height: 46px",
    "--workspace-nav-inline-padding: 20px",
  ]) {
    assert.match(modules, new RegExp(token.replace(/[()]/g, "\\$&")));
  }
  assert.match(
    modules,
    /\.module-context-tabs a[\s\S]*var\(--workspace-nav-tab-height\)/,
  );
  assert.match(
    modules,
    /\.module-context-tabs a\.active::after,[\s\S]*content:\s*none/,
  );
  assert.match(
    crm,
    /\.crm-standard-shell \.crm-section-tabs a[\s\S]*var\(--workspace-nav-tab-height/,
  );
  assert.match(
    crm,
    /\.crm-standard-shell \.crm-section-tabs-heading small[\s\S]*var\(--workspace-nav-copy-size/,
  );
});

test("shared controls and data surfaces avoid undersized operator text", () => {
  const shared = read("apps/web/src/app/operator-workbench.css");
  const modules = read("apps/web/src/app/enterprise-modules.css");

  assert.match(shared, /label\s*\{[^}]*font-size:\s*13px/s);
  assert.match(shared, /input,[\s\S]*textarea\s*\{[^}]*font-size:\s*14px/s);
  assert.match(
    shared,
    /\.data-table,[\s\S]*\.accounting-table\s*\{[^}]*font-size:\s*13px/s,
  );
  assert.match(modules, /\.enterprise-data-table th[^}]*font-size:\s*11px/);
  assert.match(modules, /\.enterprise-data-table td[^}]*font-size:\s*13px/);
  assert.match(modules, /\.enterprise-form-grid label[^}]*font-size:\s*13px/);
});

test("shared headings are vertically centered with consistent copy spacing", () => {
  const modules = read("apps/web/src/app/enterprise-modules.css");
  const crm = read("apps/web/src/app/crm-product.css");

  assert.match(modules, /\.module-hero\s*\{[^}]*align-items:\s*center/s);
  assert.match(
    modules,
    /\.module-section-heading\s*\{[^}]*align-items:\s*center/s,
  );
  assert.match(
    crm,
    /\.crm-standard-shell \.card-title-row,[\s\S]*align-items:\s*center/,
  );
});
