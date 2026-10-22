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
import { FairSharePanel } from "./FairSharePanel";

type ReportRow = Record<string, unknown> & { _row: number; _total?: boolean };

// The filters every report takes (Line-by-line audit S6), kept in the address so a filtered report can be bookmarked or sent on.
// Sales plan: and the GSTIN that issued it, and the currency.
export type ReportFilters = { from?: string; to?: string; fy?: string; customer?: string; salesperson?: string; gstin?: string; currency?: string };
const FILTER_KEYS = ["from", "to", "fy", "customer", "salesperson", "gstin", "currency"] as const;

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
const LINKS: Record<string, { idKey: string; href: (id: string, row: ReportRow) => string }> = {
  sales_order_number: {
    idKey: "sales_order_id",
    href: (id) => `/sales/orders/${id}`,
  },
  quotation_number: { idKey: "id", href: (id) => `/sales/quotations/${id}` },
  // An invoice, or the credit or debit note it is (the sales register lists all three).
  document_number: { idKey: "id", href: (id, row) => `/sales/${row.document === "Credit note" ? "credit-notes" : row.document === "Debit note" ? "debit-notes" : "invoices"}/${id}` },
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
  if (filters.gstin) search.set("registrationId", filters.gstin);
  if (filters.currency) search.set("currency", filters.currency);
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
            <Link href={link.href(String(row.original[link.idKey]), row.original)} className="font-medium text-brand hover:underline">
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

// This month and the last two, as from/to presets (Sales plan: FY and month presets).
function monthPresets() {
  const today = new Date();
  return [0, 1, 2].map((back) => {
    const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const day = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    return { value: `${day(first)}|${day(last)}`, label: first.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  });
}

function ReportFilterBar({ filters, onChange }: { filters: ReportFilters; onChange: (next: ReportFilters) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options", "report-filters", filters.customer ?? ""),
    queryFn: () => getSalesOptions(filters.customer || undefined).then((r) => r.options), staleTime: 60_000 });
  const [found, setFound] = useState<SalesOptions | null>(null);
  const known = options.data ? (found ? mergeSalesOptions(options.data, found) : options.data) : null;
  const registrations = options.data?.tax?.registrations?.filter((entry) => entry.registrationNumber) ?? [];
  const currencies = options.data?.currencies ?? [];
  const months = monthPresets();
  const period = filters.fy ?? (months.find((month) => month.value === `${filters.from}|${filters.to}`)?.value ?? "custom");
  return (
    <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
      <Select label="Period" selectedKey={period}
        options={[{ value: "custom", label: "Dates below" }, ...financialYears(), ...months]}
        onSelectionChange={(value) => {
          const chosen = String(value);
          if (chosen.includes("|")) { const [from, to] = chosen.split("|"); onChange({ ...filters, fy: undefined, from, to }); }
          else onChange({ ...filters, fy: chosen === "custom" ? undefined : chosen, from: undefined, to: undefined });
        }} />
      <TextField label="From" type="date" value={filters.from ?? ""} isDisabled={Boolean(filters.fy)} onChange={(from) => onChange({ ...filters, from: from || undefined })} />
      <TextField label="To" type="date" value={filters.to ?? ""} isDisabled={Boolean(filters.fy)} onChange={(to) => onChange({ ...filters, to: to || undefined })} />
      {known ? (
        <SalesSearchPicker kind="customers" label="Customer" value={filters.customer ?? null} known={known} placeholder="All customers"
          onPick={(id, results) => { setFound((current) => mergeSalesOptions(current ?? known, results)); onChange({ ...filters, customer: id || undefined }); }} />
      ) : <TextField label="Customer" isDisabled value="" />}
      <Select label="Salesperson" selectedKey={filters.salesperson ?? "all"}
        options={[{ value: "all", label: "All salespeople" }, ...(options.data?.users ?? []).map((user) => ({ value: user.id, label: user.full_name }))]}
        onSelectionChange={(value) => onChange({ ...filters, salesperson: value === "all" ? undefined : String(value) })} />
      {registrations.length > 1 && (
        <Select label="GSTIN" selectedKey={filters.gstin ?? "all"}
          options={[{ value: "all", label: "Every GSTIN" }, ...registrations.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.registrationNumber}` }))]}
          onSelectionChange={(value) => onChange({ ...filters, gstin: value === "all" ? undefined : String(value) })} />
      )}
      {currencies.length > 1 && (
        <Select label="Currency" selectedKey={filters.currency ?? "all"}
          options={[{ value: "all", label: "Every currency" }, ...currencies.map((entry) => ({ value: entry.code.trim(), label: entry.code.trim() }))]}
          onSelectionChange={(value) => onChange({ ...filters, currency: value === "all" ? undefined : String(value) })} />
      )}
      {FILTER_KEYS.some((key) => filters[key]) && (
        <div className="flex items-end"><Button variant="ghost" size="compact" onPress={() => onChange({})}>Clear filters</Button></div>
      )}
    </div>
  );
}

export type ReportSpec = { key: string; label: string; description: string };
export type ReportTab = { id: string; label: string; description: string; reports: ReportSpec[]; app?: string; footer?: "gst" };

// Sales › Reports (Sales plan): one page, a tab per question — Sales, Orders, Quotations, GST, Collections, Schemes & discounts — with one
// filter bar. ?tab= and ?report= choose the report (an old ?report= link finds its tab), the filters ride along in the address.
export function SalesReportsPage({ tabs }: { tabs: ReportTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspace = useWorkspaceContext();
  const wanted = params.get("report");
  const tab = tabs.find((entry) => entry.id === params.get("tab")) ?? tabs.find((entry) => entry.reports.some((report) => report.key === wanted)) ?? tabs[0];
  const report = tab.reports.find((entry) => entry.key === wanted)?.key ?? tab.reports[0]?.key;
  const filters: ReportFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) || undefined]).filter(([, value]) => value));
  const go = (nextTab: string, nextReport: string | undefined, next: ReportFilters) => {
    const search = new URLSearchParams();
    search.set("tab", nextTab);
    if (nextReport) search.set("report", nextReport);
    for (const key of FILTER_KEYS) if (next[key]) search.set(key, String(next[key]));
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };
  const accounting = workspace.accessibleModuleKeys.includes("accounting");
  // Sharing short stock between orders: with Stock, for whoever may reserve part of a line.
  const fairShare = workspace.accessibleModuleKeys.includes("stock") && (workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.order.reserve_partial"));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales Reports" description="Every Sales report in one place, with one set of filters. Every row opens its record; export to Excel or print any of them." />
      <ReportFilterBar filters={filters} onChange={(next) => go(tab.id, report, next)} />
      <Tabs selectedKey={tab.id} onSelectionChange={(key) => go(String(key), undefined, filters)}>
        <TabList aria-label="Report groups">
          {tabs.map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}
        </TabList>
        {tabs.map((entry) => (
          <TabPanel key={entry.id} id={entry.id} className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-text-secondary">{entry.description}</p>
            <div className="flex flex-wrap gap-1.5 print:hidden" role="tablist" aria-label={`${entry.label} reports`}>
              {entry.reports.map((spec) => (
                <button key={spec.key} type="button" role="tab" aria-selected={spec.key === report} onClick={() => go(entry.id, spec.key, filters)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${spec.key === report ? "border-brand bg-brand-soft text-brand-active" : "border-border text-text-secondary hover:bg-surface-muted hover:text-text"}`}>
                  {spec.label}
                </button>
              ))}
            </div>
            {entry.id === tab.id && report && (
              <Panel title={entry.reports.find((spec) => spec.key === report)?.label} description={entry.reports.find((spec) => spec.key === report)?.description}>
                <ReportTable reportKey={report} filters={filters} />
              </Panel>
            )}
            {entry.id === "orders" && entry.id === tab.id && fairShare && <FairSharePanel />}
            {entry.footer === "gst" && (
              <p className="text-sm text-text-secondary">
                These read the same documents as the GST returns. To prepare, approve and file GSTR-1, open{" "}
                <Link className="text-brand hover:underline" href={accounting ? "/accounting/gst-returns" : "/sales/gst-returns"}>GST returns</Link>; invoices still waiting for an IRN are in{" "}
                <Link className="text-brand hover:underline" href="/sales/gst-documents">E-invoices &amp; e-way bills due</Link>.
              </p>
            )}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

const spec = (key: string, label: string, description: string): ReportSpec => ({ key, label, description });
// Built here, in the client module: a server page can pass these lists on but not compute with them.
export const SALES_REPORT_TABS: ReportTab[] = [
  {
    id: "sales", label: "Sales", description: "What was billed: posted invoices and debit notes less credit notes, net of discounts, before tax.",
    reports: [
      spec("sales-register", "Sales register", "Every posted invoice, debit note and credit note with its GSTIN, place of supply and CGST, SGST and IGST."),
      spec("sales-by-period", "By period", "By month: invoices, credit notes, net sales, tax and total, per currency, with net sales in the company's currency."),
      spec("sales-by-customer", "By customer", "Net sales per customer, what is still outstanding and the last invoice date."),
      spec("sales-by-item", "By product", "Quantities (in each product's base unit) and net sales per product."),
      spec("sales-by-salesperson", "By salesperson", "Net sales, customers and what is outstanding per salesperson, in the company's currency."),
      spec("sales-by-region", "By region", "Net sales and tax by the state supplied to (place of supply)."),
      spec("sales-by-beat", "By beat", "Net sales by the customers' beat."),
    ],
  },
  {
    id: "orders", label: "Orders", description: "Where orders stand: what is still to dispatch, by order and by product, what is ready to bill, and whether dispatches kept the customer's date.",
    reports: [
      spec("order-status", "Order status", "Every confirmed or closed order with each dimension on its own: stock kept aside, dispatch, invoicing and payment."),
      spec("fulfillment", "To dispatch", "Confirmed orders with goods still to deliver, and whether the requested date has passed."),
      spec("remaining-by-product", "To dispatch, by product", "Open demand per product across confirmed orders, and how much of it is kept aside."),
      spec("billing-readiness", "To bill", "Orders ready, partly or blocked from invoicing."),
      spec("delivery-performance", "Delivery performance", "Each dispatched delivery against the date the customer asked for."),
    ],
  },
  {
    id: "quotations", label: "Quotations", description: "Quotations waiting on someone, about to lapse, and how many became orders.",
    reports: [
      spec("pending-approvals", "Waiting for approval", "Quotations waiting for an approver, and orders held for credit waiting to be released."),
      spec("expiring-quotations", "Expiring", "Sent quotations that lapse in the next 30 days."),
      spec("quotation-conversion", "Conversion", "By month: quotations sent, accepted and turned into orders, the conversion rate and the value."),
    ],
  },
  {
    id: "gst", label: "GST", description: "Outward supplies as GSTR-1 reports them, for the GSTIN chosen (the default one otherwise).", footer: "gst",
    reports: [
      spec("gst-outward", "Outward supplies", "B2B, B2C large and small, exports and notes: documents, taxable value and tax by head."),
      spec("gst-hsn", "HSN summary", "By HSN/SAC, unit and rate: quantity, taxable value and tax."),
      spec("gst-notes", "Credit & debit notes", "Every credit and debit note with the invoice it corrects."),
      spec("gst-documents", "Documents issued", "Invoices, credit notes and debit notes issued: first and last number and how many."),
    ],
  },
  {
    id: "collections", label: "Collections", description: "What customers owe, what came in and what is overdue.",
    reports: [
      spec("collections-ageing", "Ageing", "What each customer owes by age, less their credits, with the promise to pay."),
      spec("collections-by-salesperson", "Collected by salesperson", "Payments received in the period by the salesperson of the bills they settled."),
      spec("overdue-invoices", "Overdue bills", "Bills past their due date and still unpaid, oldest first."),
    ],
  },
  {
    id: "schemes", label: "Schemes & discounts", description: "What schemes and discounts gave away.",
    reports: [
      spec("scheme-cost", "Scheme cost", "Per scheme on confirmed orders: free goods at list price and the price given away."),
      spec("discounts-given", "Discounts given", "Discounts on posted invoices by salesperson, against the limit a salesperson may give."),
    ],
  },
];
