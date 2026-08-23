import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard } from "@vercentlabs/api";
import { formatDateTime, formatMoney } from "@vercentlabs/localization";

import AppIcon from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { classifyDueAt } from "@/core/work/types";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

type DashboardRow = Record<string, unknown>;

function percent(value: unknown, total: unknown) {
  const numerator = Number(value || 0);
  const denominator = Number(total || 0);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

  const canCreateLead = hasPermission(session, PERMISSIONS.crmLeadsManage);
  const canCreateOpportunity = hasPermission(
    session,
    PERMISSIONS.crmOpportunitiesManage,
  );
  const canCreateActivity = hasPermission(session, PERMISSIONS.crmActivitiesManage);
  const canViewReports = hasPermission(session, PERMISSIONS.crmReportsView);

  const pipelineValue = number(metrics.pipelineValue);
  const weightedPipeline = number(metrics.weightedPipeline);
  const openLeads = number(metrics.openLeads);
  const qualifiedLeads = number(metrics.qualifiedLeads);
  const openOpportunities = number(metrics.openOpportunities);
  const leadsThisMonth = number(metrics.leadsThisMonth);
  const conversionsThisMonth = number(metrics.conversionsThisMonth);
  const overdueActivities = number(metrics.overdueActivities);
  const dueToday = number(metrics.dueToday);
  const weightedShare = percent(weightedPipeline, pipelineValue);
  const qualifiedShare = percent(qualifiedLeads, openLeads);

  const stageTotal = Math.max(
    1,
    dashboard.stages.reduce(
      (sum: number, stage: DashboardRow) => sum + number(stage.amount),
      0,
    ),
  );
  const maxSourceVolume = Math.max(
    1,
    ...dashboard.sources.map((source: DashboardRow) => number(source.leadCount)),
  );

  return (
    <div className="crm-overview-shell">
      <header className="crm-overview-command">
        <div className="crm-overview-command__identity">
          <span className="crm-overview-command__mark" aria-hidden="true">
            <AppIcon name="crm" size={22} />
          </span>
          <div>
            <p className="eyebrow">CRM · Operating overview</p>
            <h1>Customer growth workspace</h1>
            <p>
              See demand, pipeline, follow-ups and conversion pressure in one
              decision surface, then move directly into the workflow that needs
              attention.
            </p>
          </div>
        </div>

        <div className="crm-overview-command__right">
          <span className="crm-overview-context">
            {session.companyName || "Organisation-wide"}
          </span>
          <div className="crm-overview-actions" aria-label="CRM quick actions">
            {canCreateLead ? (
              <Link className="primary-button" href="/crm/leads?create=1">
                Create lead
              </Link>
            ) : null}
            {canCreateOpportunity ? (
              <Link className="secondary-button" href="/crm/opportunities?create=1">
                New opportunity
              </Link>
            ) : null}
            {canCreateActivity ? (
              <Link className="secondary-button" href="/crm/activities?create=1">
                Schedule activity
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <section className="crm-overview-ledger" aria-label="CRM headline metrics">
        <Link href="/crm/pipeline" className="crm-overview-ledger__item">
          <span className="crm-overview-ledger__label">Open pipeline</span>
          <strong>{money(pipelineValue)}</strong>
          <small>{openOpportunities} active opportunities</small>
        </Link>
        <Link
          href={canViewReports ? "/crm/reports" : "/crm/pipeline"}
          className="crm-overview-ledger__item"
        >
          <span className="crm-overview-ledger__label">Weighted forecast</span>
          <strong>{money(weightedPipeline)}</strong>
          <small>{weightedShare}% of open pipeline</small>
        </Link>
        <Link href="/crm/leads" className="crm-overview-ledger__item">
          <span className="crm-overview-ledger__label">Qualified leads</span>
          <strong>{qualifiedLeads}</strong>
          <small>{qualifiedShare}% of {openLeads} open leads</small>
        </Link>
        <Link
          href={canViewReports ? "/crm/reports" : "/crm/leads"}
          className="crm-overview-ledger__item"
        >
          <span className="crm-overview-ledger__label">Conversions this month</span>
          <strong>{conversionsThisMonth}</strong>
          <small>{leadsThisMonth} leads captured this month</small>
        </Link>
      </section>

      <section className="crm-overview-attention" aria-label="CRM attention signals">
        <div className={overdueActivities ? "critical" : "clear"}>
          <span className="crm-overview-attention__signal" aria-hidden="true" />
          <div>
            <strong>{overdueActivities}</strong>
            <span>Overdue follow-ups</span>
          </div>
          <Link href="/crm/activities">Review</Link>
        </div>
        <div className={dueToday ? "warning" : "clear"}>
          <span className="crm-overview-attention__signal" aria-hidden="true" />
          <div>
            <strong>{dueToday}</strong>
            <span>Due today</span>
          </div>
          <Link href="/crm/activities">Open queue</Link>
        </div>
        <div>
          <span className="crm-overview-attention__signal" aria-hidden="true" />
          <div>
            <strong>{leadsThisMonth}</strong>
            <span>New leads this month</span>
          </div>
          <Link href="/crm/leads">View leads</Link>
        </div>
        <div>
          <span className="crm-overview-attention__signal" aria-hidden="true" />
          <div>
            <strong>{openOpportunities}</strong>
            <span>Open opportunities</span>
          </div>
          <Link href="/crm/pipeline">View pipeline</Link>
        </div>
      </section>

      <div className="crm-overview-primary-grid">
        <section className="crm-overview-surface crm-overview-revenue">
          <div className="crm-overview-section-heading">
            <div>
              <p className="eyebrow">Revenue trajectory</p>
              <h2>Where pipeline value is sitting</h2>
              <p>
                Read stage concentration before opening the board. Values use the
                same company, branch and record-visibility scope as the CRM lists.
              </p>
            </div>
            <Link href="/crm/pipeline">Open pipeline →</Link>
          </div>

          <div className="crm-overview-revenue-summary">
            <div>
              <span>Pipeline</span>
              <strong>{money(pipelineValue)}</strong>
              <small>{openOpportunities} open opportunities</small>
            </div>
            <div>
              <span>Weighted</span>
              <strong>{money(weightedPipeline)}</strong>
              <small>{weightedShare}% of pipeline value</small>
            </div>
          </div>

          <div className="crm-overview-stage-list">
            {dashboard.stages.map((stage: DashboardRow) => {
              const amount = number(stage.amount);
              const share = Math.max(2, percent(amount, stageTotal));
              return (
                <Link href="/crm/pipeline" key={String(stage.id)}>
                  <div className="crm-overview-stage-copy">
                    <strong>{String(stage.name || "Stage")}</strong>
                    <small>{String(stage.opportunityCount || 0)} opportunities</small>
                  </div>
                  <div className="crm-overview-stage-value">
                    <strong>{money(amount)}</strong>
                    <small>{percent(amount, stageTotal)}% of staged value</small>
                  </div>
                  <span className="crm-overview-stage-meter" aria-hidden="true">
                    <i style={{ width: `${share}%` }} />
                  </span>
                </Link>
              );
            })}
            {!dashboard.stages.length ? (
              <div className="crm-overview-empty">
                <AppIcon name="sales" size={20} />
                <strong>No pipeline stage activity yet</strong>
                <span>Create an opportunity to begin building the revenue view.</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="crm-overview-surface crm-overview-leads">
          <div className="crm-overview-section-heading compact">
            <div>
              <p className="eyebrow">Lead engine</p>
              <h2>Acquisition quality</h2>
              <p>Compare capture volume with qualification and source conversion.</p>
            </div>
            <Link href={canViewReports ? "/crm/reports" : "/crm/leads"}>
              {canViewReports ? "Reports →" : "Leads →"}
            </Link>
          </div>

          <div className="crm-overview-lead-pulse">
            <div>
              <strong>{openLeads}</strong>
              <span>Open leads</span>
            </div>
            <div>
              <strong>{qualifiedShare}%</strong>
              <span>Qualified share</span>
            </div>
            <div>
              <strong>{leadsThisMonth}</strong>
              <span>Captured this month</span>
            </div>
          </div>

          <div className="crm-overview-source-list">
            {dashboard.sources.slice(0, 6).map((source: DashboardRow) => {
              const volume = number(source.leadCount);
              const converted = number(source.convertedCount);
              const conversion = percent(converted, volume);
              const width = Math.max(3, Math.round((volume / maxSourceVolume) * 100));
              return (
                <div key={String(source.name || "Unattributed")}>
                  <div className="crm-overview-source-row">
                    <span className="crm-overview-source-avatar" aria-hidden="true">
                      {String(source.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{String(source.name || "Unattributed")}</strong>
                      <small>{volume} leads · {converted} converted</small>
                    </span>
                    <b>{conversion}%</b>
                  </div>
                  <span className="crm-overview-source-meter" aria-hidden="true">
                    <i style={{ width: `${width}%` }} />
                  </span>
                </div>
              );
            })}
            {!dashboard.sources.length ? (
              <div className="crm-overview-empty compact">
                <strong>No source data yet</strong>
                <span>Source performance appears after leads are attributed.</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="crm-overview-secondary-grid">
        <section className="crm-overview-surface crm-overview-activity">
          <div className="crm-overview-section-heading">
            <div>
              <p className="eyebrow">Seller work queue</p>
              <h2>Next customer actions</h2>
              <p>
                Upcoming work stays visible here; the activity centre remains the
                system of record for completion and outcome.
              </p>
            </div>
            <Link href="/crm/activities">Activity centre →</Link>
          </div>

          <div className="crm-overview-activity-list">
            {dashboard.activities.slice(0, 8).map((activity: DashboardRow) => {
              const overdue =
                classifyDueAt(
                  activity.dueAt ? String(activity.dueAt) : null,
                  session.timezone,
                ) === "overdue";
              return (
                <article key={String(activity.id)} className={overdue ? "overdue" : ""}>
                  <span className="crm-overview-activity-marker" aria-hidden="true" />
                  <div>
                    <strong>{String(activity.subject || "CRM activity")}</strong>
                    <small>
                      {String(activity.activityType || "task").replaceAll("_", " ")} ·{" "}
                      {String(activity.assignedName || "Unassigned")}
                    </small>
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
              );
            })}
            {!dashboard.activities.length ? (
              <div className="crm-overview-empty">
                <AppIcon name="check" size={20} />
                <strong>No open CRM activities</strong>
                <span>Create the next customer action when follow-up is required.</span>
                {canCreateActivity ? (
                  <Link className="secondary-button" href="/crm/activities?create=1">
                    Schedule activity
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className="crm-overview-surface crm-overview-decision-card">
          <p className="eyebrow">Decision guide</p>
          <h2>What needs attention first?</h2>
          <div className="crm-overview-decision-list">
            <Link href="/crm/activities" className={overdueActivities ? "priority" : ""}>
              <span>01</span>
              <div>
                <strong>Protect follow-up discipline</strong>
                <small>{overdueActivities} overdue · {dueToday} due today</small>
              </div>
              <b>→</b>
            </Link>
            <Link href="/crm/leads">
              <span>02</span>
              <div>
                <strong>Work the lead queue</strong>
                <small>{qualifiedLeads} qualified from {openLeads} open</small>
              </div>
              <b>→</b>
            </Link>
            <Link href="/crm/pipeline">
              <span>03</span>
              <div>
                <strong>Review revenue concentration</strong>
                <small>{money(weightedPipeline)} weighted forecast</small>
              </div>
              <b>→</b>
            </Link>
          </div>
        </section>
      </div>

    </div>
  );
}
