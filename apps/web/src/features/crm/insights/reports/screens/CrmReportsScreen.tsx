"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import {
  Button,
  ComboBox,
  EnterpriseDataGrid,
  ErrorState,
  NoResultsState,
  PageHeader,
  PermissionState,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate, humanize } from "@/shared/format/human";
import { BarList } from "@/features/crm/shared/ui/BarList";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { LoadingState } from "@/shared/ui/LoadingState";
import { CrmReportApiError, getCrmReportData } from "../api/reports-api";
import { SavedReportsSection } from "../components/SavedReportsSection";
import type { PipelineFilters } from "@/features/crm/home/dashboard/api/analytics-api";
import { MetricDrilldownDialog } from "@/features/crm/home/dashboard/components/MetricDrilldownDialog";
import type { CrmReportRow } from "../types";

// The library: what each report answers, grouped by the question a manager is asking. Keys are exactly the ones the
// backend serves; nothing here is a report that does not exist.
const LIBRARY: Array<{
  group: string;
  reports: Array<{ key: string; title: string; answers: string }>;
}> = [
  {
    group: "Pipeline and forecast",
    reports: [
      {
        key: "pipeline",
        title: "Pipeline by stage",
        answers: "How much open business sits in each stage.",
      },
      {
        key: "forecast",
        title: "Forecast by owner",
        answers: "What each seller has committed, best case and won.",
      },
      {
        key: "win-loss",
        title: "Won and lost reasons",
        answers:
          "Why deals closed in the period were won or lost. Open a reason to see its deals.",
      },
      {
        key: "pipeline-intelligence",
        title: "Pipeline intelligence",
        answers: "Deals at risk or stalled, and why.",
      },
      {
        key: "revenue-operations",
        title: "Revenue operations",
        answers: "Quota, allocation and attainment.",
      },
      {
        key: "partner-pipeline",
        title: "Partner pipeline",
        answers: "Deals brought in by partners.",
      },
    ],
  },
  {
    group: "Leads",
    reports: [
      {
        key: "conversion",
        title: "Lead conversion by month",
        answers: "How many leads were created and how many converted.",
      },
      {
        key: "sources",
        title: "Lead sources",
        answers: "Which sources bring leads, and which convert.",
      },
      {
        key: "attribution",
        title: "Multi-touch attribution",
        answers:
          "Which campaigns actually touched a Lead before it converted, and how credit splits across them.",
      },
    ],
  },
  {
    group: "Activity and engagement",
    reports: [
      {
        key: "activities",
        title: "Activity throughput",
        answers: "Calls, meetings and tasks done.",
      },
      {
        key: "engagement-intelligence",
        title: "Engagement intelligence",
        answers: "How engaged customers and prospects are.",
      },
      {
        key: "relationship-coverage",
        title: "Relationship coverage",
        answers: "Whom you know at each account.",
      },
    ],
  },
  {
    group: "Accounts and campaigns",
    reports: [
      {
        key: "account-health",
        title: "Account health",
        answers: "Which accounts are healthy, and which are slipping.",
      },
      {
        key: "campaigns",
        title: "Campaign performance",
        answers: "Results by campaign.",
      },
    ],
  },
  {
    group: "Governance",
    reports: [
      {
        key: "privacy",
        title: "Privacy requests",
        answers: "Open and closed data requests.",
      },
      {
        key: "ai-governance",
        title: "AI governance",
        answers: "How AI suggestions were used.",
      },
    ],
  },
];
const ALL = LIBRARY.flatMap((g) => g.reports);
// Organisation-wide rollups and who the server serves them to
// (analytics-service.js rollupAllowed, CRM_REPORT_SCOPE_FORBIDDEN).
const ROLLUP_REPORT_PERMISSIONS: Record<string, string[]> = {
  campaigns: ["crm.records.view_all", "crm.leads.view_all"],
  attribution: ["crm.records.view_all", "crm.leads.view_all"],
  "partner-pipeline": ["crm.records.view_all", "crm.partners.manage"],
  "ai-governance": ["crm.records.view_all"],
  privacy: ["crm.records.view_all"],
};

// Real numeric columns come back as strings (SQL numeric), so a strict pattern decides what is a number.
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const isNumeric = (v: unknown) =>
  typeof v === "number" || (typeof v === "string" && NUMERIC_STRING.test(v));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

// Columns that carry a code rather than free text (outcome, status, type…) read as words.
const ENUM_COLUMN =
  /(outcome|status|type|category|channel|tier|stage_type|model|method|state)$/i;
// Internal ordering keys are never shown.
const HIDDEN_COLUMN = /^(sequence)$/;
const monthFormatter = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "numeric",
});

function columnHeader(key: string) {
  return humanize(key).replace(/ percent$/i, " %");
}

function formatCell(key: string, value: string | number | null) {
  if (value === null || value === undefined || value === "") return "";
  if (key === "period" && typeof value === "string" && ISO_DATE.test(value))
    return monthFormatter.format(new Date(value));
  if (typeof value === "string" && ISO_DATE.test(value))
    return formatDate(value);
  if (
    typeof value === "string" &&
    ENUM_COLUMN.test(key) &&
    /^[a-z_]+$/.test(value)
  )
    return humanize(value);
  if (isNumeric(value)) {
    const numeric = Number(value);
    return /(rate|percent|ratio|probability)/i.test(key)
      ? `${Math.round(numeric * 10) / 10}%`
      : numeric.toLocaleString("en-IN");
  }
  return typeof value === "string"
    ? /^[a-z]+(_[a-z]+)+$/.test(value)
      ? humanize(value)
      : value
    : String(value);
}

// Reconciliation discipline: a drill link is offered only where the target list can reproduce the exact population.
// Undated drills (pipeline, sources) apply only when no date range narrows the report; a dated drill carries the
// range into the list with the same predicate the report uses.
type Range = { from?: string; to?: string };
// Pipeline and forecast rows are canonical metrics (metric-definitions.js):
// they open the exact records behind the figure in the metric drill-down,
// whose total equals the cell.
const METRIC_DRILL: Record<
  string,
  {
    idKey: string;
    metric: string;
    filters: (row: CrmReportRow, range: Range) => PipelineFilters;
  }
> = {
  pipeline: {
    idKey: "stageId",
    metric: "open_pipeline",
    filters: (row) => ({
      stageId: row.stageId ? String(row.stageId) : undefined,
    }),
  },
  forecast: {
    idKey: "ownerUserId",
    metric: "forecast_pipeline",
    filters: (row, range) => ({
      ownerId: row.ownerUserId ? String(row.ownerUserId) : "unassigned",
      from: range.from,
      to: range.to,
    }),
  },
};

const DRILL_CONFIG: Record<
  string,
  {
    idKey: string;
    dated?: boolean;
    buildHref: (row: CrmReportRow, range: Range) => string | null;
  }
> = {
  sources: {
    idKey: "sourceId",
    buildHref: (row) =>
      row.sourceId ? `/crm/leads?sourceId=${row.sourceId}` : null,
  },
  // F026 — closed deals by actual close date, outcome and reason ("none" = no reason recorded).
  "win-loss": {
    idKey: "outcomeReasonId",
    dated: true,
    buildHref: (row, range) => {
      const params = new URLSearchParams({
        status: String(row.outcome),
        outcomeReasonId: row.outcomeReasonId
          ? String(row.outcomeReasonId)
          : "none",
      });
      if (range.from) params.set("closedFrom", range.from);
      if (range.to) params.set("closedTo", range.to);
      return `/crm/opportunities?${params.toString()}`;
    },
  },
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const quarterStart = () => {
  const d = new Date();
  return iso(
    new Date(
      Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1),
    ),
  );
};
const yearStart = () =>
  iso(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
const PRESETS = [
  {
    label: "Last 30 days",
    range: () => ({ from: daysAgo(30), to: iso(new Date()) }),
  },
  {
    label: "Last 90 days",
    range: () => ({ from: daysAgo(90), to: iso(new Date()) }),
  },
  {
    label: "This quarter",
    range: () => ({ from: quarterStart(), to: iso(new Date()) }),
  },
  {
    label: "This year",
    range: () => ({ from: yearStart(), to: iso(new Date()) }),
  },
  { label: "All time", range: () => ({ from: undefined, to: undefined }) },
];

export function CrmReportsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const isOwner = workspace.roleSlugs.includes("organization_owner");
  const canOpen = (key: string) =>
    isOwner ||
    !ROLLUP_REPORT_PERMISSIONS[key] ||
    ROLLUP_REPORT_PERMISSIONS[key].some((permission) =>
      workspace.permissions.includes(permission),
    );
  const library = LIBRARY.map((group) => ({
    ...group,
    reports: group.reports.filter((r) => canOpen(r.key)),
  })).filter((group) => group.reports.length > 0);
  const permitted = library.flatMap((group) => group.reports);
  // The selected report and the applied period live in the URL
  // (/crm/reports?report=pipeline&from=…&to=…): refresh, back/forward and a
  // shared link all reopen the same report. Keys are the backend's own
  // report keys; an unknown or not-permitted key falls back to the first.
  const searchParams = useSearchParams();
  const requested = searchParams.get("report");
  const report =
    permitted.find((r) => r.key === requested)?.key ??
    permitted[0]?.key ??
    ALL[0].key;
  const applied = useMemo(
    () => ({
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
    }),
    [searchParams],
  );
  const [from, setFrom] = useState(applied.from ?? "");
  const [to, setTo] = useState(applied.to ?? "");
  function navigate(next: { report?: string; from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const values = { report, ...applied, ...next };
    for (const key of ["report", "from", "to"] as const) {
      const value = values[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/crm/reports?${params.toString()}`, { scroll: false });
  }
  const setReport = (key: string) => navigate({ report: key });
  const setApplied = (range: { from?: string; to?: string }) =>
    navigate({ from: range.from, to: range.to });

  const current = ALL.find((r) => r.key === report) ?? ALL[0];
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "reports", report, applied),
    queryFn: () => getCrmReportData(report, applied),
  });

  const rows: CrmReportRow[] = useMemo(
    () => query.data?.report.rows ?? [],
    [query.data],
  );
  const drillable =
    DRILL_CONFIG[report]?.dated || (!applied.from && !applied.to)
      ? DRILL_CONFIG[report]
      : undefined;
  const metricDrill = METRIC_DRILL[report];
  // The range the server actually used (canonical reports default to the current month).
  const resolvedFilters = query.data?.report.filters as Range | undefined;
  const reportRange: Range = useMemo(
    () => ({
      from: resolvedFilters?.from ?? applied.from,
      to: resolvedFilters?.to ?? applied.to,
    }),
    [resolvedFilters?.from, resolvedFilters?.to, applied.from, applied.to],
  );
  const [drill, setDrill] = useState<{
    metric: string;
    title: string;
    filters: PipelineFilters;
  } | null>(null);

  const columns: ColumnDef<CrmReportRow, unknown>[] = useMemo(() => {
    const first = rows[0];
    if (!first) return [];
    const keys = Object.keys(first).filter(
      (key) =>
        !(drillable && key === drillable.idKey) &&
        !(metricDrill && key === metricDrill.idKey) &&
        !/(^id$|Id$)/.test(key) &&
        !HIDDEN_COLUMN.test(key),
    );
    return keys.map((key, index) => ({
      id: key,
      header: columnHeader(key),
      accessorFn: (row: CrmReportRow) => row[key],
      cell: ({
        getValue,
        row,
      }: {
        getValue: () => unknown;
        row: { original: CrmReportRow };
      }) => {
        const value = getValue() as string | number | null;
        const formatted = formatCell(key, value) || (
          <span className="text-text-muted">None</span>
        );
        if (metricDrill && index === 0) {
          const drillFilters = metricDrill.filters(row.original, reportRange);
          return (
            <button
              type="button"
              className="text-left text-brand hover:underline"
              onClick={() =>
                setDrill({
                  metric: metricDrill.metric,
                  title: `${current.title} · ${String(formatted)}`,
                  filters: drillFilters,
                })
              }
            >
              {formatted}
            </button>
          );
        }
        const href =
          drillable && index === 0
            ? drillable.buildHref(row.original, applied)
            : null;
        if (href) {
          return (
            <button
              type="button"
              className="text-left text-brand hover:underline"
              onClick={() => router.push(href)}
            >
              {formatted}
            </button>
          );
        }
        return isNumeric(value) ? (
          <span className="tabular-nums">{formatted}</span>
        ) : (
          formatted
        );
      },
    }));
  }, [
    rows,
    drillable,
    metricDrill,
    router,
    applied,
    reportRange,
    current.title,
    setDrill,
  ]);

  // A chart only where the columns are unambiguous: a text label column plus the first numeric column.
  const chart = useMemo(() => {
    const first = rows[0];
    if (!first || rows.length < 2 || rows.length > 30) return null;
    const keys = Object.keys(first).filter(
      (k) => !/(^id$|Id$)/.test(k) && !HIDDEN_COLUMN.test(k),
    );
    const labelKey = keys.find(
      (k) =>
        typeof first[k] === "string" &&
        !isNumeric(first[k]) &&
        !ISO_DATE.test(String(first[k])),
    );
    const valueKey = keys.find(
      (k) =>
        k !== labelKey &&
        isNumeric(first[k]) &&
        !/(rate|percent|ratio|probability)/i.test(k),
    );
    if (!labelKey || !valueKey) return null;
    return {
      title: `${humanize(valueKey)} by ${humanize(labelKey).toLowerCase()}`,
      items: rows.slice(0, 12).map((r, i) => ({
        id: `${i}`,
        label: String(r[labelKey] ?? "None"),
        value: Number(r[valueKey] ?? 0),
        display: Number(r[valueKey] ?? 0).toLocaleString("en-IN"),
      })),
    };
  }, [rows]);

  const gridState = query.isLoading
    ? "loading"
    : query.isError &&
        query.error instanceof CrmReportApiError &&
        query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  const exportParams = new URLSearchParams();
  if (applied.from) exportParams.set("from", applied.from);
  if (applied.to) exportParams.set("to", applied.to);
  const exportHref = `/api/crm/reports/${encodeURIComponent(report)}/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;
  const context =
    reportRange.from || reportRange.to
      ? `${reportRange.from ? formatDate(reportRange.from) : "The start"} to ${reportRange.to ? formatDate(reportRange.to) : "today"}`
      : "All time";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Reports"
        description="Live figures for everything you can see. Choose a report, set the period, and drill into the numbers."
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <ComboBox
            label="Report"
            className="w-full max-w-md"
            placeholder="Search reports…"
            sections={library.map((group) => ({
              id: group.group,
              label: group.group,
              options: group.reports.map((r) => ({
                value: r.key,
                label: r.title,
              })),
            }))}
            selectedKey={report}
            onSelectionChange={(key) => {
              if (key && String(key) !== report) setReport(String(key));
            }}
            emptyMessage="No report matches"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div>
              <h2 className="text-base font-semibold text-text">
                {current.title}
              </h2>
              <p className="text-sm text-text-secondary">{current.answers}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <DateInput label="From" value={from} onChange={setFrom} />
              <DateInput label="To" value={to} onChange={setTo} />
              <Button
                variant="secondary"
                onPress={() =>
                  setApplied({ from: from || undefined, to: to || undefined })
                }
              >
                Apply period
              </Button>
              <a
                href={exportHref}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted"
              >
                <Download className="size-4" aria-hidden="true" />
                Export CSV
              </a>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Quick periods"
            >
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const r = p.range();
                    setFrom(r.from ?? "");
                    setTo(r.to ?? "");
                    setApplied(r);
                  }}
                  className="min-h-8 rounded-full border border-border px-3 text-xs text-text-secondary hover:bg-surface-muted"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              {`Showing: ${context}. Figures are computed when you open the report.`}
              {query.data?.report.generatedAt &&
                ` Generated ${new Date(query.data.report.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`}
              {query.data?.report.fingerprint && (
                <span title="The same data, scope and period always give the same fingerprint; the CSV export carries it too.">{` Fingerprint ${query.data.report.fingerprint.slice(0, 12)}.`}</span>
              )}
            </p>
          </section>

          {chart && (
            <BarList
              title={chart.title}
              items={chart.items}
              emptyText="No data"
            />
          )}

          <EnterpriseDataGrid<CrmReportRow>
            aria-label={`${current.title} table`}
            columns={columns}
            data={rows}
            state={gridState}
            loadingContent={
              <LoadingState
                label="Running report"
                rows={4}
                onRetry={() => query.refetch()}
              />
            }
            emptyContent={
              <NoResultsState
                title="No data for this report and period"
                description="Try a wider period, or choose All time."
              />
            }
            errorContent={
              <ErrorState
                title="Could not run this report"
                action={{ label: "Retry", onPress: () => query.refetch() }}
              />
            }
            permissionDeniedContent={
              <PermissionState title="You don't have access to CRM Reports" />
            }
          />
        </div>
      </div>
      <SavedReportsSection />
      <MetricDrilldownDialog
        metric={drill?.metric ?? null}
        title={drill?.title ?? ""}
        filters={drill?.filters ?? {}}
        reportingCurrency={
          (
            query.data?.report as
              { currency?: { reportingCurrency?: string | null } } | undefined
          )?.currency?.reportingCurrency ?? null
        }
        isOpen={drill !== null}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      />
    </div>
  );
}
