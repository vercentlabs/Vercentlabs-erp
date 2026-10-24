"use client";

// Procurement reports: the catalogue, and one report — filtered by company registration, supplier, dates and status (kept in the URL, so a
// report can be shared and returning from a document shows it as it was), every row opening its source document, and CSV export of what is shown.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PermissionState, Select, TextField, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SupplierFilter } from "@/features/procurement/shared/ProcurementSearchPicker";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import { getReport, getReportCatalog, type ReportColumn, type ReportFilters, type ReportRow } from "./api";
import { Panel } from "@/shared/ui/Panel";
import { LinkTabs } from "@/shared/ui/RouteTabs";

const ALL = "__all";
// The statuses each report can be narrowed to (the server applies them).
const STATUS_OPTIONS: Record<string, Array<[string, string]>> = {
  "purchase-order-progress": [["confirmed", "Confirmed"], ["closed", "Closed"], ["cancelled", "Cancelled"]],
  "pending-goods-receipts": [["overdue", "Overdue only"]],
  "receiving-discrepancies": [["open", "Open"], ["before_custody", "Refused at the dock"], ["shortages_wrong", "Shortages / wrong deliveries"], ["after_custody", "Rejected after receipt"],
    ["awaiting_quality", "Awaiting quality decision"], ["awaiting_return", "Awaiting purchase return"], ["resolved", "Resolved"], ["cancelled", "Cancelled"]],
  "bills-due-dates": [["overdue", "Overdue"], ["due_today", "Due today"], ["partially_paid", "Partially paid"], ["unpaid", "Unpaid"]],
  "purchase-return-summary": [["draft", "Draft"], ["posted", "Final"], ["cancelled", "Cancelled"], ["reversed", "Cancelled"]],
  "vendor-credit-balances": [["unapplied", "Unapplied"], ["partially_applied", "Partially applied"], ["fully_settled", "Fully settled"]],
};
// One Reports page (Procurement report): every report under one of four tabs. A report the catalogue adds later and no tab names shows
// under Purchases.
const GROUPS = [
  { id: "registers", label: "Registers", reports: ["purchase-register", "tds-register", "itc-register", "rcm-liability"] },
  { id: "purchases", label: "Purchases", reports: ["purchases-by-period", "purchases-by-supplier", "purchases-by-item", "purchase-order-progress", "pending-goods-receipts",
    "unbilled-goods-receipts", "purchase-return-summary", "receiving-discrepancies"] },
  { id: "payables", label: "Payables", reports: ["bills-due-dates", "bill-matching-issues", "pending-supplier-credits", "vendor-credit-balances"] },
  { id: "suppliers", label: "Suppliers", reports: ["supplier-scorecard"] },
] as const;
type GroupId = (typeof GROUPS)[number]["id"];
const groupOf = (reportKey: string): GroupId => GROUPS.find((group) => (group.reports as readonly string[]).includes(reportKey))?.id ?? "purchases";
function ReportTabs({ current }: { current: GroupId }) {
  return <LinkTabs label="Report groups" current={current} tabs={GROUPS.map((group) => ({ id: group.id, label: group.label, href: `/procurement/reports?tab=${group.id}` }))} />;
}

// Reports with a fuller screen of their own.
const RELATED: Record<string, { href: string; label: string }> = {
  "bills-due-dates": { href: "/procurement/reports/payment-obligations", label: "Payments due, what is owed, by age and MSME deadlines" },
};

export function ReportsIndexScreen() {
  const workspace = useWorkspaceContext();
  const params = useSearchParams();
  const tab: GroupId = GROUPS.some((group) => group.id === params.get("tab")) ? (params.get("tab") as GroupId) : "registers";
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "reports"), queryFn: getReportCatalog });
  const shown = (query.data ?? []).filter((report) => groupOf(report.key) === tab);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="Purchases, GST and TDS registers, what is owed and how suppliers perform." />
      <ReportTabs current={tab} />
      {query.isLoading && <LoadingState label="Loading reports" />}
      {query.isError && <ErrorState title="Could not load reports" description={query.error instanceof Error ? query.error.message : undefined} action={{ label: "Retry", onPress: () => query.refetch() }} />}
      {query.data && !query.data.length && <PermissionState title="No reports available" description="Your role does not include any Procurement report." />}
      {query.data && query.data.length > 0 && !shown.length && <EmptyState title="No reports here for you" description="Your role does not include these reports." />}
      {shown.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tab === "purchases" && (
            <li>
              <Link href="/procurement/reports/analysis" className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-surface-muted">
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text">Purchase analysis</span>
                  <span className="text-xs text-text-muted">Billed by any two of supplier, item, category, buyer, state and month, with Excel.</span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden="true" />
              </Link>
            </li>
          )}
          {shown.map((report) => (
            <li key={report.key}>
              <Link href={`/procurement/reports/${report.key}`} className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:bg-surface-muted">
                <span className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-text">{report.title}</span>
                  <span className="text-xs text-text-muted">{report.description}</span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cellText(column: ReportColumn, row: ReportRow) {
  const value = row[column.key];
  if (value === null || value === undefined || value === "") return "—";
  if (column.type === "money") return money(row.currency ?? "", value);
  if (column.type === "number") return quantity(value);
  if (column.type === "date") return calendarDate(value);
  return String(value);
}

function downloadCsv(name: string, columns: ReportColumn[], rows: ReportRow[]) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const money = columns.some((column) => column.type === "money");
  const header = [...columns.map((column) => column.label), ...(money ? ["Currency"] : [])];
  const body = rows.map((row) => [...columns.map((column) => row[column.key]), ...(money ? [row.currency ?? ""] : [])].map(escape).join(","));
  const blob = new Blob([[header.map(escape).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// tabs: the tab row above the report (the Reports page's groups by default; Order progress passes the orders' own tabs).
export function ReportScreen({ reportKey, tabs }: { reportKey: string; tabs?: React.ReactNode }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters: ReportFilters = {
    supplierId: params.get("supplierId") ?? undefined, buyingRegistrationId: params.get("buyingRegistrationId") ?? undefined,
    from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, status: params.get("status") ?? undefined,
  };
  const setFilter = (key: keyof ReportFilters, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-order-options"), queryFn: () => getPurchaseOrderOptions(), retry: false });
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "report", reportKey, JSON.stringify(filters)), queryFn: () => getReport(reportKey, filters) });
  const statuses = STATUS_OPTIONS[reportKey];
  const related = RELATED[reportKey];
  const denied = report.error instanceof ProcApiError && report.error.status === 403;
  const missing = report.error instanceof ProcApiError && report.error.status === 404;
  return (
    <div className="flex flex-col gap-4">
      {tabs ?? <ReportTabs current={groupOf(reportKey)} />}
      <PageHeader title={report.data?.title ?? "Report"} description={report.data?.description}
        secondaryActions={report.data ? (
          <div className="flex flex-wrap gap-2">
            <a className={buttonVariants({ variant: "secondary" })} href={`/api/procurement/reports/${reportKey}/xlsx${params.toString() ? `?${params.toString()}` : ""}`} download>
              <Download className="size-4" aria-hidden="true" />Excel</a>
            <Button variant="ghost" onPress={() => downloadCsv(reportKey, report.data.columns, report.data.rows)} isDisabled={!report.data.rows.length}>CSV</Button>
          </div>
        ) : undefined} />
      <Panel title="Filters" actions={related ? <Link className="text-sm text-brand hover:underline" href={related.href}>{related.label}</Link> : undefined}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select label="Company" selectedKey={filters.buyingRegistrationId ?? ALL} onSelectionChange={(value) => setFilter("buyingRegistrationId", String(value))}
            options={[{ value: ALL, label: "All registrations" }, ...(options.data?.registrations ?? []).map((entry) => ({ value: entry.id, label: `${entry.name}${entry.gstin ? ` · ${entry.gstin}` : ""}` }))]} />
          <SupplierFilter anyLabel="All suppliers" className="w-full" known={options.data?.suppliers ?? []} value={filters.supplierId && filters.supplierId !== ALL ? filters.supplierId : ""}
            onChange={(id) => setFilter("supplierId", id || ALL)} />
          <TextField label="From" type="date" value={filters.from ?? ""} onChange={(value) => setFilter("from", value)} />
          <TextField label="To" type="date" value={filters.to ?? ""} onChange={(value) => setFilter("to", value)} />
          {statuses && <Select label="Status" selectedKey={filters.status ?? ALL} onSelectionChange={(value) => setFilter("status", String(value))}
            options={[{ value: ALL, label: "Any status" }, ...statuses.map(([value, label]) => ({ value, label }))]} />}
        </div>
      </Panel>
      {report.isLoading && <LoadingState label="Running the report" />}
      {denied && <PermissionState title="You don't have access to this report" description="Ask an administrator for the permission this report needs." />}
      {missing && <EmptyState title="Report not found" description="Choose a report from the list." action={{ label: "All reports", onPress: () => router.push("/procurement/reports") }} />}
      {report.isError && !denied && !missing && <ErrorState title="Could not run the report" description={report.error instanceof Error ? report.error.message : undefined} action={{ label: "Retry", onPress: () => report.refetch() }} />}
      {report.data && (
        <Panel title={`${report.data.rows.length} ${report.data.rows.length === 1 ? "row" : "rows"}`}>
          {!report.data.rows.length ? <EmptyState title="Nothing to report" description="No documents match these filters." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    {report.data.columns.map((column) => <th key={column.key} className={`py-1 pr-3 font-normal${column.type === "money" || column.type === "number" ? " text-right" : ""}`}>{column.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.data.rows.map((row, index) => (
                    <tr key={`${row.href}-${index}`} className="cursor-pointer hover:bg-surface-muted" onClick={() => router.push(row.href)}>
                      {report.data.columns.map((column, position) => (
                        <td key={column.key} className={`py-2 pr-3${column.type === "money" || column.type === "number" ? " text-right tabular-nums" : ""}`}>
                          {position === 0 ? <Link className="text-brand hover:underline" href={row.href} onClick={(event) => event.stopPropagation()}>{cellText(column, row)}</Link> : cellText(column, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
