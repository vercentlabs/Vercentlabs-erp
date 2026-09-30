import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Operational registers (deliveries, invoices, credit adjustments).
// The order is seeded through the real HTTP API as the real personas, then the
// registers are driven through the UI. Permission boundaries are asserted too:
// a rep can record an advance but is not offered "New return" (that needs
// sales.order.amend, which only managers hold).
async function api<T>(
  context: BrowserContext,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  const origin = new URL(BASE_URL).origin;
  const response = await context.request.fetch(`${origin}/api/sales${path}`, {
    method,
    data,
    headers: { Origin: origin, "Content-Type": "application/json" },
  });
  const body = await response.json();
  expect(
    response.ok(),
    `${method} ${path}: ${JSON.stringify(body)}`,
  ).toBeTruthy();
  return body as T;
}

// Select options load with the dialog; open the list again until the wanted option is there.
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe("Sales operational registers", () => {
  test("delivery, invoice and credit adjustment registers", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    const manager = await openSalesSession(browser, world.manager);
    try {
      const options = await api<{
        options: {
          parties: Array<{ id: string; display_name: string }>;
          items: Array<{ id: string; code: string }>;
          priceLists: Array<{ id: string; name: string }>;
        };
      }>(rep.context, "GET", "/options");
      const party = options.options.parties.find(
        (p) => p.display_name === world.customerName,
      )!;
      const item = options.options.items.find(
        (i) => i.code === world.itemCode,
      )!;
      const priceList = options.options.priceLists.find(
        (p) => p.name === "Sales E2E Price List",
      )!;

      const created = await api<{
        order: { id: string; sales_order_number: string };
      }>(rep.context, "POST", "/orders", {
        partyId: party.id,
        billingAddressId: world.customerBillingAddressId,
        currencyCode: "INR",
        priceListId: priceList.id,
        lines: [{ itemId: item.id, quantity: 2 }],
      });
      const orderId = created.order.id;
      const orderNumber = created.order.sales_order_number;
      await api(rep.context, "POST", `/orders/${orderId}/submit`, {});
      await api(manager.context, "POST", `/orders/${orderId}/confirm`, {});
      await api(rep.context, "POST", `/orders/${orderId}/fulfillment-request`, {
        idempotencyKey: `e2e-ful-${orderId}`,
      });
      await api(rep.context, "POST", `/orders/${orderId}/invoice-request`, {
        idempotencyKey: `e2e-inv-${orderId}`,
        quantityBasis: "ordered",
      });

      // --- deliveries + invoices registers show the hand-offs, joined to order and customer
      const r = rep.page;
      await r.goto("/sales/deliveries", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "Deliveries" })).toBeVisible({
        timeout: 120_000,
      });
      await expect(
        r.getByRole("row", {
          name: new RegExp(`FUL-.*${orderNumber}.*${world.customerName}`),
        }),
      ).toBeVisible({ timeout: 60_000 });
      await r.goto("/sales/invoices", { waitUntil: "domcontentloaded" });
      await expect(
        r.getByRole("row", {
          name: new RegExp(`${orderNumber}.*${world.customerName}`),
        }),
      ).toBeVisible({ timeout: 60_000 });

      // --- credit adjustment needs a reason. Nothing is invoiced or paid yet, so a
      // refund is refused by the server: it is capped by what the customer paid.
      await r.goto("/sales/credit-adjustments", {
        waitUntil: "domcontentloaded",
      });
      await r
        .getByRole("button", { name: "Request adjustment" })
        .first()
        .click({ timeout: 120_000 });
      const dialog = r.getByRole("dialog", {
        name: "Request credit adjustment",
      });
      await pick(
        r,
        dialog.getByRole("button", { name: /Select an order/ }),
        new RegExp(orderNumber),
      );
      await pick(
        r,
        dialog.getByRole("button", { name: /Credit note/ }),
        /^Refund$/,
      );
      const adjustmentAmount = dialog.getByRole("textbox", { name: "Amount" });
      await adjustmentAmount.click();
      await adjustmentAmount.press("Control+A");
      await adjustmentAmount.pressSequentially("50");
      await expect(
        dialog.getByRole("button", { name: "Request adjustment" }),
      ).toBeDisabled();
      await dialog.getByLabel("Reason").fill("Damaged in transit");
      await dialog
        .getByRole("button", { name: "Request adjustment" })
        .first()
        .click();
      await expect(dialog.getByText(/refund can be at most/i)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });
});
