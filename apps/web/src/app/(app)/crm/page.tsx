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

type DashboardRow = Record<string, unknown>;

function percentage(value: unknown, total: unknown) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return Math.min(100, Math.max(0, Math.round((Number(value || 0) / denominator) * 100)));
}

export default async function CrmDashboardPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const context = crmContext(session);
  const dashboard = await tenantTransaction(context.organizationId, (client) =>
    getCrmDashboard(client, context),
  );
  const metrics = dashboard.metrics as DashboardRow;
  const money = (value: unknown) =>
    formatMoney(value, {
      currency: String(metrics.currencyCode || "INR"),
      locale: session.locale,
    });

  const primaryMetrics = [
    {
      label: "Open pipeline",
      value: money(metrics.pipelineValue),
      meta: `${String(metrics.openOpportunities || 0)} active opportunities`,
      href: "/crm/pipeline",
      tone: "indigo",
      icon: "sales" as const,
    },
    {
      label: "Weighted forecast",
      value: money(metrics.weightedPipeline),
      meta: "Probability-adjusted revenue",
      href: "/crm/reports",
      tone: "cyan",
      icon: "dashboard" as const,
    },
    {
      label: "Qualified leads",
      value: String(metrics.qualifiedLeads || 0),
      meta: `${String(metrics.openLeads || 0)} open leads in total`,
      href: "/crm/leads",
      tone: "emerald",
      icon: "crm" as const,
    },
    {
      label: "Conversions this month",
      value: String(metrics.conversionsThisMonth || 0),
      meta: "New customer journeys created",
      href: "/crm/reports",
      tone: "amber",
      icon: "sparkles" as const,
    },
  ];

  const maxStageAmount = Math.max(
    1,
    ...dashboard.stages.map((stage: DashboardRow) => Number(stage.amount || 0)),
  );

  return (
    <div className="module-workbench crm-workbench">
      <section className="module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="crm" size={22} />
          </span>
          <div>
            <p className="eyebrow">Revenue workspace</p>
            <h1>Customer growth command centre</h1>
            <p>
              Prioritise the next best action across leads, opportunities,
              follow-ups and forecasts without losing customer context.
            </p>
          </div>
        </div>
        <div className="module-hero-actions" aria-label="CRM quick actions">
          <Link className="primary-button" href="/crm/leads?create=1">
            Create lead
          </Link>
          <Link className="secondary-button" href="/crm/opportunities?create=1">
            New opportunity
          </Link>
          <Link className="secondary-button" href="/crm/activities?create=1">
            Schedule activity
          </Link>
        </div>
      </section>

      <section className="module-metric-grid" aria-label="CRM performance">
        {primaryMetrics.map((metric) => (
          <Link
            className={`module-metric-card tone-${metric.tone}`}
            href={metric.href}
            key={metric.label}
          >
            <span className="module-metric-icon" aria-hidden="true">
              <AppIcon name={metric.icon} size={18} />
            </span>
            <span className="module-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.meta}</small>
            <span className="module-card-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <section className="attention-strip" aria-label="CRM attention queue">
        <Link href="/crm/activities">
          <span className="attention-dot danger" />
          <strong>{String(metrics.overdueActivities || 0)}</strong>
          <span>Overdue follow-ups</span>
        </Link>
        <Link href="/crm/activities">
          <span className="attention-dot warning" />
          <strong>{String(metrics.dueToday || 0)}</strong>
          <span>Activities due today</span>
        </Link>
        <Link href="/crm/leads">
          <span className="attention-dot info" />
          <strong>{String(metrics.openLeads || 0)}</strong>
          <span>Open leads requiring ownership</span>
        </Link>
        <Link href="/crm/reports">
          <span className="attention-dot success" />
          <strong>{String(metrics.conversionsThisMonth || 0)}</strong>
          <span>Conversions recorded this month</span>
        </Link>
      </section>

      <div className="module-dashboard-grid module-dashboard-grid-wide">
        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Pipeline health</p>
              <h2>Revenue by stage</h2>
              <p>Spot stalled value and focus seller attention where it matters.</p>
            </div>
            <Link className="link-button" href="/crm/pipeline">
              Open pipeline
            </Link>
          </div>
          <div className="stage-health-list">
            {dashboard.stages.map((stage: DashboardRow) => {
              const amount = Number(stage.amount || 0);
              const width = Math.max(4, Math.round((amount / maxStageAmount) * 100));
              return (
                <Link href="/crm/pipeline" key={String(stage.id)}>
                  <span className="stage-health-copy">
                    <strong>{String(stage.name)}</strong>
                    <small>
                      {String(stage.opportunityCount || 0)} opportunities · {String(stage.probability || 0)}% probability
                    </small>
                  </span>
                  <span className="stage-health-value">{money(stage.amount)}</span>
                  <span className="stage-health-meter" aria-hidden="true">
                    <i style={{ width: `${width}%` }} />
                  </span>
                </Link>
              );
            })}
            {!dashboard.stages.length ? (
              <div className="module-empty-state compact">
                <strong>No pipeline stages have activity yet</strong>
                <p>Create an opportunity to begin forecasting revenue.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel module-panel">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Acquisition quality</p>
              <h2>Lead source performance</h2>
              <p>Compare volume with conversion, not activity alone.</p>
            </div>
            <Link className="link-button" href="/crm/reports">
              View reports
            </Link>
          </div>
          <div className="source-performance-list">
            {dashboard.sources.map((source: DashboardRow) => {
              const conversion = percentage(source.convertedCount, source.leadCount);
              return (
                <div key={String(source.name)}>
                  <span className="source-avatar" aria-hidden="true">
                    {String(source.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="source-performance-copy">
                    <strong>{String(source.name || "Unattributed")}</strong>
                    <small>
                      {String(source.leadCount || 0)} leads · {String(source.convertedCount || 0)} converted
                    </small>
                  </span>
                  <span className="source-conversion">
                    <strong>{conversion}%</strong>
                    <small>conversion</small>
                  </span>
                </div>
              );
            })}
            {!dashboard.sources.length ? (
              <div className="module-empty-state compact">
                <strong>No acquisition data yet</strong>
                <p>Source performance appears after leads are captured.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="module-dashboard-grid">
        <section className="panel module-panel module-panel-span-2">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Seller work queue</p>
              <h2>Upcoming and overdue activity</h2>
              <p>Every item should end with a clear owner, time and outcome.</p>
            </div>
            <Link className="link-button" href="/crm/activities">
              Open activity centre
            </Link>
          </div>
          <div className="module-timeline">
            {dashboard.activities.map((activity: DashboardRow) => (
              <article key={String(activity.id)}>
                <span className="timeline-marker" aria-hidden="true" />
                <div>
                  <strong>{String(activity.subject)}</strong>
                  <p>
                    {String(activity.activityType || "task").replaceAll("_", " ")} · {String(activity.assignedName || "Unassigned")}
                  </p>
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
              <div className="module-empty-state">
                <span className="module-empty-icon" aria-hidden="true">
                  <AppIcon name="check" size={22} />
                </span>
                <strong>Your follow-up queue is clear</strong>
                <p>Create the next customer action before leaving a record.</p>
                <Link className="secondary-button" href="/crm/activities?create=1">
                  Create activity
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panel module-panel workflow-launchpad">
          <div className="module-section-heading">
            <div>
              <p className="eyebrow">Workflow shortcuts</p>
              <h2>Move work forward</h2>
            </div>
          </div>
          {[
            ["Qualify new demand", "Review open leads and assign the next action.", "/crm/leads"],
            ["Advance revenue", "Update stage, close date and forecast confidence.", "/crm/pipeline"],
            ["Protect relationships", "Review account health and engagement gaps.", "/crm/reports"],
            ["Tune the system", "Manage pipelines, scoring and automations.", "/crm/settings"],
          ].map(([title, description, href], index) => (
            <Link href={href} key={href}>
              <span className="workflow-step-number">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </aside>
      </div>
    </div>
  );
}
