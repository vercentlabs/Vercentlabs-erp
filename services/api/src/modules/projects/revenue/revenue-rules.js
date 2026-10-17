// Projects — Project Revenue, the rules: permissions and errors, who may see which of the four measures (contract value, net invoiced,
// recognized revenue, collections), the document states that count, and exact money arithmetic for shares and conversions. Project Revenue
// reads Sales and Finance; it never creates an order, an invoice, a revenue posting or a receipt allocation.
import { has, isOwner, projectError, seesAll, uuid, visibleProject } from "../project-core.js";
import { fromCents, toCents } from "../expenses/expense-rules.js";

export const REV = Object.freeze({
  summary: "projects.revenue.view_summary", contracts: "projects.revenue.view_contracts", invoices: "projects.revenue.view_invoices",
  recognition: "projects.revenue.view_recognition", collections: "projects.revenue.view_collections", profitability: "projects.revenue.view_profitability",
  manageLinks: "projects.revenue.manage_links", forecast: "projects.revenue.forecast_edit", reconcile: "projects.revenue.reconcile", export: "projects.revenue.export",
});
// Sales Order states: only a confirmed order (or one on hold, or closed after delivery) is contracted; earlier states are proposals.
export const ORDER_CONTRACTED = Object.freeze(["confirmed", "on_hold", "closed"]);
export const ORDER_PROPOSED = Object.freeze(["draft", "pending_approval", "approved"]);
// Invoice and credit-note states: issued documents count; drafts and documents awaiting approval are pending; cancelled and reversed never count.
export const DOC_ISSUED = Object.freeze(["posted", "partially_paid", "paid", "overdue", "disputed"]);
export const DOC_PENDING = Object.freeze(["draft", "pending_approval", "approved"]);
export const RECEIPT_LIVE = Object.freeze(["posted", "partially_applied", "applied"]);
export const MODEL_LABEL = Object.freeze({ FIXED: "Fixed price", TIME_AND_MATERIALS: "Time and materials", MILESTONE: "Milestone billing" });

const MESSAGES = Object.freeze({
  PROJECT_REVENUE_CONTRACT_INVALID: "This Sales contract is not available for the Project.",
  PROJECT_REVENUE_CUSTOMER_MISMATCH: "The Sales document belongs to a different customer.",
  PROJECT_REVENUE_COMPANY_MISMATCH: "The source belongs to another Company.",
  PROJECT_REVENUE_CONTRACT_OVERALLOCATED: "The allocation exceeds the agreed contract value.",
  PROJECT_REVENUE_INVOICE_OVERALLOCATED: "This invoice line is already fully assigned.",
  PROJECT_REVENUE_SOURCE_MISSING: "A linked financial record could not be found.",
  PROJECT_REVENUE_CURRENCY_UNSUPPORTED: "A valid reporting currency conversion is unavailable.",
  PROJECT_REVENUE_RECOGNITION_UNAVAILABLE: "Finance has not provided recognized revenue for this Project.",
  PROJECT_REVENUE_PERIOD_CLOSED: "This accounting period is closed. Use an authorized adjustment.",
  PROJECT_REVENUE_RECONCILIATION_REQUIRED: "Project Revenue needs to be reconciled with Sales or Finance.",
  PROJECT_REVENUE_PERMISSION_DENIED: "You cannot access this revenue information or action.",
  PROJECT_REVENUE_VERSION_CONFLICT: "These financial records changed. Refresh before continuing.",
  PROJECT_REVENUE_OUTCOME_UNKNOWN: "The operation is being verified. Do not repeat it yet.",
  PROJECT_REVENUE_INPUT_INVALID: "Check the details and try again.",
});
export const REVENUE_MESSAGES = MESSAGES;
export const revenueError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);

// The project for revenue purposes: as its team sees it, or — for Finance reconciling revenue — any project of the company.
export async function revenueScope(client, c, projectId, options = {}) {
  let id;
  try { id = uuid(projectId, "Project"); } catch { throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING", "This project is not available."); }
  try {
    const scope = await visibleProject(client, c, id, options);
    return { ...scope, can: revenueRights(c, scope.access) };
  } catch (failure) {
    if (!has(c, REV.reconcile)) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING", "This project is not available.");
    const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL${options.lock ? " FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
    if (!project) throw revenueError(404, "PROJECT_REVENUE_SOURCE_MISSING", "This project is not available.");
    const access = { visible: false, all: false, manager: false, can: {} };
    return { project, access, can: revenueRights(c, access) };
  }
}
export function revenueRights(c, access) {
  const lead = Boolean(access?.all || access?.manager) || isOwner(c);
  const finance = has(c, REV.reconcile);
  const summary = has(c, REV.summary) && (lead || finance || seesAll(c));
  return {
    lead, finance, summary,
    contracts: summary && has(c, REV.contracts),
    invoices: summary && has(c, REV.invoices),
    recognition: summary && has(c, REV.recognition),
    collections: summary && has(c, REV.collections),
    profitability: summary && has(c, REV.profitability) && has(c, "projects.cost.view_summary"),
    manageLinks: summary && has(c, REV.manageLinks),
    forecast: has(c, REV.forecast) && (lead || finance),
    reconcile: finance,
    export: summary && has(c, REV.export),
  };
}
export const requireRevenue = (can, key = "summary") => { if (!can[key]) throw revenueError(403, "PROJECT_REVENUE_PERMISSION_DENIED"); };

// ------------------------------------------------------------------ exact arithmetic
const roundDiv = (n, d) => { if (d === 0n) return 0n; const q = n / d; const r = n % d; return (r * 2n >= d || -r * 2n >= d) ? q + (n < 0n ? -1n : 1n) : q; };
// amount × part / whole, to the cent (half away from zero).
export const prorate = (amount, part, whole) => {
  const w = toCents(whole);
  if (w === 0n) return "0.00";
  return fromCents(roundDiv(toCents(amount) * toCents(part), w));
};
// A document amount in the company's currency at the rate the document recorded (exact to 6 decimals of rate).
export const convert = (amount, rate) => {
  const scaled = BigInt(Math.round(Number(rate ?? 1) * 1e6));
  return fromCents(roundDiv(toCents(amount) * scaled, 1000000n));
};
export const pct = (part, whole) => (Number(whole) > 0 ? Math.floor((Number(part) * 1000) / Number(whole)) / 10 : null);
export const maxZero = (value) => (toCents(value) > 0n ? fromCents(toCents(value)) : "0.00");
