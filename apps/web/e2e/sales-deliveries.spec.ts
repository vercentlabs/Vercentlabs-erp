import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Stock-linked delivery journey: a stock-tracked line is reserved from real
// balances, delivered in two parts (the first short), and Order Status shows it
// partly delivered until the second delivery completes it. The order is
// seeded through the real API as the real personas.
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

async function clickUntil(
  page: Page,
  click: () => Promise<void>,
  done: () => Promise<void>,
) {
  await expect(async () => {
    await click();
    await done();
  }).toPass({ timeout: 30_000 });
}

test.describe("Sales deliveries", () => {
  test("reserve stock, deliver in two parts, order status follows", async ({
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
          warehouses: Array<{ id: string; code: string }>;
        };
      }>(rep.context, "GET", "/options");
      const party = options.options.parties.find(
        (p) => p.display_name === world.customerName,
      )!;
      const item = options.options.items.find(
        (i) => i.code === world.stockItemCode,
      )!;
      const priceList = options.options.priceLists.find(
        (p) => p.name === "Sales E2E Price List",
      )!;
      const warehouse = options.options.warehouses.find(
        (w) => w.code === world.warehouseCode,
      )!;

      const created = await api<{
        order: { id: string; sales_order_number: string };
      }>(rep.context, "POST", "/orders", {
        partyId: party.id,
        billingAddressId: world.customerBillingAddressId,
        currencyCode: "INR",
        priceListId: priceList.id,
        lines: [{ itemId: item.id, quantity: 4, warehouseId: warehouse.id }],
      });
      const orderId = created.order.id;
      const orderNumber = created.order.sales_order_number;
      await api(rep.context, "POST", `/orders/${orderId}/submit`, {});
      await api(manager.context, "POST", `/orders/${orderId}/confirm`, {});

      // --- reserve from stock through the UI
      const r = rep.page;
      await r.goto(`/sales/orders/${orderId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(r.getByRole("heading", { name: orderNumber })).toBeVisible({
        timeout: 120_000,
      });
      await r.getByRole("button", { name: "Stock", exact: true }).click();
      const stock = r.getByRole("dialog", { name: /Stock for/ });
      // The line needs 4 units and they can be promised from stock (F045/F046 availability facts).
      await expect(stock.getByText(/\(4 units\)/)).toBeVisible({
        timeout: 60_000,
      });
      const reserveStock = stock.getByRole("button", { name: "Reserve stock" });
      await expect(reserveStock).toBeEnabled();
      await reserveStock.click();
      await expect(r.getByText("Stock reserved.")).toBeVisible({
        timeout: 30_000,
      });

      // --- request fulfilment, then deliver 3 of 4
      await r.getByRole("button", { name: "Request fulfilment" }).click();
      await expect(r.getByText("Fulfilment requested.")).toBeVisible({
        timeout: 30_000,
      });
      await r.goto("/sales/deliveries", { waitUntil: "domcontentloaded" });
      const row = r.getByRole("row", {
        name: new RegExp(`FUL-.*${orderNumber}`),
      });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.getByRole("button", { name: "Complete delivery" }).click();
      const dialog = r.getByRole("dialog", { name: /Complete delivery FUL-/ });
      const shipped = dialog.getByRole("textbox", { name: /remaining/ });
      await expect(shipped).toBeVisible({ timeout: 60_000 });
      await shipped.click();
      await shipped.press("Control+A");
      await shipped.pressSequentially("3");
      await shipped.blur();
      await dialog.getByRole("button", { name: "Complete delivery" }).click();
      await expect(
        r.getByRole("row", {
          name: new RegExp(`FUL-.*${orderNumber}.*Completed`),
        }),
      ).toBeVisible({ timeout: 60_000 });

      // --- the shortfall leaves the order partly delivered
      const m = manager.page;
      await m.goto("/sales/order-status", { waitUntil: "domcontentloaded" });
      await expect(
        m.getByRole("row", {
          name: new RegExp(`${orderNumber}.*Partly delivered`),
        }),
      ).toBeVisible({ timeout: 60_000 });

      // --- a second request delivers the rest
      await r.goto(`/sales/orders/${orderId}`, {
        waitUntil: "domcontentloaded",
      });
      await clickUntil(
        r,
        () =>
          r
            .getByRole("button", { name: "Request fulfilment" })
            .click({ timeout: 5_000 }),
        () =>
          expect(r.getByText("Fulfilment requested.")).toBeVisible({
            timeout: 5_000,
          }),
      );
      await r.goto("/sales/deliveries", { waitUntil: "domcontentloaded" });
      const pending = r.getByRole("row", {
        name: new RegExp(`FUL-.*${orderNumber}.*Pending`),
      });
      await expect(pending).toBeVisible({ timeout: 60_000 });
      await pending.getByRole("button", { name: "Complete delivery" }).click();
      const second = r.getByRole("dialog", { name: /Complete delivery FUL-/ });
      await expect(
        second.getByRole("textbox", { name: /remaining/ }),
      ).toBeVisible({ timeout: 60_000 });
      await second.getByRole("button", { name: "Complete delivery" }).click();
      await expect(pending).toHaveCount(0, { timeout: 60_000 });
      await m.goto("/sales/order-status", { waitUntil: "domcontentloaded" });
      await expect(
        m.getByRole("row", {
          name: new RegExp(`${orderNumber}.*Delivered`),
        }),
      ).toBeVisible({ timeout: 60_000 });
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });
});
