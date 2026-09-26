"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, ErrorState, Menu, MenuItem, MenuTrigger, MetricStrip, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import { formatMoney } from "@/shared/format/human";
import { ActivityGroups, type ActivityRow } from "@/features/crm/shared/ui/ActivityGroups";
import { LoadingState } from "@/shared/ui/LoadingState";
import { CrmDashboardApiError, getCrmDashboardData } from "@/features/crm/dashboard/api/dashboard-api";
import type { CrmDashboardActivity } from "@/features/crm/dashboard/types";

const CREATE_LINKS = [
  { label: "Lead", href: "/crm/leads/new" },
  { label: "Account", href: "/crm/accounts/new" },
  { label: "Contact", href: "/crm/contacts/new" },
  { label: "Opportunity", href: "/crm/opportunities/new" },
  { label: "Call", href: "/crm/calls/new" },
  { label: "Meeting", href: "/crm/meetings/new" },
  { label: "Follow-up", href: "/crm/follow-ups/new" },
  { label: "Task", href: "/crm/tasks/new" },
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
    queryFn: () => getCrmDashboardData(),
  });

  if (query.isLoading) return <LoadingState label="Loading CRM" rows={4} onRetry={() => query.refetch()} />;
  if (query.isError) {
    if (query.error instanceof CrmDashboardApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to CRM" />;
    }
    return <ErrorState title="Could not load CRM" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const dashboard = query.data?.dashboard;
  if (!dashboard) return null;
  const { metrics, activities } = dashboard;
  const myActivityRows: ActivityRow[] = activities
    .filter((activity) => activity.assignedTo === workspace.userId)
    .map((a) => ({ id: a.id, activityType: a.activityType, subject: a.subject, status: a.status, dueAt: a.dueAt, href: activityHref(a) }));

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
        description="Your work today, and where the business stands."
        primaryAction={
          <MenuTrigger>
            <Button variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              Create
            </Button>
            <Menu onAction={(key) => router.push(String(key))}>
              {CREATE_LINKS.map((link) => (
                <MenuItem key={link.href} id={link.href}>{link.label}</MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        }
      />

      <MetricStrip
        metrics={[
          { label: "Open leads", value: metrics.openLeads.toLocaleString("en-IN") },
          { label: "Open opportunities", value: metrics.openOpportunities.toLocaleString("en-IN") },
          { label: "Open pipeline", value: formatMoney(metrics.currencyCode, metrics.pipelineValue, { compact: true }) },
          { label: "Overdue activities", value: metrics.overdueActivities.toLocaleString("en-IN"), change: metrics.overdueActivities > 0 ? { direction: "up", label: "Needs action", isPositive: false } : undefined },
          { label: "Due today", value: metrics.dueToday.toLocaleString("en-IN") },
        ]}
      />

      <section aria-label="My work today" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">My work</h2>
        <ActivityGroups activities={myActivityRows} onOpen={(href) => router.push(href)} emptyText="Nothing open is assigned to you right now." />
      </section>

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
