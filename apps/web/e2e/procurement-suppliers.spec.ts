import { test, expect, type Page } from "@playwright/test";

import { getProcurementWorld } from "./procurement-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Supplier onboarding with real Procurement roles: a supplier is onboarded by a
// buyer and QUALIFIED by a different person (segregation of duties).
async function selectTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}
test.describe("Procurement supplier onboarding", () => {
  test("supplier: buyer onboards, adds a site, a DIFFERENT person qualifies, then it is activated", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      const b = buyer.page;
      await b.goto("/procurement/suppliers/new", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        b.getByRole("heading", { name: "New supplier" }),
      ).toBeVisible({ timeout: 120_000 });
      await b.getByLabel("Supplier code").fill(`E2E-${stamp}`);
      await b.getByLabel("Legal name").fill(`E2E Supplier ${stamp} Pvt Ltd`);
      await b.getByLabel("Payment terms").fill("Net 30");
      await b.getByRole("button", { name: "Save supplier" }).click();
      await expect(b).toHaveURL(/\/procurement\/suppliers\/[0-9a-f-]{36}$/, {
        timeout: 60_000,
      });
      const url = b.url();
      await expect(b.getByText("Draft", { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(b.getByText(`E2E-${stamp}`).first()).toBeVisible();

      await b.getByRole("button", { name: "Submit for qualification" }).click();
      await expect(
        b.getByText("Submitted", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      // the buyer created it, so the server refuses their own qualification
      await b.getByRole("button", { name: "Qualify", exact: true }).click();
      await expect(
        b.getByText(/cannot approve the same document/i),
      ).toBeVisible({ timeout: 30_000 });

      await selectTab(b, /Sites/);
      await b.getByRole("button", { name: "Add site" }).click();
      const site = b.getByRole("dialog", { name: "Add site" });
      await site.getByLabel("Site name").fill("Pune Plant");
      await site.getByLabel("Contact name").fill("Ravi Kumar");
      await site.getByRole("button", { name: "Add site" }).click();
      await expect(
        b.getByRole("row", { name: /Pune Plant.*Ravi Kumar/ }),
      ).toBeVisible({ timeout: 30_000 });

      // a different person (purchase manager) qualifies, then activates
      const m = manager.page;
      await m.goto(url, { waitUntil: "domcontentloaded" });
      await m
        .getByRole("button", { name: "Qualify", exact: true })
        .click({ timeout: 120_000 });
      await expect(
        m.getByText("Qualified", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await m.getByRole("button", { name: "Activate" }).click();
      await expect(m.getByText("Active", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // suspending needs a reason
      await m.getByRole("button", { name: "Suspend" }).click();
      const suspend = m.getByRole("dialog", { name: "Suspend" });
      await expect(
        suspend.getByRole("button", { name: "Suspend" }),
      ).toBeDisabled();
      await suspend.getByLabel("Reason").fill("Under review");
      await suspend.getByRole("button", { name: "Suspend" }).click();
      await expect(
        m.getByText("Suspended", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
    }
  });
});
