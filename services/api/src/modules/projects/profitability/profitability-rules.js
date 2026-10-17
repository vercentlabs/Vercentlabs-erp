// Projects — Project Profitability, the rules: permissions and errors, who may see which part, the calculation policy (one version, used by
// the panel, reports, exports and snapshots alike) and the status thresholds. Profitability is calculated, never entered: actual
// contribution is Finance's recognized revenue less comparable project cost; the forecast is forecast revenue less the estimate at completion.
import { has, isOwner, projectError, seesAll, uuid, visibleProject } from "../project-core.js";

export const PRF = Object.freeze({
  summary: "projects.profitability.view_summary", details: "projects.profitability.view_details", laborCost: "projects.profitability.view_labor_cost",
  revenue: "projects.profitability.view_revenue", forecast: "projects.profitability.view_forecast", editForecast: "projects.profitability.edit_forecast",
  reconcile: "projects.profitability.reconcile", export: "projects.profitability.export",
});
export const CALCULATION_VERSION = "PRF-1";
// The calculation policy, stated once and shown with every figure.
export const POLICY = Object.freeze({
  actual: "Actual contribution = revenue Finance recognized − comparable actual project cost. Margin = contribution ÷ recognized revenue; N/A without revenue.",
  forecast: "Forecast contribution = forecast final revenue − estimate at completion (actual cost + estimate to complete, adding open purchase commitments only when the estimate leaves them out).",
  forecastRevenue: "Forecast final revenue = current contract value of fixed-price and milestone lines + time-and-materials invoiced and approved unbilled time + other invoiced work + the manual further-revenue forecast.",
  breakEven: "Break-even: a contribution within ₹1.00 of zero.",
  portfolio: "Portfolio margins are calculated from summed amounts, never averaged across projects.",
});
const MESSAGES = Object.freeze({
  PROFITABILITY_REVENUE_UNAVAILABLE: "Recognized revenue is not available from Finance.",
  PROFITABILITY_COST_INCOMPLETE: "Some Project Costs have not yet been calculated or reconciled.",
  PROFITABILITY_LABOR_RATE_MISSING: "An internal labor rate is missing for recorded work.",
  PROFITABILITY_ZERO_REVENUE: "A margin percentage cannot be calculated without revenue.",
  PROFITABILITY_FORECAST_MISSING: "Add an estimate of remaining costs to calculate forecast profit.",
  PROFITABILITY_CURRENCY_MISMATCH: "A valid reporting currency conversion is unavailable.",
  PROFITABILITY_PERIOD_MISMATCH: "Revenue and cost reporting periods do not match.",
  PROFITABILITY_SOURCE_STALE: "Financial records have changed. The summary needs refreshing.",
  PROFITABILITY_RECONCILIATION_REQUIRED: "Finance and Project source amounts need reconciliation.",
  PROFITABILITY_PERMISSION_DENIED: "You do not have permission to view this financial information.",
  PROFITABILITY_VERSION_CONFLICT: "The forecast changed. Refresh before saving.",
  PROFITABILITY_INPUT_INVALID: "Check the details and try again.",
});
export const PROFITABILITY_MESSAGES = MESSAGES;
export const profitError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);

export async function profitScope(client, c, projectId, options = {}) {
  let id;
  try { id = uuid(projectId, "Project"); } catch { throw profitError(404, "PROFITABILITY_PERMISSION_DENIED", "This project is not available."); }
  try {
    const scope = await visibleProject(client, c, id, options);
    return { ...scope, can: profitRights(c, scope.access) };
  } catch {
    if (!has(c, PRF.reconcile)) throw profitError(404, "PROFITABILITY_PERMISSION_DENIED", "This project is not available.");
    const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`, [c.organizationId, id])).rows[0];
    if (!project) throw profitError(404, "PROFITABILITY_PERMISSION_DENIED", "This project is not available.");
    const access = { visible: false, all: false, manager: false, can: {} };
    return { project, access, can: profitRights(c, access) };
  }
}
export function profitRights(c, access) {
  const lead = Boolean(access?.all || access?.manager) || isOwner(c);
  const finance = has(c, PRF.reconcile);
  const summary = has(c, PRF.summary) && (lead || finance || seesAll(c));
  return {
    lead, finance, summary,
    details: summary && has(c, PRF.details),
    laborCost: summary && has(c, PRF.laborCost),
    revenue: summary && has(c, PRF.revenue),
    forecast: summary && has(c, PRF.forecast),
    editForecast: has(c, PRF.editForecast) && (lead || finance),
    snapshot: summary && (finance || lead),
    reconcile: finance,
    export: summary && has(c, PRF.export),
  };
}
export const requireProfit = (can, key = "summary") => { if (!can[key]) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED"); };
// Status from a contribution: within ₹1.00 of zero is break-even.
export const statusOf = (contribution, prefix = "") => {
  if (contribution === null || contribution === undefined) return prefix ? "FORECAST_UNAVAILABLE" : "UNKNOWN";
  const n = Number(contribution);
  return `${prefix}${Math.abs(n) < 1 ? "BREAK_EVEN" : n > 0 ? (prefix ? "PROFIT" : "PROFITABLE") : "LOSS"}`;
};
// A margin to two decimals, or null without a positive denominator.
export const marginOf = (part, whole) => (whole !== null && whole !== undefined && Number(whole) > 0 && part !== null && part !== undefined ? Math.round((Number(part) * 10000) / Number(whole)) / 100 : null);
