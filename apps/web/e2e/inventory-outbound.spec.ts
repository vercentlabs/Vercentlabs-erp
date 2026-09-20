import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getInventoryWorld } from "./inventory-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Outbound (pick -> pack -> ship), damaged stock, quarantined returns and batch genealogy as a real role.
const origin = () => new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const response = await context.request.fetch(`${origin()}/api/inventory${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}

test("pick, short-pick, pack, ship; write-off; quarantined return; batch genealogy", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getInventoryWorld();
  const manager = await openSession(browser, world.manager);
  try {
    const stamp = Date.now().toString(36).toUpperCase();
    const uom = (await api<{ rows: Array<{ id: string; code: string }> }>(manager.context, "GET", "/master/units-of-measure")).rows.find((u) => u.code === "EA")!;
    const wh = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/warehouses", { code: `OW-${stamp}`, name: `Out WH ${stamp}` })).record;
    const bin = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/warehouse-locations", { warehouseId: wh.id, code: "BIN1", name: "Shelf 1", locationType: "bin" })).record;
    const quarantine = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/warehouse-locations", { warehouseId: wh.id, code: "QRN", name: "Quarantine", locationType: "quality" })).record;
    const itemCode = `OI-${stamp}`;
    const item = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/items", { code: itemCode, name: `Out Item ${stamp}`, uomId: uom.id })).record;
    await api(manager.context, "POST", "/actions/movement", { movementType: "receipt", itemId: item.id, warehouseId: wh.id, warehouseLocationId: bin.id, quantity: 10, unitCost: 4, idempotencyKey: `seed-${stamp}` });

    const m = manager.page;
    // --- pick list for 6
    await open(m, "/inventory/pick-lists", "Picking, packing and shipping");
    await m.getByRole("button", { name: "New pick list" }).click();
    const dialog = m.getByRole("dialog", { name: "New pick list" });
    await pick(m, dialog.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Out WH ${stamp}`));
    await dialog.getByLabel(/^For order/).fill(`SO-${stamp}`);
    await pick(m, dialog.getByRole("button", { name: /Select item/ }).first(), new RegExp(itemCode));
    await setNumber(dialog.getByRole("textbox", { name: /^Quantity/ }), "6");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Pick list created.")).toBeVisible({ timeout: 30_000 });
    const row = m.getByRole("row", { name: new RegExp(`PCK-.*Open.*SO-${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    // the request is reserved immediately
    const reserved = await api<{ availability: { reservedQuantity: string; availableQuantity: string } }>(manager.context, "GET", `/stock/availability?itemId=${item.id}&warehouseId=${wh.id}`);
    expect(Number(reserved.availability.reservedQuantity)).toBe(6);
    await row.getByRole("link").click();
    await expect(m).toHaveURL(/\/inventory\/picking\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // --- pick only 4: a short pick needs a reason
    await setNumber(m.getByRole("textbox", { name: `Picked ${itemCode}` }), "4");
    await m.getByRole("button", { name: "Save picks" }).click();
    await expect(m.getByRole("alert").filter({ hasText: /short pick needs a reason/i })).toBeVisible({ timeout: 30_000 });
    await m.getByRole("textbox", { name: `Short reason ${itemCode}` }).fill("Two damaged on the shelf");
    await m.getByRole("button", { name: "Save picks" }).click();
    await expect(m.getByText("Picks saved.")).toBeVisible({ timeout: 30_000 });
    await m.getByRole("button", { name: "Complete picking" }).click();
    await expect(m.getByText("Picking complete.")).toBeVisible({ timeout: 30_000 });
    const freed = await api<{ availability: { reservedQuantity: string } }>(manager.context, "GET", `/stock/availability?itemId=${item.id}&warehouseId=${wh.id}`);
    expect(Number(freed.availability.reservedQuantity)).toBe(4); // the 2 not found are released

    // --- pack: cannot complete before everything is in a package, then ship
    await m.getByRole("button", { name: "Complete packing" }).click();
    await expect(m.getByRole("alert").filter({ hasText: /not fully packed/i })).toBeVisible({ timeout: 30_000 });
    await setNumber(m.getByRole("textbox", { name: `Pack ${itemCode}` }), "4");
    await m.getByRole("button", { name: "Create package" }).click();
    await expect(m.getByText("Package created.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("list", { name: "Packages" })).toContainText("PKG-1");
    await m.getByRole("button", { name: "Complete packing" }).click();
    await expect(m.getByText("Packing complete.")).toBeVisible({ timeout: 30_000 });
    await m.getByRole("button", { name: "Ship", exact: true }).click();
    const ship = m.getByRole("dialog", { name: "Ship" });
    await ship.getByLabel(/^Carrier/).fill("BlueDart");
    await ship.getByLabel(/^Tracking/).fill(`BD-${stamp}`);
    await ship.getByRole("button", { name: "Confirm shipment" }).click();
    await expect(m.getByText(/Shipped\. Stock has left/)).toBeVisible({ timeout: 30_000 });
    const after = await api<{ availability: { onHandQuantity: string; reservedQuantity: string } }>(manager.context, "GET", `/stock/availability?itemId=${item.id}&warehouseId=${wh.id}`);
    expect(Number(after.availability.onHandQuantity)).toBe(6); // 10 - 4 shipped
    expect(Number(after.availability.reservedQuantity)).toBe(0);

    // --- write-off of 1
    await open(m, "/inventory/damaged-stock", "Damaged stock");
    await m.getByRole("button", { name: "Record write-off" }).click();
    const wo = m.getByRole("dialog", { name: "Record write-off" });
    await pick(m, wo.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
    await pick(m, wo.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Out WH ${stamp}`));
    // the stock is in a bin: without choosing it the write-off is refused with a message that says so
    await setNumber(wo.getByRole("textbox", { name: /^Quantity/ }), "1");
    await wo.getByLabel(/^What happened/).fill("Dropped from the rack");
    await wo.getByRole("button", { name: "Save" }).click();
    await expect(wo.getByRole("alert")).toContainText(/choose the location/i, { timeout: 30_000 });
    await pick(m, wo.getByRole("button", { name: /Select location/ }), /Shelf 1/);
    await setNumber(wo.getByRole("textbox", { name: /^Quantity/ }), "1");
    await wo.getByLabel(/^What happened/).fill("Dropped from the rack");
    await wo.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Write-off recorded.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*-1.*Write-off \\(damaged\\)`) })).toBeVisible({ timeout: 30_000 });

    // --- a damaged return is refused outside quarantine, accepted into it, and then listed there
    await open(m, "/inventory/returns", "Stock returns");
    await m.getByRole("button", { name: "Record return" }).click();
    const ret = m.getByRole("dialog", { name: "Record return" });
    await pick(m, ret.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
    await pick(m, ret.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Out WH ${stamp}`));
    await setNumber(ret.getByRole("textbox", { name: /^Quantity/ }), "2");
    await pick(m, ret.getByRole("button", { name: /Good — restock/ }), /Damaged — quarantine/);
    await ret.getByLabel(/^Reason/).fill("Box crushed in transit");
    await ret.getByRole("button", { name: "Save" }).click();
    await expect(ret.getByRole("alert")).toContainText(/quarantine/i, { timeout: 30_000 });
    await pick(m, ret.getByRole("button", { name: /Select location/ }), /Quarantine/);
    await ret.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Return recorded.")).toBeVisible({ timeout: 30_000 });
    await open(m, "/inventory/quarantine", "Quarantine");
    await expect(m.getByRole("list", { name: "Quarantine locations" })).toContainText(itemCode, { timeout: 30_000 });
    void quarantine;

    // --- genealogy of a batch: received then issued
    const lotItem = (await api<{ record: { id: string } }>(manager.context, "POST", "/master/items", { code: `OL-${stamp}`, name: `Out Lot ${stamp}`, uomId: uom.id, trackingType: "batch" })).record;
    const batch = (await api<{ record: { id: string } }>(manager.context, "POST", "/actions/batch", { itemId: lotItem.id, batchNumber: `G-${stamp}` })).record;
    await api(manager.context, "POST", "/actions/movement", { movementType: "receipt", itemId: lotItem.id, warehouseId: wh.id, batchId: batch.id, quantity: 8, unitCost: 1, idempotencyKey: `g1-${stamp}` });
    await api(manager.context, "POST", "/actions/movement", { movementType: "issue", itemId: lotItem.id, warehouseId: wh.id, batchId: batch.id, quantity: 3, idempotencyKey: `g2-${stamp}` });
    await open(m, "/inventory/genealogy", "Genealogy");
    await m.getByLabel(/^Batch or serial number/).fill(`g-${stamp}`);
    await m.getByRole("button", { name: "Trace" }).click();
    const history = m.getByRole("list", { name: "Movement history" });
    await expect(history.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
    await expect(history).toContainText(/Receipt 8/);
    await expect(history).toContainText(/Issue -3/);
  } finally {
    await manager.context.close();
  }
});
