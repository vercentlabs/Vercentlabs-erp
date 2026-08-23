import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const moduleIcons = {
  crm: "crm",
  sales: "sales",
  accounting: "accounting",
  procurement: "procurement",
  stock: "stock",
  manufacturing: "manufacturing",
  projects: "projects",
  assets: "assets",
  "point-of-sale": "point-of-sale",
  quality: "quality",
  support: "support",
  "hr-payroll": "hr-payroll",
};

test("workspace v3: all 12 module headings use dedicated module-specific icons", () => {
  const source = read("apps/web/src/lib/navigation/modules.ts");
  for (const [moduleId, icon] of Object.entries(moduleIcons)) {
    const expression = new RegExp(
      `moduleId:\\s*"${moduleId}",\\s*\\n\\s*icon:\\s*"${icon}"`,
    );
    assert.match(source, expression, `${moduleId} should use ${icon}`);
  }
  assert.equal(new Set(Object.values(moduleIcons)).size, 12);
});

test("workspace v3: leaf navigation uses route-aware semantic iconography", () => {
  const link = read("apps/web/src/components/navigation-link.tsx");
  const semantic = read("apps/web/src/components/semantic-navigation-icon.tsx");
  assert.match(link, /SemanticNavigationIcon/);
  for (const href of [
    "/crm/leads",
    "/sales/quotations",
    "/accounting/journals",
    "/procurement/requisitions",
    "/stock/balances",
    "/manufacturing/work-orders",
    "/projects/milestones",
    "/assets/maintenance-orders",
    "/point-of-sale/checkout",
    "/quality/non-conformances",
    "/support/tickets",
    "/hr-payroll/payroll-runs",
  ]) {
    assert.match(semantic, new RegExp(href.replaceAll("/", "\\/")));
  }
});

test("workspace v3: Home derives module launchers from canonical module access, not a fake roadmap list", () => {
  const source = read("apps/web/src/app/(app)/dashboard/page.tsx");
  assert.match(source, /getAccessibleModules\(session\)/);
  assert.match(source, /ERP_MODULE_CATALOG/);
  assert.match(source, /MODULE_ROUTE_ROOTS/);
  assert.match(source, /module\.accessible/);
  assert.doesNotMatch(source, /1049 features available|1039 features available/i);
});

test("workspace v3: Home preserves real work and governance sections", () => {
  const source = read("apps/web/src/app/(app)/dashboard/page.tsx");
  assert.match(source, /getMyWorkSummary\(session, 5\)/);
  assert.doesNotMatch(source, /listFavourites|listRecentRecords/);
  assert.match(source, /Organisation overview/);
  assert.match(source, /Latest audit events/);
  assert.doesNotMatch(source, /Math\.random|dummy|sample data|fake KPI/i);
});

test("workspace v3: topbar has identity, global search, operating context and actions as distinct responsive regions", () => {
  const shell = read("apps/web/src/components/app-shell.tsx");
  assert.match(shell, /topbar-v3__identity/);
  assert.match(shell, /topbar-v3__search/);
  assert.match(shell, /topbar-v3__context/);
  assert.match(shell, /topbar-v3__actions/);
  assert.match(shell, /<CommandPalette/);
  assert.match(shell, /<ContextSwitcher/);
  assert.match(shell, /<QuickCreateButton/);
  assert.match(shell, /<NotificationsControl/);
  assert.match(shell, /<ProfileMenu/);
});

test("workspace v3: responsive CSS covers desktop, tablet, mobile and narrow phone states", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");
  for (const breakpoint of ["1450", "1240", "1080", "960", "720", "420"]) {
    assert.match(css, new RegExp(`max-width:\\s*${breakpoint}px`));
  }
});

test("workspace v3: command palette launcher remains accessible when visually compacted", () => {
  const source = read("apps/web/src/components/command-palette.tsx");
  assert.match(source, /aria-label="Search navigation, records and actions"/);
});
