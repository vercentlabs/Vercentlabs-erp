"use client";

// Procurement → Purchase Orders: every order the caller may see, by view
// (Draft, Awaiting Receipt, Overdue Receipt, Ready to Close …), searchable by
// PO number, supplier, supplier reference, quotation, product, goods receipt
// and bill. Receiving and billing come from the documents, never typed in.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, TextField, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useListState } from "@/features/procurement/shared/navigation";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, money } from "@/features/procurement/shared/format";

import { getPurchaseOrderOptions, listPurchaseOrders, PurchaseApiError, type PurchaseOrderRow } from "../api/purchase-orders-api";
import { BillingBadge, LifecycleBadge, OverdueBadge, ReceiptBadge } from "../components/PurchaseOrderBadges";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "status" | "supplierId" | "buyerId" | "warehouseId" | "receiptStatus" | "billingStatus" | "overdue" | "dateFrom" | "dateTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { status: ANY, supplierId: ANY, buyerId: ANY, warehouseId: ANY, receiptStatus: ANY, billingStatus: ANY, overdue: ANY, dateFrom: "", dateTo: "" };
const NAMES: Record<FilterKey, string> = {
  status: "PO status", supplierId: "Supplier", buyerId: "Buyer", warehouseId: "Warehouse", receiptStatus: "Receiving", billingStatus: "Billing", overdue: "Delivery",
  dateFrom: "Ordered from", dateTo: "Ordered to",
};

export function PurchaseOrdersScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL; the search, filters and page are remembered for this browser tab (back from an order, the list is as it was).
  const list = useListState("purchase-orders", { view: "all", filters: { ...NO_FILTERS, page: "0" } });
  const { view, search, setSearch } = list;
  const { page, ...filters } = list.filters;
  const pageIndex = Number(page) || 0;
  const setPageIndex = (next: number) => list.setFilter("page", String(next));
  const [submitted, setSubmitted] = useState(search.trim());
  const setView = (next: string) => { list.setView(next); setPageIndex(0); };
  const setFilters = (next: Filters) => list.setFilters(() => ({ ...next, page: "0" }));
  useEffect(() => {
    const timer = setTimeout(() => { const next = search.trim(); if (next !== submitted) { setSubmitted(next); setPageIndex(0); } }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page resets only when the search itself changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const listFilters = useMemo(() => ({
    view, search: submitted || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
  }), [view, submitted, filters]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "purchase-orders", listFilters, pageIndex),
    queryFn: () => listPurchaseOrders({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const canCreate = Boolean(options?.capabilities.create);

  const columns = useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(() => [
    { id: "number", header: "PO number", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.purchaseOrderNumber}{row.original.versionNumber > 1 ? ` · v${row.original.versionNumber}` : ""}</span> },
    {
      id: "supplier", header: "Supplier",
      cell: ({ row }) => <span className="flex min-w-40 flex-col"><span>{row.original.supplierName}</span><span className="text-xs tabular-nums text-text-muted">{row.original.supplierNumber}</span></span>,
    },
    { id: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.orderDate)}</span> },
    {
      id: "expected", header: "Expected delivery",
      cell: ({ row }) => <span className="flex flex-col gap-0.5 whitespace-nowrap">{row.original.expectedDeliveryDate ? calendarDate(row.original.expectedDeliveryDate) : ""}{row.original.overdueReceipt && <OverdueBadge />}</span>,
    },
    { id: "amount", header: "Amount", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.currencyCode, row.original.grandTotal)}</span> },
    { id: "currency", header: "Currency", cell: ({ row }) => row.original.currencyCode },
    { id: "buyer", header: "Buyer", cell: ({ row }) => row.original.buyerName ?? "" },
    { id: "status", header: "PO status", cell: ({ row }) => <LifecycleBadge status={row.original.status} amending={row.original.status === "draft" && row.original.versionNumber > 0} /> },
    { id: "receipt", header: "Receiving", cell: ({ row }) => (["draft", "cancelled"].includes(row.original.status) ? "" : <ReceiptBadge status={row.original.receiptStatus} />) },
    {
      id: "billing", header: "Billing",
      cell: ({ row }) => (["draft", "cancelled"].includes(row.original.status) ? "" : (
        <span className="flex flex-col gap-0.5"><BillingBadge status={row.original.billingStatus} />{row.original.readyToClose && <span className="text-xs text-text-muted">Ready to close</span>}</span>
      )),
    },
  ], []);

  if (listQuery.isError && listQuery.error instanceof PurchaseApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to purchase orders" description="Ask an administrator for the View purchase orders permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    status: ["draft", "confirmed", "closed", "cancelled"].map((value) => ({ value, label: options?.statusLabels[value] ?? value })),
    supplierId: (options?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: `${supplier.name} · ${supplier.supplier_number}` })),
    buyerId: (options?.buyers ?? []).map((buyer) => ({ value: buyer.id, label: buyer.name })),
    warehouseId: (options?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    receiptStatus: Object.entries(options?.receiptLabels ?? {}).map(([value, label]) => ({ value, label })),
    billingStatus: Object.entries(options?.billingLabels ?? {}).map(([value, label]) => ({ value, label })),
    overdue: [{ value: "true", label: "Overdue receipt" }],
  };
  const select = (key: FilterKey, anyLabel: string) => (
    <Select key={key} aria-label={NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const date = (key: FilterKey) => (
    <TextField key={key} aria-label={NAMES[key]} type="date" size="compact" value={filters[key]} onChange={(value) => setFilters({ ...filters, [key]: value })} className="w-40" />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] && filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all";
  const views = listQuery.data?.views ?? options?.views ?? [{ key: "all", label: "All Purchase Orders" }];

  return (
    <EnterpriseListPage
      header={{
        title: "Purchase Orders",
        description: "Commitments to suppliers and where each stands: received, billed and paid, each worked out from its own documents.",
        primaryAction: canCreate ? <LinkButton href="/procurement/purchase-orders/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New Purchase Order</LinkButton> : undefined,
      }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search purchase orders" placeholder="PO number, supplier, supplier reference, quotation, product, receipt or bill" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("status", "Any PO status")}
            {select("receiptStatus", "Any receiving")}
            {select("billingStatus", "Any billing")}
            {select("overdue", "Any delivery date")}
            {select("supplierId", "Any supplier")}
            {select("buyerId", "Any buyer")}
            {select("warehouseId", "Any warehouse")}
            {date("dateFrom")}
            {date("dateTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<PurchaseOrderRow>
        aria-label="Purchase orders"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading purchase orders" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load purchase orders" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No purchase orders yet" description="Create one here, from a supplier, or from a supplier quotation."
          action={canCreate ? { label: "New Purchase Order", onPress: () => router.push("/procurement/purchase-orders/new") } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/procurement/purchase-orders/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.purchaseOrderNumber}</span>
            <span className="text-xs text-text-muted">{[row.supplierName, calendarDate(row.orderDate)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><LifecycleBadge status={row.status} /><span className="text-sm tabular-nums">{money(row.currencyCode, row.grandTotal)}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
