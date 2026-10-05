"use client";

// Sales → Sales Orders: every order the caller may see (own, team or all), by
// view (Draft, Confirmed, Awaiting Fulfillment, Not Invoiced …), searchable by
// order number, customer, customer number, customer PO, quotation, contact
// and product. The three statuses and the totals come from the server.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, TextField, buttonVariants,
  type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { listSalesOrders, salesOrderExportUrl, type OrderFilters, type SalesOrderRow } from "../api/orders-api";
import { ConfirmationStatusBadge, FulfillmentStatusBadge, InvoicingStatusBadge, OrderStatusBadge, OverdueDeliveryBadge } from "../components/OrderStatusBadges";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "status" | "confirmation" | "fulfillment" | "invoicing" | "partyId" | "ownerUserId" | "warehouseId" | "source" | "dateFrom" | "dateTo" | "deliveryFrom" | "deliveryTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = {
  status: ANY, confirmation: ANY, fulfillment: ANY, invoicing: ANY, partyId: ANY, ownerUserId: ANY, warehouseId: ANY, source: ANY, dateFrom: "", dateTo: "", deliveryFrom: "", deliveryTo: "",
};
const NAMES: Record<FilterKey, string> = {
  status: "Order status", confirmation: "Confirmation", fulfillment: "Fulfillment", invoicing: "Invoicing", partyId: "Customer", ownerUserId: "Salesperson", warehouseId: "Warehouse", source: "Source",
  dateFrom: "Ordered from", dateTo: "Ordered to", deliveryFrom: "Delivery from", deliveryTo: "Delivery to",
};
const STATUSES = [{ value: "draft", label: "Draft" }, { value: "confirmed", label: "Confirmed" }, { value: "cancelled", label: "Cancelled" }, { value: "closed", label: "Closed" }];
const FULFILLMENTS = [
  { value: "not_delivered", label: "Not delivered" }, { value: "partially_delivered", label: "Partially delivered" }, { value: "delivered", label: "Delivered" },
];
const CONFIRMATIONS = [{ value: "not_sent", label: "Not sent" }, { value: "sent", label: "Sent" }, { value: "acknowledged", label: "Acknowledged" }];
const INVOICINGS = [{ value: "not_invoiced", label: "Not invoiced" }, { value: "partially_invoiced", label: "Partially invoiced" }, { value: "fully_invoiced", label: "Fully invoiced" }];
const SOURCES = [{ value: "quotation", label: "From a quotation" }, { value: "direct", label: "Direct order" }];
const DEFAULT_VIEWS = [{ key: "all", label: "All Orders" }];

export function SalesOrdersScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setViewState] = useState(params.get("view") || "all");
  const [search, setSearch] = useState("");
  const [submitted, setSubmittedState] = useState("");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "date", desc: true }]);
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
  const listFilters: OrderFilters = useMemo(() => ({
    view, search: submitted || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "orders", listFilters, pageIndex),
    queryFn: () => listSalesOrders({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const can = listQuery.data?.capabilities;
  // Orders without a quotation can be switched off in Sales settings.
  const canCreate = Boolean(can?.create) && options?.settings?.allow_direct_orders !== false;

  const columns = useMemo<ColumnDef<SalesOrderRow, unknown>[]>(() => [
    { id: "number", accessorKey: "sales_order_number", header: "Sales order", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.sales_order_number}</span> },
    { id: "date", accessorKey: "order_date", header: "Order date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.order_date)}</span> },
    {
      id: "customer", accessorKey: "customer_name", header: "Customer",
      cell: ({ row }) => <span className="flex min-w-40 flex-col"><span>{row.original.customer_name ?? ""}</span>{row.original.customer_number && <span className="text-xs text-text-muted tabular-nums">{row.original.customer_number}</span>}</span>,
    },
    { id: "po", header: "Customer PO", enableSorting: false, cell: ({ row }) => row.original.customer_po_number ?? "" },
    { id: "quotation", header: "Quotation", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.source_quotation_number ?? ""}</span> },
    { id: "owner", header: "Salesperson", enableSorting: false, cell: ({ row }) => row.original.owner_name ?? "" },
    { id: "requestedDelivery", accessorKey: "requested_delivery_date", header: "Requested delivery", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.requested_delivery_date ? calendarDate(row.original.requested_delivery_date) : ""}</span> },
    { id: "total", accessorKey: "grand_total", header: "Total", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.currency_code, row.original.grand_total)}</span> },
    { id: "status", accessorKey: "lifecycle_status", header: "Order status", cell: ({ row }) => <OrderStatusBadge status={row.original.status} label={row.original.statusLabel} /> },
    { id: "confirmation", header: "Confirmation", enableSorting: false, cell: ({ row }) => row.original.confirmation === "none" ? "" : <ConfirmationStatusBadge status={row.original.confirmation} label={row.original.confirmationLabel} /> },
    {
      id: "fulfillment", header: "Fulfillment", enableSorting: false,
      cell: ({ row }) => row.original.status === "draft" ? "" : (
        <span className="flex flex-wrap gap-1"><FulfillmentStatusBadge status={row.original.fulfillment} label={row.original.fulfillmentLabel} />{row.original.delivery_overdue && <OverdueDeliveryBadge />}</span>
      ),
    },
    { id: "invoicing", header: "Invoicing", enableSorting: false, cell: ({ row }) => ["draft", "cancelled"].includes(row.original.status) ? "" : <InvoicingStatusBadge status={row.original.invoicing} label={row.original.invoicingLabel} /> },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to sales orders" description="Ask an administrator for the View sales orders permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    status: STATUSES, confirmation: CONFIRMATIONS, fulfillment: FULFILLMENTS, invoicing: INVOICINGS, source: SOURCES,
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
      header={{
        title: "Sales Orders",
        description: "Confirmed customer orders: what was agreed, and how much of it has been reserved, delivered and invoiced.",
        primaryAction: canCreate ? <LinkButton href="/sales/orders/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New Sales Order</LinkButton> : undefined,
        secondaryActions: can?.export ? <a className={buttonVariants({ variant: "outline" })} href={salesOrderExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a> : undefined,
      }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search sales orders" placeholder="Search order, customer, customer PO, quotation, contact or product" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("status", "Any order status")}
            {select("confirmation", "Any confirmation")}
            {select("fulfillment", "Any fulfillment")}
            {select("invoicing", "Any invoicing")}
            {select("partyId", "Any customer")}
            {select("ownerUserId", "Any salesperson")}
            {select("warehouseId", "Any warehouse")}
            {select("source", "Any source")}
            {date("dateFrom")}
            {date("dateTo")}
            {date("deliveryFrom")}
            {date("deliveryTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<SalesOrderRow>
        aria-label="Sales orders"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading sales orders" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load sales orders" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No sales orders yet" description="Create an order here, or from an accepted quotation."
          action={canCreate ? { label: "New Sales Order", onPress: () => router.push("/sales/orders/new") } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/orders/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.sales_order_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, calendarDate(row.order_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><OrderStatusBadge status={row.status} label={row.statusLabel} /><span className="text-sm tabular-nums">{money(row.currency_code, row.grand_total)}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
