import Link from "next/link";
import { notFound } from "next/navigation";
import { getCrmDashboard, listCrmRecords } from "@vercentlabs/api";
import { formatDateTime, formatMoney } from "@vercentlabs/localization";

import {
  ActionLink,
  ConvergenceBoundary,
  MetricCard,
  PageHeader,
  SectionHeader,
  StatePanel,
  StatusBadge,
  Surface,
} from "@/shared/design";
import AppIcon from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { classifyDueAt } from "@/shared/work/types";
import homeStyles from "./crm-home-additions.module.css";

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  task: "Tasks",
  call: "Calls",
  meeting: "Meetings",
  follow_up: "Follow-ups",
  email: "Emails",
};

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

  const context = await crmApiContext(session);
  const [dashboard, recentLeads] = await tenantTransaction(
    context.organizationId,
    (client) =>
      Promise.all([
        getCrmDashboard(client, context),
        listCrmRecords(client, context, "leads", { limit: 5 }),
      ]),
  );
  const metrics = dashboard.metrics as DashboardRow;

  // getCrmDashboard() and listCrmRecords() already apply the same
  // organization/company/branch/owner record scope as every other CRM
  // surface (see services/api/src/modules/crm/index.js's recordScope() and
  // ownerVisible()) — a seller without crm.records.view_all transparently
  // sees only their own numbers here, a manager with it sees the team's.
  // This flag is presentation-only labeling of that already-authorized
  // scope, not a second authorization decision.
  const isTeamScope =
    hasPermission(session, PERMISSIONS.crmRecordsViewAll) ||
    session.roleSlugs.includes("organization_owner");
  const scopeWord = isTeamScope ? "Team" : "My";

  const activityTypeCounts = new Map<string, number>();
  for (const activity of dashboard.activities as DashboardRow[]) {
    const key = String(activity.activityType || "task");
    activityTypeCounts.set(key, (activityTypeCounts.get(key) || 0) + 1);
  }
  const activityTypeBreakdown = [...activityTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      label: ACTIVITY_TYPE_LABELS[type] || type.replaceAll("_", " "),
      count,
    }));
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
  const unassignedLeads = number(metrics.unassignedLeads);
  const dwellBreachedLeads = number(metrics.dwellBreachedLeads);
  const stalledOpportunities = number(metrics.stalledOpportunities);
  const uncoveredTerritories = number(metrics.uncoveredTerritories);
  const needsQualificationLeads = number(metrics.needsQualificationLeads);
  const highPriorityLeads = number(metrics.highPriorityLeads);
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
    <ConvergenceBoundary area="module" className="crm-overview-shell">
      <PageHeader
        eyebrow={
          <>
            <AppIcon name="crm" size={16} /> CRM · Operating overview
          </>
        }
        title="Customer growth workspace"
        description="See demand, pipeline, follow-ups and conversion pressure in one decision surface, then move directly into the workflow that needs attention."
        context={
          <span className="crm-overview-context">
            {session.companyName || "Organisation-wide"}
          </span>
        }
        actions={
          <div className="crm-overview-actions" aria-label="CRM quick actions">
            {canCreateLead ? (
              <ActionLink tone="primary" href="/crm/leads?create=1">
                Create lead
              </ActionLink>
            ) : null}
            {canCreateOpportunity ? (
              <ActionLink href="/crm/opportunities?create=1">
                New opportunity
              </ActionLink>
            ) : null}
            {canCreateActivity ? (
              <ActionLink href="/crm/activities?create=1">
                Schedule activity
              </ActionLink>
            ) : null}
          </div>
        }
      />

      <section className="crm-overview-ledger" aria-label="CRM headline metrics">
        <Link href="/crm/pipeline" className="crm-overview-ledger__item">
          <MetricCard
            label="Open pipeline"
            value={money(pipelineValue)}
            hint={`${openOpportunities} active opportunities`}
          />
        </Link>
        <Link
          href={canViewReports ? "/crm/reports" : "/crm/pipeline"}
          className="crm-overview-ledger__item"
        >
          <MetricCard
            label="Weighted forecast"
            value={money(weightedPipeline)}
            hint={`${weightedShare}% of open pipeline`}
          />
        </Link>
        <Link href="/crm/leads" className="crm-overview-ledger__item">
          <MetricCard
            label="Qualified leads"
            value={qualifiedLeads}
            hint={`${qualifiedShare}% of ${openLeads} open leads`}
          />
        </Link>
        <Link
          href={canViewReports ? "/crm/reports" : "/crm/leads"}
          className="crm-overview-ledger__item"
        >
          <MetricCard
            label="Conversions this month"
            value={conversionsThisMonth}
            hint={`${leadsThisMonth} leads captured this month`}
          />
        </Link>
      </section>

      <section className="crm-overview-attention" aria-label="CRM attention signals">
        <MetricCard
          tone={overdueActivities ? "danger" : "neutral"}
          label="Overdue follow-ups"
          value={overdueActivities}
          action={<Link href="/crm/activities">Review</Link>}
        />
        <MetricCard
          tone={dueToday ? "warning" : "neutral"}
          label="Due today"
          value={dueToday}
          action={<Link href="/crm/activities">Open queue</Link>}
        />
        <MetricCard
          label="New leads this month"
          value={leadsThisMonth}
          action={<Link href="/crm/leads">View leads</Link>}
        />
        <MetricCard
          label="Open opportunities"
          value={openOpportunities}
          action={<Link href="/crm/pipeline">View pipeline</Link>}
        />
        <MetricCard
          tone={unassignedLeads ? "warning" : "neutral"}
          label="Unassigned leads"
          value={unassignedLeads}
          action={<Link href="/crm/leads">Assign now</Link>}
        />
        <MetricCard
          tone={dwellBreachedLeads ? "danger" : "neutral"}
          label="Leads stalled beyond stage SLA"
          value={dwellBreachedLeads}
          action={<Link href="/crm/leads">Review</Link>}
        />
        <MetricCard
          tone={stalledOpportunities ? "danger" : "neutral"}
          label="Opportunities stalled beyond stage SLA"
          value={stalledOpportunities}
          action={<Link href="/crm/pipeline">Review</Link>}
        />
        <MetricCard
          tone={uncoveredTerritories ? "warning" : "neutral"}
          label="Territories with no primary owner"
          value={uncoveredTerritories}
          action={<Link href="/crm/territory-assignments">Assign</Link>}
        />
        <MetricCard
          label="Needs qualification"
          value={needsQualificationLeads}
          action={<Link href="/crm/leads">Review</Link>}
        />
        <MetricCard
          label="High priority (hot/qualified)"
          value={highPriorityLeads}
          action={<Link href="/crm/leads">View leads</Link>}
        />
      </section>

      <div className="crm-overview-primary-grid">
        <Surface as="section" className="crm-overview-surface crm-overview-revenue">
          <SectionHeader
            eyebrow="Revenue trajectory"
            title="Where pipeline value is sitting"
            description="Read stage concentration before opening the board. Values use the same company, branch and record-visibility scope as the CRM lists."
            actions={<Link href="/crm/pipeline">Open pipeline →</Link>}
          />

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
              <StatePanel
                title="No pipeline stage activity yet"
                description="Create an opportunity to begin building the revenue view."
              />
            ) : null}
          </div>
        </Surface>

        <Surface as="section" className="crm-overview-surface crm-overview-leads">
          <SectionHeader
            eyebrow="Lead engine"
            title="Acquisition quality"
            description="Compare capture volume with qualification and source conversion."
            actions={
              <Link href={canViewReports ? "/crm/reports" : "/crm/leads"}>
                {canViewReports ? "Reports →" : "Leads →"}
              </Link>
            }
          />

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
              <StatePanel
                title="No source data yet"
                description="Source performance appears after leads are attributed."
              />
            ) : null}
          </div>
        </Surface>
      </div>

      <div className="crm-overview-secondary-grid">
        <Surface as="section" className="crm-overview-surface crm-overview-activity">
          <SectionHeader
            eyebrow={`${scopeWord} day`}
            title="Next customer actions"
            description="Upcoming work stays visible here; the activity centre remains the system of record for completion and outcome."
            actions={<Link href="/crm/activities">Activity centre →</Link>}
          />

          {activityTypeBreakdown.length ? (
            <ul className={homeStyles.activityTypeBreakdown} aria-label={`${scopeWord} open work by type`}>
              {activityTypeBreakdown.map((entry) => (
                <li key={entry.label}>
                  <strong>{entry.count}</strong>
                  <span>{entry.label}</span>
                </li>
              ))}
            </ul>
          ) : null}

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
              <StatePanel
                title="No open CRM activities"
                description="Create the next customer action when follow-up is required."
                action={
                  canCreateActivity ? (
                    <ActionLink href="/crm/activities?create=1">
                      Schedule activity
                    </ActionLink>
                  ) : undefined
                }
              />
            ) : null}
          </div>
        </Surface>

        <Surface as="section" className="crm-overview-surface crm-overview-decision-card">
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
        </Surface>
      </div>

      <Surface as="section" className={homeStyles.recentLeads}>
        <SectionHeader
          eyebrow={`${scopeWord} recent leads`}
          title="Recently captured leads"
          description="The five most recent leads visible to you, using the same record scope as the Leads list."
          actions={<Link href="/crm/leads">Open Leads →</Link>}
        />
        {recentLeads.rows.length ? (
          <ul className={homeStyles.recentLeadsList}>
            {recentLeads.rows.map((lead: DashboardRow) => (
              <li key={String(lead.id)}>
                <Link href={`/crm/leads/${lead.id}`}>
                  <span className={homeStyles.recentLeadsName}>
                    <strong>{String(lead.fullName || "Unnamed lead")}</strong>
                    <small>{String(lead.companyName || "No company on file")}</small>
                  </span>
                  <StatusBadge tone={lead.recordStatus === "converted" ? "success" : "neutral"}>
                    {String(lead.status || lead.recordStatus || "new")}
                  </StatusBadge>
                  <time>
                    {lead.createdAt
                      ? formatDateTime(String(lead.createdAt), {
                          timeZone: session.timezone,
                          locale: session.locale,
                        })
                      : ""}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <StatePanel
            title="No leads captured yet"
            description="New leads you can see will appear here as soon as they are created."
            action={
              canCreateLead ? (
                <ActionLink href="/crm/leads?create=1">Create lead</ActionLink>
              ) : undefined
            }
          />
        )}
      </Surface>

    </ConvergenceBoundary>
  );
}
