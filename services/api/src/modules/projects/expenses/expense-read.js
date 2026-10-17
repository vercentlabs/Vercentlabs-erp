// Projects — Project Expenses, the reads: one expense with its history, receipts, possible duplicates, reimbursement, recognized cost,
// recharge and corrections; the queues (mine, the team's, waiting for approval, for Finance, for payment, for correction, for recharge);
// a project's expense summary — whose headline figures are different stages of the same spending and are never added into one "total";
// the options a form needs; the reports and their export. What a person sees follows who they are: their own claims, the projects they
// lead, or Finance; cost and recharge figures need their own permission.
import { has, isOwner, isoDay, seesAll, text, userNames, uuid, visibilitySql } from "../project-core.js";
import { EXPENSE_ENTITY, duplicatesOf, expenseScope } from "./expense-commands.js";
import {
  BILLING_LABEL, CLASSIFICATION_LABEL, EXPENSE, REIMBURSEMENT_LABEL, SOURCE_LABEL, STATUS_LABEL, TAX_LABEL, addMoney, ensureExpenseCategories, expenseCode, expenseError, expensePolicy,
  expenseProject, expenseRights, moneyOut, subMoney,
} from "./expense-rules.js";

const BILL_RECOGNIZED = ["approved", "posted", "partially_paid", "paid", "overdue", "disputed"];
const day = (value) => (value ? isoDay(value) : null);
const EXPENSE_SELECT = `SELECT expense.*, to_char(expense.expense_date, 'YYYY-MM-DD') AS day, category.name AS category_name, category.code AS category_code, category.budget_category,
    project.project_code, project.name AS project_name, project.manager_user_id, task.task_code, task.title AS task_title,
    (SELECT count(*) FROM public.attachments file WHERE file.organization_id = expense.organization_id AND file.entity_type = '${EXPENSE_ENTITY}' AND file.entity_id = expense.id::text
      AND file.is_current AND file.lifecycle_status <> 'archived')::int AS receipts
  FROM tenant.project_expenses expense JOIN tenant.projects project ON project.id = expense.project_id JOIN tenant.project_expense_categories category ON category.id = expense.category_id
  LEFT JOIN tenant.project_tasks task ON task.id = expense.task_id`;

function present(c, row, names, can) {
  const out = {
    id: row.id, code: expenseCode(row), projectId: row.project_id, project: `${row.project_code}${row.project_name ? ` · ${row.project_name}` : ""}`, projectCode: row.project_code,
    taskId: row.task_id, task: row.task_code ? `${row.task_code} · ${row.task_title}` : null, claimantId: row.claimant_user_id, claimant: names.get(row.claimant_user_id) ?? "Former user",
    enteredBy: row.entered_by && row.entered_by !== row.claimant_user_id ? names.get(row.entered_by) ?? null : null,
    expenseDate: row.day ?? day(row.expense_date), categoryId: row.category_id, category: row.category_name, categoryCode: row.category_code, budgetCategory: row.budget_category, description: row.description,
    amount: moneyOut(row.amount), currency: row.currency, exchangeRate: String(row.exchange_rate), baseAmount: moneyOut(row.base_amount), baseCurrency: row.base_currency,
    paymentSource: row.payment_source, paymentSourceLabel: SOURCE_LABEL[row.payment_source], paymentReference: row.payment_reference,
    supplierInvoice: { number: row.supplier_invoice_number, date: day(row.supplier_invoice_date), gstin: row.supplier_gstin, taxable: moneyOut(row.taxable_amount), cgst: moneyOut(row.cgst_amount),
      sgst: moneyOut(row.sgst_amount), igst: moneyOut(row.igst_amount) },
    vendorBillLineId: row.vendor_bill_line_id, vendorBillId: row.vendor_bill_id,
    status: row.status, statusLabel: STATUS_LABEL[row.status], version: row.row_version, submittedAt: row.submitted_at, approvedAt: row.approved_at, approvedBy: names.get(row.approved_by) ?? null,
    overLimit: row.over_limit, receipts: row.receipts ?? 0, receiptRequired: row.receipt_required, receiptException: row.receipt_exception_reason,
    receiptExceptionAcceptedBy: names.get(row.receipt_exception_by) ?? null,
    missingReceipt: row.receipt_required && !(row.receipts ?? 0),
    financeStatus: row.finance_status, reimbursable: row.reimbursable, reimbursementStatus: row.reimbursement_status, reimbursementLabel: REIMBURSEMENT_LABEL[row.reimbursement_status],
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (can.cost || can.finance) Object.assign(out, { taxTreatment: row.tax_treatment, taxLabel: TAX_LABEL[row.tax_treatment], costBasis: moneyOut(row.cost_basis), recognitionDate: day(row.recognition_date),
    financeNote: row.finance_note, financeReviewedBy: names.get(row.finance_reviewed_by) ?? null, financeReviewedAt: row.finance_reviewed_at });
  if (can.billing) Object.assign(out, { billingClassification: row.billing_classification, classificationLabel: CLASSIFICATION_LABEL[row.billing_classification], billingStatus: row.billing_status,
    billingLabel: BILLING_LABEL[row.billing_status], rechargeAmount: moneyOut(row.recharge_amount), rechargeSalesOrderLineId: row.recharge_sales_order_line_id });
  const owner = row.claimant_user_id === c.userId || row.entered_by === c.userId;
  const open = ["DRAFT", "CHANGES_REQUESTED"].includes(row.status);
  out.can = {
    edit: open && owner && has(c, EXPENSE.editDraft), submit: open && owner && has(c, EXPENSE.submit), withdraw: ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"].includes(row.status) && owner,
    approve: row.status === "SUBMITTED" && can.approve, finance: row.status === "APPROVED" && row.finance_status !== "VERIFIED" && can.finance && row.claimant_user_id !== c.userId,
    reimburse: can.finance && ["PENDING_PAYMENT", "PARTIALLY_PAID"].includes(row.reimbursement_status), billing: (can.lead && has(c, EXPENSE.approve)) || can.finance,
    correct: row.status === "APPROVED" && (owner || can.correct), receipts: (open && owner) || (can.finance && row.finance_status !== "VERIFIED"),
  };
  return out;
}
async function namesFor(client, rows) {
  return userNames(client, rows.flatMap((row) => [row.claimant_user_id, row.entered_by, row.approved_by, row.finance_reviewed_by, row.receipt_exception_by]));
}

// ------------------------------------------------------------------ one expense
export async function getProjectExpense(client, c, expenseId) {
  const { expense, can } = await expenseScope(client, c, expenseId);
  const row = (await client.query(`${EXPENSE_SELECT} WHERE expense.organization_id = $1 AND expense.id = $2`, [c.organizationId, expense.id])).rows[0];
  const events = (await client.query(`SELECT * FROM tenant.project_expense_events WHERE organization_id = $1 AND expense_id = $2 ORDER BY occurred_at`, [c.organizationId, expense.id])).rows;
  const reimbursement = (await client.query(`SELECT * FROM tenant.project_expense_reimbursements WHERE organization_id = $1 AND expense_id = $2 ORDER BY requested_at DESC LIMIT 1`, [c.organizationId, expense.id])).rows[0] ?? null;
  const payments = reimbursement ? (await client.query(`SELECT * FROM tenant.project_expense_reimbursement_payments WHERE reimbursement_id = $1 ORDER BY recorded_at`, [reimbursement.id])).rows : [];
  const allocations = (can.cost || can.finance) ? (await client.query(`SELECT * FROM tenant.project_expense_cost_allocations WHERE organization_id = $1 AND expense_id = $2 ORDER BY created_at`, [c.organizationId, expense.id])).rows : [];
  const corrections = (await client.query(`SELECT * FROM tenant.project_expense_corrections WHERE organization_id = $1 AND expense_id = $2 ORDER BY requested_at DESC`, [c.organizationId, expense.id])).rows;
  const recharge = can.billing ? (await client.query(`SELECT allocation.amount, allocation.status, request.id AS request_id, request.request_number, request.status AS request_status FROM tenant.project_expense_billing_allocations allocation
      JOIN tenant.project_expense_billing_requests request ON request.id = allocation.request_id WHERE allocation.expense_id = $1 ORDER BY allocation.created_at DESC`, [expense.id])).rows : [];
  const names = await userNames(client, [...(await namesFor(client, [row])).keys(), ...events.map((e) => e.actor_user_id), ...payments.map((p) => p.recorded_by), ...corrections.flatMap((x) => [x.requested_by, x.decided_by])]);
  const out = present(c, row, names, can);
  return {
    ...out,
    duplicates: (can.approve || can.finance || can.mine) && !["WITHDRAWN", "REJECTED"].includes(row.status) ? await duplicatesOf(client, c, expense) : [],
    history: events.map((e) => ({ id: e.id, action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, actor: names.get(e.actor_user_id) ?? "System", at: e.occurred_at, version: e.expense_version })),
    reimbursement: reimbursement ? { amount: moneyOut(reimbursement.amount), paid: moneyOut(reimbursement.paid_amount), outstanding: subMoney(reimbursement.amount, reimbursement.paid_amount), status: reimbursement.status,
      payments: payments.map((p) => ({ amount: moneyOut(p.amount), paidOn: day(p.paid_on), reference: p.reference, recordedBy: names.get(p.recorded_by) ?? null, at: p.recorded_at })) } : null,
    allocations: allocations.map((a) => ({ id: a.id, source: a.source_module, amount: moneyOut(a.amount), status: a.status, recognitionDate: day(a.recognition_date), reversalReason: a.reversal_reason })),
    corrections: corrections.map((x) => ({ id: x.id, number: `EC-${x.correction_number}`, kind: x.kind, reason: x.reason, changes: x.changes, original: x.original, impact: x.impact, status: x.status,
      requestedBy: names.get(x.requested_by) ?? null, requestedAt: x.requested_at, decidedBy: names.get(x.decided_by) ?? null, decidedAt: x.decided_at, note: x.decision_note,
      canDecide: x.status === "REQUESTED" && can.correct && x.requested_by !== c.userId && row.claimant_user_id !== c.userId })),
    recharge: recharge.map((r) => ({ requestId: r.request_id, number: `ER-${r.request_number}`, amount: moneyOut(r.amount), status: r.status, requestStatus: r.request_status })),
  };
}

// ------------------------------------------------------------------ the queues
// filters: { view: mine | team | approvals | finance | reimbursements | corrections | billing | all, projectId?, status?, categoryId?, claimantId?, from?, to?, search?, sort?, direction?, page?, pageSize? }
export const EXPENSE_VIEWS = Object.freeze(["mine", "team", "approvals", "finance", "reimbursements", "corrections", "billing", "all"]);
export async function listProjectExpenses(client, c, filters = {}) {
  const view = EXPENSE_VIEWS.includes(filters.view) ? filters.view : "mine";
  const finance = has(c, EXPENSE.finance);
  const team = has(c, EXPENSE.viewTeam);
  if (view === "mine" && !has(c, EXPENSE.viewOwn)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (["finance", "reimbursements"].includes(view) && !finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  if (["team", "approvals", "billing", "corrections", "all"].includes(view) && !team && !finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  // Team scope: projects the person leads (their manager, or all projects with the portfolio view).
  const leads = seesAll(c) ? "(TRUE OR $2::uuid IS NULL)" : "(project.manager_user_id = $2 OR EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = project.id AND member.user_id = $2 AND member.left_at IS NULL AND member.role = 'MANAGER'))";
  const teamScope = finance ? "TRUE" : team ? leads : "FALSE";
  const where = ["expense.organization_id = $1"];
  switch (view) {
    case "mine": where.push("(expense.claimant_user_id = $2 OR expense.entered_by = $2)"); break;
    case "team": where.push(`(${teamScope})`, "expense.status <> 'DRAFT'"); break;
    case "approvals": where.push(`(${team && has(c, EXPENSE.approve) ? leads : "FALSE"})`, "expense.status = 'SUBMITTED'", "expense.claimant_user_id IS DISTINCT FROM $2"); break;
    case "finance": where.push("expense.status = 'APPROVED'", "expense.finance_status <> 'VERIFIED'", "expense.claimant_user_id IS DISTINCT FROM $2"); break;
    case "reimbursements": where.push("expense.reimbursement_status IN ('PENDING_PAYMENT', 'PARTIALLY_PAID', 'ADJUSTMENT_REQUIRED')"); break;
    case "corrections": where.push(`(${teamScope} OR expense.claimant_user_id = $2)`, "expense.status = 'CORRECTION_REQUIRED'"); break;
    case "billing": where.push(`(${teamScope})`, "expense.billing_status IN ('ELIGIBILITY_PENDING', 'ELIGIBLE_UNBILLED', 'RESERVED_FOR_BILLING', 'ADJUSTMENT_REQUIRED')", "expense.status IN ('APPROVED', 'CORRECTION_REQUIRED')"); break;
    default: where.push(`((${teamScope}) OR expense.claimant_user_id = $2 OR expense.entered_by = $2)`);
  }
  if (filters.projectId) where.push(`expense.project_id = ${bind(uuid(filters.projectId, "Project"))}`);
  if (filters.status) where.push(`expense.status = ANY(${bind(String(filters.status).split(",").map((s) => s.trim().toUpperCase()))}::text[])`);
  if (filters.categoryId) where.push(`expense.category_id = ${bind(uuid(filters.categoryId, "Category"))}`);
  if (filters.claimantId) where.push(`expense.claimant_user_id = ${bind(uuid(filters.claimantId, "Claimant"))}`);
  if (filters.from) where.push(`expense.expense_date >= ${bind(isoDay(filters.from))}::date`);
  if (filters.to) where.push(`expense.expense_date <= ${bind(isoDay(filters.to))}::date`);
  if (filters.source) where.push(`expense.payment_source = ${bind(String(filters.source).toUpperCase())}`);
  if (filters.search) {
    const term = bind(`%${text(filters.search, 100).toLowerCase().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`);
    where.push(`(lower(expense.description) LIKE ${term} OR lower(project.project_code) LIKE ${term} OR lower(COALESCE(project.name, '')) LIKE ${term} OR ('exp-' || lpad(expense.expense_number::text, 6, '0')) LIKE ${term}
      OR lower(COALESCE(expense.supplier_invoice_number, '')) LIKE ${term})`);
  }
  const SORT = { date: "expense.expense_date", amount: "expense.base_amount", code: "expense.expense_number", project: "project.project_code", status: "expense.status", updated: "expense.updated_at" };
  const order = `${SORT[filters.sort] ?? "expense.expense_date"} ${filters.direction === "asc" ? "ASC" : "DESC"}, expense.expense_number DESC`;
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
  const page = Math.max(1, Number(filters.page) || 1);
  const counted = (await client.query(`SELECT count(*) AS n, COALESCE(sum(expense.base_amount), 0) AS amount FROM tenant.project_expenses expense JOIN tenant.projects project ON project.id = expense.project_id
     WHERE ${where.join(" AND ")}`, values)).rows[0];
  const total = Number(counted.n);
  const sum = counted.amount;
  const rows = (await client.query(`${EXPENSE_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  const names = await namesFor(client, rows);
  const items = [];
  for (const row of rows) {
    const access = { visible: true, all: seesAll(c), manager: row.manager_user_id === c.userId };
    items.push(present(c, row, names, expenseRights(c, access, row)));
  }
  const policy = await expensePolicy(client, c);
  return { view, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), totalAmount: moneyOut(sum), currency: policy.currency, items,
    can: { create: has(c, EXPENSE.create), finance, team: team || finance, export: has(c, EXPENSE.export) } };
}

// ------------------------------------------------------------------ a project's expense summary
// Each figure is one stage of the spending; they are shown side by side and never summed into a "total expenses".
export async function getProjectExpenseSummary(client, c, projectId) {
  const { project, access } = await expenseProject(client, c, projectId);
  const can = expenseRights(c, access);
  const mineOnly = !can.team && !can.finance;
  const values = [c.organizationId, project.id, c.userId ?? null];
  const scope = mineOnly ? "AND (claimant_user_id = $3 OR entered_by = $3)" : "AND ($3::uuid IS NULL OR TRUE)";
  const claims = (await client.query(`SELECT
      COALESCE(sum(base_amount) FILTER (WHERE status NOT IN ('WITHDRAWN', 'REJECTED')), 0) AS reported,
      COALESCE(sum(base_amount) FILTER (WHERE status = 'DRAFT' OR status = 'CHANGES_REQUESTED'), 0) AS draft,
      COALESCE(sum(base_amount) FILTER (WHERE status = 'SUBMITTED'), 0) AS awaiting,
      COALESCE(sum(base_amount) FILTER (WHERE status IN ('APPROVED', 'CORRECTION_REQUIRED')), 0) AS approved,
      COALESCE(sum(base_amount) FILTER (WHERE status IN ('APPROVED', 'CORRECTION_REQUIRED') AND finance_status <> 'VERIFIED'), 0) AS pending_recognition,
      COALESCE(sum(recharge_amount) FILTER (WHERE billing_status = 'ELIGIBLE_UNBILLED'), 0) AS recharge_eligible,
      COALESCE(sum(recharge_amount) FILTER (WHERE billing_status = 'RESERVED_FOR_BILLING'), 0) AS recharge_reserved,
      COALESCE(sum(recharge_amount) FILTER (WHERE billing_status = 'INVOICED'), 0) AS recharge_invoiced,
      count(*) FILTER (WHERE status NOT IN ('WITHDRAWN', 'REJECTED'))::int AS claims, count(*) FILTER (WHERE status = 'SUBMITTED')::int AS awaiting_count
     FROM tenant.project_expenses WHERE organization_id = $1 AND project_id = $2 ${scope}`, values)).rows[0];
  const policy = await expensePolicy(client, c);
  const out = {
    projectId: project.id, currency: policy.currency, measures: "Each figure is a separate stage of the same spending — they are not added together.",
    claims: { reported: moneyOut(claims.reported), draft: moneyOut(claims.draft), awaitingApproval: moneyOut(claims.awaiting), approved: moneyOut(claims.approved), count: claims.claims, awaitingCount: claims.awaiting_count },
    scope: mineOnly ? "MINE" : "PROJECT",
    can: { create: can.create && project.status !== "DRAFT", cost: can.cost, billing: can.billing, finance: can.finance, lead: can.lead, export: has(c, EXPENSE.export) },
  };
  if (can.cost && !mineOnly) {
    const allocations = (await client.query(`SELECT allocation.source_module, allocation.status, allocation.amount, allocation.category_id, category.name AS category, bill.status AS bill_status
       FROM tenant.project_expense_cost_allocations allocation LEFT JOIN tenant.project_expense_categories category ON category.id = allocation.category_id
       LEFT JOIN tenant.accounting_vendor_bills bill ON allocation.source_module = 'SUPPLIER_BILL' AND bill.id = allocation.source_id
      WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND allocation.status <> 'REVERSED'`, [c.organizationId, project.id])).rows;
    // A supplier bill's cost counts once the bill is approved in Finance (a draft or cancelled bill is not cost).
    const recognized = allocations.filter((row) => row.source_module !== "SUPPLIER_BILL" || BILL_RECOGNIZED.includes(row.bill_status));
    const bySource = Object.fromEntries(["EXPENSE_CLAIM", "SUPPLIER_BILL", "GOODS_ISSUE"].map((key) => [key, addMoney("0", ...recognized.filter((row) => row.source_module === key).map((row) => row.amount))]));
    const byCategory = new Map();
    for (const row of recognized) byCategory.set(row.category ?? "Uncategorized", addMoney(byCategory.get(row.category ?? "Uncategorized") ?? "0", row.amount));
    // Open purchase commitments: confirmed purchase orders linked to the project, less what their bills already recognized here.
    // (net of tax, like the bill lines that settle them)
    const commitments = (await client.query(`SELECT po.id, po.purchase_order_number, po.taxable_total AS grand_total,
        COALESCE((SELECT sum(allocation.amount) FROM tenant.project_expense_cost_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.id = allocation.source_id
          WHERE allocation.source_module = 'SUPPLIER_BILL' AND allocation.project_id = $2 AND allocation.status <> 'REVERSED' AND bill.source_purchase_order_id = po.id), 0) AS billed
       FROM tenant.project_links link JOIN tenant.purchase_orders po ON po.id = link.source_id AND po.status = 'confirmed'
      WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'PURCHASE_ORDER' AND link.removed_at IS NULL`, [c.organizationId, project.id])).rows;
    const reimbursements = (await client.query(`SELECT COALESCE(sum(reimbursement.amount - reimbursement.paid_amount) FILTER (WHERE reimbursement.status IN ('PENDING_PAYMENT', 'PARTIALLY_PAID')), 0) AS outstanding,
        COALESCE(sum(reimbursement.paid_amount), 0) AS paid FROM tenant.project_expense_reimbursements reimbursement JOIN tenant.project_expenses expense ON expense.id = reimbursement.expense_id
       WHERE reimbursement.organization_id = $1 AND expense.project_id = $2 AND reimbursement.status <> 'CANCELLED'`, [c.organizationId, project.id])).rows[0];
    out.cost = {
      recognized: addMoney("0", ...recognized.map((row) => row.amount)), pendingRecognition: moneyOut(claims.pending_recognition), bySource,
      pendingSupplierBills: addMoney("0", ...allocations.filter((row) => row.source_module === "SUPPLIER_BILL" && !BILL_RECOGNIZED.includes(row.bill_status)).map((row) => row.amount)),
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => Number(b.amount) - Number(a.amount)),
      openCommitments: addMoney("0", ...commitments.map((row) => { const left = subMoney(row.grand_total, row.billed); return Number(left) > 0 ? left : "0"; })),
      commitments: commitments.map((row) => ({ id: row.id, number: row.purchase_order_number, total: moneyOut(row.grand_total), billed: moneyOut(row.billed) })),
      reimbursementsOutstanding: moneyOut(reimbursements.outstanding), reimbursementsPaid: moneyOut(reimbursements.paid),
      // Project Budgeting is a later feature: until it exists there is no budget to compare against.
      budget: { available: false, message: "No project budget yet — budget vs actual appears once Project Budgeting is set up." },
    };
  }
  if (can.billing && !mineOnly) out.billing = { eligible: moneyOut(claims.recharge_eligible), reserved: moneyOut(claims.recharge_reserved), invoiced: moneyOut(claims.recharge_invoiced) };
  return out;
}

// ------------------------------------------------------------------ the options a form needs
export async function getExpenseOptions(client, c, filters = {}) {
  await ensureExpenseCategories(client, c);
  const policy = await expensePolicy(client, c);
  const categories = (await client.query(`SELECT id, code, name, description, receipt_required, description_required FROM tenant.project_expense_categories WHERE organization_id = $1 AND active ORDER BY sort_order, name`,
    [c.organizationId])).rows;
  // Projects the person can claim on: visible, past the draft, and on its team (or leading it).
  const projects = (await client.query(`SELECT project.id, project.project_code, project.name, project.status FROM tenant.projects project WHERE project.organization_id = $1 AND project.deleted_at IS NULL
      AND project.archived_at IS NULL AND project.status <> 'DRAFT' AND ${visibilitySql(c, "project", "$2")}
      AND (project.manager_user_id = $2 OR EXISTS (SELECT 1 FROM tenant.project_members member WHERE member.project_id = project.id AND member.user_id = $2) OR $3)
     ORDER BY project.project_code DESC LIMIT 500`, [c.organizationId, c.userId ?? null, seesAll(c) || isOwner(c)])).rows;
  const out = {
    currency: policy.currency, policy, categories: categories.map((row) => ({ id: row.id, code: row.code, name: row.name, description: row.description, receiptRequired: row.receipt_required, descriptionRequired: row.description_required })),
    projects: projects.map((row) => ({ id: row.id, code: row.project_code, name: row.name, status: row.status, label: `${row.project_code}${row.name ? ` · ${row.name}` : ""}` })),
    sources: Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })), tax: Object.entries(TAX_LABEL).map(([value, label]) => ({ value, label })),
    can: { create: has(c, EXPENSE.create), finance: has(c, EXPENSE.finance) },
  };
  if (filters.projectId) {
    const { project, access } = await expenseProject(client, c, filters.projectId);
    const can = expenseRights(c, access);
    out.tasks = (await client.query(`SELECT id, task_code, title FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status <> 'CANCELLED' ORDER BY task_code`, [c.organizationId, project.id])).rows
      .map((row) => ({ id: row.id, label: `${row.task_code} · ${row.title}` }));
    if (can.lead) {
      const members = (await client.query(`SELECT member.user_id FROM tenant.project_members member WHERE member.project_id = $1 AND member.left_at IS NULL`, [project.id])).rows.map((row) => row.user_id);
      const names = await userNames(client, [project.manager_user_id, ...members]);
      out.claimants = [...new Set([project.manager_user_id, ...members].filter(Boolean))].map((id) => ({ id, name: names.get(id) ?? "Someone" }));
      out.salesOrderLines = project.customer_id ? (await client.query(`SELECT line.id, sales_order.sales_order_number, line.item_name_snapshot, line.quantity, line.unit_price FROM tenant.project_links link
          JOIN tenant.sales_orders sales_order ON sales_order.id = link.source_id AND sales_order.party_id = $3 AND sales_order.lifecycle_status NOT IN ('draft', 'cancelled')
          JOIN tenant.sales_order_lines line ON line.sales_order_version_id = sales_order.current_version_id
         WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'SALES_ORDER' AND link.removed_at IS NULL ORDER BY sales_order.sales_order_number, line.sequence`,
      [c.organizationId, project.id, project.customer_id])).rows.map((row) => ({ id: row.id, label: `${row.sales_order_number} · ${row.item_name_snapshot}` })) : [];
    }
    if (can.finance || can.lead) {
      out.goodsIssues = (await client.query(`SELECT issue.id, issue.document_number, to_char(issue.issue_date, 'YYYY-MM-DD') AS d, issue.issued_value FROM tenant.goods_issues issue WHERE issue.organization_id = $1 AND issue.project_id = $2
          AND issue.status = 'posted' AND NOT EXISTS (SELECT 1 FROM tenant.project_expense_cost_allocations allocation WHERE allocation.source_module = 'GOODS_ISSUE' AND allocation.source_id = issue.id AND allocation.status <> 'REVERSED')
         ORDER BY issue.issue_date DESC LIMIT 50`, [c.organizationId, project.id])).rows.map((row) => ({ id: row.id, label: `${row.document_number} · ${row.d}${row.issued_value !== null ? ` · ${moneyOut(Number(row.issued_value).toFixed(2))}` : ""}` }));
    }
  }
  return out;
}
// Supplier bill lines Finance may allocate (with what is left of each). filters: { search }
export async function searchSupplierBillLines(client, c, filters = {}) {
  if (!has(c, EXPENSE.finance)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const term = text(filters.search, 80);
  const rows = (await client.query(`SELECT line.id, line.description, line.net_amount, bill.bill_number, bill.supplier_invoice_number, bill.status, to_char(bill.bill_date, 'YYYY-MM-DD') AS bill_date,
      COALESCE((SELECT sum(allocation.amount) FROM tenant.project_expense_cost_allocations allocation WHERE allocation.source_module = 'SUPPLIER_BILL' AND allocation.source_line_id = line.id AND allocation.status <> 'REVERSED'), 0) AS used
     FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id
    WHERE line.organization_id = $1 AND bill.status NOT IN ('draft', 'cancelled', 'reversed')
      AND ($2 = '' OR bill.bill_number ILIKE '%' || $2 || '%' OR COALESCE(bill.supplier_invoice_number, '') ILIKE '%' || $2 || '%' OR line.description ILIKE '%' || $2 || '%')
    ORDER BY bill.bill_date DESC, line.sequence LIMIT 50`, [c.organizationId, term.replace(/[%_\\]/g, (ch) => `\\${ch}`)])).rows;
  return rows.map((row) => ({ id: row.id, label: `${row.bill_number}${row.supplier_invoice_number ? ` (${row.supplier_invoice_number})` : ""} · ${row.description}`, net: moneyOut(row.net_amount),
    remaining: subMoney(row.net_amount, row.used), billStatus: row.status, billDate: row.bill_date })).filter((row) => Number(row.remaining) > 0);
}
// Recharge requests of a project (or all the person may see, for Sales).
export async function listExpenseRechargeRequests(client, c, filters = {}) {
  if (!has(c, EXPENSE.viewBilling) && !has(c, "sales.invoice.create")) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT request.*, project.project_code, project.name AS project_name FROM tenant.project_expense_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
     WHERE request.organization_id = $1 AND ($2::uuid IS NULL OR request.project_id = $2) AND ${visibilitySql(c, "project", "$3")} ORDER BY request.created_at DESC LIMIT 200`,
  [c.organizationId, filters.projectId ? uuid(filters.projectId, "Project") : null, c.userId ?? null])).rows;
  const names = await userNames(client, rows.map((row) => row.created_by));
  return rows.map((row) => ({ id: row.id, number: `ER-${row.request_number}`, projectId: row.project_id, project: `${row.project_code}${row.project_name ? ` · ${row.project_name}` : ""}`, status: row.status,
    total: moneyOut(row.total_amount), currency: row.currency, createdBy: names.get(row.created_by) ?? null, createdAt: row.created_at, invoiceLineId: row.customer_invoice_line_id, cancelReason: row.cancel_reason }));
}

// ------------------------------------------------------------------ reports
export const EXPENSE_REPORTS = Object.freeze(["by-project", "by-category", "my-claims", "pending-approval", "approved", "reimbursement-status", "cost-by-source", "budget-vs-actual",
  "billable-vs-nonbillable", "approved-unbilled", "duplicates", "by-employee", "tax-review", "corrections", "reconciliation"]);
export async function getExpenseReport(client, c, kind = "by-project", filters = {}) {
  if (!EXPENSE_REPORTS.includes(kind)) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Unknown report.");
  const finance = has(c, EXPENSE.finance);
  if (kind === "my-claims") return (await listProjectExpenses(client, c, { view: "mine", pageSize: 200 })).items;
  if (!has(c, EXPENSE.viewTeam) && !finance) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const all = await listProjectExpenses(client, c, { view: "all", pageSize: 200, from: filters.from, to: filters.to, projectId: filters.projectId });
  const items = all.items.filter((row) => !["WITHDRAWN", "REJECTED"].includes(row.status));
  const group = (key, label) => {
    const map = new Map();
    for (const row of items) {
      const k = row[key] ?? "—";
      const entry = map.get(k) ?? { key: k, label: label(row), claims: 0, reported: "0", awaiting: "0", approved: "0" };
      entry.claims += 1; entry.reported = addMoney(entry.reported, row.baseAmount);
      if (row.status === "SUBMITTED") entry.awaiting = addMoney(entry.awaiting, row.baseAmount);
      if (["APPROVED", "CORRECTION_REQUIRED"].includes(row.status)) entry.approved = addMoney(entry.approved, row.baseAmount);
      map.set(k, entry);
    }
    return [...map.values()].sort((a, b) => Number(b.reported) - Number(a.reported));
  };
  const scopeIds = [...new Set(items.map((row) => row.projectId))];
  switch (kind) {
    case "by-project": return group("projectId", (row) => row.project);
    case "by-category": return group("categoryId", (row) => row.category);
    case "by-employee": return group("claimantId", (row) => row.claimant);
    case "pending-approval": return items.filter((row) => row.status === "SUBMITTED");
    case "approved": return items.filter((row) => ["APPROVED", "CORRECTION_REQUIRED"].includes(row.status));
    case "reimbursement-status": return items.filter((row) => row.reimbursable && row.status !== "DRAFT");
    case "billable-vs-nonbillable": {
      const map = new Map();
      for (const row of items.filter((x) => x.billingClassification)) {
        const entry = map.get(row.billingClassification) ?? { key: row.billingClassification, label: row.classificationLabel, claims: 0, amount: "0", recharge: "0" };
        entry.claims += 1; entry.amount = addMoney(entry.amount, row.baseAmount); entry.recharge = addMoney(entry.recharge, row.rechargeAmount ?? "0");
        map.set(row.billingClassification, entry);
      }
      return [...map.values()];
    }
    case "approved-unbilled": return items.filter((row) => row.billingStatus === "ELIGIBLE_UNBILLED");
    case "duplicates": {
      const out = [];
      for (const row of items.filter((x) => x.status !== "DRAFT").slice(0, 200)) {
        const expense = (await client.query(`SELECT * FROM tenant.project_expenses WHERE id = $1`, [row.id])).rows[0];
        const dupes = await duplicatesOf(client, c, expense);
        if (dupes.length) out.push({ ...row, duplicates: dupes });
      }
      return out;
    }
    case "tax-review": return items.filter((row) => (row.supplierInvoice.cgst || row.supplierInvoice.sgst || row.supplierInvoice.igst || row.paymentSource === "SUPPLIER")
      && (row.taxTreatment === "PENDING" || (!row.supplierInvoice.gstin && row.paymentSource !== "EMPLOYEE")));
    case "corrections": {
      const rows = scopeIds.length ? (await client.query(`SELECT correction.*, expense.expense_number FROM tenant.project_expense_corrections correction JOIN tenant.project_expenses expense ON expense.id = correction.expense_id
          WHERE correction.organization_id = $1 AND correction.project_id = ANY($2::uuid[]) ORDER BY correction.requested_at DESC LIMIT 300`, [c.organizationId, scopeIds])).rows : [];
      const names = await userNames(client, rows.flatMap((row) => [row.requested_by, row.decided_by]));
      return rows.map((row) => ({ id: row.id, number: `EC-${row.correction_number}`, expenseId: row.expense_id, expense: expenseCode(row), kind: row.kind, reason: row.reason, status: row.status,
        requestedBy: names.get(row.requested_by) ?? null, requestedAt: row.requested_at, decidedBy: names.get(row.decided_by) ?? null, flags: row.impact?.flags ?? [] }));
    }
    case "cost-by-source": case "budget-vs-actual": case "reconciliation": {
      if (!has(c, EXPENSE.viewCost)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
      const projects = scopeIds.length ? scopeIds : (await client.query(`SELECT DISTINCT project_id FROM tenant.project_expense_cost_allocations WHERE organization_id = $1`, [c.organizationId])).rows.map((row) => row.project_id);
      const out = [];
      for (const id of projects.slice(0, 200)) {
        let summary;
        try { summary = await getProjectExpenseSummary(client, c, id); } catch { continue; }
        if (!summary.cost) continue;
        const project = (await client.query(`SELECT project_code, name FROM tenant.projects WHERE id = $1`, [id])).rows[0];
        const row = { projectId: id, project: `${project.project_code}${project.name ? ` · ${project.name}` : ""}`, ...summary.cost, claimsApproved: summary.claims.approved };
        if (kind === "reconciliation") {
          // Claims verified must equal their recognized allocations; a supplier bill cancelled after its allocation needs a reversal.
          const issues = (await client.query(`SELECT
              (SELECT count(*) FROM tenant.project_expenses expense WHERE expense.project_id = $1 AND expense.finance_status = 'VERIFIED' AND expense.status IN ('APPROVED', 'CORRECTION_REQUIRED')
                 AND NOT EXISTS (SELECT 1 FROM tenant.project_expense_cost_allocations allocation WHERE allocation.expense_id = expense.id AND allocation.status <> 'REVERSED'))::int AS verified_without_cost,
              (SELECT count(*) FROM tenant.project_expense_cost_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.id = allocation.source_id
                 WHERE allocation.project_id = $1 AND allocation.source_module = 'SUPPLIER_BILL' AND allocation.status <> 'REVERSED' AND bill.status IN ('cancelled', 'reversed'))::int AS cancelled_bills,
              (SELECT count(*) FROM tenant.project_expense_reimbursements reimbursement JOIN tenant.project_expenses expense ON expense.id = reimbursement.expense_id
                 WHERE expense.project_id = $1 AND reimbursement.status = 'ADJUSTMENT_REQUIRED')::int AS reimbursement_adjustments,
              (SELECT count(*) FROM tenant.project_expenses expense WHERE expense.project_id = $1 AND expense.billing_status = 'ADJUSTMENT_REQUIRED')::int AS billing_adjustments`, [id])).rows[0];
          Object.assign(row, { issues, balanced: !Object.values(issues).some((value) => Number(value) > 0) });
        }
        out.push(row);
      }
      return out;
    }
    default: return [];
  }
}
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportProjectExpenses(client, c, filters = {}) {
  if (!has(c, EXPENSE.export)) throw expenseError(403, "PROJECT_EXPENSE_PERMISSION_DENIED");
  const list = await listProjectExpenses(client, c, { ...filters, view: filters.view ?? "all", pageSize: 200 });
  const items = [...list.items];
  for (let page = 2; page <= Math.min(list.pages, 100); page += 1) items.push(...(await listProjectExpenses(client, c, { ...filters, view: filters.view ?? "all", pageSize: 200, page })).items);
  const header = ["Expense", "Date", "Project", "Task", "Claimant", "Category", "Description", "Amount", "Currency", "Company amount", "Paid by", "Status", "Finance", "Reimbursement", "Billing", "Recharge", "Cost basis"];
  const lines = items.map((row) => [row.code, row.expenseDate, row.project, row.task ?? "", row.claimant, row.category, row.description, row.amount, row.currency, row.baseAmount, row.paymentSourceLabel, row.statusLabel,
    row.financeStatus, row.reimbursementLabel, row.billingLabel ?? "", row.rechargeAmount ?? "", row.costBasis ?? ""]);
  return { fileName: "project-expenses.csv", csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: items.length };
}
export async function getExpenseSettings(client, c) {
  return { ...(await expensePolicy(client, c)), can: { manage: has(c, "projects.settings.manage") } };
}
