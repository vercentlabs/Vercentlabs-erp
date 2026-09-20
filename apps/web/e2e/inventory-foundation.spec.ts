import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getInventoryWorld } from "./inventory-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Inventory foundations as real roles: item master, warehouses, receipts/issues/adjustments,
// transfers, reservations, lots/expiry, reorder rules -- and what the narrower roles cannot do.
const origin = () => new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;

async function api<T>(context: BrowserContext, method: "GET" | "POST" | "PATCH", path: string, data?: unknown, expectOk = true): Promise<{ status: number; body: T }> {
  const response = await context.request.fetch(`${origin()}/api/inventory${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  if (expectOk) expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return { status: response.status(), body };
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

type Rec = { record: { id: string } };

test.describe("Inventory foundations", () => {
  test("manager runs item -> warehouse -> receipt -> availability -> issue -> adjustment -> transfer -> reservation -> lot -> reorder rule", async ({ browser }) => {
    test.setTimeout(900_000);
    const world = await getInventoryWorld();
    const manager = await openSession(browser, world.manager);
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      const itemCode = `INV-${stamp}`;
      const itemName = `Inv Widget ${stamp}`;
      const m = manager.page;

      // --- warehouses (UI): two, so a transfer has somewhere to go
      await open(m, "/inventory/warehouses", "Warehouses");
      for (const [code, warehouseName] of [[`W1-${stamp}`, `Main ${stamp}`], [`W2-${stamp}`, `Overflow ${stamp}`]]) {
        await m.getByRole("button", { name: "Add warehouse" }).click();
        const dialog = m.getByRole("dialog", { name: "Add warehouse" });
        await dialog.getByLabel(/^Code/).fill(code);
        await dialog.getByLabel(/^Name/).fill(warehouseName);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(m.getByRole("row", { name: new RegExp(warehouseName) })).toBeVisible({ timeout: 30_000 });
      }

      // --- item (UI): validation first (a unit is required), then a real save
      await open(m, "/inventory/items", "Items");
      await m.getByRole("button", { name: "Add item" }).click();
      const itemDialog = m.getByRole("dialog", { name: "Add item" });
      await itemDialog.getByLabel(/^Code/).fill(itemCode);
      await itemDialog.getByLabel(/^Name/).fill(itemName);
      await expect(itemDialog.getByRole("button", { name: "Save" })).toBeDisabled(); // unit of measure missing
      await pick(m, itemDialog.getByRole("button", { name: /Select unit of measure/ }), /Each|EA/);
      await itemDialog.getByRole("button", { name: "Save" }).click();
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*${itemName}`) })).toBeVisible({ timeout: 30_000 });
      // a duplicate code is refused with a readable message
      await m.getByRole("button", { name: "Add item" }).click();
      const dup = m.getByRole("dialog", { name: "Add item" });
      await dup.getByLabel(/^Code/).fill(itemCode);
      await dup.getByLabel(/^Name/).fill("Duplicate");
      await pick(m, dup.getByRole("button", { name: /Select unit of measure/ }), /Each|EA/);
      await dup.getByRole("button", { name: "Save" }).click();
      await expect(dup.getByRole("alert")).toBeVisible({ timeout: 30_000 });
      await dup.getByRole("button", { name: "Close" }).last().click();

      // --- receipt of 20 @ 5 (UI)
      await open(m, "/inventory/receipts", "Stock receipts");
      await m.getByRole("button", { name: "Record receipt" }).click();
      const receipt = m.getByRole("dialog", { name: "Record receipt" });
      await pick(m, receipt.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, receipt.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Main ${stamp}`));
      await setNumber(receipt.getByRole("textbox", { name: /^Quantity/ }), "20");
      await setNumber(receipt.getByRole("textbox", { name: /^Unit cost/ }), "5");
      await receipt.getByRole("button", { name: "Save" }).click();
      await expect(m.getByText("Receipt recorded.")).toBeVisible({ timeout: 30_000 });
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*Main ${stamp}.*20`) })).toBeVisible({ timeout: 30_000 });

      // --- availability + scan
      await open(m, "/inventory/availability", "Stock availability");
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*20.*0.*20`) })).toBeVisible({ timeout: 30_000 });
      await m.getByLabel(/^Code/).fill(itemCode);
      await m.getByRole("button", { name: "Look up" }).click();
      await expect(m.getByRole("status", { name: "Lookup result" })).toContainText(/Available 20/, { timeout: 30_000 });
      await m.getByLabel(/^Code/).fill("NO-SUCH-CODE-XYZ");
      await m.getByRole("button", { name: "Look up" }).click();
      await expect(m.getByRole("alert").filter({ hasText: /Nothing matches/ })).toBeVisible({ timeout: 30_000 });

      // --- issue 5, and an over-issue is refused
      await open(m, "/inventory/issues", "Stock issues");
      await m.getByRole("button", { name: "Record issue" }).click();
      const issue = m.getByRole("dialog", { name: "Record issue" });
      await pick(m, issue.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, issue.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Main ${stamp}`));
      await setNumber(issue.getByRole("textbox", { name: /^Quantity/ }), "500");
      await issue.getByRole("button", { name: "Save" }).click();
      await expect(issue.getByRole("alert")).toContainText(/Insufficient/i, { timeout: 30_000 });
      await setNumber(issue.getByRole("textbox", { name: /^Quantity/ }), "5");
      await issue.getByRole("button", { name: "Save" }).click();
      await expect(m.getByText("Issue recorded.")).toBeVisible({ timeout: 30_000 });

      // --- adjustment: reason is mandatory
      await open(m, "/inventory/adjustments", "Stock adjustments");
      await m.getByRole("button", { name: "Record adjustment" }).click();
      const adjust = m.getByRole("dialog", { name: "Record adjustment" });
      await pick(m, adjust.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, adjust.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Main ${stamp}`));
      await pick(m, adjust.getByRole("button", { name: /Increase stock|Select direction/ }), /Decrease stock/);
      await setNumber(adjust.getByRole("textbox", { name: /^Quantity/ }), "2");
      await expect(adjust.getByRole("button", { name: "Save" })).toBeDisabled(); // reason missing
      await adjust.getByLabel(/^Reason/).fill("Damaged in handling");
      await adjust.getByRole("button", { name: "Save" }).click();
      await expect(m.getByText("Adjustment recorded.")).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/availability", "Stock availability");
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*13`) })).toBeVisible({ timeout: 30_000 }); // 20 - 5 - 2 = 13

      // --- transfer 4 to the other warehouse, then complete it
      await open(m, "/inventory/transfers", "Stock transfers");
      await m.getByRole("button", { name: "New transfer" }).click();
      const transfer = m.getByRole("dialog", { name: "New transfer" });
      await pick(m, transfer.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, transfer.getByRole("button", { name: /Select from warehouse/ }), new RegExp(`Main ${stamp}`));
      await pick(m, transfer.getByRole("button", { name: /Select to warehouse/ }), new RegExp(`Overflow ${stamp}`));
      await setNumber(transfer.getByRole("textbox", { name: /^Quantity/ }), "4");
      await transfer.getByRole("button", { name: "Save" }).click();
      const draft = m.getByRole("row", { name: new RegExp(`Draft.*${itemCode}.*Main ${stamp}.*Overflow ${stamp}`) });
      await expect(draft).toBeVisible({ timeout: 30_000 });
      await draft.getByRole("button", { name: "Complete" }).click();
      await expect(m.getByRole("row", { name: new RegExp(`Completed.*${itemCode}.*Overflow ${stamp}`) })).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/availability", "Stock availability");
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*Overflow ${stamp}.*4`) })).toBeVisible({ timeout: 30_000 });

      // --- reservation of 3 from Main, then release
      await open(m, "/inventory/reservations", "Reservations");
      await m.getByRole("button", { name: "Reserve stock" }).click();
      const reserve = m.getByRole("dialog", { name: "Reserve stock" });
      await pick(m, reserve.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, reserve.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Main ${stamp}`));
      await setNumber(reserve.getByRole("textbox", { name: /^Quantity/ }), "3");
      await reserve.getByRole("button", { name: "Save" }).click();
      const held = m.getByRole("row", { name: new RegExp(`${itemCode}.*Main ${stamp}.*3`) }).first();
      await expect(held).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/availability", "Stock availability");
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*Main ${stamp}.*9.*3.*6`) })).toBeVisible({ timeout: 30_000 }); // 9 on hand, 3 reserved, 6 available
      await open(m, "/inventory/reservations", "Reservations");
      await m.getByRole("row", { name: new RegExp(`Active.*${itemCode}`) }).getByRole("button", { name: "Release" }).click();
      await expect(m.getByText("Reservation released.")).toBeVisible({ timeout: 30_000 });

      // --- lots: a batch item (API setup), a batch via the UI, block with a reason, expiry view
      const uom = (await api<{ rows: Array<{ id: string; code: string }> }>(manager.context, "GET", "/master/units-of-measure")).body.rows.find((u) => u.code === "EA")!;
      const lotCode = `LOT-${stamp}`;
      await api<Rec>(manager.context, "POST", "/master/items", { code: lotCode, name: `Lotted ${stamp}`, uomId: uom.id, trackingType: "batch" });
      await open(m, "/inventory/lots", "Lots and batches");
      await m.getByRole("button", { name: "Add batch" }).click();
      const batch = m.getByRole("dialog", { name: "Add batch" });
      await pick(m, batch.getByRole("button", { name: /Select item/ }), new RegExp(lotCode));
      await batch.getByLabel("Batch / lot number").fill(`B-${stamp}`);
      const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      await batch.getByLabel("Expires on").fill(soon);
      await batch.getByRole("button", { name: "Save" }).click();
      const batchRow = m.getByRole("row", { name: new RegExp(`B-${stamp}.*Active`) });
      await expect(batchRow).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/expiry", "Expiry");
      await expect(m.getByRole("row", { name: new RegExp(`B-${stamp}.*5`) })).toBeVisible({ timeout: 30_000 });
      await m.getByRole("row", { name: new RegExp(`B-${stamp}`) }).getByRole("button", { name: "Block" }).click();
      const block = m.getByRole("dialog", { name: "Block" });
      await expect(block.getByRole("button", { name: "Block" })).toBeDisabled(); // reason required
      await block.getByLabel(/^Reason/).fill("Supplier recall");
      await block.getByRole("button", { name: "Block" }).click();
      await expect(m.getByText("Batch blocked.")).toBeVisible({ timeout: 30_000 });
      await expect(m.getByRole("row", { name: new RegExp(`B-${stamp}.*Blocked`) })).toBeVisible({ timeout: 30_000 });

      // --- reorder rule -> replenishment
      await open(m, "/inventory/reorder-rules", "Reorder rules");
      await m.getByRole("button", { name: "Add rule" }).click();
      const rule = m.getByRole("dialog", { name: "Add rule" });
      await pick(m, rule.getByRole("button", { name: /Select item/ }), new RegExp(itemCode));
      await pick(m, rule.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Main ${stamp}`));
      await setNumber(rule.getByRole("textbox", { name: /^Minimum/ }), "50");
      await setNumber(rule.getByRole("textbox", { name: /^Safety/ }), "10");
      await setNumber(rule.getByRole("textbox", { name: /^Reorder quantity/ }), "40");
      await rule.getByRole("button", { name: "Save" }).click();
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*Main ${stamp}.*50.*10`) })).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/replenishment", "Replenishment");
      await expect(m.getByRole("row", { name: new RegExp(`${itemCode}.*40`) })).toBeVisible({ timeout: 60_000 });

      // --- the ledger recorded all of it; costing settings save
      await open(m, "/inventory/ledger", "Stock ledger");
      await expect(m.getByRole("row", { name: new RegExp(`Issue.*${itemCode}.*-5`) })).toBeVisible({ timeout: 30_000 });
      await open(m, "/inventory/costing", "Costing and settings");
      await m.getByRole("button", { name: "Save settings" }).click();
      await expect(m.getByText("Settings saved.")).toBeVisible({ timeout: 30_000 });
    } finally {
      await manager.context.close();
    }
  });

  test("narrower roles: an issuer cannot receive or edit master data; a viewer can only look", async ({ browser }) => {
    test.setTimeout(600_000);
    const world = await getInventoryWorld();
    const issuer = await openSession(browser, world.issuer);
    const viewer = await openSession(browser, world.viewer);
    try {
      // issuer (pos_supervisor): issue + view
      await open(issuer.page, "/inventory/issues", "Stock issues");
      await expect(issuer.page.getByRole("button", { name: "Record issue" })).toBeVisible();
      await open(issuer.page, "/inventory/receipts", "Stock receipts");
      await expect(issuer.page.getByRole("button", { name: "Record receipt" })).toHaveCount(0);
      await open(issuer.page, "/inventory/items", "Items");
      await expect(issuer.page.getByRole("button", { name: "Add item" })).toHaveCount(0);

      // the server refuses even when the buttons are bypassed
      const receipt = await api<{ message?: string }>(issuer.context, "POST", "/actions/movement", { movementType: "receipt", itemId: crypto.randomUUID(), warehouseId: crypto.randomUUID(), quantity: 1 }, false);
      expect(receipt.status).toBe(403);
      const master = await api<{ message?: string }>(issuer.context, "POST", "/master/items", { code: "NOPE", name: "Nope", uomId: crypto.randomUUID() }, false);
      expect(master.status).toBe(403);

      // viewer (pos_cashier): view only, and no cost is shown
      await open(viewer.page, "/inventory/availability", "Stock availability");
      await expect(viewer.page.getByRole("button", { name: /Record|Add|New/ })).toHaveCount(0);
      const settings = await api<{ message?: string }>(viewer.context, "POST", "/actions/settings", { costingMethod: "fifo" }, false);
      expect(settings.status).toBe(403);
      const balances = await api<{ rows: Array<{ average_cost: string | null; stock_value: string | null }> }>(viewer.context, "GET", "/stock/balances");
      for (const row of balances.body.rows) {
        expect(row.average_cost).toBeNull();
        expect(row.stock_value).toBeNull();
      }
    } finally {
      await issuer.context.close();
      await viewer.context.close();
    }
  });
});
