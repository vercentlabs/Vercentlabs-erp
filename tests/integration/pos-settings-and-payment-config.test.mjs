// Real PostgreSQL integration test -- POS company settings + per-store payment
// method/provider configuration (F279 limits, F291 return policy, F282-F286
// tender availability). Until this configuration surface existed, every
// tenant was pinned to migration defaults and every store was cash-only
// unless someone edited rows by hand.
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

test("POS settings and per-store payment configuration against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    getPosSettings,
    updatePosSettings,
    getPosStorePaymentConfig,
    setPosStorePaymentConfig,
    createStore,
    createTerminal,
    openShift,
    createPosCart,
    addPosCartLine,
    initiatePosPayment,
    applyPosCartLineDiscount,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const managerId = randomUUID();
  const cashierId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();

  const managerContext = {
    organizationId: orgId,
    companyId,
    userId: managerId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.store.manage", "pos.terminal.manage", "pos.settings.manage", "pos.discount.apply"],
  };
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
      [managerId, "Settings Manager"],
      [cashierId, "Settings Cashier"],
    ]) {
      await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [
        id,
        `pos-settings-${id}@test.invalid`,
        name,
      ]);
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'POS Settings Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `pos-settings-org-${orgId}`, managerId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Settings Co','Settings Co Pvt Ltd','SETCO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH','WH','active')`, [
      warehouseId,
      orgId,
      companyId,
      branchId,
    ]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(
      `INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`,
      [randomUUID(), orgId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Item One','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,1000,0,50)`,
      [orgId, companyId, itemId, warehouseId],
    );

    // -- settings ---------------------------------------------------------
    await t.test("no settings row yet: the read reports defaults and says so, rather than pretending they were chosen", async () => {
      const result = await tx((c) => getPosSettings(c, managerContext));
      assert.equal(result.configured, false);
      assert.equal(result.settings.discount_approval_threshold_percent, "10");
      assert.equal(result.settings.allow_negative_stock, false);
    });

    await t.test("settings are gated on pos.settings.manage, for reads and writes", async () => {
      await assert.rejects(() => tx((c) => getPosSettings(c, cashierContext)), (error) => error.code === "FORBIDDEN");
      await assert.rejects(() => tx((c) => updatePosSettings(c, cashierContext, { allow_negative_stock: true })), (error) => error.code === "FORBIDDEN");
    });

    await t.test("updating persists only what was sent, keeps the rest at defaults, and writes an audit event with before/after", async () => {
      const saved = await tx((c) => updatePosSettings(c, managerContext, { discount_approval_threshold_percent: 25, max_line_discount_percent: 60, allow_negative_stock: true }));
      assert.equal(saved.configured, true);
      assert.equal(Number(saved.settings.discount_approval_threshold_percent), 25);
      assert.equal(Number(saved.settings.max_line_discount_percent), 60);
      assert.equal(saved.settings.allow_negative_stock, true);
      assert.equal(saved.settings.require_return_approval, true, "an untouched setting keeps its default");

      const audit = await admin.query(
        `SELECT payload FROM tenant.pos_events WHERE organization_id=$1 AND event_type='pos.settings.updated' ORDER BY id DESC LIMIT 1`,
        [orgId],
      );
      assert.ok(audit.rows[0], "a settings change must be auditable");
      assert.equal(audit.rows[0].payload.before.allow_negative_stock, false);
      assert.equal(audit.rows[0].payload.after.allow_negative_stock, true);
    });

    await t.test("invalid values are rejected with actionable errors, and nothing partial is saved", async () => {
      await assert.rejects(() => tx((c) => updatePosSettings(c, managerContext, { max_line_discount_percent: 150 })), (error) => error.code === "POS_SETTINGS_INVALID");
      await assert.rejects(() => tx((c) => updatePosSettings(c, managerContext, { cart_expiry_minutes: 2 })), (error) => error.code === "POS_SETTINGS_INVALID");
      await assert.rejects(() => tx((c) => updatePosSettings(c, managerContext, { default_currency_code: "rupees" })), (error) => error.code === "POS_SETTINGS_INVALID");
      await assert.rejects(() => tx((c) => updatePosSettings(c, managerContext, { allow_negative_stock: "yes" })), (error) => error.code === "POS_SETTINGS_INVALID");
      await assert.rejects(() => tx((c) => updatePosSettings(c, managerContext, {})), (error) => error.code === "POS_SETTINGS_EMPTY");
      // approval threshold above the hard cap could never trigger -- refused, not saved
      await assert.rejects(
        () => tx((c) => updatePosSettings(c, managerContext, { discount_approval_threshold_percent: 90 })),
        (error) => error.code === "POS_SETTINGS_CONFLICT",
      );
      const still = await tx((c) => getPosSettings(c, managerContext));
      assert.equal(Number(still.settings.discount_approval_threshold_percent), 25, "a rejected update changed nothing");
    });

    // -- payment config ---------------------------------------------------
    let store;
    let terminal;
    let shift;
    let cart;
    await t.test("a new store is cash-only, and a card payment is refused until configured", async () => {
      store = await tx((c) => createStore(c, managerContext, { branchId, warehouseId, code: "PC1", name: "Pay Config Store", priceListId, currencyCode: "INR" }));
      terminal = await tx((c) => createTerminal(c, managerContext, { storeId: store.id, code: "T1", name: "T1" }));
      shift = await tx((c) => openShift(c, cashierContext, { storeId: store.id, terminalId: terminal.id, openingCash: 0, idempotencyKey: randomUUID() }));
      const config = await tx((c) => getPosStorePaymentConfig(c, managerContext, store.id));
      assert.deepEqual(config.allowedMethods, ["cash"]);
      assert.deepEqual(config.availableProviders, ["sandbox"]);

      cart = await tx((c) => createPosCart(c, cashierContext, { storeId: store.id, terminalId: terminal.id, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      await assert.rejects(
        () => tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 10, idempotencyKey: randomUUID(), outcome: "immediate_success" })),
        (error) => error.code === "POS_PAYMENT_METHOD_NOT_ALLOWED",
      );
    });

    await t.test("enabling card + UPI with the sandbox provider makes the store take them, and cash stays on", async () => {
      const config = await tx((c) =>
        setPosStorePaymentConfig(c, managerContext, store.id, { allowedMethods: ["card", "upi"], providers: { card: { providerKey: "sandbox" }, upi: { providerKey: "sandbox" } } }),
      );
      assert.deepEqual(config.allowedMethods, ["cash", "card", "upi"]);
      assert.equal(config.providers.filter((p) => p.active).length, 2);

      const payment = await tx((c) =>
        initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 10, idempotencyKey: randomUUID(), outcome: "immediate_success" }),
      );
      assert.ok(payment.id, "a card payment can now be initiated end to end on a store that could not before");
      assert.equal(payment.status, "captured", "the sandbox provider it was configured with actually processed it");
    });

    await t.test("cash can never be removed, and switching a method off deactivates its provider but keeps the row", async () => {
      const config = await tx((c) => setPosStorePaymentConfig(c, managerContext, store.id, { allowedMethods: ["card"], providers: { card: { providerKey: "sandbox" } } }));
      assert.deepEqual(config.allowedMethods, ["cash", "card"]);
      const upiRow = config.providers.find((p) => p.payment_method === "upi");
      assert.ok(upiRow, "the switched-off method's provider row is kept for history");
      assert.equal(upiRow.active, false);
      await assert.rejects(
        () =>
          tx((c) =>
            initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "upi", amount: 10, idempotencyKey: randomUUID(), outcome: "immediate_success" }),
          ),
        (error) => error.code === "POS_PAYMENT_METHOD_NOT_ALLOWED",
      );
    });

    await t.test("only genuinely implemented providers are accepted, and a credential value can never be stored", async () => {
      await assert.rejects(
        () => tx((c) => setPosStorePaymentConfig(c, managerContext, store.id, { allowedMethods: ["card"], providers: { card: { providerKey: "razorpay" } } })),
        (error) => error.code === "POS_PAYMENT_PROVIDER_UNKNOWN",
      );
      await assert.rejects(
        () => tx((c) => setPosStorePaymentConfig(c, managerContext, store.id, { allowedMethods: ["card"], providers: { card: { providerKey: "sandbox", credentialEnvVar: "sk_live_abc123 secret" } } })),
        (error) => error.code === "POS_PAYMENT_CONFIG_INVALID",
      );
      await assert.rejects(
        () => tx((c) => setPosStorePaymentConfig(c, managerContext, store.id, { allowedMethods: ["crypto"] })),
        (error) => error.code === "POS_PAYMENT_CONFIG_INVALID",
      );
      await assert.rejects(() => tx((c) => setPosStorePaymentConfig(c, cashierContext, store.id, { allowedMethods: ["card"] })), (error) => error.code === "FORBIDDEN");
    });

    await t.test("the configured discount threshold really governs checkout (settings are consumed, not decorative)", async () => {
      // threshold is 25% (set above) and the cap 60%: a 20% line discount needs no approval...
      const line = cart.lines[0];
      assert.ok(line, "the cart has the priced line added earlier");
      const priced = await tx((c) => applyPosCartLineDiscount(c, managerContext, cart.id, line.id, { type: "percent", value: 20, reason: "under threshold", expectedVersion: cart.version }));
      const pending = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_cart_discount_approvals WHERE organization_id=$1 AND cart_id=$2 AND status='pending'`, [orgId, cart.id]);
      assert.equal(pending.rows[0].n, 0, "20% is under the configured 25% threshold, so no approval is requested");
      // ...while 40% is over it.
      await tx((c) => applyPosCartLineDiscount(c, managerContext, cart.id, line.id, { type: "percent", value: 40, reason: "over threshold", expectedVersion: priced.version }));
      const pendingAfter = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_cart_discount_approvals WHERE organization_id=$1 AND cart_id=$2 AND status='pending'`, [orgId, cart.id]);
      assert.equal(pendingAfter.rows[0].n, 1, "40% exceeds the configured 25% threshold, so an approval is requested");
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_payments",
      "pos_cart_discount_approvals",
      "pos_cart_lines",
      "pos_carts",
      "pos_shifts",
      "pos_payment_provider_configs",
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
      "tax_rates",
      "tax_categories",
      "units_of_measure",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.approval_requests WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[managerId, cashierId]]).catch(() => undefined);
    await admin.end();
  }
});
