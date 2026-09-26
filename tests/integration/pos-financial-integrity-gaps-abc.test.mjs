// Real PostgreSQL integration test — POS Completion Program Prompt 2,
// financial-integrity Gaps A/B/C (accounting-posting.js):
//
//   A. A return's journal now reverses the original sale's loyalty
//      accrual/redemption (previously not built at all).
//   B. Refund tender allocation now reads the EXACT per-payment split
//      persisted at refund time (tenant.pos_return_payment_refunds),
//      instead of reconstructing a proportional guess -- proven here
//      specifically via a sale returned in TWO separate partial returns,
//      the exact scenario the old reconstruction could not attribute
//      correctly (pos_payments.refunded_amount is a running total with
//      no per-return breakdown).
//   C. Loyalty accrual is valued at the ORIGINAL SALE's own historical
//      rate snapshot, never the program's current live rate -- proven by
//      changing the program's rate AFTER the sale but BEFORE the return
//      is posted, and confirming the reversal still uses the old rate.
//
// Fixture shape mirrors pos-invoice-reconciliation-accounting-analytics-
// f290-f304-f305-f307.test.mjs (real Accounting foundation +
// initializeAccountingCompany), extended with the two loyalty-specific
// account mappings (pos_loyalty_program_expense, pos_loyalty_liability)
// F305's loyalty accrual/reversal lines need.
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

test("Financial integrity Gaps A/B/C: loyalty-accrual reversal, exact refund allocation, historical loyalty valuation against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    addPosCartLine,
    setPosCartCustomer,
    completePosCart,
    initiatePosPayment,
    createPointOfSaleReturn,
    approvePointOfSaleReturn,
    completePointOfSaleReturn,
    postPosSaleToAccounting,
    postPosReturnToAccounting,
    upsertPosLoyaltyProgram,
    initializeAccountingCompany,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const cashierId = randomUUID();
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
  const customerId = randomUUID();

  const cashierContext = {
    organizationId: orgId, companyId, userId: cashierId, roleSlugs: [],
    permissions: ["pos.view", "pos.sale.create", "pos.return.create", "pos.payment.refund"],
  };
  const supervisorContext = {
    organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [],
    permissions: ["pos.view", "pos.settings.manage", "pos.loyalty.manage", "pos.return.approve", "pos.payment.refund", "pos.accounting.post", "pos.accounting.view"],
  };
  const managerContext = { organizationId: orgId, companyId, userId: managerId, roleSlugs: ["organization_owner"], permissions: [] };

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

  let shiftId;

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'GapABC Cashier','x','active',now())`, [cashierId, `gapabc-cashier-${cashierId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'GapABC Supervisor','x','active',now())`, [supervisorId, `gapabc-supervisor-${supervisorId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'GapABC Manager','x','active',now())`, [managerId, `gapabc-manager-${managerId}@test.invalid`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'GapABC Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `gapabc-org-${orgId}`, cashierId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'GapABC Co','GapABC Co Pvt Ltd','GAPABCCO','INR','IN',true,'active')`, [companyId, orgId]);
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','GapABC Widget','product',$3,$4,100,60,'active')`,
      [itemId, orgId, uomId, taxCategoryId],
    );
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(`INSERT INTO tenant.stock_balances(organization_id,company_id,item_id,warehouse_id,quantity,reserved_quantity,average_cost) VALUES ($1,$2,$3,$4,10000,0,60)`, [orgId, companyId, itemId, warehouseId]);
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,timezone,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR','Asia/Kolkata',$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, cashierId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [terminalId, orgId, companyId, storeId, cashierId]);
    await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Customer One','active',$4)`, [customerId, orgId, companyId, cashierId]);
    await admin.query(
      `INSERT INTO tenant.pos_payment_provider_configs(organization_id,company_id,store_id,payment_method,provider_key,active,created_by) VALUES ($1,$2,$3,'card','sandbox',true,$4)`,
      [orgId, companyId, storeId, cashierId],
    );
    await admin.query(`UPDATE tenant.pos_stores SET allowed_payment_methods=ARRAY['cash','card']::text[] WHERE organization_id=$1 AND id=$2`, [orgId, storeId]);

    const shift = await tx((c) =>
      c.query(
        `INSERT INTO tenant.pos_shifts(organization_id,company_id,store_id,terminal_id,shift_number,cashier_user_id,status,opened_at,opened_by)
         VALUES ($1,$2,$3,$4,'SHIFT-1',$5,'open',now(),$5) RETURNING *`,
        [orgId, companyId, storeId, terminalId, cashierId],
      ),
    ).then((r) => r.rows[0]);
    shiftId = shift.id;

    await tx((c) => initializeAccountingCompany(c, { organizationId: orgId, companyId, userId: managerId }));
    const ledgerRow = await admin.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2`, [orgId, companyId]);
    const ledgerId = ledgerRow.rows[0].id;
    const inventoryAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1300'`, [orgId, companyId, ledgerId]);
    const clearingAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1190'`, [orgId, companyId, ledgerId]);
    // Gap A/C need real, distinct accrual accounts -- reusing the seeded
    // general-expense (6100) and other-current-liabilities (2400) accounts,
    // the same way a real finance admin configuring this for the first
    // time would pick generic accounts rather than needing bespoke ones.
    const expenseAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='6100'`, [orgId, companyId, ledgerId]);
    const liabilityAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='2400'`, [orgId, companyId, ledgerId]);
    await admin.query(
      `INSERT INTO tenant.accounting_account_mappings(organization_id,company_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by)
       VALUES ($1,$2,$3,'inventory',$4,100,'active',$5,$5),
              ($1,$2,$3,'pos_card_clearing',$6,100,'active',$5,$5),
              ($1,$2,$3,'pos_loyalty_program_expense',$7,100,'active',$5,$5),
              ($1,$2,$3,'pos_loyalty_liability',$8,100,'active',$5,$5)`,
      [orgId, companyId, ledgerId, inventoryAccount.rows[0].id, managerId, clearingAccount.rows[0].id, expenseAccount.rows[0].id, liabilityAccount.rows[0].id],
    );

    await t.test("setup: loyalty program at 1 point per 10 spent, redemption value 1 per point", async () => {
      const program = await tx((c) => upsertPosLoyaltyProgram(c, supervisorContext, { name: "Standard", earnRatePointsPerCurrency: 0.1, redemptionValuePerPoint: 1 }));
      assert.equal(program.status, "active");
    });

    let saleId;
    await t.test("Gap C setup: a loyalty-earning sale snapshots the CURRENT rate onto the sale row", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId, expectedVersion: cart.version }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      assert.equal(cart.grand_total, "100.000000");
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "gapabc-sale-1", payments: [{ method: "cash", amount: 100 }] }));
      saleId = sale.id;
      assert.equal(sale.loyalty_points_earned, "10.000000"); // 100 * 0.1
      assert.equal(sale.loyalty_redemption_value_per_point_snapshot, "1.0000000000");
    });

    await t.test("Gap C: the loyalty program's rate is changed AFTER the sale -- the sale's own snapshot must not move", async () => {
      await tx((c) => upsertPosLoyaltyProgram(c, supervisorContext, { name: "Standard", earnRatePointsPerCurrency: 0.1, redemptionValuePerPoint: 5 }));
      const saleRow = await admin.query(`SELECT loyalty_redemption_value_per_point_snapshot FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [orgId, saleId]);
      assert.equal(saleRow.rows[0].loyalty_redemption_value_per_point_snapshot, "1.0000000000", "changing the LIVE program rate must never retroactively change an already-completed sale's own snapshot");
    });

    await t.test("Gap A/C: a full return posts a loyalty-accrual REVERSAL valued at the sale's OWN historical rate (1/point), not the program's current rate (now 5/point)", async () => {
      // First post the original sale, producing its own accrual lines at
      // the rate that was in effect (1/point -- 10 points earned = 10.00).
      const saleOutcome = await tx((c) => postPosSaleToAccounting(c, supervisorContext, saleId));
      assert.equal(saleOutcome.posted, true);
      const saleLines = await admin.query(
        `SELECT account_id,debit_amount,credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`,
        [orgId, saleOutcome.journalEntryId],
      );
      const saleExpenseLine = saleLines.rows.find((r) => r.account_id === expenseAccount.rows[0].id);
      const saleLiabilityLine = saleLines.rows.find((r) => r.account_id === liabilityAccount.rows[0].id);
      assert.equal(Number(saleExpenseLine.debit_amount), 10, "accrual expense valued at the sale's own 1/point rate: 10 points x 1 = 10");
      assert.equal(Number(saleLiabilityLine.credit_amount), 10);

      const saleLineRows = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, saleId]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId,
          reason: "Gap A/C test — full return",
          idempotencyKey: "gapabc-return-1",
          lines: saleLineRows.rows.map((row) => ({ saleLineId: row.id, quantity: row.quantity, restock: true })),
        }),
      );
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-approve-1" }));
      const completed = await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-complete-1" }));
      assert.equal(completed.status, "completed");

      // loyalty.js's own reverse_earn ledger entry must exist, reversing
      // all 10 points (a full return).
      const ledgerReversal = await admin.query(`SELECT points FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND return_id=$2 AND entry_type='reverse_earn'`, [orgId, returnRecord.id]);
      assert.equal(ledgerReversal.rows[0].points, "-10.000000");

      const returnOutcome = await tx((c) => postPosReturnToAccounting(c, supervisorContext, returnRecord.id));
      assert.equal(returnOutcome.posted, true, returnOutcome.message);
      const returnLines = await admin.query(
        `SELECT account_id,debit_amount,credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`,
        [orgId, returnOutcome.journalEntryId],
      );
      let debitTotal = 0;
      let creditTotal = 0;
      for (const row of returnLines.rows) {
        debitTotal += Number(row.debit_amount);
        creditTotal += Number(row.credit_amount);
      }
      assert.equal(debitTotal, creditTotal, "the return journal must balance");

      const returnLiabilityLine = returnLines.rows.find((r) => r.account_id === liabilityAccount.rows[0].id);
      const returnExpenseLine = returnLines.rows.find((r) => r.account_id === expenseAccount.rows[0].id);
      assert.ok(returnLiabilityLine, "expected a loyalty-liability reversal line on the return journal (Gap A)");
      assert.ok(returnExpenseLine, "expected a loyalty-expense reversal line on the return journal (Gap A)");
      // Gap C proof: 10 reversed points valued at 1/point (the SALE's own
      // snapshot) = 10.00, NOT 10 x 5 = 50 (the program's current rate).
      assert.equal(Number(returnLiabilityLine.debit_amount), 10, "loyalty reversal must use the sale's OWN historical rate, not the program's current rate");
      assert.equal(Number(returnExpenseLine.credit_amount), 10);
    });

    let splitSaleId;
    let cardPaymentId;
    let cashPaymentAmount;
    await t.test("Gap B setup: a split cash+card sale of 2 units, to be partially returned twice", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 2 })); // 200 total
      const cardPayment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 150, idempotencyKey: `gapabc-card-init-${cart.id}`, outcome: "immediate_success" }));
      cardPaymentId = cardPayment.id;
      cashPaymentAmount = 50;
      const sale = await tx((c) =>
        completePosCart(c, cashierContext, cart.id, {
          idempotencyKey: "gapabc-split-sale",
          payments: [{ method: "cash", amount: cashPaymentAmount }, { method: "card", paymentId: cardPayment.id }],
        }),
      );
      splitSaleId = sale.id;
      assert.equal(sale.grand_total, "200.000000");
    });

    await t.test("Gap B: FIRST partial return (1 of 2 units) persists an exact per-payment refund record, not a reconstructed guess", async () => {
      const saleLineRows = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, splitSaleId]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId: splitSaleId,
          reason: "Gap B test — first partial return",
          idempotencyKey: "gapabc-return-2a",
          lines: [{ saleLineId: saleLineRows.rows[0].id, quantity: 1, restock: true }],
        }),
      );
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-approve-2a" }));
      const completed = await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-complete-2a" }));
      assert.equal(completed.refund_total, "100.000000"); // half of 200

      const refundRows = await admin.query(
        `SELECT payment_method,refund_amount FROM tenant.pos_return_payment_refunds WHERE organization_id=$1 AND return_id=$2 ORDER BY payment_method`,
        [orgId, returnRecord.id],
      );
      // Refunded proportionally to how it was paid: cash 50/200 of the
      // sale, card 150/200 -- so this 100 refund splits 25 cash / 75 card.
      const cashRefund = refundRows.rows.find((r) => r.payment_method === "cash");
      const cardRefund = refundRows.rows.find((r) => r.payment_method === "card");
      assert.equal(cashRefund.refund_amount, "25.000000");
      assert.equal(cardRefund.refund_amount, "75.000000");

      const outcome = await tx((c) => postPosReturnToAccounting(c, supervisorContext, returnRecord.id));
      assert.equal(outcome.posted, true, outcome.message);
      const lines = await admin.query(`SELECT account_id,credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [orgId, outcome.journalEntryId]);
      const cardClearingLine = lines.rows.find((r) => r.account_id === clearingAccount.rows[0].id);
      assert.equal(Number(cardClearingLine.credit_amount), 75, "the return journal's card-clearing credit must match the EXACT persisted refund, not a reconstructed proportion of a now-stale running total");
    });

    await t.test("Gap B: SECOND partial return (the other unit) still attributes correctly -- this is exactly where the OLD reconstruction broke", async () => {
      // Before this fix, buildReturnJournalLines reconstructed a non-cash
      // refund's split by reading pos_payments' CURRENT running
      // refunded_amount and captured_amount -- fine for a sale returned
      // ONCE, but with two returns already touching the same payment,
      // that reconstruction has no way to know how much of the RUNNING
      // total belongs to THIS specific return. This test is the one the
      // old code could not have passed correctly.
      const saleLineRows = await admin.query(`SELECT id,quantity FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`, [orgId, splitSaleId]);
      const returnRecord = await tx((c) =>
        createPointOfSaleReturn(c, cashierContext, {
          saleId: splitSaleId,
          reason: "Gap B test — second partial return",
          idempotencyKey: "gapabc-return-2b",
          lines: [{ saleLineId: saleLineRows.rows[0].id, quantity: 1, restock: true }],
        }),
      );
      await tx((c) => approvePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-approve-2b" }));
      const completed = await tx((c) => completePointOfSaleReturn(c, supervisorContext, returnRecord.id, { idempotencyKey: "gapabc-complete-2b" }));
      assert.equal(completed.refund_total, "100.000000");

      const refundRows = await admin.query(
        `SELECT payment_method,refund_amount FROM tenant.pos_return_payment_refunds WHERE organization_id=$1 AND return_id=$2 ORDER BY payment_method`,
        [orgId, returnRecord.id],
      );
      const cashRefund = refundRows.rows.find((r) => r.payment_method === "cash");
      const cardRefund = refundRows.rows.find((r) => r.payment_method === "card");
      assert.equal(cashRefund.refund_amount, "25.000000", "the SECOND return's own exact cash share");
      assert.equal(cardRefund.refund_amount, "75.000000", "the SECOND return's own exact card share");

      const outcome = await tx((c) => postPosReturnToAccounting(c, supervisorContext, returnRecord.id));
      assert.equal(outcome.posted, true, outcome.message);
      const lines = await admin.query(`SELECT account_id,credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [orgId, outcome.journalEntryId]);
      const cardClearingLine = lines.rows.find((r) => r.account_id === clearingAccount.rows[0].id);
      assert.equal(Number(cardClearingLine.credit_amount), 75, "THIS return's own exact card refund, correctly isolated from the first return's own 75");

      // Confirm the card payment is now fully refunded (75 + 75 = 150).
      const paymentRow = await admin.query(`SELECT refunded_amount,status FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [orgId, cardPaymentId]);
      assert.equal(paymentRow.rows[0].refunded_amount, "150.000000");
      assert.equal(paymentRow.rows[0].status, "refunded");
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
      "pos_return_payment_refunds",
      "pos_loyalty_ledger",
      "pos_loyalty_balances",
      "pos_loyalty_programs",
      "pos_return_lines",
      "pos_returns",
      "pos_payment_webhook_events",
      "pos_payments",
      "pos_payment_provider_configs",
      "pos_cash_movements",
      "pos_sale_lines",
      "pos_sales",
      "pos_cart_lines",
      "pos_carts",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
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
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierId, supervisorId, managerId]]).catch(() => undefined);
    await admin.end();
  }
});
