"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, MetricStrip, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { toNumber } from "@/features/crm/shared/format";
import { formatMoney } from "@/features/crm/shared/human";
import { ActivityGroups, type ActivityRow } from "@/features/crm/shared/ui/ActivityGroups";
import { BarList } from "@/features/crm/shared/ui/BarList";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { CrmDashboardApiError, getCrmDashboardData } from "../api/dashboard-api";
import type { CrmDashboardActivity } from "../types";

function activityHref(activity: CrmDashboardActivity): string | null {
  if (activity.entityType === "lead" && activity.entityId) return `/crm/leads/${activity.entityId}`;
  if (activity.entityType === "opportunity" && activity.entityId) return `/crm/opportunities/${activity.entityId}`;
  if (activity.entityType === "party" && activity.entityId) return `/crm/accounts/${activity.entityId}`;
  if (activity.entityType === "contact" && activity.entityId) return `/crm/contacts/${activity.entityId}`;
  return null;
}

// Every attention item drills into a list whose count reconciles to the same predicate the dashboard used.
export function CrmDashboardScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "dashboard"),
    queryFn: getCrmDashboardData,
  });

  if (query.isLoading) return <LoadingState label="Loading dashboard" rows={4} onRetry={() => query.refetch()} />;
  if (query.isError) {
    if (query.error instanceof CrmDashboardApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to the CRM dashboard" />;
    }
    return <ErrorState title="Could not load the dashboard" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const dashboard = query.data?.dashboard;
  if (!dashboard) return null;
  const { metrics, stages, sources, activities } = dashboard;
  const cur = metrics.currencyCode;

  const conversionRate = metrics.leadsThisMonth > 0 ? Math.round((metrics.conversionsThisMonth / metrics.leadsThisMonth) * 100) : null;

  const attention: Array<{ id: string; label: string; count: number; href: string; hint: string }> = [
    { id: "overdue", label: "Overdue activities", count: metrics.overdueActivities, href: "/crm/tasks?overdue=true", hint: "Calls, meetings, tasks and follow-ups past their due time" },
    { id: "stalled", label: "Stalled opportunities", count: metrics.stalledOpportunities, href: "/crm/opportunities?stalled=true", hint: "Open deals with no recent movement" },
    { id: "dwell", label: "Leads stuck in a stage", count: metrics.dwellBreachedLeads, href: "/crm/leads?dwellBreached=true", hint: "Leads that stayed longer than the stage allows" },
    { id: "unassigned", label: "Unassigned leads", count: metrics.unassignedLeads, href: "/crm/leads?ownerId=unassigned", hint: "Nobody owns these yet" },
    { id: "unqualified", label: "Leads not yet qualified", count: metrics.needsQualificationLeads, href: "/crm/leads?qualification=not_reviewed", hint: "Waiting for a qualification decision" },
    { id: "priority", label: "High-priority leads", count: metrics.highPriorityLeads, href: "/crm/leads?highPriority=true", hint: "Marked high or urgent" },
    { id: "territories", label: "Territories without coverage", count: metrics.uncoveredTerritories, href: "/crm/settings/territories", hint: "No primary owner assigned" },
  ].filter((item) => item.count > 0);

  const activityRows: ActivityRow[] = activities.map((a) => ({ id: a.id, activityType: a.activityType, subject: a.subject, status: a.status, dueAt: a.dueAt, assignedName: a.assignedName, href: activityHref(a) }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Dashboard" description="What changed, what needs attention, and what to do next, for everything you can see." />

      <MetricStrip
        metrics={[
          { label: "Open leads", value: metrics.openLeads.toLocaleString("en-IN"), change: metrics.leadsThisMonth > 0 ? { direction: "up", label: `${metrics.leadsThisMonth.toLocaleString("en-IN")} new this month` } : undefined },
          { label: "Open opportunities", value: metrics.openOpportunities.toLocaleString("en-IN") },
          { label: "Open pipeline", value: formatMoney(cur, metrics.pipelineValue, { compact: true }), change: { direction: "flat", label: `${formatMoney(cur, metrics.weightedPipeline, { compact: true })} weighted by probability`, isPositive: true } },
          { label: "Converted this month", value: metrics.conversionsThisMonth.toLocaleString("en-IN"), change: conversionRate !== null ? { direction: conversionRate >= 20 ? "up" : "flat", label: `${conversionRate}% of this month's new leads`, isPositive: true } : undefined },
          { label: "Qualified leads", value: metrics.qualifiedLeads.toLocaleString("en-IN") },
        ]}
      />

      <section aria-label="Attention required" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Attention required</h2>
          <span className="text-xs text-text-muted">Each item opens the exact list behind its number.</span>
        </div>
        {attention.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing needs attention right now.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {attention.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left hover:bg-surface-muted ${item.id === "overdue" ? "border-danger-emphasis/40 bg-danger-soft" : "border-border"}`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-text">{item.label}</span>
                    <span className="text-xs text-text-muted">{item.hint}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-text">{item.count.toLocaleString("en-IN")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="Pipeline by stage"
          description={`Open deals, by value (${cur ?? "your currency"})`}
          emptyText="No open pipeline yet. Create an opportunity to see it here."
          items={stages.map((stage) => ({ id: stage.id, label: stage.name, value: toNumber(stage.amount), display: formatMoney(cur, stage.amount, { compact: true }), secondary: `${stage.opportunityCount} deal${stage.opportunityCount === 1 ? "" : "s"}`, href: `/crm/opportunities?stageId=${stage.id}` }))}
        />
        <BarList
          title="Lead sources"
          description="Leads created, with how many became customers"
          emptyText="No leads yet. Add a lead to see where they come from."
          items={sources.map((source) => ({ id: source.name, label: source.name, value: source.leadCount, display: `${source.leadCount} lead${source.leadCount === 1 ? "" : "s"}`, secondary: `${source.convertedCount} converted` }))}
        />
      </div>

      <section aria-label="Upcoming activities" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Work in progress</h2>
        <ActivityGroups activities={activityRows} onOpen={(href) => router.push(href)} showAssignee emptyText="Nothing open right now." />
      </section>
    </div>
  );
}
