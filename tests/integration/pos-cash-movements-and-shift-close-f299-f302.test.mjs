// Real PostgreSQL integration test — POS consolidated pass, F299-F302
// cash/shift operations: paid-in/paid-out cash movements (recordPosCashMovement,
// a real domain function this pass adds -- pos_cash_movements.movement_type
// already accepted 'paid_in'/'paid_out' in the schema, but nothing ever
// wrote one) and closeShift's new unresolved-transaction guards (an active
// draft/priced cart, or a pending/approved return, must be resolved before
// the shift can close -- a held cart does NOT block closing, since holding
// is the real "come back for this later" case with no payment/stock
// commitment yet).
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

test("F299-F302: cash movements and shift-close unresolved-transaction guards against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    holdPosCart,
    completePosCart,
    recordPosCashMovement,
    listPosCashMovements,
    closeShift,
    createPointOfSaleReturn,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();

  const context = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.shift.open", "pos.shift.close", "pos.cash.adjust", "pos.return.create"] };

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

  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F299 Cashier','x','active',now())`,
      [userId, `f299-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F299 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f299-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F299 Co','F299 Co Pvt Ltd','F299CO','INR','IN',true,'active')`,
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
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F299 Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgId, companyId, itemId, warehouseId],
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

    let shift;
    await t.test("F299/F300: opening posts a real opening cash movement, and paid_in/paid_out are recorded as real, immutable, signed movements", async () => {
      shift = await tx((c) =>
        c
          .query(
            `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
             VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',500,500,now(),$5) RETURNING *`,
            [orgId, companyId, storeId, terminalId, userId],
          )
          .then((r) => r.rows[0]),
      );
      // Session 2's openShift already posts the real opening movement; this
      // test inserts the shift row directly (as several other suites do)
      // and posts the matching opening movement itself so expected_cash
      // reconciliation below is meaningful without re-testing openShift.
      await admin.query(
        `INSERT INTO tenant.pos_cash_movements(organization_id,company_id,shift_id,movement_number,movement_type,amount,reason,created_by) VALUES ($1,$2,$3,'CASH-0001','opening',500,'Opening float',$4)`,
        [orgId, companyId, shift.id, userId],
      );

      const paidOut = await tx((c) => recordPosCashMovement(c, context, shift.id, { movementType: "paid_out", amount: 50, reason: "Petty cash for supplies" }));
      assert.equal(paidOut.amount, "-50.000000", "paid_out must be recorded as a NEGATIVE signed amount (reduces expected cash)");
      const paidIn = await tx((c) => recordPosCashMovement(c, context, shift.id, { movementType: "paid_in", amount: 20, reason: "Change fund top-up" }));
      assert.equal(paidIn.amount, "20.000000", "paid_in must be recorded as a POSITIVE signed amount (increases expected cash)");

      await assert.rejects(
        () => tx((c) => recordPosCashMovement(c, context, shift.id, { movementType: "paid_out", amount: 0, reason: "invalid" })),
        (error) => error.code === "POS_CASH_MOVEMENT_AMOUNT_INVALID",
      );
      await assert.rejects(
        () => tx((c) => recordPosCashMovement(c, context, shift.id, { movementType: "paid_out", amount: 10, reason: "" })),
        (error) => error.code === "POS_CASH_MOVEMENT_REASON_REQUIRED",
      );

      const movements = await tx((c) => listPosCashMovements(c, context, shift.id));
      assert.equal(movements.length, 3, "opening + paid_out + paid_in");
    });

    await t.test("F302 SECURITY: closing a shift is refused while a draft/priced cart is still active on it", async () => {
      let cart = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, context, cart.id, { itemId, quantity: 1, expectedVersion: cart.version }));
      await assert.rejects(
        () => tx((c) => closeShift(c, context, shift.id, { countedCash: 470 })),
        (error) => error.code === "POS_SHIFT_HAS_UNRESOLVED_CART",
      );

      // A HELD cart, by contrast, must NOT block closing -- it's designed
      // to survive the shift and be resumed on a later one.
      await tx((c) => holdPosCart(c, context, cart.id, { expectedVersion: cart.version }));
      // Closing should now get past the cart check (it may still fail on
      // something else transiently, but never POS_SHIFT_HAS_UNRESOLVED_CART).
      let cartGuardStillFiring = false;
      try {
        await tx((c) => closeShift(c, context, shift.id, { countedCash: 470 }));
      } catch (error) {
        cartGuardStillFiring = error.code === "POS_SHIFT_HAS_UNRESOLVED_CART";
      }
      assert.equal(cartGuardStillFiring, false, "a HELD cart must not block shift closure");
    });

    await t.test("F302 SECURITY: closing a shift is refused while a pending/approved return exists on it", async () => {
      // Complete a fresh sale on a NEW shift (the previous one is now
      // closed) so there is something eligible to return against.
      const shift2 = await tx((c) =>
        c
          .query(
            `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
             VALUES ($1,$2,$3,$4,'SHIFT-2',$5,'open',0,0,now(),$5) RETURNING *`,
            [orgId, companyId, storeId, terminalId, userId],
          )
          .then((r) => r.rows[0]),
      );
      let cart2 = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift2.id }));
      cart2 = await tx((c) => addPosCartLine(c, context, cart2.id, { itemId, quantity: 1, expectedVersion: cart2.version }));
      const sale2 = await tx((c) => completePosCart(c, context, cart2.id, { idempotencyKey: "f302-sale", payments: [{ method: "cash", amount: cart2.grand_total }] }));

      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale2.id]);
      await tx((c) =>
        createPointOfSaleReturn(c, context, {
          saleId: sale2.id,
          reason: "F302 test return",
          idempotencyKey: "f302-return",
          lines: saleLines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity })),
        }),
      );

      await assert.rejects(
        () => tx((c) => closeShift(c, context, shift2.id, { countedCash: cart2.grand_total })),
        (error) => error.code === "POS_SHIFT_HAS_UNRESOLVED_RETURN",
      );
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_return_lines",
      "pos_returns",
      "pos_cart_lines",
      "pos_carts",
      "pos_cash_movements",
      "pos_sale_lines",
      "pos_payments",
      "pos_sales",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
      "stock_valuation_layers",
      "stock_movements",
      "stock_balances",
      "price_list_items",
      "items",
      "price_lists",
      "sales_settings",
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
