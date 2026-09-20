import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// Stock-linked delivery journey: a stock-tracked line is reserved from real
// balances, delivered in two parts (the first short), and the shortfall shows in
// the backorder register until the second delivery clears it. The order is
// seeded through the real API as the real personas.
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const origin = new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
  const response = await context.request.fetch(`${origin}/api/sales${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
}

async function clickUntil(page: Page, click: () => Promise<void>, done: () => Promise<void>) {
  await expect(async () => {
    await click();
    await done();
  }).toPass({ timeout: 30_000 });
}

test.describe("Sales deliveries and backorders", () => {
  test("reserve stock, deliver in two parts, backorder appears then clears", async ({ browser }) => {
    test.setTimeout(420_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    const manager = await openSalesSession(browser, world.manager);
    try {
      const options = await api<{ options: { parties: Array<{ id: string; display_name: string }>; items: Array<{ id: string; code: string }>; priceLists: Array<{ id: string; name: string }>; warehouses: Array<{ id: string; code: string }> } }>(rep.context, "GET", "/options");
      const party = options.options.parties.find((p) => p.display_name === world.customerName)!;
      const item = options.options.items.find((i) => i.code === world.stockItemCode)!;
      const priceList = options.options.priceLists.find((p) => p.name === "Sales E2E Price List")!;
      const warehouse = options.options.warehouses.find((w) => w.code === world.warehouseCode)!;

      const created = await api<{ order: { id: string; sales_order_number: string } }>(rep.context, "POST", "/orders", { partyId: party.id, currencyCode: "INR", priceListId: priceList.id, lines: [{ itemId: item.id, quantity: 4, warehouseId: warehouse.id }] });
      const orderId = created.order.id;
      const orderNumber = created.order.sales_order_number;
      await api(rep.context, "POST", `/orders/${orderId}/submit`, {});
      await api(manager.context, "POST", `/orders/${orderId}/confirm`, {});

      // --- reserve from stock through the UI
      const r = rep.page;
      await r.goto(`/sales/orders/${orderId}`, { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 120_000 });
      await r.getByRole("button", { name: "Stock", exact: true }).click();
      const stock = r.getByRole("dialog", { name: /Stock for/ });
      await expect(stock.getByText("4 can be promised from stock.")).toBeVisible({ timeout: 60_000 });
      await stock.getByRole("button", { name: "Reserve stock" }).click();
      await expect(r.getByText("Stock reserved.")).toBeVisible({ timeout: 30_000 });

      // --- request fulfilment, then deliver 3 of 4
      await r.getByRole("button", { name: "Request fulfilment" }).click();
      await expect(r.getByText("Fulfilment requested.")).toBeVisible({ timeout: 30_000 });
      await r.goto("/sales/deliveries", { waitUntil: "domcontentloaded" });
      const row = r.getByRole("row", { name: new RegExp(`FUL-.*${orderNumber}`) });
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
      await expect(r.getByRole("row", { name: new RegExp(`FUL-.*${orderNumber}.*Completed`) })).toBeVisible({ timeout: 60_000 });

      // --- the shortfall is a backorder of exactly 1
      await r.goto("/sales/backorders", { waitUntil: "domcontentloaded" });
      const backorder = r.getByRole("row", { name: new RegExp(`${orderNumber}.*${world.stockItemName}`) });
      await expect(backorder).toBeVisible({ timeout: 60_000 });
      await expect(backorder).toContainText(/4\s*3\s*1/);

      // --- a second request delivers the rest; the backorder clears
      await r.goto(`/sales/orders/${orderId}`, { waitUntil: "domcontentloaded" });
      await clickUntil(
        r,
        () => r.getByRole("button", { name: "Request fulfilment" }).click({ timeout: 5_000 }),
        () => expect(r.getByText("Fulfilment requested.")).toBeVisible({ timeout: 5_000 }),
      );
      await r.goto("/sales/deliveries", { waitUntil: "domcontentloaded" });
      const pending = r.getByRole("row", { name: new RegExp(`FUL-.*${orderNumber}.*Pending`) });
      await expect(pending).toBeVisible({ timeout: 60_000 });
      await pending.getByRole("button", { name: "Complete delivery" }).click();
      const second = r.getByRole("dialog", { name: /Complete delivery FUL-/ });
      await expect(second.getByRole("textbox", { name: /remaining/ })).toBeVisible({ timeout: 60_000 });
      await second.getByRole("button", { name: "Complete delivery" }).click();
      await expect(pending).toHaveCount(0, { timeout: 60_000 });
      await r.goto("/sales/backorders", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "Backorders" })).toBeVisible({ timeout: 60_000 });
      await expect(r.getByRole("row", { name: new RegExp(orderNumber) })).toHaveCount(0);
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });
});
