"use client";

// CRM Home answers one question: what needs my attention today? It is an
// operational workspace, not a BI dashboard: four numbers, the user's own
// work, the open pipeline by stage, what is slipping, and what just
// happened. Every number opens the list behind it.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@vercentlabs/design-system";

import { CrmCreateMenu } from "@/features/crm/shared/CrmCreateMenu";
import { formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityList, CountList, OverviewCards, OverviewHeader, OverviewPanel, TileGrid } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getCrmHome } from "../api/home-api";

export function CrmHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "home"), queryFn: getCrmHome, refetchOnWindowFocus: true });
  const home = query.data;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <OverviewHeader description="What needs your attention today. Every number opens the records behind it." action={<CrmCreateMenu />} />
      {query.isLoading ? <LoadingState label="Loading your CRM" rows={5} />
        : query.isError || !home ? <ErrorState title="Could not load CRM Home" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <>
            <OverviewCards label="Overview" cards={[
              { label: "Open leads", value: home.totals.openLeads, href: "/crm/leads?status=open" },
              { label: "Open opportunities", value: home.totals.openOpportunities, href: "/crm/opportunities?view=open" },
              { label: "Pipeline value", value: home.totals.pipelineValue === null ? null : formatMoney(home.baseCurrency, home.totals.pipelineValue), href: "/crm/pipeline" },
              { label: "Overdue follow-ups", value: home.totals.overdueFollowUps, href: "/crm/follow-ups?view=overdue" },
            ]} />

            <div className="grid gap-6 lg:grid-cols-2">
              <OverviewPanel title="My work">
                <CountList rows={[
                  { label: "Tasks due today", value: home.myWork.tasksDueToday, href: "/crm/tasks?view=due_today" },
                  { label: "Overdue tasks", value: home.myWork.overdueTasks, href: "/crm/tasks?view=overdue", tone: "danger" },
                  { label: "Follow-ups today", value: home.myWork.followUpsToday, href: "/crm/follow-ups?view=due_today" },
                  { label: "Overdue follow-ups", value: home.myWork.overdueFollowUps, href: "/crm/follow-ups?view=overdue", tone: "danger" },
                ]} />
              </OverviewPanel>

              <OverviewPanel title="Needs attention">
                <CountList rows={[
                  { label: "Unassigned leads", value: home.needsAttention.unassignedLeads, href: "/crm/leads?view=unassigned" },
                  { label: "Leads with no activity", value: home.needsAttention.leadsWithNoActivity, href: "/crm/leads?view=no_activity" },
                  { label: `Stale opportunities (no activity ${home.needsAttention.opportunityStaleDays}+ days)`, value: home.needsAttention.staleOpportunities, href: "/crm/opportunities?view=stale" },
                  { label: `Opportunities closing in ${home.needsAttention.closingSoonDays} days`, value: home.needsAttention.opportunitiesClosingSoon, href: "/crm/opportunities?view=closing_this_month" },
                  { label: "Opportunities past their close date", value: home.needsAttention.overdueOpportunities, href: "/crm/opportunities?view=overdue" },
                ]} />
              </OverviewPanel>
            </div>

            {home.sees.opportunities && (
              <OverviewPanel title="Pipeline">
                {home.pipeline.length === 0 ? <p className="text-sm text-text-muted">No sales stages yet.</p> : (
                  <TileGrid tiles={home.pipeline.map((stage) => ({
                    key: stage.stageId, label: stage.name, value: formatMoney(home.baseCurrency, stage.value),
                    caption: `${stage.total} ${stage.total === 1 ? "opportunity" : "opportunities"}`, href: `/crm/opportunities?view=open&stageId=${stage.stageId}`,
                  }))} />
                )}
                <Link href="/crm/pipeline" className="self-start text-sm font-medium text-brand hover:underline">Open the pipeline board</Link>
              </OverviewPanel>
            )}

            <OverviewPanel title="Recent activity">
              <ActivityList empty="Nothing has happened in the last 30 days." entries={home.recentActivity.map((entry) => ({
                key: entry.id, href: `/crm/${entry.recordType === "lead" ? "leads" : "opportunities"}/${entry.recordId}`, title: entry.recordName, summary: entry.summary,
                meta: [entry.actorName, formatDateTime(entry.at)].filter(Boolean).join(" · "),
              }))} />
            </OverviewPanel>
          </>
        )}
    </div>
  );
}
