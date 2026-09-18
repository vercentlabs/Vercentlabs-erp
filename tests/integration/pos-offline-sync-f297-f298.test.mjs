// Real PostgreSQL integration test — F297 (offline POS workspace) / F298
// (offline-to-online sync). Exercises the SERVER-SIDE sync endpoint
// directly (services/api/src/modules/point-of-sale/index.js's
// syncOfflinePosSale/resolvePosOfflineSyncConflict) with payload shapes
// identical to what the browser's IndexedDB queue sends. Every scenario
// the task brief calls out is here: a normal offline sale syncing to
// exactly one real sale with correct stock/cash effects; a retried sync
// job (same local transaction id) being a safe no-op, never a duplicate
// sale; a price change since offline capture routing to the conflict
// queue instead of silently completing at the stale price; a sync against
// an already-closed shift routing to the conflict queue instead of
// silently reopening it; and two offline terminals racing for the last
// unit of stock converging to exactly one sale and one conflict,
// regardless of which one's sync request reaches Postgres first.
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

test("F297/F298: offline POS sale sync against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { syncOfflinePosSale, resolvePosOfflineSyncConflict, getPosOfflineSnapshot, closeShift } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();
  const terminal2Id = randomUUID();

  const cashierContext = {
    organizationId: orgId,
    companyId,
    userId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.sale.create", "pos.offline.sync"],
  };
  const managerContext = {
    organizationId: orgId,
    companyId,
    userId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.offline.resolve"],
  };

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

  async function stockQuantity(itemId) {
    const result = await tx((c) =>
      c.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, itemId, warehouseId]),
    );
    return Number(result.rows[0]?.quantity ?? 0);
  }

  async function conflictFor(localTransactionId) {
    const result = await tx((c) =>
      c.query(`SELECT * FROM tenant.pos_offline_sync_conflicts WHERE organization_id=$1 AND local_transaction_id=$2`, [orgId, localTransactionId]),
    );
    return result.rows[0] || null;
  }

  async function salesCount() {
    const result = await tx((c) => c.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1`, [orgId]));
    return result.rows[0].n;
  }

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F297 Cashier','x','active',now())`, [
      userId,
      `f297-cashier-${userId}@test.invalid`,
    ]);
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F297 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f297-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F297 Co','F297 Co Pvt Ltd','F297CO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [
      branchId,
      orgId,
      companyId,
    ]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`, [
      warehouseId,
      orgId,
      companyId,
      branchId,
    ]);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(
      `INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`,
      [randomUUID(), orgId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR',$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, userId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalId,
      orgId,
      companyId,
      storeId,
      userId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminal2Id,
      orgId,
      companyId,
      storeId,
      userId,
    ]);

    let shift;
    await t.test("setup: open shift + item priced at 100, 10 in stock", async () => {
      shift = await tx((c) =>
        c.query(
          `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
           VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
          [orgId, companyId, storeId, terminalId, userId],
        ),
      ).then((r) => r.rows[0]);
    });

    let itemId;
    await t.test("F297: snapshot endpoint returns a bounded, versioned catalog + unsupported-operations list", async () => {
      itemId = randomUUID();
      await admin.query(
        `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F297 Widget','product',$3,$4,100,50,'active')`,
        [itemId, orgId, uomId, taxCategoryId],
      );
      await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
        orgId,
        priceListId,
        itemId,
      ]);
      await admin.query(
        `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,10,0,50)`,
        [orgId, companyId, itemId, warehouseId],
      );

      const snapshot = await tx((c) => getPosOfflineSnapshot(c, cashierContext, { storeId }));
      assert.equal(snapshot.store.id, storeId);
      assert.equal(snapshot.itemLimit, 2000);
      assert.ok(snapshot.items.some((row) => row.itemId === itemId && row.unitPrice === 100));
      assert.ok(snapshot.unsupportedOperations.some((row) => row.code === "NON_CASH_TENDER"));
      assert.ok(snapshot.encryptionSeed && snapshot.encryptionSeed.length >= 32, "a per-user encryption seed is issued");
      assert.ok(snapshot.cashierPermissions.every((permission) => permission.startsWith("pos.")));
    });

    let acceptedLocalId;
    await t.test("F298: a normal offline sale syncs to exactly one real sale with correct stock/cash effects", async () => {
      acceptedLocalId = randomUUID();
      const before = await stockQuantity(itemId);
      const result = await tx((c) =>
        syncOfflinePosSale(c, cashierContext, {
          localTransactionId: acceptedLocalId,
          storeId,
          terminalId,
          shiftId: shift.id,
          lines: [{ itemId, quantity: 2, capturedUnitPrice: 100 }],
          payments: [{ method: "cash", amount: 236 }],
        }),
      );
      assert.equal(result.outcome, "accepted");
      assert.equal(result.replayed, false);
      assert.equal(result.sale.grand_total, "236.000000");
      assert.equal(result.sale.idempotency_key, acceptedLocalId, "local transaction id maps to the server sale via idempotency_key");

      const after = await stockQuantity(itemId);
      assert.equal(before - after, 2, "stock decremented by exactly the sold quantity");

      const cashMovements = await tx((c) => c.query(`SELECT * FROM tenant.pos_cash_movements WHERE organization_id=$1 AND shift_id=$2`, [orgId, shift.id]));
      assert.equal(cashMovements.rows.length, 1);
      assert.equal(cashMovements.rows[0].amount, "236.000000");

      assert.equal(await salesCount(), 1);
    });

    await t.test("F298: replaying the SAME local transaction id is a safe no-op, never a duplicate sale", async () => {
      const before = await stockQuantity(itemId);
      const result = await tx((c) =>
        syncOfflinePosSale(c, cashierContext, {
          localTransactionId: acceptedLocalId,
          storeId,
          terminalId,
          shiftId: shift.id,
          lines: [{ itemId, quantity: 2, capturedUnitPrice: 100 }],
          payments: [{ method: "cash", amount: 236 }],
        }),
      );
      assert.equal(result.outcome, "accepted");
      assert.equal(result.replayed, true);
      const after = await stockQuantity(itemId);
      assert.equal(before, after, "no additional stock movement on replay");
      assert.equal(await salesCount(), 1, "still exactly one sale after the retried sync");
    });

    await t.test("F298: a sync where the price has materially changed since offline capture is routed to the conflict queue, not completed at the stale price", async () => {
      await admin.query(`UPDATE tenant.price_list_items SET rate=150 WHERE organization_id=$1 AND item_id=$2`, [orgId, itemId]);
      const localTransactionId = randomUUID();
      const salesBefore = await salesCount();
      const result = await tx((c) =>
        syncOfflinePosSale(c, cashierContext, {
          localTransactionId,
          storeId,
          terminalId,
          shiftId: shift.id,
          lines: [{ itemId, quantity: 1, capturedUnitPrice: 100 }],
          payments: [{ method: "cash", amount: 118 }],
        }),
      );
      assert.equal(result.outcome, "conflict");
      assert.equal(result.conflictType, "price_changed");
      assert.equal(await salesCount(), salesBefore, "no sale was created at the stale price");
      const conflictRow = await conflictFor(localTransactionId);
      assert.equal(conflictRow.status, "pending");
      assert.equal(conflictRow.conflict_type, "price_changed");

      // Resolve by voiding it (mandatory reason) -- proves the conflict
      // queue is a real, actionable resolution surface, not a dead end.
      const voided = await tx((c) => resolvePosOfflineSyncConflict(c, managerContext, conflictRow.id, { action: "void", reason: "Cashier will re-ring at current price" }));
      assert.equal(voided.status, "resolved_voided");
      await admin.query(`UPDATE tenant.price_list_items SET rate=100 WHERE organization_id=$1 AND item_id=$2`, [orgId, itemId]);
    });

    await t.test("F298: a sync attempted against an already-CLOSED shift is routed to the conflict queue, not silently reopened", async () => {
      const closedShift = await tx((c) =>
        c.query(
          `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
           VALUES ($1,$2,$3,$4,'SHIFT-CLOSED',$5,'open',now(),$5) RETURNING *`,
          [orgId, companyId, storeId, terminal2Id, userId],
        ),
      ).then((r) => r.rows[0]);
      await tx((c) => closeShift(c, { ...cashierContext, permissions: [...cashierContext.permissions, "pos.shift.close"] }, closedShift.id, { countedCash: 0 }));

      const localTransactionId = randomUUID();
      const salesBefore = await salesCount();
      const result = await tx((c) =>
        syncOfflinePosSale(c, cashierContext, {
          localTransactionId,
          storeId,
          terminalId: terminal2Id,
          shiftId: closedShift.id,
          lines: [{ itemId, quantity: 1, capturedUnitPrice: 100 }],
          payments: [{ method: "cash", amount: 118 }],
        }),
      );
      assert.equal(result.outcome, "conflict");
      assert.equal(result.conflictType, "shift_closed");
      assert.equal(await salesCount(), salesBefore, "no sale created against the closed shift");
      const reopened = await tx((c) => c.query(`SELECT status FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [orgId, closedShift.id]));
      assert.equal(reopened.rows[0].status, "closed", "the shift was never silently reopened");
    });

    await t.test("F298: an unsupported non-cash tender is routed to the conflict queue, never half-applied", async () => {
      const localTransactionId = randomUUID();
      const result = await tx((c) =>
        syncOfflinePosSale(c, cashierContext, {
          localTransactionId,
          storeId,
          terminalId,
          shiftId: shift.id,
          lines: [{ itemId, quantity: 1, capturedUnitPrice: 100 }],
          payments: [{ method: "card", amount: 118 }],
        }),
      );
      assert.equal(result.outcome, "conflict");
      assert.equal(result.conflictType, "payment_unsupported");
    });

    await t.test("F298: two offline terminals racing for the LAST unit of stock converge to exactly one sale and one conflict (order A then B)", async () => {
      const raceItemId = randomUUID();
      await admin.query(
        `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'RACE1','Race Widget','product',$3,$4,100,50,'active')`,
        [raceItemId, orgId, uomId, taxCategoryId],
      );
      await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
        orgId,
        priceListId,
        raceItemId,
      ]);
      await admin.query(
        `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1,0,50)`,
        [orgId, companyId, raceItemId, warehouseId],
      );

      const localA = randomUUID();
      const localB = randomUUID();
      const clientA = new Client({ connectionString: adminConnectionString });
      const clientB = new Client({ connectionString: adminConnectionString });
      await clientA.connect();
      await clientB.connect();
      try {
        const runSync = async (client, localTransactionId) => {
          await client.query("BEGIN");
          await setTenantContext(client, orgId);
          const result = await syncOfflinePosSale(client, cashierContext, {
            localTransactionId,
            storeId,
            terminalId,
            shiftId: shift.id,
            lines: [{ itemId: raceItemId, quantity: 1, capturedUnitPrice: 100 }],
            payments: [{ method: "cash", amount: 118 }],
          });
          await client.query("COMMIT");
          return result;
        };
        const [resultA, resultB] = await Promise.all([runSync(clientA, localA), runSync(clientB, localB)]);
        const outcomes = [resultA.outcome, resultB.outcome].sort();
        assert.deepEqual(outcomes, ["accepted", "conflict"], "exactly one terminal's sale succeeds and the other becomes a conflict");
        const conflictResult = resultA.outcome === "conflict" ? resultA : resultB;
        assert.equal(conflictResult.conflictType, "insufficient_stock");
        assert.equal(await stockQuantity(raceItemId), 0, "stock never goes negative");

        const salesForItem = await tx((c) =>
          c.query(`SELECT count(*)::int AS n FROM tenant.pos_sale_lines WHERE organization_id=$1 AND item_id=$2`, [orgId, raceItemId]),
        );
        assert.equal(salesForItem.rows[0].n, 1, "exactly one sale line was created for the contested unit");
      } finally {
        await clientA.end();
        await clientB.end();
      }
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_offline_sync_conflicts",
      "pos_offline_device_keys",
      "pos_coupon_redemptions",
      "pos_promotion_applications",
      "pos_cart_discount_approvals",
      "pos_cart_lines",
      "pos_carts",
      "pos_return_lines",
      "pos_returns",
      "pos_sale_lines",
      "pos_payments",
      "pos_cash_movements",
      "pos_sales",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
      "pos_coupons",
      "pos_promotions",
      "stock_valuation_layers",
      "stock_movements",
      "stock_balances",
      "price_list_items",
      "items",
      "price_lists",
      "sales_settings",
      "tax_rates",
      "tax_categories",
      "units_of_measure",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]).catch(() => undefined);
    await admin.end();
  }
});
