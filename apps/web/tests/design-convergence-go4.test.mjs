import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Go 4: shared design owns all five canonical page archetypes", () => {
  const source = read("apps/web/src/shared/design/page-archetypes.tsx");
  const css = read("apps/web/src/shared/design/page-archetypes.module.css");

  for (const marker of [
    "list-work-queue",
    "record-360",
    "transaction-document",
    "board",
    "operations-workspace",
  ]) {
    assert.match(source, new RegExp(marker));
  }

  assert.match(source, /data-erp-archetype/);
  assert.match(css, /var\(--erp-space-/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(max-width: 479px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Go 4: representative production screens adopt the archetype contracts", () => {
  const expected = new Map([
    ["apps/web/src/app/(app)/tasks/page.tsx", "ListWorkQueueArchetype"],
    ["apps/web/src/app/(app)/follow-ups/page.tsx", "ListWorkQueueArchetype"],
    ["apps/web/src/app/(app)/exceptions/page.tsx", "ListWorkQueueArchetype"],
    ["apps/web/src/app/(app)/approvals/page.tsx", "ListWorkQueueArchetype"],
    ["apps/web/src/modules/crm/components/account-detail-workspace.tsx", "Record360Archetype"],
    ["apps/web/src/modules/crm/components/contact-detail-workspace.tsx", "Record360Archetype"],
    ["apps/web/src/modules/crm/components/lead-detail-workspace.tsx", "Record360Archetype"],
    ["apps/web/src/app/(app)/sales/orders/[id]/page.tsx", "TransactionDocumentArchetype"],
    ["apps/web/src/app/(app)/sales/quotations/[id]/page.tsx", "TransactionDocumentArchetype"],
    ["apps/web/src/modules/crm/components/pipeline-board.tsx", "BoardArchetype"],
    ["apps/web/src/modules/stock/components/operations-workspace.tsx", "OperationsWorkspaceArchetype"],
  ]);

  for (const [file, marker] of expected) {
    assert.match(read(file), new RegExp(marker), `${file} must use ${marker}`);
  }
});

test("Go 4: approval queue consumes the canonical responsive data grid instead of owning a raw table", () => {
  const source = read("apps/web/src/app/(app)/approvals/page.tsx");
  assert.match(source, /EnterpriseDataGrid/);
  assert.match(source, /renderMobileCard/);
  assert.match(source, /StatePanel/);
  assert.doesNotMatch(source, /<table(?:\s|>)/);
});

test("Go 4: authenticated ERP browser gate is real Playwright + axe + screenshot regression coverage", () => {
  const config = read("apps/web/playwright.erp.config.ts");
  const auth = read("apps/web/tests/e2e/erp-auth.setup.ts");
  const experience = read("apps/web/tests/e2e/erp-experience.spec.ts");
  const packageJson = JSON.parse(read("apps/web/package.json"));

  assert.equal(packageJson.devDependencies["@playwright/test"], "1.61.1");
  assert.match(packageJson.devDependencies["@axe-core/playwright"], /^\^4\.12\.1$/);
  assert.ok(packageJson.scripts["test:e2e:erp"]);
  assert.match(config, /storageState/);
  assert.match(config, /webServer/);
  assert.match(auth, /ERP_E2E_EMAIL/);
  assert.match(auth, /ERP_E2E_PASSWORD/);
  assert.match(experience, /AxeBuilder/);
  assert.match(experience, /toHaveScreenshot/);
  assert.match(experience, /compact-320/);
  assert.match(experience, /mobile-390/);
  assert.match(experience, /tablet-768/);
  assert.match(experience, /desktop-1440/);
  assert.match(experience, /reducedMotion: "reduce"/);
  assert.match(experience, /ERP_E2E_LEAD_ID/);
  assert.match(experience, /ERP_E2E_SALES_ORDER_ID/);
});
