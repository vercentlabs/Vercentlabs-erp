import Link from "next/link";
import {
  getCustomerSuccessDashboard,
  getCrmCustomerSuccessReadiness,
} from "@vercentlabs/api";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function CustomerSuccessPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getCustomerSuccessDashboard(client, context),
        getCrmCustomerSuccessReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const renewals = (dashboard.renewals || []) as Row[];
  const interventions = (dashboard.interventions || []) as Row[];
  const milestones = (dashboard.upcomingMilestones || []) as Row[];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-03 customer success</p>
          <h1>Adoption, health and renewals</h1>
          <p>
            Manage onboarding milestones, usage telemetry, feedback, renewal
            forecasts and churn recovery from one governed workspace.
          </p>
        </div>
        <span
          className={`status-badge ${readiness.readiness === "ready" ? "success" : "danger"}`}
        >
          {String(readiness.readiness)} · {String(readiness.score)}%
        </span>
      </section>
      <section className="module-stat-grid">
        {[
          ["Active plans", summary.active_plans ?? 0],
          ["Healthy", summary.healthy ?? 0],
          [
            "At risk",
            Number(summary.at_risk ?? 0) + Number(summary.critical ?? 0),
          ],
          ["Average health", summary.average_health ?? "—"],
        ].map(([label, value]) => (
          <article className="metric-card" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>
      <section
        className="module-hero-actions"
        aria-label="Customer-success navigation"
      >
        <Link className="secondary-button" href="/crm/accounts">
          Open accounts
        </Link>
        <Link className="secondary-button" href="/crm/readiness">
          CRM readiness
        </Link>
      </section>
      <section className="panel">
        <h2>Renewal pipeline</h2>
        <div className="crm-stage-summary">
          {renewals.length ? (
            renewals.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>
                    {String(row.renewal_date)} · {String(row.forecast_category)}
                  </small>
                </span>
                <b>{String(row.risk_level)}</b>
              </div>
            ))
          ) : (
            <p>No open renewals.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Churn interventions</h2>
        <div className="crm-stage-summary">
          {interventions.length ? (
            interventions.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>{String(row.title)}</small>
                </span>
                <b>{String(row.severity)}</b>
              </div>
            ))
          ) : (
            <p>No open interventions.</p>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Milestones due</h2>
        <div className="crm-stage-summary">
          {milestones.length ? (
            milestones.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.display_name)}</strong>
                  <small>{String(row.title)}</small>
                </span>
                <b>{String(row.due_date)}</b>
              </div>
            ))
          ) : (
            <p>No milestones due in the next 14 days.</p>
          )}
        </div>
      </section>
    </>
  );
}
