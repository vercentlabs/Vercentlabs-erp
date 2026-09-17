// Real PostgreSQL integration test — POS consolidated pass, F287/F288
// held-cart operator workflow: listHeldPosCarts (the queue an operator
// browses), resumePosCart's terminal-conflict guard (a held cart must not
// silently collide with a different active cart already occupying the
// same terminal -- pos_carts_one_active_per_terminal_uidx), and the
// held-cart expiry policy (24h, lazy/on-read, same convention as the
// existing draft/priced cart expiry).
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

test("F287/F288: held-cart queue, resume terminal-conflict guard, and held-cart expiry against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { createPosCart, addPosCartLine, holdPosCart, resumePosCart, listHeldPosCarts, getPosCart } = await import("../../services/api/src/index.js");
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

  const context = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };

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
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F287 Cashier','x','active',now())`,
      [userId, `f287-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F287 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f287-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F287 Co','F287 Co Pvt Ltd','F287CO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F287 Widget','product',$3,$4,100,50,'active')`,
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
    const shift = await tx((c) =>
      c
        .query(
          `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
           VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
          [orgId, companyId, storeId, terminalId, userId],
        )
        .then((r) => r.rows[0]),
    );

    let heldCart;
    await t.test("F287: holding a priced cart removes it from the active terminal slot and lists it in the held-cart queue", async () => {
      let cart = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, context, cart.id, { itemId, quantity: 2, expectedVersion: cart.version }));
      heldCart = await tx((c) => holdPosCart(c, context, cart.id, { expectedVersion: cart.version }));
      assert.equal(heldCart.status, "held");

      const queue = await tx((c) => listHeldPosCarts(c, context));
      assert.equal(queue.length, 1);
      assert.equal(queue[0].id, heldCart.id);
      assert.equal(queue[0].line_count, 1);
      assert.equal(queue[0].store_name, "Store 1");
    });

    await t.test("F288 SECURITY: resuming is rejected with a clear conflict if a DIFFERENT cart is already active on the same terminal", async () => {
      // The cashier started a new sale on the same terminal after holding.
      let newCart = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      assert.notEqual(newCart.id, heldCart.id);
      newCart = await tx((c) => addPosCartLine(c, context, newCart.id, { itemId, quantity: 1, expectedVersion: newCart.version }));

      await assert.rejects(() => tx((c) => resumePosCart(c, context, heldCart.id)), (error) => error.code === "POS_TERMINAL_CART_CONFLICT");

      // Resolve the conflict (hold the new one too) -- resume must now work.
      await tx((c) => holdPosCart(c, context, newCart.id, { expectedVersion: newCart.version }));
    });

    await t.test("F288: resume reprices from scratch (no stale snapshot) and clears the held state", async () => {
      const resumed = await tx((c) => resumePosCart(c, context, heldCart.id));
      assert.equal(resumed.status, "priced");
      assert.equal(resumed.subtotal, "200.000000");

      const queue = await tx((c) => listHeldPosCarts(c, context));
      assert.equal(queue.length, 1, "the OTHER cart (held to resolve the conflict) is still queued; the resumed one is gone");
      assert.notEqual(queue[0].id, resumed.id);
    });

    await t.test("F287: a held cart older than the 24h expiry window is lazily flipped to expired on next access, not resumable", async () => {
      // Whatever is currently active on this terminal (the cart resumed in
      // the previous test) must be held out of the way first, or
      // createPosCart's own dedup would just hand it straight back.
      const stillActive = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      await tx((c) => holdPosCart(c, context, stillActive.id, { expectedVersion: stillActive.version }));

      let staleCart = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      staleCart = await tx((c) => addPosCartLine(c, context, staleCart.id, { itemId, quantity: 1, expectedVersion: staleCart.version }));
      const held = await tx((c) => holdPosCart(c, context, staleCart.id, { expectedVersion: staleCart.version }));
      await admin.query(`UPDATE tenant.pos_carts SET held_at=now() - interval '25 hours' WHERE id=$1`, [held.id]);

      const queue = await tx((c) => listHeldPosCarts(c, context));
      assert.ok(!queue.some((row) => row.id === held.id), "an expired held cart must not appear in the active queue");

      const fetched = await tx((c) => getPosCart(c, context, held.id));
      assert.equal(fetched.status, "expired");

      await assert.rejects(() => tx((c) => resumePosCart(c, context, held.id)), (error) => error.code === "POS_CART_NOT_HELD");
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_cart_lines",
      "pos_carts",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
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
