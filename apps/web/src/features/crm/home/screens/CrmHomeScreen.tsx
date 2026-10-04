"use client";

// CRM Home answers one question: what needs my attention today? It is an
// operational workspace, not a BI dashboard: four numbers, the user's own
// work, the open pipeline by stage, what is slipping, and what just
// happened. Every number opens the list behind it.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, MetricCard, PageHeader } from "@vercentlabs/design-system";

import { CrmCreateMenu } from "@/features/crm/shared/CrmCreateMenu";
import { formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getCrmHome } from "../api/home-api";

type Card = { label: string; value: number | string | null; href: string };

function Cards({ label, cards }: { label: string; cards: Card[] }) {
  const shown = cards.filter((card) => card.value !== null);
  if (shown.length === 0) return null;
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {shown.map((card) => (
        <Link key={card.label} href={card.href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
          <MetricCard label={card.label} value={card.value ?? 0} />
        </Link>
      ))}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function CrmHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "home"), queryFn: getCrmHome, refetchOnWindowFocus: true });
  const home = query.data;
  const firstName = workspace.fullName.split(" ")[0] || workspace.fullName;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title={`Welcome back, ${firstName}`} description="What needs your attention today. Every number opens the records behind it." primaryAction={<CrmCreateMenu />} />
      {query.isLoading ? <LoadingState label="Loading your CRM" rows={5} />
        : query.isError || !home ? <ErrorState title="Could not load CRM Home" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <>
            <Cards label="Overview" cards={[
              { label: "Open leads", value: home.totals.openLeads, href: "/crm/leads?status=open" },
              { label: "Open opportunities", value: home.totals.openOpportunities, href: "/crm/opportunities?view=open" },
              { label: "Pipeline value", value: home.totals.pipelineValue === null ? null : formatMoney(home.baseCurrency, home.totals.pipelineValue), href: "/crm/pipeline" },
              { label: "Overdue follow-ups", value: home.totals.overdueFollowUps, href: "/crm/follow-ups?view=overdue" },
            ]} />

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="My work">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {[
                    { label: "Tasks due today", value: home.myWork.tasksDueToday, href: "/crm/tasks?view=due_today" },
                    { label: "Overdue tasks", value: home.myWork.overdueTasks, href: "/crm/tasks?view=overdue" },
                    { label: "Follow-ups today", value: home.myWork.followUpsToday, href: "/crm/follow-ups?view=due_today" },
                    { label: "Overdue follow-ups", value: home.myWork.overdueFollowUps, href: "/crm/follow-ups?view=overdue" },
                  ].filter((row) => row.value !== null).map((row) => (
                    <li key={row.label}>
                      <Link href={row.href} className="flex items-center justify-between gap-3 py-2 hover:text-brand">
                        <span>{row.label}</span>
                        <span className={`font-semibold tabular-nums ${row.label.startsWith("Overdue") && row.value ? "text-danger" : ""}`}>{row.value}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel title="Needs attention">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {[
                    { label: "Unassigned leads", value: home.needsAttention.unassignedLeads, href: "/crm/leads?view=unassigned" },
                    { label: "Leads with no activity", value: home.needsAttention.leadsWithNoActivity, href: "/crm/leads?view=no_activity" },
                    { label: `Stale opportunities (no activity ${home.needsAttention.opportunityStaleDays}+ days)`, value: home.needsAttention.staleOpportunities, href: "/crm/opportunities?view=stale" },
                    { label: `Opportunities closing in ${home.needsAttention.closingSoonDays} days`, value: home.needsAttention.opportunitiesClosingSoon, href: "/crm/opportunities?view=closing_this_month" },
                    { label: "Opportunities past their close date", value: home.needsAttention.overdueOpportunities, href: "/crm/opportunities?view=overdue" },
                  ].filter((row) => row.value !== null).map((row) => (
                    <li key={row.label}>
                      <Link href={row.href} className="flex items-center justify-between gap-3 py-2 hover:text-brand">
                        <span>{row.label}</span>
                        <span className="font-semibold tabular-nums">{row.value}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            {home.sees.opportunities && (
              <Panel title="Pipeline">
                {home.pipeline.length === 0 ? <p className="text-sm text-text-muted">No sales stages yet.</p> : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {home.pipeline.map((stage) => (
                      <li key={stage.stageId}>
                        <Link href={`/crm/opportunities?view=open&stageId=${stage.stageId}`} className="flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border p-3 hover:border-border-strong hover:bg-surface-muted">
                          <span className="text-sm text-text-secondary">{stage.name}</span>
                          <span className="text-base font-semibold tabular-nums">{formatMoney(home.baseCurrency, stage.value)}</span>
                          <span className="text-xs text-text-muted">{stage.total} {stage.total === 1 ? "opportunity" : "opportunities"}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/crm/pipeline" className="self-start text-sm font-medium text-brand hover:underline">Open the pipeline board</Link>
              </Panel>
            )}

            <Panel title="Recent activity">
              {home.recentActivity.length === 0 ? <p className="text-sm text-text-muted">Nothing has happened in the last 30 days.</p> : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {home.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-2">
                      <span>
                        <Link href={`/crm/${entry.recordType === "lead" ? "leads" : "opportunities"}/${entry.recordId}`} className="font-medium hover:underline">{entry.recordName}</Link>
                        <span className="text-text-secondary"> · {entry.summary}</span>
                      </span>
                      <span className="text-xs text-text-muted">{[entry.actorName, formatDateTime(entry.at)].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
    </div>
  );
}
