// Real PostgreSQL integration test -- the Sales order-to-cash domain: customer
// master (F031/F032), orders and confirmation (F042/F043) with the credit-limit
// check and finance override (F053), amendments (F044), approval separation
// (F041), availability/reservation/partial delivery/backorders (F045-F048),
// delivery and invoice hand-offs (F049/F050), advances (F052), returns (F054),
// credit adjustments (F055), drop-ship (F056), commissions (F057) and
// dashboards/reports (F059-F062). Runs against the real domain layer and real
// RLS; nothing is mocked.
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

test("Sales order lifecycle against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const api = await import("../../services/api/src/index.js");
  const {
    createSalesOrder,
    listSalesOrders,
    getSalesOrder,
    submitSalesOrder,
    approveSalesOrder,
    approveSalesOrderAmendment,
    confirmSalesOrderWithCrmSync,
    placeOrderHold,
    releaseOrderHold,
    amendSalesOrder,
    createFulfillmentRequest,
    createInvoiceRequest,
    cancelSalesOrderWithCrmSync,
    checkSalesOrderLineAvailability,
    reserveSalesOrderLineFromStock,
    completeFulfillmentRequestWithStockMovement,
    postStockMovement,
    createBusinessDataRecord,
    updateBusinessDataRecord,
    archiveBusinessDataRecord,
    listBusinessDataRecords,
    getSalesOptions,
    getSalesSettings,
    updateSalesSettings,
    getSalesDashboard,
    getSalesReport,
    recordSalesAdvancePayment,
    requestSalesCreditAdjustment,
    createSalesDropShipRequest,
    createSalesCommissionRule,
    accrueSalesCommission,
    createSalesReturnRequest,
    listSalesPass1Operations,
    assessSalesOrderReadiness,
    getSalesOrderGovernanceTimeline,
  } = api;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const sellerId = randomUUID();
  const approverId = randomUUID();
  const financeId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const customerId = randomUUID();
  // GST needs the buyer's state: the customer's billing address carries it.
  const billingAddressId = randomUUID();

  const base = {
    organizationId: orgId,
    activeCompanyId: companyId,
    activeBranchId: branchId,
    allowAllCompanies: false,
    roleSlugs: [],
  };
  const sellerContext = {
    ...base,
    userId: sellerId,
    permissions: ["sales.view", "sales.order.create", "sales.order.confirm", "sales.order.hold", "sales.order.cancel", "sales.order.amend", "sales.fulfillment.request", "sales.invoice.request", "sales.price.override", "sales.margin.view"],
  };
  const approverContext = { ...base, userId: approverId, permissions: ["sales.view", "sales.order.approve", "sales.order.confirm"] };
  const financeContext = { ...sellerContext, userId: financeId, permissions: [...sellerContext.permissions, "sales.credit.override"] };
  const settingsContext = { ...sellerContext, userId: approverId, permissions: [...sellerContext.permissions, "sales.settings.manage"] };
  const supplierId = randomUUID();
  const viewerContext = { ...base, userId: sellerId, permissions: ["sales.view"] };

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

  const document = (quantity = 2) => ({
    partyId: customerId,
    billingAddressId,
    currencyCode: "INR",
    priceListId,
    lines: [{ itemId, quantity }],
  });
  const orderRow = (id) => admin.query(`SELECT lifecycle_status,credit_status,approval_status,current_version_id,fulfillment_status,billing_status FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [orgId, id]).then((r) => r.rows[0]);

  // Get an order all the way to `approved`, whichever way the approval policy
  // routes it: some orders need a second person, some do not.
  async function approvedOrder(quantity = 2) {
    const order = await tx((c) => createSalesOrder(c, sellerContext, document(quantity)));
    const submitted = await tx((c) => submitSalesOrder(c, sellerContext, order.id));
    if (submitted.approvalRequired) {
      const row = await orderRow(order.id);
      await tx((c) => approveSalesOrder(c, approverContext, order.id, row.current_version_id));
    }
    return order;
  }

  const getSalesOrderTotal = (id) => admin.query(`SELECT v.grand_total FROM tenant.sales_orders o JOIN tenant.sales_order_versions v ON v.id=o.current_version_id WHERE o.organization_id=$1 AND o.id=$2`, [orgId, id]).then((r) => r.rows[0].grand_total);

  try {
    for (const [id, name] of [[sellerId, "Rep"], [approverId, "Approver"], [financeId, "Finance"]]) {
      await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `so-${id}@test.invalid`, name]);
    }
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'SO Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `so-org-${orgId}`, sellerId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'SO Co','SO Co Pvt Ltd','SOCO','INR','IN',true,'active')`, [companyId, orgId]);
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    for (const id of [sellerId, approverId, financeId]) {
      await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    }
    for (const [entity, prefix] of [["quotation", "QUO-"], ["sales_order", "SO-"], ["sales_fulfillment_request", "FUL-"], ["sales_invoice_request", "SIR-"]]) {
      await admin.query(`INSERT INTO public.numbering_series(organization_id,entity_type,prefix) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [orgId, entity, prefix]);
    }
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`, [randomUUID(), orgId, taxCategoryId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await admin.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`, [priceListId, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Widget','product',$3,$4,100,60,'active')`, [itemId, orgId, uomId, taxCategoryId]);
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Acme Retail','active',$4)`, [customerId, orgId, companyId, sellerId]);
    await admin.query(`INSERT INTO tenant.addresses(id,organization_id,party_id,address_type,line1,city,state,state_code,postal_code,country_code,is_primary) VALUES ($1,$2,$3,'billing','1 MG Road','Bengaluru','Karnataka','KA','560001','IN',true)`, [billingAddressId, orgId, customerId]);

    await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'SUP1','supplier','Acme Supplies','active',$4)`, [supplierId, orgId, companyId, sellerId]);

    await t.test("F042: create a draft order; totals are server-computed (2 x 100 + 18% GST = 236)", async () => {
      const order = await tx((c) => createSalesOrder(c, sellerContext, document()));
      assert.match(order.sales_order_number, /^SO-/);
      const row = await orderRow(order.id);
      assert.equal(row.lifecycle_status, "draft");
      const version = await admin.query(`SELECT grand_total FROM tenant.sales_order_versions WHERE organization_id=$1 AND sales_order_id=$2`, [orgId, order.id]);
      assert.equal(Number(version.rows[0].grand_total), 236);
    });

    await t.test("permissions: a viewer cannot create an order", async () => {
      await assert.rejects(() => tx((c) => createSalesOrder(c, viewerContext, document())), (e) => /permission/i.test(e.message) || e.code === "FORBIDDEN");
    });

    await t.test("F043: list and detail expose the order with its lines and empty holds", async () => {
      const rows = await tx((c) => listSalesOrders(c, sellerContext, {}));
      assert.ok(rows.length >= 1);
      const searched = await tx((c) => listSalesOrders(c, sellerContext, { search: "Acme" }));
      assert.ok(searched.length >= 1, "search by customer name");
      const none = await tx((c) => listSalesOrders(c, sellerContext, { search: "no-such-customer-zzz" }));
      assert.equal(none.length, 0);
      const detail = await tx((c) => getSalesOrder(c, sellerContext, rows[0].id));
      assert.equal(detail.lines.length, 1);
      assert.deepEqual(detail.holds, []);
    });

    let confirmed;
    await t.test("F043: submit -> (approve) -> confirm; the confirmation is a state change with an audit event", async () => {
      confirmed = await approvedOrder();
      const result = await tx((c) => confirmSalesOrderWithCrmSync(c, sellerContext, confirmed.id, {}));
      assert.equal(result.status, "confirmed");
      assert.equal((await orderRow(confirmed.id)).lifecycle_status, "confirmed");
      const events = await admin.query(`SELECT event_type FROM tenant.sales_document_events WHERE organization_id=$1 AND entity_type='sales_order' AND entity_id=$2`, [orgId, confirmed.id]);
      assert.ok(events.rows.some((r) => r.event_type === "sales_order.confirmed"));
    });

    await t.test("F041: an unconfirmed (draft) order cannot skip the approval gate by calling approve as its author", async () => {
      const order = await tx((c) => createSalesOrder(c, sellerContext, document()));
      await assert.rejects(() => tx((c) => approveSalesOrder(c, sellerContext, order.id, (order.current_version_id ?? randomUUID()))), (e) => /permission/i.test(e.message) || e.code === "FORBIDDEN");
    });

    await t.test("F041-SEM-04: whoever submits an order for approval cannot approve it, even holding the approve permission", async () => {
      await admin.query(`UPDATE tenant.sales_settings SET order_approval_amount=1 WHERE organization_id=$1`, [orgId]);
      try {
        const both = { ...base, userId: sellerId, permissions: [...sellerContext.permissions, "sales.order.approve"] };
        const order = await tx((c) => createSalesOrder(c, both, document()));
        const submitted = await tx((c) => submitSalesOrder(c, both, order.id));
        assert.equal(submitted.approvalRequired, true);
        const row = await orderRow(order.id);
        await assert.rejects(() => tx((c) => approveSalesOrder(c, both, order.id, row.current_version_id)), (e) => e.code === "SALES_SELF_APPROVAL_BLOCKED");
        assert.equal((await orderRow(order.id)).lifecycle_status, "pending_approval", "the refused approval changed nothing");
        await tx((c) => approveSalesOrder(c, approverContext, order.id, row.current_version_id));
        assert.equal((await orderRow(order.id)).lifecycle_status, "approved", "a different approver can");
      } finally {
        await admin.query(`UPDATE tenant.sales_settings SET order_approval_amount=0 WHERE organization_id=$1`, [orgId]);
      }
    });

    await t.test("F053: credit limit exceeded blocks confirmation; only a finance override with a reason passes", async () => {
      await admin.query(`UPDATE tenant.business_parties SET credit_limit=100 WHERE organization_id=$1 AND id=$2`, [orgId, customerId]);
      const order = await approvedOrder(); // exposure: existing confirmed 236 + this 236 > 100
      await assert.rejects(() => tx((c) => confirmSalesOrderWithCrmSync(c, sellerContext, order.id, {})), (e) => e.code === "SALES_CREDIT_BLOCK");
      assert.equal((await orderRow(order.id)).lifecycle_status, "approved", "a blocked confirmation changes nothing");
      // asking for an override without holding the override permission is refused
      await assert.rejects(() => tx((c) => confirmSalesOrderWithCrmSync(c, sellerContext, order.id, { overrideCredit: true, creditOverrideReason: "trusted" })), (e) => /permission/i.test(e.message) || e.code === "FORBIDDEN");
      // holding it but giving no reason is refused too
      await assert.rejects(() => tx((c) => confirmSalesOrderWithCrmSync(c, financeContext, order.id, { overrideCredit: true })), (e) => /reason/i.test(e.message));
      const result = await tx((c) => confirmSalesOrderWithCrmSync(c, financeContext, order.id, { overrideCredit: true, creditOverrideReason: "Prepayment received" }));
      assert.equal(result.creditStatus, "overridden");
      assert.equal((await orderRow(order.id)).credit_status, "overridden");
      await admin.query(`UPDATE tenant.business_parties SET credit_limit=0 WHERE organization_id=$1 AND id=$2`, [orgId, customerId]);
    });

    await t.test("F043: a hold needs a reason, blocks the order, and releasing it restores confirmed", async () => {
      await assert.rejects(() => tx((c) => placeOrderHold(c, sellerContext, confirmed.id, { holdType: "other", reason: "" })), (e) => /reason/i.test(e.message));
      const hold = await tx((c) => placeOrderHold(c, sellerContext, confirmed.id, { holdType: "credit", reason: "Awaiting payment" }));
      assert.equal((await orderRow(confirmed.id)).lifecycle_status, "on_hold");
      await assert.rejects(() => tx((c) => createFulfillmentRequest(c, sellerContext, confirmed.id, `hold-${randomUUID()}`)), (e) => e.status === 409);
      await tx((c) => releaseOrderHold(c, sellerContext, confirmed.id, { holdId: hold.id, note: "Paid" }));
      assert.equal((await orderRow(confirmed.id)).lifecycle_status, "confirmed");
      await assert.rejects(() => tx((c) => releaseOrderHold(c, sellerContext, confirmed.id, { holdId: hold.id })), (e) => e.status === 404, "releasing twice is refused");
    });

    await t.test("F044: amending a confirmed order needs a reason, creates version 2 in approval, and only a different approver applies it", async () => {
      await assert.rejects(() => tx((c) => amendSalesOrder(c, sellerContext, confirmed.id, { ...document(3) })), (e) => /reason/i.test(e.message));
      await tx((c) => amendSalesOrder(c, sellerContext, confirmed.id, { ...document(3), amendmentReason: "Customer wants 3" }));
      const pending = await orderRow(confirmed.id);
      assert.equal(pending.lifecycle_status, "pending_approval");
      const versions = await admin.query(`SELECT id,version_number,grand_total FROM tenant.sales_order_versions WHERE organization_id=$1 AND sales_order_id=$2 ORDER BY version_number`, [orgId, confirmed.id]);
      assert.equal(versions.rows.length, 2);
      assert.equal(Number(versions.rows[0].grand_total), 236, "v1 is preserved");
      assert.equal(Number(versions.rows[1].grand_total), 354);
      await assert.rejects(() => tx((c) => approveSalesOrderAmendment(c, sellerContext, confirmed.id, pending.current_version_id, versions.rows[0].id, "confirmed")), (e) => /permission/i.test(e.message) || e.code === "FORBIDDEN");
      await tx((c) => approveSalesOrderAmendment(c, approverContext, confirmed.id, pending.current_version_id, versions.rows[0].id, "confirmed"));
      assert.equal((await orderRow(confirmed.id)).lifecycle_status, "confirmed");
      // Approving directly from the order screen also closes the shared approval request.
      const shared = await admin.query(
        `SELECT status, decided_by FROM public.approval_requests WHERE organization_id=$1 AND command_key='sales.order.amendment.approve' AND entity_id=$2`,
        [orgId, confirmed.id],
      );
      assert.deepEqual(shared.rows, [{ status: "approved", decided_by: approverContext.userId }]);
    });

    await t.test("F049/F050: fulfilment and invoice requests are idempotent on their key", async () => {
      const key = `ful-${randomUUID()}`;
      const first = await tx((c) => createFulfillmentRequest(c, sellerContext, confirmed.id, key));
      const second = await tx((c) => createFulfillmentRequest(c, sellerContext, confirmed.id, key));
      assert.equal(second.id, first.id);
      assert.equal(second.idempotent, true);
      await assert.rejects(() => tx((c) => createFulfillmentRequest(c, sellerContext, confirmed.id, "")), (e) => /idempotency/i.test(e.message));
      const invKey = `inv-${randomUUID()}`;
      const inv1 = await tx((c) => createInvoiceRequest(c, sellerContext, confirmed.id, { idempotencyKey: invKey, quantityBasis: "ordered" }));
      const inv2 = await tx((c) => createInvoiceRequest(c, sellerContext, confirmed.id, { idempotencyKey: invKey, quantityBasis: "ordered" }));
      assert.equal(inv2.id, inv1.id);
      await assert.rejects(() => tx((c) => createInvoiceRequest(c, sellerContext, confirmed.id, { idempotencyKey: `x-${randomUUID()}`, quantityBasis: "bogus" })), (e) => /basis/i.test(e.message));
    });

    await t.test("governance: readiness and timeline read the order's real history", async () => {
      const readiness = await tx((c) => assessSalesOrderReadiness(c, sellerContext, confirmed.id));
      assert.equal(readiness.orderId, confirmed.id);
      assert.ok(readiness.health);
      const timeline = await tx((c) => getSalesOrderGovernanceTimeline(c, sellerContext, confirmed.id));
      assert.ok(timeline);
    });

    await t.test("F052: advance payments are capped at the order total and need a reference", async () => {
      const total = Number((await getSalesOrderTotal(confirmed.id)));
      assert.equal(total, 354, "the amended order total (3 x 100 + 18% GST)");
      const first = await tx((c) => recordSalesAdvancePayment(c, sellerContext, { salesOrderId: confirmed.id, amount: 100, paymentReference: "UTR-1001" }));
      assert.equal(Number(first.amount), 100);
      await assert.rejects(() => tx((c) => recordSalesAdvancePayment(c, sellerContext, { salesOrderId: confirmed.id, amount: 300, paymentReference: "UTR-1002" })), (e) => e.code === "SALES_ADVANCE_EXCEEDS_ORDER");
      await assert.rejects(() => tx((c) => recordSalesAdvancePayment(c, sellerContext, { salesOrderId: confirmed.id, amount: 10, paymentReference: "" })), (e) => e.code === "SALES_ADVANCE_REFERENCE_REQUIRED");
      await assert.rejects(() => tx((c) => recordSalesAdvancePayment(c, viewerContext, { salesOrderId: confirmed.id, amount: 10, paymentReference: "X" })), (e) => /permission/i.test(e.message));
      const rows = await tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "advances" }));
      assert.ok(rows.some((r) => r.payment_reference === "UTR-1001"));
    });

    await t.test("F055: credit notes and refunds need a valid type, a reason, and cannot exceed the order", async () => {
      await assert.rejects(() => tx((c) => requestSalesCreditAdjustment(c, sellerContext, { salesOrderId: confirmed.id, adjustmentType: "gift", amount: 5, reason: "x" })), (e) => e.code === "SALES_ADJUSTMENT_TYPE_INVALID");
      await assert.rejects(() => tx((c) => requestSalesCreditAdjustment(c, sellerContext, { salesOrderId: confirmed.id, adjustmentType: "refund", amount: 99999, reason: "x" })), (e) => /^SALES_ADJUSTMENT_EXCEEDS_/.test(e.code));
      await assert.rejects(() => tx((c) => requestSalesCreditAdjustment(c, sellerContext, { salesOrderId: confirmed.id, adjustmentType: "refund", amount: 5, reason: "" })), (e) => e.code === "SALES_ADJUSTMENT_REASON_REQUIRED");
      // A credit note needs an invoice to credit; a refund is capped by what was paid (the F052 advance).
      await assert.rejects(() => tx((c) => requestSalesCreditAdjustment(c, sellerContext, { salesOrderId: confirmed.id, adjustmentType: "credit_note", amount: 100, reason: "Damaged goods" })), (e) => e.code === "SALES_ADJUSTMENT_NOTHING_INVOICED");
      const ok = await tx((c) => requestSalesCreditAdjustment(c, sellerContext, { salesOrderId: confirmed.id, adjustmentType: "refund", amount: 50, reason: "Damaged goods" }));
      assert.equal(ok.status, "pending");
      assert.ok((await tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "adjustments" }))).some((r) => r.id === ok.id));
    });

    await t.test("F056: a drop-ship request is bounded by the line quantity and idempotent on its key", async () => {
      const line = (await admin.query(`SELECT line.id FROM tenant.sales_order_lines line JOIN tenant.sales_orders o ON o.current_version_id=line.sales_order_version_id WHERE o.organization_id=$1 AND o.id=$2`, [orgId, confirmed.id])).rows[0];
      const input = { salesOrderId: confirmed.id, salesOrderLineId: line.id, supplierId, quantity: 1, idempotencyKey: `drop-${randomUUID()}` };
      await assert.rejects(() => tx((c) => createSalesDropShipRequest(c, sellerContext, { ...input, quantity: 99 })), (e) => e.code === "SALES_DROP_SHIP_QUANTITY_INVALID");
      const first = await tx((c) => createSalesDropShipRequest(c, sellerContext, input));
      const replay = await tx((c) => createSalesDropShipRequest(c, sellerContext, input));
      assert.equal(replay.id, first.id);
    });

    await t.test("F057: commission rules need settings permission; accrual is net-of-tax basis x rate and idempotent", async () => {
      await assert.rejects(() => tx((c) => createSalesCommissionRule(c, sellerContext, { name: "Std", ratePercent: 10 })), (e) => /permission/i.test(e.message));
      await assert.rejects(() => tx((c) => createSalesCommissionRule(c, settingsContext, { name: "Bad", ratePercent: 150 })), (e) => e.code === "SALES_COMMISSION_RATE_INVALID");
      const rule = await tx((c) => createSalesCommissionRule(c, settingsContext, { name: "Std 10%", ratePercent: 10, basis: "net_sales" }));
      const first = await tx((c) => accrueSalesCommission(c, settingsContext, { salesOrderId: confirmed.id, ruleId: rule.id, ownerUserId: sellerId }));
      assert.equal(Number(first.commission_amount), 30, "10% of the 300 net subtotal");
      const again = await tx((c) => accrueSalesCommission(c, settingsContext, { salesOrderId: confirmed.id, ruleId: rule.id, ownerUserId: sellerId }));
      assert.equal(again.id, first.id, "re-accruing updates the same entry rather than double-paying");
    });

    await t.test("F054: returns are limited to fulfilled quantity, idempotent, and listed in the register", async () => {
      const line = (await admin.query(`SELECT line.id FROM tenant.sales_order_lines line JOIN tenant.sales_orders o ON o.current_version_id=line.sales_order_version_id WHERE o.organization_id=$1 AND o.id=$2`, [orgId, confirmed.id])).rows[0];
      const key = `return-${randomUUID()}`;
      const input = { idempotencyKey: key, reason: "Wrong colour", lines: [{ salesOrderLineId: line.id, quantity: 2 }] };
      await assert.rejects(() => tx((c) => createSalesReturnRequest(c, sellerContext, confirmed.id, input)), (e) => e.code === "SALES_RETURN_EXCEEDS_FULFILLED");
      // fulfilment completion needs Stock; here the line is simply marked shipped so the return rule itself is what is tested
      await admin.query("BEGIN");
      await setTenantContext(admin, orgId);
      await admin.query(`UPDATE tenant.sales_order_line_progress SET fulfilled_quantity=3 WHERE organization_id=$1 AND sales_order_line_id=$2`, [orgId, line.id]);
      await admin.query("COMMIT");
      await assert.rejects(() => tx((c) => createSalesReturnRequest(c, sellerContext, confirmed.id, { ...input, reason: "" })), (e) => e.code === "SALES_RETURN_REASON_REQUIRED");
      const created = await tx((c) => createSalesReturnRequest(c, sellerContext, confirmed.id, input));
      assert.equal(created.idempotent, false);
      const replay = await tx((c) => createSalesReturnRequest(c, sellerContext, confirmed.id, input));
      assert.equal(replay.id, created.id);
      const rows = await tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "returns" }));
      assert.ok(rows.some((r) => r.id === created.id && r.sales_order_number && r.customer_name === "Acme Retail"));
    });

    await t.test("registers: deliveries and invoice requests carry order number and customer", async () => {
      for (const kind of ["fulfillment-requests", "invoice-requests"]) {
        const rows = await tx((c) => listSalesPass1Operations(c, sellerContext, { kind }));
        assert.ok(rows.length >= 1, kind);
        assert.ok(rows.every((r) => r.sales_order_number && r.customer_name), `${kind} rows are joined to their order`);
      }
      await assert.rejects(() => tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "not-a-register" })), (e) => e.status === 404);
    });

    await t.test("F059-F062: dashboard and every report read real data; margin needs its own permission; unknown reports are refused", async () => {
      const dashboard = await tx((c) => getSalesDashboard(c, sellerContext));
      assert.ok(Number(dashboard.confirmed_order_value) > 0, "confirmed orders count towards value");
      const reporter = { ...sellerContext, permissions: [...sellerContext.permissions, "sales.reports.view"] };
      for (const key of ["quotation-conversion", "order-intake", "expiring-quotations", "pending-approvals", "active-holds", "fulfillment", "billing-readiness", "customer-performance"]) {
        const rows = await tx((c) => getSalesReport(c, reporter, key));
        assert.ok(Array.isArray(rows), key);
      }
      const intake = await tx((c) => getSalesReport(c, reporter, "order-intake"));
      assert.ok(intake.length >= 1 && Number(intake[0].base_total) > 0);
      await assert.rejects(() => tx((c) => getSalesReport(c, sellerContext, "order-intake")), (e) => /permission/i.test(e.message), "reports need sales.reports.view");
      const noMargin = { ...reporter, permissions: reporter.permissions.filter((x) => x !== "sales.margin.view") };
      await assert.rejects(() => tx((c) => getSalesReport(c, noMargin, "margin")), (e) => /permission/i.test(e.message));
      const margin = await tx((c) => getSalesReport(c, reporter, "margin"));
      assert.ok(margin.length >= 1 && margin[0].margin_percent !== undefined);
      await assert.rejects(() => tx((c) => getSalesReport(c, reporter, "nope")), (e) => e.status === 404);
    });

    await t.test("F045-F048: availability, reservation, partial delivery issuing real stock, and the backorder it leaves", async () => {
      const warehouseId = randomUUID();
      const stockItemId = randomUUID();
      await admin.query("BEGIN");
      await setTenantContext(admin, orgId);
      await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main','active')`, [warehouseId, orgId, companyId, branchId]);
      await admin.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status,track_inventory) VALUES ($1,$2,'STK1','Stocked Widget','product',$3,$4,100,60,'active',true)`, [stockItemId, orgId, uomId, taxCategoryId]);
      await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, stockItemId]);
      await admin.query("COMMIT");
      const stockCtx = { organizationId: orgId, companyId, userId: sellerId, roleSlugs: [], permissions: ["stock.view", "stock.reserve", "stock.issue", "stock.receive"] };
      await tx((c) => postStockMovement(c, stockCtx, { movementType: "receipt", itemId: stockItemId, warehouseId, quantity: 10, unitCost: 60, idempotencyKey: `rcpt-${randomUUID()}` }));

      const order = await tx((c) => createSalesOrder(c, sellerContext, { ...document(), lines: [{ itemId: stockItemId, quantity: 4, warehouseId }] }));
      const submitted = await tx((c) => submitSalesOrder(c, sellerContext, order.id));
      if (submitted.approvalRequired) {
        const pending = await orderRow(order.id);
        await tx((c) => approveSalesOrder(c, approverContext, order.id, pending.current_version_id));
      }
      await tx((c) => confirmSalesOrderWithCrmSync(c, sellerContext, order.id, {}));
      const line = (await admin.query(`SELECT line.id FROM tenant.sales_order_lines line JOIN tenant.sales_orders o ON o.current_version_id=line.sales_order_version_id WHERE o.organization_id=$1 AND o.id=$2`, [orgId, order.id])).rows[0];

      const checked = await tx((c) => checkSalesOrderLineAvailability(c, sellerContext, stockCtx, { salesOrderId: order.id, salesOrderLineId: line.id }));
      assert.equal(checked.availability.canPromise, true);
      await assert.rejects(() => tx((c) => reserveSalesOrderLineFromStock(c, sellerContext, stockCtx, { salesOrderId: order.id, salesOrderLineId: line.id, quantity: 9 })), (e) => e.code === "SALES_RESERVATION_EXCEEDS_CONFIRMED");
      const key = `resv-${randomUUID()}`;
      await tx((c) => reserveSalesOrderLineFromStock(c, sellerContext, stockCtx, { salesOrderId: order.id, salesOrderLineId: line.id, idempotencyKey: key }));
      await tx((c) => reserveSalesOrderLineFromStock(c, sellerContext, stockCtx, { salesOrderId: order.id, salesOrderLineId: line.id, idempotencyKey: key }));
      const balance = () => admin.query(`SELECT quantity,reserved_quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [orgId, stockItemId, warehouseId]).then((r) => r.rows[0]);
      assert.equal(Number((await balance()).reserved_quantity), 4, "reserved once, not twice");

      const first = await tx((c) => createFulfillmentRequest(c, sellerContext, order.id, `ful-${randomUUID()}`));
      await assert.rejects(() => tx((c) => completeFulfillmentRequestWithStockMovement(c, sellerContext, stockCtx, first.id, { lines: [{ salesOrderLineId: line.id, fulfilledQuantity: 5 }] })), (e) => /exceeds the remaining confirmed quantity/i.test(e.message));
      assert.equal(Number((await balance()).quantity), 10, "a refused delivery issues nothing");
      await tx((c) => completeFulfillmentRequestWithStockMovement(c, sellerContext, stockCtx, first.id, { lines: [{ salesOrderLineId: line.id, fulfilledQuantity: 3 }] }));
      assert.equal(Number((await balance()).quantity), 7, "3 units left the warehouse");
      assert.equal((await orderRow(order.id)).fulfillment_status, "partially_fulfilled");

      const backorders = await tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "backorders" }));
      const owed = backorders.find((row) => row.sales_order_id === order.id);
      assert.ok(owed, "the shortfall shows as a backorder");
      assert.equal(Number(owed.backordered_quantity), 1);

      await assert.rejects(() => tx((c) => cancelSalesOrderWithCrmSync(c, sellerContext, order.id, "too late")), (e) => e.status === 409, "an order with deliveries cannot be cancelled");

      const second = await tx((c) => createFulfillmentRequest(c, sellerContext, order.id, `ful-${randomUUID()}`));
      await tx((c) => completeFulfillmentRequestWithStockMovement(c, sellerContext, stockCtx, second.id, { lines: [{ salesOrderLineId: line.id, fulfilledQuantity: 1 }] }));
      assert.equal((await orderRow(order.id)).fulfillment_status, "fulfilled");
      assert.equal(Number((await balance()).quantity), 6);
      const after = await tx((c) => listSalesPass1Operations(c, sellerContext, { kind: "backorders" }));
      assert.ok(!after.some((row) => row.sales_order_id === order.id), "fully delivered orders leave the backorder register");
    });

    await t.test("F031-F032: customer master -- create, add contact and address, edit, archive; an archived customer cannot be sold to", async () => {
      const master = { ...sellerContext, permissions: [...sellerContext.permissions, "parties.manage", "business_data.view"] };
      const customer = await tx((c) => createBusinessDataRecord(c, master, "parties", { code: "CUST-M1", partyType: "customer", status: "active", displayName: "Master Test Co", currencyCode: "INR", creditLimit: 5000 }));
      assert.equal(customer.displayName, "Master Test Co");
      assert.equal(customer.companyId, companyId, "a company-scoped user's customer lands in their active company");
      await tx((c) => createBusinessDataRecord(c, master, "contacts", { partyId: customer.id, status: "active", firstName: "Asha", lastName: "Rao", email: "asha@example.com", designation: "Buyer", isPrimary: true }));
      await tx((c) => createBusinessDataRecord(c, master, "addresses", { partyId: customer.id, status: "active", addressType: "billing", line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", stateCode: "KA", postalCode: "560001", countryCode: "IN", isPrimary: true }));
      const options = await tx((c) => getSalesOptions(c, sellerContext, null, customer.id));
      const contact = options.contacts.find((x) => x.party_id === customer.id);
      const address = options.addresses.find((x) => x.party_id === customer.id);
      assert.equal(contact.designation, "Buyer", "contact detail needed for editing is exposed");
      assert.equal(address.postal_code, "560001");
      assert.equal(address.country_code, "IN");

      await tx((c) => updateBusinessDataRecord(c, master, "parties", customer.id, { displayName: "Master Test Co Ltd" }));
      const listed = await tx((c) => listBusinessDataRecords(c, master, "parties", { search: "Master Test" }));
      assert.ok(listed.rows.some((row) => row.displayName === "Master Test Co Ltd"));

      // an order can be raised for the active customer...
      const order = await tx((c) => createSalesOrder(c, sellerContext, { ...document(), partyId: customer.id, billingAddressId: address.id }));
      assert.ok(order.id);
      // ...but not once it is archived
      await tx((c) => archiveBusinessDataRecord(c, master, "parties", customer.id));
      await assert.rejects(() => tx((c) => createSalesOrder(c, sellerContext, { ...document(), partyId: customer.id, billingAddressId: address.id })), (e) => e.status >= 400 && e.status < 500);
      const after = await tx((c) => getSalesOptions(c, sellerContext));
      assert.ok(!after.parties.some((party) => party.id === customer.id), "archived customers drop out of the selling pick-lists");
    });

    await t.test("F041/F043: settings need the settings permission, are validated, and actually change behaviour", async () => {
      const manage = { ...sellerContext, permissions: [...sellerContext.permissions, "sales.settings.manage"] };
      await assert.rejects(() => tx((c) => updateSalesSettings(c, sellerContext, { orderApprovalAmount: 1 })), (e) => /permission/i.test(e.message));
      await assert.rejects(() => tx((c) => updateSalesSettings(c, manage, { quotationApprovalDiscount: 150 })), (e) => e.code === "SALES_SETTINGS_INVALID");
      await assert.rejects(() => tx((c) => updateSalesSettings(c, manage, { invoiceQuantityBasis: "whenever" })), (e) => e.code === "SALES_SETTINGS_INVALID");
      const before = await tx((c) => getSalesSettings(c, sellerContext));
      try {
        const saved = await tx((c) => updateSalesSettings(c, manage, { orderApprovalAmount: 1, defaultQuoteValidityDays: 45, allowDirectOrders: false, invoiceQuantityBasis: "fulfilled" }));
        assert.equal(Number(saved.order_approval_amount), 1);
        assert.equal(saved.default_quote_validity_days, 45);
        await assert.rejects(() => tx((c) => createSalesOrder(c, sellerContext, document())), (e) => e.code === "SALES_DIRECT_ORDERS_DISABLED");
        const opts = await tx((c) => getSalesOptions(c, sellerContext));
        assert.equal(opts.settings.default_quote_validity_days, 45);
        assert.equal(opts.settings.allow_direct_orders, false);
      } finally {
        await tx((c) => updateSalesSettings(c, manage, { orderApprovalAmount: Number(before.order_approval_amount), defaultQuoteValidityDays: before.default_quote_validity_days, allowDirectOrders: before.allow_direct_orders, invoiceQuantityBasis: before.invoice_quantity_basis }));
      }
      assert.equal((await tx((c) => getSalesSettings(c, sellerContext))).allow_direct_orders, true, "restored");
    });

    await t.test("cancellation: needs a reason; refused on an order that has moved into fulfilment/invoicing paths only when quantities moved; a fresh confirmed order cancels", async () => {
      const order = await approvedOrder();
      await tx((c) => confirmSalesOrderWithCrmSync(c, sellerContext, order.id, {}));
      await assert.rejects(() => tx((c) => cancelSalesOrderWithCrmSync(c, sellerContext, order.id, "")), (e) => /reason/i.test(e.message));
      await tx((c) => cancelSalesOrderWithCrmSync(c, sellerContext, order.id, "Customer withdrew"));
      assert.equal((await orderRow(order.id)).lifecycle_status, "cancelled");
      await assert.rejects(() => tx((c) => cancelSalesOrderWithCrmSync(c, sellerContext, order.id, "again")), (e) => e.status === 409, "cancelling twice is refused");
    });
  } finally {
    await admin.end();
  }
});
