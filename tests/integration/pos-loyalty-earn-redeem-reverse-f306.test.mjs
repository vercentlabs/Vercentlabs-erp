// Real PostgreSQL integration test — F306 Loyalty: earn on completed sale
// only (never a draft cart, never with no customer attached), idempotent
// earn on replay, redemption's preview-then-recheck-at-commit gate, a
// genuine two-Postgres-connection concurrency race over a single
// customer's balance, and full/partial return proportional reversal via
// new ledger entries (never a balance edit). Mirrors
// pos-cart-tax-promotions-coupons-f277-f281.test.mjs's fixture/tx/cleanup
// shape.
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

test("F306: loyalty earn/redeem/reverse against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  const admin2 = await connectOrNull(adminConnectionString);
  if (!admin || !admin2) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    setPosCartCustomer,
    redeemPosCartLoyaltyPoints,
    completePosCart,
    cancelPosCart,
    upsertPosLoyaltyProgram,
    getPosCustomerLoyaltyBalance,
    adjustPosCustomerLoyaltyBalance,
    commitPosLoyaltyForSale,
    expirePosLoyaltyPoints,
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePointOfSaleReturn,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const supervisorId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();
  const customer1Id = randomUUID();
  const customer2Id = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.loyalty.redeem"] };
  const supervisorContext = {
    organizationId: orgId,
    companyId,
    userId: supervisorId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.settings.manage", "pos.discount.apply", "pos.return.create", "pos.loyalty.manage"],
  };
  const ownerContext = { organizationId: orgId, companyId, userId, roleSlugs: ["organization_owner"], permissions: [] };

  async function tx(fn, connection = admin) {
    await connection.query("BEGIN");
    try {
      await setTenantContext(connection, orgId);
      const result = await fn(connection);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    }
  }

  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F306 Cashier','x','active',now())`,
      [userId, `f306-cashier-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F306 Supervisor','x','active',now())`,
      [supervisorId, `f306-supervisor-${supervisorId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F306 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f306-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F306 Co','F306 Co Pvt Ltd','F306CO','INR','IN',true,'active')`,
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
    // Zero-rate tax category so loyalty point math is never entangled with
    // GST rounding -- F277-F281's own suite already proves the tax
    // pipeline itself; this suite only needs the taxable BASE, which a 0%
    // rate makes equal to the line's gross post-discount amount.
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'ZERO','Zero Rate','active')`, [taxCategoryId, orgId]);
    await admin.query(
      `INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'Zero','ZERO0','gst',0,'active')`,
      [randomUUID(), orgId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F306 Widget','product',$3,$4,100,50,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [
      orgId,
      priceListId,
      itemId,
    ]);
    await admin.query(
      `INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,10000,0,50)`,
      [orgId, companyId, itemId, warehouseId],
    );
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
    const terminal2Id = randomUUID();
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminal2Id,
      orgId,
      companyId,
      storeId,
      userId,
    ]);
    const terminal3Id = randomUUID();
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T3','Terminal 3',$5)`, [
      terminal3Id,
      orgId,
      companyId,
      storeId,
      userId,
    ]);

    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Customer One','active',$4)`,
      [customer1Id, orgId, companyId, userId],
    );
    await admin.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST2','customer','Customer Two','active',$4)`,
      [customer2Id, orgId, companyId, userId],
    );

    const shift = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminalId, userId],
      ),
    ).then((r) => r.rows[0]);
    const shift2 = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-2',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminal2Id, userId],
      ),
    ).then((r) => r.rows[0]);
    const shift3 = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-3',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminal3Id, userId],
      ),
    ).then((r) => r.rows[0]);

    await t.test("F306: program configuration -- 1 point per 10 spent, 1 currency unit per point", async () => {
      const program = await tx((c) =>
        upsertPosLoyaltyProgram(c, supervisorContext, {
          name: "Standard Loyalty",
          earnRatePointsPerCurrency: 0.1,
          redemptionValuePerPoint: 1,
        }),
      );
      assert.equal(program.status, "active");
      assert.equal(program.earn_rate_points_per_currency, "0.100000");
    });

    await t.test("F306: a sale with NO customer attached earns nothing", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "no-customer-1", payments: [{ method: "cash", amount: cart.grand_total }] }));
      const ledger = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale.id]);
      assert.equal(ledger.rows.length, 0, "no customer means no ledger activity at all");
    });

    let saleB;
    await t.test("F306: a completed sale for an authorized customer earns the correct points", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: customer1Id, expectedVersion: cart.version }));
      assert.equal(cart.loyalty.pointsToEarn, "10.000000", "100 spent * 0.1 rate = 10 points");
      saleB = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "earn-1", payments: [{ method: "cash", amount: cart.grand_total } ] }));

      const balance = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      assert.equal(balance.balance, "10.000000");
      const earnRows = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='earn'`, [orgId, saleB.id]);
      assert.equal(earnRows.rows.length, 1);
      assert.equal(earnRows.rows[0].points, "10.000000");
    });

    await t.test("F306: replaying the same sale's loyalty commit (idempotency/offline-sync-replay path) never double-earns", async () => {
      const before = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      const saleLine = await admin.query(`SELECT id FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleB.id]);
      const replay = await tx((c) =>
        commitPosLoyaltyForSale(c, cashierContext, {
          saleId: saleB.id,
          customerId: customer1Id,
          programId: null,
          lines: [{ saleLineId: saleLine.rows[0].id, points: 10 }],
          redeemPointsApplied: 0,
        }),
      );
      assert.equal(replay.replayed, true);
      const after = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      assert.equal(after.balance, before.balance, "balance must be unchanged by a replay");
      const earnRows = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='earn'`, [orgId, saleB.id]);
      assert.equal(earnRows.rows[0].n, 1, "still exactly one earn row for this sale");
    });

    await t.test("F306: redemption looking eligible at preview is rejected at commit once the balance no longer covers it", async () => {
      let cart2 = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart2 = await tx((c) => addPosCartLine(c, cashierContext, cart2.id, { itemId, quantity: 1 }));
      cart2 = await tx((c) => setPosCartCustomer(c, cashierContext, cart2.id, { customerId: customer1Id, expectedVersion: cart2.version }));
      // Balance is 10 at this point -- redeeming all 10 looks eligible.
      cart2 = await tx((c) => redeemPosCartLoyaltyPoints(c, cashierContext, cart2.id, { points: 10, expectedVersion: cart2.version }));
      assert.equal(cart2.loyalty.redeemPointsApplied, "10.000000");

      // A concurrent/prior operation drains the balance between this
      // preview and the actual completion attempt below.
      await tx((c) => adjustPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id, -5, "test drain"));
      const drained = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      assert.equal(drained.balance, "5.000000");

      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart2.id, { idempotencyKey: "redeem-reject-1", payments: [{ method: "cash", amount: cart2.grand_total }] })),
        (error) => error.code === "POS_LOYALTY_INSUFFICIENT_BALANCE",
      );
      const saleCount = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [orgId, cart2.id]);
      assert.equal(saleCount.rows[0].n, 0, "no sale should have been created");
      const cartAfter = await admin.query(`SELECT status FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [orgId, cart2.id]);
      assert.equal(cartAfter.rows[0].status, "priced", "the rejected completion must not have changed the cart's state");

      // Clean up: createPosCart resumes an existing draft/priced cart on
      // the same terminal rather than creating a second one (a real,
      // intentional behavior -- see its own doc comment in cart.js), so
      // this rejected cart (still carrying a stale loyalty_redeem_points=10
      // that no longer matches the drained balance) must not be left
      // dangling for the next test's createPosCart call on this same
      // terminal to silently resume.
      await tx((c) => cancelPosCart(c, cashierContext, cart2.id));
    });

    let saleE;
    await t.test("F306: redemption reduces the payable total before tax and nets correctly against the balance", async () => {
      let cart3 = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart3 = await tx((c) => addPosCartLine(c, cashierContext, cart3.id, { itemId, quantity: 1 }));
      cart3 = await tx((c) => setPosCartCustomer(c, cashierContext, cart3.id, { customerId: customer1Id, expectedVersion: cart3.version }));
      // Balance is 5 (after the previous test's drain) -- redeem exactly 5.
      cart3 = await tx((c) => redeemPosCartLoyaltyPoints(c, cashierContext, cart3.id, { points: 5, expectedVersion: cart3.version }));
      assert.equal(cart3.grand_total, "95.000000", "100 subtotal - 5 redeemed = 95 payable, 0% tax");
      saleE = await tx((c) => completePosCart(c, cashierContext, cart3.id, { idempotencyKey: "redeem-ok-1", payments: [{ method: "cash", amount: cart3.grand_total }] }));
      assert.equal(saleE.grand_total, "95.000000");
      assert.equal(saleE.loyalty_redeem_points, "5.000000");
      assert.equal(saleE.loyalty_points_earned, "9.500000", "(100-5)*0.1 = 9.5 points earned net of the redeemed amount");

      const balance = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      // before=5, -5 redeemed, +9.5 earned = 9.5
      assert.equal(balance.balance, "9.500000");
      const redeemRows = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='redeem'`, [orgId, saleE.id]);
      assert.equal(redeemRows.rows.length, 1);
      assert.equal(redeemRows.rows[0].points, "-5.000000");
    });

    await t.test("F306: two simultaneous redemption attempts against a balance that can satisfy only ONE resolve to exactly one success", async () => {
      await tx((c) => adjustPosCustomerLoyaltyBalance(c, supervisorContext, customer2Id, 100, "seed for concurrency test"));

      let cartX = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminal2Id, shiftId: shift2.id }));
      cartX = await tx((c) => addPosCartLine(c, cashierContext, cartX.id, { itemId, quantity: 1 }));
      cartX = await tx((c) => setPosCartCustomer(c, cashierContext, cartX.id, { customerId: customer2Id, expectedVersion: cartX.version }));
      cartX = await tx((c) => redeemPosCartLoyaltyPoints(c, cashierContext, cartX.id, { points: 80, expectedVersion: cartX.version }));

      let cartY = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminal3Id, shiftId: shift3.id }));
      cartY = await tx((c) => addPosCartLine(c, cashierContext, cartY.id, { itemId, quantity: 1 }));
      cartY = await tx((c) => setPosCartCustomer(c, cashierContext, cartY.id, { customerId: customer2Id, expectedVersion: cartY.version }));
      cartY = await tx((c) => redeemPosCartLoyaltyPoints(c, cashierContext, cartY.id, { points: 80, expectedVersion: cartY.version }));

      // Both requests independently looked eligible against the SAME
      // starting balance of 100 (neither has committed yet) -- only the
      // row lock taken inside commitPosLoyaltyForSale at actual completion
      // can correctly serialize them.
      const results = await Promise.allSettled([
        tx((c) => completePosCart(c, cashierContext, cartX.id, { idempotencyKey: "race-x", payments: [{ method: "cash", amount: cartX.grand_total }] }), admin),
        tx((c) => completePosCart(c, cashierContext, cartY.id, { idempotencyKey: "race-y", payments: [{ method: "cash", amount: cartY.grand_total }] }), admin2),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(fulfilled.length, 1, "exactly one of the two concurrent redemptions must succeed");
      assert.equal(rejected.length, 1, "exactly one must be rejected");
      assert.equal(rejected[0].reason?.code, "POS_LOYALTY_INSUFFICIENT_BALANCE");

      const redeemRows = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND customer_id=$2 AND entry_type='redeem'`, [
        orgId,
        customer2Id,
      ]);
      assert.equal(redeemRows.rows[0].n, 1, "exactly one redeem ledger row must exist -- the loser's transaction was fully rolled back");
    });

    await t.test("F306: a FULL return of a points-earning sale reverses exactly the points that sale earned, as a new ledger entry", async () => {
      const balanceBefore = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleB.id]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, supervisorContext, {
          saleId: saleB.id,
          reason: "full return",
          idempotencyKey: "return-full-1",
          lines: saleLines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity })),
        }),
      );
      const approved = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "return-full-approve-1" }));
      await tx((c) => completePointOfSaleReturn(c, ownerContext, approved.id, { idempotencyKey: "return-full-complete-1" }));

      const originalEarn = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='earn'`, [orgId, saleB.id]);
      assert.equal(originalEarn.rows[0].points, "10.000000", "the ORIGINAL earn row must be untouched");

      const reversal = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='reverse_earn'`, [orgId, saleB.id]);
      assert.equal(reversal.rows.length, 1, "a NEW reversal row must exist");
      assert.equal(reversal.rows[0].points, "-10.000000", "a full return reverses exactly 100% of the points that sale earned");
      assert.equal(reversal.rows[0].original_entry_id, originalEarn.rows[0].id);

      const balanceAfter = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      assert.equal(
        (Number(balanceAfter.balance) - Number(balanceBefore.balance)).toFixed(6),
        "-10.000000",
        "balance must move by exactly the reversed amount",
      );
    });

    await t.test("F306: a PARTIAL return reverses only the proportional share of points earned on the returned lines", async () => {
      let cart4 = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      cart4 = await tx((c) => addPosCartLine(c, cashierContext, cart4.id, { itemId, quantity: 2 }));
      cart4 = await tx((c) => setPosCartCustomer(c, cashierContext, cart4.id, { customerId: customer1Id, expectedVersion: cart4.version }));
      assert.equal(cart4.loyalty.pointsToEarn, "20.000000", "200 spent * 0.1 = 20 points across the 2-unit line");
      const saleH = await tx((c) => completePosCart(c, cashierContext, cart4.id, { idempotencyKey: "partial-return-earn-1", payments: [{ method: "cash", amount: cart4.grand_total }] }));

      const balanceBeforeReturn = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      const saleLine = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleH.id]);
      // Return only 1 of the 2 units sold on this line.
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, supervisorContext, {
          saleId: saleH.id,
          reason: "partial return",
          idempotencyKey: "return-partial-1",
          lines: [{ saleLineId: saleLine.rows[0].id, quantity: 1 }],
        }),
      );
      const approved = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "return-partial-approve-1" }));
      const completedReturn = await tx((c) => completePointOfSaleReturn(c, ownerContext, approved.id, { idempotencyKey: "return-partial-complete-1" }));
      assert.equal(completedReturn.saleStatus, "partially_returned");

      const originalEarn = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='earn'`, [orgId, saleH.id]);
      assert.equal(originalEarn.rows[0].points, "20.000000", "the ORIGINAL earn row must be untouched by a partial return");

      const reversal = await admin.query(`SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='reverse_earn'`, [orgId, saleH.id]);
      assert.equal(reversal.rows.length, 1);
      assert.equal(reversal.rows[0].points, "-10.000000", "1 of 2 units returned reverses exactly half of the line's 20 earned points");

      const balanceAfterReturn = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, customer1Id));
      assert.equal(
        (Number(balanceAfterReturn.balance) - Number(balanceBeforeReturn.balance)).toFixed(6),
        "-10.000000",
      );
    });

    await t.test("F306 EXPIRY: only earned points older than the program's expiry days expire, oldest-first against redemptions, capped at the balance, and re-running is a no-op", async () => {
      const expiryCustomerId = randomUUID();
      await admin.query(
        `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUSTEXP','customer','Expiry Customer','active',$4)`,
        [expiryCustomerId, orgId, companyId, userId],
      );
      const program = await tx((c) =>
        upsertPosLoyaltyProgram(c, supervisorContext, { name: "Standard Loyalty", earnRatePointsPerCurrency: 0.1, redemptionValuePerPoint: 1, pointsExpiryDays: 30 }),
      );
      assert.equal(program.points_expiry_days, 30);

      const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      async function ledger(entryType, points, createdAt) {
        await admin.query(
          `INSERT INTO tenant.pos_loyalty_ledger(organization_id,company_id,program_id,customer_id,entry_type,points,created_by,created_at,reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'expiry test seed')`,
          [orgId, companyId, program.id, expiryCustomerId, entryType, points, userId, createdAt],
        );
      }
      // Earned: 100 pts 90 days ago (expired), 40 pts 60 days ago (expired), 60 pts 5 days ago (still valid).
      await ledger("earn", 100, daysAgo(90));
      await ledger("earn", 40, daysAgo(60));
      await ledger("earn", 60, daysAgo(5));
      // Redeemed 30 (FIFO: consumes the oldest 30 of the expired 140), so 110 of the expired points remain.
      await ledger("redeem", -30, daysAgo(2));
      await admin.query(
        `INSERT INTO tenant.pos_loyalty_balances(organization_id,customer_id,balance) VALUES ($1,$2,170) ON CONFLICT (organization_id,customer_id) DO UPDATE SET balance=170`,
        [orgId, expiryCustomerId],
      );

      // A caller without loyalty-manage authority is refused outright.
      await assert.rejects(() => tx((c) => expirePosLoyaltyPoints(c, cashierContext)), (error) => error.code === "FORBIDDEN");

      const first = await tx((c) => expirePosLoyaltyPoints(c, supervisorContext));
      assert.equal(first.expiryDays, 30);
      assert.equal(Number(first.pointsExpired), 110, "140 expired-eligible earned minus the 30 already redeemed against the oldest points");
      const afterFirst = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, expiryCustomerId));
      assert.equal(Number(afterFirst.balance), 60, "170 - 110: only the recently earned 60 points survive");

      const expireRow = await admin.query(
        `SELECT points, entry_type, reason FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND customer_id=$2 AND entry_type='expire'`,
        [orgId, expiryCustomerId],
      );
      assert.equal(expireRow.rows.length, 1, "expiry is a NEW ledger row; nothing is edited or deleted");
      assert.equal(Number(expireRow.rows[0].points), -110);
      const untouched = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND customer_id=$2 AND entry_type='earn'`, [orgId, expiryCustomerId]);
      assert.equal(untouched.rows[0].n, 3, "the original earn rows are never modified");

      // Idempotent: the expire row is itself a debit, so an immediate re-run finds nothing.
      const second = await tx((c) => expirePosLoyaltyPoints(c, supervisorContext));
      assert.equal(Number(second.pointsExpired), 0);
      const afterSecond = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, expiryCustomerId));
      assert.equal(Number(afterSecond.balance), 60);

      // Later, once the 5-day-old points cross the cutoff too, they expire on the next run.
      const later = await tx((c) => expirePosLoyaltyPoints(c, supervisorContext, { asOf: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000) }));
      // The pass is company-wide, so earlier subtests' customers' aged points
      // expire in the same run -- assert on this customer's own outcome.
      assert.ok(Number(later.pointsExpired) >= 60, "at least this customer's 60 newly-aged points expired");
      const afterLater = await tx((c) => getPosCustomerLoyaltyBalance(c, supervisorContext, expiryCustomerId));
      assert.equal(Number(afterLater.balance), 0);
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_loyalty_ledger",
      "pos_loyalty_balances",
      "pos_loyalty_programs",
      "pos_coupon_redemptions",
      "pos_promotion_applications",
      "pos_cart_discount_approvals",
      "pos_cart_lines",
      "pos_carts",
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
      "business_parties",
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
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[userId, supervisorId]]).catch(() => undefined);
    await admin.end();
    await admin2.end();
  }
});
