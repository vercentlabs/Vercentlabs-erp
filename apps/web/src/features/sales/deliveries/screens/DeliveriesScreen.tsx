"use client";

// Sales → Deliveries: every delivery the caller may see (those of the orders
// they see, or all of them for the warehouse), by view (Draft, Ready to
// Dispatch, In Transit, Delivered, Due Today, Overdue …), searchable by
// delivery and order number, customer, customer PO, product, carrier and
// tracking number. Deliveries are created from a confirmed sales order.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, TextField, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate } from "@/features/sales/shared/format";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { listDeliveries, type DeliveryFilters, type DeliveryRow } from "../api/deliveries-api";
import { DeliveryStatusBadge } from "../components/DeliveryStatusBadge";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "partyId" | "warehouseId" | "ownerUserId" | "dispatchFrom" | "dispatchTo" | "expectedFrom" | "expectedTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { partyId: ANY, warehouseId: ANY, ownerUserId: ANY, dispatchFrom: "", dispatchTo: "", expectedFrom: "", expectedTo: "" };
const NAMES: Record<FilterKey, string> = {
  partyId: "Customer", warehouseId: "Warehouse", ownerUserId: "Salesperson", dispatchFrom: "Dispatched from", dispatchTo: "Dispatched to", expectedFrom: "Expected from", expectedTo: "Expected to",
};
const DEFAULT_VIEWS = [{ key: "all", label: "All Deliveries" }];
const quantity = (value: number | string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function DeliveriesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setViewState] = useState(params.get("view") || "all");
  const [search, setSearch] = useState("");
  const [submitted, setSubmittedState] = useState("");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "created", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const setView = (next: string) => { setViewState(next); setPageIndex(0); };
  const setFilters = (next: Filters) => { setFiltersState(next); setPageIndex(0); };
  const setSorting = (next: SortingState) => { setSortingState(next); setPageIndex(0); };
  const setSubmitted = (next: string) => { if (next !== submitted) { setSubmittedState(next); setPageIndex(0); } };
  useEffect(() => {
    const timer = setTimeout(() => setSubmitted(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options), staleTime: 60_000 });
  const options = optionsQuery.data;
  const listFilters: DeliveryFilters = useMemo(() => ({
    view, search: submitted || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "deliveries", listFilters, pageIndex),
    queryFn: () => listDeliveries({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<DeliveryRow, unknown>[]>(() => [
    { id: "number", accessorKey: "delivery_number", header: "Delivery", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.delivery_number}</span> },
    { id: "order", header: "Sales order", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.sales_order_number}</span> },
    { id: "customer", accessorKey: "customer_name", header: "Customer", cell: ({ row }) => <span className="min-w-40">{row.original.customer_name ?? ""}</span> },
    { id: "shipTo", header: "Ship to", enableSorting: false, cell: ({ row }) => [row.original.ship_to_label, row.original.ship_to_city].filter(Boolean).join(", ") },
    { id: "warehouse", header: "Warehouse", enableSorting: false, cell: ({ row }) => row.original.warehouse_name ?? "" },
    { id: "status", accessorKey: "delivery_status", header: "Status", cell: ({ row }) => <DeliveryStatusBadge status={row.original.status} label={row.original.statusLabel} /> },
    { id: "dispatch", accessorKey: "dispatch_date", header: "Dispatched", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.dispatch_date ? calendarDate(row.original.dispatch_date) : ""}</span> },
    { id: "expected", accessorKey: "expected_delivery_date", header: "Expected", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.expected_delivery_date ? calendarDate(row.original.expected_delivery_date) : ""}</span> },
    { id: "carrier", header: "Carrier / tracking", enableSorting: false, cell: ({ row }) => [row.original.carrier, row.original.tracking_number].filter(Boolean).join(" · ") },
    { id: "lines", header: "Items", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{quantity(row.original.total_quantity)} of {quantity(row.original.ordered_quantity)} · {row.original.line_count} line(s)</span> },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to deliveries" description="Ask an administrator for the View deliveries permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    partyId: (options?.parties ?? []).filter((party) => ["customer", "both"].includes(party.party_type)).map((party) => ({ value: party.id, label: party.display_name })),
    ownerUserId: (options?.users ?? []).map((user) => ({ value: user.id, label: user.full_name })),
    warehouseId: (options?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
  };
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const date = (key: FilterKey) => (
    <TextField key={key} aria-label={NAMES[key]} type="date" size="compact" value={filters[key]} onChange={(value) => setFilters({ ...filters, [key]: value })}
      className="w-40" placeholder={NAMES[key]} />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] && filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all";
  const views = listQuery.data?.views ?? DEFAULT_VIEWS;

  return (
    <EnterpriseListPage
      header={{ title: "Deliveries", description: "What leaves the warehouse against confirmed sales orders: prepared, dispatched and delivered to the customer." }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search deliveries" placeholder="Search delivery, order, customer, customer PO, product, carrier or tracking number" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("partyId", "Any customer")}
            {select("warehouseId", "Any warehouse")}
            {select("ownerUserId", "Any salesperson")}
            {date("dispatchFrom")}
            {date("dispatchTo")}
            {date("expectedFrom")}
            {date("expectedTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<DeliveryRow>
        aria-label="Deliveries"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading deliveries" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load deliveries" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No deliveries yet" description="Create a delivery from a confirmed sales order."
          action={{ label: "Sales Orders", onPress: () => router.push("/sales/orders?view=awaiting_delivery") }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/deliveries/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.delivery_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, row.sales_order_number, row.dispatch_date && calendarDate(row.dispatch_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><DeliveryStatusBadge status={row.status} label={row.statusLabel} />{row.carrier && <span className="text-sm">{row.carrier}</span>}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
