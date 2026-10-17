// Projects — Project Profitability, the commands. Profitability keeps no editable figures: a forecast revision is recorded where each part
// belongs (the estimate to complete in Project Cost, the further-revenue estimate in Project Revenue), and a snapshot is an immutable copy
// of the calculated figures at a moment — on request, and automatically when a project completes — so later reports can say what the
// figures were then, and what has been restated since.
import { notifyProject, registerProgressListener, text } from "../project-core.js";
import { saveProjectCostForecast } from "../costing/cost-commands.js";
import { saveRevenueForecast } from "../revenue/revenue-commands.js";
import { CALCULATION_VERSION, profitError, profitScope } from "./profitability-rules.js";
import { profitabilityModel, profitabilityWarnings } from "./profitability-read.js";

// input: { estimateToComplete, commitmentTreatment, expectedFurtherRevenue?, assumptions, expectedCostForecastVersion?, idempotencyKey? }
export async function saveProfitabilityForecast(client, c, projectId, input = {}) {
  const { project, can } = await profitScope(client, c, projectId, { lock: true });
  if (!can.editForecast) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  const assumptions = text(input.assumptions, 2000);
  if (assumptions.length < 3) throw profitError(400, "PROFITABILITY_INPUT_INVALID", "State the forecast's assumptions.", { field: "assumptions" });
  if (input.expectedCostForecastVersion !== undefined && input.expectedCostForecastVersion !== null) {
    const latest = (await client.query(`SELECT COALESCE(max(version), 0) AS v FROM tenant.project_cost_forecasts WHERE project_id = $1`, [project.id])).rows[0].v;
    if (Number(latest) !== Number(input.expectedCostForecastVersion)) throw profitError(409, "PROFITABILITY_VERSION_CONFLICT", undefined, { current: Number(latest) });
  }
  const key = text(input.idempotencyKey, 180) || null;
  // The profitability right carries the two underlying forecast rights for this one orchestrated revision.
  const acting = { ...c, permissions: [...(c.permissions ?? []), "projects.cost.forecast_edit", "projects.revenue.forecast_edit"] };
  const cost = await saveProjectCostForecast(client, acting, project.id, { estimateToComplete: input.estimateToComplete, commitmentTreatment: input.commitmentTreatment, asOfDate: input.asOfDate,
    notes: assumptions, idempotencyKey: key ? `${key}:cost` : undefined });
  let revenue = null;
  if (input.expectedFurtherRevenue !== undefined && input.expectedFurtherRevenue !== null && input.expectedFurtherRevenue !== "") {
    revenue = await saveRevenueForecast(client, acting, project.id, { expectedFurtherRevenue: input.expectedFurtherRevenue, asOfDate: input.asOfDate, assumptions, idempotencyKey: key ? `${key}:revenue` : undefined });
  }
  return { costForecastVersion: cost.version, revenueForecastVersion: revenue?.version ?? null, replayed: Boolean(cost.replayed) };
}

async function insertSnapshot(client, c, project, { reason, note = null, key = null }) {
  const x = await profitabilityModel(client, c, project);
  const warnings = await profitabilityWarnings(client, c, x);
  const periodEnd = reason === "COMPLETION" && project.completed_at
    ? (await client.query(`SELECT to_char(($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`, [project.completed_at])).rows[0].d
    : (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;
  const watermark = { costLines: x.cost.byCategory.reduce((s, row) => s + row.lines, 0), revenueEntries: x.rev.recognition.rows.length, invoices: x.rev.inv.invoices.length };
  const made = (await client.query(`INSERT INTO tenant.project_profitability_snapshots (organization_id, project_id, reason, note, period_end, calculation_version, cost_basis, reporting_currency, contract_value,
        net_invoiced, collected, recognized_revenue, comparable_actual_cost, actual_contribution, actual_margin_percent, budget_total, estimate_to_complete, estimate_at_completion, forecast_revenue,
        forecast_contribution, forecast_margin_percent, status, forecast_status, completeness, cost_forecast_version, revenue_forecast_version, contract_versions, warnings, source_watermarks, created_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) ON CONFLICT DO NOTHING RETURNING id, snapshot_number`,
  [c.organizationId, project.id, reason, note, periodEnd, CALCULATION_VERSION, x.costBasis, x.currency, x.commercial.contract, x.commercial.netInvoiced, x.commercial.collected, x.actual.recognized, x.actual.cost,
    x.actual.contribution, x.actual.margin, x.budget.total, x.forecast.etc, x.forecast.eac, x.forecast.revenue, x.forecast.contribution, x.forecast.margin, x.status, x.forecastStatus, x.completeness,
    x.forecast.costForecastVersion, x.forecast.revenueForecastVersion, JSON.stringify([...new Set(x.rev.contract.lines.map((line) => `${line.orderNumber} v${line.version}`))]), JSON.stringify(warnings),
    JSON.stringify(watermark), c.userId ?? null, key])).rows[0];
  return { made, x, warnings };
}
// input: { note?, idempotencyKey? } — a dated, immutable copy of the figures as calculated now.
export async function recordProfitabilitySnapshot(client, c, projectId, input = {}) {
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id, snapshot_number FROM tenant.project_profitability_snapshots WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { snapshotId: done.id, number: `PS-${done.snapshot_number}`, replayed: true };
  }
  const { project, can } = await profitScope(client, c, projectId, { lock: true });
  if (!can.snapshot) throw profitError(403, "PROFITABILITY_PERMISSION_DENIED");
  const previous = (await client.query(`SELECT warnings FROM tenant.project_profitability_snapshots WHERE project_id = $1 ORDER BY snapshot_at DESC LIMIT 1`, [project.id])).rows[0];
  const { made, warnings } = await insertSnapshot(client, c, project, { reason: "MANUAL", note: text(input.note, 500) || null, key });
  // The manager hears of financial warnings that are new since the last snapshot (never a status or priority change).
  const before = new Set((previous?.warnings ?? []).map((w) => w.kind));
  const fresh = warnings.filter((w) => ["warning", "danger"].includes(w.severity) && !before.has(w.kind));
  if (fresh.length && project.manager_user_id) {
    await notifyProject(client, c, project, [project.manager_user_id], { category: "project_profitability", title: `${project.project_code}: profitability needs attention`, message: fresh.map((w) => w.message).join(" ") });
  }
  return { snapshotId: made.id, number: `PS-${made.snapshot_number}`, warnings: warnings.length, notified: fresh.length };
}
// When a project completes, the figures at completion are kept; later corrections still change the live figures.
registerProgressListener(async (client, c, projectId, cause) => {
  if (cause?.type !== "PROJECT" || cause.to !== "COMPLETED") return;
  const project = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, projectId])).rows[0];
  if (!project || project.status !== "COMPLETED") return;
  await client.query("SAVEPOINT profitability_completion");
  try { await insertSnapshot(client, c, project, { reason: "COMPLETION" }); await client.query("RELEASE SAVEPOINT profitability_completion"); }
  catch { await client.query("ROLLBACK TO SAVEPOINT profitability_completion"); }
});
