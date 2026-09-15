"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { money } from "@/features/crm/shared/format";
import { CrmDashboardApiError, getCrmDashboardData } from "../api/dashboard-api";
import type { CrmDashboardActivity } from "../types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F024 Tranche K — a metric that drills into a pre-filtered list when a
// safe, verified filter mapping exists (confirmed against the exact SQL
// predicate getCrmDashboard uses for that count, and against what the
// Lead/Opportunity list's own filter actually queries server-side —
// e.g. Lead's "status" filter is a STAGE filter, not record_status, so
// "open leads" is deliberately NOT drilled here to avoid a plausible-
// looking but subtly wrong link). Metrics with no such mapping render
// as a plain, non-interactive MetricCard-style block instead of a fake
// disabled-looking button.
function DrillMetric({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  const content = (
    <>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text">{value.toLocaleString()}</p>
    </>
  );
  if (!onPress) return <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4">{content}</div>;
  return (
    <button type="button" onClick={onPress} className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left hover:border-brand-border hover:bg-brand-soft">
      {content}
    </button>
  );
}

function activityHref(activity: CrmDashboardActivity): string | null {
  if (activity.entityType === "lead" && activity.entityId) return `/crm/leads/${activity.entityId}`;
  if (activity.entityType === "opportunity" && activity.entityId) return `/crm/opportunities/${activity.entityId}`;
  if (activity.entityType === "party" && activity.entityId) return `/crm/accounts/${activity.entityId}`;
  if (activity.entityType === "contact" && activity.entityId) return `/crm/contacts/${activity.entityId}`;
  return null;
}

export function CrmDashboardScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "dashboard"),
    queryFn: getCrmDashboardData,
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading dashboard…</p>;
  if (query.isError) {
    if (query.error instanceof CrmDashboardApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to the CRM dashboard" />;
    }
    return <ErrorState title="Could not load the dashboard" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const dashboard = query.data?.dashboard;
  if (!dashboard) return null;
  const { metrics, stages, sources, activities } = dashboard;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Dashboard" description="Pipeline, activity and coverage, scoped to what you can see." />

      <MetricStrip
        metrics={[
          { label: "Open leads", value: metrics.openLeads.toLocaleString() },
          { label: "Open opportunities", value: metrics.openOpportunities.toLocaleString() },
          { label: "Pipeline value", value: money(metrics.currencyCode, metrics.pipelineValue) },
          { label: "Weighted pipeline", value: money(metrics.currencyCode, metrics.weightedPipeline) },
          { label: "Overdue activities", value: metrics.overdueActivities.toLocaleString() },
          { label: "Due today", value: metrics.dueToday.toLocaleString() },
        ]}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Needs attention</h2>
          <span className="text-xs text-text-muted">Unassigned and not-yet-qualified drill into a filtered Lead list; the rest have no matching list filter yet (disclosed, not built this pass).</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <DrillMetric label="Unassigned leads" value={metrics.unassignedLeads} onPress={() => router.push("/crm/leads?ownerId=unassigned")} />
          <DrillMetric label="Dwell-breached leads" value={metrics.dwellBreachedLeads} />
          <DrillMetric label="Stalled opportunities" value={metrics.stalledOpportunities} />
          <DrillMetric label="Not yet qualified" value={metrics.needsQualificationLeads} onPress={() => router.push("/crm/leads?qualification=not_reviewed")} />
          <DrillMetric label="High-priority leads" value={metrics.highPriorityLeads} />
          <DrillMetric label="Uncovered territories" value={metrics.uncoveredTerritories} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Pipeline by stage</h2>
          {stages.length === 0 ? (
            <p className="text-sm text-text-muted">No open pipeline.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-1.5 font-medium">Stage</th>
                    <th className="py-1.5 font-medium">Opportunities</th>
                    <th className="py-1.5 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((stage) => (
                    <tr key={stage.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 text-text">
                        <button type="button" className="text-left hover:underline" onClick={() => router.push(`/crm/opportunities?stageId=${stage.id}`)}>
                          {stage.name}
                        </button>
                      </td>
                      <td className="py-1.5 tabular-nums text-text-muted">{stage.opportunityCount}</td>
                      <td className="py-1.5 tabular-nums text-text-muted">{money(metrics.currencyCode, stage.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Leads by source</h2>
          {sources.length === 0 ? (
            <p className="text-sm text-text-muted">No leads yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-1.5 font-medium">Source</th>
                    <th className="py-1.5 font-medium">Leads</th>
                    <th className="py-1.5 font-medium">Converted</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.name} className="border-b border-border last:border-0">
                      <td className="py-1.5 text-text">{source.name}</td>
                      <td className="py-1.5 tabular-nums text-text-muted">{source.leadCount}</td>
                      <td className="py-1.5 tabular-nums text-text-muted">{source.convertedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Upcoming activities</h2>
        {activities.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing open right now.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {activities.map((activity) => {
              const href = activityHref(activity);
              return (
                <button
                  key={activity.id}
                  type="button"
                  disabled={!href}
                  onClick={() => href && router.push(href)}
                  className="flex items-center justify-between gap-3 py-2 text-left disabled:cursor-default"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-text">{activity.subject || "(No subject)"}</span>
                    <span className="text-xs text-text-muted">
                      {activity.activityType} · {activity.assignedName || "Unassigned"}
                      {activity.dueAt ? ` · Due ${dateTimeFormatter.format(new Date(activity.dueAt))}` : ""}
                    </span>
                  </div>
                  <StatusBadge tone="neutral">{activity.status}</StatusBadge>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
