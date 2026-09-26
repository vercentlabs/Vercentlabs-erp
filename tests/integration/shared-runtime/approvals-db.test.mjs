// Approvals: platform lifecycle + orchestration inbox + business-module
// authority, against real PostgreSQL. Accounting journals and Sales orders are
// covered here; POS discounts in pos-cart-tax-promotions-coupons-f277-f281.test.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApprovalRequest } from "../../../services/api/src/core/platform/approvals/index.js";
import { decideApproval, listApprovalInbox } from "../../../services/api/src/orchestration/approvals/inbox.js";
import { ALL_ACCOUNTING, buildAccountingWorld, connectAdmin } from "../accounting-test-kit.mjs";
import { requireDatabase } from "./runtime-kit.mjs";

const expectCode = (code) => (error) => {
  assert.equal(error.code, code, `${error.status} ${error.code}: ${error.message}`);
  return true;
};

test("approvals: accounting journals through the inbox and the module's own screen", async (t) => {
  requireDatabase();
  const admin = await connectAdmin();
  const w = await buildAccountingWorld(admin, {
    requester: ALL_ACCOUNTING,
    approver: ALL_ACCOUNTING,
    viewer: ["accounting.view"],
    manager: ["accounting.view", "approvals.manage"],
  }, "rtap");
  const { api, run, sql, companyId, orgId } = w;
  const MODULES = { accessibleModules: ["accounting"] };
  const session = (who) => ({ ...w.ctx[who], activeBranchId: w.branchId });
  const inbox = (who, status = "pending", options = MODULES) => w.tx((c) => listApprovalInbox(c, session(who), { status, ...options }));
  const decide = (who, id, body, options = MODULES) => w.tx((c) => decideApproval(c, session(who), id, body, options));
  const shared = async (id) => (await admin.query(`SELECT status, decided_by, version, decision_note FROM public.approval_requests WHERE id=$1`, [id])).rows[0];
  const journalStatus = async (id) => (await sql(`SELECT status FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND id=$2`, [orgId, id]))[0].status;

  async function submittedJournal(amount = 100) {
    const cash = await w.account("1110");
    const capital = await w.account("3100");
    const journal = (await sql(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 AND code='GEN'`, [orgId, companyId]))[0];
    await sql(`UPDATE tenant.accounting_journals SET approval_required=true WHERE organization_id=$1 AND id=$2`, [orgId, journal.id]);
    const { entry } = await run("requester", (c, x) => api.createJournalEntry(c, x, { companyId, journalId: journal.id, accountingDate: w.today, description: `RT ${randomUUID().slice(0, 6)}`, lines: [{ accountId: cash.id, debit: amount }, { accountId: capital.id, credit: amount }] }));
    const submitted = await run("requester", (c, x) => api.submitJournalEntry(c, x, entry.id));
    assert.equal(submitted.status, "pending_approval");
    return { entryId: entry.id, requestId: submitted.approvalRequest.id };
  }

  try {
    const first = await submittedJournal();

    await t.test("visibility: requester and business approvers see it; others do not; oversight sees without authority", async () => {
      const own = (await inbox("requester")).find((row) => row.id === first.requestId);
      assert.ok(own);
      assert.equal(own.canApprove, false, "a requester never approves their own request");
      assert.equal(own.canCancel, true);
      const approverRow = (await inbox("approver")).find((row) => row.id === first.requestId);
      assert.equal(approverRow.canApprove, true);
      assert.equal(approverRow.canReject, true);
      assert.equal(approverRow.href, "/accounting/journals");
      assert.equal(approverRow.label, "Journal approval");
      assert.ok(!(await inbox("viewer")).some((row) => row.id === first.requestId), "an unrelated user cannot see it");
      const oversight = (await inbox("manager")).find((row) => row.id === first.requestId);
      assert.ok(oversight, "approvals.manage sees organisation requests");
      assert.equal(oversight.canApprove, false, "oversight is not business approval authority");
      assert.equal(oversight.canCancel, true);
      const noModule = (await inbox("approver", "pending", { accessibleModules: [] })).find((row) => row.id === first.requestId);
      assert.equal(noModule.href, null);
      assert.equal(noModule.canApprove, false);
      assert.match(noModule.documentLabel, /^Approval in /, "details are hidden without module access");
    });

    await t.test("SoD, business permission and module access are enforced; a failed decision stays pending", async () => {
      await assert.rejects(decide("requester", first.requestId, { decision: "approved" }), expectCode("SELF_APPROVAL_DENIED"));
      await assert.rejects(decide("manager", first.requestId, { decision: "approved" }), (e) => e.status === 403);
      await assert.rejects(decide("approver", first.requestId, { decision: "approved" }, { accessibleModules: [] }), expectCode("APPROVAL_MODULE_UNAVAILABLE"));
      await assert.rejects(decide("viewer", first.requestId, { decision: "approved" }), expectCode("APPROVAL_NOT_FOUND"));
      await assert.rejects(decide("approver", first.requestId, { decision: "approved", expectedVersion: 99 }), expectCode("APPROVAL_VERSION_CONFLICT"));
      assert.equal((await shared(first.requestId)).status, "pending");
      assert.equal(await journalStatus(first.entryId), "pending_approval");
    });

    await t.test("a failing business transition never marks the shared request approved", async () => {
      await sql(`UPDATE tenant.accounting_journal_entries SET content_hash='tampered' WHERE organization_id=$1 AND id=$2`, [orgId, first.entryId]);
      await assert.rejects(decide("approver", first.requestId, { decision: "approved" }), (e) => e.status === 409);
      assert.equal((await shared(first.requestId)).status, "pending");
    });

    await t.test("approve through the inbox: document and shared request both update, once", async () => {
      const job = await submittedJournal(250);
      const result = await decide("approver", job.requestId, { decision: "approved" });
      assert.equal(result.approval.status, "approved");
      assert.equal(await journalStatus(job.entryId), "approved");
      const row = await shared(job.requestId);
      assert.equal(row.status, "approved");
      assert.equal(row.decided_by, w.users.approver);
      const evidence = (await admin.query(`SELECT decision, decided_by FROM public.approval_decisions WHERE approval_request_id=$1`, [job.requestId])).rows;
      assert.deepEqual(evidence, [{ decision: "approved", decided_by: w.users.approver }]);
      await assert.rejects(decide("approver", job.requestId, { decision: "approved" }), expectCode("APPROVAL_ALREADY_DECIDED"));
      await assert.rejects(decide("approver", job.requestId, { decision: "rejected", note: "late" }), expectCode("APPROVAL_ALREADY_DECIDED"));
    });

    await t.test("approve and reject directly from the Accounting screen close the shared request in the same transaction", async () => {
      const approved = await submittedJournal(300);
      const entry = (await sql(`SELECT content_hash FROM tenant.accounting_journal_entries WHERE organization_id=$1 AND id=$2`, [orgId, approved.entryId]))[0];
      await run("approver", (c, x) => api.approveJournalEntry(c, x, approved.entryId, entry.content_hash));
      assert.deepEqual((await shared(approved.requestId)).status, "approved");
      assert.equal((await shared(approved.requestId)).decided_by, w.users.approver);

      const rejected = await submittedJournal(350);
      await run("approver", (c, x) => api.rejectJournalApproval(c, x, rejected.entryId));
      assert.equal(await journalStatus(rejected.entryId), "rejected");
      assert.equal((await shared(rejected.requestId)).status, "rejected");
    });

    await t.test("rejecting through the inbox keeps the reason as evidence", async () => {
      const job = await submittedJournal(400);
      await assert.rejects(decide("approver", job.requestId, { decision: "rejected" }), expectCode("APPROVAL_DECISION_INVALID"));
      await decide("approver", job.requestId, { decision: "rejected", note: "Wrong account" });
      const row = await shared(job.requestId);
      assert.equal(row.status, "rejected");
      assert.equal(row.decision_note, "Wrong account");
      assert.equal(await journalStatus(job.entryId), "rejected");
    });

    await t.test("cancellation: own request only (or oversight); the document is not changed", async () => {
      const job = await submittedJournal(450);
      await assert.rejects(decide("approver", job.requestId, { decision: "cancelled" }), expectCode("CANCEL_NOT_PERMITTED"));
      await decide("requester", job.requestId, { decision: "cancelled", note: "Raised by mistake" });
      assert.equal((await shared(job.requestId)).status, "cancelled");
      assert.equal(await journalStatus(job.entryId), "pending_approval", "cancellation never touches the business document");
    });

    await t.test("duplicate pending requests for the same target are impossible", async () => {
      const job = await submittedJournal(500);
      const again = await w.tx((c) =>
        createApprovalRequest(c, { organizationId: orgId, commandKey: "accounting.journal.approve", entityId: job.entryId, title: "dup", requestedBy: w.users.requester, payload: { journalEntryId: job.entryId, contentHash: "x" } }),
      );
      assert.equal(again.id, job.requestId);
      assert.equal(again.created, false);
      const count = (await admin.query(`SELECT count(*)::int AS n FROM public.approval_requests WHERE organization_id=$1 AND entity_id=$2 AND status='pending'`, [orgId, job.entryId])).rows[0].n;
      assert.equal(count, 1);
    });

    await t.test("unregistered commands fail closed; other organisations' ids are not found", async () => {
      const legacy = (await admin.query(
        `INSERT INTO public.approval_requests (organization_id, entity_type, entity_id, title, status, requested_by, command_key, command_payload) VALUES ($1,'legacy_thing','x','Legacy','pending',$2,'legacy.unknown','{}'::jsonb) RETURNING id`,
        [orgId, w.users.requester],
      )).rows[0].id;
      await assert.rejects(decide("manager", legacy, { decision: "approved" }), expectCode("APPROVAL_COMMAND_NOT_SUPPORTED"));
      assert.equal((await shared(legacy)).status, "pending");
      const outsider = { ...session("approver"), organizationId: randomUUID() };
      await assert.rejects(w.tx((c) => decideApproval(c, outsider, first.requestId, { decision: "approved" }, MODULES)), expectCode("APPROVAL_NOT_FOUND"));
    });
  } finally {
    await w.cleanup();
    // Append-only evidence goes with triggers off; the organisation itself with FK cascades on.
    await admin.query("SET session_replication_role = replica");
    for (const table of ["approval_decisions", "approval_requests", "audit_events", "notifications"]) await admin.query(`DELETE FROM public.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    const tenantTables = (await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
    for (const row of tenantTables) await admin.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query("SET session_replication_role = DEFAULT");
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [Object.values(w.users)]).catch(() => undefined);
    await admin.end();
  }
});

test("approvals: sales orders through the inbox and the Sales screen", async (t) => {
  requireDatabase();
  const admin = await connectAdmin();
  const api = await import("../../../services/api/src/index.js");
  const { setTenantContext } = await import("../../../packages/database/src/index.js");
  const orgId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const sellerId = randomUUID();
  const approverId = randomUUID();
  const uomId = randomUUID();
  const taxCategoryId = randomUUID();
  const priceListId = randomUUID();
  const itemId = randomUUID();
  const customerId = randomUUID();
  const base = { organizationId: orgId, activeCompanyId: companyId, activeBranchId: branchId, allowAllCompanies: false, roleSlugs: [] };
  const seller = { ...base, userId: sellerId, permissions: ["sales.view", "sales.order.create", "sales.order.confirm"] };
  const approver = { ...base, userId: approverId, permissions: ["sales.view", "sales.order.approve", "sales.order.confirm"] };
  const tx = async (fn) => {
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
  };
  try {
    for (const [id, name] of [[sellerId, "RT Seller"], [approverId, "RT Approver"]]) {
      await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `rt-sales-${id}@test.invalid`, name]);
    }
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'RT Sales Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `rt-sales-${orgId}`, sellerId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'RT Co','RT Co','RTSC','INR','IN',true,'active')`, [companyId, orgId]);
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    for (const id of [sellerId, approverId]) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await admin.query(`INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`, [randomUUID(), orgId, taxCategoryId]);
    await admin.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code,order_approval_amount) VALUES ($1,'KA',1)`, [orgId]);
    await admin.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`, [priceListId, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Widget','product',$3,$4,100,60,'active')`, [itemId, orgId, uomId, taxCategoryId]);
    await admin.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Acme Retail','active',$4)`, [customerId, orgId, companyId, sellerId]);

    const document = { partyId: customerId, currencyCode: "INR", priceListId, placeOfSupply: "KA", lines: [{ itemId, quantity: 2 }] };
    const submittedOrder = async () => {
      const order = await tx((c) => api.createSalesOrder(c, seller, document));
      const submitted = await tx((c) => api.submitSalesOrder(c, seller, order.id));
      assert.equal(submitted.approvalRequired, true);
      const request = (await admin.query(`SELECT id FROM public.approval_requests WHERE organization_id=$1 AND command_key='sales.order.approve' AND entity_id=$2 AND status='pending'`, [orgId, order.id])).rows[0];
      return { orderId: order.id, requestId: request.id };
    };
    const orderStatus = async (id) => (await admin.query(`SELECT lifecycle_status, approval_status, current_version_id FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [orgId, id])).rows[0];
    const shared = async (id) => (await admin.query(`SELECT status, decided_by FROM public.approval_requests WHERE id=$1`, [id])).rows[0];

    await t.test("approve through the inbox updates the order and the shared request", async () => {
      const job = await submittedOrder();
      const row = (await tx((c) => listApprovalInbox(c, approver, { status: "pending", accessibleModules: ["sales"] }))).find((entry) => entry.id === job.requestId);
      assert.equal(row.canApprove, true);
      assert.equal(row.href, `/sales/orders/${job.orderId}`);
      await tx((c) => decideApproval(c, approver, job.requestId, { decision: "approved" }, { accessibleModules: ["sales"] }));
      assert.equal((await orderStatus(job.orderId)).approval_status, "approved");
      assert.deepEqual(await shared(job.requestId), { status: "approved", decided_by: approverId });
    });

    await t.test("approve and reject directly from the order close the shared request", async () => {
      const approved = await submittedOrder();
      const versionId = (await orderStatus(approved.orderId)).current_version_id;
      await tx((c) => api.approveSalesOrder(c, approver, approved.orderId, versionId));
      assert.deepEqual(await shared(approved.requestId), { status: "approved", decided_by: approverId });
      const rejected = await submittedOrder();
      await tx((c) => api.rejectSalesOrderApproval(c, approver, rejected.orderId, "Price too low"));
      assert.deepEqual(await shared(rejected.requestId), { status: "rejected", decided_by: approverId });
    });
  } finally {
    await admin.query("SET session_replication_role = replica").catch(() => undefined);
    const tables = (await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
    for (const row of tables) await admin.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    for (const table of ["approval_decisions", "approval_requests", "audit_events"]) await admin.query(`DELETE FROM public.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query("SET session_replication_role = DEFAULT").catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[sellerId, approverId]]).catch(() => undefined);
    await admin.end();
  }
});
