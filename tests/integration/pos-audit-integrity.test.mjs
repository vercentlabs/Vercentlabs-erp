// Real PostgreSQL integration test — POS Session 3 (consolidated pass):
// customer search and audit-field integrity (opened_by/closed_by are the
// real authenticated actor, never a record id).
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

test("POS Phase 3: customer search and audit-field integrity against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
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

    let cashierShift;
    await t.test("AUDIT INTEGRITY: openShift/closeShift stamp opened_by/closed_by from the real authenticated actor", async () => {
      cashierShift = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 0, idempotencyKey: randomUUID() }));
      assert.equal(cashierShift.opened_by, cashierId);
      const closed = await tx((c) => closeShift(c, cashierContext, cashierShift.id, { countedCash: "0" }));
      assert.equal(closed.closed_by, cashierId);
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
