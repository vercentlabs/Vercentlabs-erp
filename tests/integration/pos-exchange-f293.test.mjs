// Real PostgreSQL integration test — POS consolidated pass, F293
// exchanges: completePosExchange links an approved return to a
// replacement sale WITHOUT duplicating any return/sale/stock/cash logic
// -- it calls the existing, already-tested completePointOfSaleReturn()
// and completePosCart() exactly once each inside one transaction, then
// stamps tenant.pos_sales.exchange_return_id (migration 116). Proves:
// exactly-once stock/cash effects (no double restock, no double issue, no
// duplicate cash movement -- because nothing new was invented, only
// composed), real lineage, and that an exchange can't proceed against an
// unapproved return.
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

test("F293: exchanges are linked lineage over the existing return/sale primitives, with exactly-once effects, against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    completePosCart,
    cancelPosCart,
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePosExchange,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const ownerId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const itemAId = randomUUID();
  const itemBId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();

  const context = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.return.create"] };
  const ownerContext = { organizationId: orgId, companyId, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [] };

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
    for (const [id, name] of [
      [userId, "F293 Cashier"],
      [ownerId, "F293 Owner"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `f293-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F293 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f293-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F293 Co','F293 Co Pvt Ltd','F293CO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEMA','F293 Widget A','product',$3,$4,100,50,'active')`,
      [itemAId, orgId, uomId, taxCategoryId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEMB','F293 Widget B','product',$3,$4,150,75,'active')`,
      [itemBId, orgId, uomId, taxCategoryId],
    );
    for (const [itemId, rate] of [
      [itemAId, 100],
      [itemBId, 150],
    ]) {
      await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,$4,'active')`, [
        orgId,
        priceListId,
        itemId,
        rate,
      ]);
    }
    for (const itemId of [itemAId, itemBId]) {
      await admin.query(
        `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
        [orgId, companyId, itemId, warehouseId],
      );
    }
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

    // Original sale: one unit of item A (100).
    let cartA = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
    cartA = await tx((c) => addPosCartLine(c, context, cartA.id, { itemId: itemAId, quantity: 1, expectedVersion: cartA.version }));
    const originalSale = await tx((c) => completePosCart(c, context, cartA.id, { idempotencyKey: "f293-original", payments: [{ method: "cash", amount: cartA.grand_total }] }));

    const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, originalSale.id]);
    const returnRecord = await tx((c) =>
      createPointOfSaleReturn(c, context, {
        saleId: originalSale.id,
        reason: "F293 exchange test",
        idempotencyKey: "f293-return",
        lines: saleLines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity, restock: true })),
      }),
    );

    await t.test("F293 SECURITY: an exchange cannot proceed against a return that is not yet approved", async () => {
      let blockedCart = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      blockedCart = await tx((c) => addPosCartLine(c, context, blockedCart.id, { itemId: itemBId, quantity: 1, expectedVersion: blockedCart.version }));
      await assert.rejects(
        () =>
          tx((c) =>
            completePosExchange(c, ownerContext, {
              returnId: returnRecord.id,
              cartId: blockedCart.id,
              idempotencyKey: "f293-exchange-blocked",
              payments: [{ method: "cash", amount: blockedCart.grand_total }],
            }),
          ),
        (error) => error.code === "POS_RETURN_NOT_APPROVED",
      );
      // Free the terminal for the next test -- this cart must not linger
      // as the "active" cart createPosCart would otherwise hand back.
      await tx((c) => cancelPosCart(c, context, blockedCart.id, { reason: "test cleanup" }));
    });

    await t.test("F293 SECURITY: completing an exchange requires supervisor-level authority (pos.return.approve), not just pos.sale.create", async () => {
      let cartB = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      cartB = await tx((c) => addPosCartLine(c, context, cartB.id, { itemId: itemBId, quantity: 1, expectedVersion: cartB.version }));
      await assert.rejects(
        () =>
          tx((c) =>
            completePosExchange(c, context, {
              returnId: returnRecord.id,
              cartId: cartB.id,
              idempotencyKey: "f293-exchange-forbidden",
              payments: [{ method: "cash", amount: cartB.grand_total }],
            }),
          ),
        (error) => error.code === "FORBIDDEN",
      );
      await tx((c) => cancelPosCart(c, context, cartB.id, { reason: "test cleanup" }));
    });

    let exchange;
    let cartB;
    await t.test("F293: exchanging item A for item B completes the return, completes the replacement sale, and links them", async () => {
      await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "f293-approve" }));

      cartB = await tx((c) => createPosCart(c, context, { storeId, terminalId, shiftId: shift.id }));
      cartB = await tx((c) => addPosCartLine(c, context, cartB.id, { itemId: itemBId, quantity: 1, expectedVersion: cartB.version }));
      assert.equal(cartB.grand_total, "150.000000", "item B at 150, no tax rate configured in this test's fixture");

      // organization_owner bypasses every permission check, including the
      // pos.sale.create + pos.return.approve pair completePosExchange
      // requires -- a real deployment would use a pos_supervisor-role user
      // (who genuinely holds both), exercised here via the same bypass
      // path several other POS suites already use for a "definitely
      // authorized" actor.
      exchange = await tx((c) =>
        completePosExchange(c, ownerContext, {
          returnId: returnRecord.id,
          cartId: cartB.id,
          idempotencyKey: "f293-exchange",
          payments: [{ method: "cash", amount: cartB.grand_total }],
        }),
      );
      assert.equal(exchange.return.status, "completed");
      assert.equal(exchange.sale.status, "completed");
      assert.equal(exchange.sale.exchange_return_id, returnRecord.id, "the replacement sale must be linked to the return it exchanges");
    });

    await t.test("F293: exactly-once effects -- item A restocked exactly once, item B issued exactly once, exactly one refund + one sale cash movement", async () => {
      const stockA = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, itemAId, warehouseId]);
      assert.equal(stockA.rows[0].quantity, "1000.000000", "item A: 1000 -1 (original sale) +1 (restocked on return) = 1000, exactly once each way");
      const stockB = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, itemBId, warehouseId]);
      assert.equal(stockB.rows[0].quantity, "999.000000", "item B issued exactly once for the replacement sale");

      const refundMovements = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_cash_movements WHERE organization_id=$1 AND movement_type='refund' AND reference_id=$2`,
        [orgId, returnRecord.id],
      );
      assert.equal(refundMovements.rows[0].count, 1, "exactly one refund cash movement for the return side of the exchange");
      const saleMovements = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_cash_movements WHERE organization_id=$1 AND movement_type='sale' AND reference_id=$2`,
        [orgId, exchange.sale.id],
      );
      assert.equal(saleMovements.rows[0].count, 1, "exactly one sale cash movement for the replacement side of the exchange");

      const linkedSale = await admin.query(`SELECT exchange_return_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [orgId, exchange.sale.id]);
      assert.equal(linkedSale.rows[0].exchange_return_id, returnRecord.id);
    });

    await t.test("F293: retrying the same exchange with the same idempotency key never double-completes either side", async () => {
      await assert.rejects(
        () =>
          tx((c) =>
            completePosExchange(c, ownerContext, {
              returnId: returnRecord.id,
              cartId: cartB.id,
              idempotencyKey: "f293-exchange",
              payments: [{ method: "cash", amount: cartB.grand_total }],
            }),
          ),
        (error) => ["POS_RETURN_NOT_APPROVED", "POS_RETURN_STATE_CONFLICT", "POS_CART_NOT_PRICED"].includes(error.code),
        "the return is already completed (no longer 'approved') and the cart is already completed -- retrying must fail closed, not double-effect anything",
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
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[userId, ownerId]]).catch(() => undefined);
    await admin.end();
  }
});
