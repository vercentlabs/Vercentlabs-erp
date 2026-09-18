// Real PostgreSQL integration test -- F283 (card) / F284 (UPI/digital) /
// F285 (split tender) / F286 (multiple payment methods): the ONE
// payment-tender subsystem card/UPI/split/multi-method all flow through.
// Exercises the deterministic sandbox adapter's every scripted outcome
// (immediate success, immediate decline, delayed-webhook success) against
// the real state machine, the two idempotency axes (command idempotency
// key on initiate/refund, and provider event id on webhook delivery), the
// exact-sum split invariant (via core/decimal.js's allocate(), the same
// helper a real client would use to compute split legs), and a genuine
// two-connection race on a redelivered webhook event id.
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

test("F283-F286: card/UPI/split/multi-method payments against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    completePosCart,
    initiatePosPayment,
    refundPosPayment,
    handlePosPaymentWebhook,
  } = await import("../../services/api/src/index.js");
  const { allocate } = await import("../../services/api/src/core/decimal.js");
  const { buildSandboxWebhookDelivery } = await import(
    "../../services/api/src/modules/point-of-sale/tender-and-payment-execution/sandbox-adapter.js"
  );
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

  const cashierContext = { organizationId: orgId, companyId, userId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create"] };
  const refundContext = {
    organizationId: orgId,
    companyId,
    userId: supervisorId,
    roleSlugs: [],
    permissions: ["pos.view", "pos.sale.create", "pos.payment.refund"],
  };

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

  // Each scenario gets its OWN terminal+shift: tenant.pos_carts enforces at
  // most one draft/priced cart per terminal (pos_carts_one_active_per_
  // terminal_uidx) and createPosCart deliberately RESUMES an existing
  // open cart on the same terminal rather than erroring -- exactly right
  // for a real cashier UI, but it means two scenarios sharing one terminal
  // would silently accumulate onto the SAME cart (and collide on this
  // file's per-cart idempotency keys) whenever a prior scenario
  // deliberately left its cart non-terminal (e.g. the decline scenario,
  // by design, never completes or cancels its cart). A fresh terminal per
  // scenario is genuine test isolation, not a workaround for a bug.
  async function freshCart(quantity = 1) {
    const scenarioTerminalId = randomUUID();
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,$5,'Terminal',$6)`, [
      scenarioTerminalId,
      orgId,
      companyId,
      storeId,
      `T-${scenarioTerminalId.slice(0, 8)}`,
      userId,
    ]);
    const shift = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,$5,$6,'open',now(),$6) RETURNING *`,
        [orgId, companyId, storeId, scenarioTerminalId, `SHIFT-${scenarioTerminalId.slice(0, 8)}`, userId],
      ),
    );
    let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: scenarioTerminalId, shiftId: shift.rows[0].id }));
    cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity }));
    return cart;
  }

  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F283 Cashier','x','active',now())`,
      [userId, `f283-cashier-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F283 Supervisor','x','active',now())`,
      [supervisorId, `f283-supervisor-${supervisorId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F283 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f283-org-${orgId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F283 Co','F283 Co Pvt Ltd','F283CO','INR','IN',true,'active')`,
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F283 Widget','product',$3,$4,100,50,'active')`,
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
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,created_by,allowed_payment_methods)
       VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR',$7,ARRAY['cash','card','upi']::text[])`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, userId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalId,
      orgId,
      companyId,
      storeId,
      userId,
    ]);
    await admin.query(
      `INSERT INTO tenant.pos_payment_provider_configs(organization_id,company_id,store_id,payment_method,provider_key,active,created_by)
       VALUES ($1,$2,$3,'card','sandbox',true,$4),($1,$2,$3,'upi','sandbox',true,$4)`,
      [orgId, companyId, storeId, userId],
    );
    // The fixture terminal above is intentionally left without its own
    // shift -- every scenario opens its own terminal+shift via freshCart()
    // for full isolation (see that function's comment).

    let cardSaleId;
    let cardPaymentId;
    await t.test("F283: immediate-success card capture completes a sale", async () => {
      const cart = await freshCart(1); // grand total 118 (100 + 18% GST)
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 118, idempotencyKey: `init-${cart.id}`, outcome: "immediate_success" }));
      assert.equal(payment.status, "captured");
      assert.ok(payment.provider_reference);
      cardPaymentId = payment.id;
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale-${cart.id}`, payments: [{ method: "card", paymentId: payment.id }] }));
      assert.equal(sale.status, "completed");
      cardSaleId = sale.id;
      const row = await admin.query(`SELECT sale_id,status FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, payment.id]);
      assert.equal(row.rows[0].sale_id, sale.id);
      assert.equal(row.rows[0].status, "captured");
    });

    await t.test("F284: delayed UPI webhook -- sale is blocked until the webhook arrives, then completes", async () => {
      const cart = await freshCart(1);
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "upi", amount: 118, idempotencyKey: `init-${cart.id}`, outcome: "delayed_success" }));
      assert.equal(payment.status, "pending");

      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale-${cart.id}`, payments: [{ method: "upi", paymentId: payment.id }] })),
        (error) => error.code === "POS_PAYMENT_NOT_CAPTURED",
      );

      const delivery = buildSandboxWebhookDelivery({
        organizationId: orgId,
        companyId,
        paymentId: payment.id,
        providerReference: payment.provider_reference,
        status: "captured",
      });
      const result = await tx((c) => handlePosPaymentWebhook(c, { providerKey: "sandbox", rawBody: delivery.rawBody, signatureHeader: delivery.signatureHeader }));
      assert.equal(result.replayed, false);
      assert.equal(result.payment.status, "captured");

      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale2-${cart.id}`, payments: [{ method: "upi", paymentId: payment.id }] }));
      assert.equal(sale.status, "completed");
    });

    await t.test("A decline is rejected cleanly and never creates a sale", async () => {
      const cart = await freshCart(1);
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 118, idempotencyKey: `init-${cart.id}`, outcome: "immediate_decline" }));
      assert.equal(payment.status, "failed");

      await assert.rejects(
        () => tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale-${cart.id}`, payments: [{ method: "card", paymentId: payment.id }] })),
        (error) => error.code === "POS_PAYMENT_NOT_CAPTURED",
      );
      const sales = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_sales WHERE organization_id=$1 AND cart_id=$2`, [orgId, cart.id]);
      assert.equal(sales.rows[0].n, 0);
    });

    await t.test("A redelivered webhook event id is a no-op, not reprocessed", async () => {
      const cart = await freshCart(1);
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "upi", amount: 118, idempotencyKey: `init-${cart.id}`, outcome: "delayed_success" }));
      const delivery = buildSandboxWebhookDelivery({
        organizationId: orgId,
        companyId,
        paymentId: payment.id,
        providerReference: payment.provider_reference,
        status: "captured",
      });
      const first = await tx((c) => handlePosPaymentWebhook(c, { providerKey: "sandbox", rawBody: delivery.rawBody, signatureHeader: delivery.signatureHeader }));
      assert.equal(first.replayed, false);
      const second = await tx((c) => handlePosPaymentWebhook(c, { providerKey: "sandbox", rawBody: delivery.rawBody, signatureHeader: delivery.signatureHeader }));
      assert.equal(second.replayed, true);
      const events = await admin.query(
        `SELECT count(*)::int AS n FROM tenant.pos_payment_webhook_events WHERE organization_id=$1 AND provider_key='sandbox' AND event_id=$2`,
        [orgId, delivery.payload.eventId],
      );
      assert.equal(events.rows[0].n, 1);
    });

    await t.test("Retrying initiatePosPayment with the same idempotency key replays instead of double-initiating", async () => {
      const cart = await freshCart(1);
      const key = `replay-${cart.id}`;
      const first = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 118, idempotencyKey: key, outcome: "immediate_success" }));
      const second = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 118, idempotencyKey: key, outcome: "immediate_success" }));
      assert.equal(second.replayed, true);
      assert.equal(second.id, first.id);
      const rows = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_payments WHERE organization_id=$1 AND idempotency_key=$2`, [orgId, key]);
      assert.equal(rows.rows[0].n, 1);
    });

    await t.test("A refund is idempotent on retry and cannot exceed the captured amount", async () => {
      const key = `refund-${cardPaymentId}`;
      const first = await tx((c) => refundPosPayment(c, refundContext, { paymentId: cardPaymentId, amount: 50, idempotencyKey: key }));
      assert.equal(first.status, "partially_refunded");
      assert.equal(first.refunded_amount, "50.000000");

      const replay = await tx((c) => refundPosPayment(c, refundContext, { paymentId: cardPaymentId, amount: 50, idempotencyKey: key }));
      assert.equal(replay.replayed, true);
      assert.equal(replay.refunded_amount, "50.000000");

      await assert.rejects(
        () => tx((c) => refundPosPayment(c, refundContext, { paymentId: cardPaymentId, amount: 100, idempotencyKey: `refund-too-much-${cardPaymentId}` })),
        (error) => error.code === "POS_REFUND_EXCEEDS_CAPTURED",
      );
    });

    await t.test("F285: split cash+card sums EXACTLY via allocate(), completes only once the card leg captures, and each leg is independently refundable", async () => {
      const cart = await freshCart(1); // grand total 118.000000
      const { asDatabaseDecimal } = await import("../../services/api/src/core/decimal.js");
      // The exact-sum split invariant (F285): allocate() guarantees the two
      // shares sum EXACTLY to the total (the last share absorbs the
      // rounding remainder) -- this is what a real client would call to
      // compute split-tender legs before initiating the non-cash one.
      const [cashShareDec, cardShareDec] = allocate("118", [1, 1]);
      const cashLegAmount = Number(asDatabaseDecimal(cashShareDec));
      const cardLegAmount = Number(asDatabaseDecimal(cardShareDec));
      assert.equal(cashLegAmount + cardLegAmount, 118);

      const payment = await tx((c) =>
        initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: cardLegAmount, idempotencyKey: `split-${cart.id}`, outcome: "immediate_success" }),
      );
      assert.equal(payment.status, "captured");

      const sale = await tx((c) =>
        completePosCart(c, cashierContext, cart.id, {
          idempotencyKey: `split-sale-${cart.id}`,
          payments: [
            { method: "cash", amount: cashLegAmount },
            { method: "card", paymentId: payment.id },
          ],
        }),
      );
      assert.equal(sale.status, "completed");
      assert.equal(sale.grand_total, "118.000000");
      assert.equal(sale.paid_total, "118.000000");

      const legs = await admin.query(
        `SELECT id,payment_method,amount,status FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 ORDER BY payment_method`,
        [orgId, sale.id],
      );
      assert.equal(legs.rows.length, 2);
      const cashLeg = legs.rows.find((r) => r.payment_method === "cash");
      const cardLeg = legs.rows.find((r) => r.payment_method === "card");
      assert.equal(cashLeg.status, "captured");
      assert.equal(cardLeg.status, "captured");

      // Refunding the card leg must not touch the cash leg, and must never
      // fall back to a cash movement -- it routes back to card only.
      const cashMovementsBefore = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_cash_movements WHERE organization_id=$1 AND movement_type='refund'`, [orgId]);
      const refunded = await tx((c) => refundPosPayment(c, refundContext, { paymentId: payment.id, amount: cardLegAmount, idempotencyKey: `split-refund-${payment.id}` }));
      assert.equal(refunded.status, "refunded");
      const cashMovementsAfter = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_cash_movements WHERE organization_id=$1 AND movement_type='refund'`, [orgId]);
      assert.equal(cashMovementsAfter.rows[0].n, cashMovementsBefore.rows[0].n, "a card refund must never create a cash-drawer movement");

      const cashLegAfter = await admin.query(`SELECT status,refunded_amount FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, cashLeg.id]);
      assert.equal(cashLegAfter.rows[0].status, "captured", "the cash leg must be unaffected by the card leg's refund");
      assert.equal(cashLegAfter.rows[0].refunded_amount, "0.000000");

      // A cash leg can never be refunded through this route -- proves a
      // refund never silently falls back to cash for a non-cash sale either.
      await assert.rejects(
        () => tx((c) => refundPosPayment(c, refundContext, { paymentId: cashLeg.id, amount: 1, idempotencyKey: `cash-refund-attempt-${cashLeg.id}` })),
        (error) => error.code === "POS_REFUND_USE_RETURN_WORKFLOW",
      );
    });

    await t.test("Concurrency: two racing deliveries of the SAME webhook event id -- exactly one wins, no double capture", async () => {
      const second = await connectOrNull(adminConnectionString);
      assert.ok(second, "a second real Postgres connection is required for this race");
      try {
        const cart = await freshCart(1);
        const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 118, idempotencyKey: `race-${cart.id}`, outcome: "delayed_success" }));
        const delivery = buildSandboxWebhookDelivery({
          organizationId: orgId,
          companyId,
          paymentId: payment.id,
          providerReference: payment.provider_reference,
          status: "captured",
        });

        async function deliverOn(connection) {
          await connection.query("BEGIN");
          try {
            await setTenantContext(connection, orgId);
            const result = await handlePosPaymentWebhook(connection, { providerKey: "sandbox", rawBody: delivery.rawBody, signatureHeader: delivery.signatureHeader });
            await connection.query("COMMIT");
            return result;
          } catch (error) {
            await connection.query("ROLLBACK");
            throw error;
          }
        }

        const [resultA, resultB] = await Promise.all([deliverOn(admin), deliverOn(second)]);
        const replayedFlags = [resultA.replayed, resultB.replayed].sort();
        assert.deepEqual(replayedFlags, [false, true], "exactly one delivery should win the dedupe insert");

        const events = await admin.query(
          `SELECT count(*)::int AS n FROM tenant.pos_payment_webhook_events WHERE organization_id=$1 AND provider_key='sandbox' AND event_id=$2`,
          [orgId, delivery.payload.eventId],
        );
        assert.equal(events.rows[0].n, 1);

        const finalPayment = await admin.query(`SELECT status FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, payment.id]);
        assert.equal(finalPayment.rows[0].status, "captured");
      } finally {
        await second.end();
      }
    });
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id IN ($1,$2)`, [userId, supervisorId]).catch(() => undefined);
    await admin.end();
  }
});
