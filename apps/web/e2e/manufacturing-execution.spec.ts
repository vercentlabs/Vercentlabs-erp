import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Execution controls as real people: hold, logged time, an inspection gate, subcontracting with cost,
// downtime with a maintenance request raised in Assets -- and what a view-only role cannot do.
const origin = () => new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
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

test("hold, logged time, inspection gate, subcontracting, downtime with a maintenance request; view-only is read-only", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix, warehouse, organizationId, companyId } = world;
    const assetId = crypto.randomUUID();
    const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
      await db.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,100,0,5)`, [organizationId, companyId, items.compA.id, warehouse.id]);
      const category = crypto.randomUUID();
      await db.query(`INSERT INTO tenant.asset_categories(id,organization_id,company_id,code,name,created_by) VALUES ($1,$2,$3,$4,'Machines',$5)`, [category, organizationId, companyId, `AC-${suffix}`, world.manager.userId]);
      await db.query(`INSERT INTO tenant.assets(id,organization_id,company_id,asset_number,name,category_id,currency_code,useful_life_months,depreciation_method,created_by) VALUES ($1,$2,$3,$4,$5,$6,'INR',60,'straight_line',$7)`, [assetId, organizationId, companyId, `AST-${suffix}`, `Press ${suffix}`, category, world.manager.userId]);
      await db.query("COMMIT");
    } finally {
      await db.end();
    }
    await api(manager.context, "POST", "/actions/settings-save", { defaultWipWarehouseId: warehouse.id, defaultFinishedGoodsWarehouseId: warehouse.id });
    const wc = await api<Rec>(manager.context, "POST", "/actions/work-center-save", { code: `XW-${suffix}`, name: `Press line ${suffix}`, hourlyRate: 60, overheadRate: 120 });
    await api(manager.context, "POST", "/actions/work-center-asset", { workCenterId: wc.body.record.id, assetId });
    const approver = await openSession(browser, world.approver);
    const bom = await api<Rec>(manager.context, "POST", "/actions/bom-create", { itemId: items.finished.id, code: `XB-${suffix}`, components: [{ itemId: items.compA.id, quantity: 1, issueMethod: "backflush" }] });
    await api(manager.context, "POST", "/actions/bom-submit", { id: bom.body.record.id });
    await api(approver.context, "POST", "/actions/bom-approve", { id: bom.body.record.id });
    await approver.context.close();
    const routing = await api<Rec>(manager.context, "POST", "/actions/routing-create", { code: `XR-${suffix}`, name: `Routing ${suffix}`, itemId: items.finished.id, operations: [{ name: "Machine", workCenterId: wc.body.record.id, runMinutesPerUnit: 1, inspectionRequired: true }, { name: "Plating", subcontracted: true }] });
    await api(manager.context, "POST", "/actions/routing-activate", { id: routing.body.record.id });
    const order = await api<Rec>(manager.context, "POST", "/actions/order-create", { itemId: items.finished.id, quantity: 10, materialWarehouseId: warehouse.id });
    await api(manager.context, "POST", "/actions/order-release", { id: order.body.record.id });

    const m = manager.page;
    await m.goto(`/manufacturing/order/${order.body.record.id}`, { waitUntil: "domcontentloaded" });
    await expect(m.getByRole("heading", { name: /^WO-/ })).toBeVisible({ timeout: 180_000 });

    // --- hold: a reason is required, work is refused while held
    await m.getByRole("button", { name: "Hold", exact: true }).click();
    const hold = m.getByRole("dialog", { name: "Hold order" });
    await expect(hold.getByRole("button", { name: "Hold order" })).toBeDisabled();
    await hold.getByLabel(/^Reason/).fill("Drawing revision pending");
    await hold.getByRole("button", { name: "Hold order" }).click();
    await expect(m.getByText("Order put on hold.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByText(/On hold: Drawing revision pending/)).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("button", { name: "Report production" })).toHaveCount(0);
    await m.getByRole("button", { name: "Resume" }).click();
    await expect(m.getByText("Order resumed.")).toBeVisible({ timeout: 30_000 });

    // --- start op 10, log 60 minutes of labour, then the inspection gate
    const ops = m.getByRole("table", { name: "Operations" });
    await ops.getByRole("row", { name: /10.*Machine.*Ready/ }).getByRole("button", { name: "Start" }).click();
    await expect(m.getByText("Operation started.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /10.*Machine.*In progress/ }).getByRole("button", { name: "Log time" }).click();
    const log = m.getByRole("dialog", { name: /Log time/ });
    await setNumber(log.getByRole("textbox", { name: /^Minutes/ }), "60");
    await log.getByLabel(/^Operator/).fill("Asha");
    await log.getByRole("button", { name: "Log time" }).click();
    await expect(m.getByText("Time logged.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /10.*Machine.*In progress/ }).getByRole("button", { name: "Complete" }).click();
    const done = m.getByRole("dialog", { name: /Complete operation 10/ });
    await done.getByRole("button", { name: "Complete" }).click();
    await expect(done.getByRole("alert")).toContainText(/requires a passing inspection/i, { timeout: 30_000 });
    await done.getByRole("button", { name: "Close" }).last().click();
    // a failed inspection does not satisfy it
    await ops.getByRole("row", { name: /10.*Machine/ }).getByRole("button", { name: "Inspect" }).click();
    const fail = m.getByRole("dialog", { name: /Inspect operation 10/ });
    await setNumber(fail.getByRole("textbox", { name: /^Quantity inspected/ }), "10");
    await setNumber(fail.getByRole("textbox", { name: /^Quantity rejected/ }), "1");
    await fail.getByLabel(/^Defect/).fill("burr");
    await fail.getByRole("button", { name: "Record inspection" }).click();
    await expect(m.getByText("Inspection recorded.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /10.*Machine/ }).getByRole("button", { name: "Complete" }).click();
    const again = m.getByRole("dialog", { name: /Complete operation 10/ });
    await again.getByRole("button", { name: "Complete" }).click();
    await expect(again.getByRole("alert")).toContainText(/requires a passing inspection/i, { timeout: 30_000 });
    await again.getByRole("button", { name: "Close" }).last().click();
    await ops.getByRole("row", { name: /10.*Machine/ }).getByRole("button", { name: "Inspect" }).click();
    const pass = m.getByRole("dialog", { name: /Inspect operation 10/ });
    await setNumber(pass.getByRole("textbox", { name: /^Quantity inspected/ }), "9");
    await pass.getByRole("button", { name: "Record inspection" }).click();
    await expect(m.getByText("Inspection recorded.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /10.*Machine/ }).getByRole("button", { name: "Complete" }).click();
    const ok = m.getByRole("dialog", { name: /Complete operation 10/ });
    await ok.getByRole("button", { name: "Complete" }).click();
    await expect(ops.getByRole("row", { name: /10.*Machine.*Completed/ })).toBeVisible({ timeout: 30_000 });

    // --- op 20 is subcontracted: send out, receive with a cost
    await ops.getByRole("row", { name: /20.*Plating.*Ready/ }).getByRole("button", { name: "Send out" }).click();
    const send = m.getByRole("dialog", { name: /Send out operation 20/ });
    await send.getByLabel(/^Subcontractor/).fill("Acme Plating");
    await send.getByRole("button", { name: "Send out" }).click();
    await expect(m.getByText("Sent to the subcontractor.")).toBeVisible({ timeout: 30_000 });
    await ops.getByRole("row", { name: /20.*Plating.*In progress/ }).getByRole("button", { name: "Receive" }).click();
    const receive = m.getByRole("dialog", { name: /Receive operation 20/ });
    await setNumber(receive.getByRole("textbox", { name: /^Good quantity/ }), "10");
    await setNumber(receive.getByRole("textbox", { name: /^Subcontract cost/ }), "500");
    await receive.getByRole("button", { name: "Receive", exact: true }).click();
    await expect(m.getByText("Received from the subcontractor.")).toBeVisible({ timeout: 30_000 });
    await expect(ops.getByRole("row", { name: /20.*Plating.*Completed/ })).toBeVisible({ timeout: 30_000 });

    // --- output; the order's cost carries logged time and the subcontract cost
    await setNumber(m.getByRole("textbox", { name: "Quantity produced" }), "10");
    await m.getByRole("button", { name: "Report production" }).click();
    await expect(m.getByText("Production reported; finished goods received.")).toBeVisible({ timeout: 30_000 });
    const detail = await api<{ order: { costs: { labor: string; subcontract: string; material: string } } }>(manager.context, "GET", `/view/order?id=${order.body.record.id}`);
    expect(Number(detail.body.order.costs.labor)).toBeCloseTo(60, 2); // 60 min x 60/h; completing added no estimate
    expect(Number(detail.body.order.costs.subcontract)).toBe(500);
    expect(Number(detail.body.order.costs.material)).toBe(50); // 10 x A at 5, backflushed

    // --- registers
    await open(m, "/manufacturing/time-tracking", "Time tracking");
    await expect(m.getByRole("row", { name: /WO-.*Machine.*Labor.*Asha.*60/i }).first()).toBeVisible({ timeout: 30_000 });
    await open(m, "/manufacturing/inspections", "Production inspections");
    await expect(m.getByRole("row", { name: /WO-.*Machine.*Blocked.*10.*1.*burr/i }).first()).toBeVisible({ timeout: 30_000 });
    await open(m, "/manufacturing/subcontracting", "Subcontracting");
    await expect(m.getByRole("row", { name: /WO-.*Plating.*Acme Plating.*In progress|Completed.*500/i }).first()).toBeVisible({ timeout: 30_000 });

    // --- downtime: a breakdown stops the work center and raises a maintenance order in Assets
    await open(m, "/manufacturing/downtime", "Downtime");
    await m.getByRole("button", { name: "Log downtime" }).click();
    const down = m.getByRole("dialog", { name: "Log downtime" });
    await pick(m, down.getByRole("button", { name: /Select work center/ }), new RegExp(`XW-${suffix}`));
    await pick(m, down.getByRole("button", { name: /Take the work center out of service/i }), /Yes/);
    await pick(m, down.getByRole("button", { name: /Raise a maintenance request/i }), /Yes/);
    await down.getByLabel(/^Note/).fill("Hydraulic leak");
    await down.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Downtime started.")).toBeVisible({ timeout: 30_000 });
    const downRow = m.getByRole("row", { name: new RegExp(`XW-${suffix}.*Breakdown.*running.*Yes.*AMO-`) });
    await expect(downRow).toBeVisible({ timeout: 30_000 });
    await downRow.getByRole("button", { name: "End downtime" }).click();
    await expect(m.getByText("Downtime ended.")).toBeVisible({ timeout: 30_000 });

    // --- view-only: can look, cannot change
    await open(viewer.page, "/manufacturing/downtime", "Downtime");
    await expect(viewer.page.getByRole("button", { name: "Log downtime" })).toHaveCount(0);
    expect((await api(viewer.context, "POST", "/actions/downtime-start", { workCenterId: wc.body.record.id, reasonCode: "breakdown" }, false)).status).toBe(403);
    expect((await api(viewer.context, "POST", "/actions/order-hold", { id: order.body.record.id, reason: "x" }, false)).status).toBe(403);
    expect((await api(viewer.context, "POST", "/actions/inspection-record", { orderId: order.body.record.id, quantityInspected: 1 }, false)).status).toBe(403);
  } finally {
    await manager.context.close();
    await viewer.context.close();
  }
});
