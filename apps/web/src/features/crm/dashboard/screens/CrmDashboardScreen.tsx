"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { CrmDashboardApiError, getCrmDashboardData } from "../api/dashboard-api";
import type { CrmDashboardActivity } from "../types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function money(currencyCode: string | null, value: number) {
  return `${currencyCode || ""} ${value.toLocaleString()}`.trim();
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
        <h2 className="text-sm font-semibold text-text">Needs attention</h2>
        <MetricStrip
          metrics={[
            { label: "Unassigned leads", value: metrics.unassignedLeads.toLocaleString() },
            { label: "Dwell-breached leads", value: metrics.dwellBreachedLeads.toLocaleString() },
            { label: "Stalled opportunities", value: metrics.stalledOpportunities.toLocaleString() },
            { label: "Not yet qualified", value: metrics.needsQualificationLeads.toLocaleString() },
            { label: "High-priority leads", value: metrics.highPriorityLeads.toLocaleString() },
            { label: "Uncovered territories", value: metrics.uncoveredTerritories.toLocaleString() },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Pipeline by stage</h2>
          {stages.length === 0 ? (
            <p className="text-sm text-text-muted">No open pipeline.</p>
          ) : (
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
                    <td className="py-1.5 text-text">{stage.name}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{stage.opportunityCount}</td>
                    <td className="py-1.5 tabular-nums text-text-muted">{money(metrics.currencyCode, stage.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Leads by source</h2>
          {sources.length === 0 ? (
            <p className="text-sm text-text-muted">No leads yet.</p>
          ) : (
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
