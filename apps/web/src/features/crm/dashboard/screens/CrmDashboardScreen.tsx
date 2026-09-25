"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { toNumber } from "@/features/crm/shared/format";
import { formatDate, formatMoney } from "@/features/crm/shared/human";
import { ActivityGroups, type ActivityRow } from "@/features/crm/shared/ui/ActivityGroups";
import { BarList } from "@/features/crm/shared/ui/BarList";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { CrmDashboardApiError, getCrmDashboardData } from "../api/dashboard-api";
import type { CrmDashboardActivity, CrmDashboardScope } from "../types";

function activityHref(activity: CrmDashboardActivity): string | null {
  if (activity.entityType === "lead" && activity.entityId) return `/crm/leads/${activity.entityId}`;
  if (activity.entityType === "opportunity" && activity.entityId) return `/crm/opportunities/${activity.entityId}`;
  if (activity.entityType === "party" && activity.entityId) return `/crm/accounts/${activity.entityId}`;
  if (activity.entityType === "contact" && activity.entityId) return `/crm/contacts/${activity.entityId}`;
  return null;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

// Period presets resolve to explicit from/to dates, so a shared link or a
// drill-down always carries the exact range that produced the figure.
function presetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = iso(now);
  if (preset === "this_month") return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
  if (preset === "last_month") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (preset === "this_quarter") return { from: iso(new Date(Date.UTC(y, m - (m % 3), 1))), to: today };
  if (preset === "last_90_days") return { from: iso(new Date(now.getTime() - 89 * 86400000)), to: today };
  if (preset === "year_to_date") return { from: iso(new Date(Date.UTC(y, 0, 1))), to: today };
  return null;
}

const PERIOD_OPTIONS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "year_to_date", label: "Year to date" },
  { value: "custom", label: "Custom range" },
];

const SCOPE_OPTIONS: Array<{ id: CrmDashboardScope; label: string }> = [
  { id: "mine", label: "Mine" },
  { id: "team", label: "My team" },
  { id: "all", label: "All I can see" },
];

function change(current: number, previous: number, label: string, higherIsGood = true) {
  if (previous === 0 && current === 0) return undefined;
  const direction: "up" | "down" | "flat" = current > previous ? "up" : current < previous ? "down" : "flat";
  return { direction, label: `${label} (previous period)`, isPositive: direction === "flat" ? true : (direction === "up") === higherIsGood };
}

type Kpi = { id: string; label: string; value: string; href?: string; change?: ReturnType<typeof change> };

function KpiTile({ kpi, onOpen }: { kpi: Kpi; onOpen: (href: string) => void }) {
  const ChangeIcon = kpi.change?.direction === "up" ? ArrowUp : kpi.change?.direction === "down" ? ArrowDown : null;
  const body = (
    <>
      <span className="text-xs font-medium text-text-muted">{kpi.label}</span>
      <span className="text-2xl font-semibold tabular-nums text-text">{kpi.value}</span>
      {kpi.change && (
        <span className={`flex items-center gap-1 text-xs font-medium ${kpi.change.isPositive ? "text-success" : "text-danger"}`}>
          {ChangeIcon && <ChangeIcon className="size-3" aria-hidden="true" />}
          {kpi.change.label}
        </span>
      )}
    </>
  );
  const className = "flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left";
  if (!kpi.href) return <div className={className}>{body}</div>;
  return (
    <button type="button" onClick={() => onOpen(kpi.href!)} className={`${className} hover:border-brand hover:bg-surface-muted`} aria-label={`${kpi.label}: ${kpi.value}. Open the records behind this figure`}>
      {body}
    </button>
  );
}

// F024 — every figure is a permission-safe server aggregate for the chosen
// scope and period, and every figure drills into a list filtered by the same
// scope and date predicates, so the list's count reconciles to the number.
// Scope and period live in the URL, so a view can be shared or bookmarked.
export function CrmDashboardScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspace = useWorkspaceContext();

  const scope = (["mine", "team", "all"].includes(searchParams.get("scope") ?? "") ? searchParams.get("scope") : "all") as CrmDashboardScope;
  const preset = searchParams.get("period") ?? "this_month";
  const range = presetRange(preset) ?? { from: searchParams.get("from") ?? presetRange("this_month")!.from, to: searchParams.get("to") ?? presetRange("this_month")!.to };
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "dashboard", scope, range.from, range.to),
    queryFn: () => getCrmDashboardData({ scope, from: range.from, to: range.to }),
    placeholderData: (previous) => previous,
  });

  const dashboard = query.data?.dashboard;

  const view = useMemo(() => {
    if (!dashboard) return null;
    const { metrics, period } = dashboard;
    const cur = metrics.currencyCode;
    const owner = dashboard.scope === "mine" ? "me" : dashboard.scope === "team" ? "team" : null;
    const withOwner = (base: string) => (owner ? `${base}${base.includes("?") ? "&" : "?"}ownerId=${owner}` : base);
    const taskScope = dashboard.scope === "mine" ? "&mine=true" : dashboard.scope === "team" ? "&myTeam=true" : "&mine=false";
    const closed = metrics.wonInPeriod + metrics.lostInPeriod;
    const winRate = closed > 0 ? Math.round((metrics.wonInPeriod / closed) * 100) : null;
    const previousClosed = metrics.wonPreviousPeriod + metrics.lostPreviousPeriod;
    const previousWinRate = previousClosed > 0 ? Math.round((metrics.wonPreviousPeriod / previousClosed) * 100) : null;
    const periodQuery = (fromKey: string, toKey: string) => `${fromKey}=${period.from}&${toKey}=${period.to}`;

    const kpis: Kpi[] = [
      { id: "pipeline", label: "Open pipeline", value: formatMoney(cur, metrics.pipelineValue, { compact: true }), href: withOwner("/crm/opportunities?status=open"), change: { direction: "flat", label: `${formatMoney(cur, metrics.weightedPipeline, { compact: true })} weighted · ${metrics.openOpportunities} open deals`, isPositive: true } },
      { id: "won", label: "Won in period", value: formatMoney(cur, metrics.wonAmountInPeriod, { compact: true }), href: withOwner(`/crm/opportunities?status=won&${periodQuery("closedFrom", "closedTo")}`), change: change(toNumber(metrics.wonAmountInPeriod), toNumber(metrics.wonAmountPreviousPeriod), `${metrics.wonInPeriod} deal${metrics.wonInPeriod === 1 ? "" : "s"} · was ${formatMoney(cur, metrics.wonAmountPreviousPeriod, { compact: true })}`) },
      { id: "win-rate", label: "Win rate", value: winRate === null ? "No closed deals" : `${winRate}%`, href: withOwner(`/crm/opportunities?status=closed&${periodQuery("closedFrom", "closedTo")}`), change: winRate === null ? undefined : { direction: previousWinRate === null || winRate === previousWinRate ? "flat" : winRate > previousWinRate ? "up" : "down", label: `${metrics.wonInPeriod} won · ${metrics.lostInPeriod} lost${previousWinRate === null ? "" : ` · was ${previousWinRate}%`}`, isPositive: previousWinRate === null || winRate >= previousWinRate } },
      { id: "new-leads", label: "New leads", value: metrics.leadsInPeriod.toLocaleString("en-IN"), href: withOwner(`/crm/leads?includeConverted=true&${periodQuery("createdFrom", "createdTo")}`), change: change(metrics.leadsInPeriod, metrics.leadsPreviousPeriod, `was ${metrics.leadsPreviousPeriod.toLocaleString("en-IN")}`) },
      { id: "converted", label: "Leads converted", value: metrics.conversionsInPeriod.toLocaleString("en-IN"), href: withOwner(`/crm/leads?status=converted&${periodQuery("convertedFrom", "convertedTo")}`), change: change(metrics.conversionsInPeriod, metrics.conversionsPreviousPeriod, `was ${metrics.conversionsPreviousPeriod.toLocaleString("en-IN")}`) },
      { id: "open-leads", label: "Open leads", value: metrics.openLeads.toLocaleString("en-IN"), href: withOwner("/crm/leads"), change: { direction: "flat", label: `${metrics.qualifiedLeads.toLocaleString("en-IN")} qualified`, isPositive: true } },
    ];

    const attention = [
      { id: "overdue", label: "Overdue tasks", count: metrics.overdueTasks, href: `/crm/tasks?due=overdue${taskScope}`, hint: "Tasks past their due time", urgent: true },
      { id: "stalled", label: "Stalled opportunities", count: metrics.stalledOpportunities, href: withOwner("/crm/opportunities?stalled=true"), hint: "Open deals past their stage's time limit" },
      { id: "dwell", label: "Leads stuck in a stage", count: metrics.dwellBreachedLeads, href: withOwner("/crm/leads?dwellBreached=true"), hint: "Leads that stayed longer than the stage allows" },
      { id: "unassigned", label: "Unassigned leads", count: metrics.unassignedLeads, href: "/crm/leads?ownerId=unassigned", hint: "Nobody owns these yet" },
      { id: "unqualified", label: "Leads not yet qualified", count: metrics.needsQualificationLeads, href: withOwner("/crm/leads?qualification=not_reviewed"), hint: "Waiting for a qualification decision" },
      { id: "priority", label: "Hot and qualified-grade leads", count: metrics.highPriorityLeads, href: withOwner("/crm/leads?highPriority=true"), hint: "Graded hot or qualified by lead scoring" },
      { id: "territories", label: "Territories without coverage", count: metrics.uncoveredTerritories, href: "/crm/settings/territories", hint: "No primary owner assigned" },
    ].filter((item) => item.count > 0);

    return { cur, kpis, attention, withOwner };
  }, [dashboard]);

  if (query.isLoading && !dashboard) return <LoadingState label="Loading dashboard" rows={4} onRetry={() => query.refetch()} />;
  if (query.isError && !dashboard) {
    if (query.error instanceof CrmDashboardApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to the CRM dashboard" />;
    }
    return <ErrorState title="Could not load the dashboard" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (!dashboard || !view) return null;
  const { stages, sources, activities } = dashboard;
  const activityRows: ActivityRow[] = activities.map((a) => ({ id: a.id, activityType: a.activityType, subject: a.subject, status: a.status, dueAt: a.dueAt, assignedName: a.assignedName, href: activityHref(a) }));
  const scopeDescription =
    dashboard.scope === "mine"
      ? "Records you own."
      : dashboard.scope === "team"
        ? "Records owned by you and the members of sales teams you manage."
        : dashboard.canViewAll
          ? "Every record in the selected company."
          : "Records you own plus unassigned ones — everything you are allowed to see.";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Dashboard" description="What changed, what needs attention, and what to do next. Every number opens the records behind it." />

      <section aria-label="Dashboard scope and period" className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Showing</span>
          <ViewToggle label="Scope" options={SCOPE_OPTIONS} value={dashboard.scope} onChange={(id) => setParams({ scope: id })} />
        </div>
        <div className="w-48">
          <Select
            label="Period"
            options={PERIOD_OPTIONS}
            selectedKey={presetRange(preset) ? preset : "custom"}
            onSelectionChange={(key) => {
              const value = String(key ?? "this_month");
              if (value === "custom") setParams({ period: "custom", from: customFrom, to: customTo });
              else setParams({ period: value, from: null, to: null });
            }}
          />
        </div>
        {!presetRange(preset) && (
          <>
            <TextField label="From" type="date" value={customFrom} onChange={setCustomFrom} className="w-40" />
            <TextField label="To" type="date" value={customTo} onChange={setCustomTo} className="w-40" />
            <button type="button" onClick={() => setParams({ period: "custom", from: customFrom, to: customTo })} className="h-10 rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted">
              Apply
            </button>
          </>
        )}
        <p className="ml-auto max-w-sm text-xs text-text-muted" role="status">
          {`${scopeDescription} Period ${formatDate(dashboard.period.from)} – ${formatDate(dashboard.period.to)}, compared with ${formatDate(dashboard.period.previousFrom)} – ${formatDate(dashboard.period.previousTo)}.`}
          {query.isFetching ? " Updating…" : ""}
        </p>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(165px,1fr))] gap-3">
        {view.kpis.map((kpi) => (
          <KpiTile key={kpi.id} kpi={kpi} onOpen={(href) => router.push(href)} />
        ))}
      </div>

      <section aria-label="Attention required" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">Attention required</h2>
          <span className="text-xs text-text-muted">Each item opens the exact list behind its number.</span>
        </div>
        {view.attention.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing needs attention right now.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {view.attention.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left hover:bg-surface-muted ${item.urgent ? "border-danger-emphasis/40 bg-danger-soft" : "border-border"}`}
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
          description={`Open deals, by value (${view.cur ?? "your currency"})`}
          emptyText="No open pipeline in this scope. Create an opportunity to see it here."
          items={stages.map((stage) => ({ id: stage.id, label: stage.name, value: toNumber(stage.amount), display: formatMoney(view.cur, stage.amount, { compact: true }), secondary: `${stage.opportunityCount} deal${stage.opportunityCount === 1 ? "" : "s"}`, href: view.withOwner(`/crm/opportunities?stageId=${stage.id}`) }))}
        />
        <BarList
          title="Lead sources"
          description="All leads in this scope, with how many became customers"
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
