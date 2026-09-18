// Real PostgreSQL integration test — security-audit matrix items #20
// (duplicate checkout), #21 (duplicate return request), #12 (client-forged
// unit price on the cart path) and #19 (concurrent last-unit stock race).
//
// #20/#21 exercise beginIdempotentOperation/completeIdempotentOperation
// (services/api/src/core/idempotency.js): a retry with the SAME
// idempotency key AND the same canonicalized request payload must return
// `{...previousResponse, replayed: true}` without re-executing any side
// effect (no second sale, no second stock movement, no second return row,
// no second refund cash movement); the same key with a DIFFERENT payload
// must throw IDEMPOTENCY_KEY_REUSED.
//
// #12 exercises cart-pricing.js's resolveUnitPrice: unless the caller sets
// priceOverride:true AND holds pos.price.override, a client-supplied
// unitPrice is never read at all -- reprice()'s toPricingInputLines maps
// it to `undefined` for any non-override line -- so the authoritative
// price-list rate is silently substituted instead of the forged value.
//
// #19 mirrors the two-connection concurrency pattern already proven in
// tests/integration/pos-audit-integrity-and-usage-concurrency.test.mjs:
// two independent pg.Client connections, each in its own transaction,
// race completePosCart() for the last unit of stock. The actual
// serialization point is stock/index.js's postStockMovement, which takes
// `SELECT ... FOR UPDATE` on the specific tenant.stock_balances row before
// deciding INSUFFICIENT_STOCK -- not the earlier unlocked pre-check in
// point-of-sale/index.js's own stockAvailable() loop, which both
// connections can pass concurrently.
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

test("SECURITY matrix #20/#21/#12/#19: idempotent checkout/returns and price-integrity/stock-race against real PostgreSQL", async (t) => {
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
    completePointOfSaleReturn,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const cashierId = randomUUID();
  const supervisorId = randomUUID();
  const ownerId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();
  const terminalRaceAId = randomUUID();
  const terminalRaceBId = randomUUID();
  const itemId = randomUUID();
  const raceItemId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };
  const returnRequestContext = { organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [], permissions: ["pos.view", "pos.return.create"] };
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
      [cashierId, "Idem Cashier"],
      [supervisorId, "Idem Supervisor"],
      [ownerId, "Idem Owner"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `idem-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Idem Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `idem-org-${orgId}`, cashierId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Idem Co','Idem Co Pvt Ltd','IDEMCO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Idem Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEMRACE','Idem Race Widget','product',$3,$4,50,25,'active')`,
      [raceItemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,50,'active')`, [
      orgId,
      priceListId,
      raceItemId,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgId, companyId, itemId, warehouseId],
    );
    // Exactly enough stock for one sale, not two -- this is what makes the
    // #19 race meaningful.
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1,0,25)`,
      [orgId, companyId, raceItemId, warehouseId],
    );
    // allow_negative_stock defaults to false (see
    // database/tenant/migrations/048_point_of_sale_module.sql) -- left
    // unset here to prove the DEFAULT policy fails closed, not a
    // test-specific override.
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR',$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, cashierId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalId,
      orgId,
      companyId,
      storeId,
      cashierId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TRA','Terminal Race A',$5)`, [
      terminalRaceAId,
      orgId,
      companyId,
      storeId,
      cashierId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TRB','Terminal Race B',$5)`, [
      terminalRaceBId,
      orgId,
      companyId,
      storeId,
      cashierId,
    ]);
    const shift = await tx((c) =>
      c
        .query(
          `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
           VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
          [orgId, companyId, storeId, terminalId, cashierId],
        )
        .then((r) => r.rows[0]),
    );

    await t.test("MATRIX #20: retrying completePosCart with the same idempotency key never double-completes the sale or double-decrements stock; the same key with a different payload is refused", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1, expectedVersion: cart.version }));
      assert.equal(cart.grand_total, "100.000000");

      const payments = [{ method: "cash", amount: cart.grand_total }];
      const sale1 = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "dup-checkout-1", payments }));
      assert.equal(sale1.status, "completed");
      assert.equal(sale1.replayed, false);

      const stockAfterFirst = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [
        orgId,
        itemId,
        warehouseId,
      ]);
      assert.equal(stockAfterFirst.rows[0].quantity, "999.000000");

      // Exact same idempotency key AND the exact same payments array --
      // this must be a pure replay: same sale id, no new side effects.
      const sale2 = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "dup-checkout-1", payments }));
      assert.equal(sale2.replayed, true, "a retry with the identical payload must be reported as a replay, not a fresh completion");
      assert.equal(sale2.id, sale1.id, "the replay must hand back the SAME sale id, not create a second one");

      const salesCount = await admin.query(`SELECT count(*)::int AS count FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [orgId, cart.id]);
      assert.equal(salesCount.rows[0].count, 1, "exactly one pos_sales row must exist for this cart, never two");

      const movementsCount = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.stock_movements WHERE organization_id=$1 AND reference_type='pos_sale' AND reference_id=$2`,
        [orgId, sale1.id],
      );
      assert.equal(movementsCount.rows[0].count, 1, "exactly one stock movement must exist for this sale, never two");

      const stockAfterReplay = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [
        orgId,
        itemId,
        warehouseId,
      ]);
      assert.equal(stockAfterReplay.rows[0].quantity, "999.000000", "the replay must not decrement stock a second time");

      // Same key, a DIFFERENT request payload (a different paid amount) --
      // must be refused as a key-reuse conflict, never silently accepted
      // and never treated as a fresh completion.
      await assert.rejects(
        () =>
          tx((c) =>
            completePosCart(c, cashierContext, cart.id, {
              idempotencyKey: "dup-checkout-1",
              payments: [{ method: "cash", amount: "999.00" }],
            }),
          ),
        (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
      );

      const salesCountAfterMismatch = await admin.query(`SELECT count(*)::int AS count FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [orgId, cart.id]);
      assert.equal(salesCountAfterMismatch.rows[0].count, 1, "a rejected key-reuse attempt must never create another sale");
    });

    await t.test("MATRIX #12: a client-forged unitPrice on the cart path is silently overridden by the authoritative price-list rate, not merely rejected", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      // The real catalog/price-list rate for this item is 100 (see the
      // price_list_items insert above). A plain cashier holds no
      // pos.price.override permission and does not set priceOverride, so
      // this is exactly the shape of a forged request body a compromised
      // or malicious POS client could send: a deeply discounted unitPrice
      // hoping the server trusts client input.
      cart = await tx((c) =>
        addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1, unitPrice: 1, priceOverride: false, expectedVersion: cart.version }),
      );
      assert.equal(cart.lines.length, 1);
      assert.equal(cart.lines[0].unit_price, "100.000000", "the forged unitPrice=1 must be ignored; the stored/priced line must use the real catalog price of 100");
      assert.equal(cart.lines[0].price_override, false);
      assert.equal(cart.subtotal, "100.000000", "the cart subtotal must be computed from the authoritative price, not the forged one");
      assert.equal(cart.grand_total, "100.000000");

      const row = await admin.query(`SELECT unit_price FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id=$2`, [orgId, cart.id]);
      assert.equal(row.rows[0].unit_price, "100.000000", "the persisted pos_cart_lines.unit_price must also be the real price, confirming reprice() overwrote the forged value rather than merely masking it in the response");

      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test cleanup" }));
    });

    let saleForReturn;
    await t.test("setup: a second sale to exercise the duplicate-return matrix item against", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1, expectedVersion: cart.version }));
      saleForReturn = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "return-source-sale", payments: [{ method: "cash", amount: cart.grand_total }] }));
      assert.equal(saleForReturn.status, "completed");
    });

    await t.test("MATRIX #21: retrying createPointOfSaleReturn/approvePointOfSaleReturn/completePointOfSaleReturn with their own already-used idempotency keys never creates duplicate rows or a duplicate refund", async () => {
      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleForReturn.id]);
      const returnLines = saleLines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity }));

      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, returnRequestContext, {
          saleId: saleForReturn.id,
          reason: "matrix #21 duplicate-return test",
          idempotencyKey: "dup-return-create",
          lines: returnLines,
        }),
      );
      assert.equal(returnRecord.status, "pending_approval");

      const approved = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "dup-return-approve" }));
      assert.equal(approved.status, "approved");

      const completed = await tx((c) => completePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "dup-return-complete" }));
      assert.equal(completed.status, "completed");

      // Retry each of the three calls individually with its own
      // already-used idempotency key and the exact same payload.
      const createRetry = await tx((c) =>
        createPointOfSaleReturn(c, returnRequestContext, {
          saleId: saleForReturn.id,
          reason: "matrix #21 duplicate-return test",
          idempotencyKey: "dup-return-create",
          lines: returnLines,
        }),
      );
      assert.equal(createRetry.replayed, true, "retrying createPointOfSaleReturn must be reported as a replay");
      assert.equal(createRetry.id, returnRecord.id, "the replay must hand back the SAME return id");

      const approveRetry = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "dup-return-approve" }));
      assert.equal(approveRetry.replayed, true, "retrying approvePointOfSaleReturn must be reported as a replay");
      assert.equal(approveRetry.id, returnRecord.id);

      const completeRetry = await tx((c) => completePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "dup-return-complete" }));
      assert.equal(completeRetry.replayed, true, "retrying completePointOfSaleReturn must be reported as a replay");
      assert.equal(completeRetry.id, returnRecord.id);

      const returnRowCount = await admin.query(`SELECT count(*)::int AS count FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleForReturn.id]);
      assert.equal(returnRowCount.rows[0].count, 1, "exactly one pos_returns row must exist -- the three retries must not have created duplicates");

      const refundMovements = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_cash_movements WHERE organization_id=$1 AND movement_type='refund' AND reference_id=$2`,
        [orgId, returnRecord.id],
      );
      assert.equal(refundMovements.rows[0].count, 1, "exactly one refund cash movement must exist -- retrying completePointOfSaleReturn must not double-refund");
    });

    await t.test("MATRIX #19: two connections racing to buy the last unit of stock -- exactly one succeeds, stock never goes negative", async () => {
      const shiftA = await tx((c) =>
        c
          .query(
            `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
             VALUES ($1,$2,$3,$4,'SHIFT-RACE-A',$5,'open',now(),$5) RETURNING *`,
            [orgId, companyId, storeId, terminalRaceAId, cashierId],
          )
          .then((r) => r.rows[0]),
      );
      const shiftB = await tx((c) =>
        c
          .query(
            `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
             VALUES ($1,$2,$3,$4,'SHIFT-RACE-B',$5,'open',now(),$5) RETURNING *`,
            [orgId, companyId, storeId, terminalRaceBId, cashierId],
          )
          .then((r) => r.rows[0]),
      );

      let cartA = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalRaceAId, shiftId: shiftA.id }));
      let cartB = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalRaceBId, shiftId: shiftB.id }));
      cartA = await tx((c) => addPosCartLine(c, cashierContext, cartA.id, { itemId: raceItemId, quantity: 1, expectedVersion: cartA.version }));
      cartB = await tx((c) => addPosCartLine(c, cashierContext, cartB.id, { itemId: raceItemId, quantity: 1, expectedVersion: cartB.version }));
      assert.equal(cartA.grand_total, "50.000000");
      assert.equal(cartB.grand_total, "50.000000");

      // Two genuinely separate PostgreSQL connections, each completing its
      // own cart inside its own transaction -- both reach
      // postStockMovement's `SELECT ... FOR UPDATE` on the SAME
      // tenant.stock_balances row for raceItemId/warehouseId at roughly
      // the same time. Postgres itself serializes them; the loser must see
      // the post-commit quantity (0) and fail closed, not the stale
      // pre-race quantity (1).
      const clientA = await connectOrNull(adminConnectionString);
      const clientB = await connectOrNull(adminConnectionString);
      try {
        await clientA.query("BEGIN");
        await setTenantContext(clientA, orgId);
        await clientB.query("BEGIN");
        await setTenantContext(clientB, orgId);

        const runA = completePosCart(clientA, cashierContext, cartA.id, { idempotencyKey: "stock-race-a", payments: [{ method: "cash", amount: cartA.grand_total }] })
          .then(async (result) => {
            await clientA.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const runB = completePosCart(clientB, cashierContext, cartB.id, { idempotencyKey: "stock-race-b", payments: [{ method: "cash", amount: cartB.grand_total }] })
          .then(async (result) => {
            await clientB.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientB.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });

        const [outcomeA, outcomeB] = await Promise.all([runA, runB]);
        const outcomes = [outcomeA, outcomeB];
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactly one of the two racing completions must succeed");
        assert.equal(rejected.length, 1, "exactly one of the two racing completions must fail closed");
        assert.equal(rejected[0].reason.code, "INSUFFICIENT_STOCK", "the loser must fail with the real insufficient-stock error, not something else");
      } finally {
        await clientA.end();
        await clientB.end();
      }

      const stockAfterRace = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [
        orgId,
        raceItemId,
        warehouseId,
      ]);
      assert.equal(stockAfterRace.rows[0].quantity, "0.000000", "stock must land at exactly 0, never negative and never still 1 (i.e. exactly one sale actually decremented it)");

      const salesForRaceItem = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_sale_lines WHERE organization_id=$1 AND item_id=$2`,
        [orgId, raceItemId],
      );
      assert.equal(salesForRaceItem.rows[0].count, 1, "exactly one sale line must exist for the race item -- only the winner actually sold it");
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
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierId, supervisorId, ownerId]]).catch(() => undefined);
    await admin.end();
  }
});
