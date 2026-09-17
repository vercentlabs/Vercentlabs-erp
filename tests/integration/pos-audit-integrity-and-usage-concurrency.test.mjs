// Real PostgreSQL integration test — POS Session 3 (consolidated pass),
// Phase 3 (audit-field integrity) + Phase 4 (promotion/coupon per-customer
// usage-limit concurrency).
//
// Phase 3: updatePosPromotion/setPosPromotionActive/updatePosCoupon/
// setPosCouponActive all built their UPDATE with `fields.push("updated_by=$3", ...)`
// where $3 is the record's OWN id (see `values = [organizationId, companyId, id]`),
// not the acting user — every edit/activate/deactivate silently stamped
// the promotion/coupon's own id into updated_by. Fixed in
// features/{promotions,coupons}.js by pushing context.userId as its own
// parameter instead of reusing $3.
//
// Phase 4: usage_limit_per_customer existed as a column on both
// tenant.pos_promotions and tenant.pos_coupons since migration 113, but
// promotions never enforced it anywhere, and coupons only checked it at
// PREVIEW time (cart-pricing.js's evaluateCoupon) — never re-verified
// inside the actual completion transaction. Two terminals racing to be
// the same customer's LAST allowed use could both pass preview and both
// commit. Fixed by re-checking usage_limit_per_customer under the
// promotion's/coupon's own row lock at commit time, the same pattern the
// existing usage_limit_total check already used.
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

test("POS Phase 3+4: audit-field integrity and promotion/coupon per-customer usage-limit concurrency against real PostgreSQL", async (t) => {
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
    updatePosPromotion,
    setPosPromotionActive,
    createPosCoupon,
    updatePosCoupon,
    setPosCouponActive,
    openShift,
    closeShift,
    searchPointOfSaleCustomers,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const adminUserId = randomUUID();
  const editorUserId = randomUUID();
  const cashierId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const storeId = randomUUID();
  const terminalAId = randomUUID();
  const terminalBId = randomUUID();
  const itemId = randomUUID();
  const customerId = randomUUID();

  const adminContext = { organizationId: orgId, companyId, userId: adminUserId, roleSlugs: [], permissions: ["pos.view", "pos.settings.manage"] };
  const editorContext = { organizationId: orgId, companyId, userId: editorUserId, roleSlugs: [], permissions: ["pos.view", "pos.settings.manage"] };
  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.shift.open", "pos.shift.close"] };

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
      [adminUserId, "Phase3 Admin"],
      [editorUserId, "Phase3 Editor"],
      [cashierId, "Phase3 Cashier"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `phase3-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Phase3 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `phase3-org-${orgId}`, adminUserId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Phase3 Co','Phase3 Co Pvt Ltd','P3CO','INR','IN',true,'active')`,
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
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Phase3 Widget','product',$3,$4,100,50,'active')`,
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
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, adminUserId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalAId,
      orgId,
      companyId,
      storeId,
      adminUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminalBId,
      orgId,
      companyId,
      storeId,
      adminUserId,
    ]);
    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,phone,status) VALUES ($1,$2,$3,'CUST1','customer','Phase3 Customer','9998887770','active')`,
      [customerId, orgId, companyId],
    );
    const archivedCustomerId = randomUUID();
    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status) VALUES ($1,$2,$3,'CUST2','customer','Phase3 Archived Customer','inactive')`,
      [archivedCustomerId, orgId, companyId],
    );
    const supplierId = randomUUID();
    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status) VALUES ($1,$2,$3,'SUP1','supplier','Phase3 Supplier','active')`,
      [supplierId, orgId, companyId],
    );

    await t.test("F276: searchPointOfSaleCustomers finds an active customer by partial name and phone, and excludes archived customers and non-customer parties", async () => {
      const byName = await tx((c) => searchPointOfSaleCustomers(c, cashierContext, { query: "phase3 cust" }));
      assert.deepEqual(
        byName.map((row) => row.id),
        [customerId],
        "must find the active customer and exclude the archived one and the supplier",
      );
      assert.deepEqual(Object.keys(byName[0]).sort(), ["code", "displayName", "email", "id", "phone"], "must never leak gstin/pan/credit_limit/msme_number");

      const byPhone = await tx((c) => searchPointOfSaleCustomers(c, cashierContext, { query: "998887" }));
      assert.deepEqual(byPhone.map((row) => row.id), [customerId]);

      const empty = await tx((c) => searchPointOfSaleCustomers(c, cashierContext, { query: "no-such-customer-xyz" }));
      assert.deepEqual(empty, []);
    });

    await t.test("AUDIT INTEGRITY: createPosPromotion/updatePosPromotion/setPosPromotionActive stamp the REAL actor, never the record id", async () => {
      const promotion = await tx((c) =>
        createPosPromotion(c, adminContext, { code: "AUDIT10", name: "10% off", discountType: "percent", discountValue: 10 }),
      );
      assert.equal(promotion.created_by, adminUserId);

      const updated = await tx((c) => updatePosPromotion(c, editorContext, promotion.id, { name: "Renamed" }));
      assert.equal(updated.name, "Renamed");
      assert.equal(updated.updated_by, editorUserId, "updated_by must be the ACTOR, not the promotion's own id");
      assert.notEqual(updated.updated_by, promotion.id);

      const deactivated = await tx((c) => setPosPromotionActive(c, editorContext, promotion.id, false));
      assert.equal(deactivated.status, "inactive");
      assert.equal(deactivated.updated_by, editorUserId, "updated_by must be the ACTOR, not the promotion's own id");
      assert.notEqual(deactivated.updated_by, promotion.id);
    });

    await t.test("AUDIT INTEGRITY: createPosCoupon/updatePosCoupon/setPosCouponActive stamp the REAL actor, never the record id", async () => {
      const coupon = await tx((c) => createPosCoupon(c, adminContext, { code: "AUDITC1", discountType: "amount", discountValue: 5 }));
      assert.equal(coupon.created_by, adminUserId);

      const updated = await tx((c) => updatePosCoupon(c, editorContext, coupon.id, { name: "Renamed coupon" }));
      assert.equal(updated.name, "Renamed coupon");
      assert.equal(updated.updated_by, editorUserId, "updated_by must be the ACTOR, not the coupon's own id");
      assert.notEqual(updated.updated_by, coupon.id);

      const deactivated = await tx((c) => setPosCouponActive(c, editorContext, coupon.id, false));
      assert.equal(deactivated.status, "inactive");
      assert.equal(deactivated.updated_by, editorUserId, "updated_by must be the ACTOR, not the coupon's own id");
      assert.notEqual(deactivated.updated_by, coupon.id);
    });

    let cashierShift;
    await t.test("AUDIT INTEGRITY: openShift/closeShift stamp opened_by/closed_by from the real authenticated actor", async () => {
      cashierShift = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 0 }));
      assert.equal(cashierShift.opened_by, cashierId);
      const closed = await tx((c) => closeShift(c, cashierContext, cashierShift.id, { countedCash: "0" }));
      assert.equal(closed.closed_by, cashierId);
    });

    await t.test("CONCURRENCY: two terminals racing to be the same customer's LAST allowed coupon use -- exactly one succeeds", async () => {
      const coupon = await tx((c) =>
        createPosCoupon(c, adminContext, { code: "LASTUSE1", discountType: "amount", discountValue: 5, usageLimitPerCustomer: 1 }),
      );

      const shiftA = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 0 }));
      const shiftB = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalBId, openingCash: 0 }));
      let cartA = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalAId, shiftId: shiftA.id, customerId }));
      let cartB = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalBId, shiftId: shiftB.id, customerId }));
      cartA = await tx((c) => addPosCartLine(c, cashierContext, cartA.id, { itemId, quantity: 1, expectedVersion: cartA.version }));
      cartB = await tx((c) => addPosCartLine(c, cashierContext, cartB.id, { itemId, quantity: 1, expectedVersion: cartB.version }));
      cartA = await tx((c) => applyPosCartCoupon(c, cashierContext, cartA.id, { code: "LASTUSE1", expectedVersion: cartA.version }));
      cartB = await tx((c) => applyPosCartCoupon(c, cashierContext, cartB.id, { code: "LASTUSE1", expectedVersion: cartB.version }));

      // Two genuinely separate PostgreSQL connections, each completing its
      // own cart inside its own transaction -- this is what makes the race
      // real: both reach commitPosCouponRedemption's `FOR UPDATE` on the
      // SAME coupon row at roughly the same time, and Postgres itself
      // serializes them, not application code.
      const clientA = await connectOrNull(adminConnectionString);
      const clientB = await connectOrNull(adminConnectionString);
      try {
        await clientA.query("BEGIN");
        await setTenantContext(clientA, orgId);
        await clientB.query("BEGIN");
        await setTenantContext(clientB, orgId);

        const runA = completePosCart(clientA, cashierContext, cartA.id, { idempotencyKey: "race-a", payments: [{ method: "cash", amount: cartA.grand_total }] })
          .then(async (result) => {
            await clientA.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const runB = completePosCart(clientB, cashierContext, cartB.id, { idempotencyKey: "race-b", payments: [{ method: "cash", amount: cartB.grand_total }] })
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
        assert.equal(rejected.length, 1, "exactly one of the two racing completions must fail");
        assert.equal(rejected[0].reason.code, "POS_COUPON_CUSTOMER_LIMIT_REACHED");
      } finally {
        await clientA.end();
        await clientB.end();
      }

      const committedRows = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND coupon_id=$2 AND status='committed'`,
        [orgId, coupon.id],
      );
      assert.equal(committedRows.rows[0].count, 1, "exactly one committed redemption must exist for this customer's single-use coupon");
    });

    await t.test("CONCURRENCY: two terminals racing to be the same customer's LAST allowed promotion use -- exactly one succeeds", async () => {
      const promotion = await tx((c) =>
        createPosPromotion(c, adminContext, { code: "LASTPROMO1", name: "Last use promo", discountType: "amount", discountValue: 5, usageLimitPerCustomer: 1 }),
      );

      const terminalCId = randomUUID();
      const terminalDId = randomUUID();
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T3','Terminal 3',$5)`, [
        terminalCId,
        orgId,
        companyId,
        storeId,
        adminUserId,
      ]);
      await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T4','Terminal 4',$5)`, [
        terminalDId,
        orgId,
        companyId,
        storeId,
        adminUserId,
      ]);
      const shiftC = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalCId, openingCash: 0 }));
      const shiftD = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalDId, openingCash: 0 }));
      let cartC = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalCId, shiftId: shiftC.id, customerId }));
      let cartD = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminalDId, shiftId: shiftD.id, customerId }));
      // A promotion auto-applies during reprice -- no explicit "apply" step.
      cartC = await tx((c) => addPosCartLine(c, cashierContext, cartC.id, { itemId, quantity: 1, expectedVersion: cartC.version }));
      cartD = await tx((c) => addPosCartLine(c, cashierContext, cartD.id, { itemId, quantity: 1, expectedVersion: cartD.version }));
      assert.equal(cartC.promotion_discount_total, "5.000000", "the promotion must have actually applied to prove this test exercises the real path");
      assert.equal(cartD.promotion_discount_total, "5.000000");

      const clientC = await connectOrNull(adminConnectionString);
      const clientD = await connectOrNull(adminConnectionString);
      try {
        await clientC.query("BEGIN");
        await setTenantContext(clientC, orgId);
        await clientD.query("BEGIN");
        await setTenantContext(clientD, orgId);

        const runC = completePosCart(clientC, cashierContext, cartC.id, { idempotencyKey: "promo-race-c", payments: [{ method: "cash", amount: cartC.grand_total }] })
          .then(async (result) => {
            await clientC.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientC.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const runD = completePosCart(clientD, cashierContext, cartD.id, { idempotencyKey: "promo-race-d", payments: [{ method: "cash", amount: cartD.grand_total }] })
          .then(async (result) => {
            await clientD.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientD.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });

        const [outcomeC, outcomeD] = await Promise.all([runC, runD]);
        const outcomes = [outcomeC, outcomeD];
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");
        assert.equal(fulfilled.length, 1, "exactly one of the two racing completions must succeed");
        assert.equal(rejected.length, 1, "exactly one of the two racing completions must fail");
        assert.equal(rejected[0].reason.code, "POS_PROMOTION_CUSTOMER_LIMIT_REACHED");
      } finally {
        await clientC.end();
        await clientD.end();
      }

      const applicationRows = await admin.query(
        `SELECT count(*)::int AS count FROM tenant.pos_promotion_applications WHERE organization_id=$1 AND promotion_id=$2 AND customer_id=$3`,
        [orgId, promotion.id, customerId],
      );
      assert.equal(applicationRows.rows[0].count, 1, "exactly one promotion application must exist for this customer's single-use promotion");
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
      "pos_store_access",
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
      "business_parties",
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
    await admin.query(`DELETE FROM public.approval_requests WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[adminUserId, editorUserId, cashierId]]).catch(() => undefined);
    await admin.end();
  }
});
