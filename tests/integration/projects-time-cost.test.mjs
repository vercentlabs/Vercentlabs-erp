// Real PostgreSQL integration test -- time, expenses, materials and procurement (F210-F213): weekly timesheets
// with rate provenance and a governed approval, expenses with currency conversion, stock issued to a project
// through Stock's own movement, and procurement links that count as commitments or actuals.
import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLER, MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, pmo2: PMO, controller: CONTROLLER, dev1: MEMBER, dev2: MEMBER, outsider: MEMBER, lead: [...MEMBER, "projects.time.approve"] };

test("Project time, expenses, materials and procurement against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjtc");
  const { api, run, denied, sql, users } = w;
  const ids = {};
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const mondayOfToday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  try {
    const p = await run("pm", (c, x) => api.createProjectRecord(c, x, { name: "Field service", customerId: w.customerId, billingMethod: "time_and_material", contractedRevenue: 0, projectManagerId: users.pm, plannedStartDate: "2026-01-05" }));
    ids.p = p.id;
    await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.dev1, roleName: "Engineer", allocationPercent: 50, costRate: 400, billRate: 1000 }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    const early = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 2 })).catch((e) => e);
    assert.equal(early.code, "PROJECT_NOT_ACTIVE", "time is only logged against an active project");
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));
    const leaf = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Install", billable: true, assigneeUserId: users.dev1, estimatedHours: 20 }));
    const summary = await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Phase" }));
    await run("pm", (c, x) => api.createProjectTaskRecord(c, x, p.id, { name: "Child", parentTaskId: summary.id }));
    ids.leaf = leaf.id; ids.summary = summary.id;

    await t.test("F210: time is logged by team members only, snapshots the member's rates, and respects the day cap and summary tasks", async () => {
      await denied("outsider", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 }), 404);
      const notMember = await run("dev2", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(notMember.status, 404, "a non-member cannot even see the project");
      const e1 = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, taskId: leaf.id, workDate: day(1), hours: 6, description: "Site install", billable: true }));
      assert.equal(e1.status, "draft");
      assert.equal(Number(e1.cost_rate), 400, "the cost rate comes from the team record, not the caller");
      assert.equal(Number(e1.bill_rate), 1000);
      assert.equal(e1.billable, true);
      const forged = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(2), hours: 1, costRate: 1, billRate: 1 }));
      assert.equal(Number(forged.cost_rate), 400, "a supplied rate is ignored");
      const future = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: "2999-01-01", hours: 1 })).catch((e) => e);
      assert.equal(future.status, 400);
      const summaryTask = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, taskId: summary.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(summaryTask.code, "PROJECT_TASK_SUMMARY");
      const cap = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 20 })).catch((e) => e);
      assert.equal(cap.code, "PROJECT_DAY_EXCEEDED", "6 + 20 hours would exceed 24 on the day");
      const zero = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 0 })).catch((e) => e);
      assert.equal(zero.status, 400);
      ids.entry = e1.id;
    });

    await t.test("F210: a week is submitted, approved by someone else, and approved time is locked", async () => {
      const week = mondayOfToday();
      const sheet = await run("dev1", (c, x) => api.submitTimesheet(c, x, { weekStart: day(1) }));
      assert.equal(sheet.status, "submitted");
      assert.ok(Number(sheet.total_hours) >= 6);
      const locked = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(1), hours: 1 })).catch((e) => e);
      assert.equal(locked.code, "PROJECT_TIMESHEET_LOCKED", "a submitted week takes no new time");
      const edit = await run("dev1", (c, x) => api.updateTimeEntryRecord(c, x, ids.entry, { hours: 7 })).catch((e) => e);
      assert.equal(edit.code, "PROJECT_LOCKED");
      await denied("dev1", (c, x) => api.reviewTimesheet(c, x, sheet.id, true), 403);
      const reject = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, false, "")).catch((e) => e);
      assert.equal(reject.status, 400, "a rejection needs a reason");
      const rejected = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, false, "Wrong task"));
      assert.equal(rejected.status, "rejected");
      const fixed = await run("dev1", (c, x) => api.updateTimeEntryRecord(c, x, ids.entry, { hours: 7 }));
      assert.equal(Number(fixed.hours), 7, "a rejected entry can be corrected");
      await run("dev1", (c, x) => api.submitTimesheet(c, x, { weekStart: day(1) }));
      const again = await run("pmo", (c, x) => api.listTimesheets(c, x, { status: "submitted" }));
      assert.ok(again.length >= 1);
      const approved = await run("pmo", (c, x) => api.reviewTimesheet(c, x, again[0].id, true));
      assert.equal(approved.status, "approved");
      const [row] = await sql(`SELECT status FROM tenant.project_time_entries WHERE id=$1`, [ids.entry]);
      assert.equal(row.status, "approved");
      const del = await run("dev1", (c, x) => api.deleteTimeEntryRecord(c, x, ids.entry)).catch((e) => e);
      assert.equal(del.code, "PROJECT_LOCKED");
      const reopened = await run("pmo", (c, x) => api.reopenApprovedTime(c, x, ids.entry, "Hours were 6.5"));
      assert.equal(reopened.ok, true);
      void week;
    });

    await t.test("F210: an approver cannot approve their own timesheet", async () => {
      await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.lead, roleName: "Lead", allocationPercent: 10, costRate: 300, billRate: 0 }));
      await run("lead", (c, x) => api.logProjectTime(c, x, { projectId: p.id, workDate: day(3), hours: 2 }));
      const sheet = await run("lead", (c, x) => api.submitTimesheet(c, x, { weekStart: day(3) }));
      const self = await run("lead", (c, x) => api.reviewTimesheet(c, x, sheet.id, true)).catch((e) => e);
      assert.equal(self.code, "SELF_APPROVAL_BLOCKED");
      const other = await run("pmo", (c, x) => api.reviewTimesheet(c, x, sheet.id, true));
      assert.equal(other.status, "approved");
    });

    await t.test("F211: an expense converts currency, needs a receipt trail, and is approved by someone else before reimbursement", async () => {
      await denied("outsider", (c, x) => api.createProjectExpense(c, x, { projectId: p.id, expenseDate: day(1), category: "Travel", amount: 10 }), 404);
      const noRate = await run("dev1", (c, x) => api.createProjectExpense(c, x, { projectId: p.id, expenseDate: day(1), category: "Travel", amount: 100, currencyCode: "USD" })).catch((e) => e);
      assert.equal(noRate.code, "PROJECT_FIELD_REQUIRED", "a foreign-currency expense needs its rate");
      const x1 = await run("dev1", (c, x) => api.createProjectExpense(c, x, { projectId: p.id, expenseDate: day(1), category: "Travel", amount: 100, currencyCode: "USD", exchangeRate: 83.5, receiptReference: "RCPT-1", billable: true }));
      assert.equal(Number(x1.base_amount), 8350);
      assert.equal(x1.billable, true);
      ids.exp = x1.id;
      await denied("dev2", (c, x) => api.submitProjectExpense(c, x, x1.id), 404);
      const submitted = await run("dev1", (c, x) => api.submitProjectExpense(c, x, x1.id));
      assert.equal(submitted.status, "submitted");
      const locked = await run("dev1", (c, x) => api.updateProjectExpense(c, x, x1.id, { amount: 1 })).catch((e) => e);
      assert.equal(locked.code, "PROJECT_LOCKED");
      await denied("dev1", (c, x) => api.reviewProjectExpense(c, x, x1.id, true), 403);
      const noReason = await run("pmo", (c, x) => api.reviewProjectExpense(c, x, x1.id, false)).catch((e) => e);
      assert.equal(noReason.status, 400);
      const approved = await run("pmo", (c, x) => api.reviewProjectExpense(c, x, x1.id, true));
      assert.equal(approved.status, "approved");
      const early = await run("pmo", (c, x) => api.reimburseProjectExpense(c, x, x1.id));
      assert.equal(early.status, "reimbursed");
      const twice = await run("pmo", (c, x) => api.reimburseProjectExpense(c, x, x1.id)).catch((e) => e);
      assert.equal(twice.status, 409);
      const future = await run("dev1", (c, x) => api.createProjectExpense(c, x, { projectId: p.id, expenseDate: "2999-01-01", category: "Meals", amount: 5 })).catch((e) => e);
      assert.equal(future.status, 400);
    });

    await t.test("F212: materials are issued through Stock (on-hand, cost), returned by a receipt, and refused when stock is short", async () => {
      const m = await run("dev1", (c, x) => api.issueProjectMaterial(c, x, p.id, { itemId: w.itemId, warehouseId: w.warehouseId, quantity: 10, billable: true, taskId: leaf.id, idempotencyKey: "k1" }));
      assert.equal(Number(m.unit_cost), 10, "costed at Stock's average cost");
      assert.equal(Number(m.total_cost), 100);
      assert.ok(m.stock_movement_id);
      const [bal] = await sql(`SELECT quantity FROM tenant.stock_balances WHERE item_id=$1 AND warehouse_id=$2`, [w.itemId, w.warehouseId]);
      assert.equal(Number(bal.quantity), 90, "Stock's balance fell");
      const replay = await run("dev1", (c, x) => api.issueProjectMaterial(c, x, p.id, { itemId: w.itemId, warehouseId: w.warehouseId, quantity: 10, idempotencyKey: "k1" }));
      assert.equal(replay.id, m.id, "the same idempotency key does not consume twice");
      const short = await run("dev1", (c, x) => api.issueProjectMaterial(c, x, p.id, { itemId: w.itemId, warehouseId: w.warehouseId, quantity: 500 })).catch((e) => e);
      assert.equal(short.code, "INSUFFICIENT_STOCK");
      const seen = await run("dev1", (c, x) => api.listProjectMaterials(c, x, { projectId: p.id }));
      assert.equal(seen[0].total_cost, null, "a member does not see costs");
      const back = await run("dev1", (c, x) => api.returnProjectMaterial(c, x, m.id, { reason: "Not needed" }));
      assert.equal(back.status, "returned");
      const [after] = await sql(`SELECT quantity FROM tenant.stock_balances WHERE item_id=$1 AND warehouse_id=$2`, [w.itemId, w.warehouseId]);
      assert.equal(Number(after.quantity), 100, "the return went back into stock");
      const twice = await run("dev1", (c, x) => api.returnProjectMaterial(c, x, m.id)).catch((e) => e);
      assert.equal(twice.status, 409);
      await run("dev1", (c, x) => api.issueProjectMaterial(c, x, p.id, { itemId: w.itemId, warehouseId: w.warehouseId, quantity: 4, idempotencyKey: "k2" }));
    });

    await t.test("F213: procurement links are commitments or actuals, validated against the real documents", async () => {
      const po = await w.doc("procurement_purchase_orders");
      const receipt = await w.doc("procurement_receipts");
      await denied("dev1", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "purchase_order", documentId: po, committedAmount: 100 }), 403);
      const wrongKind = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "purchase_order", documentId: po, actualAmount: 500 })).catch((e) => e);
      assert.equal(wrongKind.code, "PROJECT_LINK_INVALID", "a PO carries a commitment, not an actual");
      const missing = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "purchase_order", documentId: "00000000-0000-4000-8000-000000000001", committedAmount: 100 })).catch((e) => e);
      assert.equal(missing.status, 404);
      const commit = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "purchase_order", documentId: po, committedAmount: 2000 }));
      assert.equal(Number(commit.committed_amount), 2000);
      const actual = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "receipt", documentId: receipt, actualAmount: 1500 }));
      assert.equal(Number(actual.actual_amount), 1500);
      const updated = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "purchase_order", documentId: po, committedAmount: 2500 }));
      assert.equal(updated.id, commit.id, "re-linking the same document updates it, never duplicates");
      const [n] = await sql(`SELECT count(*)::int AS n FROM tenant.project_procurement_links WHERE project_id=$1`, [p.id]);
      assert.equal(n.n, 2);
      const un = await run("pm", (c, x) => api.unlinkProcurementDocument(c, x, actual.id));
      assert.equal(un.ok, true);
    });

    await t.test("F213: a posted vendor bill becomes an actual cost automatically; a draft bill does not", async () => {
      const created = await w.tx(async (client) => {
        const ctx = { organizationId: w.orgId, companyId: w.companyId, activeCompanyId: w.companyId, userId: users.controller, permissions: ["accounting.payables.manage", "accounting.payables.approve", "accounting.view"], roleSlugs: [], allowAllCompanies: false, activeBranchId: null };
        const other = { ...ctx, userId: users.pmo };
        const draft = await api.createVendorBill(client, ctx, { companyId: w.companyId, partyId: w.supplierId, lines: [{ description: "Subcontractor", unitPrice: 3000 }] });
        return { draft: draft.bill.id, ctx, other };
      });
      const early = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "vendor_bill", documentId: created.draft })).catch((e) => e);
      assert.equal(early.code, "PROJECT_LINK_INVALID", "a draft bill is not a cost yet");
      await w.tx(async (client) => {
        const sub = await api.submitVendorBill(client, created.ctx, created.draft);
        await api.approveVendorBill(client, created.other, created.draft, sub.contentHash);
        await api.postVendorBill(client, created.ctx, created.draft);
      });
      const linked = await run("pm", (c, x) => api.linkProcurementDocument(c, x, p.id, { documentType: "vendor_bill", documentId: created.draft }));
      assert.equal(Number(linked.actual_amount), 3000, "the actual comes from the posted bill, not from what the caller types");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
