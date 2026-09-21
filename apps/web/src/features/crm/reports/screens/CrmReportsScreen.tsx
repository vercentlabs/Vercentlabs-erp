"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { Button, EnterpriseDataGrid, ErrorState, NoResultsState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SavedViewsBar } from "@/features/crm/shared/SavedViewsBar";
import { formatDate, humanize } from "@/features/crm/shared/human";
import { BarList } from "@/features/crm/shared/ui/BarList";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { CrmReportApiError, getCrmReportData } from "../api/reports-api";
import type { CrmReportRow } from "../types";

// The library: what each report answers, grouped by the question a manager is asking. Keys are exactly the ones the
// backend serves; nothing here is a report that does not exist.
const LIBRARY: Array<{ group: string; reports: Array<{ key: string; title: string; answers: string }> }> = [
  {
    group: "Pipeline and forecast",
    reports: [
      { key: "pipeline", title: "Pipeline by stage", answers: "How much open business sits in each stage." },
      { key: "forecast", title: "Forecast by owner", answers: "What each seller has committed, best case and won." },
      { key: "pipeline-intelligence", title: "Pipeline intelligence", answers: "Deals at risk or stalled, and why." },
      { key: "revenue-operations", title: "Revenue operations", answers: "Quota, allocation and attainment." },
      { key: "partner-pipeline", title: "Partner pipeline", answers: "Deals brought in by partners." },
    ],
  },
  {
    group: "Leads",
    reports: [
      { key: "conversion", title: "Lead conversion by month", answers: "How many leads were created and how many converted." },
      { key: "sources", title: "Lead sources", answers: "Which sources bring leads, and which convert." },
    ],
  },
  {
    group: "Activity and engagement",
    reports: [
      { key: "activities", title: "Activity throughput", answers: "Calls, meetings and tasks done." },
      { key: "engagement-intelligence", title: "Engagement intelligence", answers: "How engaged customers and prospects are." },
      { key: "relationship-coverage", title: "Relationship coverage", answers: "Whom you know at each account." },
    ],
  },
  {
    group: "Accounts and campaigns",
    reports: [
      { key: "account-health", title: "Account health", answers: "Which accounts are healthy, and which are slipping." },
      { key: "campaigns", title: "Campaign performance", answers: "Results by campaign." },
    ],
  },
  {
    group: "Governance",
    reports: [
      { key: "privacy", title: "Privacy requests", answers: "Open and closed data requests." },
      { key: "ai-governance", title: "AI governance", answers: "How AI suggestions were used." },
    ],
  },
];
const ALL = LIBRARY.flatMap((g) => g.reports);

// Real numeric columns come back as strings (SQL numeric), so a strict pattern decides what is a number.
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const isNumeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && NUMERIC_STRING.test(v));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

function formatCell(key: string, value: string | number | null) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && ISO_DATE.test(value)) return formatDate(value);
  if (isNumeric(value)) {
    const numeric = Number(value);
    return /(rate|percent|ratio|probability)/i.test(key) ? `${Math.round(numeric * 10) / 10}%` : numeric.toLocaleString("en-IN");
  }
  return typeof value === "string" ? (/^[a-z]+(_[a-z]+)+$/.test(value) ? humanize(value) : value) : String(value);
}

// Reconciliation discipline: a drill link is offered only where the target list can reproduce the exact population,
// so only when no date range narrows the report.
const DRILL_CONFIG: Record<string, { idKey: string; buildHref: (id: string) => string }> = {
  pipeline: { idKey: "stageId", buildHref: (id) => `/crm/opportunities?stageId=${id}&status=open` },
  sources: { idKey: "sourceId", buildHref: (id) => `/crm/leads?sourceId=${id}` },
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const quarterStart = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1))); };
const yearStart = () => iso(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
const PRESETS = [
  { label: "Last 30 days", range: () => ({ from: daysAgo(30), to: iso(new Date()) }) },
  { label: "Last 90 days", range: () => ({ from: daysAgo(90), to: iso(new Date()) }) },
  { label: "This quarter", range: () => ({ from: quarterStart(), to: iso(new Date()) }) },
  { label: "This year", range: () => ({ from: yearStart(), to: iso(new Date()) }) },
  { label: "All time", range: () => ({ from: undefined, to: undefined }) },
];

export function CrmReportsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const [report, setReport] = useState<string>(ALL[0].key);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});

  const current = ALL.find((r) => r.key === report) ?? ALL[0];
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "reports", report, applied),
    queryFn: () => getCrmReportData(report, applied),
  });

  const rows: CrmReportRow[] = useMemo(() => query.data?.report.rows ?? [], [query.data]);
  const drillable = !applied.from && !applied.to ? DRILL_CONFIG[report] : undefined;

  const columns: ColumnDef<CrmReportRow, unknown>[] = useMemo(() => {
    const first = rows[0];
    if (!first) return [];
    const keys = Object.keys(first).filter((key) => !(drillable && key === drillable.idKey) && !/(^id$|Id$)/.test(key));
    return keys.map((key, index) => ({
      id: key,
      header: humanize(key),
      accessorFn: (row: CrmReportRow) => row[key],
      cell: ({ getValue, row }: { getValue: () => unknown; row: { original: CrmReportRow } }) => {
        const value = getValue() as string | number | null;
        const formatted = formatCell(key, value) || <span className="text-text-muted">None</span>;
        const idValue = drillable ? row.original[drillable.idKey] : null;
        if (drillable && idValue && index === 0) {
          return <button type="button" className="text-left text-brand hover:underline" onClick={() => router.push(drillable.buildHref(String(idValue)))}>{formatted}</button>;
        }
        return isNumeric(value) ? <span className="tabular-nums">{formatted}</span> : formatted;
      },
    }));
  }, [rows, drillable, router]);

  // A chart only where the columns are unambiguous: a text label column plus the first numeric column.
  const chart = useMemo(() => {
    const first = rows[0];
    if (!first || rows.length < 2 || rows.length > 30) return null;
    const keys = Object.keys(first).filter((k) => !/(^id$|Id$)/.test(k));
    const labelKey = keys.find((k) => typeof first[k] === "string" && !isNumeric(first[k]) && !ISO_DATE.test(String(first[k])));
    const valueKey = keys.find((k) => k !== labelKey && isNumeric(first[k]) && !/(rate|percent|ratio|probability)/i.test(k));
    if (!labelKey || !valueKey) return null;
    return {
      title: `${humanize(valueKey)} by ${humanize(labelKey).toLowerCase()}`,
      items: rows.slice(0, 12).map((r, i) => ({ id: `${i}`, label: String(r[labelKey] ?? "None"), value: Number(r[valueKey] ?? 0), display: Number(r[valueKey] ?? 0).toLocaleString("en-IN") })),
    };
  }, [rows]);

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof CrmReportApiError && query.error.status === 403
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
  const context = applied.from || applied.to ? `${applied.from ? formatDate(applied.from) : "The start"} to ${applied.to ? formatDate(applied.to) : "today"}` : "All time";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Reports" description="Live figures for everything you can see. Choose a report, set the period, and drill into the numbers." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Report library" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-3">
          {LIBRARY.map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{group.group}</p>
              {group.reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-current={r.key === report ? "page" : undefined}
                  onClick={() => setReport(r.key)}
                  className={`rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm ${r.key === report ? "bg-brand-soft font-medium text-brand-active" : "text-text hover:bg-surface-muted"}`}
                >
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div>
              <h2 className="text-base font-semibold text-text">{current.title}</h2>
              <p className="text-sm text-text-secondary">{current.answers}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <DateInput label="From" value={from} onChange={setFrom} />
              <DateInput label="To" value={to} onChange={setTo} />
              <Button variant="secondary" onPress={() => setApplied({ from: from || undefined, to: to || undefined })}>Apply period</Button>
              <SavedViewsBar
                resource={`report:${report}`}
                baseFilters={{}}
                currentFilters={applied}
                hasExplicitFilters={false}
                onApply={(filters) => { setFrom(filters.from ?? ""); setTo(filters.to ?? ""); setApplied(filters); }}
              />
              <a href={exportHref} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium text-text hover:bg-surface-muted">
                <Download className="size-4" aria-hidden="true" />
                Export CSV
              </a>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick periods">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => { const r = p.range(); setFrom(r.from ?? ""); setTo(r.to ?? ""); setApplied(r); }} className="min-h-8 rounded-full border border-border px-3 text-xs text-text-secondary hover:bg-surface-muted">
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">{`Showing: ${context}. Figures are computed when you open the report.`}</p>
          </section>

          {chart && <BarList title={chart.title} items={chart.items} emptyText="No data" />}

          <EnterpriseDataGrid<CrmReportRow>
            aria-label={`${current.title} table`}
            columns={columns}
            data={rows}
            state={gridState}
            loadingContent={<LoadingState label="Running report" rows={4} onRetry={() => query.refetch()} />}
            emptyContent={<NoResultsState title="No data for this report and period" description="Try a wider period, or choose All time." />}
            errorContent={<ErrorState title="Could not run this report" action={{ label: "Retry", onPress: () => query.refetch() }} />}
            permissionDeniedContent={<PermissionState title="You don't have access to CRM Reports" />}
          />
        </div>
      </div>
    </div>
  );
}
