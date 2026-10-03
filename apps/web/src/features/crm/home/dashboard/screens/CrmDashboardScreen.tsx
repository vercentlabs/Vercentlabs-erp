"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  ErrorState,
  PageHeader,
  PermissionState,
  Select,
  TextField,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney } from "@/shared/format/human";
import {
  ActivityGroups,
  type ActivityRow,
} from "@/features/crm/shared/ui/ActivityGroups";
import { BarList } from "@/features/crm/shared/ui/BarList";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  CrmDashboardApiError,
  getCrmDashboardData,
} from "../api/dashboard-api";
import {
  getPipelineDashboard,
  type PipelineFilters,
} from "../api/analytics-api";
import { MetricDrilldownDialog } from "../components/MetricDrilldownDialog";
import type { CrmDashboardActivity, CrmDashboardScope } from "../types";

function activityHref(activity: CrmDashboardActivity): string | null {
  if (activity.entityType === "lead" && activity.entityId)
    return `/crm/leads/${activity.entityId}`;
  if (activity.entityType === "opportunity" && activity.entityId)
    return `/crm/opportunities/${activity.entityId}`;
  if (activity.entityType === "party" && activity.entityId)
    return `/crm/accounts/${activity.entityId}`;
  if (activity.entityType === "contact" && activity.entityId)
    return `/crm/contacts/${activity.entityId}`;
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
  if (preset === "this_month")
    return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
  if (preset === "last_month")
    return {
      from: iso(new Date(Date.UTC(y, m - 1, 1))),
      to: iso(new Date(Date.UTC(y, m, 0))),
    };
  if (preset === "this_quarter")
    return { from: iso(new Date(Date.UTC(y, m - (m % 3), 1))), to: today };
  if (preset === "last_90_days")
    return { from: iso(new Date(now.getTime() - 89 * 86400000)), to: today };
  if (preset === "year_to_date")
    return { from: iso(new Date(Date.UTC(y, 0, 1))), to: today };
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

function change(
  current: number,
  previous: number,
  label: string,
  higherIsGood = true,
) {
  if (previous === 0 && current === 0) return undefined;
  const direction: "up" | "down" | "flat" =
    current > previous ? "up" : current < previous ? "down" : "flat";
  return {
    direction,
    label: `${label} (previous period)`,
    isPositive:
      direction === "flat" ? true : (direction === "up") === higherIsGood,
  };
}

type Kpi = {
  id: string;
  label: string;
  value: string;
  href?: string;
  onSelect?: () => void;
  change?: ReturnType<typeof change>;
};

function KpiTile({
  kpi,
  onOpen,
}: {
  kpi: Kpi;
  onOpen: (href: string) => void;
}) {
  const ChangeIcon =
    kpi.change?.direction === "up"
      ? ArrowUp
      : kpi.change?.direction === "down"
        ? ArrowDown
        : null;
  const body = (
    <>
      <span className="text-xs font-medium text-text-muted">{kpi.label}</span>
      <span className="text-2xl font-semibold tabular-nums text-text">
        {kpi.value}
      </span>
      {kpi.change && (
        <span
          className={`flex items-center gap-1 text-xs font-medium ${kpi.change.isPositive ? "text-success" : "text-danger"}`}
        >
          {ChangeIcon && <ChangeIcon className="size-3" aria-hidden="true" />}
          {kpi.change.label}
        </span>
      )}
    </>
  );
  const className =
    "flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left";
  if (!kpi.href && !kpi.onSelect)
    return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => (kpi.onSelect ? kpi.onSelect() : onOpen(kpi.href!))}
      className={`${className} hover:border-brand hover:bg-surface-muted`}
      aria-label={`${kpi.label}: ${kpi.value}. Open the records behind this figure`}
    >
      {body}
    </button>
  );
}

// F024 — every figure is a permission-safe server aggregate for the chosen
// scope and period, and every figure drills into a list filtered by the same
// scope and date predicates, so the list's count reconciles to the number.
// Scope and period live in the URL, so a view can be shared or bookmarked.
// `embedded`: rendered inside CRM Home (the page supplies the h1), so the
// dashboard's own header becomes a section heading.
export function CrmDashboardScreen({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspace = useWorkspaceContext();

  const scope = (
    ["mine", "team", "all"].includes(searchParams.get("scope") ?? "")
      ? searchParams.get("scope")
      : "all"
  ) as CrmDashboardScope;
  const preset = searchParams.get("period") ?? "this_month";
  const range = presetRange(preset) ?? {
    from: searchParams.get("from") ?? presetRange("this_month")!.from,
    to: searchParams.get("to") ?? presetRange("this_month")!.to,
  };
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
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "dashboard",
      scope,
      range.from,
      range.to,
    ),
    queryFn: () =>
      getCrmDashboardData({ scope, from: range.from, to: range.to }),
    placeholderData: (previous) => previous,
  });

  const dashboard = query.data?.dashboard;

  // F024 pipeline filters (URL state). Opportunity figures, their breakdown
  // and drill-downs come from the canonical analytics endpoint.
  const filterKeys = [
    "pipelineId",
    "stageId",
    "teamId",
    "territoryId",
    "ownerId",
    "sourceId",
  ] as const;
  const pipelineFilters: PipelineFilters = {
    from: range.from,
    to: range.to,
    scope,
    ...Object.fromEntries(
      filterKeys
        .map((key) => [key, searchParams.get(key) ?? ""])
        .filter(([, value]) => value),
    ),
  };
  const analytics = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "analytics",
      "pipeline",
      JSON.stringify(pipelineFilters),
    ),
    queryFn: () => getPipelineDashboard(pipelineFilters),
    placeholderData: (previous) => previous,
  });
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: () => getCrmOptions(),
  });
  const optionList = (key: string, empty: string) => [
    { value: "", label: empty },
    ...(options.data?.options[key] ?? []).map((row) => ({
      value: String(row.id),
      label: String(row.name ?? row.fullName ?? row.label ?? row.id),
    })),
  ];
  const [drill, setDrill] = useState<{
    metric: string;
    title: string;
    filters: PipelineFilters;
  } | null>(null);
  const openDrill = (
    metric: string,
    title: string,
    extra: Partial<PipelineFilters> = {},
  ) => setDrill({ metric, title, filters: { ...pipelineFilters, ...extra } });
  const pipeline = analytics.data;
  const reportingCurrency = pipeline?.currency.reportingCurrency ?? null;

  const view = useMemo(() => {
    if (!dashboard) return null;
    const { metrics, period } = dashboard;
    const cur = metrics.currencyCode;
    const owner =
      dashboard.scope === "mine"
        ? "me"
        : dashboard.scope === "team"
          ? "team"
          : null;
    const withOwner = (base: string) =>
      owner ? `${base}${base.includes("?") ? "&" : "?"}ownerId=${owner}` : base;
    const taskScope =
      dashboard.scope === "mine"
        ? "&mine=true"
        : dashboard.scope === "team"
          ? "&myTeam=true"
          : "&mine=false";
    const periodQuery = (fromKey: string, toKey: string) =>
      `${fromKey}=${period.from}&${toKey}=${period.to}`;

    const kpis: Kpi[] = [
      {
        id: "new-leads",
        label: "New leads",
        value: metrics.leadsInPeriod.toLocaleString("en-IN"),
        href: withOwner(
          `/crm/leads?${periodQuery("createdFrom", "createdTo")}`,
        ),
        change: change(
          metrics.leadsInPeriod,
          metrics.leadsPreviousPeriod,
          `was ${metrics.leadsPreviousPeriod.toLocaleString("en-IN")}`,
        ),
      },
      {
        id: "converted",
        label: "Leads converted",
        value: metrics.conversionsInPeriod.toLocaleString("en-IN"),
        href: withOwner(
          "/crm/leads?view=converted",
        ),
        change: change(
          metrics.conversionsInPeriod,
          metrics.conversionsPreviousPeriod,
          `was ${metrics.conversionsPreviousPeriod.toLocaleString("en-IN")}`,
        ),
      },
      {
        id: "open-leads",
        label: "Open leads",
        value: metrics.openLeads.toLocaleString("en-IN"),
        href: withOwner("/crm/leads"),
        change: {
          direction: "flat",
          label: `${metrics.qualifiedLeads.toLocaleString("en-IN")} qualified`,
          isPositive: true,
        },
      },
    ];

    const attention = [
      {
        id: "overdue",
        label: "Overdue tasks",
        count: metrics.overdueTasks,
        href: `/crm/tasks?due=overdue${taskScope}`,
        hint: "Tasks past their due time",
        urgent: true,
      },
      {
        id: "unassigned",
        label: "Unassigned leads",
        count: metrics.unassignedLeads,
        href: "/crm/leads?view=unassigned",
        hint: "Nobody owns these yet",
      },
      {
        id: "unqualified",
        label: "Leads ready to qualify",
        count: metrics.needsQualificationLeads,
        href: withOwner("/crm/leads?stage=ready_to_qualify"),
        hint: "Open leads waiting for a qualification decision",
      },
      {
        id: "priority",
        label: "Hot leads",
        count: metrics.highPriorityLeads,
        href: withOwner("/crm/leads?rating=hot"),
        hint: "Open leads rated hot",
      },
      {
        id: "territories",
        label: "Territories without coverage",
        count: metrics.uncoveredTerritories,
        href: "/crm/settings/territories",
        hint: "No primary owner assigned",
      },
    ].filter((item) => item.count > 0);

    return { cur, kpis, attention, withOwner };
  }, [dashboard]);

  if (query.isLoading && !dashboard)
    return (
      <LoadingState
        label="Loading dashboard"
        rows={4}
        onRetry={() => query.refetch()}
      />
    );
  if (query.isError && !dashboard) {
    if (
      query.error instanceof CrmDashboardApiError &&
      query.error.status === 403
    ) {
      return (
        <PermissionState title="You don't have access to the CRM dashboard" />
      );
    }
    return (
      <ErrorState
        title="Could not load the dashboard"
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  if (!dashboard || !view) return null;
  const { sources, activities } = dashboard;
  const m = pipeline?.metrics ?? {};
  const money = (key: string) =>
    formatMoney(reportingCurrency, m[key] ?? 0, { compact: true });
  const count = (key: string) => (m[key] ?? 0).toLocaleString("en-IN");
  const pipelineKpis: Kpi[] = pipeline
    ? (
        [
          {
            id: "open_pipeline",
            label: "Open pipeline",
            value: money("open_pipeline"),
            change: {
              direction: "flat",
              label: `${count("open_opportunities")} open deals`,
              isPositive: true,
            },
          },
          {
            id: "weighted_pipeline",
            label: "Weighted pipeline",
            value: money("weighted_pipeline"),
          },
          {
            id: "closing_in_period",
            label: "Closing in period",
            value: money("closing_in_period"),
            change: {
              direction: "flat",
              label: `${money("weighted_closing")} weighted`,
              isPositive: true,
            },
          },
          { id: "commit", label: "Commit", value: money("commit") },
          { id: "best_case", label: "Best case", value: money("best_case") },
          {
            id: "won_amount",
            label: "Won in period",
            value: money("won_amount"),
            change: {
              direction: "flat",
              label: `${count("won_count")} deals`,
              isPositive: true,
            },
          },
          {
            id: "win_rate",
            label: "Win rate",
            value:
              m.win_rate === null || m.win_rate === undefined
                ? "No closed deals"
                : `${m.win_rate}%`,
            change: {
              direction: "flat",
              label: `${count("won_count")} won · ${count("lost_count")} lost`,
              isPositive: true,
            },
          },
          {
            id: "lost_amount",
            label: "Lost in period",
            value: money("lost_amount"),
          },
        ] as Kpi[]
      ).map((kpi) => ({ ...kpi, onSelect: () => openDrill(kpi.id, kpi.label) }))
    : [];
  const pipelineAttention = pipeline
    ? [
        {
          id: "stalled_opportunities",
          label: "Stalled opportunities",
          count: m.stalled_opportunities ?? 0,
          hint: "Open deals past their stage's time limit",
        },
        {
          id: "unassigned_opportunities",
          label: "Unassigned opportunities",
          count: m.unassigned_opportunities ?? 0,
          hint: "Open deals nobody owns",
        },
      ].filter((item) => item.count > 0)
    : [];
  const quota = pipeline?.quota;
  const activityRows: ActivityRow[] = activities.map((a) => ({
    id: a.id,
    activityType: a.activityType,
    subject: a.subject,
    status: a.status,
    dueAt: a.dueAt,
    assignedName: a.assignedName,
    href: activityHref(a),
  }));
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
      {embedded ? (
        <h2 className="sr-only">Pipeline and activity</h2>
      ) : (
        <PageHeader
          title="Dashboard"
          description="What changed, what needs attention, and what to do next. Every number opens the records behind it."
        />
      )}

      <section
        aria-label="Dashboard scope and period"
        className="flex flex-wrap items-end gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">
            Showing
          </span>
          <ViewToggle
            label="Scope"
            options={SCOPE_OPTIONS}
            value={dashboard.scope}
            onChange={(id) => setParams({ scope: id })}
          />
        </div>
        <div className="w-48">
          <Select
            label="Period"
            options={PERIOD_OPTIONS}
            selectedKey={presetRange(preset) ? preset : "custom"}
            onSelectionChange={(key) => {
              const value = String(key ?? "this_month");
              if (value === "custom")
                setParams({ period: "custom", from: customFrom, to: customTo });
              else setParams({ period: value, from: null, to: null });
            }}
          />
        </div>
        {!presetRange(preset) && (
          <>
            <TextField
              label="From"
              type="date"
              value={customFrom}
              onChange={setCustomFrom}
              className="w-40"
            />
            <TextField
              label="To"
              type="date"
              value={customTo}
              onChange={setCustomTo}
              className="w-40"
            />
            <button
              type="button"
              onClick={() =>
                setParams({ period: "custom", from: customFrom, to: customTo })
              }
              className="h-10 rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted"
            >
              Apply
            </button>
          </>
        )}
        <p className="ml-auto max-w-sm text-xs text-text-muted" role="status">
          {`${scopeDescription} Period ${formatDate(dashboard.period.from)} – ${formatDate(dashboard.period.to)}, compared with ${formatDate(dashboard.period.previousFrom)} – ${formatDate(dashboard.period.previousTo)}.`}
          {query.isFetching ? " Updating…" : ""}
        </p>
      </section>

      <section
        aria-label="Pipeline filters"
        className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        {(
          [
            ["pipelineId", "Pipeline", "pipelines", "All pipelines"],
            ["stageId", "Stage", "stages", "All stages"],
            ["teamId", "Sales team", "salesTeams", "All teams"],
            ["territoryId", "Territory", "territories", "All territories"],
            ["ownerId", "Owner", "users", "All owners"],
            ["sourceId", "Source", "sources", "All sources"],
          ] as const
        ).map(([key, label, optionKey, empty]) => (
          <Select
            key={key}
            label={label}
            options={
              key === "ownerId"
                ? [
                    ...optionList(optionKey, empty),
                    { value: "unassigned", label: "Unassigned" },
                  ]
                : optionList(optionKey, empty)
            }
            selectedKey={searchParams.get(key) ?? ""}
            onSelectionChange={(value) =>
              setParams({ [key]: value ? String(value) : null })
            }
          />
        ))}
      </section>

      {analytics.isError ? (
        <ErrorState
          title="Could not load pipeline figures"
          action={{ label: "Retry", onPress: () => analytics.refetch() }}
        />
      ) : (
        <section aria-label="Pipeline" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">Pipeline</h2>
            <span className="text-xs text-text-muted" role="status">
              {pipeline
                ? `Amounts in ${reportingCurrency ?? "the reporting currency"}. Every figure opens its records.`
                : "Loading pipeline figures…"}
            </span>
          </div>
          {pipeline && pipeline.currency.unconvertedCount > 0 && (
            <p
              className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm text-text"
              role="note"
            >
              {`${pipeline.currency.unconvertedCount} deal(s) in ${pipeline.currency.unconvertedCurrencies.join(", ")} have no exchange rate to ${reportingCurrency} and are left out of the totals. Add the rate under exchange rates to include them.`}
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(165px,1fr))] gap-3">
            {pipelineKpis.map((kpi) => (
              <KpiTile
                key={kpi.id}
                kpi={kpi}
                onOpen={(href) => router.push(href)}
              />
            ))}
          </div>
          {quota && (
            <div className="flex flex-wrap gap-6 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
              {!quota.available ? (
                <span className="text-text-secondary">
                  Quota for this scope is visible to sales managers. Choose
                  &quot;Mine&quot; to see your own.
                </span>
              ) : quota.quota === null ? (
                <span className="text-text-secondary">
                  No quota is set for this scope and period.
                </span>
              ) : (
                <>
                  <QuotaFigure
                    label="Quota"
                    value={formatMoney(reportingCurrency, quota.quota)}
                  />
                  <QuotaFigure
                    label="Attainment"
                    value={
                      quota.attainmentPercent === null
                        ? "—"
                        : `${quota.attainmentPercent}%`
                    }
                  />
                  <QuotaFigure
                    label="Remaining"
                    value={formatMoney(reportingCurrency, quota.remaining)}
                  />
                  <QuotaFigure
                    label="Pipeline coverage of remaining"
                    value={
                      quota.coverageRatio === null
                        ? "—"
                        : `${quota.coverageRatio}×`
                    }
                  />
                </>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(165px,1fr))] gap-3">
        {view.kpis.map((kpi) => (
          <KpiTile
            key={kpi.id}
            kpi={kpi}
            onOpen={(href) => router.push(href)}
          />
        ))}
      </div>

      <section
        aria-label="Attention required"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">
            Attention required
          </h2>
          <span className="text-xs text-text-muted">
            Each item opens the exact list behind its number.
          </span>
        </div>
        {view.attention.length === 0 && pipelineAttention.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {pipelineAttention.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openDrill(item.id, item.label)}
                  className="flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2 text-left hover:bg-surface-muted"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-text">
                      {item.label}
                    </span>
                    <span className="text-xs text-text-muted">{item.hint}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-text">
                    {item.count.toLocaleString("en-IN")}
                  </span>
                </button>
              </li>
            ))}
            {view.attention.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => router.push(item.href)}
                  className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left hover:bg-surface-muted ${item.urgent ? "border-danger-emphasis/40 bg-danger-soft" : "border-border"}`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-text">
                      {item.label}
                    </span>
                    <span className="text-xs text-text-muted">{item.hint}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-text">
                    {item.count.toLocaleString("en-IN")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="Pipeline by stage"
          description={`Open deals by value in ${reportingCurrency ?? "your currency"}; the bars add up to Open pipeline`}
          emptyText="No open pipeline in this scope. Create an opportunity to see it here."
          items={(pipeline?.byStage ?? []).map((stage) => ({
            id: stage.key ?? "none",
            label: stage.label,
            value: stage.value,
            display: formatMoney(reportingCurrency, stage.value, {
              compact: true,
            }),
            secondary: `${stage.count} deal${stage.count === 1 ? "" : "s"}`,
            onSelect: stage.key
              ? () =>
                  openDrill("open_pipeline", `Open pipeline · ${stage.label}`, {
                    stageId: stage.key!,
                  })
              : undefined,
          }))}
        />
        <BarList
          title="Lead sources"
          description="All leads in this scope, with how many became customers"
          emptyText="No leads yet. Add a lead to see where they come from."
          items={sources.map((source) => ({
            id: source.name,
            label: source.name,
            value: source.leadCount,
            display: `${source.leadCount} lead${source.leadCount === 1 ? "" : "s"}`,
            secondary: `${source.convertedCount} converted`,
          }))}
        />
      </div>

      <section
        aria-label="Upcoming activities"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <h2 className="text-sm font-semibold text-text">Work in progress</h2>
        <ActivityGroups
          activities={activityRows}
          onOpen={(href) => router.push(href)}
          showAssignee
          emptyText="Nothing open right now."
        />
      </section>
      <MetricDrilldownDialog
        metric={drill?.metric ?? null}
        title={drill?.title ?? ""}
        filters={drill?.filters ?? pipelineFilters}
        reportingCurrency={reportingCurrency}
        isOpen={drill !== null}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </div>
  );
}

function QuotaFigure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-text">{value}</span>
    </span>
  );
}
