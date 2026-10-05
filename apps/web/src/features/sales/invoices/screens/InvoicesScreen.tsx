"use client";

// Sales → Invoices: every invoice the caller may see (those of the orders they
// see, or all of them for Finance), by view (Draft, Posted, Unpaid, Partially
// Paid, Paid, Overdue, Cancelled / Reversed), searchable by invoice and order
// number, customer, customer number, customer PO, delivery, product and
// GSTIN. Payment status, balance and overdue come from what Finance applied.
// Invoices are created from a confirmed sales order or a delivery.
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
import { calendarDate, money } from "@/features/sales/shared/format";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { listInvoices, type InvoiceFilters, type InvoiceRow } from "../api/invoices-api";
import { InvoiceStatusBadges } from "../components/InvoiceStatusBadges";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "status" | "paymentStatus" | "partyId" | "ownerUserId" | "currencyCode" | "dateFrom" | "dateTo" | "dueFrom" | "dueTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { status: ANY, paymentStatus: ANY, partyId: ANY, ownerUserId: ANY, currencyCode: ANY, dateFrom: "", dateTo: "", dueFrom: "", dueTo: "" };
const NAMES: Record<FilterKey, string> = {
  status: "Invoice status", paymentStatus: "Payment status", partyId: "Customer", ownerUserId: "Salesperson", currencyCode: "Currency", dateFrom: "Invoiced from", dateTo: "Invoiced to",
  dueFrom: "Due from", dueTo: "Due to",
};
const STATUSES = [{ value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "reversed", label: "Cancelled / Reversed" }];
const PAYMENTS = [{ value: "unpaid", label: "Unpaid" }, { value: "partially_paid", label: "Partially paid" }, { value: "paid", label: "Paid" }];
const DEFAULT_VIEWS = [{ key: "all", label: "All Invoices" }];

export function InvoicesScreen() {
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
  const listFilters: InvoiceFilters = useMemo(() => ({
    view, search: submitted || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "invoices", listFilters, pageIndex),
    queryFn: () => listInvoices({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<InvoiceRow, unknown>[]>(() => [
    { id: "number", accessorKey: "invoice_number", header: "Invoice", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.invoice_number}</span> },
    {
      id: "customer", accessorKey: "customer_name", header: "Customer",
      cell: ({ row }) => <span className="flex min-w-40 flex-col"><span>{row.original.customer_name ?? ""}</span>{row.original.customer_number && <span className="text-xs text-text-muted tabular-nums">{row.original.customer_number}</span>}</span>,
    },
    { id: "date", accessorKey: "invoice_date", header: "Invoice date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.invoice_date)}</span> },
    { id: "due", accessorKey: "due_date", header: "Due", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.due_date)}</span> },
    { id: "order", header: "Sales order", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.sales_order_number}</span> },
    { id: "total", accessorKey: "grand_total", header: "Amount", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.currency_code, row.original.grand_total)}</span> },
    { id: "balance", header: "Balance due", enableSorting: false, cell: ({ row }) => row.original.status === "posted" ? <span className="whitespace-nowrap tabular-nums">{money(row.original.currency_code, row.original.balance_due)}</span> : "" },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <InvoiceStatusBadges row={row.original} /> },
    { id: "owner", header: "Salesperson", enableSorting: false, cell: ({ row }) => row.original.owner_name ?? "" },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to sales invoices" description="Ask an administrator for the View sales invoices permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    status: STATUSES, paymentStatus: PAYMENTS,
    partyId: (options?.parties ?? []).filter((party) => ["customer", "both"].includes(party.party_type)).map((party) => ({ value: party.id, label: party.display_name })),
    ownerUserId: (options?.users ?? []).map((user) => ({ value: user.id, label: user.full_name })),
    currencyCode: [...new Set(rows.map((row) => row.currency_code))].map((code) => ({ value: code, label: code })),
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
      header={{ title: "Invoices", description: "Customer invoices made from sales orders and deliveries: drafts to check and post, and what each customer still owes." }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search invoices" placeholder="Search invoice, order, customer, customer PO, delivery, product or GSTIN" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("status", "Any status")}
            {select("paymentStatus", "Any payment")}
            {select("partyId", "Any customer")}
            {select("ownerUserId", "Any salesperson")}
            {select("currencyCode", "Any currency")}
            {date("dateFrom")}
            {date("dateTo")}
            {date("dueFrom")}
            {date("dueTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<InvoiceRow>
        aria-label="Invoices"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading invoices" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load invoices" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No invoices yet" description="Create an invoice from a confirmed sales order or a dispatched delivery."
          action={{ label: "Sales Orders", onPress: () => router.push("/sales/orders?view=not_invoiced") }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/invoices/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.invoice_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, calendarDate(row.invoice_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><InvoiceStatusBadges row={row} /><span className="text-sm tabular-nums">{money(row.currency_code, row.grand_total)}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
