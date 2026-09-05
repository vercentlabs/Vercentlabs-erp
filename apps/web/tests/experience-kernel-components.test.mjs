import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const canonical = [
  ["apps/web/src/shared/design/page-header.tsx", 'data-erp-ui="page-header"'],
  ["apps/web/src/shared/design/record-header.tsx", 'data-erp-ui="record-header"'],
  ["apps/web/src/shared/design/section-header.tsx", 'data-erp-ui="section-header"'],
  ["apps/web/src/shared/design/surface.tsx", 'data-erp-ui="surface"'],
  ["apps/web/src/shared/design/action.tsx", 'data-erp-ui="action-button"'],
  ["apps/web/src/shared/design/status-badge.tsx", 'data-erp-ui="status-badge"'],
  ["apps/web/src/shared/design/metric-card.tsx", 'data-erp-ui="metric-card"'],
  ["apps/web/src/shared/design/state-panel.tsx", 'data-erp-ui="state-panel"'],
  ["apps/web/src/shared/design/filter-bar.tsx", 'data-erp-ui="filter-bar"'],
  ["apps/web/src/shared/design/form-field.tsx", 'data-erp-ui="form-field"'],
  ["apps/web/src/shared/design/bulk-action-bar.tsx", 'data-erp-ui="bulk-action-bar"'],
  ["apps/web/src/shared/design/form-section.tsx", 'data-erp-ui="form-section"'],
  ["apps/web/src/shared/design/tabs.tsx", 'data-erp-ui="tabs"'],
  ["apps/web/src/shared/design/enterprise-data-grid.tsx", 'data-erp-ui="enterprise-data-grid"'],
];

test("Experience Kernel: canonical component files expose stable conformance markers", () => {
  for (const [file, marker] of canonical) {
    assert.match(read(file), new RegExp(marker.replaceAll('"', '\\"')));
  }
});



test("Experience Kernel: every canonical visual component consumes the shared CSS Module", () => {
  for (const [file] of canonical) {
    assert.match(read(file), /experience-kernel\.module\.css/);
  }
});

test("Experience Kernel: only EnterpriseDataGrid owns new raw table markup", () => {
  const designDir = path.join(root, "apps/web/src/shared/design");
  const files = fs
    .readdirSync(designDir)
    .filter((name) => name.endsWith(".tsx"));
  const owners = files.filter((name) => /<table(?:\s|>)/.test(read(`apps/web/src/shared/design/${name}`)));
  assert.deepEqual(owners, ["enterprise-data-grid.tsx"]);
});

test("Experience Kernel: EnterpriseDataGrid provides accessible table semantics and an optional mobile-card alternative", () => {
  const source = read("apps/web/src/shared/design/enterprise-data-grid.tsx");
  assert.match(source, /<caption/);
  assert.match(source, /scope="col"/);
  assert.match(source, /role="region"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /renderMobileCard/);
  assert.match(source, /dataGridWithMobileCards/);
});

test("Experience Kernel: form grouping uses fieldset and legend semantics", () => {
  const source = read("apps/web/src/shared/design/form-section.tsx");
  assert.match(source, /<fieldset/);
  assert.match(source, /<legend>/);
});

test("Experience Kernel: action components preserve focus, busy and disabled contracts", () => {
  const source = read("apps/web/src/shared/design/action.tsx");
  const css = read("apps/web/src/shared/design/experience-kernel.module.css");
  assert.match(source, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(source, /disabled=\{disabled \|\| busy\}/);
  assert.match(css, /\.action:focus-visible/);
  assert.match(css, /var\(--erp-shadow-focus\)/);
});

test("Experience Kernel: new component CSS consumes ERP tokens and only canonical responsive media", () => {
  const css = read("apps/web/src/shared/design/experience-kernel.module.css");
  assert.match(css, /var\(--erp-color-/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(max-width: 479px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /rgba?\(/i);
});

test("Experience Kernel: barrel exports every canonical primitive family", () => {
  const source = read("apps/web/src/shared/design/index.ts");
  for (const symbol of [
    "PageHeader",
    "RecordHeader",
    "SectionHeader",
    "Surface",
    "ActionButton",
    "ActionLink",
    "StatusBadge",
    "MetricCard",
    "StatePanel",
    "FilterBar",
    "BulkActionBar",
    "FormField",
    "FormSection",
    "Tabs",
    "EnterpriseDataGrid",
  ]) {
    assert.match(source, new RegExp(`\\b${symbol}\\b`));
  }
});
