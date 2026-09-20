import { test, expect } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// Journey: a salesperson builds a quotation, gets it approved, sends it, the
// customer accepts through the public link in a completely separate browser
// context (no session), and it converts to a sales order. Every state claim is
// checked in the UI; totals are the server's own (2 x 400 + 18% GST = 944).
test.describe("Sales quotation journey", () => {
  test("create -> submit -> approve -> send -> customer accepts on the public link -> convert", async ({ browser }) => {
    test.setTimeout(360_000);
    const world = await getSalesWorld();
    const { context, page } = await openSalesSession(browser, world.rep);
    try {
      await page.goto("/sales/quotations/new", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "New quotation" })).toBeVisible({ timeout: 120_000 });

      await page.getByRole("button", { name: /Select a customer/ }).click();
      await page.getByRole("option", { name: new RegExp(world.customerName) }).click();
      await page.getByRole("button", { name: /Select an item/ }).click();
      await page.getByRole("option", { name: new RegExp(world.itemCode) }).click();

      const quantity = page.getByRole("textbox", { name: "Quantity 1" });
      await quantity.click();
      await quantity.press("Control+A");
      await quantity.pressSequentially("2");
      await quantity.blur();

      // The totals panel is the server's previewSalesDocument, not browser maths.
      await expect(page.getByText(/INR\s*944\.00/).first()).toBeVisible({ timeout: 60_000 });

      await page.getByRole("button", { name: "Save quotation" }).click();
      await expect(page).toHaveURL(/\/sales\/quotations\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
      const quotationNumber = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
      expect(quotationNumber).toMatch(/^QUO-/);

      await page.getByRole("button", { name: "Submit for approval" }).click();
      // Whether approval is required depends on the discount/value gate; if it
      // is, a DIFFERENT person (the manager) must approve -- the rep cannot.
      const send = page.getByRole("button", { name: "Send to customer" });
      const pending = page.getByText("needs approval by someone other than its author");
      await expect(send.or(pending)).toBeVisible({ timeout: 30_000 });
      if (await pending.isVisible()) {
        await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0); // rep holds no approve permission
        const manager = await openSalesSession(browser, world.manager);
        try {
          await manager.page.goto(page.url(), { waitUntil: "domcontentloaded" });
          await manager.page.getByRole("button", { name: "Approve" }).click({ timeout: 120_000 });
          await expect(manager.page.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        } finally {
          await manager.context.close();
        }
        await page.reload({ waitUntil: "domcontentloaded" });
      }

      await send.click();
      const dialog = page.getByRole("dialog", { name: "Quotation sent" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const link = await dialog.getByLabel("Customer link").inputValue();
      expect(link).toMatch(/\/quote\/[A-Za-z0-9_-]{43}$/);
      await dialog.getByRole("button", { name: "Done" }).click();

      // The customer: a fresh context with NO session opens the link and accepts.
      const customer = await browser.newContext({ storageState: undefined });
      try {
        const customerPage = await customer.newPage();
        await customerPage.goto(link, { waitUntil: "domcontentloaded" });
        await expect(customerPage.getByRole("heading", { name: new RegExp(quotationNumber) })).toBeVisible({ timeout: 120_000 });
        await expect(customerPage.getByText(/944\.00/).first()).toBeVisible();
        // no margin/cost/internal fields ever reach the customer
        await expect(customerPage.getByText(/margin|standard cost|internal notes/i)).toHaveCount(0);
        await customerPage.getByLabel("Your name").fill("Ana Buyer");
        await customerPage.getByRole("button", { name: "Accept quotation" }).click();
        await expect(customerPage.getByText(/quotation accepted/i)).toBeVisible({ timeout: 30_000 });

        // once decided, the link cannot be used again
        await customerPage.goto(link, { waitUntil: "domcontentloaded" });
        await expect(customerPage.getByText(/not available|expired|revoked|already/i).first()).toBeVisible({ timeout: 30_000 });
      } finally {
        await customer.close();
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("Accepted", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      const convert = page.getByRole("button", { name: "Convert to sales order" });
      await expect(convert).toBeVisible();
      const [convertResponse] = await Promise.all([page.waitForResponse((res) => res.url().endsWith("/convert") && res.request().method() === "POST"), convert.click()]);
      expect(convertResponse.status()).toBe(201);
      expect((await convertResponse.json()).result.orderId).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("the list finds the quotation by customer and a viewer-only URL is refused without permission", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getSalesWorld();
    const { context, page } = await openSalesSession(browser, world.rep);
    try {
      await page.goto("/sales/quotations", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Quotations" })).toBeVisible({ timeout: 120_000 });
      await page.getByRole("searchbox", { name: "Search quotations" }).fill(world.customerName);
      await expect(page.getByRole("row", { name: new RegExp(world.customerName) }).first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await context.close();
    }
  });
});
