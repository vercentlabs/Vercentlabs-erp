"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button,
  EnterpriseDataGrid,
  ErrorState,
  PageHeader,
  PermissionState,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import {
  calendarDate,
  dateTime,
  money,
  statusLabel,
} from "@/features/sales/shared/format";
import { SalesSearchPicker, mergeSalesOptions } from "@/features/sales/shared/SalesSearchPicker";
import { getSalesOptions, type SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { Panel } from "@/shared/ui/Panel";

type ReportRow = Record<string, unknown> & { _row: number; _total?: boolean };

// The filters every report takes (Line-by-line audit S6), kept in the address so a filtered report can be bookmarked or sent on.
export type ReportFilters = { from?: string; to?: string; fy?: string; customer?: string; salesperson?: string };
const FILTER_KEYS = ["from", "to", "fy", "customer", "salesperson"] as const;

// --------------------------------------------------------------- reports
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const SIX_DECIMALS = /^-?\d+\.\d{6}$/;
const TWO_DECIMALS = /^-?\d+\.\d{2}$/;
// The row's currency: base_ columns are in the company's currency (rupees).
const currencyOf = (key: string, row: ReportRow) =>
  key.startsWith("base_") ? "INR" : String(row.currency ?? row.currency_code ?? "") || null;
function cell(key: string, value: unknown, row: ReportRow): string {
  if (value === null || value === undefined || value === "") return "—";
  // Plain dates arrive as a UTC timestamp of local midnight; read them in local
  // time, or 25 Sept shows as 24 Sept.
  if (typeof value === "string" && ISO_TIMESTAMP.test(value))
    return /(period|_at)$/.test(key)
      ? key === "period"
        ? localDay(value).slice(0, 7).split("-").reverse().join("-")
        : dateTime(value)
      : calendarDate(localDay(value));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDate(value);
  if (typeof value === "string" && (SIX_DECIMALS.test(value) || (TWO_DECIMALS.test(value) && key.startsWith("base_"))))
    return /percent/.test(key)
      ? `${Number(value).toFixed(1)}%`
      : money(currencyOf(key, row), value);
  if (typeof value === "string" && /^[a-z]+(_[a-z]+)+$/.test(value))
    return statusLabel(value);
  if (
    typeof value === "string" &&
    /^[a-z_]+$/.test(value) &&
    /status|type/.test(key)
  )
    return statusLabel(value);
  return String(value);
}

const localDay = (value: string) => {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};
// F060: every figure leads back to its source record.
const LINKS: Record<string, { idKey: string; href: (id: string) => string }> = {
  sales_order_number: {
    idKey: "sales_order_id",
    href: (id) => `/sales/orders/${id}`,
  },
  quotation_number: { idKey: "id", href: (id) => `/sales/quotations/${id}` },
  customer: { idKey: "customer_id", href: (id) => `/sales/customers/${id}` },
  product: { idKey: "item_id", href: (id) => `/sales/products/${id}` },
};

// Columns that add up: amounts, quantities and counts (never percentages, dates, numbers of documents' names).
const NUMERIC = (key: string, value: unknown) =>
  !/percent|_pct|date|period|_at$|number$|_id$|^id$/.test(key) &&
  (typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)));

// A totals row per currency (amounts in different currencies never add up).
function totalsOf(rows: ReportRow[], keys: string[]): ReportRow[] {
  if (rows.length < 2) return [];
  const numeric = keys.filter((key) => rows.some((row) => row[key] != null) && rows.every((row) => row[key] == null || NUMERIC(key, row[key])));
  if (!numeric.length) return [];
  const label = keys.find((key) => !numeric.includes(key)) ?? keys[0];
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const currency = String(row.currency ?? row.currency_code ?? "");
    groups.set(currency, [...(groups.get(currency) ?? []), row]);
  }
  return [...groups.entries()].map(([currency, group], index) => {
    const total: ReportRow = { _row: -1 - index, _total: true, currency: currency || undefined, currency_code: currency || undefined };
    total[label] = groups.size > 1 && currency ? `Total (${currency})` : "Total";
    for (const key of numeric) {
      const sum = group.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);
      const decimals = group.some((row) => typeof row[key] === "string" && SIX_DECIMALS.test(String(row[key]))) ? 6
        : group.some((row) => typeof row[key] === "string" && TWO_DECIMALS.test(String(row[key]))) ? 2 : 0;
      total[key] = decimals ? sum.toFixed(decimals) : String(Math.round(sum * 1000) / 1000);
    }
    return total;
  });
}

// Comma-separated values with formula injection escaped, for Excel.
function toCsv(keys: string[], rows: ReportRow[]) {
  const escape = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.map((key) => escape(statusLabel(key))).join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n");
}

function ReportTable({ reportKey, filters }: { reportKey: string; filters: ReportFilters }) {
  const workspace = useWorkspaceContext();
  const search = new URLSearchParams();
  if (filters.fy) search.set("financialYear", filters.fy);
  else {
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
  }
  if (filters.customer) search.set("customerId", filters.customer);
  if (filters.salesperson) search.set("salespersonId", filters.salesperson);
  const qs = search.toString();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "report", reportKey, qs),
    queryFn: () =>
      request<{ rows: Array<Record<string, unknown>> }>(
        `/reports/${reportKey}${qs ? `?${qs}` : ""}`,
      ).then((r) =>
        r.rows.map((row, index) => ({ ...row, _row: index }) as ReportRow),
      ),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const keys = useMemo(
    () => Object.keys(rows[0] ?? {}).filter((key) => key !== "_row" && key !== "_total" && key !== "id" && !key.endsWith("_id")),
    [rows],
  );
  const withTotals = useMemo(() => [...rows, ...totalsOf(rows, keys)], [rows, keys]);
  const columns: ColumnDef<ReportRow, unknown>[] = useMemo(() => {
    return keys.map((key) => {
      const link = LINKS[key];
      return {
        id: key,
        header: statusLabel(key.replace(/_pct$/, "_percent")),
        accessorFn: (row: ReportRow) =>
          key.endsWith("_pct") && row[key] != null
            ? `${row[key]}%`
            : cell(key, row[key], row),
        cell: ({ row }: { row: { original: ReportRow } }) => {
          const value = key.endsWith("_pct") && row.original[key] != null ? `${row.original[key]}%` : cell(key, row.original[key], row.original);
          if (row.original._total) return <span className="font-semibold">{row.original[key] == null ? "" : value}</span>;
          return link && row.original[link.idKey] ? (
            <Link href={link.href(String(row.original[link.idKey]))} className="font-medium text-brand hover:underline">
              {String(row.original[key])}
            </Link>
          ) : value;
        },
      };
    });
  }, [keys]);
  const download = () => {
    const blob = new Blob([`﻿${toCsv(keys, rows)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${reportKey}${filters.fy ? `-FY${filters.fy}` : filters.from || filters.to ? `-${filters.from ?? ""}-to-${filters.to ?? ""}` : ""}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  if (query.isError) {
    if (query.error instanceof SalesApiError && query.error.status === 403)
      return (
        <PermissionState
          title="You don't have access to this report"
          description="It needs an additional permission."
        />
      );
    return (
      <ErrorState
        title="Could not load this report"
        description={query.error instanceof SalesApiError && query.error.status === 400 ? query.error.message : undefined}
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="secondary" size="compact" isDisabled={!rows.length} onPress={download}>Export to Excel (CSV)</Button>
        <Button variant="ghost" size="compact" isDisabled={!rows.length} onPress={() => window.print()}>Print</Button>
      </div>
      <EnterpriseDataGrid<ReportRow>
        aria-label={statusLabel(reportKey.replace(/-/g, " "))}
        columns={columns}
        data={withTotals}
        getRowId={(row) => String(row._row)}
        density="compact"
        state={
          query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"
        }
        loadingContent={
          <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>
        }
        emptyContent={
          <p className="px-4 py-8 text-sm text-text-muted">
            Nothing for these filters.
          </p>
        }
      />
      {rows.length >= 500 && <p className="text-xs text-text-muted">Showing the first 500 rows. Narrow the dates or choose a customer to see the rest.</p>}
    </div>
  );
}

// The current financial year (April to March) and the three before it.
function financialYears() {
  const today = new Date();
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return [0, 1, 2, 3].map((back) => {
    const year = start - back;
    return { value: String(year), label: `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}` };
  });
}

function ReportFilterBar({ filters, onChange }: { filters: ReportFilters; onChange: (next: ReportFilters) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options", "report-filters", filters.customer ?? ""),
    queryFn: () => getSalesOptions(filters.customer || undefined).then((r) => r.options), staleTime: 60_000 });
  const [found, setFound] = useState<SalesOptions | null>(null);
  const known = options.data ? (found ? mergeSalesOptions(options.data, found) : options.data) : null;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
      <Select label="Financial year" selectedKey={filters.fy ?? "custom"}
        options={[{ value: "custom", label: "Dates below" }, ...financialYears()]}
        onSelectionChange={(value) => onChange({ ...filters, fy: value === "custom" ? undefined : String(value), from: undefined, to: undefined })} />
      <TextField label="From" type="date" value={filters.from ?? ""} isDisabled={Boolean(filters.fy)} onChange={(from) => onChange({ ...filters, from: from || undefined })} />
      <TextField label="To" type="date" value={filters.to ?? ""} isDisabled={Boolean(filters.fy)} onChange={(to) => onChange({ ...filters, to: to || undefined })} />
      {known ? (
        <SalesSearchPicker kind="customers" label="Customer" value={filters.customer ?? null} known={known} placeholder="All customers"
          onPick={(id, results) => { setFound((current) => mergeSalesOptions(current ?? known, results)); onChange({ ...filters, customer: id || undefined }); }} />
      ) : <TextField label="Customer" isDisabled value="" />}
      <Select label="Salesperson" selectedKey={filters.salesperson ?? "all"}
        options={[{ value: "all", label: "All salespeople" }, ...(options.data?.users ?? []).map((user) => ({ value: user.id, label: user.full_name }))]}
        onSelectionChange={(value) => onChange({ ...filters, salesperson: value === "all" ? undefined : String(value) })} />
      {(filters.fy || filters.from || filters.to || filters.customer || filters.salesperson) && (
        <div className="sm:col-span-2 lg:col-span-5"><Button variant="ghost" size="compact" onPress={() => onChange({})}>Clear filters</Button></div>
      )}
    </div>
  );
}

export type ReportSpec = { key: string; label: string; description: string };
// ?report=<key> selects the report (the sidebar links straight to one); the filters ride along in the address too.
export function SalesReportScreen({
  title,
  description,
  reports,
}: {
  title: string;
  description: string;
  reports: ReportSpec[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = reports.find((report) => report.key === params.get("report"))?.key ?? reports[0]?.key;
  const filters: ReportFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) || undefined]).filter(([, value]) => value));
  const go = (report: string | undefined, next: ReportFilters) => {
    const search = new URLSearchParams();
    if (report) search.set("report", report);
    for (const key of FILTER_KEYS) if (next[key]) search.set(key, String(next[key]));
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} />
      <ReportFilterBar filters={filters} onChange={(next) => go(selected, next)} />
      <Tabs selectedKey={selected} onSelectionChange={(key) => go(String(key), filters)}>
        <TabList aria-label={`${title} reports`}>
          {reports.map((report) => (
            <Tab key={report.key} id={report.key}>
              {report.label}
            </Tab>
          ))}
        </TabList>
        {reports.map((report) => (
          <TabPanel
            key={report.key}
            id={report.key}
            className="flex flex-col gap-3"
          >
            <Panel title={report.label} description={report.description}>
              <ReportTable reportKey={report.key} filters={filters} />
            </Panel>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

export const SALES_REPORTS: ReportSpec[] = [
  {
    key: "sales-by-period",
    label: "Sales by period",
    description: "Posted invoices less credit notes, by month: invoices, credit notes, net sales before tax, tax and total, per currency.",
  },
  {
    key: "sales-by-customer",
    label: "Sales by customer",
    description: "Net sales per customer from posted invoices less credit notes, with what is still outstanding and the last invoice date.",
  },
  {
    key: "sales-by-item",
    label: "Sales by item",
    description: "Quantities (in each product's base unit) and net sales per product from posted invoice lines less credit-note lines.",
  },
  {
    key: "order-status",
    label: "Order status",
    description:
      "Every confirmed or closed order with each dimension on its own: reservation, fulfillment, invoicing and payment, and what needs attention. Select an order to open it.",
  },
  {
    key: "fulfillment",
    label: "Remaining by order",
    description: "Confirmed orders with goods still to deliver: ordered, delivered, cancelled and remaining, and whether the requested date has passed.",
  },
  {
    key: "remaining-by-product",
    label: "Remaining by product",
    description: "Open delivery demand per product across confirmed orders, and how much of it is reserved.",
  },
  {
    key: "delivery-performance",
    label: "Delivery performance",
    description: "Each dispatched delivery against the date the customer requested.",
  },
  {
    key: "billing-readiness",
    label: "Billing readiness",
    description: "Orders ready, partly or blocked from invoicing.",
  },
  {
    key: "pending-approvals",
    label: "Pending approvals",
    description: "Quotations waiting for an approver.",
  },
  {
    key: "expiring-quotations",
    label: "Expiring quotations",
    description: "Sent quotations about to lapse.",
  },
];

// Sales › Sell › Pending Orders (Sales audit): the one place for "where is my order" — every open order, what is left to dispatch by order
// and by product, what is ready to bill, and how dispatches kept to the customer's date — in plain words.
const PENDING_LABELS: Record<string, string> = {
  "order-status": "All open orders", fulfillment: "To dispatch", "remaining-by-product": "To dispatch, by product", "billing-readiness": "To bill",
  "delivery-performance": "Dispatched on time?",
};
export const PENDING_ORDER_REPORTS: ReportSpec[] = ["order-status", "fulfillment", "remaining-by-product", "billing-readiness", "delivery-performance"]
  .map((key) => SALES_REPORTS.find((report) => report.key === key))
  .filter((report): report is ReportSpec => Boolean(report))
  .map((report) => ({ ...report, label: PENDING_LABELS[report.key] ?? report.label }));
// The older pages (Order Fulfillment, Order Status) open Pending Orders on their tab.
// Sales › Planning & Control › Order Fulfillment: what is left to deliver and invoice.
export const FULFILLMENT_REPORTS: ReportSpec[] = SALES_REPORTS.filter((report) => ["fulfillment", "remaining-by-product", "billing-readiness", "delivery-performance"].includes(report.key));
// Sales › Inquiries › Order Status.
export const ORDER_STATUS_REPORTS: ReportSpec[] = SALES_REPORTS.filter((report) => report.key === "order-status");
// Sales › Reports: the sales figures and the quotations waiting on someone (where orders stand is in Pending Orders). Built here, in the
// client module: a server page can pass these lists on but not compute with them.
export const SALES_FIGURE_REPORTS: ReportSpec[] = SALES_REPORTS.filter((report) => !PENDING_ORDER_REPORTS.some((pending) => pending.key === report.key));
