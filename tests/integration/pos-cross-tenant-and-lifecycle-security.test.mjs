// Real PostgreSQL regression tests for a negative security/concurrency
// matrix run against the POS module. Each scenario here proves that a
// guard which ALREADY EXISTS in the source actually holds under a real
// Postgres connection (RLS + explicit organization_id/company_id
// filters), rather than adding any new production behavior. Matrix items
// covered:
//   1. Cross-organization access to a cart/store is rejected.
//   2. Cross-company access (same org) to a cart/store is rejected.
//   14. A cross-company item cannot be priced onto another company's cart
//       (cart-pricing.js's resolveItemAndVariant).
//   16. An expired coupon is rejected by code (cart-pricing.js's
//       evaluateCoupon date-range gate).
//   25. A cancelled cart cannot be further mutated or completed, and a
//       closed shift cannot be used to create a new cart or record a cash
//       movement.
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

test("POS SECURITY: cross-organization, cross-company, cross-company-item, expired-coupon, cancelled-cart and closed-shift guards hold against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    getPosCart,
    addPosCartLine,
    cancelPosCart,
    completePosCart,
    applyPosCartCoupon,
    createPosCoupon,
    closeShift,
    recordPosCashMovement,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  // ---- Organization A (two companies: A1 and A2) ----
  const orgAId = randomUUID();
  const orgAOwnerId = randomUUID();
  const cashierAId = randomUUID();
  const companyA1Id = randomUUID();
  const companyA2Id = randomUUID();
  const branchA1Id = randomUUID();
  const branchA2Id = randomUUID();
  const warehouseA1Id = randomUUID();
  const warehouseA2Id = randomUUID();
  const taxCategoryAId = randomUUID();
  const priceListA1Id = randomUUID();
  const priceListA2Id = randomUUID();
  const itemA1Id = randomUUID(); // belongs to company A1
  const itemA2Id = randomUUID(); // belongs to company A2
  const uomAId = randomUUID();
  const storeA1Id = randomUUID();
  const storeA2Id = randomUUID();
  const terminalA1Id = randomUUID();
  const terminalA2Id = randomUUID();
  const closedShiftId = randomUUID();

  // ---- Organization B (fully separate tenant) ----
  const orgBId = randomUUID();
  const orgBOwnerId = randomUUID();
  const cashierBId = randomUUID();
  const companyBId = randomUUID();
  const branchBId = randomUUID();
  const warehouseBId = randomUUID();
  const taxCategoryBId = randomUUID();
  const priceListBId = randomUUID();
  const itemBId = randomUUID();
  const uomBId = randomUUID();
  const storeBId = randomUUID();
  const terminalBId = randomUUID();

  const contextA1 = { organizationId: orgAId, companyId: companyA1Id, userId: cashierAId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.settings.manage"] };
  const contextA2 = { organizationId: orgAId, companyId: companyA2Id, userId: cashierAId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.settings.manage"] };
  const contextB = { organizationId: orgBId, companyId: companyBId, userId: cashierBId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.cash.adjust"] };
  // The attacker: an authenticated org-B cashier session (real tenant
  // context = orgB) that merely NAMES org A's companyId, attempting to
  // reach org A's cart. This is the realistic shape of a cross-org attack:
  // the attacker's own session, pointed at a foreign id.
  const orgBSessionPokingAtCompanyA1 = { organizationId: orgBId, companyId: companyA1Id, userId: cashierBId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };

  async function tx(activeOrgId, fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, activeOrgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const txA = (fn) => tx(orgAId, fn);
  const txB = (fn) => tx(orgBId, fn);

  try {
    // ---------------- Fixtures: org A ----------------
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Org A Owner','x','active',now())`,
      [orgAOwnerId, `xtenant-a-owner-${orgAOwnerId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Org A Cashier','x','active',now())`,
      [cashierAId, `xtenant-a-cashier-${cashierAId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'XTenant Org A',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgAId, `xtenant-org-a-${orgAId}`, orgAOwnerId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Company A1','Company A1 Pvt Ltd','COA1','INR','IN',true,'active')`,
      [companyA1Id, orgAId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Company A2','Company A2 Pvt Ltd','COA2','INR','IN',false,'active')`,
      [companyA2Id, orgAId],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`,
      [branchA1Id, orgAId, companyA1Id],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ2','HQ2','Asia/Kolkata','active')`,
      [branchA2Id, orgAId, companyA2Id],
    );
    await setTenantContext(admin, orgAId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgAId]);
    await admin.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WHA1','WH A1','active')`,
      [warehouseA1Id, orgAId, companyA1Id, branchA1Id],
    );
    await admin.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WHA2','WH A2','active')`,
      [warehouseA2Id, orgAId, companyA2Id, branchA2Id],
    );
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomAId, orgAId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryAId, orgAId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgAId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETA1','Retail A1','sales','INR',false,'active')`,
      [priceListA1Id, orgAId],
    );
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETA2','Retail A2','sales','INR',false,'active')`,
      [priceListA2Id, orgAId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,$3,'ITEMA1','Company A1 Widget','product',$4,$5,100,50,'active')`,
      [itemA1Id, orgAId, companyA1Id, uomAId, taxCategoryAId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,$3,'ITEMA2','Company A2 Widget','product',$4,$5,100,50,'active')`,
      [itemA2Id, orgAId, companyA2Id, uomAId, taxCategoryAId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgAId,
      priceListA1Id,
      itemA1Id,
    ]);
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgAId,
      priceListA2Id,
      itemA2Id,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgAId, companyA1Id, itemA1Id, warehouseA1Id],
    );
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgAId, companyA2Id, itemA2Id, warehouseA2Id],
    );
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgAId, companyA1Id]);
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgAId, companyA2Id]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SA1','Store A1',$5,$6,'INR',$7)`,
      [storeA1Id, orgAId, companyA1Id, branchA1Id, warehouseA1Id, priceListA1Id, orgAOwnerId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SA2','Store A2',$5,$6,'INR',$7)`,
      [storeA2Id, orgAId, companyA2Id, branchA2Id, warehouseA2Id, priceListA2Id, orgAOwnerId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA1','Terminal A1',$5)`, [
      terminalA1Id,
      orgAId,
      companyA1Id,
      storeA1Id,
      orgAOwnerId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA2','Terminal A2',$5)`, [
      terminalA2Id,
      orgAId,
      companyA2Id,
      storeA2Id,
      orgAOwnerId,
    ]);
    const shiftA1 = await txA((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-A1',$5,'open',now(),$5) RETURNING *`,
        [orgAId, companyA1Id, storeA1Id, terminalA1Id, cashierAId],
      ),
    ).then((r) => r.rows[0]);
    const shiftA2 = await txA((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-A2',$5,'open',now(),$5) RETURNING *`,
        [orgAId, companyA2Id, storeA2Id, terminalA2Id, cashierAId],
      ),
    ).then((r) => r.rows[0]);
    // A separate, already-closed shift for the closed-shift matrix item.
    // Inserted directly (test-setup convenience, same as other suites in
    // this repo) rather than opening then closing through the real
    // openShift/closeShift path, since closeShift itself is one of the
    // functions under test.
    await admin.query(
      `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by,closed_at,closed_by,expected_cash,counted_cash,cash_variance)
       VALUES ($1,$2,$3,$4,'SHIFT-CLOSED',$5,'closed',now()-interval '1 hour',$5,now(),$5,0,0,0)`,
      [orgAId, companyA1Id, storeA1Id, terminalA1Id, cashierAId],
    );
    const closedShiftRow = await admin.query(
      `SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND shift_number='SHIFT-CLOSED'`,
      [orgAId],
    );
    const realClosedShiftId = closedShiftRow.rows[0].id;

    // ---------------- Fixtures: org B ----------------
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Org B Owner','x','active',now())`,
      [orgBOwnerId, `xtenant-b-owner-${orgBOwnerId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Org B Cashier','x','active',now())`,
      [cashierBId, `xtenant-b-cashier-${cashierBId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'XTenant Org B',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgBId, `xtenant-org-b-${orgBId}`, orgBOwnerId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Company B','Company B Pvt Ltd','COB','INR','IN',true,'active')`,
      [companyBId, orgBId],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`,
      [branchBId, orgBId, companyBId],
    );
    await setTenantContext(admin, orgBId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgBId]);
    await admin.query(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WHB','WH B','active')`,
      [warehouseBId, orgBId, companyBId, branchBId],
    );
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomBId, orgBId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryBId, orgBId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgBId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETB','Retail B','sales','INR',false,'active')`,
      [priceListBId, orgBId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,$3,'ITEMB','Company B Widget','product',$4,$5,100,50,'active')`,
      [itemBId, orgBId, companyBId, uomBId, taxCategoryBId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgBId,
      priceListBId,
      itemBId,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgBId, companyBId, itemBId, warehouseBId],
    );
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgBId, companyBId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SB','Store B',$5,$6,'INR',$7)`,
      [storeBId, orgBId, companyBId, branchBId, warehouseBId, priceListBId, orgBOwnerId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TB','Terminal B',$5)`, [
      terminalBId,
      orgBId,
      companyBId,
      storeBId,
      orgBOwnerId,
    ]);
    const shiftB = await txB((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-B',$5,'open',now(),$5) RETURNING *`,
        [orgBId, companyBId, storeBId, terminalBId, cashierBId],
      ),
    ).then((r) => r.rows[0]);

    // ---------------- Carts ----------------
    let cartA1 = await txA((c) => createPosCart(c, contextA1, { storeId: storeA1Id, terminalId: terminalA1Id, shiftId: shiftA1.id }));
    cartA1 = await txA((c) => addPosCartLine(c, contextA1, cartA1.id, { itemId: itemA1Id, quantity: 1, expectedVersion: cartA1.version }));
    assert.equal(cartA1.status, "priced", "sanity: company A1's own cart prices normally");

    let cartA2 = await txA((c) => createPosCart(c, contextA2, { storeId: storeA2Id, terminalId: terminalA2Id, shiftId: shiftA2.id }));
    assert.equal(cartA2.status, "draft", "sanity: company A2's own cart is created normally");

    let cartB = await txB((c) => createPosCart(c, contextB, { storeId: storeBId, terminalId: terminalBId, shiftId: shiftB.id }));
    cartB = await txB((c) => addPosCartLine(c, contextB, cartB.id, { itemId: itemBId, quantity: 1, expectedVersion: cartB.version }));
    assert.equal(cartB.status, "priced", "sanity: org B's own cart prices normally");

    // ================= Matrix item #1: cross-organization =================
    await t.test("SECURITY (matrix #1): an org-B session can never read or mutate org-A's cart, even naming org A's own companyId", async () => {
      // Real tenant context is orgB (RLS restricts every tenant.* row to
      // organization_id=orgB); the attacker merely supplies org A's
      // companyId and cart id, hoping the application-level filter is the
      // only thing standing between them and org A's data.
      await assert.rejects(
        () => txB((c) => getPosCart(c, orgBSessionPokingAtCompanyA1, cartA1.id)),
        (error) => error.code === "POS_CART_NOT_FOUND",
        "cross-org getPosCart must be rejected, never silently return org A's cart",
      );
      await assert.rejects(
        () => txB((c) => addPosCartLine(c, orgBSessionPokingAtCompanyA1, cartA1.id, { itemId: itemA1Id, quantity: 1 })),
        (error) => error.code === "POS_CART_NOT_FOUND",
        "cross-org addPosCartLine must be rejected, never silently mutate org A's cart",
      );

      // And the reverse direction: org A's own session cannot see org B's
      // cart just by knowing its id (the tenant context here is genuinely
      // orgA, so this also proves RLS blocks it even before any
      // application-level id filter runs).
      await assert.rejects(
        () => txA((c) => getPosCart(c, contextA1, cartB.id)),
        (error) => error.code === "POS_CART_NOT_FOUND",
        "org A must never be able to read org B's cart by id",
      );
    });

    // ================= Matrix item #2: cross-company, same org =================
    await t.test("SECURITY (matrix #2): a session scoped to company A1 can never read or mutate company A2's cart in the SAME organization", async () => {
      await assert.rejects(
        () => txA((c) => getPosCart(c, contextA1, cartA2.id)),
        (error) => error.code === "POS_CART_NOT_FOUND",
        "cross-company getPosCart (same org) must be rejected",
      );
      await assert.rejects(
        () => txA((c) => addPosCartLine(c, contextA1, cartA2.id, { itemId: itemA2Id, quantity: 1 })),
        (error) => error.code === "POS_CART_NOT_FOUND",
        "cross-company addPosCartLine (same org) must be rejected",
      );
      // Symmetric direction.
      await assert.rejects(
        () => txA((c) => getPosCart(c, contextA2, cartA1.id)),
        (error) => error.code === "POS_CART_NOT_FOUND",
      );
    });

    // ================= Matrix item #14: cross-company item on a cart =================
    await t.test("SECURITY (matrix #14): cart-pricing.js's resolveItemAndVariant rejects an item belonging to a different company than the cart", async () => {
      // itemA2Id belongs to company A2; cartA2 (still draft/empty) also
      // belongs to company A2, so first prove itemA2 prices fine there,
      // then prove company A1's cart cannot add company A2's item.
      cartA2 = await txA((c) => addPosCartLine(c, contextA2, cartA2.id, { itemId: itemA2Id, quantity: 1, expectedVersion: cartA2.version }));
      assert.equal(cartA2.status, "priced", "sanity: an item is priced fine on its own company's cart");

      await assert.rejects(
        () => txA((c) => addPosCartLine(c, contextA1, cartA1.id, { itemId: itemA2Id, quantity: 1, expectedVersion: cartA1.version })),
        (error) => error.code === "POS_SALE_ITEM_NOT_FOUND",
        "a company-A2 item must never be silently priced/added onto a company-A1 cart",
      );
    });

    // ================= Matrix item #16: expired coupon =================
    await t.test("SECURITY (matrix #16): an expired coupon (effective_to in the past) is rejected with POS_COUPON_NOT_FOUND, not silently applied", async () => {
      const expiredCoupon = await txA((c) =>
        createPosCoupon(c, contextA1, {
          code: "EXPIRED10",
          name: "Expired coupon",
          discountType: "amount",
          discountValue: 10,
          effectiveFrom: "2020-01-01",
          effectiveTo: "2020-01-31",
        }),
      );
      assert.equal(expiredCoupon.code, "EXPIRED10");

      await assert.rejects(
        () => txA((c) => applyPosCartCoupon(c, contextA1, cartA1.id, { code: "EXPIRED10", expectedVersion: cartA1.version })),
        (error) => error.code === "POS_COUPON_NOT_FOUND",
        "an expired coupon must never be applied to a cart",
      );
    });

    // ================= Matrix item #25 (first half): cancelled cart =================
    await t.test("SECURITY (matrix #25a): a cancelled cart rejects further mutation and cannot be completed", async () => {
      const cancelled = await txA((c) => cancelPosCart(c, contextA1, cartA1.id, { reason: "regression test cancel" }));
      assert.equal(cancelled.status, "cancelled");

      await assert.rejects(
        () => txA((c) => addPosCartLine(c, contextA1, cartA1.id, { itemId: itemA1Id, quantity: 1 })),
        (error) => error.code === "POS_CART_NOT_OPEN",
        "a cancelled cart must reject further line mutation",
      );
      await assert.rejects(
        () =>
          txA((c) =>
            completePosCart(c, contextA1, cartA1.id, { idempotencyKey: "xtenant-cancelled-complete", payments: [{ method: "cash", amount: 100 }] }),
          ),
        (error) => error.code === "POS_CART_NOT_PRICED",
        "a cancelled cart must never be completed",
      );
    });

    // ================= Matrix item #25 (second half): closed shift =================
    await t.test("SECURITY (matrix #25b): a closed shift rejects new cart creation and new cash movements with POS_SHIFT_NOT_OPEN", async () => {
      await assert.rejects(
        () => txA((c) => createPosCart(c, contextA1, { storeId: storeA1Id, terminalId: terminalA1Id, shiftId: realClosedShiftId })),
        (error) => error.code === "POS_SHIFT_NOT_OPEN",
        "createPosCart against a closed shift must be rejected",
      );

      const cashContext = { ...contextA1, permissions: [...contextA1.permissions, "pos.cash.adjust"] };
      await assert.rejects(
        () =>
          txA((c) =>
            recordPosCashMovement(c, cashContext, realClosedShiftId, {
              movementType: "paid_in",
              amount: 50,
              reason: "regression test",
              idempotencyKey: "xtenant-closed-shift-cash",
            }),
          ),
        (error) => error.code === "POS_SHIFT_NOT_OPEN",
        "recordPosCashMovement against a closed shift must be rejected",
      );
    });

    await t.test("SECURITY: closeShift itself also cannot be called twice on the same shift (already-closed shift is not found as open)", async () => {
      await assert.rejects(
        () => txA((c) => closeShift(c, { ...contextA1, permissions: [...contextA1.permissions, "pos.shift.close"] }, realClosedShiftId, { countedCash: 0 })),
        (error) => error.code === "POS_SHIFT_NOT_OPEN",
      );
    });
  } finally {
    for (const orgId of [orgAId, orgBId]) {
      for (const table of [
        "operation_idempotency",
        "pos_events",
        "pos_coupon_redemptions",
        "pos_promotion_applications",
        "pos_cart_discount_approvals",
        "pos_cart_lines",
        "pos_carts",
        "pos_store_access",
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
      await admin.query(`DELETE FROM public.approval_requests WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM public.branches WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM public.companies WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[orgAOwnerId, cashierAId, orgBOwnerId, cashierBId]]).catch(() => undefined);
    await admin.end();
  }
});
