"use client";

// Sales → Quotations: every quotation the caller may see (own, team or all),
// by view (Draft, Sent, Awaiting Response, Accepted, Expired …), searchable
// by number, customer, customer number, contact, opportunity, product and
// reference. Statuses, totals and Expired come from the server.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
  buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, money } from "@/features/sales/shared/format";

import { getSalesOptions, listSalesQuotations, quotationExportUrl, type QuotationFilters, type SalesQuotationRow } from "../api/quotations-api";
import { QuotationStatusBadge } from "../components/QuotationStatusBadge";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "status" | "partyId" | "ownerUserId" | "currencyCode" | "dateFrom" | "dateTo" | "validTo";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { status: ANY, partyId: ANY, ownerUserId: ANY, currencyCode: ANY, dateFrom: "", dateTo: "", validTo: "" };
const NAMES: Record<FilterKey, string> = {
  status: "Status", partyId: "Customer", ownerUserId: "Owner", currencyCode: "Currency", dateFrom: "Dated from", dateTo: "Dated to", validTo: "Valid until by",
};
const STATUSES = [
  { value: "draft", label: "Draft" }, { value: "awaiting_approval", label: "Awaiting approval" }, { value: "confirmed", label: "Confirmed" },
  { value: "sent", label: "Sent" }, { value: "accepted", label: "Accepted" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" }, { value: "superseded", label: "Superseded" },
];
const DEFAULT_VIEWS = [{ key: "all", label: "All Quotations" }];

export function SalesQuotationsScreen() {
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
  const listFilters: QuotationFilters = useMemo(() => ({
    view, search: submitted || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)),
    sort: sorting[0]?.id, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  }), [view, submitted, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotations", listFilters, pageIndex),
    queryFn: () => listSalesQuotations({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const can = listQuery.data?.capabilities;

  const columns = useMemo<ColumnDef<SalesQuotationRow, unknown>[]>(() => [
    { id: "number", accessorKey: "quotation_number", header: "Quotation", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{row.original.quotation_number}</span> },
    { id: "date", accessorKey: "quotation_date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.quotation_date)}</span> },
    {
      id: "customer", accessorKey: "customer_name", header: "Customer",
      cell: ({ row }) => <span className="flex min-w-40 flex-col"><span>{row.original.customer_name ?? ""}</span>{row.original.customer_number && <span className="text-xs text-text-muted tabular-nums">{row.original.customer_number}</span>}</span>,
    },
    { id: "contact", header: "Contact", enableSorting: false, cell: ({ row }) => row.original.contact_name ?? "" },
    { id: "opportunity", header: "Opportunity", enableSorting: false, cell: ({ row }) => row.original.opportunity_name ?? "" },
    { id: "owner", header: "Owner", enableSorting: false, cell: ({ row }) => row.original.owner_name ?? "" },
    { id: "status", accessorKey: "lifecycle_status", header: "Status", cell: ({ row }) => <QuotationStatusBadge status={row.original.status} label={row.original.status_label} /> },
    { id: "validUntil", accessorKey: "valid_until", header: "Valid until", cell: ({ row }) => <span className="whitespace-nowrap">{calendarDate(row.original.valid_until)}</span> },
    { id: "total", accessorKey: "grand_total", header: "Total", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.currency_code, row.original.grand_total)}</span> },
    { id: "order", header: "Sales order", enableSorting: false, cell: ({ row }) => row.original.converted_order_id ? <StatusBadge tone="success">Created</StatusBadge> : "" },
  ], []);

  if (listQuery.isError && listQuery.error instanceof SalesApiError && listQuery.error.status === 403)
    return <PermissionState title="You don't have access to quotations" description="Ask an administrator for the View quotations permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = {
    status: STATUSES,
    partyId: (options?.parties ?? []).filter((party) => ["customer", "both"].includes(party.party_type)).map((party) => ({ value: party.id, label: party.display_name })),
    ownerUserId: (options?.users ?? []).map((user) => ({ value: user.id, label: user.full_name })),
    currencyCode: (options?.currencies ?? []).map((currency) => ({ value: currency.code, label: currency.code })),
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
        title: "Quotations",
        description: "Priced offers to customers, from draft through confirmation, sending and the customer's answer to a sales order.",
        primaryAction: can?.create ? <LinkButton href="/sales/quotations/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New Quotation</LinkButton> : undefined,
        secondaryActions: can?.export ? <a className={buttonVariants({ variant: "outline" })} href={quotationExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a> : undefined,
      }}
      savedViews={{ views: views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search quotations" placeholder="Search number, customer, contact, opportunity, product or reference" className="w-full sm:w-96"
              value={search} onChange={setSearch} onSubmit={(value) => setSubmitted(value.trim())} />
            {select("status", "Any status")}
            {select("partyId", "Any customer")}
            {select("ownerUserId", "Any owner")}
            {select("currencyCode", "Any currency")}
            {date("dateFrom")}
            {date("dateTo")}
            {date("validTo")}
          </>
        ),
      }}
      filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: NO_FILTERS[id as FilterKey] }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
    >
      <EnterpriseDataGrid<SalesQuotationRow>
        aria-label="Quotations"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading quotations" rows={8} onRetry={() => void listQuery.refetch()} />}
        errorContent={<ErrorState title="Could not load quotations" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
        emptyContent={<EmptyState title="No quotations yet" description="Create a quotation here, or from an opportunity in CRM."
          action={can?.create ? { label: "New Quotation", onPress: () => router.push("/sales/quotations/new") } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        onRowClick={(row) => router.push(`/sales/quotations/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">{row.quotation_number}</span>
            <span className="text-xs text-text-muted">{[row.customer_name, calendarDate(row.quotation_date)].filter(Boolean).join(" · ")}</span>
            <span className="flex flex-wrap items-center gap-2"><QuotationStatusBadge status={row.status} label={row.status_label} /><span className="text-sm tabular-nums">{money(row.currency_code, row.grand_total)}</span></span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
