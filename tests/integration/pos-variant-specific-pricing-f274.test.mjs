// Real PostgreSQL integration test — F274 Product variants, variant-
// specific pricing gap closure. The gap matrix disclosed "no
// variant-specific pricing" -- POS carries variant_id end-to-end through
// cart/sale lines, but tenant.price_list_items only ever matched on
// item_id, so two variants of the same item always resolved to the
// identical price-list rate. This suite proves the fix: a variant-scoped
// price_list_items row (migration 131) now wins over a generic
// item-level one, a different variant with no row of its own falls back
// to the generic rate correctly, and a plain (no-variant) line is never
// accidentally charged a variant-specific rate meant for someone else.
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

test("F274: variant-specific price-list rates resolve correctly at POS checkout against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { createPosCart, addPosCartLine, cancelPosCart, upsertSalesPriceListItem, completePointOfSale } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const smallVariantId = randomUUID();
  const largeVariantId = randomUUID();
  const otherItemId = randomUUID();
  const otherItemVariantId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };
  const adminContext = { organizationId: orgId, activeCompanyId: companyId, companyId, userId, roleSlugs: [], permissions: ["sales.settings.manage"] };

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
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F274 Cashier','x','active',now())`, [
      userId,
      `f274-cashier-${userId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F274 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [
      orgId,
      `f274-org-${orgId}`,
      userId,
    ]);
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F274 Co','F274 Co Pvt Ltd','F274CO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F274 T-Shirt','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.item_variants(id,organization_id,company_id,item_id,sku,name,status) VALUES ($1,$2,$3,$4,'TSHIRT-S','Small','active')`, [
      smallVariantId,
      orgId,
      companyId,
      itemId,
    ]);
    await admin.query(`INSERT INTO tenant.item_variants(id,organization_id,company_id,item_id,sku,name,status) VALUES ($1,$2,$3,$4,'TSHIRT-L','Large','active')`, [
      largeVariantId,
      orgId,
      companyId,
      itemId,
    ]);
    // Generic item-level rate: 100. A variant-specific override for
    // Large only: 130 (bigger size costs more).
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`, [
      orgId,
      companyId,
      itemId,
      warehouseId,
    ]);
    // A second, unrelated item+variant pair -- used only to prove
    // resolvePointOfSaleUnitPrice/completePointOfSale (the legacy
    // flat-lines path) rejects a real, valid variant that belongs to a
    // DIFFERENT item, not just a nonexistent variant_id (which the DB's
    // own FK would already stop).
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM2','F274 Other Item','product',$3,$4,50,25,'active')`,
      [otherItemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.item_variants(id,organization_id,company_id,item_id,sku,name,status) VALUES ($1,$2,$3,$4,'OTHER-V1','Other Variant','active')`, [
      otherItemVariantId,
      orgId,
      companyId,
      otherItemId,
    ]);
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

    await t.test("gap-closure setup: upsertSalesPriceListItem (previously completely unreachable -- never exported) creates a variant-specific rate for Large", async () => {
      const row = await tx((c) => upsertSalesPriceListItem(c, adminContext, { priceListId, itemId, variantId: largeVariantId, rate: 130 }));
      assert.equal(row.variant_id, largeVariantId);
      assert.equal(Number(row.rate), 130);
    });

    await t.test("F274 FIX: the Large variant resolves its own specific rate (130), not the generic item rate (100)", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, variantId: largeVariantId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "130.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F274 FIX: the Small variant (no rate row of its own) correctly falls back to the generic item rate (100)", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, variantId: smallVariantId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "100.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F274 FIX: a plain line with NO variant selected still gets the generic rate (100), never the Large-specific one", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "100.000000");
    });

    // Gap closure (comprehensive completion pass, this session): the
    // separate legacy flat-lines completePointOfSale path persists
    // line.variantId onto pos_sale_lines but, before this session, never
    // factored it into pricing at all (same class of gap F274's own cart-
    // path fix closed) and never validated it belongs to the claimed item.
    await t.test("GAP CLOSURE: the legacy flat-lines completePointOfSale path also resolves the Large variant's own rate (130), not the generic rate", async () => {
      const result = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          idempotencyKey: randomUUID(),
          lines: [{ itemId, variantId: largeVariantId, quantity: 1, unitPrice: 100, description: "F274 T-Shirt (Large)" }],
          payments: [{ method: "cash", amount: 130 }],
        }),
      );
      assert.equal(result.grand_total, "130.000000");
    });

    await t.test("GAP CLOSURE: the legacy flat-lines path rejects a real variant that belongs to a DIFFERENT item", async () => {
      await assert.rejects(
        tx((c) =>
          completePointOfSale(c, cashierContext, {
            shiftId: shift.id,
            idempotencyKey: randomUUID(),
            lines: [{ itemId, variantId: otherItemVariantId, quantity: 1, unitPrice: 100, description: "Mismatched variant" }],
            payments: [{ method: "cash", amount: 100 }],
          }),
        ),
        (error) => error.code === "POS_SALE_VARIANT_NOT_FOUND",
      );
    });
  } finally {
    await admin.query("BEGIN");
    await setTenantContext(admin, orgId);
    await admin.query(`DELETE FROM tenant.pos_cart_lines WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_carts WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_sale_lines WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_payments WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_cash_movements WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_sales WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_shifts WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_terminals WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_stores WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_settings WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.stock_balances WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.price_list_items WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.item_variants WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.items WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.price_lists WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.sales_settings WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.tax_categories WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.units_of_measure WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.warehouses WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.currencies WHERE organization_id=$1`, [orgId]);
    await admin.query("COMMIT");
    await admin.query(`DELETE FROM public.branches WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.companies WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]);
    await admin.end();
  }
});
