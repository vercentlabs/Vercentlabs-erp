// Real PostgreSQL integration test -- costing methods, valuation, aging and landed-cost allocation.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";
async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

const ROLES = {
  manager: ["stock.view", "stock.manage", "stock.receive", "stock.issue", "stock.adjust", "stock.valuation.view", "stock.reports.view", "stock.settings.manage"],
  clerk: ["stock.view", "stock.receive", "stock.issue"],
};

test("Inventory valuation against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { stockContext, postStockMovement, updateStockSettings, getStockValuationReport, getStockAgingReport, getStockMovementSummary, listStockLandedCosts, allocateStockLandedCost } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), fifo: randomUUID(), std: randomUUID(), avg: randomUUID(), wh: randomUUID(), whOld: randomUUID() };
  const ctx = Object.fromEntries(Object.entries(ROLES).map(([r, permissions]) => [r, stockContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));

  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const forbidden = (e) => e.status === 403;
  const close = (actual, expected, message) => assert.ok(Math.abs(Number(actual) - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
  const post = (who, input) => tx((c) => postStockMovement(c, ctx[who], input));

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `val-${role}-${id}@test.invalid`, `Val ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Val Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `val-org-${orgId}`, users.manager]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Val Co','Val Co Pvt Ltd','VALCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, method, standard = 0) => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,valuation_method,standard_cost) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true,$7,$8)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, method, standard]);
    await item(ids.fifo, "VF", "fifo");
    await item(ids.std, "VS", "standard", 5);
    await item(ids.avg, "VA", "moving_average");
    for (const [id, code] of [[ids.wh, "VW1"], [ids.whOld, "VW2"]]) await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,$4,$4,'active')`, [id, orgId, companyId, code]);

    await t.test("F133/F134: FIFO issues consume the oldest layers; the remainder is valued at the newest cost", async () => {
      await post("clerk", { movementType: "receipt", itemId: ids.fifo, warehouseId: ids.wh, quantity: 10, unitCost: 2 });
      await post("clerk", { movementType: "receipt", itemId: ids.fifo, warehouseId: ids.wh, quantity: 10, unitCost: 4 });
      const issue = await post("clerk", { movementType: "issue", itemId: ids.fifo, warehouseId: ids.wh, quantity: 12 });
      close(issue.unit_cost, (10 * 2 + 2 * 4) / 12, "12 issued = 10 @2 + 2 @4");
      const layers = (await admin.query(`SELECT unit_cost,remaining_quantity FROM tenant.stock_valuation_layers WHERE organization_id=$1 AND item_id=$2 AND quantity>0 ORDER BY created_at,id`, [orgId, ids.fifo])).rows;
      close(layers[0].remaining_quantity, 0, "oldest layer used up");
      close(layers[1].remaining_quantity, 8, "newest layer partly used");
      const report = await tx((c) => getStockValuationReport(c, ctx.manager, {}));
      const line = report.lines.find((l) => l.item_code === "VF");
      assert.equal(line.method, "fifo");
      close(line.stock_value, 8 * 4, "8 left, all at the newest cost");
      const next = await post("clerk", { movementType: "issue", itemId: ids.fifo, warehouseId: ids.wh, quantity: 8 });
      close(next.unit_cost, 4, "the rest leaves at 4");
    });

    await t.test("F135: standard costing carries stock at standard and books the purchase-price variance", async () => {
      const receipt = await post("clerk", { movementType: "receipt", itemId: ids.std, warehouseId: ids.wh, quantity: 10, unitCost: 6 });
      close(receipt.cost_variance, 10, "(6 - 5) x 10");
      const issue = await post("clerk", { movementType: "issue", itemId: ids.std, warehouseId: ids.wh, quantity: 3 });
      close(issue.unit_cost, 5, "issues leave at standard");
      const balance = (await admin.query(`SELECT average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [orgId, ids.std])).rows[0];
      close(balance.average_cost, 5, "carried at standard");
      const report = await tx((c) => getStockValuationReport(c, ctx.manager, {}));
      close(report.lines.find((l) => l.item_code === "VS").stock_value, 35, "7 x 5");
      const summary = await tx((c) => getStockMovementSummary(c, ctx.manager, {}));
      close(summary.lines.find((l) => l.item_code === "VS").cost_variance, 10, "variance in the movement summary");
    });

    await t.test("F129: the company costing method applies to items that do not override it; only a settings manager changes it", async () => {
      await assert.rejects(() => tx((c) => updateStockSettings(c, ctx.clerk, { costingMethod: "fifo" })), forbidden);
      await tx((c) => updateStockSettings(c, ctx.manager, { costingMethod: "fifo" }));
      await post("clerk", { movementType: "receipt", itemId: ids.avg, warehouseId: ids.wh, quantity: 5, unitCost: 10 });
      await post("clerk", { movementType: "receipt", itemId: ids.avg, warehouseId: ids.wh, quantity: 5, unitCost: 20 });
      const issue = await post("clerk", { movementType: "issue", itemId: ids.avg, warehouseId: ids.wh, quantity: 5 });
      close(issue.unit_cost, 10, "company FIFO: the first 5 leave at 10, not the blended 15");
      await tx((c) => updateStockSettings(c, ctx.manager, { costingMethod: "moving_average" }));
      const blended = await post("clerk", { movementType: "issue", itemId: ids.avg, warehouseId: ids.wh, quantity: 1 });
      close(blended.unit_cost, 20, "back to moving average: the carried average (FIFO left the 20 layer)");
    });

    await t.test("valuation and reports need the right permission; the clerk sees no cost", async () => {
      await assert.rejects(() => tx((c) => getStockValuationReport(c, ctx.clerk, {})), forbidden);
      await assert.rejects(() => tx((c) => getStockAgingReport(c, ctx.clerk, {})), forbidden);
      await assert.rejects(() => tx((c) => listStockLandedCosts(c, ctx.clerk)), forbidden);
    });

    await t.test("F138-F140: aging buckets by layer age; slow and dead stock are classified", async () => {
      await post("clerk", { movementType: "receipt", itemId: ids.avg, warehouseId: ids.whOld, quantity: 4, unitCost: 3 });
      await post("clerk", { movementType: "receipt", itemId: ids.fifo, warehouseId: ids.whOld, quantity: 6, unitCost: 3 });
      // age the second warehouse's history: 200 days ago for the average item, 45 days for the FIFO item
      await admin.query(`UPDATE tenant.stock_valuation_layers SET created_at=now()-interval '200 days' WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3`, [orgId, ids.whOld, ids.avg]);
      await admin.query(`UPDATE tenant.stock_movements SET occurred_at=now()-interval '200 days' WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3`, [orgId, ids.whOld, ids.avg]);
      await admin.query(`UPDATE tenant.stock_valuation_layers SET created_at=now()-interval '45 days' WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3`, [orgId, ids.whOld, ids.fifo]);
      await admin.query(`UPDATE tenant.stock_movements SET occurred_at=now()-interval '45 days' WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3`, [orgId, ids.whOld, ids.fifo]);
      const report = await tx((c) => getStockAgingReport(c, ctx.manager, { warehouseId: ids.whOld }));
      const dead = report.lines.find((l) => l.item_code === "VA");
      const fresh = report.lines.find((l) => l.item_code === "VF");
      close(dead.age_181_365, 4, "4 units in the 181-365 day bucket");
      assert.equal(dead.classification, "dead");
      close(fresh.age_31_60, 6, "6 units in the 31-60 day bucket");
      assert.equal(fresh.classification, "slow", "never issued from this warehouse, moved within the dead window");
      close(dead.stock_value, 12, "value visible to the valuation viewer");
      const narrow = await tx((c) => getStockAgingReport(c, ctx.manager, { warehouseId: ids.whOld, slowDays: 30, deadDays: 40 }));
      assert.equal(narrow.lines.find((l) => l.item_code === "VF").classification, "dead", "thresholds are parameters");
    });

    await t.test("F136: landed cost is capitalised into the receipt's stock (only what is still on hand) and can be allocated once", async () => {
      const receiptId = randomUUID();
      await admin.query(`INSERT INTO tenant.procurement_receipts(id,organization_id,company_id,content_hash,created_by,updated_by) VALUES ($1,$2,$3,'x',$4,$4)`, [receiptId, orgId, companyId, users.manager]);
      const landedItem = randomUUID();
      await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,'VL','Item VL','product',$4,'active',true)`, [landedItem, orgId, companyId, ids.uom]);
      await post("clerk", { movementType: "receipt", itemId: landedItem, warehouseId: ids.wh, quantity: 10, unitCost: 10, referenceType: "procurement_receipt", referenceId: receiptId });
      await post("clerk", { movementType: "issue", itemId: landedItem, warehouseId: ids.wh, quantity: 4 });
      const cost = (await admin.query(`INSERT INTO tenant.procurement_landed_costs(organization_id,company_id,receipt_id,cost_type,amount,currency_code,allocation_method) VALUES ($1,$2,$3,'Freight',60,'INR','value') RETURNING id`, [orgId, companyId, receiptId])).rows[0];
      await assert.rejects(() => tx((c) => allocateStockLandedCost(c, ctx.clerk, cost.id)), forbidden);
      const listed = await tx((c) => listStockLandedCosts(c, ctx.manager));
      assert.equal(listed.find((l) => l.id === cost.id).allocated, false);
      const result = await tx((c) => allocateStockLandedCost(c, ctx.manager, cost.id));
      close(result.capitalised, 36, "6 of 10 units are still on hand: 60 x 6/10");
      close(result.expensed, 24, "the 4 already issued carry 24 to cost of sales");
      const balance = (await admin.query(`SELECT quantity,average_cost FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [orgId, landedItem])).rows[0];
      close(balance.average_cost, 16, "10 + 36/6");
      const report = await tx((c) => getStockValuationReport(c, ctx.manager, {}));
      close(report.lines.find((l) => l.item_code === "VL").stock_value, 6 * 16, "value includes the freight");
      await assert.rejects(() => tx((c) => allocateStockLandedCost(c, ctx.manager, cost.id)), (e) => e.code === "STOCK_LANDED_COST_ALLOCATED");
      assert.equal((await admin.query(`SELECT status FROM tenant.procurement_landed_costs WHERE id=$1`, [cost.id])).rows[0].status, "allocated");
      // a cost with nothing received yet is refused with a clear reason
      const emptyReceipt = randomUUID();
      await admin.query(`INSERT INTO tenant.procurement_receipts(id,organization_id,company_id,content_hash,created_by,updated_by) VALUES ($1,$2,$3,'x',$4,$4)`, [emptyReceipt, orgId, companyId, users.manager]);
      const none = (await admin.query(`INSERT INTO tenant.procurement_landed_costs(organization_id,company_id,receipt_id,cost_type,amount,currency_code) VALUES ($1,$2,$3,'Duty',5,'INR') RETURNING id`, [orgId, companyId, emptyReceipt])).rows[0];
      await assert.rejects(() => tx((c) => allocateStockLandedCost(c, ctx.manager, none.id)), (e) => e.code === "STOCK_LANDED_COST_NO_STOCK");
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["stock_landed_cost_allocations", "procurement_landed_costs", "procurement_receipts", "stock_valuation_layers", "stock_movements", "stock_balances", "stock_settings", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});
