import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard } from "@vercentlabs/api";
import { formatDateTime, formatMoney } from "@vercentlabs/localization";
import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";
export default async function CrmDashboardPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = crmContext(session);
  const dashboard = await tenantTransaction(context.organizationId, (client) =>
    getCrmDashboard(client, context),
  );
  const metrics = dashboard.metrics as Record<string, unknown>;
  const money = (value: unknown) =>
    formatMoney(value, {
      currency: String(metrics.currencyCode || "INR"),
      locale: session.locale,
    });
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Customer relationship management</p>
          <h1>Turn every enquiry into accountable revenue</h1>
          <p>
            Capture leads, plan follow-ups, manage opportunities, attribute
            campaigns and preserve the complete customer journey.
          </p>
        </div>
        <div className="heading-actions" aria-label="CRM quick actions">
          <Link className="primary-button" href="/crm/leads?create=1">
            Create lead
          </Link>
          <Link className="secondary-button" href="/crm/opportunities?create=1">
            Create opportunity
          </Link>
          <Link className="secondary-button" href="/crm/activities?create=1">
            Create activity
          </Link>
          <Link className="secondary-button" href="/crm/pipeline">
            Open pipeline
          </Link>
        </div>
      </section>
      <section className="crm-metric-grid" aria-label="CRM health">
        {[
          ["Open leads", metrics.openLeads, "leads"],
          ["Qualified leads", metrics.qualifiedLeads, "qualified"],
          ["Open opportunities", metrics.openOpportunities, "opportunities"],
          ["Pipeline value", money(metrics.pipelineValue), "pipeline"],
          ["Weighted forecast", money(metrics.weightedPipeline), "forecast"],
          ["Overdue follow-ups", metrics.overdueActivities, "overdue"],
          ["Due today", metrics.dueToday, "today"],
          [
            "Conversions this month",
            metrics.conversionsThisMonth,
            "conversion",
          ],
        ].map(([label, value, hint]) => (
          <Link
            className="metric-card"
            href={
              hint === "leads" || hint === "qualified"
                ? "/crm/leads"
                : hint === "opportunities"
                  ? "/crm/opportunities"
                  : hint === "pipeline" || hint === "forecast"
                    ? "/crm/pipeline"
                    : hint === "overdue" || hint === "today"
                      ? "/crm/activities"
                      : "/crm/reports"
            }
            key={String(label)}
            aria-label={`Open ${String(label)}`}
          >
            <span className="metric-icon">
              <AppIcon name="crm" size={20} />
            </span>
            <p>{String(label)}</p>
            <strong>{String(value ?? 0)}</strong>
            <small>
              {String(hint)} <span aria-hidden="true">→</span>
            </small>
          </Link>
        ))}
      </section>
      <div className="crm-dashboard-grid">
        <section className="panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Pipeline</p>
              <h2>Stage health</h2>
            </div>
            <Link className="link-button" href="/crm/pipeline">
              View Kanban
            </Link>
          </div>
          <div className="crm-stage-summary">
            {dashboard.stages.map((stage: Record<string, unknown>) => (
              <div key={String(stage.id)}>
                <span>
                  <strong>{String(stage.name)}</strong>
                  <small>{String(stage.opportunityCount)} opportunities</small>
                </span>
                <b>{money(stage.amount)}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Lead sources</p>
              <h2>Acquisition quality</h2>
            </div>
            <Link className="link-button" href="/crm/reports">
              Reports
            </Link>
          </div>
          <div className="crm-stage-summary">
            {dashboard.sources.map((source: Record<string, unknown>) => (
              <div key={String(source.name)}>
                <span>
                  <strong>{String(source.name)}</strong>
                  <small>{String(source.convertedCount)} converted</small>
                </span>
                <b>{String(source.leadCount)} leads</b>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Next actions</p>
            <h2>Upcoming and overdue work</h2>
          </div>
          <Link className="link-button" href="/crm/activities">
            Open activity centre
          </Link>
        </div>
        <div className="activity-list">
          {dashboard.activities.map((activity: Record<string, unknown>) => (
            <article key={String(activity.id)}>
              <div>
                <strong>{String(activity.subject)}</strong>
                <span>
                  {String(activity.activityType).replaceAll("_", " ")} ·{" "}
                  {String(activity.assignedName || "Unassigned")}
                </span>
              </div>
              <time>
                {activity.dueAt
                  ? formatDateTime(String(activity.dueAt), {
                      timeZone: session.timezone,
                      locale: session.locale,
                    })
                  : "No due date"}
              </time>
            </article>
          ))}
          {!dashboard.activities.length ? (
            <div className="empty-state">
              <strong>No pending activities</strong>
              <p>
                Create a task, call, meeting or follow-up for the next customer action.
              </p>
              <Link className="primary-button" href="/crm/activities?create=1">
                Create activity
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
