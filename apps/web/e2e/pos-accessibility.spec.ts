import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getPosWorld, openPersonaSession } from "./pos-fixtures";

// Same tool and threshold as accessibility.spec.ts's own CRM coverage
// (axe-core, wcag2a+wcag2aa tags, critical/serious violations block) --
// extended to POS's own screens, which had no accessibility coverage at
// all before this pass. Read-only navigation only (no form submission),
// so this can share the same seeded world/personas every other POS e2e
// spec already uses without mutating shared state.
const managerPages: Array<[string, string]> = [
  ["/pos", "POS Overview"],
  ["/pos/stores", "POS Stores"],
  ["/pos/terminals", "POS Terminals"],
  ["/pos/cashiers", "POS Cashiers"],
  ["/pos/reports/day-end", "POS Day-end Reports"],
  ["/pos/reconciliation", "POS Reconciliation"],
  ["/pos/accounting", "POS Accounting Posting"],
  ["/pos/analytics", "POS Analytics"],
  ["/pos/offline-sync-conflicts", "POS Offline Sync Conflicts"],
];

const supervisorPages: Array<[string, string]> = [
  ["/pos/promotions", "POS Promotions"],
  ["/pos/coupons", "POS Coupons"],
  ["/pos/loyalty", "POS Loyalty"],
];

const cashierPages: Array<[string, string]> = [
  ["/pos/checkout", "POS Checkout"],
  ["/pos/returns", "POS Returns"],
  ["/pos/invoices", "POS Invoices"],
];

async function checkPage(page: import("@playwright/test").Page, route: string, label: string) {
  await page.goto(route, { waitUntil: "networkidle" }).catch(() => page.goto(route, { waitUntil: "domcontentloaded" }));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s) — ${v.helpUrl}`);
  expect(blocking, `${label} (${route}):\n${summary.join("\n")}`).toEqual([]);
}

test.describe("POS accessibility (manager)", () => {
  for (const [route, label] of managerPages) {
    test(`${label} has no critical/serious accessibility violations`, async ({ browser }) => {
      const world = await getPosWorld();
      const { context, page } = await openPersonaSession(browser, world.manager);
      try {
        await checkPage(page, route, label);
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("POS accessibility (supervisor)", () => {
  for (const [route, label] of supervisorPages) {
    test(`${label} has no critical/serious accessibility violations`, async ({ browser }) => {
      const world = await getPosWorld();
      const { context, page } = await openPersonaSession(browser, world.supervisor);
      try {
        await checkPage(page, route, label);
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("POS accessibility (cashier)", () => {
  for (const [route, label] of cashierPages) {
    test(`${label} has no critical/serious accessibility violations`, async ({ browser }) => {
      const world = await getPosWorld();
      const { context, page } = await openPersonaSession(browser, world.cashier);
      try {
        await checkPage(page, route, label);
      } finally {
        await context.close();
      }
    });
  }
});
