// Projects — Project Profitability, the reads. Everything is derived from Project Cost (actual cost, budget, ETC/EAC, breakdowns) and
// Project Revenue (recognized revenue, contract value, net invoiced, collections) at the moment of reading — no profit ledger. Five
// figures stay separate: actual contribution, actual margin, forecast final contribution, forecast margin and budget variance; contract,
// invoiced and collected are shown beside them as commercial references, never inside a formula. Missing data is reported as missing:
// a margin without recognized revenue is N/A, a contribution from knowingly incomplete cost is provisional, a forecast without an
// estimate to complete is unavailable.
import { has, isoDay, userNames, uuid, visibilitySql } from "../project-core.js";
import { addMoney, cmpMoney, moneyOut, subMoney } from "../expenses/expense-rules.js";
import { costSummaryFor, getProjectCostExceptions, projectCostLines } from "../costing/cost-read.js";
import { revenueExceptions, revenueModel } from "../revenue/revenue-read.js";
import { CALCULATION_VERSION, POLICY, PRF, marginOf, profitError, profitScope, requireProfit, statusOf } from "./profitability-rules.js";

const m = (value) => moneyOut(value ?? "0") ?? "0.00";
const sum = (values) => addMoney("0", ...values.map((value) => value ?? "0"));
const inRange = (d, from, to) => Boolean(d) && (!from || d >= from) && (!to || d <= to);
const COST_INCOMPLETE = new Set(["RATE_MISSING", "SOURCE_REVERSED", "VERIFIED_WITHOUT_COST", "OVERHEAD_BASIS_CHANGED"]);
const REVENUE_UNRECONCILED = new Set(["INVOICE_LINE_UNALLOCATED", "SHARED_LINE_UNALLOCATED", "INVOICE_OVERALLOCATED", "CONTRACT_OVERALLOCATED", "SOURCE_MISSING", "SOURCE_CHANGED", "CURRENCY", "OVERBILLED"]);
// The cost read Profitability uses: every recognized line (labor rates themselves are never returned here), without the cost screen's gates.
const COST_CAN = Object.freeze({ lead: true, finance: false, summary: true, detail: true, laborRate: false, allocate: false, approve: false, forecast: false, reconcile: false, profitability: false, export: false });

// filters: { from?, to? } — a reporting period for actual revenue and cost; the forecast is always project-to-date.
export async function profitabilityModel(client, c, project, filters = {}) {
  const from = filters.from ? isoDay(filters.from) : null;
  const to = filters.to ? isoDay(filters.to) : null;
  const period = Boolean(from || to);
  const cost = await costSummaryFor(client, c, project, COST_CAN, { from: from ?? undefined, to: to ?? undefined });
  const costToDate = period ? await costSummaryFor(client, c, project, COST_CAN, {}) : cost;
  const rev = await revenueModel(client, c, project);
  const internal = project.classification === "INTERNAL";
  const costExceptions = await getProjectCostExceptions(client, c, project.id, { scope: { project, can: COST_CAN } });
  const revExceptions = internal ? [] : await revenueExceptions(client, c, project, rev);
  // ---- actual (for the period)
  const recognizedRows = rev.recognition.rows.filter((row) => !period || inRange(row.date, from, to));
  const recognized = internal ? null : rev.recognition.available ? sum(recognizedRows.map((row) => row.amount)) : null;
  const actualCost = cost.actual;
  const laborMissing = cost.labor.missingRate;
  const costIncomplete = costExceptions.filter((row) => COST_INCOMPLETE.has(row.kind));
  const revenueUnreconciled = revExceptions.filter((row) => REVENUE_UNRECONCILED.has(row.kind));
  const contribution = recognized === null ? null : subMoney(recognized, actualCost);
  const provisional = costIncomplete.length > 0 || revenueUnreconciled.length > 0;
  const status = internal ? "INTERNAL" : recognized === null || provisional ? "UNKNOWN" : statusOf(contribution);
  const laborLines = (cost.byCategory.find((row) => row.key === "LABOR")?.amount) ?? "0.00";
  const overhead = (cost.byCategory.find((row) => row.key === "OVERHEAD")?.amount) ?? "0.00";
  const costBasis = cmpMoney(laborLines, "0") > 0 || cmpMoney(overhead, "0") > 0 ? "MANAGERIAL" : cmpMoney(actualCost, "0") > 0 ? "FINANCE_SOURCED" : "NONE";
  // ---- forecast (project-to-date)
  const eac = costToDate.eac;
  const contracted = rev.contract.lines.filter((line) => line.contracted && line.amountBase !== null);
  const fixed = sum(contracted.filter((line) => line.model !== "TIME_AND_MATERIALS").map((line) => line.amountBase));
  const tmKeys = new Set(contracted.filter((line) => line.model === "TIME_AND_MATERIALS").map((line) => line.key));
  const tmInvoiced = sum(rev.unbilled.contractLines.filter((line) => tmKeys.has(line.key)).map((line) => line.invoiced));
  const tmKnown = addMoney(tmInvoiced, rev.unbilled.approvedTimeValue);
  const otherInvoiced = subMoney(sum(rev.inv.lines.filter((line) => line.state === "ISSUED" && !line.key && line.amountBase !== null).map((line) => line.amountBase)),
    sum(rev.inv.credits.filter((credit) => credit.state === "ISSUED" && !credit.key && credit.amountBase !== null).map((credit) => credit.amountBase)));
  const further = rev.forecast ? m(rev.forecast.expected_further_revenue) : null;
  const hasRevenueBasis = contracted.length > 0 || further !== null || cmpMoney(otherInvoiced, "0") !== 0;
  const forecastRevenue = internal || !hasRevenueBasis ? null : addMoney(fixed, tmKnown, otherInvoiced, further ?? "0");
  const forecastContribution = forecastRevenue !== null && eac !== null ? subMoney(forecastRevenue, eac) : null;
  const forecastStatus = internal ? "INTERNAL" : statusOf(forecastContribution, "FORECAST_");
  const budget = costToDate.budget.set === false ? null : costToDate.budget.total;
  const completeness = internal ? (provisional ? "PARTIAL" : "COMPLETE") : recognized === null ? "UNAVAILABLE" : provisional ? "PARTIAL" : "COMPLETE";
  return {
    project, internal, period: { from, to, label: period ? `${from ?? "start"} – ${to ?? "today"}` : "Project to date" }, currency: cost.currency, costBasis, completeness, status, forecastStatus,
    actual: { recognized, cost: actualCost, contribution, margin: marginOf(contribution, recognized), provisional, zeroRevenue: recognized !== null && cmpMoney(recognized, "0") === 0 },
    forecast: { revenue: forecastRevenue, revenueParts: { fixed, tmKnown, otherInvoiced, further }, tmUnforecast: tmKeys.size > 0 && further === null,
      etc: costToDate.forecast?.estimateToComplete ?? null, commitmentTreatment: costToDate.forecast?.commitmentTreatment ?? null, commitments: costToDate.commitments.total, eac,
      contribution: forecastContribution, margin: marginOf(forecastContribution, forecastRevenue), costForecastVersion: costToDate.forecast?.version ?? null,
      costForecastAsOf: costToDate.forecast?.asOf ?? null, revenueForecastVersion: rev.forecast?.version ?? null },
    budget: { total: budget, actualVariance: budget === null ? null : subMoney(budget, costToDate.actual), forecastVariance: costToDate.eacVariance, overrun: costToDate.forecastOverrun },
    commercial: { contract: rev.contractValue, original: rev.originalValue, netInvoiced: rev.netInvoiced, collected: rev.collections.settled, outstanding: rev.collections.outstanding,
      remaining: rev.contractValue === null ? null : rev.unbilled.contractRemaining },
    cost, costToDate, rev, recognizedRows, costIncomplete, revenueUnreconciled, laborMissing, revExceptions, costExceptions,
  };
}

// ------------------------------------------------------------------ warnings
export async function profitabilityWarnings(client, c, x) {
  const out = [];
  const threshold = Number((await client.query(`SELECT profitability_margin_alert_percent FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.profitability_margin_alert_percent ?? 10);
  if (!x.internal && x.forecast.margin !== null && x.forecast.margin < threshold) out.push({ kind: "FORECAST_MARGIN_LOW", severity: "warning", message: `The forecast margin is ${x.forecast.margin}%, below the company's ${threshold}% threshold.` });
  if (x.budget.overrun) out.push({ kind: "FORECAST_OVER_BUDGET", severity: "warning", message: `The estimate at completion ${x.forecast.eac} exceeds the approved budget ${x.budget.total}.` });
  if (x.status === "LOSS") out.push({ kind: "NEGATIVE_CONTRIBUTION", severity: "danger", message: `Actual contribution is ${x.actual.contribution}: cost exceeds recognized revenue.` });
  if (!x.internal && x.forecastStatus === "FORECAST_LOSS") out.push({ kind: "FORECAST_LOSS", severity: "danger", message: `The project is forecast to lose ${String(Math.abs(Number(x.forecast.contribution)).toFixed(2))}.` });
  if (x.laborMissing) out.push({ kind: "RATE_MISSING", code: "PROFITABILITY_LABOR_RATE_MISSING", severity: "warning", message: `${x.laborMissing} approved time entr${x.laborMissing === 1 ? "y has" : "ies have"} no labor rate: cost is understated and the contribution provisional.` });
  for (const row of x.costIncomplete.filter((r) => r.kind !== "RATE_MISSING")) out.push({ kind: "COST_UNRECONCILED", code: "PROFITABILITY_COST_INCOMPLETE", severity: "warning", message: row.message });
  for (const row of x.revenueUnreconciled) out.push({ kind: "REVENUE_UNRECONCILED", code: "PROFITABILITY_RECONCILIATION_REQUIRED", severity: "warning", message: row.message });
  if (!x.internal && x.actual.recognized === null) out.push({ kind: "REVENUE_UNAVAILABLE", code: "PROFITABILITY_REVENUE_UNAVAILABLE", severity: "warning", message: "Finance has not recognized revenue for the issued invoices: the actual contribution is unavailable." });
  if (x.commercial.contract !== null && x.commercial.original !== null && cmpMoney(x.commercial.contract, x.commercial.original) < 0) out.push({ kind: "CONTRACT_REDUCED", severity: "warning", message: `The contract was reduced from ${x.commercial.original} to ${x.commercial.contract}.` });
  if (x.forecast.eac === null && ["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(x.project.status)) out.push({ kind: "FORECAST_MISSING", code: "PROFITABILITY_FORECAST_MISSING", severity: "info", message: "No estimate to complete: the forecast contribution is unavailable." });
  if (x.forecast.costForecastAsOf && ["IN_PROGRESS", "ON_HOLD"].includes(x.project.status)
    && (await client.query(`SELECT ($1::date < current_date - 60) AS stale`, [x.forecast.costForecastAsOf])).rows[0].stale) out.push({ kind: "FORECAST_STALE", severity: "info", message: `The estimate to complete is from ${x.forecast.costForecastAsOf}, more than 60 days ago.` });
  if (x.forecast.tmUnforecast && !x.internal) out.push({ kind: "TM_UNFORECAST", severity: "info", message: "Hourly work still to come is not forecast: forecast revenue counts only invoiced and approved time. Add a further-revenue forecast." });
  // A material rise in the estimate to complete between its last two versions.
  const versions = (await client.query(`SELECT version, estimate_to_complete FROM tenant.project_cost_forecasts WHERE project_id = $1 ORDER BY version DESC LIMIT 2`, [x.project.id])).rows;
  if (versions.length === 2 && Number(versions[1].estimate_to_complete) > 0 && Number(versions[0].estimate_to_complete) > Number(versions[1].estimate_to_complete) * 1.1) {
    out.push({ kind: "ETC_INCREASE", severity: "warning", message: `The estimate to complete rose from ${m(versions[1].estimate_to_complete)} to ${m(versions[0].estimate_to_complete)} (forecast v${versions[0].version}).` });
  }
  // The forecast margin against the last snapshot, with what moved it.
  const last = (await client.query(`SELECT * FROM tenant.project_profitability_snapshots WHERE project_id = $1 AND forecast_margin_percent IS NOT NULL ORDER BY snapshot_at DESC LIMIT 1`, [x.project.id])).rows[0];
  if (last && x.forecast.margin !== null && Number(last.forecast_margin_percent) - x.forecast.margin >= 5) {
    const eacRose = last.estimate_at_completion !== null && x.forecast.eac !== null && cmpMoney(x.forecast.eac, m(last.estimate_at_completion)) > 0;
    const why = eacRose ? ` after the estimate at completion rose from ${m(last.estimate_at_completion)} to ${x.forecast.eac}`
      : last.forecast_revenue !== null && cmpMoney(x.forecast.revenue, m(last.forecast_revenue)) < 0 ? ` after forecast revenue fell from ${m(last.forecast_revenue)} to ${x.forecast.revenue}` : "";
    out.push({ kind: "MARGIN_DETERIORATION", severity: "warning", message: `The forecast margin fell from ${Number(last.forecast_margin_percent)}% to ${x.forecast.margin}%${why}.` });
  }
  return out;
}

// ------------------------------------------------------------------ the summary and the views
const scopeAndModel = async (client, c, projectId, filters = {}) => {
  const scope = await profitScope(client, c, projectId);
  requireProfit(scope.can);
  return { ...scope, x: await profitabilityModel(client, c, scope.project, filters) };
};
const watermarks = async (client, x) => (await client.query(`SELECT GREATEST((SELECT max(created_at) FROM tenant.project_time_entries WHERE project_id = $1),
    (SELECT max(created_at) FROM tenant.project_expense_cost_allocations WHERE project_id = $1), (SELECT max(created_at) FROM tenant.project_cost_forecasts WHERE project_id = $1),
    (SELECT max(posted_at) FROM tenant.accounting_journal_entries WHERE id = ANY($2::uuid[]))) AS at`, [x.project.id, x.rev.recognition.rows.map((row) => row.entryId)])).rows[0].at;

export async function getProjectProfitabilitySummary(client, c, projectId, filters = {}) {
  const { can, x } = await scopeAndModel(client, c, projectId, filters);
  const warnings = await profitabilityWarnings(client, c, x);
  const lastSnapshot = (await client.query(`SELECT snapshot_number, snapshot_at, reason FROM tenant.project_profitability_snapshots WHERE project_id = $1 ORDER BY snapshot_at DESC LIMIT 1`, [x.project.id])).rows[0] ?? null;
  return {
    projectId: x.project.id, projectStatus: x.project.status, internal: x.internal, currency: x.currency, period: x.period, calculationVersion: CALCULATION_VERSION, calculatedAt: new Date().toISOString(),
    sourcesUpdatedAt: await watermarks(client, x), lastSnapshot: lastSnapshot ? { number: `PS-${lastSnapshot.snapshot_number}`, at: lastSnapshot.snapshot_at, reason: lastSnapshot.reason } : null,
    basis: { cost: x.costBasis, label: x.internal ? "Internal investment — cost performance" : x.costBasis === "MANAGERIAL" ? "Managerial Project Contribution" : "Project contribution on Finance-sourced cost",
      note: x.costBasis === "MANAGERIAL" ? "Labor and any overhead are managerial allocations, so this is not statutory profit." : "Not statutory net profit.", completeness: x.completeness, policy: POLICY },
    status: x.status, forecastStatus: can.forecast ? x.forecastStatus : null,
    actual: x.actual,
    forecast: can.forecast ? x.forecast : null,
    budget: x.budget,
    commercial: can.revenue ? x.commercial : null,
    warnings,
    can: { details: can.details, laborCost: can.laborCost, revenue: can.revenue, forecast: can.forecast, editForecast: can.editForecast, snapshot: can.snapshot, reconcile: can.reconcile, export: can.export },
  };
}
export async function getProjectProfitabilityBreakdown(client, c, projectId, filters = {}) {
  const { can, x } = await scopeAndModel(client, c, projectId, filters);
  requireProfit(can, "details");
  const categories = x.cost.byCategory.map((row) => ({ key: row.key, label: row.label, amount: row.amount, budget: row.budget, share: marginOf(row.amount, x.actual.cost),
    kind: row.key === "OVERHEAD" ? "INDIRECT" : "DIRECT", basis: ["LABOR", "OVERHEAD"].includes(row.key) ? "MANAGERIAL" : "FINANCE_SOURCED" }));
  let people = null;
  if (can.laborCost) {
    const lines = await projectCostLines(client, c, x.project, { detail: true, laborRate: false }, x.period.from || x.period.to ? { from: x.period.from ?? undefined, to: x.period.to ?? undefined } : {});
    const map = new Map();
    for (const line of lines.filter((l) => l.category === "LABOR" && l.amount !== null)) {
      const key = line.person ?? "—";
      const prior = map.get(key) ?? { person: key, minutes: 0, amount: "0.00" };
      map.set(key, { person: key, minutes: prior.minutes + (line.minutes ?? 0), amount: addMoney(prior.amount, line.amount) });
    }
    people = [...map.values()].sort((a, b) => Number(b.amount) - Number(a.amount));
  }
  const bySource = new Map();
  for (const row of x.recognizedRows) bySource.set(row.source, addMoney(bySource.get(row.source) ?? "0", row.amount));
  return {
    period: x.period, currency: x.currency, costBasis: x.costBasis,
    cost: { total: x.actual.cost, categories, direct: sum(categories.filter((row) => row.kind === "DIRECT").map((row) => row.amount)), indirect: sum(categories.filter((row) => row.kind === "INDIRECT").map((row) => row.amount)),
      managerial: sum(categories.filter((row) => row.basis === "MANAGERIAL").map((row) => row.amount)), financeSourced: sum(categories.filter((row) => row.basis === "FINANCE_SOURCED").map((row) => row.amount)),
      labor: { total: x.cost.labor.total, billable: x.cost.labor.billable, nonBillable: x.cost.labor.nonBillable, hours: Math.round(x.cost.labor.minutes / 6) / 10, missingRate: x.cost.labor.missingRate, people },
      bySource: x.cost.bySource, byTask: x.cost.byTask, byMilestone: x.cost.byMilestone },
    revenue: { recognized: x.actual.recognized, bySource: [...bySource.entries()].map(([source, amount]) => ({ source, amount })),
      rows: can.revenue ? x.recognizedRows.map(({ entryId, entryNumber, date, period, source, amount, href }) => ({ entryId, entryNumber, date, period, source, amount, href })) : null,
      commercial: can.revenue ? x.commercial : null },
  };
}
// Month by month: Finance's recognized revenue (by accounting date) and recognized cost, with the running totals and margin.
export async function getProjectProfitabilityTrend(client, c, projectId, filters = {}) {
  const { can, x } = await scopeAndModel(client, c, projectId, filters);
  requireProfit(can, "details");
  const months = new Map();
  const at = (month) => months.get(month) ?? { month, revenue: "0.00", cost: "0.00" };
  for (const row of x.cost.byMonth) months.set(row.month, { ...at(row.month), cost: row.amount });
  for (const row of x.recognizedRows) { const month = (row.date ?? "").slice(0, 7); const prior = at(month); months.set(month, { ...prior, revenue: addMoney(prior.revenue, row.amount) }); }
  let revenue = "0.00";
  let cost = "0.00";
  const rows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => {
    revenue = addMoney(revenue, row.revenue);
    cost = addMoney(cost, row.cost);
    const contribution = x.actual.recognized === null ? null : subMoney(row.revenue, row.cost);
    const cumulative = x.actual.recognized === null ? null : subMoney(revenue, cost);
    return { month: row.month, revenue: x.actual.recognized === null ? null : row.revenue, cost: row.cost, contribution, cumulativeRevenue: x.actual.recognized === null ? null : revenue, cumulativeCost: cost,
      cumulativeContribution: cumulative, cumulativeMargin: marginOf(cumulative, revenue) };
  });
  return { period: x.period, currency: x.currency, revenueAvailable: x.actual.recognized !== null, rows };
}
// The record of how the figures moved: snapshots, cost and revenue forecast versions, contract amendments.
export async function getProjectProfitabilityHistory(client, c, projectId) {
  const { can, project } = await profitScope(client, c, projectId);
  requireProfit(can, "details");
  const q = async (sql) => (await client.query(sql, [project.id])).rows;
  const snapshots = await q(`SELECT * FROM tenant.project_profitability_snapshots WHERE project_id = $1 ORDER BY snapshot_at DESC`);
  const costForecasts = await q(`SELECT version, estimate_to_complete, commitment_treatment, to_char(as_of_date, 'YYYY-MM-DD') AS as_of, notes, created_by, created_at FROM tenant.project_cost_forecasts WHERE project_id = $1 ORDER BY version DESC`);
  const revenueForecasts = await q(`SELECT version, expected_further_revenue, to_char(as_of_date, 'YYYY-MM-DD') AS as_of, assumptions, created_by, created_at FROM tenant.project_revenue_forecasts WHERE project_id = $1 ORDER BY version DESC`);
  const names = await userNames(client, [...snapshots, ...costForecasts, ...revenueForecasts].map((row) => row.created_by).filter(Boolean));
  const num = (v) => (v === null || v === undefined ? null : m(v));
  return {
    snapshots: snapshots.map((row) => ({ id: row.id, number: `PS-${row.snapshot_number}`, reason: row.reason, note: row.note, at: row.snapshot_at, by: names.get(row.created_by) ?? null, periodEnd: isoDay(row.period_end),
      calculationVersion: row.calculation_version, costBasis: row.cost_basis, status: row.status, forecastStatus: can.forecast ? row.forecast_status : null, completeness: row.completeness,
      recognized: num(row.recognized_revenue), cost: num(row.comparable_actual_cost), contribution: num(row.actual_contribution), margin: row.actual_margin_percent === null ? null : Number(row.actual_margin_percent),
      ...(can.forecast ? { eac: num(row.estimate_at_completion), forecastRevenue: num(row.forecast_revenue), forecastContribution: num(row.forecast_contribution), forecastMargin: row.forecast_margin_percent === null ? null : Number(row.forecast_margin_percent) } : {}),
      warnings: row.warnings })),
    costForecasts: can.forecast ? costForecasts.map((row) => ({ version: row.version, estimateToComplete: m(row.estimate_to_complete), commitmentTreatment: row.commitment_treatment, asOf: row.as_of, notes: row.notes, by: names.get(row.created_by) ?? null, at: row.created_at })) : [],
    revenueForecasts: can.forecast ? revenueForecasts.map((row) => ({ version: row.version, expectedFurther: m(row.expected_further_revenue), asOf: row.as_of, assumptions: row.assumptions, by: names.get(row.created_by) ?? null, at: row.created_at })) : [],
  };
}
export async function getProjectProfitabilityExceptions(client, c, projectId) {
  const { x } = await scopeAndModel(client, c, projectId);
  return { rows: await profitabilityWarnings(client, c, x) };
}
// Rechecks the invariants of the calculation and that Cost and Revenue each match their own sources.
export async function reconcileProjectProfitability(client, c, projectId) {
  const { can, x } = await scopeAndModel(client, c, projectId);
  requireProfit(can, "reconcile");
  const checks = [];
  const contributionOk = x.actual.contribution === null || cmpMoney(x.actual.contribution, subMoney(x.actual.recognized, x.actual.cost)) === 0;
  checks.push({ key: "contribution", label: "Actual contribution = recognized revenue − actual cost", ok: contributionOk, details: contributionOk ? [] : [String(x.actual.contribution)] });
  const expectedEac = x.forecast.etc === null ? null : addMoney(x.costToDate.actual, x.forecast.etc, x.forecast.commitmentTreatment === "EXCLUDED" ? x.forecast.commitments : "0");
  const eacOk = expectedEac === x.forecast.eac;
  checks.push({ key: "eac", label: "Estimate at completion = actual cost + estimate to complete (+ commitments left out of it)", ok: eacOk, details: eacOk ? [] : [`${x.forecast.eac} ≠ ${expectedEac}`] });
  checks.push({ key: "cost", label: "Project Cost has no unreconciled sources", ok: x.costIncomplete.length === 0, details: x.costIncomplete.map((row) => row.message) });
  checks.push({ key: "revenue", label: "Project Revenue has no unreconciled documents", ok: x.revenueUnreconciled.length === 0, details: x.revenueUnreconciled.map((row) => row.message) });
  checks.push({ key: "recognition", label: "Recognized revenue is available from Finance", ok: x.internal || x.actual.recognized !== null, details: x.internal || x.actual.recognized !== null ? [] : ["Finance has not posted the issued invoices"] });
  return { projectId: x.project.id, consistent: checks.every((check) => check.ok), checks, checkedAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ reports (portfolio margins from summed amounts)
export const PROFITABILITY_REPORTS = Object.freeze(["summary", "actual-margin", "forecast-margin", "profitable-vs-loss", "revenue-vs-cost-by-period", "cost-breakdown", "labor-vs-revenue",
  "budget-vs-forecast", "margin-history", "by-customer", "by-manager", "completed", "exceptions"]);
const totalRow = (label, rows, revenueKey, costKey) => {
  const revenue = sum(rows.filter((r) => r[revenueKey] !== null).map((r) => r[revenueKey]));
  const cost = sum(rows.filter((r) => r[revenueKey] !== null).map((r) => r[costKey]));
  const contribution = subMoney(revenue, cost);
  return { projectId: null, project: label, [revenueKey]: revenue, [costKey]: cost, contribution, margin: marginOf(contribution, revenue), total: true, excluded: rows.filter((r) => r[revenueKey] === null).length };
};
export async function getProjectProfitabilityReport(client, c, kind = "summary", filters = {}) {
  if (!PROFITABILITY_REPORTS.includes(kind)) throw profitError(400, "PROFITABILITY_INPUT_INVALID", "Unknown report.");
  if (!has(c, PRF.summary)) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  if (["forecast-margin", "budget-vs-forecast"].includes(kind) && !has(c, PRF.forecast)) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  if (["cost-breakdown", "labor-vs-revenue", "revenue-vs-cost-by-period", "margin-history"].includes(kind) && !has(c, PRF.details)) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  const projects = (await client.query(`SELECT project.*, party.display_name AS customer_name FROM tenant.projects project LEFT JOIN tenant.business_parties party ON party.id = project.customer_id
     WHERE project.organization_id = $1 AND project.deleted_at IS NULL AND project.status <> 'DRAFT' AND (${has(c, PRF.reconcile) ? "TRUE" : visibilitySql(c, "project", "$2")}) AND ($3::uuid IS NULL OR project.id = $3)
       AND ($2::uuid IS NULL OR TRUE) AND ($4::text IS NULL OR project.status = $4) ORDER BY project.project_code LIMIT 300`,
  [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null, filters.status ?? null])).rows;
  if (kind === "margin-history") {
    const ids = projects.map((p) => p.id);
    return (await client.query(`SELECT snapshot.*, project.project_code FROM tenant.project_profitability_snapshots snapshot JOIN tenant.projects project ON project.id = snapshot.project_id
        WHERE snapshot.project_id = ANY($1::uuid[]) ORDER BY project.project_code, snapshot.snapshot_at`, [ids])).rows.map((row) => ({ projectId: row.project_id, project: row.project_code, snapshot: `PS-${row.snapshot_number}`,
      at: row.snapshot_at, reason: row.reason, margin: row.actual_margin_percent === null ? null : Number(row.actual_margin_percent), forecastMargin: row.forecast_margin_percent === null ? null : Number(row.forecast_margin_percent), status: row.status }));
  }
  const managers = await userNames(client, projects.map((p) => p.manager_user_id).filter(Boolean));
  const rows = [];
  for (const project of projects) rows.push({ project, x: await profitabilityModel(client, c, project, { from: filters.from, to: filters.to }) });
  const tag = (p) => ({ projectId: p.id, project: p.project_code, name: p.name });
  const customerRows = rows.filter(({ x }) => !x.internal);
  const base = ({ project, x }) => ({ ...tag(project), status: x.status, recognized: x.actual.recognized, cost: x.actual.cost, contribution: x.actual.contribution, margin: x.actual.margin, completeness: x.completeness, basis: x.costBasis });
  switch (kind) {
    case "summary": {
      const out = rows.map((r) => ({ ...base(r), forecastContribution: has(c, PRF.forecast) ? r.x.forecast.contribution : null, forecastMargin: has(c, PRF.forecast) ? r.x.forecast.margin : null }));
      return [...out, totalRow("Portfolio (customer projects, summed)", customerRows.map(base), "recognized", "cost")];
    }
    case "actual-margin": return customerRows.map(base).sort((a, b) => (a.margin ?? -Infinity) - (b.margin ?? -Infinity));
    case "forecast-margin": {
      const out = customerRows.map(({ project, x }) => ({ ...tag(project), forecastStatus: x.forecastStatus, forecastRevenue: x.forecast.revenue, eac: x.forecast.eac, contribution: x.forecast.contribution, margin: x.forecast.margin }));
      const both = out.filter((r) => r.forecastRevenue !== null && r.eac !== null);
      const revenue = sum(both.map((r) => r.forecastRevenue));
      const eac = sum(both.map((r) => r.eac));
      return [...out, { projectId: null, project: "Portfolio (summed)", forecastRevenue: revenue, eac, contribution: subMoney(revenue, eac), margin: marginOf(subMoney(revenue, eac), revenue), total: true, excluded: out.length - both.length }];
    }
    case "profitable-vs-loss": {
      const groups = new Map();
      for (const r of customerRows) {
        const g = groups.get(r.x.status) ?? { status: r.x.status, projects: 0, recognized: "0.00", cost: "0.00" };
        groups.set(r.x.status, { status: r.x.status, projects: g.projects + 1, recognized: addMoney(g.recognized, r.x.actual.recognized ?? "0"), cost: addMoney(g.cost, r.x.actual.cost) });
      }
      return [...groups.values()].map((g) => ({ ...g, contribution: g.status === "UNKNOWN" ? null : subMoney(g.recognized, g.cost), margin: g.status === "UNKNOWN" ? null : marginOf(subMoney(g.recognized, g.cost), g.recognized) }));
    }
    case "revenue-vs-cost-by-period": {
      const out = [];
      for (const { project } of customerRows) for (const row of (await getProjectProfitabilityTrend(client, c, project.id, { from: filters.from, to: filters.to })).rows) out.push({ ...tag(project), ...row });
      return out;
    }
    case "cost-breakdown": return rows.flatMap(({ project, x }) => x.cost.byCategory.map((row) => ({ ...tag(project), category: row.label, amount: row.amount, share: marginOf(row.amount, x.actual.cost),
      kind: row.key === "OVERHEAD" ? "Indirect" : "Direct", basis: ["LABOR", "OVERHEAD"].includes(row.key) ? "Managerial" : "Finance-sourced" })));
    case "labor-vs-revenue": return customerRows.map(({ project, x }) => ({ ...tag(project), hours: Math.round(x.cost.labor.minutes / 6) / 10, labor: x.cost.labor.total, billable: x.cost.labor.billable,
      nonBillable: x.cost.labor.nonBillable, recognized: x.actual.recognized, laborShare: marginOf(x.cost.labor.total, x.actual.recognized) }));
    case "budget-vs-forecast": return rows.map(({ project, x }) => ({ ...tag(project), budget: x.budget.total, actual: x.costToDate.actual, eac: x.forecast.eac, variance: x.budget.forecastVariance, overrun: x.budget.overrun }));
    case "by-customer":
    case "by-manager": {
      const groups = new Map();
      for (const { project, x } of customerRows) {
        const k = kind === "by-customer" ? project.customer_name ?? "—" : managers.get(project.manager_user_id) ?? "—";
        const g = groups.get(k) ?? { group: k, projects: 0, recognized: "0.00", cost: "0.00", unknown: 0 };
        if (x.actual.recognized === null) groups.set(k, { ...g, projects: g.projects + 1, unknown: g.unknown + 1 });
        else groups.set(k, { ...g, projects: g.projects + 1, recognized: addMoney(g.recognized, x.actual.recognized), cost: addMoney(g.cost, x.actual.cost) });
      }
      return [...groups.values()].map((g) => ({ ...g, contribution: subMoney(g.recognized, g.cost), margin: marginOf(subMoney(g.recognized, g.cost), g.recognized) }));
    }
    case "completed": {
      const out = [];
      for (const { project, x } of rows.filter((r) => r.project.status === "COMPLETED")) {
        const snap = (await client.query(`SELECT * FROM tenant.project_profitability_snapshots WHERE project_id = $1 AND reason = 'COMPLETION' ORDER BY snapshot_at DESC LIMIT 1`, [project.id])).rows[0];
        out.push({ ...base({ project, x }), completedAt: project.completed_at, atCompletion: snap ? (snap.actual_contribution === null ? null : m(snap.actual_contribution)) : null,
          since: snap && snap.actual_contribution !== null && x.actual.contribution !== null ? subMoney(x.actual.contribution, m(snap.actual_contribution)) : null });
      }
      return out;
    }
    case "exceptions": {
      const out = [];
      for (const { project, x } of rows) for (const w of await profitabilityWarnings(client, c, x)) out.push({ ...tag(project), ...w });
      return out;
    }
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportProjectProfitability(client, c, projectId, filters = {}) {
  const summary = await getProjectProfitabilitySummary(client, c, projectId, filters);
  if (!summary.can.export) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  const project = (await client.query(`SELECT project_code FROM tenant.projects WHERE id = $1`, [projectId])).rows[0];
  const rows = [["Measure", "Amount (" + summary.currency + ")", "Note"],
    ["Basis", summary.basis.label, `${summary.basis.note} Completeness: ${summary.basis.completeness}. Calculation ${summary.calculationVersion}. Period: ${summary.period.label}.`],
    ["Recognized revenue", summary.actual.recognized, summary.actual.recognized === null ? "Unavailable from Finance" : "Finance postings"],
    ["Actual project cost", summary.actual.cost, summary.basis.cost],
    ["Actual contribution", summary.actual.contribution, summary.actual.provisional ? "Provisional: sources need reconciliation" : summary.status],
    ["Actual margin %", summary.actual.margin === null ? "N/A" : summary.actual.margin, ""]];
  if (summary.forecast) rows.push(["Forecast final revenue", summary.forecast.revenue, ""], ["Estimate at completion", summary.forecast.eac, summary.forecast.etc === null ? "No estimate to complete" : `ETC ${summary.forecast.etc}`],
    ["Forecast contribution", summary.forecast.contribution, summary.forecastStatus], ["Forecast margin %", summary.forecast.margin === null ? "N/A" : summary.forecast.margin, ""]);
  rows.push(["Approved budget", summary.budget.total, ""], ["Budget variance (forecast)", summary.budget.forecastVariance, "Negative = projected overrun"]);
  if (summary.commercial) rows.push(["Contract value", summary.commercial.contract, "Commercial reference"], ["Net invoiced", summary.commercial.netInvoiced, "Commercial reference"], ["Collected", summary.commercial.collected, "Cash, not profit"]);
  return { fileName: `${project.project_code}-profitability.csv`, csv: rows.map((row) => row.map(csvCell).join(",")).join("\r\n") };
}
