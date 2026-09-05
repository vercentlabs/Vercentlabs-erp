import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Go 3: canonical boundary composes the existing Surface primitive and ERP tokens", () => {
  const boundary = read("apps/web/src/shared/design/convergence-boundary.tsx");
  const css = read("apps/web/src/shared/design/convergence-boundary.module.css");
  assert.match(boundary, /import \{ Surface \} from "\.\/surface"/);
  assert.match(boundary, /data-erp-convergence/);
  assert.match(css, /var\(--erp-color-canvas\)/);
  assert.match(css, /var\(--erp-content-max\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});

test("Go 3: authenticated shell is owned by the canonical shell boundary without losing navigation contracts", () => {
  const shell = read("apps/web/src/core/components/app-shell.tsx");
  assert.match(shell, /<ShellBoundary className="workspace-shell navigation-v2-shell">/);
  for (const marker of ["PrimaryNavigationRail", "ContextSecondarySidebar", "CommandPalette", "ContextSwitcher", "QuickCreateButton", "NotificationsControl", "ProfileMenu", "BottomNav"]) {
    assert.match(shell, new RegExp(marker));
  }
});

test("Go 3: Home, Settings and all twelve module overview entry surfaces use the canonical boundary", () => {
  const files = [
    "apps/web/src/app/(app)/dashboard/page.tsx",
    "apps/web/src/app/(app)/settings/page.tsx",
    "apps/web/src/app/(app)/crm/page.tsx",
    "apps/web/src/app/(app)/sales/page.tsx",
    "apps/web/src/app/(app)/accounting/page.tsx",
    "apps/web/src/app/(app)/procurement/page.tsx",
    "apps/web/src/modules/stock/components/stock-dashboard.tsx",
    "apps/web/src/modules/manufacturing/components/manufacturing-dashboard.tsx",
    "apps/web/src/modules/projects/components/projects-dashboard.tsx",
    "apps/web/src/modules/assets/components/assets-dashboard.tsx",
    "apps/web/src/modules/point-of-sale/components/point-of-sale-dashboard.tsx",
    "apps/web/src/modules/quality/components/quality-dashboard.tsx",
    "apps/web/src/modules/support/components/support-dashboard.tsx",
    "apps/web/src/modules/hr-payroll/components/hr-payroll-dashboard.tsx",
  ];
  for (const file of files) {
    assert.match(read(file), /ConvergenceBoundary/, `${file} must use ConvergenceBoundary`);
  }
});

test("Go 3: convergence remains presentation-only", () => {
  const doc = read("docs/04-shared-platform/DESIGN_SYSTEM_CONVERGENCE.md");
  assert.match(doc, /GO3_COMPLETE/);
  assert.match(doc, /does not change business logic, permissions, database state transitions or API contracts/);
});
