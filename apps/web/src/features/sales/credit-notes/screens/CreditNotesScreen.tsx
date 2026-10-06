"use client";

// Sales → Credit Notes: credits against posted invoices, by view (Draft,
// Posted, Reversed / Cancelled, From Returns, Price Adjustments, Unapplied
// Credit), searchable by credit note, invoice, order and return number,
// customer, customer PO and product. Credit notes are created from a posted
// invoice or a received return.
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

import { listCreditNotes, type CreditNoteRow } from "../api/credit-notes-api";
import { CreditNoteStatusBadges } from "../components/CreditNoteStatusBadges";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "partyId" | "reasonCode" | "fromReturn" | "dateFrom" | "dateTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { partyId: ANY, reasonCode: ANY, fromReturn: ANY, dateFrom: "", dateTo: "" };
const NAMES: Record<FilterKey, string> = { partyId: "Customer", reasonCode: "Reason", fromReturn: "Source", dateFrom: "Dated from", dateTo: "Dated to" };

export function CreditNotesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setViewState] = useState(params.get("view") || "all");
  const [search, setSearch] = useState("");
  const [submitted, setSubmittedState] = useState("");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "created", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const scope = { invoiceId: params.get("invoiceId") ?? undefined, returnId: params.get("returnId") ?? undefined, salesOrderId: params.get("salesOrderId") ?? undefined };
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
    view, search: submitted || undefined, ...scope,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scope comes from the URL
  }), [view, submitted, filters, sorting, scope.invoiceId, scope.returnId, scope.salesOrderId]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "credit-notes", listFilters, pageIndex),
    queryFn: () => listCreditNotes({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<CreditNoteRow, unknown>[]>(() => [
    { id: "number", accessorKey: "invoice_number", header: "Credit note", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.invoice_number}</span> },
    { id: "customer", accessorKey: "customer_name", header: "Customer", cell: ({ row }) => row.original.customer_name ?? "" },
    { id: "date", accessorKey: "invoice_date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.invoice_date)}</span> },
    { id: "invoice", header: "Invoice", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.source_invoice_number}</span> },
    { id: "order", header: "Sales order", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.sales_order_number}</span> },
    { id: "return", header: "Return", enableSorting: false, cell: ({ row }) => row.original.return_number ?? "" },
    { id: "reason", header: "Reason", enableSorting: false, cell: ({ row }) => row.original.reasonLabel },
    { id: "total", accessorKey: "grand_total", header: "Total", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.currency_code, row.original.grand_total)}</span> },
    { id: "unapplied", header: "Unapplied", enableSorting: false,
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.unapplied === null || row.original.status !== "posted" ? "" : money(row.original.currency_code, row.original.unapplied)}</span> },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <CreditNoteStatusBadges row={row.original} /> },
    { id: "sent", header: "Sent", enableSorting: false, cell: ({ row }) => (row.original.sent_at ? "Sent" : row.original.status === "posted" ? "Not sent" : "") },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to credit notes" description="Ask an administrator for the View credit notes permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    partyId: (options?.parties ?? []).filter((party) => ["customer", "both"].includes(party.party_type)).map((party) => ({ value: party.id, label: party.display_name })),
    reasonCode: (listQuery.data?.reasons ?? []).map((reason) => ({ value: reason.code, label: reason.label })),
    fromReturn: [{ value: "yes", label: "From a return" }, { value: "no", label: "From an invoice" }],
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
  const scoped = Boolean(scope.invoiceId || scope.returnId || scope.salesOrderId);
  const hasCriteria = Boolean(submitted) || activeFilters.length > 0 || view !== "all" || scoped;
  const views = listQuery.data?.views ?? [{ key: "all", label: "All Credit Notes" }];

  return (
    <EnterpriseListPage
      header={{ title: "Credit Notes", description: "Credits against posted invoices: returned goods, price adjustments and corrections. Posted credit notes reduce what the customer owes." }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search credit notes" placeholder="Search credit note, invoice, order, return, customer, customer PO or product" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("partyId", "Any customer")}
            {select("reasonCode", "Any reason")}
            {select("fromReturn", "Any source")}
            {date("dateFrom")}
            {date("dateTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length || scoped ? {
        filters: [...activeFilters, ...(scoped ? [{ id: "scope", label: "Showing one document's credit notes" }] : [])],
        onRemove: (id) => (id === "scope" ? router.push("/sales/credit-notes") : setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] })),
        onClearAll: () => { setFilters(NO_FILTERS); if (scoped) router.push("/sales/credit-notes"); },
      } : undefined}
    >
      <EnterpriseDataGrid<CreditNoteRow>
        aria-label="Credit notes"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading credit notes" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load credit notes" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No credit notes yet" description="Create a credit note from a posted invoice, or from a received return." action={{ label: "Invoices", onPress: () => router.push("/sales/invoices?view=posted") }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/credit-notes/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.invoice_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, row.source_invoice_number, calendarDate(row.invoice_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><CreditNoteStatusBadges row={row} /><span className="text-sm tabular-nums">{money(row.currency_code, row.grand_total)}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
