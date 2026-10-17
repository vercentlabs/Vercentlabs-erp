// Projects — the Project Financials directory: every project a person may see financially, side by side — cost, revenue, profitability
// and open exceptions — each column only for those allowed to see it (the same rights as the project's own Financials tab), with
// portfolio totals summed from amounts, never averaged. It reads the same Cost, Revenue and Profitability calculations; no journals.
import { has, projectError, seesAll, text, userNames, visibilitySql } from "../project-core.js";
import { addMoney, subMoney } from "../expenses/expense-rules.js";
import { costRights } from "../costing/cost-rules.js";
import { revenueRights } from "../revenue/revenue-rules.js";
import { marginOf, profitRights } from "../profitability/profitability-rules.js";
import { profitabilityModel, profitabilityWarnings } from "../profitability/profitability-read.js";

const sum = (values) => addMoney("0", ...values.filter((v) => v !== null && v !== undefined));
const ANY = ["projects.cost.view_summary", "projects.revenue.view_summary", "projects.profitability.view_summary"];
const FINANCE = ["projects.cost.reconcile", "projects.revenue.reconcile", "projects.profitability.reconcile"];

// filters: { status?, search?, classification? }
export async function getProjectFinancialsDirectory(client, c, filters = {}) {
  if (!ANY.some((key) => has(c, key))) throw projectError(403, "PROJECT_PERMISSION_DENIED", "You cannot see project financials.");
  const finance = FINANCE.some((key) => has(c, key));
  const search = text(filters.search, 100);
  const projects = (await client.query(`SELECT project.*, party.display_name AS customer_name FROM tenant.projects project
      LEFT JOIN tenant.business_parties party ON party.id = project.customer_id
     WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.status <> 'DRAFT' AND (${finance ? "TRUE" : visibilitySql(c, "project", "$2")}) AND ($2::uuid IS NULL OR TRUE)
       AND ($3::text IS NULL OR project.status = $3) AND ($4::text IS NULL OR project.classification = $4)
       AND ($5::text = '' OR project.project_code ILIKE '%' || $5 || '%' OR project.name ILIKE '%' || $5 || '%' OR party.display_name ILIKE '%' || $5 || '%')
     ORDER BY project.project_code LIMIT 300`, [c.organizationId, c.userId ?? null, filters.status || null, filters.classification || null, search])).rows;
  const managers = await userNames(client, projects.map((p) => p.manager_user_id).filter(Boolean));
  const rows = [];
  // The portfolio margin's inputs, over the customer projects whose profitability the person may see and Finance has revenue for.
  const portfolio = { recognized: [], cost: [] };
  for (const project of projects) {
    const access = { all: seesAll(c), manager: project.manager_user_id === c.userId };
    const cost = costRights(c, access);
    const revenue = revenueRights(c, access);
    const profit = profitRights(c, access);
    if (!cost.summary && !revenue.summary && !profit.summary) continue;
    const x = await profitabilityModel(client, c, project);
    const warnings = await profitabilityWarnings(client, c, x);
    if (profit.summary && !x.internal && x.actual.recognized !== null) { portfolio.recognized.push(x.actual.recognized); portfolio.cost.push(x.actual.cost); }
    rows.push({
      projectId: project.id, code: project.project_code, name: project.name, customer: project.customer_name, manager: managers.get(project.manager_user_id) ?? null, status: project.status, internal: x.internal,
      cost: cost.summary ? { actual: x.costToDate.actual, budget: x.budget.total, eac: x.forecast.eac, overrun: x.budget.overrun } : null,
      revenue: revenue.summary ? { contract: x.commercial.contract, netInvoiced: x.commercial.netInvoiced, recognized: revenue.recognition ? x.rev.recognition.total : undefined,
        collected: revenue.collections ? x.commercial.collected : undefined, outstanding: revenue.collections ? x.commercial.outstanding : undefined } : null,
      profitability: profit.summary ? { status: x.status, contribution: x.actual.contribution, margin: x.actual.margin, forecastMargin: profit.forecast ? x.forecast.margin : undefined, completeness: x.completeness } : null,
      attention: warnings.filter((w) => ["warning", "danger"].includes(w.severity)).length,
      href: `/projects/${project.id}?tab=financials`,
    });
  }
  // Portfolio totals: amounts summed over the projects the person may see in each column; the margin from those sums.
  const withCost = rows.filter((r) => r.cost);
  const recognized = sum(portfolio.recognized);
  const contribution = subMoney(recognized, sum(portfolio.cost));
  return {
    rows,
    totals: {
      cost: withCost.length ? { actual: sum(withCost.map((r) => r.cost.actual)), budget: sum(withCost.map((r) => r.cost.budget)), eac: sum(withCost.map((r) => r.cost.eac)) } : null,
      revenue: rows.some((r) => r.revenue) ? { contract: sum(rows.filter((r) => r.revenue).map((r) => r.revenue.contract)), netInvoiced: sum(rows.filter((r) => r.revenue).map((r) => r.revenue.netInvoiced)) } : null,
      profitability: portfolio.recognized.length ? { recognized, cost: sum(portfolio.cost), contribution, margin: marginOf(contribution, recognized), projects: portfolio.recognized.length } : null,
    },
  };
}
