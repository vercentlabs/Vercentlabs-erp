import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { getInventoryWorld } from "./inventory-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Costing and reports as real roles: FIFO cost of an issue, valuation, aging, movement, CSV export,
// and that the cost reports are closed to a view-only user.
const origin = () => new URL(BASE_URL).origin;
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const response = await context.request.fetch(`${origin()}/api/inventory${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}

test("FIFO costing, valuation, aging, movement and CSV export; cost reports are closed to a view-only user", async ({ browser }) => {
  test.setTimeout(600_000);
  const world = await getInventoryWorld();
  const manager = await openSession(browser, world.manager);
  const viewer = await openSession(browser, world.viewer);
  try {
    const stamp = Date.now().toString(36).toUpperCase();
    const uom = (await api<{ rows: Array<{ id: string; code: string }> }>(manager.context, "GET", "/master/units-of-measure")).rows.find((u) => u.code === "EA")!;
    const wh = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/warehouses", { code: `VW-${stamp}`, name: `Value WH ${stamp}` })).record;
    const code = `FI-${stamp}`;
    const item = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/items", { code, name: `Fifo Item ${stamp}`, uomId: uom.id, valuationMethod: "fifo" })).record;
    const receive = (quantity: number, unitCost: number, key: string) => api(manager.context, "POST", "/actions/movement", { movementType: "receipt", itemId: item.id, warehouseId: wh.id, quantity, unitCost, idempotencyKey: `${key}-${stamp}` });
    await receive(10, 2, "r1");
    await receive(10, 4, "r2");
    const issue = await api<{ record: { unit_cost: string } }>(manager.context, "POST", "/actions/movement", { movementType: "issue", itemId: item.id, warehouseId: wh.id, quantity: 12, idempotencyKey: `i1-${stamp}` });
    expect(Number(issue.record.unit_cost)).toBeCloseTo((10 * 2 + 2 * 4) / 12, 4); // oldest layer first

    const m = manager.page;
    await open(m, "/inventory/valuation", "Inventory valuation");
    // 8 units left, all from the newer layer at 4.00 -> 32.00
    const row = m.getByRole("row", { name: new RegExp(`${code}.*Value WH ${stamp}.*Fifo.*8.*32`) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(m.getByText("Total stock value")).toBeVisible();

    // CSV export carries the item and its value
    const download = m.waitForEvent("download");
    await m.getByRole("button", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("valuation.csv");
    const content = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
    expect(content).toContain("Stock value");
    expect(content).toContain(code);

    await open(m, "/inventory/aging", "Stock aging");
    await expect(m.getByRole("row", { name: new RegExp(`${code}.*Value WH ${stamp}.*8`) })).toBeVisible({ timeout: 60_000 });
    await open(m, "/inventory/movement", "Stock movement");
    await expect(m.getByRole("row", { name: new RegExp(`${code}.*20.*12`) })).toBeVisible({ timeout: 60_000 }); // received 20, issued 12
    await open(m, "/inventory/landed-cost", "Landed cost");
    await open(m, "/inventory/reports", "Inventory reports");
    await expect(m.getByRole("link", { name: /Inventory valuation/ })).toBeVisible();

    // a view-only user cannot see valuation, and the API says so
    await open(viewer.page, "/inventory/valuation", /Inventory valuation|You don't have access to Inventory/);
    await expect(viewer.page.getByText("You don't have access to Inventory")).toBeVisible({ timeout: 60_000 });
    const denied = await viewer.context.request.fetch(`${origin()}/api/inventory/stock/valuation`, { method: "GET" });
    expect(denied.status()).toBe(403);
  } finally {
    await manager.context.close();
    await viewer.context.close();
  }
});
