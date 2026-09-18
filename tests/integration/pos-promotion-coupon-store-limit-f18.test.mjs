// Real PostgreSQL integration test — matrix item #18, the per-store half.
// tenant.pos_promotions/tenant.pos_coupons already had usage_limit_total
// and usage_limit_per_customer (migration 113), correctly enforced at both
// preview time (cart-pricing.js) and commit time under the record's own
// row lock (promotions.js/coupons.js), including under real concurrency
// (see pos-audit-integrity-and-usage-concurrency.test.mjs). This suite is
// the permanent regression gate for usage_limit_per_store (migration 118),
// which follows the exact same two-check pattern, counted from the SAME
// evidence tables (pos_promotion_applications/pos_coupon_redemptions) now
// carrying store_id -- proving it is genuinely STORE-scoped (rejected once
// a store's own cap is hit, but still usable at a different store, not
// accidentally a second global counter) and race-free under two genuine
// concurrent PostgreSQL connections racing for the same store's last
// allowed use.
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

test("Matrix #18 (per-store half): promotion/coupon usage_limit_per_store is store-scoped and race-free against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    applyPosCartCoupon,
    completePosCart,
    createPosPromotion,
    createPosCoupon,
    openShift,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const adminUserId = randomUUID();
  const cashierId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const uomId = randomUUID();
  const itemId = randomUUID();
  const storeAId = randomUUID();
  const storeBId = randomUUID();
  const terminalA1Id = randomUUID();
  const terminalA2Id = randomUUID();
  const terminalBId = randomUUID();

  const adminContext = { organizationId: orgId, companyId, userId: adminUserId, roleSlugs: [], permissions: ["pos.view", "pos.settings.manage"] };
  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.shift.open"] };

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
      [adminUserId, "F18 Admin"],
      [cashierId, "F18 Cashier"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `f18-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F18 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f18-org-${orgId}`, adminUserId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F18 Co','F18 Co Pvt Ltd','F18CO','INR','IN',true,'active')`,
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
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F18 Widget','product',$3,100,50,'active')`,
      [itemId, orgId, uomId],
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
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SA','Store A',$5,$6,'INR',$7)`,
      [storeAId, orgId, companyId, branchId, warehouseId, priceListId, adminUserId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SB','Store B',$5,$6,'INR',$7)`,
      [storeBId, orgId, companyId, branchId, warehouseId, priceListId, adminUserId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA1','Terminal A1',$5)`, [
      terminalA1Id,
      orgId,
      companyId,
      storeAId,
      adminUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA2','Terminal A2',$5)`, [
      terminalA2Id,
      orgId,
      companyId,
      storeAId,
      adminUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TB1','Terminal B1',$5)`, [
      terminalBId,
      orgId,
      companyId,
      storeBId,
      adminUserId,
    ]);

    await t.test("COUPON: store-scoped cap rejects a second use at the SAME store, races correctly, and stays usable at a DIFFERENT store", async () => {
      const coupon = await tx((c) =>
        createPosCoupon(c, adminContext, { code: "STORECAP1", discountType: "amount", discountValue: 5, usageLimitPerStore: 1 }),
      );

      const shiftA1 = await tx((c) => openShift(c, cashierContext, { storeId: storeAId, terminalId: terminalA1Id, openingCash: 0 }));
      const shiftA2 = await tx((c) => openShift(c, cashierContext, { storeId: storeAId, terminalId: terminalA2Id, openingCash: 0 }));
      let cartA1 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeAId, terminalId: terminalA1Id, shiftId: shiftA1.id }));
      let cartA2 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeAId, terminalId: terminalA2Id, shiftId: shiftA2.id }));
      cartA1 = await tx((c) => addPosCartLine(c, cashierContext, cartA1.id, { itemId, quantity: 1, expectedVersion: cartA1.version }));
      cartA2 = await tx((c) => addPosCartLine(c, cashierContext, cartA2.id, { itemId, quantity: 1, expectedVersion: cartA2.version }));
      cartA1 = await tx((c) => applyPosCartCoupon(c, cashierContext, cartA1.id, { code: "STORECAP1", expectedVersion: cartA1.version }));
      cartA2 = await tx((c) => applyPosCartCoupon(c, cashierContext, cartA2.id, { code: "STORECAP1", expectedVersion: cartA2.version }));

      // Two genuinely separate PostgreSQL connections racing for the SAME
      // store's last allowed use -- both reach commitPosCouponRedemption's
      // FOR UPDATE on the same coupon row at roughly the same time, and
      // Postgres itself serializes them, not application code.
      const clientA1 = await connectOrNull(adminConnectionString);
      const clientA2 = await connectOrNull(adminConnectionString);
      try {
        await clientA1.query("BEGIN");
        await setTenantContext(clientA1, orgId);
        await clientA2.query("BEGIN");
        await setTenantContext(clientA2, orgId);

        const run1 = completePosCart(clientA1, cashierContext, cartA1.id, { idempotencyKey: "f18-coupon-race-1", payments: [{ method: "cash", amount: cartA1.grand_total }] })
          .then(async (result) => {
            await clientA1.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA1.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const run2 = completePosCart(clientA2, cashierContext, cartA2.id, { idempotencyKey: "f18-coupon-race-2", payments: [{ method: "cash", amount: cartA2.grand_total }] })
          .then(async (result) => {
            await clientA2.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA2.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });

        const [outcome1, outcome2] = await Promise.all([run1, run2]);
        const outcomes = [outcome1, outcome2];
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactly one of the two racing completions at store A must succeed");
        assert.equal(rejected.length, 1, "exactly one of the two racing completions at store A must fail");
        assert.equal(rejected[0].reason.code, "POS_COUPON_STORE_LIMIT_REACHED");
      } finally {
        await clientA1.end();
        await clientA2.end();
      }

      const committedAtStoreA = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND coupon_id=$2 AND store_id=$3 AND status='committed'`,
        [orgId, coupon.id, storeAId],
      );
      assert.equal(committedAtStoreA.rows[0].count, 1, "exactly one committed redemption must exist for store A's single-use cap");

      // A THIRD attempt at store A (sequential, no race) must also be
      // rejected -- proves the cap holds once settled, not just mid-race.
      // A fresh terminal is used since terminalA1Id/terminalA2Id already
      // have an open shift from the race above (one open shift per
      // terminal is enforced elsewhere in POS, unrelated to this test).
      const terminalA5Id = randomUUID();
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA5','Terminal A5',$5)`, [
        terminalA5Id,
        orgId,
        companyId,
        storeAId,
        adminUserId,
      ]);
      const shiftA1b = await tx((c) => openShift(c, cashierContext, { storeId: storeAId, terminalId: terminalA5Id, openingCash: 0 }));
      let cartA3 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeAId, terminalId: terminalA5Id, shiftId: shiftA1b.id }));
      cartA3 = await tx((c) => addPosCartLine(c, cashierContext, cartA3.id, { itemId, quantity: 1, expectedVersion: cartA3.version }));
      await assert.rejects(
        () => tx((c) => applyPosCartCoupon(c, cashierContext, cartA3.id, { code: "STORECAP1", expectedVersion: cartA3.version })),
        (error) => error?.code === "POS_COUPON_STORE_LIMIT_REACHED",
      );

      // Store B has never used this coupon -- genuinely store-scoped, not a
      // second global counter dressed up as one.
      const shiftB = await tx((c) => openShift(c, cashierContext, { storeId: storeBId, terminalId: terminalBId, openingCash: 0 }));
      let cartB = await tx((c) => createPosCart(c, cashierContext, { storeId: storeBId, terminalId: terminalBId, shiftId: shiftB.id }));
      cartB = await tx((c) => addPosCartLine(c, cashierContext, cartB.id, { itemId, quantity: 1, expectedVersion: cartB.version }));
      cartB = await tx((c) => applyPosCartCoupon(c, cashierContext, cartB.id, { code: "STORECAP1", expectedVersion: cartB.version }));
      const saleB = await tx((c) =>
        completePosCart(c, cashierContext, cartB.id, { idempotencyKey: "f18-coupon-store-b", payments: [{ method: "cash", amount: cartB.grand_total }] }),
      );
      assert.equal(saleB.status, "completed", "the same coupon must still be usable at a different store once store A's own cap is hit");

      const committedAtStoreB = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND coupon_id=$2 AND store_id=$3 AND status='committed'`,
        [orgId, coupon.id, storeBId],
      );
      assert.equal(committedAtStoreB.rows[0].count, 1);
    });

    await t.test("PROMOTION: store-scoped cap rejects a second use at the SAME store, races correctly, and stays usable at a DIFFERENT store", async () => {
      const promotion = await tx((c) =>
        createPosPromotion(c, adminContext, { code: "STOREPROMO1", name: "Store cap promo", discountType: "amount", discountValue: 5, usageLimitPerStore: 1 }),
      );

      const terminalA3Id = randomUUID();
      const terminalA4Id = randomUUID();
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA3','Terminal A3',$5)`, [
        terminalA3Id,
        orgId,
        companyId,
        storeAId,
        adminUserId,
      ]);
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA4','Terminal A4',$5)`, [
        terminalA4Id,
        orgId,
        companyId,
        storeAId,
        adminUserId,
      ]);
      const shiftA3 = await tx((c) => openShift(c, cashierContext, { storeId: storeAId, terminalId: terminalA3Id, openingCash: 0 }));
      const shiftA4 = await tx((c) => openShift(c, cashierContext, { storeId: storeAId, terminalId: terminalA4Id, openingCash: 0 }));
      let cartA3 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeAId, terminalId: terminalA3Id, shiftId: shiftA3.id }));
      let cartA4 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeAId, terminalId: terminalA4Id, shiftId: shiftA4.id }));
      // A promotion auto-applies during reprice -- no explicit "apply" step.
      cartA3 = await tx((c) => addPosCartLine(c, cashierContext, cartA3.id, { itemId, quantity: 1, expectedVersion: cartA3.version }));
      cartA4 = await tx((c) => addPosCartLine(c, cashierContext, cartA4.id, { itemId, quantity: 1, expectedVersion: cartA4.version }));
      assert.equal(cartA3.promotion_discount_total, "5.000000", "the promotion must have actually applied to prove this test exercises the real path");
      assert.equal(cartA4.promotion_discount_total, "5.000000");

      const clientA3 = await connectOrNull(adminConnectionString);
      const clientA4 = await connectOrNull(adminConnectionString);
      try {
        await clientA3.query("BEGIN");
        await setTenantContext(clientA3, orgId);
        await clientA4.query("BEGIN");
        await setTenantContext(clientA4, orgId);

        const run3 = completePosCart(clientA3, cashierContext, cartA3.id, { idempotencyKey: "f18-promo-race-3", payments: [{ method: "cash", amount: cartA3.grand_total }] })
          .then(async (result) => {
            await clientA3.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA3.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const run4 = completePosCart(clientA4, cashierContext, cartA4.id, { idempotencyKey: "f18-promo-race-4", payments: [{ method: "cash", amount: cartA4.grand_total }] })
          .then(async (result) => {
            await clientA4.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA4.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });

        const [outcome3, outcome4] = await Promise.all([run3, run4]);
        const outcomes = [outcome3, outcome4];
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactly one of the two racing completions at store A must succeed");
        assert.equal(rejected.length, 1, "exactly one of the two racing completions at store A must fail");
        assert.equal(rejected[0].reason.code, "POS_PROMOTION_STORE_LIMIT_REACHED");
      } finally {
        await clientA3.end();
        await clientA4.end();
      }

      const applicationsAtStoreA = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications WHERE organization_id=$1 AND promotion_id=$2 AND store_id=$3`,
        [orgId, promotion.id, storeAId],
      );
      assert.equal(applicationsAtStoreA.rows[0].count, 1, "exactly one promotion application must exist for store A's single-use cap");

      // Store B has never used this promotion -- genuinely store-scoped.
      // A fresh terminal at store B, since terminalBId already has an open
      // shift left over from the coupon test above.
      const terminalB2Id = randomUUID();
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TB2','Terminal B2',$5)`, [
        terminalB2Id,
        orgId,
        companyId,
        storeBId,
        adminUserId,
      ]);
      const shiftB2 = await tx((c) => openShift(c, cashierContext, { storeId: storeBId, terminalId: terminalB2Id, openingCash: 0 }));
      let cartB2 = await tx((c) => createPosCart(c, cashierContext, { storeId: storeBId, terminalId: terminalB2Id, shiftId: shiftB2.id }));
      cartB2 = await tx((c) => addPosCartLine(c, cashierContext, cartB2.id, { itemId, quantity: 1, expectedVersion: cartB2.version }));
      assert.equal(cartB2.promotion_discount_total, "5.000000", "the promotion must still apply at a different store once store A's own cap is hit");
      const saleB2 = await tx((c) =>
        completePosCart(c, cashierContext, cartB2.id, { idempotencyKey: "f18-promo-store-b", payments: [{ method: "cash", amount: cartB2.grand_total }] }),
      );
      assert.equal(saleB2.status, "completed");

      const applicationsAtStoreB = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications WHERE organization_id=$1 AND promotion_id=$2 AND store_id=$3`,
        [orgId, promotion.id, storeBId],
      );
      assert.equal(applicationsAtStoreB.rows[0].count, 1);
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_coupon_redemptions",
      "pos_promotion_applications",
      "pos_cart_discount_approvals",
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
      "pos_coupons",
      "pos_promotions",
      "stock_valuation_layers",
      "stock_movements",
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
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[adminUserId, cashierId]]).catch(() => undefined);
    await admin.end();
  }
});
