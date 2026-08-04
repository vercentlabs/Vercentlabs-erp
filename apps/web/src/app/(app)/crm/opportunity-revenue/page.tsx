import {
  getCrmOpportunityRevenueReadiness,
  getOpportunityRevenueDashboard,
} from "@vercentlabs/api";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    Number(value || 0),
  );
export default async function OpportunityRevenuePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return null;
  const context = crmContext(session);
  const { dashboard, readiness } = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getOpportunityRevenueDashboard(client, context),
      readiness: await getCrmOpportunityRevenueReadiness(client, context),
    }),
  );
  const summary = (dashboard.summary || {}) as Record<string, unknown>;
  const forecast = dashboard.latestForecast as Record<string, unknown> | null;
  const winLoss = (dashboard.winLoss || {}) as Record<string, unknown>;
  const quota = (dashboard.quota || {}) as Record<string, unknown>;
  const actionPlans = (dashboard.actionPlans || []) as Array<
    Record<string, unknown>
  >;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-09 · Opportunity intelligence</p>
          <h1>Revenue, action plans and predictive forecast</h1>
          <p>
            Govern recurring revenue, team credit, mutual commitments, quota
            seasonality, cloning and win-loss learning.
          </p>
        </div>
        <span
          className={`status-badge ${readiness.readiness === "ready" ? "success" : "neutral"}`}
        >
          {String(readiness.readiness)} · {String(readiness.passed)}/
          {String(readiness.total)}
        </span>
      </section>
      <div className="crm-dashboard-grid">
        {[
          ["Open opportunities", summary.open_opportunities || 0],
          ["Open pipeline", money(summary.open_pipeline)],
          ["Predicted revenue", money(forecast?.predicted_amount)],
          ["Quota allocated", money(quota.allocated)],
          ["Won", winLoss.won || 0],
          ["Lost", winLoss.lost || 0],
        ].map(([label, value]) => (
          <section className="panel" key={String(label)}>
            <p className="eyebrow">{String(label)}</p>
            <h2>{String(value)}</h2>
          </section>
        ))}
      </div>
      <section className="panel">
        <p className="eyebrow">Mutual action plans</p>
        <h2>Customer and seller commitments</h2>
        <div className="crm-stage-summary">
          {actionPlans.map((row) => (
            <div key={String(row.id)}>
              <span>
                <strong>{String(row.name)}</strong>
                <small>
                  {String(row.completed)} of {String(row.milestones)} milestones
                  completed
                </small>
              </span>
              <b>{String(row.status)}</b>
            </div>
          ))}
          {!actionPlans.length ? (
            <p>No action plans have been created yet.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}
