"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, ErrorState, MetricStrip, PageHeader, PermissionState, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel } from "@/features/sales/shared/format";
import { SalesPanel } from "@/features/sales/shared/SalesUi";

type Dashboard = { active_quotations: string; expiring_quotations: string; pending_quote_approvals: string; confirmed_order_value: string; orders_on_hold: string; ready_to_invoice: string };
type ReportRow = Record<string, unknown> & { _row: number };

// ------------------------------------------------------------------ home
export function SalesHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "dashboard"), queryFn: () => request<{ dashboard: Dashboard }>("/dashboard").then((r) => r.dashboard) });
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;
  const d = query.data;
  const links = [
    { href: "/sales/quotations", label: "Quotations", hint: "Priced offers, approvals and customer links" },
    { href: "/sales/orders", label: "Sales orders", hint: "Confirm, hold, amend and hand off" },
    { href: "/sales/deliveries", label: "Deliveries", hint: "Fulfilment requests and progress" },
    { href: "/sales/invoices", label: "Invoices", hint: "Invoice requests raised from orders" },
    { href: "/sales/returns", label: "Returns", hint: "Customer returns against fulfilled quantities" },
    { href: "/sales/reports", label: "Reports", hint: "Order-to-cash, conversion and performance" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sales" description="Quote-to-cash at a glance. Figures are live and limited to the companies you can access." />
      {query.isError ? (
        <ErrorState title="Could not load the dashboard" action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : (
        <MetricStrip
          metrics={[
            { label: "Open quotations", value: d ? String(Number(d.active_quotations)) : "…" },
            { label: "Expiring in 7 days", value: d ? String(Number(d.expiring_quotations)) : "…" },
            { label: "Quotes awaiting approval", value: d ? String(Number(d.pending_quote_approvals)) : "…" },
            { label: "Confirmed order value", value: d ? Number(d.confirmed_order_value).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "…" },
            { label: "Orders on hold", value: d ? String(Number(d.orders_on_hold)) : "…" },
            { label: "Ready to invoice", value: d ? String(Number(d.ready_to_invoice)) : "…" },
          ]}
        />
      )}
      <SalesPanel title="Go to">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="flex h-full flex-col gap-0.5 rounded-[var(--radius-control)] border border-border p-3 transition-colors hover:bg-surface-muted">
                <span className="text-sm font-medium text-text">{link.label}</span>
                <span className="text-xs text-text-muted">{link.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SalesPanel>
    </div>
  );
}

// --------------------------------------------------------------- reports
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const SIX_DECIMALS = /^-?\d+\.\d{6}$/;
function cell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && ISO_TIMESTAMP.test(value)) return /(period|_at)$/.test(key) ? (key === "period" ? value.slice(0, 7) : dateTime(value)) : calendarDate(value);
  if (typeof value === "string" && SIX_DECIMALS.test(value)) return /percent/.test(key) ? `${Number(value).toFixed(1)}%` : money("", value);
  if (typeof value === "string" && /^[a-z]+(_[a-z]+)+$/.test(value)) return statusLabel(value);
  if (typeof value === "string" && /^[a-z_]+$/.test(value) && /status|type/.test(key)) return statusLabel(value);
  return String(value);
}

function ReportTable({ reportKey }: { reportKey: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "report", reportKey), queryFn: () => request<{ rows: Array<Record<string, unknown>> }>(`/reports/${reportKey}`).then((r) => r.rows.map((row, index) => ({ ...row, _row: index }) as ReportRow)) });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const columns: ColumnDef<ReportRow, unknown>[] = useMemo(() => {
    const keys = Object.keys(rows[0] ?? {}).filter((key) => key !== "_row" && key !== "id");
    return keys.map((key) => ({ id: key, header: statusLabel(key), accessorFn: (row) => cell(key, row[key]) }));
  }, [rows]);
  if (query.isError) {
    if (query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to this report" description="It needs an additional permission." />;
    return <ErrorState title="Could not load this report" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  return (
    <EnterpriseDataGrid<ReportRow>
      aria-label={statusLabel(reportKey.replace(/-/g, " "))}
      columns={columns}
      data={rows}
      getRowId={(row) => String(row._row)}
      density="compact"
      state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
      loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
      emptyContent={<p className="px-4 py-8 text-sm text-text-muted">No data for this report yet.</p>}
    />
  );
}

export type ReportSpec = { key: string; label: string; description: string };
export function SalesReportScreen({ title, description, reports }: { title: string; description: string; reports: ReportSpec[] }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} />
      <Tabs>
        <TabList aria-label={`${title} reports`}>
          {reports.map((report) => (
            <Tab key={report.key} id={report.key}>
              {report.label}
            </Tab>
          ))}
        </TabList>
        {reports.map((report) => (
          <TabPanel key={report.key} id={report.key} className="flex flex-col gap-3">
            <SalesPanel title={report.label} description={report.description}>
              <ReportTable reportKey={report.key} />
            </SalesPanel>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

export const ANALYTICS_REPORTS: ReportSpec[] = [
  { key: "quotation-conversion", label: "Quotation conversion", description: "Quotations created per month and how many were accepted." },
  { key: "order-intake", label: "Order intake", description: "Orders confirmed per month and their value in base currency." },
  { key: "customer-performance", label: "Customer performance", description: "Orders and value per customer." },
];
export const STATUS_REPORTS: ReportSpec[] = [
  { key: "fulfillment", label: "Fulfilment status", description: "Open orders and how far fulfilment has got." },
  { key: "active-holds", label: "Active holds", description: "Orders currently blocked, and why." },
  { key: "billing-readiness", label: "Billing readiness", description: "Orders ready, partly or blocked from invoicing." },
  { key: "pending-approvals", label: "Pending approvals", description: "Quotations waiting for an approver." },
  { key: "expiring-quotations", label: "Expiring quotations", description: "Sent quotations about to lapse." },
];
export const PROFITABILITY_REPORTS: ReportSpec[] = [{ key: "margin", label: "Order margin", description: "Cost, margin and margin percent per order. Requires margin visibility." }];
export const ALL_REPORTS: ReportSpec[] = [...ANALYTICS_REPORTS, ...STATUS_REPORTS, ...PROFITABILITY_REPORTS];
