"use client";

// Inventory Reports: Stock Balance, Stock Valuation and Stock Movement — one tab each, filters kept in the URL (?report=, ?asOf=, ?from=, ?to=,
// ?warehouseId=, ?search=, ?grain=), every row opening the page that owns it, and CSV / XLSX downloads of what is shown.
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, ErrorState, NoResultsState, PageHeader, PermissionState, SearchField, Select, Tab, TabList, Tabs, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { SalesApiError } from "@/features/sales/shared/http";
import { formatDate, formatMoney } from "@/shared/format/human";
import { ListToolbar, filterBarOf, optionLabel, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Column = { key: string; label: string; type: "text" | "number" | "money" | "date" };
type Row = Record<string, unknown> & { href: string };
type Report = { key: string; title: string; description: string; columns: Column[]; rows: Row[]; note: string; totals?: { quantity?: number | null; value?: number | null } };
type Catalog = { reports: Array<{ key: string; title: string; description: string }> };

const ANY = "__any";
const FILTERS = ["asOf", "from", "to", "warehouseId", "search", "grain"] as const;

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}

const cell = (column: Column, value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (column.type === "money") return formatMoney(null, Number(value).toFixed(2));
  if (column.type === "number") return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 });
  return String(value);
};

export function InventoryReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const catalog = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "reports"), queryFn: () => read<Catalog>("/api/inventory/reports") });
  const options = useInvOptions();
  const reports = catalog.data?.reports ?? [];
  const key = reports.find((entry) => entry.key === params.get("report"))?.key ?? reports[0]?.key;
  const filters = Object.fromEntries(FILTERS.flatMap((name) => (params.get(name) ? [[name, params.get(name) as string]] : []))) as Partial<Record<(typeof FILTERS)[number], string>>;
  const query = new URLSearchParams(filters).toString();
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "report", key ?? "", query), queryFn: () => read<Report>(`/api/inventory/reports/${key}${query ? `?${query}` : ""}`),
    enabled: Boolean(key), placeholderData: (previous) => previous });
  const data = report.data && report.data.key === key ? report.data : undefined;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const paged = usePagedRows(rows, { initialSorting: [] });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => (data?.columns ?? []).map((column, position) => ({
    id: column.key, accessorFn: (row: Row) => row[column.key], header: column.label,
    cell: ({ row }) => (position === 0
      ? <span className="font-medium text-text">{cell(column, row.original[column.key])}</span>
      : <span className={column.type === "number" || column.type === "money" ? "tabular-nums" : undefined}>{cell(column, row.original[column.key])}</span>),
  })), [data]);
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (!value || value === ANY) next.delete(name);
      else next.set(name, value);
    }
    const text = next.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
  const download = (format: "csv" | "xlsx") => `/api/inventory/reports/${key}?${new URLSearchParams({ ...filters, format }).toString()}`;
  const filterBar = filterBarOf([
    { id: "warehouse", active: Boolean(filters.warehouseId), label: `Warehouse: ${optionLabel(options.data?.warehouses, filters.warehouseId ?? "", "code")}`, clear: () => set({ warehouseId: undefined }) },
    { id: "grain", active: filters.grain === "item", label: "By item (all warehouses)", clear: () => set({ grain: undefined }) },
    { id: "asOf", active: Boolean(filters.asOf) && key !== "stock-movement", label: `As of ${formatDate(filters.asOf ?? "")}`, clear: () => set({ asOf: undefined }) },
    { id: "from", active: Boolean(filters.from) && key === "stock-movement", label: `From ${formatDate(filters.from ?? "")}`, clear: () => set({ from: undefined }) },
    { id: "to", active: Boolean(filters.to) && key === "stock-movement", label: `To ${formatDate(filters.to ?? "")}`, clear: () => set({ to: undefined }) },
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory Reports" description="Point-in-time and period statements read from the stock ledger, the balances and the valuation entries."
        secondaryActions={key && data ? (
          <>
            <a className={buttonVariants({ variant: "outline" })} href={download("csv")} download><Download className="size-4" aria-hidden="true" />CSV</a>
            <a className={buttonVariants({ variant: "outline" })} href={download("xlsx")} download><Download className="size-4" aria-hidden="true" />Excel</a>
          </>
        ) : undefined} />
      {catalog.isLoading && <LoadingState label="Loading reports" />}
      {catalog.isError && <ErrorState title="Could not load reports" description={catalog.error instanceof Error ? catalog.error.message : undefined} action={{ label: "Retry", onPress: () => catalog.refetch() }} />}
      {catalog.data && !reports.length && <PermissionState title="No reports available" description="Your role does not include any Inventory report." />}
      {key && (
        <>
          <Tabs selectedKey={key} onSelectionChange={(selected) => set({ report: String(selected) })}>
            <TabList aria-label="Inventory reports">{reports.map((entry) => <Tab key={entry.key} id={entry.key}>{entry.title}</Tab>)}</TabList>
          </Tabs>
          <p className="text-sm text-text-secondary">{reports.find((entry) => entry.key === key)?.description}</p>
          <ListToolbar
            actionBar={{
              start: (
                <>
                  <SearchField aria-label="Search" placeholder="SKU, item or barcode" className="w-full sm:w-80" value={filters.search ?? ""} onChange={(value) => set({ search: value })} />
                  <Select aria-label="Warehouse" size="compact" selectedKey={filters.warehouseId ?? ANY} onSelectionChange={(value) => set({ warehouseId: String(value) })}
                    options={[{ value: ANY, label: "All warehouses" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
                  <Select aria-label="Group by" size="compact" selectedKey={filters.grain ?? "warehouse"} onSelectionChange={(value) => set({ grain: value === "item" ? "item" : undefined })}
                    options={[{ value: "warehouse", label: "Item and warehouse" }, { value: "item", label: "Item (all warehouses)" }]} />
                  {key === "stock-movement" ? (
                    <>
                      <TextField aria-label="From" type="date" value={filters.from ?? ""} onChange={(value) => set({ from: value })} />
                      <TextField aria-label="To" type="date" value={filters.to ?? ""} onChange={(value) => set({ to: value })} />
                    </>
                  ) : <TextField aria-label="As of (blank is now)" type="date" value={filters.asOf ?? ""} onChange={(value) => set({ asOf: value })} />}
                </>
              ),
            }}
            filterBar={filterBar}
          />
          {data && <p className="text-xs text-text-muted">{data.note}{data.totals?.value !== undefined && data.totals.value !== null ? ` Total value ${formatMoney(null, Number(data.totals.value).toFixed(2))}.` : ""}</p>}
          {report.isError && report.error instanceof SalesApiError && report.error.status === 403
            ? <PermissionState title="You don't have access to this report" description="Ask an administrator for the permission this report needs." />
            : (
              <EnterpriseDataGrid<Row>
                aria-label={data?.title ?? "Report"}
                columns={columns}
                data={paged.pageRows}
                getRowId={(row) => `${row.href}:${String(row.warehouse ?? "")}:${String(row.sku ?? "")}`}
                state={report.isLoading || !data ? (report.isError ? "error" : "loading") : rows.length === 0 ? (filterBar || filters.search ? "no-results" : "empty") : "ready"}
                loadingContent={<LoadingState label="Running the report" rows={8} />}
                errorContent={<ErrorState title="Could not run the report" description={report.error instanceof Error ? report.error.message : undefined} action={{ label: "Retry", onPress: () => report.refetch() }} />}
                emptyContent={<EmptyState title="Nothing to report" description="No stock in this report yet." />}
                noResultsContent={<NoResultsState title="Nothing matches" description="Try another warehouse, date or search." />}
                {...paged.grid}
                onRowClick={(row) => router.push(row.href)}
              />
            )}
        </>
      )}
    </div>
  );
}
