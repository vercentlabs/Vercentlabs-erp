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
  const source = read("apps/web/src/core/navigation/modules.ts");
  for (const [moduleId, icon] of Object.entries(moduleIcons)) {
    const expression = new RegExp(
      `moduleId:\\s*"${moduleId}",\\s*\\n\\s*icon:\\s*"${icon}"`,
    );
    assert.match(source, expression, `${moduleId} should use ${icon}`);
  }
  assert.equal(new Set(Object.values(moduleIcons)).size, 12);
});

test("workspace v3: leaf navigation uses route-aware semantic iconography", () => {
  const link = read("apps/web/src/core/components/navigation-link.tsx");
  const semantic = read("apps/web/src/core/components/semantic-navigation-icon.tsx");
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
  const shell = read("apps/web/src/core/components/app-shell.tsx");
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

test("workspace v3: redundant operating-workspace branding is absent at every breakpoint", () => {
  const shell = read("apps/web/src/core/components/app-shell.tsx");
  const css = read("apps/web/src/app/workspace-redesign-v3.css");

  assert.doesNotMatch(shell, /Operating workspace/i);
  assert.doesNotMatch(shell, /topbar-v3__workspace-copy/);
  assert.doesNotMatch(shell, /topbar-v3__workspace-mark/);
  assert.doesNotMatch(css, /topbar-v3__workspace-copy/);
  assert.doesNotMatch(css, /topbar-v3__workspace-mark/);
});

test("workspace v3: responsive CSS covers desktop, tablet, mobile and narrow phone states", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");
  for (const breakpoint of ["1450", "1380", "1240", "1080", "960", "720", "420"]) {
    assert.match(css, new RegExp(`max-width:\\s*${breakpoint}px`));
  }
});

test("workspace v3: avatar-only profile is centered on compact desktop, tablet and mobile", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");
  const workbenchCss = read("apps/web/src/app/operator-workbench.css");

  assert.match(
    css,
    /\.topbar-v3__actions \.topbar-profile \.topbar-avatar \{[\s\S]*?display: grid;[\s\S]*?place-content: center;[\s\S]*?padding: 0;[\s\S]*?line-height: 1;[\s\S]*?text-align: center;/,
  );
  assert.match(
    workbenchCss,
    /@media \(max-width: 1380px\) \{[\s\S]*?\.topbar-profile-copy \{[\s\S]*?display: none;/,
  );
  assert.match(
    css,
    /@media \(max-width: 1380px\) \{[\s\S]*?\.topbar-v3__actions \.topbar-profile \{[\s\S]*?grid-template-columns: 34px;[\s\S]*?grid-template-rows: 34px;[\s\S]*?place-content: center;[\s\S]*?place-items: center;[\s\S]*?gap: 0;[\s\S]*?padding: 3px;/,
  );
});

test("workspace v3: mobile topbar is compact, aligned and viewport-safe", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");
  const bottomNav = read("apps/web/src/core/components/bottom-nav.tsx");
  const mobile = css.split("@media (max-width: 720px)")[1] ?? "";
  const narrowPhone = mobile.split("@media (max-width: 420px)")[0] ?? "";

  assert.match(
    narrowPhone,
    /\.navigation-v2-shell \.topbar\.topbar-v3 \{[\s\S]*?"identity actions"[\s\S]*?"context context";/,
  );
  assert.match(narrowPhone, /\.topbar-v3__search \{\s*display: none;/);
  assert.match(
    narrowPhone,
    /\.topbar-v3__context \.context-switcher \{[\s\S]*?min-height: 40px;[\s\S]*?flex-wrap: nowrap;/,
  );
  assert.match(bottomNav, /label: "Search"/);
  assert.match(bottomNav, /vercentlabs:open-command-palette/);
  assert.match(
    narrowPhone,
    /\.topbar-v3__actions \.quick-create-button \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;[\s\S]*?justify-content: center;/,
  );
  assert.match(
    narrowPhone,
    /\.topbar-v3__identity \.mobile-menu-trigger,[\s\S]*?\.topbar-v3__actions \.topbar-profile \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/,
  );
  assert.match(
    narrowPhone,
    /\.topbar-v3__actions \.topbar-profile \{[\s\S]*?grid-template-columns: 32px;[\s\S]*?grid-template-rows: 32px;[\s\S]*?place-content: center;[\s\S]*?place-items: center;[\s\S]*?gap: 0;/,
  );
  assert.match(
    narrowPhone,
    /\.topbar-v3__actions \.topbar-profile \.topbar-avatar \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?margin-left: 0;/,
  );
  assert.match(narrowPhone, /\.topbar-v3__actions,[\s\S]*?gap: 5px;/);
  assert.match(
    narrowPhone,
    /\.topbar-v3__actions \.topbar-popover-wide \{[\s\S]*?100vw[\s\S]*?min-width: 0;/,
  );
});

test("workspace v3: command palette launcher remains accessible when visually compacted", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /aria-label="Search navigation, records and actions"/);
});

test("workspace v3: profile card is persistent and hover only changes color", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");

  assert.match(
    css,
    /\.topbar-v3__actions \.topbar-profile \{[\s\S]*?border-color: var\(--v3-border\);[\s\S]*?background: var\(--v3-surface\);/,
  );
  assert.match(
    css,
    /\.topbar-v3__actions \.topbar-profile:hover,[\s\S]*?background: #f7f8ff;/,
  );
  assert.match(css, /\.topbar-profile\[aria-expanded="true"\]/);
  assert.match(css, /\.topbar-v3__actions \.topbar-profile:focus-visible/);
  assert.doesNotMatch(
    css,
    /\.topbar-v3__actions \.topbar-profile:hover[^}]*transform:/,
  );
});

test("workspace v3: topbar, breadcrumbs and page content share one responsive gutter", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");

  assert.match(
    css,
    /--v3-shell-inline-gutter: clamp\(14px, 1\.5vw, 24px\)/,
  );
  assert.match(
    css,
    /\.topbar\.topbar-v3 \{[\s\S]*?padding: 9px var\(--v3-shell-inline-gutter\)/,
  );
  assert.match(
    css,
    /\.navigation-v2-shell \.breadcrumb-row,[\s\S]*?\.navigation-v2-shell \.workspace-content \{[\s\S]*?padding-right: var\(--v3-shell-inline-gutter\);[\s\S]*?padding-left: var\(--v3-shell-inline-gutter\);/,
  );
  assert.match(css, /--v3-shell-inline-gutter: 12px/);
  assert.match(css, /--v3-shell-inline-gutter: 9px/);
});

test("workspace v3: command palette uses one unified focus surface", () => {
  const css = read("apps/web/src/app/workspace-redesign-v3.css");
  const source = read("apps/web/src/core/components/command-palette.tsx");

  assert.match(
    source,
    /global-search-placeholder">Search navigation, records and actions/,
  );
  assert.match(css, /\.command-palette-input-row:focus-within/);
  assert.match(
    css,
    /\.command-palette-input:focus-visible \{[\s\S]*?outline: 0;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    css,
    /\.command-palette-input-row:focus-within \.command-palette-input-icon/,
  );
  assert.match(css, /max-height: calc\(100dvh - 22px\)/);
  assert.match(source, /<AppIcon name="close" size=\{16\} \/>/);
  assert.match(source, /title="Close \(Esc\)"/);
});
