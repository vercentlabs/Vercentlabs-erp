// Real PostgreSQL integration test — POS Session 3, Phase 2 (F268-F273):
// every POS cart/shift function used to filter by organization_id+
// company_id only. Any cashier holding pos.sale.create could read or
// mutate ANY store's cart/shift in the company by guessing/enumerating its
// id, regardless of which physical store they actually work at.
// tenant.pos_store_access (migration 115) + assertPosStoreAccess()
// (services/api/src/modules/point-of-sale/features/cart.js) close that
// gap, but ONLY once an organization opts in by creating at least one
// assignment row for a company — this suite proves BOTH halves: the
// permissive default when unconfigured (backward compatible with every
// existing single-store tenant, covered by the F277-F281 suite already
// running with zero pos_store_access rows) and the fail-closed boundary
// once configured.
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

test("F268-F273: POS store-level cashier access is enforced once an organization configures it, and never before", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    getPosCart,
    completePosCart,
    openShift,
    listPointOfSaleResource,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const ownerUserId = randomUUID();
  const cashierAId = randomUUID(); // assigned to store A only
  const cashierBId = randomUUID(); // assigned to store B only
  const unassignedCashierId = randomUUID(); // never assigned to any store
  const storeManagerId = randomUUID(); // holds pos.store.manage -- always bypasses
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseAId = randomUUID();
  const warehouseBId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const storeAId = randomUUID();
  const storeBId = randomUUID();
  const terminalAId = randomUUID();
  const terminalBId = randomUUID();

  const contextFor = (userId, permissions = ["pos.view", "pos.sale.create", "pos.shift.open"]) => ({
    organizationId: orgId,
    companyId,
    userId,
    roleSlugs: [],
    permissions,
  });

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
      [ownerUserId, "F268 Owner"],
      [cashierAId, "F268 Cashier A"],
      [cashierBId, "F268 Cashier B"],
      [unassignedCashierId, "F268 Unassigned Cashier"],
      [storeManagerId, "F268 Store Manager"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `f268-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F268 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f268-org-${orgId}`, ownerUserId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F268 Co','F268 Co Pvt Ltd','F268CO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(
      `INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`,
      [branchId, orgId, companyId],
    );
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    for (const [id, code] of [
      [warehouseAId, "WHA"],
      [warehouseBId, "WHB"],
    ]) {
      await admin.query(
        `INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,$5,$5,'active')`,
        [id, orgId, companyId, branchId, code],
      );
    }
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F268 Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    for (const warehouseId of [warehouseAId, warehouseBId]) {
      await admin.query(
        `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
        [orgId, companyId, itemId, warehouseId],
      );
    }
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SA','Store A',$5,$6,'INR',$7)`,
      [storeAId, orgId, companyId, branchId, warehouseAId, priceListId, ownerUserId],
    );
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'SB','Store B',$5,$6,'INR',$7)`,
      [storeBId, orgId, companyId, branchId, warehouseBId, priceListId, ownerUserId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TA','Terminal A',$5)`, [
      terminalAId,
      orgId,
      companyId,
      storeAId,
      ownerUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'TB','Terminal B',$5)`, [
      terminalBId,
      orgId,
      companyId,
      storeBId,
      ownerUserId,
    ]);

    // Before ANY pos_store_access row exists for this company, an
    // unassigned cashier can still open a shift and create a cart on
    // either store -- the permissive default for tenants that have never
    // configured per-cashier store assignment.
    const preConfigShift = await tx((c) =>
      openShift(c, contextFor(unassignedCashierId), { storeId: storeAId, terminalId: terminalAId, openingCash: 0 }),
    );
    assert.equal(preConfigShift.status, "open", "before any pos_store_access row exists, store access is unrestricted (backward compatible default)");
    await admin.query(`UPDATE tenant.pos_shifts SET status='closed' WHERE id=$1`, [preConfigShift.id]);

    // Now the organization opts in: cashier A is assigned to store A only,
    // cashier B to store B only. This is the moment enforcement activates
    // for EVERYONE else in this company.
    await admin.query(`INSERT INTO tenant.pos_store_access(organization_id,company_id,user_id,store_id,created_by) VALUES ($1,$2,$3,$4,$5)`, [
      orgId,
      companyId,
      cashierAId,
      storeAId,
      ownerUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_store_access(organization_id,company_id,user_id,store_id,created_by) VALUES ($1,$2,$3,$4,$5)`, [
      orgId,
      companyId,
      cashierBId,
      storeBId,
      ownerUserId,
    ]);

    await t.test("an unassigned cashier can no longer open a shift or create a cart on ANY store once the company has opted in", async () => {
      await assert.rejects(
        () => tx((c) => openShift(c, contextFor(unassignedCashierId), { storeId: storeAId, terminalId: terminalAId, openingCash: 0 })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
      await assert.rejects(
        () => tx((c) => openShift(c, contextFor(unassignedCashierId), { storeId: storeBId, terminalId: terminalBId, openingCash: 0 })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
    });

    let cartA;
    let shiftA;
    await t.test("cashier A (assigned to store A) can operate store A normally", async () => {
      shiftA = await tx((c) => openShift(c, contextFor(cashierAId), { storeId: storeAId, terminalId: terminalAId, openingCash: 0 }));
      cartA = await tx((c) => createPosCart(c, contextFor(cashierAId), { storeId: storeAId, terminalId: terminalAId, shiftId: shiftA.id }));
      cartA = await tx((c) => addPosCartLine(c, contextFor(cashierAId), cartA.id, { itemId, quantity: 1, expectedVersion: cartA.version }));
      assert.equal(cartA.status, "priced");
    });

    await t.test("SECURITY: cashier A cannot open a shift, read, or complete a cart on store B (a different store than they're assigned to)", async () => {
      await assert.rejects(
        () => tx((c) => openShift(c, contextFor(cashierAId), { storeId: storeBId, terminalId: terminalBId, openingCash: 0 })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );

      const shiftB = await tx((c) => openShift(c, contextFor(cashierBId), { storeId: storeBId, terminalId: terminalBId, openingCash: 0 }));
      const cartB = await tx((c) => createPosCart(c, contextFor(cashierBId), { storeId: storeBId, terminalId: terminalBId, shiftId: shiftB.id }));

      // Cashier A must not be able to read cashier B's store-B cart by id,
      // even though both are in the same organization/company.
      await assert.rejects(
        () => tx((c) => getPosCart(c, contextFor(cashierAId), cartB.id)),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
      // ...nor mutate it...
      await assert.rejects(
        () => tx((c) => addPosCartLine(c, contextFor(cashierAId), cartB.id, { itemId, quantity: 1, expectedVersion: cartB.version })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
      // ...nor complete it.
      await assert.rejects(
        () =>
          tx((c) => completePosCart(c, contextFor(cashierAId), cartB.id, { idempotencyKey: "f268-cross-store", payments: [{ method: "cash", amount: 100 }] })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );

      // And symmetrically, cashier B cannot touch cashier A's store-A cart.
      await assert.rejects(
        () => tx((c) => getPosCart(c, contextFor(cashierBId), cartA.id)),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
    });

    await t.test("cashier A can still complete their own store-A sale end to end", async () => {
      const sale = await tx((c) =>
        completePosCart(c, contextFor(cashierAId), cartA.id, { idempotencyKey: "f268-storeA-complete", payments: [{ method: "cash", amount: cartA.grand_total }] }),
      );
      assert.equal(sale.status, "completed");
    });

    await t.test("a store manager (pos.store.manage) and an organization_owner always bypass store assignment", async () => {
      const managerContext = { organizationId: orgId, companyId, userId: storeManagerId, roleSlugs: [], permissions: ["pos.view", "pos.store.manage"] };
      const managerStores = await tx((c) => listPointOfSaleResource(c, managerContext, "stores"));
      assert.equal(managerStores.length, 2, "pos.store.manage sees every store regardless of assignment");

      const ownerContext = { organizationId: orgId, companyId, userId: ownerUserId, roleSlugs: ["organization_owner"], permissions: [] };
      const ownerStores = await tx((c) => listPointOfSaleResource(c, ownerContext, "stores"));
      assert.equal(ownerStores.length, 2, "organization_owner sees every store regardless of assignment");
    });

    await t.test("listPointOfSaleResource('stores'/'terminals') is scoped to the assigned cashier's own stores once configured", async () => {
      const storesForA = await tx((c) => listPointOfSaleResource(c, contextFor(cashierAId, ["pos.view"]), "stores"));
      assert.deepEqual(storesForA.map((row) => row.id).sort(), [storeAId].sort());

      const terminalsForA = await tx((c) => listPointOfSaleResource(c, contextFor(cashierAId, ["pos.view"]), "terminals"));
      assert.deepEqual(terminalsForA.map((row) => row.id).sort(), [terminalAId].sort());
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
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[ownerUserId, cashierAId, cashierBId, unassignedCashierId, storeManagerId]]).catch(() => undefined);
    await admin.end();
  }
});
