// Real PostgreSQL integration test -- project money (F214-F223): budgets and revisions with maker-checker,
// cost tracking from source records, profitability with estimate at completion, and billing by fixed price,
// milestone and time-and-material, with an approval step and an idempotent handoff to a draft Accounting invoice.
import assert from "node:assert/strict";
import test from "node:test";

import { CONTROLLER, MEMBER, PM, PMO, buildProjectsWorld, connectAdmin } from "./projects-test-kit.mjs";

const ROLES = { pm: PM, pmo: PMO, controller: CONTROLLER, controller2: CONTROLLER, dev1: MEMBER, commercial: [...PM, "projects.budget.manage", "projects.billing.manage"] };

test("Project budgets, profitability and billing against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildProjectsWorld(admin, ROLES, "pjfn");
  const { api, run, denied, sql, users } = w;
  const ids = {};
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

  async function mkProject(name, billingMethod, revenue, extra = {}) {
    const p = await run("commercial", (c, x) => api.createProjectRecord(c, x, { name, customerId: w.customerId, billingMethod, contractedRevenue: revenue, projectManagerId: users.pm, plannedStartDate: "2026-01-05", ...extra }));
    await run("pm", (c, x) => api.saveProjectMember(c, x, p.id, { userId: users.dev1, roleName: "Engineer", allocationPercent: 50, costRate: 400, billRate: 1000, allowOverAllocation: true }));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "plan"));
    await run("pmo", (c, x) => api.approveProjectRecord(c, x, p.id));
    await run("pm", (c, x) => api.changeProjectStatus(c, x, p.id, "activate"));
    return p;
  }
  async function approvedTime(projectId, hours, billable = true, offset = 1) {
    const e = await run("dev1", (c, x) => api.logProjectTime(c, x, { projectId, workDate: day(offset), hours, billable }));
    await sql(`UPDATE tenant.project_time_entries SET status='approved',approved_by=$2 WHERE id=$1`, [e.id, users.pmo]);
    return e;
  }

  try {
    const fixed = await mkProject("Fixed build", "fixed_price", 100000);
    ids.fixed = fixed.id;

    await t.test("F214/F215: a budget needs a cost amount, is approved by someone else, becomes the baseline, and a revision needs a reason and supersedes it", async () => {
      await denied("pm", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 1 }), 403);
      const empty = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { revenueBudget: 100000 })).catch((e) => e);
      assert.equal(empty.status, 400);
      const b1 = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 40000, expenseBudget: 10000, procurementBudget: 20000, contingencyBudget: 5000, revenueBudget: 100000 }));
      assert.equal(b1.status, "draft");
      const twoDrafts = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 1 })).catch((e) => e);
      assert.equal(twoDrafts.code, "PROJECT_BUDGET_OPEN");
      await run("controller", (c, x) => api.submitProjectBudget(c, x, b1.id));
      const self = await run("controller", (c, x) => api.approveProjectBudget(c, x, b1.id)).catch((e) => e);
      assert.equal(self.status, 403, "the controller holds no approve permission");
      const active = await run("pmo", (c, x) => api.approveProjectBudget(c, x, b1.id));
      assert.equal(active.status, "active");
      assert.equal(Number((await sql(`SELECT approved_budget FROM tenant.projects WHERE id=$1`, [ids.fixed]))[0].approved_budget), 75000, "the project's budget follows the active version");
      const noReason = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 50000 })).catch((e) => e);
      assert.equal(noReason.code, "PROJECT_FIELD_REQUIRED", "a revision needs a reason");
      const b2 = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 50000, reason: "Scope added: integration" }));
      assert.equal(b2.version, 2);
      assert.equal(b2.base_version, 1);
      await run("controller", (c, x) => api.submitProjectBudget(c, x, b2.id));
      const rejected = await run("pmo", (c, x) => api.rejectProjectBudget(c, x, b2.id, "Needs a customer change order"));
      assert.equal(rejected.status, "rejected");
      const b3 = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 50000, reason: "Change order CO-1 signed" }));
      await run("controller", (c, x) => api.submitProjectBudget(c, x, b3.id));
      await run("pmo", (c, x) => api.approveProjectBudget(c, x, b3.id));
      const list = await run("controller", (c, x) => api.listProjectBudgets(c, x, { projectId: ids.fixed }));
      assert.deepEqual(list.map((b) => b.status), ["active", "rejected", "superseded"], "history is preserved");
      assert.equal(Number(list[0].change_from_base), 10000, "the revision shows its delta from the version it was cloned from");
      assert.equal(Number((await sql(`SELECT approved_budget FROM tenant.projects WHERE id=$1`, [ids.fixed]))[0].approved_budget), 85000);
    });

    await t.test("F216/F223: cost comes from approved time, approved expenses, issued materials and linked procurement, and variance is by category", async () => {
      await approvedTime(ids.fixed, 10, true, 1);
      await approvedTime(ids.fixed, 5, false, 2);
      const x = await run("dev1", (c, xx) => api.createProjectExpense(c, xx, { projectId: ids.fixed, expenseDate: day(1), category: "Travel", amount: 2000 }));
      await sql(`UPDATE tenant.project_expenses SET status='approved' WHERE id=$1`, [x.id]);
      const draftExpense = await run("dev1", (c, xx) => api.createProjectExpense(c, xx, { projectId: ids.fixed, expenseDate: day(1), category: "Meals", amount: 999 }));
      void draftExpense;
      await run("dev1", (c, xx) => api.issueProjectMaterial(c, xx, ids.fixed, { itemId: w.itemId, warehouseId: w.warehouseId, quantity: 20, idempotencyKey: "m1" }));
      const po = await w.doc("procurement_purchase_orders");
      await run("pm", (c, xx) => api.linkProcurementDocument(c, xx, ids.fixed, { documentType: "purchase_order", documentId: po, committedAmount: 8000 }));
      const v = await run("controller", (c, xx) => api.getCostVariance(c, xx, ids.fixed));
      const row = (name) => v.rows.find((r) => r.category === name);
      assert.equal(Number(row("labor").actual), 6000, "15 hours at the 400 cost rate");
      assert.equal(Number(row("expense").actual), 2000, "only the approved expense counts; the draft does not");
      assert.equal(Number(row("procurement and materials").actual), 200, "20 units issued at 10");
      assert.equal(Number(row("procurement and materials").committed), 8000, "the open PO is a commitment, not a cost");
      assert.equal(Number(v.total.actual), 8200);
      assert.equal(Number(v.total.budget), 85000);
      await denied("dev1", (c, xx) => api.getCostVariance(c, xx, ids.fixed), 403);
      const breakdown = await run("controller", (c, xx) => api.getCostBreakdown(c, xx, ids.fixed));
      assert.equal(Number(breakdown.byPerson[0].cost), 6000);
    });

    await t.test("F222/F223: profitability recognises fixed-price revenue by progress and forecasts the estimate at completion", async () => {
      await sql(`UPDATE tenant.projects SET percent_complete=20 WHERE id=$1`, [ids.fixed]);
      await denied("dev1", (c, x) => api.getProjectProfitabilityDesk(c, x, ids.fixed), 403);
      const d = await run("controller", (c, x) => api.getProjectProfitabilityDesk(c, x, ids.fixed));
      assert.equal(Number(d.revenue.recognized), 20000, "20% of 100000");
      assert.equal(Number(d.cost.total), 8200);
      assert.equal(Number(d.margin.grossMargin), 11800);
      assert.equal(d.margin.grossMarginPercent, 59);
      assert.equal(Number(d.forecast.budgetAtCompletion), 85000);
      assert.equal(Number(d.forecast.earnedValue), 17000, "20% of the budget");
      assert.ok(d.forecast.costPerformanceIndex > 2, "we have spent far less than we have earned");
      assert.ok(Number(d.forecast.estimateAtCompletion) < 85000);
      assert.equal(d.asOf.length, 10);
      assert.ok(d.basis.note.includes("not yet cost"));
      const snap = await run("controller", (c, x) => api.captureProfitabilitySnapshot(c, x, ids.fixed));
      assert.equal(Number(snap.total_cost), 8200);
      const again = await run("controller", (c, x) => api.captureProfitabilitySnapshot(c, x, ids.fixed));
      assert.equal(again.id, snap.id, "one snapshot per project per day");
    });

    await t.test("F218: a fixed-price schedule cannot exceed the contract, is approved by someone else, and hands one draft invoice to Accounting", async () => {
      const first = await run("controller", (c, x) => api.createFixedPriceBilling(c, x, ids.fixed, { description: "Deposit 30%", amount: 30000, idempotencyKey: "fx-1" }));
      assert.equal(first.status, "ready");
      const replay = await run("controller", (c, x) => api.createFixedPriceBilling(c, x, ids.fixed, { description: "Deposit 30%", amount: 30000, idempotencyKey: "fx-1" }));
      assert.equal(replay.id, first.id, "the same idempotency key never creates a second line");
      const over = await run("controller", (c, x) => api.createFixedPriceBilling(c, x, ids.fixed, { description: "Too much", amount: 80000 })).catch((e) => e);
      assert.equal(over.code, "PROJECT_BILLING_EXCEEDS_CONTRACT");
      const early = await run("controller", (c, x) => api.invoiceBillingLine(c, x, first.id)).catch((e) => e);
      assert.equal(early.code, "PROJECT_STATE_INVALID", "an unapproved line is not invoiced");
      const self = await run("controller", (c, x) => api.approveBillingLine(c, x, first.id)).catch((e) => e);
      assert.equal(self.status, 403);
      await run("pmo", (c, x) => api.approveBillingLine(c, x, first.id));
      const invoiced = await run("controller", (c, x) => api.invoiceBillingLine(c, x, first.id));
      assert.equal(invoiced.status, "invoiced");
      assert.ok(invoiced.accounting_customer_invoice_id && invoiced.invoice_number);
      const [inv] = await sql(`SELECT status,grand_total,party_id FROM tenant.accounting_customer_invoices WHERE id=$1`, [invoiced.accounting_customer_invoice_id]);
      assert.equal(inv.status, "draft", "Accounting owns the invoice from here; it is a draft for its own workflow");
      assert.equal(Number(inv.grand_total), 30000);
      assert.equal(inv.party_id, w.customerId);
      const twice = await run("controller", (c, x) => api.invoiceBillingLine(c, x, first.id));
      assert.equal(twice.accounting_customer_invoice_id, invoiced.accounting_customer_invoice_id, "handoff is idempotent");
      const [n] = await sql(`SELECT count(*)::int AS n FROM tenant.accounting_customer_invoices WHERE organization_id=$1`, [w.orgId]);
      assert.equal(n.n, 1);
      const cancel = await run("controller", (c, x) => api.cancelBillingLine(c, x, first.id, "oops")).catch((e) => e);
      assert.equal(cancel.code, "PROJECT_STATE_INVALID", "an invoiced line is corrected in Accounting, not cancelled here");
      const wrongMethod = await run("controller", (c, x) => api.createTimeMaterialBilling(c, x, ids.fixed, {})).catch((e) => e);
      assert.equal(wrongMethod.code, "PROJECT_BILLING_METHOD");
    });

    await t.test("F220: a milestone is billed once, only when completed, and the contract caps milestone billing", async () => {
      const ms = await mkProject("Milestone job", "milestone", 60000);
      ids.ms = ms.id;
      const m1 = await run("pm", (c, x) => api.saveProjectMilestone(c, x, ms.id, { name: "Design signed off", billingTrigger: true, billingAmount: 20000 }));
      const capped = await run("pm", (c, x) => api.saveProjectMilestone(c, x, ms.id, { name: "Too big", billingTrigger: true, billingAmount: 50000 })).catch((e) => e);
      assert.equal(capped.code, "PROJECT_BILLING_EXCEEDS_CONTRACT");
      const early = await run("controller", (c, x) => api.createMilestoneBilling(c, x, m1.id)).catch((e) => e);
      assert.equal(early.code, "PROJECT_MILESTONE_NOT_COMPLETE");
      await run("pm", (c, x) => api.setMilestoneStatus(c, x, m1.id, "complete"));
      const line = await run("controller", (c, x) => api.createMilestoneBilling(c, x, m1.id));
      assert.equal(Number(line.amount), 20000);
      const dup = await run("controller", (c, x) => api.createMilestoneBilling(c, x, m1.id)).catch((e) => e);
      assert.equal(dup.code, "PROJECT_MILESTONE_BILLED");
      const reopen = await run("pm", (c, x) => api.setMilestoneStatus(c, x, m1.id, "reopen")).catch((e) => e);
      assert.equal(reopen.status, 409, "the billing line is queued; the milestone cannot change under it");
      await run("controller", (c, x) => api.cancelBillingLine(c, x, line.id, "Customer disputes"));
      const reopened = await run("pm", (c, x) => api.setMilestoneStatus(c, x, m1.id, "reopen"));
      assert.equal(reopened.status, "in_progress");
      const recon = await run("pmo", (c, x) => api.getProjectProfitabilityDesk(c, x, ids.ms));
      assert.equal(Number(recon.revenue.recognized), 0, "no milestone is completed, so nothing is recognised");
    });

    await t.test("F219: time-and-material billing bills each approved, billable, unbilled entry at its own rate, once, and cancelling releases them", async () => {
      const tm = await mkProject("T&M support", "time_and_material", 0);
      ids.tm = tm.id;
      const nothing = await run("controller", (c, x) => api.createTimeMaterialBilling(c, x, tm.id, {})).catch((e) => e);
      assert.equal(nothing.code, "PROJECT_NOTHING_TO_BILL");
      await approvedTime(tm.id, 8, true, 1);
      await approvedTime(tm.id, 4, true, 2);
      await approvedTime(tm.id, 6, false, 3);
      const x = await run("dev1", (c, xx) => api.createProjectExpense(c, xx, { projectId: tm.id, expenseDate: day(1), category: "Parts", amount: 1500, billable: true }));
      await sql(`UPDATE tenant.project_expenses SET status='approved' WHERE id=$1`, [x.id]);
      const before = await run("controller", (c, xx) => api.getProjectProfitabilityDesk(c, xx, tm.id));
      assert.equal(Number(before.revenue.unbilled), 13500, "12 billable hours at 1000 plus the 1500 expense");
      const line = await run("controller", (c, xx) => api.createTimeMaterialBilling(c, xx, tm.id, {}));
      assert.equal(Number(line.amount), 13500);
      assert.equal(line.detail.timeEntries, 2, "the non-billable entry is not billed");
      const marked = await sql(`SELECT count(*)::int AS n FROM tenant.project_time_entries WHERE billed_billing_id=$1`, [line.id]);
      assert.equal(marked[0].n, 2);
      const second = await run("controller", (c, xx) => api.createTimeMaterialBilling(c, xx, tm.id, {})).catch((e) => e);
      assert.equal(second.code, "PROJECT_NOTHING_TO_BILL", "billed work cannot be billed twice");
      const billedId = (await sql(`SELECT id FROM tenant.project_time_entries WHERE billed_billing_id=$1 LIMIT 1`, [line.id]))[0].id;
      const lockedEntry = await run("pmo", (c, xx) => api.reopenApprovedTime(c, xx, billedId, "Correction")).catch((e) => e);
      assert.equal(lockedEntry.code, "PROJECT_LOCKED", "billed time is locked");
      await run("controller", (c, xx) => api.cancelBillingLine(c, xx, line.id, "Wrong period"));
      const released = await sql(`SELECT count(*)::int AS n FROM tenant.project_time_entries WHERE billed_billing_id IS NOT NULL AND project_id=$1`, [tm.id]);
      assert.equal(released[0].n, 0, "cancelling releases the work for billing again");
      const again = await run("controller", (c, xx) => api.createTimeMaterialBilling(c, xx, tm.id, {}));
      assert.equal(Number(again.amount), 13500);
      await run("pmo", (c, xx) => api.approveBillingLine(c, xx, again.id));
      const inv = await run("controller", (c, xx) => api.invoiceBillingLine(c, xx, again.id));
      assert.equal(inv.status, "invoiced");
      const lines = await run("controller", (c, xx) => api.listBillingLines(c, xx, { projectId: tm.id }));
      assert.equal(lines.find((l) => l.id === again.id).invoice_status, "draft", "the project invoice list shows the Accounting invoice's own status");
    });

    await t.test("close checks: unbilled queued lines and unapproved cost block completion; contract cannot fall below what is billed", async () => {
      const lower = await run("controller", (c, x) => api.getProjectProfitabilityDesk(c, x, ids.fixed));
      assert.ok(lower);
      const tooLow = await run("commercial", (c, x) => c && api.updateProjectRecord(c, x, ids.fixed, { contractedRevenue: 1000 })).catch((e) => e);
      assert.ok(["PROJECT_REVENUE_BELOW_BILLED", "PROJECT_FORBIDDEN"].includes(tooLow.code));
      const blockers = await run("pmo", (c, x) => api.getCloseBlockers(c, x, ids.fixed));
      assert.ok(blockers.blockers.some((b) => b.code === "unapproved_expenses"), "the draft expense blocks completion");
    });

    await t.test("budget below what has already been spent is refused", async () => {
      const b = await run("controller", (c, x) => api.createProjectBudget(c, x, ids.fixed, { laborBudget: 100, expenseBudget: 0, procurementBudget: 0, contingencyBudget: 0, reason: "Cut" }));
      await run("controller", (c, x) => api.submitProjectBudget(c, x, b.id));
      const refused = await run("pmo", (c, x) => api.approveProjectBudget(c, x, b.id)).catch((e) => e);
      assert.equal(refused.code, "PROJECT_BUDGET_BELOW_ACTUALS");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
