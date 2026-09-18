// Real PostgreSQL integration test — F295 lot/serial support. Before this
// change, tenant.items had no column indicating an item requires serial or
// batch/lot tracking, tenant.stock_serials.status existed (migration 044,
// default 'available') but nothing anywhere ever transitioned it, and
// postStockMovement (services/api/src/modules/stock/index.js) validated a
// supplied serialId/batchId existed but never REQUIRED one for an item
// that should mandate it and could not detect "this serial was already
// sold." This suite is the permanent regression gate for the fix:
// tenant.items.tracking_type (migration 117), tenant.stock_serials'
// available/sold CHECK constraint (migration 117), and postStockMovement's
// requireTrackingReference()/applySerialTransition().
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

test("F295: serial requirement, sold/available lifecycle, double-sell rejection, and full-return restock against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    completePointOfSale,
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePointOfSaleReturn,
  } = await import("../../services/api/src/index.js");
  const { postStockMovement } = await import("../../services/api/src/modules/stock/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const supervisorId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const uomId = randomUUID();
  const serialItemId = randomUUID();
  const batchItemId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };
  const supervisorContext = { organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [], permissions: ["pos.view", "pos.return.create"] };
  const ownerContext = { organizationId: orgId, companyId, userId, roleSlugs: ["organization_owner"], permissions: [] };
  const stockContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["stock.issue", "stock.receive"] };

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

  let serialId;
  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F295 Cashier','x','active',now())`,
      [userId, `f295-cashier-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F295 Supervisor','x','active',now())`,
      [supervisorId, `f295-supervisor-${supervisorId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F295 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f295-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F295 Co','F295 Co Pvt Ltd','F295CO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`,
      [branchId, orgId, companyId],
    );
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`,
      [warehouseId, orgId, companyId, branchId],
    );
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    // Serial-tracked item -- no tax category, keeping the tax pipeline a
    // trivial no-op so this suite stays focused on the tracking behavior.
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,sales_price,standard_cost,status,tracking_type) VALUES ($1,$2,'SERIAL1','F295 Serial Widget','product',$3,100,50,'active','serial')`,
      [serialItemId, orgId, uomId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      serialItemId,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,10,0,50)`,
      [orgId, companyId, serialItemId, warehouseId],
    );
    serialId = randomUUID();
    await admin.query(
      `INSERT INTO tenant.stock_serials(id,organization_id,company_id,item_id,serial_number,warehouse_id,status) VALUES ($1,$2,$3,$4,'SN-0001',$5,'available')`,
      [serialId, orgId, companyId, serialItemId, warehouseId],
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
    const shift = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminalId, userId],
      ),
    ).then((r) => r.rows[0]);

    await t.test("a serial-tracked item cannot be sold without a serial (STOCK_SERIAL_REQUIRED)", async () => {
      await assert.rejects(
        () =>
          tx((c) =>
            completePointOfSale(c, cashierContext, {
              shiftId: shift.id,
              idempotencyKey: "f295-no-serial",
              lines: [{ itemId: serialItemId, quantity: 1, unitPrice: 100 }],
              payments: [{ method: "cash", amount: 100 }],
            }),
          ),
        (error) => error?.status === 400 && error?.code === "STOCK_SERIAL_REQUIRED",
      );
    });

    let firstSale;
    await t.test("selling with a valid available serial succeeds and transitions the serial to 'sold'", async () => {
      firstSale = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          idempotencyKey: "f295-sale-1",
          lines: [{ itemId: serialItemId, quantity: 1, unitPrice: 100, serialId }],
          payments: [{ method: "cash", amount: 100 }],
        }),
      );
      assert.equal(firstSale.status, "completed");
      const serialRow = await admin.query(`SELECT status FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [orgId, serialId]);
      assert.equal(serialRow.rows[0].status, "sold");
    });

    await t.test("attempting to sell the SAME serial again is rejected (STOCK_SERIAL_NOT_AVAILABLE) -- the double-sell this fix closes", async () => {
      await assert.rejects(
        () =>
          tx((c) =>
            completePointOfSale(c, cashierContext, {
              shiftId: shift.id,
              idempotencyKey: "f295-double-sell",
              lines: [{ itemId: serialItemId, quantity: 1, unitPrice: 100, serialId }],
              payments: [{ method: "cash", amount: 100 }],
            }),
          ),
        (error) => error?.status === 409 && error?.code === "STOCK_SERIAL_NOT_AVAILABLE",
      );
      const serialRow = await admin.query(`SELECT status FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [orgId, serialId]);
      assert.equal(serialRow.rows[0].status, "sold", "the rejected double-sell must not have mutated the serial's status");
    });

    await t.test("a full return of that sale restocks and restores the serial to 'available'", async () => {
      const saleLines = await admin.query(`SELECT id FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, firstSale.id]);
      const saleLineId = saleLines.rows[0].id;
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, supervisorContext, {
          saleId: firstSale.id,
          idempotencyKey: "f295-return-1",
          reason: "Customer changed mind",
          lines: [{ saleLineId, quantity: 1, restock: true }],
        }),
      );
      const approved = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "f295-return-approve-1" }));
      await tx((c) => completePointOfSaleReturn(c, ownerContext, approved.id, { idempotencyKey: "f295-return-complete-1" }));

      const serialRow = await admin.query(`SELECT status FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [orgId, serialId]);
      assert.equal(serialRow.rows[0].status, "available", "a full return must restore the serial to available");
    });

    await t.test("the restored serial can be genuinely sold again (the lifecycle is real, not a one-way flag)", async () => {
      const secondSale = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          idempotencyKey: "f295-sale-2",
          lines: [{ itemId: serialItemId, quantity: 1, unitPrice: 100, serialId }],
          payments: [{ method: "cash", amount: 100 }],
        }),
      );
      assert.equal(secondSale.status, "completed");
      const serialRow = await admin.query(`SELECT status FROM tenant.stock_serials WHERE organization_id=$1 AND id=$2`, [orgId, serialId]);
      assert.equal(serialRow.rows[0].status, "sold");
    });

    // Batch requirement -- the "equivalent requirement" for tracking_type=
    // 'batch': tested directly against Stock's own postStockMovement
    // (not routed through POS) since stock_balances is already correctly
    // dimensioned by batch_id -- the only real gap was that a batch was
    // never actually REQUIRED on an issue.
    await t.test("a batch-tracked item cannot be issued without a batch (STOCK_BATCH_REQUIRED), and succeeds once one is supplied", async () => {
      await admin.query(
        `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,sales_price,standard_cost,status,tracking_type) VALUES ($1,$2,'BATCH1','F295 Batch Widget','product',$3,50,25,'active','batch')`,
        [batchItemId, orgId, uomId],
      );
      const batchId = randomUUID();
      await admin.query(
        `INSERT INTO tenant.stock_batches(id,organization_id,company_id,item_id,batch_number,status) VALUES ($1,$2,$3,$4,'BATCH-0001','active')`,
        [batchId, orgId, companyId, batchItemId],
      );
      await admin.query(
        `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,batch_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,$5,10,0,25)`,
        [orgId, companyId, batchItemId, warehouseId, batchId],
      );

      await assert.rejects(
        () =>
          tx((c) =>
            postStockMovement(c, stockContext, {
              movementType: "issue",
              itemId: batchItemId,
              warehouseId,
              quantity: 1,
              idempotencyKey: "f295-batch-no-batch",
            }),
          ),
        (error) => error?.status === 400 && error?.code === "STOCK_BATCH_REQUIRED",
      );

      const movement = await tx((c) =>
        postStockMovement(c, stockContext, {
          movementType: "issue",
          itemId: batchItemId,
          warehouseId,
          batchId,
          quantity: 1,
          idempotencyKey: "f295-batch-with-batch",
        }),
      );
      assert.equal(movement.replayed, false);
      const balance = await admin.query(
        `SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND batch_id=$4`,
        [orgId, companyId, batchItemId, batchId],
      );
      assert.equal(Number(balance.rows[0].quantity), 9);
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
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
      "stock_valuation_layers",
      "stock_movements",
      "stock_serials",
      "stock_batches",
      "stock_balances",
      "price_list_items",
      "items",
      "price_lists",
      "sales_settings",
      "units_of_measure",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[userId, supervisorId]]).catch(() => undefined);
    await admin.end();
  }
});
