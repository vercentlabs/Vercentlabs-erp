import { test, expect } from "@playwright/test";

import type { Page } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// Home dashboard and report screens. A manager holds sales.margin.view; a rep
// does not, so the margin report must be refused for them by the server, not
// merely hidden.
// React Aria tabs can miss a click that lands before hydration finishes; retry until selected.
async function selectTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("Sales insights", () => {
  test("home metrics, analytics, order status and margin permission boundary", async ({ browser }) => {
    test.setTimeout(300_000);
    const world = await getSalesWorld();
    const manager = await openSalesSession(browser, world.manager);
    const rep = await openSalesSession(browser, world.rep);
    try {
      const m = manager.page;
      await m.goto("/sales", { waitUntil: "domcontentloaded" });
      await expect(m.getByRole("heading", { name: "Sales", exact: true })).toBeVisible({ timeout: 120_000 });
      await expect(m.getByText("Confirmed order value")).toBeVisible();
      await expect(m.getByText("Orders on hold")).toBeVisible();

      await m.goto("/sales/analytics", { waitUntil: "domcontentloaded" });
      await expect(m.getByRole("heading", { name: "Sales analytics" })).toBeVisible({ timeout: 120_000 });
      await expect(m.getByRole("group", { name: /quotation conversion/i })).toBeVisible({ timeout: 60_000 });
      await selectTab(m, "Order intake");
      await expect(m.getByRole("group", { name: /order intake/i })).toBeVisible({ timeout: 60_000 });

      await m.goto("/sales/order-status", { waitUntil: "domcontentloaded" });
      await expect(m.getByRole("group", { name: /fulfillment/i }).or(m.getByText("Loading…"))).toBeVisible({ timeout: 60_000 });
      await selectTab(m, "Active holds");
      await expect(m.getByRole("group", { name: /active holds/i }).or(m.getByText("No data for this report yet."))).toBeVisible({ timeout: 60_000 });
      await selectTab(m, "Fulfilment status");
      await expect(m.getByRole("group", { name: /fulfillment/i })).toBeVisible({ timeout: 60_000 });

      await m.goto("/sales/profitability", { waitUntil: "domcontentloaded" });
      await expect(m.getByRole("group", { name: /margin/i })).toBeVisible({ timeout: 60_000 });

      // rep: no margin permission => the server refuses the report
      const r = rep.page;
      await r.goto("/sales/profitability", { waitUntil: "domcontentloaded" });
      await expect(r.getByText("You don't have access to this report")).toBeVisible({ timeout: 120_000 });
    } finally {
      await manager.context.close();
      await rep.context.close();
    }
  });
});
