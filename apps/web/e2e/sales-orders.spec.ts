import { test, expect, type Page } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

const status = (page: Page, text: string) => page.getByText(text, { exact: true }).first();

// Journey across four real users with real role permissions (nobody is a bypass
// role): a rep records an order and requests fulfilment (they cannot confirm);
// a manager confirms, holds and releases it and amends it; the amendment can
// only be approved by a DIFFERENT manager; finally the order is cancelled.
// Every total is the server's own (2 x 400 + 18% GST = 944; 3 x 400 => 1,416).
test.describe("Sales order journey", () => {
  test("create -> submit -> confirm -> fulfil -> hold/release -> amend (second approver) -> cancel", async ({ browser }) => {
    test.setTimeout(480_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    const manager = await openSalesSession(browser, world.manager);
    const manager2 = await openSalesSession(browser, world.manager2);
    try {
      // --- rep records the order
      const page = rep.page;
      await page.goto("/sales/orders/new", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "New sales order" })).toBeVisible({ timeout: 120_000 });
      await page.getByRole("button", { name: /Select a customer/ }).click();
      await page.getByRole("option", { name: new RegExp(world.customerName) }).click();
      await page.getByRole("button", { name: /Select an item/ }).click();
      await page.getByRole("option", { name: new RegExp(world.itemCode) }).click();
      const quantity = page.getByRole("textbox", { name: "Quantity 1" });
      await quantity.click();
      await quantity.press("Control+A");
      await quantity.pressSequentially("2");
      await quantity.blur();
      await expect(page.getByText(/INR\s*944\.00/).first()).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Save order" }).click();
      await expect(page).toHaveURL(/\/sales\/orders\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const orderUrl = page.url();
      await expect(status(page, "Draft")).toBeVisible({ timeout: 90_000 });
      const orderNumber = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
      expect(orderNumber).toMatch(/^SO-/);

      // --- submit; with no approval threshold configured it is approved automatically
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      await expect(page.getByText(/Approved\. Confirming runs the customer credit check/)).toBeVisible({ timeout: 30_000 });
      // the rep holds no confirm permission, so the control is not even offered
      await expect(page.getByRole("button", { name: "Confirm order" })).toHaveCount(0);

      // --- manager confirms
      const m = manager.page;
      await m.goto(orderUrl, { waitUntil: "domcontentloaded" });
      await m.getByRole("button", { name: "Confirm order" }).click({ timeout: 120_000 });
      await expect(status(m, "Confirmed")).toBeVisible({ timeout: 30_000 });

      // --- rep requests fulfilment; the request shows on the Fulfilment & billing tab
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Request fulfilment" }).click({ timeout: 60_000 });
      await expect(page.getByText("Fulfilment requested.")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: /Fulfilment & billing/ }).click();
      await expect(page.getByRole("row", { name: /FUL-/ }).first()).toBeVisible();

      // --- manager places a hold (reason is mandatory), then releases it
      await m.reload({ waitUntil: "domcontentloaded" });
      await m.getByRole("button", { name: "Place on hold" }).click({ timeout: 60_000 });
      const holdDialog = m.getByRole("dialog", { name: "Place order on hold" });
      await expect(holdDialog.getByRole("button", { name: "Place on hold" })).toBeDisabled();
      await holdDialog.getByLabel("Reason").fill("Awaiting customer payment");
      await holdDialog.getByRole("button", { name: "Place on hold" }).click();
      await expect(status(m, "On hold")).toBeVisible({ timeout: 30_000 });
      await m.getByRole("tab", { name: /Holds/ }).click();
      await m.getByRole("button", { name: "Release", exact: true }).click();
      await m.getByRole("dialog", { name: "Release hold" }).getByRole("button", { name: "Release hold" }).click();
      await expect(status(m, "Confirmed")).toBeVisible({ timeout: 30_000 });

      // --- manager amends to 3 units; the same person cannot approve it
      await m.getByRole("button", { name: "Amend" }).click();
      await expect(m.getByRole("heading", { name: /^Amend SO-/ })).toBeVisible({ timeout: 60_000 });
      const amendQuantity = m.getByRole("textbox", { name: "Quantity 1" });
      await amendQuantity.click();
      await amendQuantity.press("Control+A");
      await amendQuantity.pressSequentially("3");
      await amendQuantity.blur();
      await expect(m.getByText(/INR\s*1,416\.00/).first()).toBeVisible({ timeout: 60_000 });
      await expect(m.getByRole("button", { name: "Submit amendment" })).toBeDisabled(); // reason required
      await m.getByLabel("Reason for this amendment").fill("Customer asked for 3");
      await m.getByRole("button", { name: "Submit amendment" }).click();
      await expect(m).toHaveURL(orderUrl, { timeout: 60_000 });
      await expect(m.getByText(/This amendment needs approval/)).toBeVisible({ timeout: 30_000 });
      await m.getByRole("button", { name: "Approve amendment" }).click();
      await expect(m.getByText(/someone else must approve it/)).toBeVisible({ timeout: 30_000 });

      // --- the other manager approves; version 2 is now the order
      const m2 = manager2.page;
      await m2.goto(orderUrl, { waitUntil: "domcontentloaded" });
      await m2.getByRole("button", { name: "Approve amendment" }).click({ timeout: 120_000 });
      await expect(status(m2, "Confirmed")).toBeVisible({ timeout: 30_000 });
      await expect(m2.getByText(/INR\s*1,416\.00/).first()).toBeVisible();
      await m2.getByRole("tab", { name: /Versions/ }).click();
      await expect(m2.getByRole("row", { name: /v2 \(current\)/ })).toBeVisible();
      await expect(m2.getByRole("row", { name: /v1/ }).first()).toBeVisible();

      // --- cancel needs a reason
      await m2.getByRole("button", { name: "Cancel order" }).click();
      const cancelDialog = m2.getByRole("dialog", { name: "Cancel this order" });
      await expect(cancelDialog.getByRole("button", { name: "Cancel order" })).toBeDisabled();
      await cancelDialog.getByLabel("Reason for cancelling").fill("Customer withdrew");
      await cancelDialog.getByRole("button", { name: "Cancel order" }).click();
      await expect(status(m2, "Cancelled")).toBeVisible({ timeout: 30_000 });

      // --- and the register shows it
      await page.goto("/sales/orders", { waitUntil: "domcontentloaded" });
      await page.getByRole("searchbox", { name: "Search sales orders" }).fill(orderNumber);
      await expect(page.getByRole("row", { name: new RegExp(`${orderNumber}.*Cancelled`) }).first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await rep.context.close();
      await manager.context.close();
      await manager2.context.close();
    }
  });
});
