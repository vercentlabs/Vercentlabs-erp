import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Costing and insight as real people: dashboard, standard cost, production cost, variance split,
// yield and OEE -- against a completed order whose numbers can be checked by hand -- and cost being
// closed to a role without the costing permission.
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
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}
type Rec = { record: { id: string } };

test("dashboard, standard cost, production cost, variance split, yield and OEE; cost is closed without costing.view", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix, warehouse, organizationId, companyId } = world;
    const cal = await api<Rec>(manager.context, "POST", "/actions/calendar-save", { code: `IC-${suffix}`, name: `Cal ${suffix}`, workingWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    await api(manager.context, "POST", "/actions/shift-add", { calendarId: cal.body.record.id, name: "Day", startTime: "08:00", endTime: "16:00" });
    const wc = await api<Rec>(manager.context, "POST", "/actions/work-center-save", { code: `IW-${suffix}`, name: `Line ${suffix}`, calendarId: cal.body.record.id, hourlyRate: 60, overheadRate: 30 });
    const approver = await openSession(browser, world.approver);
    const bom = await api<Rec>(manager.context, "POST", "/actions/bom-create", { itemId: items.finished.id, code: `IB-${suffix}`, components: [{ itemId: items.compA.id, quantity: 2 }] });
    await api(manager.context, "POST", "/actions/bom-submit", { id: bom.body.record.id });
    await api(approver.context, "POST", "/actions/bom-approve", { id: bom.body.record.id });
    await approver.context.close();
    const routing = await api<Rec>(manager.context, "POST", "/actions/routing-create", { code: `IR-${suffix}`, name: `Routing ${suffix}`, itemId: items.finished.id, operations: [{ name: "Make", workCenterId: wc.body.record.id, runMinutesPerUnit: 10 }] });
    await api(manager.context, "POST", "/actions/routing-activate", { id: routing.body.record.id });

    // a completed order and a late one, with figures chosen for hand-checking (component standard cost 5)
    const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
    await db.connect();
    const done = crypto.randomUUID();
    const late = crypto.randomUUID();
    try {
      await db.query("BEGIN");
      await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
      await db.query(`UPDATE tenant.items SET standard_cost=5 WHERE id=$1`, [items.compA.id]);
      const bomId = bom.body.record.id;
      const wo = (id: string, number: string, status: string, planned: number, completed: number, scrapped: number, material: number, labor: number, overhead: number, ended: boolean, due: string | null) =>
        db.query(
          `INSERT INTO tenant.manufacturing_work_orders(id,organization_id,company_id,work_order_number,item_id,bom_id,quantity_planned,quantity_completed,quantity_scrapped,status,wip_warehouse_id,finished_goods_warehouse_id,created_by,material_cost,labor_cost,overhead_cost,cost_absorbed,actual_start_at,actual_end_at,due_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15,$16,now(),$17,$18)`,
          [id, organizationId, companyId, number, items.finished.id, bomId, planned, completed, scrapped, status, warehouse.id, world.manager.userId, material, labor, overhead, ended ? material + labor + overhead : 0, ended ? new Date().toISOString() : null, due],
        );
      await wo(done, `WO-IN-${suffix}`, "completed", 10, 10, 2, 144, 120, 60, true, new Date().toISOString().slice(0, 10));
      await db.query(`INSERT INTO tenant.manufacturing_work_order_materials(organization_id,work_order_id,item_id,warehouse_id,required_quantity,issued_quantity,issued_cost,issue_method) VALUES ($1,$2,$3,$4,20,24,144,'manual')`, [organizationId, done, items.compA.id, warehouse.id]);
      await db.query(`INSERT INTO tenant.manufacturing_work_order_operations(organization_id,work_order_id,sequence,name,work_center_id,status,planned_minutes,actual_minutes,completed_at) VALUES ($1,$2,10,'Make',$3,'completed',100,120,now())`, [organizationId, done, wc.body.record.id]);
      await db.query(`INSERT INTO tenant.manufacturing_scrap_records(organization_id,company_id,work_order_id,item_id,category,scope,quantity,unit_cost,reason_code,posted_by) VALUES ($1,$2,$3,$4,'scrap','product',2,30,'defect',$5)`, [organizationId, companyId, done, items.finished.id, world.manager.userId]);
      await wo(late, `WO-LT-${suffix}`, "released", 5, 0, 0, 0, 0, 0, false, "2020-01-01");
      await db.query("COMMIT");
    } finally {
      await db.end();
    }

    const m = manager.page;
    // --- dashboard
    await open(m, "/manufacturing", "Manufacturing");
    await expect(m.getByText("WIP value")).toBeVisible({ timeout: 60_000 });
    await expect(m.getByRole("list", { name: "Needs attention" })).toContainText(`WO-LT-${suffix}`, { timeout: 60_000 });
    await expect(m.getByRole("link", { name: "Reports" }).first()).toBeVisible();

    // --- standard cost of 10: 2 x A at 5 x 10 = 100 material, 100 min labour + 50 overhead
    await open(m, "/manufacturing/standard-cost", "Standard cost");
    await pick(m, m.getByRole("button", { name: /Select product/ }), new RegExp(items.finished.code));
    await m.getByRole("textbox", { name: "Quantity" }).fill("10");
    await m.getByRole("button", { name: "Calculate" }).click();
    await expect(m.getByRole("list", { name: "Standard materials" })).toContainText(/standard cost.*100\.00/, { timeout: 30_000 });
    await expect(m.getByRole("list", { name: "Standard operations" })).toContainText(/100.*min.*labour 100\.00.*overhead 50\.00/);

    // --- production cost and variance for the completed order
    await open(m, "/manufacturing/production-cost", "Production cost");
    await expect(m.getByRole("row", { name: new RegExp(`WO-IN-${suffix}.*10.*144\\.00.*120\\.00.*60\\.00.*324\\.00.*32\\.40`) })).toBeVisible({ timeout: 60_000 });
    await open(m, "/manufacturing/variance", "Cost variance");
    // standard 250 vs actual 324: +74 = usage 20 + price 24 + labour 20 + overhead 10
    await expect(m.getByRole("row", { name: new RegExp(`WO-IN-${suffix}.*250\\.00.*324\\.00.*74\\.00.*29\\.6%.*24\\.00.*20\\.00.*20\\.00.*10\\.00`) })).toBeVisible({ timeout: 60_000 });

    // --- yield and OEE
    await open(m, "/manufacturing/yield", "Yield");
    await expect(m.getByRole("row", { name: new RegExp(`${items.finished.code}.*10.*83\\.3%`) }).first()).toBeVisible({ timeout: 60_000 });
    await open(m, "/manufacturing/performance", "Production efficiency");
    await expect(m.getByRole("row", { name: new RegExp(`IW-${suffix}.*Line.*100%.*83\\.3%.*83\\.3%.*83\\.3%|IW-${suffix}.*83\\.3%`) }).first()).toBeVisible({ timeout: 60_000 });
    await open(m, "/manufacturing/reports", "Manufacturing reports");
    await expect(m.getByRole("link", { name: /Cost variance/ })).toBeVisible();

    // --- a role without costing.view: dashboard counts yes, WIP value no, cost pages closed, API 403
    await open(viewer.page, "/manufacturing", "Manufacturing");
    await expect(viewer.page.getByText("Late")).toBeVisible({ timeout: 60_000 });
    await expect(viewer.page.getByText("WIP value")).toHaveCount(0);
    await open(viewer.page, "/manufacturing/variance", /Cost variance|You don't have access to Manufacturing/);
    await expect(viewer.page.getByText("You don't have access to Manufacturing")).toBeVisible({ timeout: 60_000 });
    expect((await api(viewer.context, "GET", "/view/cost-report", undefined, false)).status).toBe(403);
    expect((await api(viewer.context, "GET", `/view/standard-cost?itemId=${items.finished.id}`, undefined, false)).status).toBe(403);
    // quantities need no cost permission
    await open(viewer.page, "/manufacturing/yield", "Yield");
    await expect(viewer.page.getByRole("row", { name: new RegExp(`${items.finished.code}.*83\\.3%`) }).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await manager.context.close();
    await viewer.context.close();
  }
});
