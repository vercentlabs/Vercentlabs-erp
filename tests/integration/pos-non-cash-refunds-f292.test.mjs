// Real PostgreSQL integration test — F292 non-cash refunds. Proves
// completePointOfSaleReturn now refunds every tender a sale actually used
// (not just cash) through the same real, idempotent, capped
// refundPosPayment/provider-adapter mechanism the standalone payment-refund
// action already uses, and that F305's accounting posting for a return
// correctly attributes the refund back to each tender's own account.
// Mirrors pos-payments-f283-f286.test.mjs's card-sale fixture and
// pos-invoice-reconciliation-accounting-analytics-f290-f304-f305-f307.test.mjs's
// accounting-foundation fixture.
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

test("F292: non-cash and split-tender refunds against real PostgreSQL", async (t) => {
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
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePointOfSaleReturn,
    postPosReturnToAccounting,
    initializeAccountingCompany,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const cashierId = randomUUID();
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

  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.operate", "pos.sale.create", "pos.return.create"] };
  const supervisorContext = {
    organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [],
    permissions: ["pos.view", "pos.return.approve", "pos.payment.refund", "pos.accounting.post", "pos.settings.manage"],
  };

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

  let shiftId;
  let clearingAccountId;

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F292 Cashier','x','active',now())`, [cashierId, `f292-cashier-${cashierId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F292 Supervisor','x','active',now())`, [supervisorId, `f292-supervisor-${supervisorId}@test.invalid`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F292 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `f292-org-${orgId}`, cashierId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F292 Co','F292 Co Pvt Ltd','F292CO','INR','IN',true,'active')`, [companyId, orgId]);
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(
      `INSERT INTO tenant.fiscal_periods(organization_id,company_id,name,fiscal_year,start_date,end_date,status)
       VALUES ($1,$2,'FY Current','FY-CURRENT',date_trunc('year',current_date)::date,(date_trunc('year',current_date)+interval '1 year - 1 day')::date,'open')`,
      [orgId, companyId],
    );
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`, [warehouseId, orgId, companyId, branchId]);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'ZERO','Zero Rate','active')`, [taxCategoryId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'Zero','ZERO0','gst',0,'active')`, [randomUUID(), orgId, taxCategoryId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`, [priceListId, orgId]);
    await admin.query(
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F292 Widget','product',$3,$4,100,60,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,10000,0,60)`, [orgId, companyId, itemId, warehouseId]);
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id,require_return_approval,prohibit_self_return_approval) VALUES ($1,$2,true,true)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,timezone,allowed_payment_methods,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR','Asia/Kolkata',ARRAY['cash','card']::text[],$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, cashierId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [terminalId, orgId, companyId, storeId, cashierId]);
    await admin.query(
      `INSERT INTO tenant.pos_payment_provider_configs(organization_id,company_id,store_id,payment_method,provider_key,active,created_by) VALUES ($1,$2,$3,'card','sandbox',true,$4)`,
      [orgId, companyId, storeId, cashierId],
    );

    const shift = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminalId, cashierId],
      ),
    ).then((r) => r.rows[0]);
    shiftId = shift.id;

    // Accounting foundation, needed only for the F305 posting assertion.
    await tx((c) => initializeAccountingCompany(c, { organizationId: orgId, companyId, userId: supervisorId }));
    const ledgerRow = await admin.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2`, [orgId, companyId]);
    const ledgerId = ledgerRow.rows[0].id;
    const inventoryAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1300'`, [orgId, companyId, ledgerId]);
    const clearingAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1190'`, [orgId, companyId, ledgerId]);
    clearingAccountId = clearingAccount.rows[0].id;
    await admin.query(
      `INSERT INTO tenant.accounting_account_mappings(organization_id,company_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by)
       VALUES ($1,$2,$3,'inventory',$4,100,'active',$5,$5),($1,$2,$3,'pos_card_clearing',$6,100,'active',$5,$5)`,
      [orgId, companyId, ledgerId, inventoryAccount.rows[0].id, supervisorId, clearingAccountId],
    );

    let cardSaleId;
    let cardPaymentId;
    await t.test("F292: a full return on a card-only sale refunds the card payment through the real provider adapter, not cash", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 100, idempotencyKey: `init-${cart.id}`, outcome: "immediate_success" }));
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale-${cart.id}`, payments: [{ method: "card", paymentId: payment.id }] }));
      cardSaleId = sale.id;
      cardPaymentId = payment.id;

      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale.id]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId: sale.id,
          reason: "F292 card refund test",
          idempotencyKey: `return-${sale.id}`,
          lines: saleLines.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity, restock: true })),
        }),
      );
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `approve-${returnRecord.id}` }));
      const completed = await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `complete-${returnRecord.id}` }));
      assert.equal(completed.status, "completed");

      const paymentRow = await admin.query(`SELECT status,refunded_amount FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, cardPaymentId]);
      assert.equal(paymentRow.rows[0].status, "refunded");
      assert.equal(paymentRow.rows[0].refunded_amount, "100.000000");

      // No cash movement should exist for this all-card refund.
      const cashMovements = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_cash_movements WHERE organization_id=$1 AND reference_type='pos_return' AND reference_id=$2`, [orgId, returnRecord.id]);
      assert.equal(cashMovements.rows[0].n, 0);

      const posted = await tx((c) => postPosReturnToAccounting(c, supervisorContext, returnRecord.id));
      assert.equal(posted.posted, true, posted.message);
      const clearingLine = await admin.query(
        `SELECT credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND account_id=$3`,
        [orgId, posted.journalEntryId, clearingAccountId],
      );
      assert.equal(Number(clearingLine.rows[0].credit_amount), 100);
    });

    await t.test("F292: retrying an already-completed return's refund is idempotent (replays, never double-refunds)", async () => {
      const returnRow = await admin.query(`SELECT id FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id=$2`, [orgId, cardSaleId]);
      const replay = await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRow.rows[0].id, { idempotencyKey: `complete-${returnRow.rows[0].id}` }));
      assert.equal(replay.replayed, true);
      const paymentRow = await admin.query(`SELECT refunded_amount FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, cardPaymentId]);
      assert.equal(paymentRow.rows[0].refunded_amount, "100.000000");
    });

    await t.test("F292: a partial return on a split cash+card sale refunds each tender proportionally, capped at what each leg actually captured", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 4 }));
      assert.equal(cart.grand_total, "400.000000");
      const cardPayment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 100, idempotencyKey: `init-split-${cart.id}`, outcome: "immediate_success" }));
      const sale = await tx((c) =>
        completePosCart(c, cashierContext, cart.id, {
          idempotencyKey: `sale-split-${cart.id}`,
          payments: [
            { method: "cash", amount: 300 },
            { method: "card", paymentId: cardPayment.id },
          ],
        }),
      );

      // Return 1 of the 4 units (100 of the 400 total) -- proportional to
      // the 300 cash / 100 card original split, this should refund 75
      // cash + 25 card.
      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale.id]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId: sale.id,
          reason: "F292 split refund test",
          idempotencyKey: `return-split-${sale.id}`,
          lines: [{ saleLineId: saleLines.rows[0].id, quantity: 1, restock: true }],
        }),
      );
      assert.equal(returnRecord.refund_total, "100.000000");
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `approve-split-${returnRecord.id}` }));
      await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `complete-split-${returnRecord.id}` }));

      const cashMovement = await admin.query(
        `SELECT amount FROM tenant.pos_cash_movements WHERE organization_id=$1 AND reference_type='pos_return' AND reference_id=$2`,
        [orgId, returnRecord.id],
      );
      assert.equal(cashMovement.rows[0].amount, "-75.000000");
      const cardPaymentRow = await admin.query(`SELECT refunded_amount,status FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, cardPayment.id]);
      assert.equal(cardPaymentRow.rows[0].refunded_amount, "25.000000");
      assert.equal(cardPaymentRow.rows[0].status, "partially_refunded");
    });

    await t.test("F292: a second return against an already-fully-returned sale line is rejected, not silently over-refunded", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `sale-cap-${cart.id}`, payments: [{ method: "cash", amount: 100 }] }));
      const saleLines = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, sale.id]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId: sale.id,
          reason: "F292 cap test",
          idempotencyKey: `return-cap-${sale.id}`,
          lines: [{ saleLineId: saleLines.rows[0].id, quantity: 1, restock: true }],
        }),
      );
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `approve-cap-${returnRecord.id}` }));
      await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: `complete-cap-${returnRecord.id}` }));

      // The sale is now fully 'returned' (single line, fully returned) --
      // createPointOfSaleReturn's own eligible-sale query only matches
      // 'completed'/'partially_returned', so a fully-returned sale is
      // rejected outright rather than accepted and later over-refunded.
      await assert.rejects(
        () =>
          tx((c) =>
            createPointOfSaleReturn(c, cashierContext, {
              saleId: sale.id,
              reason: "F292 double-return attempt",
              idempotencyKey: `return-cap-second-${sale.id}`,
              lines: [{ saleLineId: saleLines.rows[0].id, quantity: 1, restock: true }],
            }),
          ),
        (error) => error.code === "POS_RETURN_SALE_NOT_FOUND",
      );
      const paymentRow = await admin.query(`SELECT refunded_amount FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND payment_method='cash'`, [orgId, sale.id]);
      assert.equal(paymentRow.rows[0].refunded_amount, "100.000000");
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "accounting_events",
      "accounting_journal_lines",
      "accounting_journal_entries",
      "accounting_account_mappings",
      "accounting_settings",
      "accounting_journals",
      "accounting_accounts",
      "accounting_ledgers",
      "pos_payment_webhook_events",
      "pos_payments",
      "pos_payment_provider_configs",
      "pos_cash_movements",
      "pos_return_lines",
      "pos_returns",
      "pos_sale_lines",
      "pos_sales",
      "pos_cart_lines",
      "pos_carts",
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
      "tax_rates",
      "tax_categories",
      "units_of_measure",
      "warehouses",
      "currencies",
      "fiscal_periods",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierId, supervisorId]]).catch(() => undefined);
    await admin.end();
  }
});
