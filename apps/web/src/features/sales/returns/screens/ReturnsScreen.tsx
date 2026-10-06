"use client";

// Sales → Returns: goods that came back against deliveries, by view (Draft,
// Received, Awaiting Credit Note, Cancelled), searchable by return, order,
// delivery and invoice number, customer, customer PO and product. Returns are
// created from a dispatched delivery.
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

import { listReturns, type ReturnRow } from "../api/returns-api";
import { ReturnCreditBadge, ReturnStatusBadge } from "../components/ReturnStatusBadge";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "partyId" | "warehouseId" | "reasonCode" | "credited" | "dateFrom" | "dateTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { partyId: ANY, warehouseId: ANY, reasonCode: ANY, credited: ANY, dateFrom: "", dateTo: "" };
const NAMES: Record<FilterKey, string> = { partyId: "Customer", warehouseId: "Warehouse", reasonCode: "Reason", credited: "Credit note", dateFrom: "Returned from", dateTo: "Returned to" };
const quantity = (value: number | string) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function ReturnsScreen() {
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
  const listFilters = useMemo(() => ({
    view, search: submitted || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "returns", listFilters, pageIndex),
    queryFn: () => listReturns({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<ReturnRow, unknown>[]>(() => [
    { id: "number", accessorKey: "return_number", header: "Return", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.return_number}</span> },
    { id: "customer", accessorKey: "customer_name", header: "Customer", cell: ({ row }) => row.original.customer_name ?? "" },
    { id: "date", accessorKey: "return_date", header: "Returned", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.return_date)}</span> },
    { id: "order", header: "Sales order", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.sales_order_number}</span> },
    { id: "delivery", header: "Delivery", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.delivery_number}</span> },
    { id: "invoice", header: "Invoice", enableSorting: false, cell: ({ row }) => row.original.invoice_numbers ?? "" },
    { id: "warehouse", header: "Warehouse", enableSorting: false, cell: ({ row }) => row.original.warehouse_name ?? "" },
    { id: "quantity", header: "Items", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{quantity(row.original.total_quantity)} · {row.original.line_count} line(s)</span> },
    { id: "reason", header: "Reason", enableSorting: false, cell: ({ row }) => row.original.reasonLabel },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <span className="flex flex-wrap gap-1"><ReturnStatusBadge status={row.original.status} label={row.original.statusLabel} /><ReturnCreditBadge status={row.original.creditStatus} label={row.original.creditStatusLabel} /></span> },
    { id: "credit", header: "Credit note", enableSorting: false, cell: ({ row }) => row.original.credit_note_numbers ?? "" },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to sales returns" description="Ask an administrator for the View sales returns permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    partyId: (options?.parties ?? []).filter((party) => ["customer", "both"].includes(party.party_type)).map((party) => ({ value: party.id, label: party.display_name })),
    warehouseId: (options?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    reasonCode: (listQuery.data?.reasons ?? []).map((reason) => ({ value: reason.code, label: reason.label })),
    credited: [{ value: "yes", label: "Credit note created" }, { value: "no", label: "No credit note" }],
  };
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const date = (key: FilterKey) => (
    <TextField key={key} aria-label={NAMES[key]} type="date" size="compact" value={filters[key]} onChange={(value) => setFilters({ ...filters, [key]: value })} className="w-40" placeholder={NAMES[key]} />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] && filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all";
  const views = listQuery.data?.views ?? [{ key: "all", label: "All Returns" }];

  return (
    <EnterpriseListPage
      header={{ title: "Returns", description: "Goods that came back from customers against deliveries: drafts to receive, and returns still owing a credit note." }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search returns" placeholder="Search return, order, delivery, invoice, customer, customer PO or product" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("partyId", "Any customer")}
            {select("warehouseId", "Any warehouse")}
            {select("reasonCode", "Any reason")}
            {select("credited", "Any credit note")}
            {date("dateFrom")}
            {date("dateTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<ReturnRow>
        aria-label="Sales returns"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading returns" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load returns" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No returns yet" description="Create a return from a dispatched delivery." action={{ label: "Deliveries", onPress: () => router.push("/sales/deliveries?view=delivered") }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/returns/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.return_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, row.delivery_number, calendarDate(row.return_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><ReturnStatusBadge status={row.status} label={row.statusLabel} /><span className="text-sm">{row.reasonLabel}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
