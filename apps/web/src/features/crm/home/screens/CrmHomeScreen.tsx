"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import { money } from "@/features/crm/shared/format";
import { CrmDashboardApiError, getCrmDashboardData } from "@/features/crm/dashboard/api/dashboard-api";
import type { CrmDashboardActivity } from "@/features/crm/dashboard/types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

const QUICK_CREATE_LINKS = [
  { label: "New Lead", href: "/crm/leads/new" },
  { label: "New Account", href: "/crm/accounts/new" },
  { label: "New Contact", href: "/crm/contacts/new" },
  { label: "New Opportunity", href: "/crm/opportunities/new" },
  { label: "New Call", href: "/crm/calls/new" },
  { label: "New Meeting", href: "/crm/meetings/new" },
  { label: "New Follow-up", href: "/crm/follow-ups/new" },
  { label: "New Task", href: "/crm/tasks/new" },
];

function activityHref(activity: CrmDashboardActivity): string | null {
  if (activity.entityType === "lead" && activity.entityId) return `/crm/leads/${activity.entityId}`;
  if (activity.entityType === "opportunity" && activity.entityId) return `/crm/opportunities/${activity.entityId}`;
  if (activity.entityType === "party" && activity.entityId) return `/crm/accounts/${activity.entityId}`;
  if (activity.entityType === "contact" && activity.entityId) return `/crm/contacts/${activity.entityId}`;
  return null;
}

export function CrmHomeScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "dashboard"),
    queryFn: getCrmDashboardData,
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading CRM…</p>;
  if (query.isError) {
    if (query.error instanceof CrmDashboardApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to CRM" />;
    }
    return <ErrorState title="Could not load CRM" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const dashboard = query.data?.dashboard;
  if (!dashboard) return null;
  const { metrics, activities } = dashboard;
  const myActivities = activities.filter((activity) => activity.assignedTo === workspace.userId);

  const sections = (getModuleNavigation("crm")?.sections ?? [])
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.status === "AVAILABLE" && item.route !== "/crm"),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${workspace.fullName.split(" ")[0] || workspace.fullName}`}
        description="Your CRM command center — quick access to every workspace, today's work, and where the business stands."
      />

      <div className="flex flex-wrap gap-2">
        {QUICK_CREATE_LINKS.map((link) => (
          <Button key={link.href} variant="secondary" size="compact" onPress={() => router.push(link.href)}>
            {link.label}
          </Button>
        ))}
      </div>

      <MetricStrip
        metrics={[
          { label: "Open leads", value: metrics.openLeads.toLocaleString() },
          { label: "Open opportunities", value: metrics.openOpportunities.toLocaleString() },
          { label: "Pipeline value", value: money(metrics.currencyCode, metrics.pipelineValue) },
          { label: "Overdue activities", value: metrics.overdueActivities.toLocaleString() },
          { label: "Due today", value: metrics.dueToday.toLocaleString() },
        ]}
      />

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">My work today</h2>
        {myActivities.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing open is assigned to you right now.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {myActivities.map((activity) => {
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
                      {activity.activityType}
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

      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">{section.label}</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,280px))] gap-2">
              {section.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.route}
                  className="rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm font-medium text-text transition-colors hover:bg-surface-muted"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
