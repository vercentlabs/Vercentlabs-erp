// Projects — Project Expenses, the rules: permissions and errors, the three separate states (approval, reimbursement, customer billing),
// money handled as exact decimals, the company's expense policy and categories, who may see or act on an expense, and when a project
// accepts an expense for a given date. A category is a reporting classification — never an accounting or tax decision.
import { has, isOwner, isoDay, projectError, seesAll, text, uuid, visibleProject } from "../project-core.js";

export const EXPENSE = Object.freeze({
  viewOwn: "projects.expenses.view_own", create: "projects.expenses.create", editDraft: "projects.expenses.edit_draft", submit: "projects.expenses.submit",
  viewTeam: "projects.expenses.view_team", approve: "projects.expenses.approve", finance: "projects.expenses.finance_review", correct: "projects.expenses.correct",
  viewCost: "projects.expenses.view_cost", viewBilling: "projects.expenses.view_billing", export: "projects.expenses.export",
});
export const STATUS_LABEL = Object.freeze({ DRAFT: "Draft", SUBMITTED: "Submitted", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", REJECTED: "Rejected", WITHDRAWN: "Withdrawn",
  CORRECTION_REQUIRED: "Correction requested" });
export const REIMBURSEMENT_LABEL = Object.freeze({ NOT_APPLICABLE: "Not applicable", NOT_REQUESTED: "Not requested", PENDING_PAYMENT: "Awaiting payment", PARTIALLY_PAID: "Partly paid",
  PAID: "Paid", ADJUSTMENT_REQUIRED: "Adjustment required" });
export const BILLING_LABEL = Object.freeze({ NON_BILLABLE: "Not billable", INCLUDED_IN_FIXED_FEE: "Included in the fixed fee", ELIGIBILITY_PENDING: "Recharge to be decided",
  ELIGIBLE_UNBILLED: "Rechargeable, not billed", RESERVED_FOR_BILLING: "Sent to Sales", INVOICED: "Invoiced", ADJUSTMENT_REQUIRED: "Adjustment required" });
export const CLASSIFICATION_LABEL = Object.freeze({ NON_BILLABLE: "Not billable", INCLUDED_IN_FIXED_FEE: "Included in the fixed fee", RECHARGE_ELIGIBLE: "Rechargeable to the customer",
  ELIGIBILITY_PENDING: "Recharge to be decided" });
export const SOURCE_LABEL = Object.freeze({ EMPLOYEE: "I paid personally", COMPANY: "Company already paid", SUPPLIER: "Supplier invoice" });
export const TAX_LABEL = Object.freeze({ PENDING: "Finance to decide", NO_TAX: "No GST", RECOVERABLE: "GST recoverable (not project cost)", NON_RECOVERABLE: "GST is project cost" });

const MESSAGES = Object.freeze({
  PROJECT_EXPENSE_PROJECT_REQUIRED: "Select a Project.",
  PROJECT_EXPENSE_TASK_MISMATCH: "This Task belongs to another Project.",
  PROJECT_EXPENSE_AMOUNT_INVALID: "Enter a valid positive amount.",
  PROJECT_EXPENSE_RECEIPT_REQUIRED: "Add a receipt or request a missing-receipt exception.",
  PROJECT_EXPENSE_DUPLICATE_SUSPECTED: "A similar expense exists. Review it before submitting.",
  PROJECT_EXPENSE_CLAIMANT_INVALID: "You cannot submit this expense for the selected employee.",
  PROJECT_EXPENSE_POLICY_EXCEEDED: "This amount requires additional approval.",
  PROJECT_EXPENSE_SOURCE_ALREADY_ALLOCATED: "This financial source has already been allocated.",
  PROJECT_EXPENSE_BUDGET_REVIEW: "This expense may exceed the approved budget.",
  PROJECT_EXPENSE_ALREADY_APPROVED: "Use a correction request for an approved expense.",
  PROJECT_EXPENSE_REIMBURSEMENT_EXISTS: "Review the reimbursement before changing this claim.",
  PROJECT_EXPENSE_BILLING_ALLOCATED: "This expense is already linked to customer billing.",
  PROJECT_EXPENSE_PERIOD_CLOSED: "Request an authorized financial-period correction.",
  PROJECT_EXPENSE_PERMISSION_DENIED: "You do not have permission for this action.",
  PROJECT_EXPENSE_VERSION_CONFLICT: "This expense changed. Refresh and review.",
  PROJECT_EXPENSE_OUTCOME_UNKNOWN: "The previous action is being checked. Do not submit it again.",
  PROJECT_EXPENSE_NOT_FOUND: "This expense is not available.",
  PROJECT_EXPENSE_STATUS_INVALID: "This expense cannot do that in its current state.",
  PROJECT_EXPENSE_PROJECT_CLOSED: "This project does not accept new expenses for that date.",
  PROJECT_EXPENSE_INPUT_INVALID: "Check the details and try again.",
  PROJECT_EXPENSE_SELF_APPROVAL: "Someone else must approve your own expense.",
});
export const EXPENSE_MESSAGES = MESSAGES;
export const expenseError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);
export const keyOf = (input) => text(input?.idempotencyKey, 200) || null;

// ------------------------------------------------------------------ money: exact decimals, never floating point
const MONEY = /^\d{1,13}(\.\d{1,2})?$/;
export function money(value, field = "amount", { allowZero = false } = {}) {
  const raw = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : String(value ?? "").trim().replace(/,/g, "");
  if (!MONEY.test(raw)) throw expenseError(400, "PROJECT_EXPENSE_AMOUNT_INVALID", undefined, { field });
  const cents = toCents(raw);
  if (cents <= 0n && !(allowZero && cents === 0n)) throw expenseError(400, "PROJECT_EXPENSE_AMOUNT_INVALID", undefined, { field });
  return fromCents(cents);
}
export const toCents = (value) => {
  const [whole, fraction = ""] = String(value ?? "0").split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * 100n + BigInt((fraction + "00").slice(0, 2)));
};
export const fromCents = (cents) => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};
export const addMoney = (...values) => fromCents(values.reduce((sum, value) => sum + toCents(value ?? "0"), 0n));
export const subMoney = (a, b) => fromCents(toCents(a ?? "0") - toCents(b ?? "0"));
export const cmpMoney = (a, b) => { const d = toCents(a ?? "0") - toCents(b ?? "0"); return d > 0n ? 1 : d < 0n ? -1 : 0; };
export const moneyOut = (value) => (value === null || value === undefined ? null : fromCents(toCents(String(value))));

// ------------------------------------------------------------------ policy and categories
export async function expensePolicy(client, c) {
  const row = (await client.query(`SELECT expense_finance_review_required, expense_receipt_threshold, expense_manager_limit, expense_claim_deadline_days FROM tenant.project_settings WHERE organization_id = $1`,
    [c.organizationId])).rows[0] ?? {};
  const org = (await client.query(`SELECT upper(base_currency) AS currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0];
  return { financeReviewRequired: row.expense_finance_review_required ?? true, receiptThreshold: moneyOut(row.expense_receipt_threshold ?? "0"),
    managerLimit: row.expense_manager_limit === null || row.expense_manager_limit === undefined ? null : moneyOut(row.expense_manager_limit),
    deadlineDays: Number(row.expense_claim_deadline_days ?? 90), currency: org?.currency ?? "INR" };
}
const STANDARD = [["TRAVEL", "Travel", "Train, airfare, mileage", false, "TRAVEL", 10], ["LOCAL_TRANSPORT", "Local transport", "Taxi, auto, parking", false, "TRAVEL", 20],
  ["ACCOMMODATION", "Accommodation", "Hotel", false, "TRAVEL", 30], ["MEALS", "Meals", "Eligible business meals", false, "TRAVEL", 40],
  ["PROJECT_SUPPLIES", "Project supplies", "Stationery, consumables", false, "MATERIALS", 50], ["SOFTWARE_SERVICES", "Software & services", "Authorized external tools", false, "SERVICES", 60],
  ["EQUIPMENT_RENTAL", "Equipment rental", "Temporary equipment", false, "EQUIPMENT", 70], ["SUBCONTRACTOR", "Subcontractor services", "Supplier-provided work", false, "SERVICES", 80],
  ["COMMUNICATION", "Communication", "Internet or phone", false, "OTHER", 90], ["OTHER", "Other", "Describe what was bought and why", true, "OTHER", 100]];
// A company created after the migration gets the standard categories the first time it records an expense.
export async function ensureExpenseCategories(client, c) {
  if ((await client.query(`SELECT 1 FROM tenant.project_expense_categories WHERE organization_id = $1 LIMIT 1`, [c.organizationId])).rows[0]) return;
  for (const [code, name, description, explain, budget, order] of STANDARD) {
    await client.query(`INSERT INTO tenant.project_expense_categories (organization_id, code, name, description, description_required, budget_category, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (organization_id, code) DO NOTHING`, [c.organizationId, code, name, description, explain, budget, order]);
  }
}
export async function categoryOf(client, c, value) {
  await ensureExpenseCategories(client, c);
  const key = String(value ?? "").trim();
  if (!key) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose a category.", { field: "categoryId" });
  const byId = /^[0-9a-f-]{36}$/i.test(key);
  const row = (await client.query(`SELECT * FROM tenant.project_expense_categories WHERE organization_id = $1 AND ${byId ? "id = $2::uuid" : "code = upper($2)"}`, [c.organizationId, key])).rows[0];
  if (!row || !row.active) throw expenseError(400, "PROJECT_EXPENSE_INPUT_INVALID", "Choose an active category.", { field: "categoryId" });
  return row;
}

// ------------------------------------------------------------------ access
// The project, as this person may see it (someone who may not see it learns nothing about it).
export async function expenseProject(client, c, projectId) {
  if (!projectId) throw expenseError(400, "PROJECT_EXPENSE_PROJECT_REQUIRED", undefined, { field: "projectId" });
  try { uuid(projectId, "Project"); } catch { throw expenseError(400, "PROJECT_EXPENSE_PROJECT_REQUIRED", undefined, { field: "projectId" }); }
  try { return await visibleProject(client, c, projectId); } catch (failure) {
    if (failure?.status === 404 || failure?.status === 403) throw expenseError(404, "PROJECT_EXPENSE_PROJECT_REQUIRED", "This project is not available to you.", { field: "projectId" });
    throw failure;
  }
}
export const financeUser = (c) => has(c, EXPENSE.finance);
// What this person may do with this expense (or, without one, on this project).
export function expenseRights(c, access, expense = null) {
  const lead = Boolean(access?.all || access?.manager);
  const mine = Boolean(expense) && expense.claimant_user_id === c.userId;
  const team = has(c, EXPENSE.viewTeam) && lead;
  const finance = financeUser(c);
  return {
    lead, mine, team, finance,
    view: mine ? has(c, EXPENSE.viewOwn) || team || finance : team || finance,
    create: has(c, EXPENSE.create) && Boolean(access?.visible),
    createFor: has(c, EXPENSE.create) && lead,
    approve: has(c, EXPENSE.approve) && lead && !mine,
    finance,
    correct: has(c, EXPENSE.correct) && (lead || finance),
    cost: has(c, EXPENSE.viewCost) && (lead || finance || seesAll(c) || isOwner(c)),
    billing: has(c, EXPENSE.viewBilling) && (lead || finance || seesAll(c) || has(c, "sales.invoice.create")),
  };
}

// ------------------------------------------------------------------ the date rule
// Whether the project accepts an expense dated `day`: never on a draft; a project on hold, completed or cancelled still takes a claim for
// a date before it stopped (a late historical claim is not refused for the project's state today).
export async function projectAcceptsDate(client, c, project, day) {
  if (project.status === "DRAFT") throw expenseError(409, "PROJECT_EXPENSE_PROJECT_CLOSED", "A draft project does not take expenses yet — activate it first.");
  const stopped = async (status) => (await client.query(`SELECT to_char(max(occurred_at)::date, 'YYYY-MM-DD') AS d FROM tenant.project_status_events WHERE organization_id = $1 AND project_id = $2 AND to_status = $3`,
    [c.organizationId, project.id, status])).rows[0].d;
  if (["ON_HOLD", "COMPLETED", "CANCELLED"].includes(project.status)) {
    const since = (await stopped(project.status)) ?? (project.status === "COMPLETED" ? isoDay(project.completed_at) : null);
    if (since && day > since) {
      throw expenseError(409, "PROJECT_EXPENSE_PROJECT_CLOSED", project.status === "ON_HOLD" ? `The project is on hold since ${since}: new spending is paused.` : `The project was ${project.status === "COMPLETED" ? "completed" : "cancelled"} on ${since}: only earlier expenses can be claimed.`);
    }
  }
}
// The claimant was on the project's team (or its manager) on that day.
export async function onTeamOn(client, c, project, userId, day) {
  if (project.manager_user_id === userId) return true;
  return Boolean((await client.query(`SELECT 1 FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3
      AND (joined_at AT TIME ZONE 'UTC')::date <= $4::date AND (left_at IS NULL OR (left_at AT TIME ZONE 'UTC')::date >= $4::date) LIMIT 1`, [c.organizationId, project.id, userId, day])).rows[0]);
}
export const expenseCode = (row) => `EXP-${String(row.expense_number).padStart(6, "0")}`;
