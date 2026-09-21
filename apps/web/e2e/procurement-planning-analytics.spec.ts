import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { getProcurementWorld } from "./procurement-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Planning (reorder -> draft PO priced from the supplier's price list), the price /
// landed-cost registers, supplier performance, history and reports -- as real roles.
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const origin = new URL(BASE_URL).origin;
  const response = await context.request.fetch(`${origin}/api/procurement${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
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
async function selectTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

type Rec = { record: { id: string; version: number } };

test.describe("Procurement planning, registers and analytics", () => {
  test("reorder request becomes a draft PO priced from the supplier's price; registers and reports work", async ({ browser }) => {
    test.setTimeout(600_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    const owner = await openSession(browser, { email: fixtures.ownerEmail, password: fixtures.ownerPassword, userId: "" });
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      // a supplier and a reorder rule that is certainly triggered (reorder point far above stock)
      const supplier = await api<Rec>(buyer.context, "POST", "/suppliers", { supplierCode: `PLN-${stamp}`, legalName: `Planning Supplier ${stamp}`, displayName: `Planning Supplier ${stamp}`, currencyCode: "INR" });
      const s1 = await api<Rec>(buyer.context, "POST", `/suppliers/${supplier.record.id}/submit`, { expectedVersion: supplier.record.version });
      const s2 = await api<Rec>(manager.context, "POST", `/suppliers/${supplier.record.id}/qualify`, { expectedVersion: s1.record.version });
      await api<Rec>(manager.context, "POST", `/suppliers/${supplier.record.id}/activate`, { expectedVersion: s2.record.version });
      const options = (await api<{ options: { items: Array<{ id: string; code: string }>; warehouses: Array<{ id: string; code: string }> } }>(buyer.context, "GET", "/options")).options;
      const item = options.items.find((i) => i.code === world.itemCode)!;
      const warehouse = options.warehouses.find((w) => w.code === world.warehouseCode)!;
      const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
      await db.connect();
      try {
        const companyId = (await db.query(`SELECT company_id FROM tenant.warehouses WHERE id=$1`, [warehouse.id])).rows[0].company_id;
        await db.query("BEGIN");
        await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [world.organizationId]);
        await db.query(`DELETE FROM tenant.stock_reorder_rules WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, item.id, warehouse.id]);
        await db.query(`INSERT INTO tenant.stock_reorder_rules(organization_id,company_id,item_id,warehouse_id,minimum_quantity,reorder_quantity,maximum_quantity,preferred_supplier_id,lead_time_days,active) VALUES ($1,$2,$3,$4,1000000,25,2000000,NULL,5,true)`, [world.organizationId, companyId, item.id, warehouse.id]);
        await db.query("COMMIT");
      } finally {
        await db.end();
      }

      // --- supplier price list (register + dialog): 25+ units at 88
      const b = buyer.page;
      await b.goto("/procurement/supplier-prices", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Supplier price lists" })).toBeVisible({ timeout: 180_000 });
      await b.getByRole("button", { name: "Add price" }).click();
      const price = b.getByRole("dialog", { name: "Add price" });
      await pick(b, price.getByRole("button", { name: /Select supplier/ }), new RegExp(`Planning Supplier ${stamp}`));
      await pick(b, price.getByRole("button", { name: /Select item/ }), new RegExp(world.itemCode));
      await setNumber(price.getByRole("textbox", { name: "From quantity" }), "10");
      await setNumber(price.getByRole("textbox", { name: "Price" }), "88");
      await price.getByRole("button", { name: "Save" }).click();
      await expect(b.getByRole("row", { name: new RegExp(`Planning Supplier ${stamp}.*INR 88\\.00`) })).toBeVisible({ timeout: 30_000 });

      // --- planning: the item is below its reorder point; a request is raised, then converted
      await b.goto("/procurement/planning", { waitUntil: "domcontentloaded" });
      const candidate = b.getByRole("row", { name: new RegExp(world.itemName) }).first();
      await expect(candidate).toBeVisible({ timeout: 120_000 });
      await candidate.getByRole("button", { name: "Create reorder request" }).click();
      const proposal = b.getByRole("dialog", { name: "Create reorder request" });
      await pick(b, proposal.getByRole("button", { name: /Select a supplier/ }), new RegExp(`Planning Supplier ${stamp}`));
      await proposal.getByRole("button", { name: "Create request" }).click();
      await expect(b.getByText("Reorder request created.")).toBeVisible({ timeout: 30_000 });
      const request = b.getByRole("row", { name: new RegExp(`${world.itemName}.*Planning Supplier ${stamp}.*Proposed`) }).first();
      await expect(request).toBeVisible({ timeout: 30_000 });
      await request.getByRole("button", { name: "Create purchase order" }).click();
      await expect(b).toHaveURL(/\/procurement\/orders\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(b.getByText("Draft", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(b.getByText(/INR\s*2,200\.00/).first()).toBeVisible(); // 25 x the agreed 88

      // --- landed cost (owner holds matching.manage): freight against that order
      const o = owner.page;
      await o.goto("/procurement/landed-cost", { waitUntil: "domcontentloaded" });
      await expect(o.getByRole("heading", { name: "Landed cost" })).toBeVisible({ timeout: 180_000 });
      await o.getByRole("button", { name: "Add landed cost" }).click();
      const landed = o.getByRole("dialog", { name: "Add landed cost" });
      await landed.getByLabel("Cost type").fill(`Freight ${stamp}`);
      await setNumber(landed.getByRole("textbox", { name: "Amount" }), "150");
      await landed.getByRole("button", { name: "Save" }).click();
      await expect(landed.getByText(/Purchase Order or Goods Receipt/i)).toBeVisible({ timeout: 30_000 }); // must be tied to an order or receipt
      await pick(o, landed.getByRole("button", { name: /Select purchase order/ }), /PO-/);
      await landed.getByRole("button", { name: "Save" }).click();
      await expect(o.getByRole("row", { name: new RegExp(`Freight ${stamp}.*INR 150\\.00`) })).toBeVisible({ timeout: 30_000 });
      // the buyer cannot record landed cost
      await b.goto("/procurement/landed-cost", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Landed cost" })).toBeVisible({ timeout: 60_000 });
      await expect(b.getByRole("button", { name: "Add landed cost" })).toHaveCount(0);

      // --- performance, history and reports render from real data
      await b.goto("/procurement/supplier-performance", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Supplier performance" })).toBeVisible({ timeout: 120_000 });
      await expect(b.getByRole("columnheader", { name: /Rating/i })).toBeVisible({ timeout: 60_000 });
      await b.goto("/procurement/purchase-history", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Purchase history" })).toBeVisible({ timeout: 120_000 });
      await expect(b.getByText("Order lines")).toBeVisible();
      await b.goto("/procurement/spend-analytics", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "Spend analytics" })).toBeVisible({ timeout: 120_000 });
      await selectTab(b, "Contract compliance");
      await expect(b.getByRole("group", { name: /contract compliance/i }).or(b.getByText("No data for this report yet."))).toBeVisible({ timeout: 60_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
      await owner.context.close();
    }
  });
});
