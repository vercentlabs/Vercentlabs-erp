// Real PostgreSQL integration test -- Inventory foundations: settings, scan lookup, batches,
// serial receiving, reorder rules. Contexts carry seeded-role permission sets (no owner bypass).
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
  manager: ["stock.view", "stock.manage", "stock.receive", "stock.issue", "stock.transfer", "stock.adjust", "stock.reserve", "stock.count", "stock.valuation.view", "stock.reports.view", "stock.settings.manage", "stock.audit.view"],
  issuer: ["stock.view", "stock.issue"],
  viewer: ["stock.view"],
};

test("Inventory foundations against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
    return;
  }
  const api = await import("../../services/api/src/index.js");
  const { stockContext, getStockSettings, updateStockSettings, lookupStockByCode, createStockBatch, setStockBatchStatus, listStockBatchesWithBalance, receiveSerializedStock, listStockSerialsDetailed, saveStockReorderRule, listStockReorderRulesDetailed, listStockReorderCandidates, postStockMovement } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLES).map((r) => [r, randomUUID()]));
  const ids = { uom: randomUUID(), plain: randomUUID(), batchItem: randomUUID(), serialItem: randomUUID(), wh: randomUUID(), wh2: randomUUID() };
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

  try {
    for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `inv-${role}-${id}@test.invalid`, `Inv ${role}`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Inv Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `inv-org-${orgId}`, users.manager]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Inv Co','Inv Co Pvt Ltd','INVCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [ids.uom, orgId]);
    const item = (id, code, tracking) => admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory,tracking_type,barcode) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true,$7,$8)`, [id, orgId, companyId, code, `Item ${code}`, ids.uom, tracking, `BC-${code}`]);
    await item(ids.plain, "PLAIN", "none");
    await item(ids.batchItem, "LOTTED", "batch");
    await item(ids.serialItem, "SERIALLED", "serial");
    await admin.query(`INSERT INTO tenant.item_variants(organization_id,company_id,item_id,sku,name,barcode,status) VALUES ($1,$2,$3,'PLAIN-RED','Plain red','VBC-RED','active')`, [orgId, companyId, ids.plain]);
    for (const [id, code] of [[ids.wh, "WH1"], [ids.wh2, "WH2"]]) await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,$4,$4,'active')`, [id, orgId, companyId, code]);

    await t.test("F129/F135: settings default, then a manager (only) can choose the costing method", async () => {
      const before = await tx((c) => getStockSettings(c, ctx.viewer));
      assert.equal(before.costing_method, "moving_average");
      assert.equal(before.configured, false);
      await assert.rejects(() => tx((c) => updateStockSettings(c, ctx.issuer, { costingMethod: "fifo" })), forbidden);
      await assert.rejects(() => tx((c) => updateStockSettings(c, ctx.manager, { costingMethod: "lifo" })), (e) => e.status === 400);
      const after = await tx((c) => updateStockSettings(c, ctx.manager, { costingMethod: "standard", allowNegativeStock: true }));
      assert.equal(after.costing_method, "standard");
      assert.equal(after.allow_negative_stock, true);
      const back = await tx((c) => updateStockSettings(c, ctx.manager, { costingMethod: "moving_average", allowNegativeStock: false }));
      assert.equal(back.costing_method, "moving_average");
    });

    await t.test("F119: scanning resolves an item barcode, a variant SKU, a batch and a serial", async () => {
      assert.equal((await tx((c) => lookupStockByCode(c, ctx.viewer, { code: "bc-plain" }))).kind, "item");
      assert.equal((await tx((c) => lookupStockByCode(c, ctx.viewer, { code: "PLAIN" }))).item.code, "PLAIN");
      const v = await tx((c) => lookupStockByCode(c, ctx.viewer, { code: "VBC-RED" }));
      assert.equal(v.kind, "variant");
      assert.equal(v.variant.sku, "PLAIN-RED");
      await assert.rejects(() => tx((c) => lookupStockByCode(c, ctx.viewer, { code: "NOPE-123" })), (e) => e.status === 404);
      await assert.rejects(() => tx((c) => lookupStockByCode(c, ctx.viewer, { code: "  " })), (e) => e.status === 400);
    });

    let batch;
    await t.test("F115/F116/F118: batches are created for batch-tracked items only, validated, unique, and can be blocked", async () => {
      await assert.rejects(() => tx((c) => createStockBatch(c, ctx.issuer, { itemId: ids.batchItem, batchNumber: "L1" })), forbidden);
      await assert.rejects(() => tx((c) => createStockBatch(c, ctx.manager, { itemId: ids.plain, batchNumber: "L1" })), (e) => e.code === "STOCK_ITEM_NOT_BATCH_TRACKED");
      await assert.rejects(() => tx((c) => createStockBatch(c, ctx.manager, { itemId: ids.batchItem, batchNumber: "" })), (e) => e.status === 400);
      await assert.rejects(() => tx((c) => createStockBatch(c, ctx.manager, { itemId: ids.batchItem, batchNumber: "L0", manufacturedOn: "2026-05-01", expiresOn: "2026-04-01" })), (e) => e.code === "STOCK_BATCH_DATES_INVALID");
      const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
      batch = await tx((c) => createStockBatch(c, ctx.manager, { itemId: ids.batchItem, batchNumber: "LOT-A", expiresOn: soon }));
      assert.equal(batch.status, "active");
      await assert.rejects(() => tx((c) => createStockBatch(c, ctx.manager, { itemId: ids.batchItem, batchNumber: "lot-a" })), (e) => e.code === "STOCK_BATCH_DUPLICATE");
      assert.equal((await tx((c) => lookupStockByCode(c, ctx.viewer, { code: "LOT-A" }))).kind, "batch");
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.batchItem, warehouseId: ids.wh, batchId: batch.id, quantity: 12, unitCost: 5 }));
      const expiring = await tx((c) => listStockBatchesWithBalance(c, ctx.viewer, { withinDays: 30 }));
      const row = expiring.find((b) => b.id === batch.id);
      assert.equal(Number(row.on_hand_quantity), 12);
      assert.equal(Number(row.days_to_expiry), 10);
      assert.equal((await tx((c) => listStockBatchesWithBalance(c, ctx.viewer, { withinDays: 3 }))).some((b) => b.id === batch.id), false);
      await assert.rejects(() => tx((c) => setStockBatchStatus(c, ctx.manager, batch.id, "blocked", "")), (e) => e.code === "STOCK_REASON_REQUIRED");
      const blocked = await tx((c) => setStockBatchStatus(c, ctx.manager, batch.id, "blocked", "Contamination suspected"));
      assert.equal(blocked.status, "blocked");
      // a blocked batch cannot be issued from
      await assert.rejects(() => tx((c) => postStockMovement(c, ctx.issuer, { movementType: "issue", itemId: ids.batchItem, warehouseId: ids.wh, batchId: batch.id, quantity: 1 })), (e) => e.status >= 400);
      await tx((c) => setStockBatchStatus(c, ctx.manager, batch.id, "active"));
      await tx((c) => postStockMovement(c, ctx.issuer, { movementType: "issue", itemId: ids.batchItem, warehouseId: ids.wh, batchId: batch.id, quantity: 2 }));
    });

    await t.test("F117: serial receipt registers each number atomically with the balance; duplicates roll everything back", async () => {
      await assert.rejects(() => tx((c) => receiveSerializedStock(c, ctx.issuer, { itemId: ids.serialItem, warehouseId: ids.wh, serialNumbers: "S1" })), forbidden);
      await assert.rejects(() => tx((c) => receiveSerializedStock(c, ctx.manager, { itemId: ids.plain, warehouseId: ids.wh, serialNumbers: "S1" })), (e) => e.code === "STOCK_ITEM_NOT_SERIAL_TRACKED");
      const r = await tx((c) => receiveSerializedStock(c, ctx.manager, { itemId: ids.serialItem, warehouseId: ids.wh, serialNumbers: "SN-1, SN-2\nSN-3 SN-3", unitCost: 100 }));
      assert.equal(r.serials.length, 3, "duplicates within the entry collapse");
      const balance = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, ids.serialItem, ids.wh]);
      assert.equal(Number(balance.rows[0].quantity), 3);
      await assert.rejects(() => tx((c) => receiveSerializedStock(c, ctx.manager, { itemId: ids.serialItem, warehouseId: ids.wh, serialNumbers: ["SN-4", "sn-1"] })), (e) => e.code === "STOCK_SERIAL_DUPLICATE");
      const after = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, ids.serialItem, ids.wh]);
      assert.equal(Number(after.rows[0].quantity), 3, "the refused entry left the balance alone");
      const listed = await tx((c) => listStockSerialsDetailed(c, ctx.viewer, { itemId: ids.serialItem, status: "available" }));
      assert.equal(listed.length, 3);
      const scan = await tx((c) => lookupStockByCode(c, ctx.viewer, { code: "sn-2" }));
      assert.equal(scan.kind, "serial");
      // issue one serial as the issuer, which flips it to sold
      const sn = listed.find((s) => s.serial_number === "SN-2");
      await tx((c) => postStockMovement(c, ctx.issuer, { movementType: "issue", itemId: ids.serialItem, warehouseId: ids.wh, serialId: sn.id, quantity: 1 }));
      assert.equal((await tx((c) => listStockSerialsDetailed(c, ctx.viewer, { itemId: ids.serialItem, status: "sold" }))).length, 1);
    });

    await t.test("F122-F125: reorder rules validate, upsert, honour safety stock and suggest an order-up-to quantity", async () => {
      const base = { itemId: ids.plain, warehouseId: ids.wh, minimumQuantity: 10, reorderQuantity: 50, safetyQuantity: 5 };
      await assert.rejects(() => tx((c) => saveStockReorderRule(c, ctx.issuer, base)), forbidden);
      await assert.rejects(() => tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, reorderQuantity: 0 })), (e) => e.code === "STOCK_REORDER_QUANTITY_INVALID");
      await assert.rejects(() => tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, minimumQuantity: -1 })), (e) => e.code === "STOCK_QUANTITY_INVALID");
      await assert.rejects(() => tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, maximumQuantity: 12 })), (e) => e.code === "STOCK_MAXIMUM_BELOW_MINIMUM");
      await assert.rejects(() => tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, warehouseId: randomUUID() })), (e) => e.status === 404);
      const rule = await tx((c) => saveStockReorderRule(c, ctx.manager, base));
      assert.equal(Number(rule.safety_quantity), 5);
      // 14 on hand: above the minimum (10) but inside minimum+safety (15) -> triggered
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.plain, warehouseId: ids.wh, quantity: 14, unitCost: 2 }));
      let cands = await tx((c) => listStockReorderCandidates(c, ctx.viewer, {}));
      let mine = cands.find((x) => x.itemId === ids.plain);
      assert.ok(mine, "safety stock brings the trigger up to minimum+safety");
      assert.equal(mine.suggestedQuantity, "50");
      // upsert (same key) turns it into min/max: order up to 100
      const updated = await tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, maximumQuantity: 100 }));
      assert.equal(updated.id, rule.id, "same item+warehouse updates the rule");
      cands = await tx((c) => listStockReorderCandidates(c, ctx.viewer, {}));
      assert.equal(cands.find((x) => x.itemId === ids.plain).suggestedQuantity, "86");
      // above minimum+safety -> not a candidate
      await tx((c) => postStockMovement(c, ctx.manager, { movementType: "receipt", itemId: ids.plain, warehouseId: ids.wh, quantity: 10, unitCost: 2 }));
      cands = await tx((c) => listStockReorderCandidates(c, ctx.viewer, {}));
      assert.equal(cands.some((x) => x.itemId === ids.plain), false);
      const detailed = await tx((c) => listStockReorderRulesDetailed(c, ctx.viewer));
      assert.equal(Number(detailed.find((r) => r.id === rule.id).on_hand_quantity), 24);
      // deactivated rules never trigger
      await tx((c) => saveStockReorderRule(c, ctx.manager, { ...base, maximumQuantity: 5000, minimumQuantity: 1000, active: false }));
      cands = await tx((c) => listStockReorderCandidates(c, ctx.viewer, {}));
      assert.equal(cands.some((x) => x.itemId === ids.plain), false);
    });
  } finally {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      for (const table of ["stock_reorder_rules", "stock_serials", "stock_valuation_layers", "stock_movements", "stock_balances", "stock_batches", "stock_settings", "item_variants", "items", "warehouses", "units_of_measure"]) {
        await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => {});
      }
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK");
    }
    await admin.end();
  }
});
