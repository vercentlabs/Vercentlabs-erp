import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Shop floor as real people: settings, an order released with reserved components, work through the
// routing, material issue, backflush, production report, scrap and rework -- and what a view-only
// role cannot do. Stock is checked in the database, not on trust.
const origin = () => new URL(BASE_URL).origin;
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown, expectOk = true): Promise<{ status: number; body: T }> {
  const response = await context.request.fetch(`${origin()}/api/manufacturing${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  if (expectOk) expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return { status: response.status(), body };
}
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible()) && (await trigger.count()) === 0) return;
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

async function onHand(organizationId: string, itemId: string, warehouseId: string) {
  const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const r = await db.query(`SELECT COALESCE(sum(quantity),0) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [organizationId, itemId, warehouseId]);
    await db.query("COMMIT");
    return Number(r.rows[0].q);
  } finally {
    await db.end();
  }
}

test("release, work the routing, issue, backflush, report production, scrap and rework; view-only is read-only", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const approver = await openSession(browser, world.approver);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix, warehouse, organizationId, companyId } = world;
    // components in stock: A 100 @ 5, B 50 @ 10 (seeded as balances; the ledger takes over from here)
    const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
      for (const [item, qty, cost] of [[items.compA.id, 100, 5], [items.compB.id, 50, 10]] as const) await db.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,$5,0,$6)`, [organizationId, companyId, item, warehouse.id, qty, cost]);
      await db.query("COMMIT");
    } finally {
      await db.end();
    }

    // definition via the API: work center, BOM (A backflushed, B manual), routing with two operations
    const wc = await api<Rec>(manager.context, "POST", "/actions/work-center-save", { code: `PWC-${suffix}`, name: `Line ${suffix}`, hourlyRate: 60, overheadRate: 30 });
    const bom = await api<Rec>(manager.context, "POST", "/actions/bom-create", { itemId: items.finished.id, code: `PB-${suffix}`, components: [{ itemId: items.compA.id, quantity: 2, issueMethod: "backflush" }, { itemId: items.compB.id, quantity: 1 }] });
    await api(manager.context, "POST", "/actions/bom-submit", { id: bom.body.record.id });
    await api(approver.context, "POST", "/actions/bom-approve", { id: bom.body.record.id });
    const routing = await api<Rec>(manager.context, "POST", "/actions/routing-create", { code: `PR-${suffix}`, name: `Routing ${suffix}`, itemId: items.finished.id, operations: [{ name: "Assemble", workCenterId: wc.body.record.id, setupMinutes: 10, runMinutesPerUnit: 2 }, { name: "Test", workCenterId: wc.body.record.id, runMinutesPerUnit: 1 }] });
    await api(manager.context, "POST", "/actions/routing-activate", { id: routing.body.record.id });

    const m = manager.page;
    // --- settings (UI): defaults for new orders
    await open(m, "/manufacturing/settings", "Manufacturing settings");
    await pick(m, m.getByRole("button", { name: /Default WIP warehouse/ }), new RegExp(warehouse.code));
    await pick(m, m.getByRole("button", { name: /Default finished-goods warehouse/ }), new RegExp(warehouse.code));
    await m.getByRole("button", { name: "Save settings" }).click();
    await expect(m.getByText("Settings saved.")).toBeVisible({ timeout: 30_000 });

    // --- production order (UI)
    await open(m, "/manufacturing/production-orders", "Production orders");
    await m.getByRole("button", { name: "New production order" }).click();
    const dialog = m.getByRole("dialog", { name: "New production order" });
    await pick(m, dialog.getByRole("button", { name: /Select product/ }), new RegExp(items.finished.code));
    await setNumber(dialog.getByRole("textbox", { name: /^Quantity/ }), "10");
    await pick(m, dialog.getByRole("button", { name: /Select material warehouse/ }), new RegExp(warehouse.code));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Production order created.")).toBeVisible({ timeout: 30_000 });
    const row = m.getByRole("row", { name: new RegExp(`WO-.*Planned.*${items.finished.code}.*0 / 10`) }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link").click();
    await expect(m).toHaveURL(/\/manufacturing\/order\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const orderUrl = m.url();

    // --- release reserves the components (A 20 held, B 10 held)
    await m.getByRole("button", { name: "Release" }).click();
    await expect(m.getByText("Order released; components reserved.")).toBeVisible({ timeout: 30_000 });
    const materials = m.getByRole("table", { name: "Materials" });
    await expect(materials.getByRole("row", { name: new RegExp(`${items.compA.code}.*Backflush.*20.*0.*0.*20`) })).toBeVisible({ timeout: 30_000 });
    await expect(materials.getByRole("row", { name: new RegExp(`${items.compB.code}.*Manual.*10.*0.*0.*10`) })).toBeVisible();

    // --- output is refused until the routing is worked
    await setNumber(m.getByRole("textbox", { name: "Quantity produced" }), "10");
    await m.getByRole("button", { name: "Report production" }).click();
    await expect(m.getByRole("alert").filter({ hasText: /operation\(s\) are not completed/i })).toBeVisible({ timeout: 30_000 });

    // --- work the two operations in order (the second is not startable first)
    const ops = m.getByRole("table", { name: "Operations" });
    await expect(ops.getByRole("row", { name: /20.*Test.*Pending/ }).getByRole("button", { name: "Start" })).toHaveCount(0);
    await ops.getByRole("row", { name: /10.*Assemble.*Ready/ }).getByRole("button", { name: "Start" }).click();
    await expect(m.getByText("Operation started.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /10.*Assemble.*In progress/ }).getByRole("button", { name: "Complete" }).click();
    const done1 = m.getByRole("dialog", { name: /Complete operation 10/ });
    await setNumber(done1.getByRole("textbox", { name: /^Actual minutes/ }), "60");
    await done1.getByRole("button", { name: "Complete" }).click();
    await expect(m.getByText("Operation completed.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /20.*Test.*Ready/ }).getByRole("button", { name: "Start" }).click();
    await expect(m.getByText("Operation started.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /20.*Test.*In progress/ }).getByRole("button", { name: "Complete" }).click();
    const done2 = m.getByRole("dialog", { name: /Complete operation 20/ });
    await setNumber(done2.getByRole("textbox", { name: /^Actual minutes/ }), "30");
    await done2.getByRole("button", { name: "Complete" }).click();
    await expect(ops.getByRole("row", { name: /20.*Test.*Completed/ })).toBeVisible({ timeout: 30_000 });

    // --- manual material must be issued first; B is issued, then output
    await m.getByRole("button", { name: "Report production" }).click();
    await expect(m.getByRole("alert").filter({ hasText: new RegExp(`Issue these materials before reporting production.*${items.compB.code}`) })).toBeVisible({ timeout: 30_000 });
    await setNumber(m.getByRole("textbox", { name: `Issue ${items.compB.code}` }), "10");
    await m.getByRole("button", { name: "Issue selected" }).click();
    await expect(m.getByText("Material issued.")).toBeVisible({ timeout: 30_000 });
    expect(await onHand(organizationId, items.compB.id, warehouse.id)).toBe(40);
    await m.getByRole("button", { name: "Report production" }).click();
    await expect(m.getByText("Production reported; finished goods received.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // the ledger agrees: 10 finished, A backflushed (100 - 20), B issued (50 - 10)
    expect(await onHand(organizationId, items.finished.id, warehouse.id)).toBe(10);
    expect(await onHand(organizationId, items.compA.id, warehouse.id)).toBe(80);
    expect(await onHand(organizationId, items.compB.id, warehouse.id)).toBe(40);
    await expect(m.getByRole("list", { name: "Activity" })).toContainText(/Production receipt/i);

    // --- reports reflect it
    await open(m, "/manufacturing/finished-output", "Finished output");
    await expect(m.getByRole("row", { name: new RegExp(`WO-.*Production receipt.*${items.finished.code}.*10`) })).toBeVisible({ timeout: 30_000 });
    await open(m, "/manufacturing/consumption", "Material consumption");
    await expect(m.getByRole("row", { name: new RegExp(`Material issue.*${items.compA.code}.*20`) })).toBeVisible({ timeout: 30_000 });

    // --- second order: shop-floor queue, scrap and rework
    const second = await api<Rec>(manager.context, "POST", "/actions/order-create", { itemId: items.finished.id, quantity: 4, materialWarehouseId: warehouse.id, priority: "urgent" });
    await api(manager.context, "POST", "/actions/order-release", { id: second.body.record.id });
    await open(m, "/manufacturing/shop-floor", "Shop floor");
    await expect(m.getByRole("row", { name: /WO-.*Assemble.*Ready.*Urgent/ }).first()).toBeVisible({ timeout: 60_000 });
    await m.goto(`/manufacturing/order/${second.body.record.id}`, { waitUntil: "domcontentloaded" });
    await expect(m.getByRole("heading", { name: /^WO-/ })).toBeVisible({ timeout: 120_000 });
    await m.getByRole("button", { name: "Record", exact: true }).click();
    await expect(m.getByText("Scrap recorded.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("list", { name: "Activity" })).toContainText(/Scrap.*defect/i, { timeout: 30_000 });
    await m.getByRole("button", { name: "Send scrapped units to rework" }).click();
    const rework = m.getByRole("dialog", { name: "Send to rework" });
    await rework.getByLabel(/^Reason/).fill("Recoverable by re-soldering");
    await rework.getByRole("button", { name: "Create rework order" }).click();
    await expect(m.getByText("Rework order created.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("list", { name: "Rework orders" })).toContainText(/WO-/, { timeout: 30_000 });
    await open(m, "/manufacturing/scrap-rework", "Scrap and rework");
    await expect(m.getByRole("row", { name: /Scrap.*Finished units.*Defect/ }).first()).toBeVisible({ timeout: 30_000 });

    // --- view-only: can look, cannot change
    await viewer.page.goto(orderUrl, { waitUntil: "domcontentloaded" });
    await expect(viewer.page.getByRole("heading", { name: /^WO-/ })).toBeVisible({ timeout: 120_000 });
    await expect(viewer.page.getByRole("button", { name: /Release|Report production|Issue selected|Close short/ })).toHaveCount(0);
    const denied = await api<{ message?: string }>(viewer.context, "POST", "/actions/order-create", { itemId: items.finished.id, quantity: 1 }, false);
    expect(denied.status).toBe(403);
    const deniedIssue = await api<{ message?: string }>(viewer.context, "POST", "/actions/material-issue", { orderId: second.body.record.id, lines: [] }, false);
    expect(deniedIssue.status).toBe(403);
    // cost is not shown to a role without costing.view
    const detail = await api<{ order: { costs: unknown } }>(viewer.context, "GET", `/view/order?id=${second.body.record.id}`);
    expect(detail.body.order.costs).toBeNull();
  } finally {
    await manager.context.close();
    await approver.context.close();
    await viewer.context.close();
  }
});
