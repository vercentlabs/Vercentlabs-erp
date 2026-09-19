// Real PostgreSQL integration test — F275 Price lists, customer-sensitive
// pricing gap closure. Prior sessions' audit (POS_IMPLEMENTATION_TRACKER.md)
// found `resolveUnitPrice` (cart-pricing.js) consulted only the store's own
// price list, never `tenant.sales_pricing_rules` (Sales' own authoritative
// customer-price-override table, services/api/src/modules/sales/index.js:
// 334-364) — a customer with a negotiated fixed rate or discount was
// silently charged the plain walk-in price at POS checkout. This suite
// proves the fix: POS now reuses the SAME table and adjustment semantics
// Sales' own previewSalesDocument already applies, never a second
// POS-owned pricing master.
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

test("F275: customer-sensitive pricing at POS checkout, reusing Sales' own sales_pricing_rules table", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { createPosCart, addPosCartLine, setPosCartCustomer, getPosSaleReceipt, completePosCart, cancelPosCart, completePointOfSale } = await import(
    "../../services/api/src/index.js"
  );
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const otherItemId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();
  const discountCustomerId = randomUUID();
  const fixedRateCustomerId = randomUUID();
  const plainCustomerId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };

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
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F275 Cashier','x','active',now())`, [
      userId,
      `f275-cashier-${userId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F275 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [
      orgId,
      `f275-org-${orgId}`,
      userId,
    ]);
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F275 Co','F275 Co Pvt Ltd','F275CO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F275 Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM2','F275 Other Widget','product',$3,$4,100,50,'active')`,
      [otherItemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      otherItemId,
    ]);
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`, [
      orgId,
      companyId,
      itemId,
      warehouseId,
    ]);
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`, [
      orgId,
      companyId,
      otherItemId,
      warehouseId,
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

    // Three customers: one with a 20%-off negotiated rule, one with a
    // fixed-rate override, one with no rule at all (must be unaffected).
    for (const [id, code] of [
      [discountCustomerId, "CUST-DISCOUNT"],
      [fixedRateCustomerId, "CUST-FIXEDRATE"],
      [plainCustomerId, "CUST-PLAIN"],
    ]) {
      await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,code,party_type,display_name,status) VALUES ($1,$2,$3,'customer',$3,'active')`, [
        id,
        orgId,
        code,
      ]);
    }
    await admin.query(
      `INSERT INTO tenant.sales_pricing_rules(organization_id,company_id,code,name,party_id,party_type,item_id,minimum_quantity,adjustment_type,adjustment_value,status,created_by,updated_by)
       VALUES ($1,$2,'RULE-DISCOUNT','20% off widget',$3,'customer',$4,0,'discount_percent',20,'active',$5,$5)`,
      [orgId, companyId, discountCustomerId, itemId, userId],
    );
    await admin.query(
      `INSERT INTO tenant.sales_pricing_rules(organization_id,company_id,code,name,party_id,party_type,item_id,minimum_quantity,adjustment_type,adjustment_value,status,created_by,updated_by)
       VALUES ($1,$2,'RULE-FIXED','Negotiated flat rate',$3,'customer',$4,0,'fixed_rate',65,'active',$5,$5)`,
      [orgId, companyId, fixedRateCustomerId, itemId, userId],
    );

    await t.test("no customer selected: plain price-list rate applies, unaffected by any rule existing elsewhere", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "100.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("a customer with NO pricing rule still gets the plain price-list rate", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: plainCustomerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "100.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F275 FIX: a customer with a discount_percent rule gets the adjusted price, not the plain list price", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: discountCustomerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "80.000000"); // 100 - 20%
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F275 FIX: a customer with a fixed_rate rule gets exactly that rate, regardless of the list price", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: fixedRateCustomerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "65.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F275 FIX: the discount customer's rule is scoped to its own item -- a DIFFERENT item is unaffected", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: discountCustomerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId: otherItemId, quantity: 1 }));
      assert.equal(cart.lines[0].unit_price, "100.000000");
      await tx((c) => cancelPosCart(c, cashierContext, cart.id, { reason: "test isolation" }));
    });

    await t.test("F275 FIX: the adjusted price is what actually gets charged and what the receipt evidence shows -- search/cart/sale/receipt agree", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: fixedRateCustomerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.grand_total, "65.000000");
      const result = await tx((c) =>
        completePosCart(c, cashierContext, cart.id, {
          idempotencyKey: randomUUID(),
          payments: [{ method: "cash", amount: 65 }],
        }),
      );
      assert.equal(result.grand_total, "65.000000");
      const receipt = await tx((c) => getPosSaleReceipt(c, cashierContext, result.id));
      assert.equal(receipt.lines[0].unit_price, "65.000000");
    });

    // Gap closure (comprehensive completion pass, this session): F275's own
    // fix only ever touched the cart path (resolveUnitPrice). The separate
    // legacy flat-lines path (completePointOfSale/resolvePointOfSaleUnitPrice
    // in sale-completion.js) is NOT dead code -- it's what POST /api/pos/sales
    // and offline-sync's own sale-completion step both go through -- and it
    // silently ignored sales_pricing_rules entirely until now.
    await t.test("GAP CLOSURE: the legacy flat-lines completePointOfSale path now also applies a customer's discount_percent rule", async () => {
      const result = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          customerId: discountCustomerId,
          idempotencyKey: randomUUID(),
          lines: [{ itemId, quantity: 1, unitPrice: 100, description: "F275 Widget" }],
          payments: [{ method: "cash", amount: 80 }],
        }),
      );
      assert.equal(result.grand_total, "80.000000"); // 100 - 20%, not the plain 100
      const receipt = await tx((c) => getPosSaleReceipt(c, cashierContext, result.id));
      assert.equal(receipt.lines[0].unit_price, "80.000000");
    });

    await t.test("GAP CLOSURE: the legacy flat-lines path leaves a walk-in (no customer) sale unaffected -- plain list price", async () => {
      const result = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          idempotencyKey: randomUUID(),
          lines: [{ itemId, quantity: 1, unitPrice: 100, description: "F275 Widget" }],
          payments: [{ method: "cash", amount: 100 }],
        }),
      );
      assert.equal(result.grand_total, "100.000000");
      const receipt = await tx((c) => getPosSaleReceipt(c, cashierContext, result.id));
      assert.equal(receipt.lines[0].unit_price, "100.000000");
    });
  } finally {
    await admin.query("BEGIN");
    await setTenantContext(admin, orgId);
    await admin.query(`DELETE FROM tenant.pos_receipt_print_events WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_sale_lines WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_payments WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_sales WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_cart_lines WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_carts WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_cash_movements WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_shifts WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.sales_pricing_rules WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_terminals WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_stores WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_settings WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.stock_balances WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.price_list_items WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.items WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.price_lists WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.business_parties WHERE organization_id=$1`, [orgId]);
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
