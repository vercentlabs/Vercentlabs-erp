"use client";

// Procurement → Suppliers: the Supplier Master list, with views, search,
// filters, import and export. Inactive and blocked suppliers stay listed and
// say so; the server decides what the person may see and do.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, type ActiveFilter,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useListState } from "@/features/procurement/shared/navigation";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, exportUrl, getSupplierOptions, listSuppliers, type Supplier, type SupplierListFilters } from "../api/suppliers-api";
import { SupplierStatusBadge, placeOf } from "../supplier-format";
import { Notice } from "@/shared/ui/Panel";

const PAGE_SIZE = 25;
const ANY = "any";
type FilterKey = "status" | "category" | "buyerId" | "countryCode" | "stateCode" | "currency" | "paymentTermId" | "gstRegistrationType";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { status: ANY, category: ANY, buyerId: ANY, countryCode: ANY, stateCode: ANY, currency: ANY, paymentTermId: ANY, gstRegistrationType: ANY };
const FILTER_NAMES: Record<FilterKey, string> = {
  status: "Status", category: "Category", buyerId: "Buyer", countryCode: "Country", stateCode: "State", currency: "Currency", paymentTermId: "Payment terms",
  gstRegistrationType: "GST registration",
};

export function SupplierListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL; the search, filters, sorting and page are remembered for this browser tab.
  const list = useListState("suppliers", { view: "all", filters: { ...NO_FILTERS, sortId: "supplierNumber", sortDesc: "", page: "0" } });
  const { view, search, setSearch } = list;
  const { sortId, sortDesc, page, ...filters } = list.filters;
  const sorting: SortingState = [{ id: sortId, desc: sortDesc === "true" }];
  const pageIndex = Number(page) || 0;
  const setPageIndex = (next: number) => list.setFilter("page", String(next));
  const [submittedSearch, setSubmittedSearchState] = useState(search);
  const setView = (next: string) => { list.setView(next); setPageIndex(0); };
  const setFilters = (next: Filters) => list.setFilters((current) => ({ ...current, ...next, page: "0" }));
  const setSorting = (next: SortingState) => list.setFilters((current) => ({ ...current, sortId: next[0]?.id ?? "supplierNumber", sortDesc: next[0]?.desc ? "true" : "", page: "0" }));
  const setSubmittedSearch = (next: string) => { if (next !== submittedSearch) { setSubmittedSearchState(next); setPageIndex(0); } };
  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const SORT_KEYS: Record<string, string> = { supplierNumber: "number", supplierName: "name", category: "category", status: "status", city: "city", buyer: "buyer" };
  const listFilters: SupplierListFilters = useMemo(() => ({
    view, search: submittedSearch || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    sort: SORT_KEYS[sorting[0]?.id ?? ""] ?? "number", direction: sorting[0]?.desc ? "desc" : "asc",
    // eslint-disable-next-line react-hooks/exhaustive-deps -- SORT_KEYS is constant
  }), [view, submittedSearch, filters, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "suppliers", listFilters, pageIndex),
    queryFn: () => listSuppliers({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns = useMemo<ColumnDef<Supplier, unknown>[]>(() => [
    { id: "supplierNumber", accessorKey: "supplierNumber", header: "Supplier no.", cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{row.original.supplierNumber}</span> },
    {
      id: "supplierName", accessorKey: "supplierName", header: "Supplier",
      cell: ({ row }) => (
        <span className="flex min-w-44 flex-col">
          <span className="font-medium text-text">{row.original.supplierName}</span>
          {row.original.legalName && row.original.legalName !== row.original.supplierName && <span className="text-xs text-text-muted">{row.original.legalName}</span>}
        </span>
      ),
    },
    { id: "category", accessorKey: "category", header: "Category", cell: ({ row }) => row.original.categoryLabel },
    { id: "city", header: "City", cell: ({ row }) => <span className="whitespace-nowrap">{placeOf(row.original)}</span> },
    { id: "gstin", header: "GSTIN / Tax ID", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.gstin ?? row.original.pan ?? ""}</span> },
    { id: "currency", header: "Currency", enableSorting: false, cell: ({ row }) => row.original.defaultCurrency },
    { id: "terms", header: "Payment terms", enableSorting: false, cell: ({ row }) => row.original.paymentTermName ?? "" },
    { id: "buyer", header: "Buyer", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assignedBuyerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <SupplierStatusBadge status={row.original.status} /> },
  ], []);

  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to suppliers" description="Ask an administrator for the View suppliers permission." />;

  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = options ? {
    status: options.statuses.map((entry) => ({ value: entry.code, label: entry.label })),
    category: options.categories.map((entry) => ({ value: entry.code, label: entry.label })),
    buyerId: [{ value: "none", label: "Unassigned" }, ...options.buyers.map((user) => ({ value: user.id, label: user.name }))],
    countryCode: [...new Set(["IN", options.countryCode])].map((code) => ({ value: code, label: code })),
    stateCode: options.states.map((state) => ({ value: state.code, label: state.name })),
    currency: options.currencies.map((currency) => ({ value: currency.code, label: currency.code })),
    paymentTermId: options.paymentTerms.map((term) => ({ value: term.id, label: term.name })),
    gstRegistrationType: options.gstRegistrationTypes.map((entry) => ({ value: entry.code, label: entry.label })),
  } : {};
  const select = (key: FilterKey, anyLabel: string) => (
    <Select aria-label={FILTER_NAMES[key]} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })}
      options={[{ value: ANY, label: anyLabel }, ...(choices[key] ?? [])]} />
  );
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "all";

  return (
    <div className="flex flex-col gap-4">
      {optionsQuery.isError && <Notice>The supplier filters could not be loaded. Refresh the page.</Notice>}
      <EnterpriseListPage
        header={{
          title: "Suppliers",
          description: "The companies and people you buy from: their places, people, terms and tax details. Every RFQ, purchase order, receipt, bill and payment names one of them.",
          primaryAction: can?.create ? <LinkButton href="/procurement/suppliers/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New supplier</LinkButton> : undefined,
          secondaryActions: (
            <>
              {can?.import && can.create && <LinkButton href="/procurement/suppliers/import" variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && (
                // The download follows the view, search and filters on screen.
                <Button variant="outline" onPress={() => window.location.assign(exportUrl(listFilters))}><Download className="size-4" aria-hidden="true" />Export</Button>
              )}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search suppliers" placeholder="Search name, number, legal name, GSTIN, email, phone or city" className="w-full sm:w-96" value={search}
                onChange={setSearch} onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  {select("status", "Any status")}
                  {select("category", "Any category")}
                  {select("buyerId", "Any buyer")}
                  {select("countryCode", "Any country")}
                  {select("stateCode", "Any state")}
                  {select("currency", "Any currency")}
                  {options.paymentTerms.length > 0 && select("paymentTermId", "Any payment terms")}
                  {select("gstRegistrationType", "Any GST type")}
                </>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: ANY }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
      >
        <EnterpriseDataGrid<Supplier>
          aria-label="Suppliers"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading suppliers" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load suppliers" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={<EmptyState title="No suppliers yet" description="Add your first supplier or import your existing list."
            action={can?.create ? { label: "New supplier", onPress: () => router.push("/procurement/suppliers/new") } : undefined} />}
          noResultsContent={<NoResultsState title="No suppliers match" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(`/procurement/suppliers/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.supplierName}</span>
              <span className="text-xs text-text-muted">{[row.supplierNumber, placeOf(row), row.gstin].filter(Boolean).join(" · ")}</span>
              <span><SupplierStatusBadge status={row.status} /></span>
            </div>
          )}
        />
      </EnterpriseListPage>
    </div>
  );
}
