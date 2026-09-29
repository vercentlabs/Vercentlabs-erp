"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  BarChart,
  Button,
  ChartCard,
  ChartDataTable,
  DonutChart,
  ErrorState,
  Menu,
  MenuItem,
  MenuTrigger,
  MetricStrip,
  PageHeader,
  PermissionState,
  Select,
  TextField,
  chartSeriesColor,
  chartStateColor,
  formatCompactNumber,
  isChartEmpty,
  toChartNumber,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, formatMoney } from "@/shared/format/human";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { LoadingState } from "@/shared/ui/LoadingState";
import {
  CrmDashboardApiError,
  getCrmDashboardData,
} from "@/features/crm/dashboard/api/dashboard-api";
import type {
  CrmDashboard,
  CrmDashboardQualification,
} from "@/features/crm/dashboard/types";
import {
  HOME_SCOPES,
  PERIOD_OPTIONS,
  attentionItems,
  homeLinks,
  monthLabel,
  resolveHomeFilters,
} from "../home-view";

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

const QUALIFICATION: Record<
  CrmDashboardQualification["key"],
  { label: string; color: string }
> = {
  qualified: { label: "Qualified", color: chartStateColor.positive },
  not_reviewed: { label: "Not reviewed", color: chartStateColor.pending },
  unqualified: { label: "Unqualified", color: chartStateColor.neutral },
};

const count = (value: number, one: string, many: string) =>
  `${value.toLocaleString("en-IN")} ${value === 1 ? one : many}`;

// CRM's one overview. Every figure is a permission-scoped server aggregate
// from GET /api/crm/dashboard for the chosen scope and period, and every
// figure opens the list behind it (home-view.ts). Scope and period live in
// the URL, so a view can be bookmarked or shared; Home opens on "Mine".
export function CrmHomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workspace = useWorkspaceContext();
  const filters = resolveHomeFilters((key) => searchParams.get(key));
  const [customFrom, setCustomFrom] = useState(filters.from);
  const [customTo, setCustomTo] = useState(filters.to);
  const [pickingCustom, setPickingCustom] = useState(false);
  const showCustom = pickingCustom || filters.preset === "custom";

  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const companyKey = scopedQueryKey(workspace);
  const query = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "dashboard",
      filters.scope,
      filters.from,
      filters.to,
    ),
    queryFn: () =>
      getCrmDashboardData({
        scope: filters.scope,
        from: filters.from,
        to: filters.to,
      }),
    // While a new scope or period loads, the previous figures stay (dimmed)
    // — but never another company's figures after a company switch.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[0] === companyKey[0] &&
      previousQuery?.queryKey[1] === companyKey[1]
        ? previous
        : undefined,
  });

  const createMenu = (
    <MenuTrigger>
      <Button variant="primary">
        <Plus className="size-4" aria-hidden="true" />
        Create
      </Button>
      <Menu onAction={(key) => router.push(String(key))}>
        {CREATE_LINKS.map((link) => (
          <MenuItem key={link.href} id={link.href}>
            {link.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
  const header = (
    <PageHeader
      title="CRM"
      description="Your pipeline, customers and work in one place."
      primaryAction={createMenu}
    />
  );

  const dashboard = query.data?.dashboard;
  if (!dashboard) {
    if (query.isError) {
      if (
        query.error instanceof CrmDashboardApiError &&
        query.error.status === 403
      )
        return <PermissionState title="You don't have access to CRM" />;
      return (
        <div className="flex flex-1 flex-col gap-6">
          {header}
          <ErrorState
            title="Could not load CRM"
            action={{ label: "Retry", onPress: () => query.refetch() }}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <LoadingState
          label="Loading CRM"
          rows={4}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const busy = query.isFetching && query.isPlaceholderData;
  const scopeDescription =
    dashboard.scope === "mine"
      ? "Records you own."
      : dashboard.scope === "team"
        ? "Records owned by you and the sales teams you manage."
        : dashboard.canViewAll
          ? "Every record in this company."
          : "Every record you are allowed to see.";

  return (
    <div className="@container flex flex-1 flex-col gap-6">
      {header}

      <section
        aria-label="Scope and period"
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3"
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">
            Showing
          </span>
          <ViewToggle
            label="Scope"
            options={HOME_SCOPES}
            value={filters.scope}
            onChange={(id) => setParams({ scope: id })}
          />
        </div>
        <div className="w-full @sm:w-48">
          <Select
            label="Period"
            options={PERIOD_OPTIONS}
            selectedKey={showCustom ? "custom" : filters.preset}
            onSelectionChange={(key) => {
              const value = String(key ?? "this_month");
              if (value === "custom") {
                setCustomFrom(filters.from);
                setCustomTo(filters.to);
                setPickingCustom(true);
              } else {
                setPickingCustom(false);
                setParams({ period: value, from: null, to: null });
              }
            }}
          />
        </div>
        {showCustom && (
          <div className="flex flex-wrap items-end gap-3">
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
            <Button
              variant="secondary"
              onPress={() => {
                setPickingCustom(false);
                setParams({ period: "custom", from: customFrom, to: customTo });
              }}
            >
              Apply
            </Button>
          </div>
        )}
        <p
          className="w-full text-xs text-text-muted @3xl:ml-auto @3xl:w-auto @3xl:max-w-sm @3xl:text-right"
          role="status"
        >
          {`${scopeDescription} ${formatDate(dashboard.period.from)} – ${formatDate(dashboard.period.to)}.`}
          {busy ? " Updating…" : ""}
        </p>
      </section>

      <HomeBody
        dashboard={dashboard}
        busy={busy}
        onNavigate={(href) => router.push(href)}
      />
    </div>
  );
}

function HomeBody({
  dashboard,
  busy,
  onNavigate,
}: {
  dashboard: CrmDashboard;
  busy: boolean;
  onNavigate: (href: string) => void;
}) {
  const { metrics, period, scope } = dashboard;
  const cur = metrics.currencyCode;
  const links = homeLinks(scope, period);
  const money = (value: number | string) => formatMoney(cur, value);
  const compactMoney = (value: number | string) =>
    formatMoney(cur, value, { compact: true });

  const stageRows = dashboard.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    pipeline: toChartNumber(stage.amount),
    weighted: toChartNumber(stage.weightedAmount),
    opportunities: stage.opportunityCount,
  }));
  const qualificationTotal = dashboard.qualification.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  const trendRows = dashboard.leadTrend.map((row) => ({
    month: row.month,
    label: monthLabel(row.month),
    created: row.created,
    converted: row.converted,
  }));
  const sourceRows = dashboard.sourcePerformance.map((row) => ({
    id: row.sourceId ?? (row.isOther ? "other" : "unspecified"),
    name: row.name,
    leads: row.leadCount,
    converted: row.convertedCount,
    href: links.source(row.sourceId),
  }));
  const attention = attentionItems(metrics, links);
  const periodText = `${formatDate(period.from)} – ${formatDate(period.to)}`;

  return (
    <div
      className={`flex flex-col gap-6 transition-opacity motion-reduce:transition-none ${busy ? "opacity-60" : ""}`}
      aria-busy={busy || undefined}
    >
      <MetricStrip
        className="grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-4"
        metrics={[
          {
            label: "Open pipeline",
            value: compactMoney(metrics.pipelineValue),
            detail: `${compactMoney(metrics.weightedPipeline)} weighted`,
            href: links.openOpportunities,
            onNavigate,
            linkLabel: `Open pipeline ${money(metrics.pipelineValue)}, ${money(metrics.weightedPipeline)} weighted. Open these opportunities`,
          },
          {
            label: "Open opportunities",
            value: metrics.openOpportunities.toLocaleString("en-IN"),
            href: links.openOpportunities,
            onNavigate,
            linkLabel: `${count(metrics.openOpportunities, "open opportunity", "open opportunities")}. Open the list`,
          },
          {
            label: "Open leads",
            value: metrics.openLeads.toLocaleString("en-IN"),
            detail: `${metrics.qualifiedLeads.toLocaleString("en-IN")} qualified`,
            href: links.openLeads,
            onNavigate,
            linkLabel: `${count(metrics.openLeads, "open lead", "open leads")}, ${metrics.qualifiedLeads.toLocaleString("en-IN")} qualified. Open the list`,
          },
          {
            label: "Won this period",
            value: compactMoney(metrics.wonAmountInPeriod),
            detail: count(metrics.wonInPeriod, "deal", "deals"),
            href: links.wonInPeriod,
            onNavigate,
            linkLabel: `Won ${periodText}: ${money(metrics.wonAmountInPeriod)} from ${count(metrics.wonInPeriod, "deal", "deals")}. Open these opportunities`,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-3">
        <ChartCard
          className="@3xl:col-span-2"
          title="Pipeline by stage"
          description={`Open opportunities, by stage — full and weighted value${cur ? ` (${cur})` : ""}`}
          isEmpty={stageRows.every((row) => row.opportunities === 0)}
          emptyText="No open opportunities yet."
        >
          <BarChart
            data={stageRows}
            categoryKey="name"
            orientation="responsive"
            ariaLabel="Pipeline and weighted value by stage"
            series={[
              {
                key: "pipeline",
                label: "Pipeline value",
                color: chartSeriesColor[1],
              },
              {
                key: "weighted",
                label: "Weighted value",
                color: chartSeriesColor[2],
              },
            ]}
            valueFormatter={money}
            axisFormatter={compactMoney}
            tooltipFooter={(row) =>
              count(row.opportunities, "open opportunity", "open opportunities")
            }
            onSelect={(row) => onNavigate(links.stage(row.id))}
          />
          <ChartDataTable
            caption="Pipeline by stage"
            rows={stageRows}
            rowKey={(row) => row.id}
            rowHeader={{
              header: "Stage",
              cell: (row) => row.name,
              href: (row) => links.stage(row.id),
            }}
            columns={[
              {
                key: "pipeline",
                header: "Pipeline value",
                cell: (row) => money(row.pipeline),
              },
              {
                key: "weighted",
                header: "Weighted value",
                cell: (row) => money(row.weighted),
              },
              {
                key: "count",
                header: "Opportunities",
                cell: (row) => row.opportunities.toLocaleString("en-IN"),
              },
            ]}
            onNavigate={onNavigate}
          />
        </ChartCard>

        <ChartCard
          title="Lead qualification"
          description="Active leads, by qualification decision"
          isEmpty={qualificationTotal === 0}
          emptyText="No lead qualification data yet."
        >
          <DonutChart
            ariaLabel="Active leads by qualification decision"
            totalLabel="active leads"
            onNavigate={onNavigate}
            segments={dashboard.qualification.map((row) => ({
              key: row.key,
              label: QUALIFICATION[row.key].label,
              color: QUALIFICATION[row.key].color,
              value: row.count,
              href: links.qualification(row.key),
            }))}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <ChartCard
          title="Lead momentum"
          description="Leads created and converted in each of the last six months"
          isEmpty={isChartEmpty(trendRows, ["created", "converted"])}
          emptyText="No leads were created in the last six months."
        >
          <BarChart
            data={trendRows}
            categoryKey="label"
            ariaLabel="New and converted leads per month, last six months"
            integerValues
            series={[
              {
                key: "created",
                label: "New leads",
                color: chartSeriesColor[1],
              },
              {
                key: "converted",
                label: "Converted leads",
                color: chartSeriesColor[3],
              },
            ]}
            valueFormatter={(value) => value.toLocaleString("en-IN")}
            height={220}
            onSelect={(row) => onNavigate(links.createdInMonth(row.month))}
          />
          <ChartDataTable
            caption="New and converted leads per month"
            rows={trendRows}
            rowKey={(row) => row.month}
            rowHeader={{
              header: "Month",
              cell: (row) => row.label,
              href: (row) => links.createdInMonth(row.month),
            }}
            columns={[
              {
                key: "created",
                header: "New leads",
                cell: (row) => row.created.toLocaleString("en-IN"),
              },
              {
                key: "converted",
                header: "Converted",
                cell: (row) => row.converted.toLocaleString("en-IN"),
              },
            ]}
            onNavigate={onNavigate}
          />
        </ChartCard>

        <ChartCard
          title="Lead source performance"
          description={`Leads created ${periodText}, by source, and how many converted`}
          isEmpty={sourceRows.length === 0}
          emptyText="No leads were created in this period."
        >
          <BarChart
            data={sourceRows}
            categoryKey="name"
            orientation="horizontal"
            ariaLabel="Leads and conversions by source"
            integerValues
            series={[
              { key: "leads", label: "Leads", color: chartSeriesColor[1] },
              {
                key: "converted",
                label: "Converted",
                color: chartSeriesColor[3],
              },
            ]}
            valueFormatter={(value) => value.toLocaleString("en-IN")}
            axisFormatter={(value) => formatCompactNumber(value)}
            onSelect={(row) => row.href && onNavigate(row.href)}
          />
          <ChartDataTable
            caption="Leads and conversions by source"
            rows={sourceRows}
            rowKey={(row) => row.id}
            rowHeader={{
              header: "Source",
              cell: (row) => row.name,
              href: (row) => row.href,
            }}
            columns={[
              {
                key: "leads",
                header: "Leads",
                cell: (row) => row.leads.toLocaleString("en-IN"),
              },
              {
                key: "converted",
                header: "Converted",
                cell: (row) => row.converted.toLocaleString("en-IN"),
              },
            ]}
            onNavigate={onNavigate}
          />
        </ChartCard>
      </div>

      <section
        aria-labelledby="crm-home-attention"
        className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <h2 id="crm-home-attention" className="text-sm font-semibold text-text">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
            {attention.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={`flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand ${item.urgent ? "border-danger-emphasis/40 bg-danger-soft" : "border-border"}`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium text-text">
                      {item.label}
                    </span>
                    <span className="text-xs text-text-muted">{item.hint}</span>
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-text">
                    {item.count.toLocaleString("en-IN")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
