import { test, expect } from "@playwright/test";

import type { Page } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// Home dashboard and the order status reports.
// React Aria tabs can miss a click that lands before hydration finishes; retry until selected.
async function selectTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

test.describe("Sales insights", () => {
  test("home metrics and order status reports", async ({ browser }) => {
    test.setTimeout(300_000);
    const world = await getSalesWorld();
    const manager = await openSalesSession(browser, world.manager);
    try {
      const m = manager.page;
      await m.goto("/sales", { waitUntil: "domcontentloaded" });
      await expect(
        m.getByRole("heading", { name: "Sales", exact: true }),
      ).toBeVisible({ timeout: 120_000 });
      await expect(m.getByText("Confirmed order value")).toBeVisible();
      await expect(m.getByText("Orders on hold")).toBeVisible();

      await m.goto("/sales/order-status", { waitUntil: "domcontentloaded" });
      // the default report (Order status) is shown first, labelled even while empty
      await expect(m.getByRole("group", { name: /order status/i })).toBeVisible(
        { timeout: 60_000 },
      );
      await selectTab(m, "Active holds");
      await expect(
        m
          .getByRole("group", { name: /active holds/i })
          .or(m.getByText("No data for this report yet."))
          .first(),
      ).toBeVisible({ timeout: 60_000 });
      await selectTab(m, "Fulfilment status");
      await expect(m.getByRole("group", { name: /fulfillment/i })).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await manager.context.close();
    }
  });
});
