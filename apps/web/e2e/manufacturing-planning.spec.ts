import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Planning as real people: MRP recommends make/buy across levels and converts to orders; material
// availability; finite-capacity scheduling (preview, then apply); view-only cannot run any of it.
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

test("MRP recommends make and buy across levels and converts to orders; availability; scheduling; view-only is read-only", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const approver = await openSession(browser, world.approver);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix, warehouse, organizationId, companyId } = world;
    const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
      await db.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,3,0,5)`, [organizationId, companyId, items.compA.id, warehouse.id]);
      await db.query("COMMIT");
    } finally {
      await db.end();
    }
    await api(manager.context, "POST", "/actions/settings-save", { defaultWipWarehouseId: warehouse.id, defaultFinishedGoodsWarehouseId: warehouse.id });
    // SUB is built from SUBPART; FINISHED from 2 x A and 1 x SUB
    const approve = async (body: Record<string, unknown>) => {
      const bom = await api<Rec>(manager.context, "POST", "/actions/bom-create", body);
      await api(manager.context, "POST", "/actions/bom-submit", { id: bom.body.record.id });
      await api(approver.context, "POST", "/actions/bom-approve", { id: bom.body.record.id });
    };
    await approve({ itemId: items.sub.id, code: `PS-${suffix}`, components: [{ itemId: items.subPart.id, quantity: 3 }] });
    await approve({ itemId: items.finished.id, code: `PF-${suffix}`, components: [{ itemId: items.compA.id, quantity: 2 }, { itemId: items.sub.id, quantity: 1 }] });
    // scheduling set-up: a calendar with one 4-hour shift, a work center on it, a routing
    const cal = await api<Rec>(manager.context, "POST", "/actions/calendar-save", { code: `PC-${suffix}`, name: `Cal ${suffix}`, workingWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    await api(manager.context, "POST", "/actions/shift-add", { calendarId: cal.body.record.id, name: "Morning", startTime: "08:00", endTime: "12:00" });
    const wc = await api<Rec>(manager.context, "POST", "/actions/work-center-save", { code: `PW-${suffix}`, name: `Cell ${suffix}`, calendarId: cal.body.record.id });
    const routing = await api<Rec>(manager.context, "POST", "/actions/routing-create", { code: `PRT-${suffix}`, name: `Routing ${suffix}`, itemId: items.finished.id, operations: [{ name: "Build", workCenterId: wc.body.record.id, setupMinutes: 20, runMinutesPerUnit: 30 }] });
    await api(manager.context, "POST", "/actions/routing-activate", { id: routing.body.record.id });
    // demand: an open order for 10 finished
    const soon = new Date(Date.now() + 5 * 86400000).toISOString();
    const order = await api<Rec>(manager.context, "POST", "/actions/order-create", { itemId: items.finished.id, quantity: 10, materialWarehouseId: warehouse.id, plannedStartAt: soon, priority: "urgent" });

    const m = manager.page;
    // --- MRP run (UI)
    await open(m, "/manufacturing/mrp", "MRP");
    await m.getByRole("button", { name: "Run MRP" }).click();
    const dlg = m.getByRole("dialog", { name: "Run MRP" });
    await dlg.getByLabel(/^Note/).fill(`E2E ${suffix}`);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("MRP run completed.")).toBeVisible({ timeout: 30_000 });
    const runRow = m.getByRole("row", { name: new RegExp(`MRP-.*E2E ${suffix}`) });
    await expect(runRow).toBeVisible({ timeout: 30_000 });
    await runRow.getByRole("link").click();
    await expect(m).toHaveURL(/\/manufacturing\/mrp-run\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const requirements = m.getByRole("table", { name: "Requirements" });
    // A: order needs 20, stock 3 -> buy 17.  SUB: needs 10, none -> make 10, which needs 30 SUBPART -> buy 30
    await expect(requirements.getByRole("row", { name: new RegExp(`${items.compA.code}.*20.*3.*17.*Purchase`) })).toBeVisible({ timeout: 60_000 });
    await expect(requirements.getByRole("row", { name: new RegExp(`${items.sub.code}.*10.*0.*10.*Manufacture`) })).toBeVisible();
    await expect(requirements.getByRole("row", { name: new RegExp(`${items.subPart.code}.*30.*30.*Purchase`) })).toBeVisible();
    // convert the make recommendation into a real production order, once
    await m.getByRole("button", { name: /Create production orders \(1\)/ }).click();
    await expect(m.getByText(/Created 1 production order/)).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("button", { name: /Create production orders \(0\)/ })).toBeDisabled();
    await open(m, "/manufacturing/production-orders", "Production orders");
    await expect(m.getByRole("row", { name: new RegExp(`WO-.*Planned.*${items.sub.code}.*0 / 10`) })).toBeVisible({ timeout: 30_000 });

    // --- material availability: 10 finished need 20 A (3 free) and 10 SUB -> 30 SUBPART
    await open(m, "/manufacturing/material-planning", "Material planning");
    await pick(m, m.getByRole("button", { name: /Select product/ }), new RegExp(items.finished.code));
    await setNumber(m.getByRole("textbox", { name: "Quantity" }), "10");
    await m.getByRole("button", { name: "Check availability" }).click();
    const table = m.getByRole("table", { name: "Material availability" });
    await expect(table.getByRole("row", { name: new RegExp(`${items.compA.code}.*20.*3.*3.*0.*17.*17.*Short`) })).toBeVisible({ timeout: 30_000 });
    await expect(m.getByText(/Not everything is free/)).toBeVisible();

    // --- scheduling: preview writes nothing, apply does; 320 minutes need two 240-minute days
    await api(manager.context, "POST", "/actions/order-release", { id: order.body.record.id, allowShortage: true });
    await open(m, "/manufacturing/scheduling", "Scheduling");
    await m.getByRole("button", { name: "Preview schedule" }).click();
    await expect(m.getByText(/Preview only/)).toBeVisible({ timeout: 60_000 });
    const schedule = m.getByRole("table", { name: "Schedule" });
    await expect(schedule.getByRole("row", { name: /WO-.*Urgent.*10 Build.*→/ }).first()).toBeVisible({ timeout: 30_000 });
    const before = await api<{ order: { planned_start_at: string } }>(manager.context, "GET", `/view/order?id=${order.body.record.id}`);
    await m.getByRole("button", { name: "Apply schedule" }).click();
    await expect(m.getByText("Schedule applied.", { exact: false })).toBeVisible({ timeout: 60_000 });
    const after = await api<{ order: { planned_start_at: string; operations: Array<{ name: string }> } }>(manager.context, "GET", `/view/order?id=${order.body.record.id}`);
    expect(after.body.order.planned_start_at).toBeTruthy();
    expect(after.body.order.operations[0].name).toBe("Build");
    expect(before.body.order.planned_start_at).toBeTruthy();

    // --- view-only: no run buttons, server refuses
    await open(viewer.page, "/manufacturing/mrp", "MRP");
    await expect(viewer.page.getByRole("button", { name: "Run MRP" })).toHaveCount(0);
    expect((await api(viewer.context, "POST", "/actions/mrp-run", { horizonDays: 30 }, false)).status).toBe(403);
    expect((await api(viewer.context, "POST", "/actions/schedule-run", { apply: true }, false)).status).toBe(403);
  } finally {
    await manager.context.close();
    await approver.context.close();
    await viewer.context.close();
  }
});
