// Projects — Project Cost, the rules: permissions and errors, the cost categories every source maps into (one primary category each), who
// may see totals, lines and confidential labor rates, and the money arithmetic (exact decimals). Labor and overhead are managerial cost
// allocations — never new General Ledger expense; supplier, expense and material costs come from the records that recognized them.
import { has, isOwner, projectError, seesAll, uuid, visibleProject } from "../project-core.js";

export const COST = Object.freeze({
  summary: "projects.cost.view_summary", detail: "projects.cost.view_detail", laborRate: "projects.cost.view_labor_rate", allocate: "projects.cost.allocate",
  approve: "projects.cost.approve_allocation", forecast: "projects.cost.forecast_edit", reconcile: "projects.cost.reconcile", profitability: "projects.cost.view_profitability",
  export: "projects.cost.export",
});
export const CATEGORIES = Object.freeze({
  LABOR: "Labor", TRAVEL: "Travel and accommodation", SUBCONTRACTORS: "Subcontractors", MATERIALS: "Materials", EQUIPMENT: "Equipment and rentals", SOFTWARE: "Software and services",
  OTHER_DIRECT: "Other direct expenses", OVERHEAD: "Allocated overhead",
});
export const SOURCE_LABEL = Object.freeze({ TIMESHEET: "Approved time", EXPENSE_CLAIM: "Expense claim", SUPPLIER_BILL: "Supplier bill", GOODS_ISSUE: "Material issue", OVERHEAD: "Overhead allocation" });
// Each expense category has exactly one cost category.
export const EXPENSE_CATEGORY = Object.freeze({
  TRAVEL: "TRAVEL", LOCAL_TRANSPORT: "TRAVEL", ACCOMMODATION: "TRAVEL", MEALS: "TRAVEL", PROJECT_SUPPLIES: "MATERIALS", SOFTWARE_SERVICES: "SOFTWARE", EQUIPMENT_RENTAL: "EQUIPMENT",
  SUBCONTRACTOR: "SUBCONTRACTORS", COMMUNICATION: "OTHER_DIRECT", OTHER: "OTHER_DIRECT",
});
export const costCategoryOf = (expenseCategoryCode, sourceModule) => (sourceModule === "GOODS_ISSUE" ? "MATERIALS" : EXPENSE_CATEGORY[expenseCategoryCode] ?? "OTHER_DIRECT");

const MESSAGES = Object.freeze({
  PROJECT_COST_SOURCE_NOT_FOUND: "The original cost record cannot be found.",
  PROJECT_COST_SOURCE_NOT_ELIGIBLE: "This transaction is not eligible to be counted as Project Cost.",
  PROJECT_COST_ALREADY_ALLOCATED: "This source amount is already fully allocated.",
  PROJECT_COST_ALLOCATION_EXCEEDED: "The allocation exceeds the available source amount.",
  PROJECT_COST_RATE_MISSING: "The internal labor cost rate is missing.",
  PROJECT_COST_CURRENCY_INVALID: "The currency conversion details need review.",
  PROJECT_COST_TAX_REVIEW_REQUIRED: "Finance must verify the recoverable tax treatment.",
  PROJECT_COST_BUDGET_MISSING: "No approved budget is configured.",
  PROJECT_COST_PERIOD_CLOSED: "This period is closed. Request an authorized adjustment.",
  PROJECT_COST_SOURCE_REVERSED: "The source transaction was corrected or reversed.",
  PROJECT_COST_RECONCILIATION_REQUIRED: "The Project cost summary needs reconciliation.",
  PROJECT_COST_PERMISSION_DENIED: "You do not have permission for this cost information or action.",
  PROJECT_COST_VERSION_CONFLICT: "These records have changed. Refresh and review.",
  PROJECT_COST_OUTCOME_UNKNOWN: "Checking the previous operation. Do not submit again.",
  PROJECT_COST_INPUT_INVALID: "Check the details and try again.",
});
export const COST_MESSAGES = MESSAGES;
export const costError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);

// The project for cost purposes: as its team sees it, or — for Finance reconciling costs — any project of the company.
export async function costScope(client, c, projectId) {
  let id;
  try { id = uuid(projectId, "Project"); } catch { throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND", "This project is not available."); }
  try {
    const scope = await visibleProject(client, c, id);
    return { ...scope, can: costRights(c, scope.access) };
  } catch (failure) {
    if (!has(c, COST.reconcile)) throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND", "This project is not available.");
    const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`, [c.organizationId, id])).rows[0];
    if (!project) throw costError(404, "PROJECT_COST_SOURCE_NOT_FOUND", "This project is not available.");
    const access = { visible: false, all: false, manager: false, can: {} };
    return { project, access, can: costRights(c, access) };
  }
}
export function costRights(c, access) {
  const lead = Boolean(access?.all || access?.manager) || isOwner(c);
  const finance = has(c, COST.reconcile);
  const summary = has(c, COST.summary) && (lead || finance || seesAll(c));
  return {
    lead, finance, summary,
    detail: summary && has(c, COST.detail),
    laborRate: has(c, COST.laborRate),
    allocate: has(c, COST.allocate) && (lead || finance),
    approve: has(c, COST.approve),
    forecast: has(c, COST.forecast) && (lead || finance),
    reconcile: finance,
    profitability: summary && has(c, COST.profitability),
    export: has(c, COST.export) && summary,
  };
}
export const requireSummary = (can) => { if (!can.summary) throw costError(403, "PROJECT_COST_PERMISSION_DENIED"); };
export const pct = (part, whole) => (Number(whole) > 0 ? Math.floor((Number(part) * 1000) / Number(whole)) / 10 : null);
