// Real PostgreSQL integration test — F277 Cart, F278 Taxes, F279
// Discounts, F280 Promotions, F281 Coupons. Every scenario here was first
// proven manually against the real local database during development
// (including a live browser cash-checkout run through the actual /pos and
// /pos/checkout UI) and found two genuinely new, previously-undetected
// bugs that only a real-Postgres/real-HTTP path could surface: a stale
// pre-mutation cart object being passed into reprice() (customer_id/
// coupon_code/cart_discount_* changes were silently lost on the very next
// reprice), and org-wide receipt-number collisions between two terminals
// sharing the schema's own default receipt_prefix. Both are fixed in
// services/api/src/modules/point-of-sale/{features/cart.js,index.js};
// this suite is the permanent regression gate for them and for the
// F277-F281 pipeline as a whole.
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

test("F277-F281: cart, authoritative tax, discounts, promotions and coupons against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    applyPosCartLineDiscount,
    applyPosCartCoupon,
    setPosCartCustomer,
    completePointOfSale,
    completePosCart,
    createPosPromotion,
    createPosCoupon,
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePointOfSaleReturn,
    decideApproval,
    setPosCartDiscount,
    cancelPosCart,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  const supervisorId = randomUUID();
  const managerId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const uomId = randomUUID();
  const storeId = randomUUID();
  const terminalId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };
  const supervisorContext = {
    organizationId: orgId,
    companyId,
    userId: supervisorId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.settings.manage", "pos.discount.apply", "pos.return.create"],
  };
  const ownerContext = { organizationId: orgId, companyId, userId, roleSlugs: ["organization_owner"], permissions: [] };
  // F279 (POS Session 3): decideApproval() takes a SESSION shape
  // (organizationId, userId, activeCompanyId, roleSlugs, permissions), not
  // the PointOfSaleContext shape (companyId) the domain functions above
  // take -- this is the real, separate approver who holds
  // pos.discount.approve but NOT pos.discount.apply, matching the
  // pos_manager/pos_supervisor role split in packages/permissions/src/roles.js.
  const managerSession = {
    organizationId: orgId,
    userId: managerId,
    activeCompanyId: companyId,
    activeBranchId: branchId,
    roleSlugs: [],
    permissions: ["pos.discount.approve"],
  };
  const supervisorSession = { organizationId: orgId, userId: supervisorId, activeCompanyId: companyId, activeBranchId: branchId, roleSlugs: [], permissions: [] };

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
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F277 Cashier','x','active',now())`,
      [userId, `f277-cashier-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F277 Supervisor','x','active',now())`,
      [supervisorId, `f277-supervisor-${supervisorId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F279 Manager','x','active',now())`,
      [managerId, `f279-manager-${managerId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F277 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f277-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F277 Co','F277 Co Pvt Ltd','F277CO','INR','IN',true,'active')`,
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
    await admin.query(
      `INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`,
      [randomUUID(), orgId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F277 Widget','product',$3,$4,100,50,'active')`,
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
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, userId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalId,
      orgId,
      companyId,
      storeId,
      userId,
    ]);

    // A SECOND terminal sharing the default 'POS' receipt_prefix -- this is
    // exactly the configuration that exposed the receipt-number collision
    // bug (two independent per-terminal sequences both starting at
    // "POS-000001" while the DB constraint is organization-wide).
    const terminal2Id = randomUUID();
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminal2Id,
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
    const shift2 = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-2',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminal2Id, userId],
      ),
    ).then((r) => r.rows[0]);

    let cart;
    await t.test("F277: create cart, add line, F278 authoritative intra-state CGST+SGST tax", async () => {
      cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId: shift.id }));
      assert.equal(cart.status, "draft");
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 2 }));
      assert.equal(cart.status, "priced");
      assert.equal(cart.subtotal, "200.000000");
      assert.equal(cart.tax_total, "36.000000");
      assert.equal(cart.grand_total, "236.000000");
      const components = cart.lines[0].tax_components;
      assert.deepEqual(
        components.map((row) => row.type).sort(),
        ["cgst", "sgst"],
      );
    });

    let promotion;
    let coupon;
    await t.test("F280 promotion auto-applies deterministically; F281 coupon reduces the taxable base further", async () => {
      promotion = await tx((c) => createPosPromotion(c, supervisorContext, { code: "PROMO10", name: "10% off", discountType: "percent", discountValue: 10, priority: 10 }));
      coupon = await tx((c) => createPosCoupon(c, supervisorContext, { code: "save5", discountType: "amount", discountValue: 5 }));

      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1, expectedVersion: cart.version }));
      assert.equal(cart.subtotal, "300.000000");
      assert.equal(cart.promotion_discount_total, "30.000000");

      cart = await tx((c) => applyPosCartCoupon(c, cashierContext, cart.id, { code: "SAVE5", expectedVersion: cart.version }));
      assert.equal(cart.coupon_discount_total, "5.000000");
      // 300 - 30 (promo) - 5 (coupon) = 265 taxable; 18% GST = 47.70; total = 312.70
      assert.equal(cart.grand_total, "312.700000");
    });

    await t.test("F279 SECURITY: a plain cashier cannot apply any manual discount; a supervisor's above-threshold discount needs a REAL, separately-authenticated approval decision -- a forged approvedBy can never substitute for one", async () => {
      await assert.rejects(
        () => tx((c) => applyPosCartLineDiscount(c, cashierContext, cart.id, cart.lines[0].id, { type: "percent", value: 5, reason: "test", expectedVersion: cart.version })),
        (error) => error.code === "FORBIDDEN",
      );

      // Above the 10% policy threshold: the discount is applied to the
      // cart immediately (visible to the cashier/supervisor), but a real
      // pending approval request is created -- it does NOT throw, and
      // there is no `approvedBy` field left to forge (removed from the
      // input entirely; see the route's zod schema and index.d.ts).
      cart = await tx((c) =>
        applyPosCartLineDiscount(c, supervisorContext, cart.id, cart.lines[0].id, { type: "percent", value: 50, reason: "damaged", expectedVersion: cart.version }),
      );
      assert.equal(cart.manual_discount_total, "150.000000", "the discount is visible on the cart while awaiting approval");

      // The checkout guard fails closed: an above-threshold discount with
      // no approved decision must never let a sale complete.
      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "f279-blocked-1", payments: [{ method: "cash", amount: cart.grand_total }] })),
        (error) => error.code === "POS_DISCOUNT_APPROVAL_REQUIRED",
      );

      const pendingRequest = await admin.query(
        `SELECT id, requested_by FROM public.approval_requests WHERE organization_id=$1 AND command_key='pos.discount.approve' AND status='pending' ORDER BY requested_at DESC LIMIT 1`,
        [orgId],
      );
      assert.ok(pendingRequest.rows[0], "requesting an above-threshold discount must create a real approval_requests row (requirement A)");
      const approvalRequestId = pendingRequest.rows[0].id;
      assert.equal(pendingRequest.rows[0].requested_by, supervisorId);

      // The supervisor who requested it cannot decide their own request --
      // enforced by the shared platform engine's assertSeparationOfDuties,
      // independent of anything cart.js does.
      await assert.rejects(
        () => tx((c) => decideApproval(c, supervisorSession, approvalRequestId, { decision: "approved" })),
        (error) => error.code === "SELF_APPROVAL_DENIED",
      );

      // A caller merely NAMING another user as the approver (the exact
      // forged-approvedBy vulnerability this session was asked to fix)
      // achieves nothing -- there is no code path left that reads such a
      // field. The discount remains unapproved until a genuinely separate,
      // authenticated session with pos.discount.approve decides it.
      const stillPending = await admin.query(`SELECT status FROM public.approval_requests WHERE id=$1`, [approvalRequestId]);
      assert.equal(stillPending.rows[0].status, "pending");

      // A real, separate approver without pos.discount.approve is refused.
      await assert.rejects(
        () =>
          tx((c) =>
            decideApproval(c, { ...managerSession, permissions: [] }, approvalRequestId, { decision: "approved" }),
          ),
        (error) => error.code === "FORBIDDEN",
      );

      // The genuine approver: a different, authenticated session holding
      // pos.discount.approve.
      const decision = await tx((c) => decideApproval(c, managerSession, approvalRequestId, { decision: "approved" }));
      assert.equal(decision.approval.status, "approved");

      const approvalRow = await admin.query(`SELECT status, approved_by FROM tenant.pos_cart_discount_approvals WHERE approval_request_id=$1`, [approvalRequestId]);
      assert.equal(approvalRow.rows[0].status, "approved");
      assert.equal(approvalRow.rows[0].approved_by, managerId, "approved_by must be the REAL decider's own authenticated id, never a client-supplied one (requirement D)");
    });

    await t.test("F277: a stale expectedVersion is rejected with a clean conflict, not a silent overwrite", async () => {
      await assert.rejects(
        () => tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: null, expectedVersion: 1 })),
        (error) => error.code === "POS_CART_VERSION_CONFLICT",
      );
    });

    await t.test("F277: cart mutations correctly re-read the freshly-updated row, not a stale pre-mutation object (regression for the bug found this session)", async () => {
      // Setting the customer must not silently revert the coupon/discount
      // that were applied in the immediately preceding calls -- this is
      // exactly the bug: reprice() previously used the caller's stale
      // in-memory `cart` object (fetched before ITS OWN update), so a
      // customer-set immediately after a coupon-apply would reprice using
      // coupon_code=null from the stale object.
      const before = cart;
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId: null, expectedVersion: cart.version }));
      assert.equal(cart.coupon_code, before.coupon_code, "coupon must survive an unrelated mutation");
      assert.equal(cart.manual_discount_total, before.manual_discount_total, "manual discount must survive an unrelated mutation");
    });

    await t.test("F279 SECURITY requirement J: a material cart change after approval invalidates it -- checkout fails closed again until reapproved at the new version", async () => {
      // The customer-set mutation above bumped cart.version, so the earlier
      // approval (bound to the version at the time it was granted) no
      // longer matches the cart's current version and must not still
      // authorize checkout.
      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "f279-stale-approval", payments: [{ method: "cash", amount: cart.grand_total }] })),
        (error) => error.code === "POS_DISCOUNT_APPROVAL_REQUIRED",
      );

      // Re-submitting the same discount at the cart's current version
      // creates a fresh pending request (idempotent re-request, not a
      // duplicate discount -- the line's manual_discount_amount is
      // unchanged) that a genuine approver must decide again.
      cart = await tx((c) =>
        applyPosCartLineDiscount(c, supervisorContext, cart.id, cart.lines[0].id, { type: "percent", value: 50, reason: "damaged", expectedVersion: cart.version }),
      );
      const pendingRequest = await admin.query(
        `SELECT id FROM public.approval_requests WHERE organization_id=$1 AND command_key='pos.discount.approve' AND status='pending' ORDER BY requested_at DESC LIMIT 1`,
        [orgId],
      );
      assert.ok(pendingRequest.rows[0]);
      const decision = await tx((c) => decideApproval(c, managerSession, pendingRequest.rows[0].id, { decision: "approved" }));
      assert.equal(decision.approval.status, "approved");
    });

    await t.test("F279 SECURITY: a flat-AMOUNT cart-level discount cannot bypass approval just because the threshold check only used to look at percent-type discounts", async () => {
      // Isolated cart on terminal 2 -- cancelled at the end so it doesn't
      // occupy pos_carts_one_active_per_terminal_uidx for the receipt-number
      // regression test below, which also uses terminal 2.
      let flatCart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminal2Id, shiftId: shift2.id }));
      flatCart = await tx((c) => addPosCartLine(c, cashierContext, flatCart.id, { itemId, quantity: 1, expectedVersion: flatCart.version }));
      assert.equal(flatCart.subtotal, "100.000000");

      // 15 is 15% of the 100 subtotal -- above the 10% threshold -- but
      // expressed as a flat amount, not a percent, so the old code
      // (`Number(input.value) > threshold && input.type === "percent"`)
      // never checked it at all.
      flatCart = await tx((c) =>
        setPosCartDiscount(c, supervisorContext, flatCart.id, { type: "amount", value: 15, reason: "flat amount test", expectedVersion: flatCart.version }),
      );
      const pendingRequest = await admin.query(
        `SELECT id FROM public.approval_requests WHERE organization_id=$1 AND command_key='pos.discount.approve' AND status='pending' AND entity_id=$2`,
        [orgId, flatCart.id],
      );
      assert.ok(pendingRequest.rows[0], "a flat-amount discount above the effective threshold percentage must require approval");

      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, flatCart.id, { idempotencyKey: "f279-flat-amount-blocked", payments: [{ method: "cash", amount: flatCart.grand_total }] })),
        (error) => error.code === "POS_DISCOUNT_APPROVAL_REQUIRED",
      );

      await tx((c) => cancelPosCart(c, cashierContext, flatCart.id, { reason: "test cleanup" }));
    });

    let sale;
    await t.test("F277/F278/F279/F280/F281 PHASE 10: completing the cart produces exactly one authoritative sale, one stock decrement, one coupon commit, one promotion usage", async () => {
      sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "cart-complete-1", payments: [{ method: "cash", amount: cart.grand_total } ] }));
      assert.equal(sale.status, "completed");
      assert.equal(sale.coupon_code, "SAVE5");

      const stockAfter = await admin.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, itemId, warehouseId]);
      assert.equal(stockAfter.rows[0].quantity, "997.000000", "3 units sold, 1000-3=997");

      const couponRow = await admin.query(`SELECT committed_count FROM tenant.pos_coupons WHERE organization_id=$1 AND id=$2`, [orgId, coupon.id]);
      assert.equal(couponRow.rows[0].committed_count, 1);
      const promoRow = await admin.query(`SELECT usage_count FROM tenant.pos_promotions WHERE organization_id=$1 AND id=$2`, [orgId, promotion.id]);
      assert.equal(promoRow.rows[0].usage_count, 1);
    });

    await t.test("F277: completing an already-completed cart with a different idempotency key is rejected, not double-completed", async () => {
      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "cart-complete-2", payments: [{ method: "cash", amount: sale.grand_total }] })),
        (error) => error.code === "POS_CART_NOT_PRICED",
      );
    });

    await t.test("F281: a FULL return releases the coupon redemption; committed_count goes back to 0", async () => {
      const lines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale.id]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, supervisorContext, {
          saleId: sale.id,
          reason: "full return",
          idempotencyKey: "return-1",
          lines: lines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity })),
        }),
      );
      const approved = await tx((c) => approvePointOfSaleReturn(c, ownerContext, returnRecord.id, { idempotencyKey: "return-approve-1" }));
      await tx((c) => completePointOfSaleReturn(c, ownerContext, approved.id, { idempotencyKey: "return-complete-1" }));

      const couponAfter = await admin.query(`SELECT committed_count FROM tenant.pos_coupons WHERE organization_id=$1 AND id=$2`, [orgId, coupon.id]);
      assert.equal(couponAfter.rows[0].committed_count, 0);
      const redemption = await admin.query(`SELECT status FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND coupon_id=$2 AND sale_id=$3`, [orgId, coupon.id, sale.id]);
      assert.equal(redemption.rows[0].status, "released");
    });

    await t.test("F278/PHASE 4: the legacy flat-lines completePointOfSale path computes tax authoritatively and rejects a forged tax value as a conflict", async () => {
      const legacySale = await tx((c) =>
        completePointOfSale(c, cashierContext, {
          shiftId: shift.id,
          idempotencyKey: "legacy-1",
          lines: [{ itemId, quantity: 1, unitPrice: 100 }],
          payments: [{ method: "cash", amount: 118 }],
        }),
      );
      assert.equal(legacySale.tax_total, "18.000000");
      assert.equal(legacySale.grand_total, "118.000000");

      await assert.rejects(
        () =>
          tx((c) =>
            completePointOfSale(c, cashierContext, {
              shiftId: shift.id,
              idempotencyKey: "legacy-forged",
              lines: [{ itemId, quantity: 1, unitPrice: 100, taxAmount: 0 }],
              payments: [{ method: "cash", amount: 100 }],
            }),
          ),
        (error) => error.code === "POS_PRICE_CONFLICT",
      );
    });

    await t.test("PHASE 10 regression: two terminals sharing the default receipt_prefix never collide on receipt numbers (real bug found this session)", async () => {
      const cart2 = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminal2Id, shiftId: shift2.id }));
      const priced2 = await tx((c) => addPosCartLine(c, cashierContext, cart2.id, { itemId, quantity: 1 }));
      const sale2 = await tx((c) => completePosCart(c, cashierContext, cart2.id, { idempotencyKey: "cart2-complete-1", payments: [{ method: "cash", amount: priced2.grand_total }] }));
      assert.notEqual(sale2.receipt_number, sale.receipt_number);
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
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[userId, supervisorId, managerId]]).catch(() => undefined);
    await admin.end();
  }
});
