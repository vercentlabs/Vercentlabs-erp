// Real PostgreSQL integration test — F290 (invoice generation), F304
// (payment reconciliation), F305 (POS accounting posting) and F307 (POS
// analytics). Mirrors pos-loyalty-earn-redeem-reverse-f306.test.mjs's
// fixture/tx/cleanup shape, extended with a real Accounting foundation
// (initializeAccountingCompany) and the two POS-specific account mappings
// (pos_card_clearing, inventory) F305 needs beyond what's pre-seeded for
// every company.
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

test("F290/F304/F305/F307: invoice generation, payment reconciliation, accounting posting and analytics against real PostgreSQL", async (t) => {
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
    closeShift,
    generatePosDayEndReport,
    reviewPosDayEndReport,
    finalizePosDayEndReport,
    generatePosInvoice,
    getPosInvoiceForSale,
    postPosSaleToAccounting,
    postPosDayEndReportToAccounting,
    importPosSettlementBatch,
    generatePosReconciliation,
    resolvePosReconciliation,
    getPosSalesAnalytics,
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
    permissions: ["pos.view", "pos.operate", "pos.sale.create", "pos.invoice.generate", "pos.invoice.view"],
  };
  const supervisorContext = {
    organizationId: orgId, companyId, userId: supervisorId, roleSlugs: [],
    // Deliberately also holds pos.reconciliation.approve here, even though
    // the built-in pos_supervisor/pos_manager role templates never
    // combine manage+approve on one role (see the blocking
    // pos_reconciliation_manage_approve SoD conflict) -- this represents a
    // custom org role that DOES grant both, which is exactly the scenario
    // resolvePosReconciliation's own same-person runtime check (not just
    // the role-template advisory) has to catch.
    permissions: [
      "pos.view", "pos.settings.manage", "pos.shift.close", "pos.report.generate", "pos.report.view",
      "pos.reconciliation.manage", "pos.reconciliation.approve", "pos.reconciliation.view",
      "pos.accounting.post", "pos.accounting.view", "pos.analytics.view",
    ],
  };
  const managerContext = {
    organizationId: orgId, companyId, userId: managerId, roleSlugs: [],
    permissions: [
      "pos.view", "pos.report.finalize", "pos.report.view", "pos.reconciliation.approve", "pos.reconciliation.view",
      "pos.accounting.post", "pos.accounting.view",
    ],
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
  let cashSaleId;
  let cardSaleId;
  let cardPaymentReference;
  let reportId;

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F305 Cashier','x','active',now())`, [cashierId, `f305-cashier-${cashierId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F305 Supervisor','x','active',now())`, [supervisorId, `f305-supervisor-${supervisorId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F305 Manager','x','active',now())`, [managerId, `f305-manager-${managerId}@test.invalid`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F305 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `f305-org-${orgId}`, cashierId]);
    // Real organizations get these seeded once (migration 013) for every
    // org that existed at that time, or via onboarding for later ones --
    // this test's org is created directly via SQL, so it needs the same
    // row a real org's Accounting module enablement would provide.
    await admin.query(`INSERT INTO public.numbering_series(organization_id,entity_type,prefix) VALUES ($1,'journal_entry','JE-'),($1,'customer_invoice','INV-') ON CONFLICT DO NOTHING`, [orgId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F305 Co','F305 Co Pvt Ltd','F305CO','INR','IN',true,'active')`, [companyId, orgId]);
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
      `INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','F305 Widget','product',$3,$4,100,60,'active')`,
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

    // Accounting foundation: real ledger + chart of accounts + journals +
    // the pre-seeded mapping vocabulary (revenue/output_tax/rounding/cogs/
    // cash/bank) every company gets for free. 'inventory' and
    // 'pos_card_clearing' are genuinely POS-specific/new — configured here
    // the same way a real finance admin would via Accounting's own generic
    // account-mapping API, proving F305 fails closed without them and
    // succeeds once they exist.
    await tx((c) => initializeAccountingCompany(c, { organizationId: orgId, companyId, userId: managerId }));
    const ledgerRow = await admin.query(`SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2`, [orgId, companyId]);
    const ledgerId = ledgerRow.rows[0].id;
    const inventoryAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1300'`, [orgId, companyId, ledgerId]);
    const clearingAccount = await admin.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND company_id=$2 AND ledger_id=$3 AND code='1190'`, [orgId, companyId, ledgerId]);
    await admin.query(
      `INSERT INTO tenant.accounting_account_mappings(organization_id,company_id,ledger_id,mapping_key,account_id,priority,status,created_by,updated_by)
       VALUES ($1,$2,$3,'inventory',$4,100,'active',$5,$5),($1,$2,$3,'pos_card_clearing',$6,100,'active',$5,$5)`,
      [orgId, companyId, ledgerId, inventoryAccount.rows[0].id, managerId, clearingAccount.rows[0].id],
    );

    await t.test("F290: generating an invoice for a walk-in sale (no customer) is rejected", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "walkin-1", payments: [{ method: "cash", amount: cart.grand_total }] }));
      await assert.rejects(
        () => tx((c) => generatePosInvoice(c, cashierContext, sale.id, {})),
        (error) => error.code === "POS_INVOICE_CUSTOMER_REQUIRED",
      );
    });

    await t.test("F290: generating an invoice for a sale with a customer succeeds, links back to the sale, and is idempotent on retry", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      cart = await tx((c) => setPosCartCustomer(c, cashierContext, cart.id, { customerId, expectedVersion: cart.version }));
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: "cash-sale-1", payments: [{ method: "cash", amount: cart.grand_total }] }));
      cashSaleId = sale.id;
      assert.equal(sale.grand_total, "100.000000");

      const created = await tx((c) => generatePosInvoice(c, cashierContext, sale.id, {}));
      assert.equal(created.invoice.status, "posted");
      assert.equal(created.invoice.grand_total, "100.000000");
      assert.equal(created.invoice.party_id, customerId);
      assert.equal(created.replayed, false);

      const saleRow = await admin.query(`SELECT accounting_invoice_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [orgId, sale.id]);
      assert.equal(saleRow.rows[0].accounting_invoice_id, created.invoice.id);

      const replayed = await tx((c) => generatePosInvoice(c, cashierContext, sale.id, {}));
      assert.equal(replayed.invoice.id, created.invoice.id);
      assert.equal(replayed.replayed, true);

      const fetched = await tx((c) => getPosInvoiceForSale(c, cashierContext, sale.id));
      assert.equal(fetched.invoice.id, created.invoice.id);
    });

    await t.test("F305: posting a completed cash sale produces a balanced, posted journal linked to the sale, and is idempotent", async () => {
      const outcome = await tx((c) => postPosSaleToAccounting(c, supervisorContext, cashSaleId));
      assert.equal(outcome.posted, true);
      assert.equal(outcome.replayed, false);
      assert.ok(outcome.journalEntryId);

      const lines = await admin.query(`SELECT debit_amount,credit_amount FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [orgId, outcome.journalEntryId]);
      let debitTotal = 0;
      let creditTotal = 0;
      for (const row of lines.rows) {
        debitTotal += Number(row.debit_amount);
        creditTotal += Number(row.credit_amount);
      }
      assert.equal(debitTotal, creditTotal);
      assert.ok(debitTotal > 0);

      const entry = await admin.query(`SELECT status FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND id=$2`, [orgId, outcome.journalEntryId]);
      assert.equal(entry.rows[0].status, "posted");

      const saleRow = await admin.query(`SELECT accounting_posting_status,journal_entry_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [orgId, cashSaleId]);
      assert.equal(saleRow.rows[0].accounting_posting_status, "posted");
      assert.equal(saleRow.rows[0].journal_entry_id, outcome.journalEntryId);

      const replay = await tx((c) => postPosSaleToAccounting(c, supervisorContext, cashSaleId));
      assert.equal(replay.replayed, true);
      assert.equal(replay.journalEntryId, outcome.journalEntryId);
    });

    await t.test("F304/F305: a card sale posts to its configured tender-clearing account and its provider reference is matched by real settlement evidence", async () => {
      let cart = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId, shiftId }));
      cart = await tx((c) => addPosCartLine(c, cashierContext, cart.id, { itemId, quantity: 1 }));
      const payment = await tx((c) => initiatePosPayment(c, cashierContext, { cartId: cart.id, method: "card", amount: 100, idempotencyKey: `init-${cart.id}`, outcome: "immediate_success" }));
      assert.equal(payment.status, "captured");
      cardPaymentReference = payment.provider_reference;
      const sale = await tx((c) => completePosCart(c, cashierContext, cart.id, { idempotencyKey: `card-sale-${cart.id}`, payments: [{ method: "card", paymentId: payment.id }] }));
      cardSaleId = sale.id;

      const outcome = await tx((c) => postPosSaleToAccounting(c, supervisorContext, sale.id));
      assert.equal(outcome.posted, true);
      const clearingLine = await admin.query(
        `SELECT line.debit_amount FROM tenant.accounting_journal_lines line WHERE line.organization_id=$1 AND line.journal_entry_id=$2 AND line.account_id=$3`,
        [orgId, outcome.journalEntryId, clearingAccount.rows[0].id],
      );
      assert.equal(Number(clearingLine.rows[0].debit_amount), 100);

      const imported = await tx((c) =>
        importPosSettlementBatch(c, supervisorContext, {
          storeId, paymentMethod: "card", providerKey: "sandbox", batchReference: `batch-${cardSaleId}`, settlementDate: new Date().toISOString().slice(0, 10),
          entries: [{ providerReference: cardPaymentReference, amount: 100, feeAmount: 2 }],
        }),
      );
      assert.equal(imported.replayed, false);
      assert.equal(imported.entries[0].match_status, "matched");

      const paymentRow = await admin.query(`SELECT settlement_status,settled_amount FROM tenant.pos_payments WHERE organization_id=$1 AND provider_reference=$2`, [orgId, cardPaymentReference]);
      assert.equal(paymentRow.rows[0].settlement_status, "settled");
      assert.equal(paymentRow.rows[0].settled_amount, "100.000000");

      const replay = await tx((c) =>
        importPosSettlementBatch(c, supervisorContext, {
          storeId, paymentMethod: "card", providerKey: "sandbox", batchReference: `batch-${cardSaleId}`, settlementDate: new Date().toISOString().slice(0, 10),
          entries: [{ providerReference: cardPaymentReference, amount: 100, feeAmount: 2 }],
        }),
      );
      assert.equal(replay.replayed, true);
    });

    await t.test("F304: an unmatched settlement entry (provider evidence with no corresponding POS payment) is flagged, not silently absorbed", async () => {
      // A different, past settlement_date than the matched batch above --
      // otherwise this orphan entry would land in the SAME store+method+
      // date scope the later day-end reconciliation test reads, turning
      // its genuinely fully-matched card row into a false variance. Two
      // independent settlement batches for the same store/method/day are
      // realistic (a provider can send more than one file per day) and
      // exactly why generatePosReconciliation scopes exceptions by that
      // full tuple, not just payment method.
      const imported = await tx((c) =>
        importPosSettlementBatch(c, supervisorContext, {
          storeId, paymentMethod: "card", providerKey: "sandbox", batchReference: `orphan-batch-${randomUUID()}`, settlementDate: "2020-01-01",
          entries: [{ providerReference: `orphan-ref-${randomUUID()}`, amount: 55 }],
        }),
      );
      assert.equal(imported.entries[0].match_status, "unmatched");
    });

    let reconciliationRows;
    await t.test("F303->F304: closing the shift short, generating and finalizing its Z report, then reconciling exposes a real cash variance and a matched card settlement", async () => {
      // Two cash sales ($100 each -- the walk-in-rejected-invoice sale and
      // the customer-attached sale) landed in this shift's till before it
      // closes, so expected cash is 200, not 100.
      const closed = await tx((c) => closeShift(c, supervisorContext, shiftId, { countedCash: 90 }));
      assert.equal(closed.status, "closed");
      assert.equal(closed.cash_variance, "-110.000000");

      const draft = await tx((c) => generatePosDayEndReport(c, supervisorContext, { storeId, scopeType: "shift", shiftId }));
      await tx((c) => reviewPosDayEndReport(c, supervisorContext, draft.id));
      const finalReport = await tx((c) => finalizePosDayEndReport(c, managerContext, draft.id));
      assert.equal(finalReport.status, "closed");
      reportId = finalReport.id;

      const reconciled = await tx((c) => generatePosReconciliation(c, supervisorContext, reportId, {}));
      reconciliationRows = reconciled.reconciliations;
      const cashRow = reconciliationRows.find((row) => row.payment_method === "cash");
      const cardRow = reconciliationRows.find((row) => row.payment_method === "card");
      assert.ok(cashRow, "expected a cash reconciliation row");
      assert.equal(cashRow.status, "variance");
      assert.equal(cashRow.variance_amount, "-110.000000");
      assert.ok(cardRow, "expected a card reconciliation row");
      assert.equal(cardRow.status, "matched");
      assert.equal(cardRow.variance_amount, "0.000000");

      const reportRow = await admin.query(`SELECT reconciliation_status FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND id=$2`, [orgId, reportId]);
      assert.equal(reportRow.rows[0].reconciliation_status, "exception");
    });

    await t.test("F304: the person who generated a reconciliation cannot resolve its own variance; a different approver can", async () => {
      const cashRow = reconciliationRows.find((row) => row.payment_method === "cash");
      await assert.rejects(
        () => tx((c) => resolvePosReconciliation(c, supervisorContext, cashRow.id, { resolutionNotes: "Self-resolve attempt" })),
        (error) => error.code === "POS_RECONCILIATION_SELF_RESOLVE_BLOCKED",
      );
      const resolved = await tx((c) => resolvePosReconciliation(c, managerContext, cashRow.id, { resolutionNotes: "Till was short by 110 at close; cashier acknowledged, no theft indicated." }));
      assert.equal(resolved.status, "resolved");
      assert.equal(resolved.resolved_by, managerId);

      const reportRow = await admin.query(`SELECT reconciliation_status FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND id=$2`, [orgId, reportId]);
      assert.equal(reportRow.rows[0].reconciliation_status, "matched");
    });

    await t.test("F305: posting a closed day-end report's remaining sales is best-effort and idempotent per sale", async () => {
      const summary = await tx((c) => postPosDayEndReportToAccounting(c, managerContext, reportId));
      // cashSaleId and cardSaleId were already posted individually above.
      assert.equal(summary.failed.length, 0);
      assert.ok(summary.alreadyPosted.some((row) => row.id === cashSaleId));
      assert.ok(summary.alreadyPosted.some((row) => row.id === cardSaleId));
    });

    await t.test("F307: analytics totals reconcile with the fixture's own known sales, tender split and accounting posting status", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const analytics = await tx((c) => getPosSalesAnalytics(c, supervisorContext, { dateFrom: today, dateTo: today, storeId }));
      assert.equal(analytics.summary.saleCount, 3);
      assert.equal(analytics.summary.grandTotal, "300.000000");
      const cashTender = analytics.tenderBreakdown.find((row) => row.payment_method === "cash");
      const cardTender = analytics.tenderBreakdown.find((row) => row.payment_method === "card");
      assert.equal(cashTender.amount, "200.000000");
      assert.equal(cardTender.amount, "100.000000");
      assert.equal(analytics.accountingPostingStatus.posted, 3);
      assert.ok(analytics.margin);
      assert.equal(analytics.margin.cogsTotal, "180.000000");
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "accounting_events",
      "accounting_journal_lines",
      "accounting_journal_entries",
      "accounting_customer_invoice_schedules",
      "accounting_customer_invoice_lines",
      "accounting_customer_invoices",
      "accounting_account_mappings",
      "accounting_settings",
      "accounting_journals",
      "accounting_accounts",
      "accounting_ledgers",
      "pos_reconciliation_corrections",
      "pos_reconciliations",
      "pos_settlement_entries",
      "pos_settlement_batches",
      "pos_day_end_report_corrections",
      "pos_day_end_reports",
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
    await admin.query(`DELETE FROM public.numbering_series WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierId, supervisorId, managerId]]).catch(() => undefined);
    await admin.end();
  }
});
