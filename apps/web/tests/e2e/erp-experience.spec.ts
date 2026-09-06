import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type RepresentativeRoute = {
  name: string;
  archetype?: string;
  resolvePath: () => string;
};

function requiredFixture(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for the Go-4 authenticated ERP gate. ` +
        "The fixture must belong to the dedicated E2E organization.",
    );
  }
  return value;
}

const ROUTES: RepresentativeRoute[] = [
  { name: "home", resolvePath: () => "/dashboard" },
  {
    name: "tasks",
    archetype: "list-work-queue",
    resolvePath: () => "/tasks",
  },
  {
    name: "pipeline",
    archetype: "board",
    resolvePath: () => "/crm/pipeline",
  },
  {
    name: "stock-operations",
    archetype: "operations-workspace",
    resolvePath: () => "/stock/operations",
  },
  {
    name: "lead-record-360",
    archetype: "record-360",
    resolvePath: () =>
      `/crm/leads/${encodeURIComponent(requiredFixture("ERP_E2E_LEAD_ID"))}`,
  },
  {
    name: "opportunity-record-360",
    archetype: "record-360",
    resolvePath: () =>
      `/crm/opportunities/${encodeURIComponent(requiredFixture("ERP_E2E_OPPORTUNITY_ID"))}`,
  },
  {
    name: "quotation-transaction-document",
    archetype: "transaction-document",
    resolvePath: () =>
      `/sales/quotations/${encodeURIComponent(requiredFixture("ERP_E2E_QUOTATION_ID"))}`,
  },
  {
    name: "sales-order-document",
    archetype: "transaction-document",
    resolvePath: () =>
      `/sales/orders/${encodeURIComponent(requiredFixture("ERP_E2E_SALES_ORDER_ID"))}`,
  },
  {
    name: "crm-generic-resource-list",
    resolvePath: () => "/crm/lost-reasons",
  },
  {
    name: "crm-contacts",
    resolvePath: () => "/crm/contacts",
  },
  {
    name: "crm-accounts",
    resolvePath: () => "/crm/accounts",
  },
  {
    name: "crm-lead-sources",
    resolvePath: () => "/crm/sources",
  },
  {
    name: "crm-forecast",
    resolvePath: () => "/crm/forecast",
  },
  {
    name: "crm-reports",
    resolvePath: () => "/crm/reports",
  },
  {
    name: "sales-reports",
    resolvePath: () => "/sales/reports",
  },
  {
    name: "sales-operations",
    resolvePath: () => "/sales/operations",
  },
  {
    name: "crm-leads-table-view",
    resolvePath: () => "/crm/leads",
  },
  {
    name: "crm-home",
    resolvePath: () => "/crm",
  },
  {
    name: "sales-home",
    resolvePath: () => "/sales",
  },
  {
    name: "sales-quotations",
    resolvePath: () => "/sales/quotations",
  },
  {
    name: "sales-orders",
    resolvePath: () => "/sales/orders",
  },
];

const RESPONSIVE_VIEWPORTS = [
  { name: "compact-320", width: 320, height: 568 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

async function openStable(page: Page, route: RepresentativeRoute) {
  await page.goto(route.resolvePath(), { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const running = document
      .getAnimations()
      .filter((animation) => animation.playState === "running");
    await Promise.allSettled(running.map((animation) => animation.finished));
  });
  if (route.archetype) {
    await expect(
      page.locator(`[data-erp-archetype="${route.archetype}"]`).first(),
    ).toBeVisible();
  }
}

test.describe("Go 4 authenticated responsive contract", () => {
  for (const route of ROUTES) {
    for (const viewport of RESPONSIVE_VIEWPORTS) {
      test(`${route.name} has no page-level horizontal overflow at ${viewport.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openStable(page, route);

        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        expect(dimensions.scrollWidth).toBeLessThanOrEqual(
          dimensions.clientWidth + 1,
        );
      });
    }
  }
});

test.describe("Go 4 authenticated WCAG gate", () => {
  for (const route of ROUTES) {
    test(`${route.name} has no serious or critical axe violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openStable(page, route);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const blockers = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );

      expect(
        blockers,
        blockers
          .map(
            (violation) =>
              `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} node(s)`,
          )
          .join("\n"),
      ).toEqual([]);
    });
  }
});

test.describe("Go 4 authenticated visual regression", () => {
  for (const route of ROUTES) {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ] as const) {
      test(`${route.name} visual baseline — ${viewport.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openStable(page, route);

        await expect(page).toHaveScreenshot(
          `${route.name}-${viewport.name}.png`,
          {
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.005,
          },
        );
      });
    }
  }
});
