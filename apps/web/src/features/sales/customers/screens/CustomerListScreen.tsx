"use client";

// Sales → Customers: the Customer Master list, with views, search, filters,
// import and export. Balances are shown only to users who may see customer
// financials; the server decides, this screen only draws what it is given.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import {
  Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, Menu, MenuItem, MenuTrigger, NoResultsState, PermissionState, SearchField, Select, type ActiveFilter,
} from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { customerExportUrl, customerRelatedExportUrl, errorCode, getCustomerOptions, listCustomers, type Customer, type CustomerListFilters } from "../api/customers-api";
import { CustomerStatusBadge, ErrorBanner, cityState } from "../customer-format";

const PAGE_SIZE = 25;
const ANY = "any";

type FilterKey = "status" | "customerKind" | "ownerUserId" | "state" | "countryCode" | "gstRegistrationType" | "currencyCode" | "priceListId" | "paymentTermId" | "created" | "hasOutstanding" | "hasOverdue";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = {
  status: ANY, customerKind: ANY, ownerUserId: ANY, state: ANY, countryCode: ANY, gstRegistrationType: ANY, currencyCode: ANY, priceListId: ANY, paymentTermId: ANY, created: ANY,
  hasOutstanding: ANY, hasOverdue: ANY,
};
const FILTER_NAMES: Record<FilterKey, string> = {
  status: "Status", customerKind: "Type", ownerUserId: "Salesperson", state: "State", countryCode: "Country", gstRegistrationType: "GST registration", currencyCode: "Currency",
  priceListId: "Price list", paymentTermId: "Payment terms", created: "Created", hasOutstanding: "Outstanding", hasOverdue: "Overdue",
};
const CREATED = [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 12 months" }];
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function CustomerListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();

  const [view, setViewState] = useState(params.get("view") || "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(NO_FILTERS);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);

  const setView = (next: string) => { setViewState(next); setPageIndex(0); };
  const setFilters = (next: Filters) => { setFiltersState(next); setPageIndex(0); };
  const setSorting = (next: SortingState) => { setSortingState(next); setPageIndex(0); };
  const setSubmittedSearch = (next: string) => {
    if (next === submittedSearch) return;
    setSubmittedSearchState(next);
    setPageIndex(0);
  };
  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;

  const listFilters: CustomerListFilters = useMemo(() => {
    const { created, ...plain } = filters;
    return {
      view,
      search: submittedSearch || undefined,
      ...Object.fromEntries(Object.entries(plain).filter(([, value]) => value !== ANY)),
      createdFrom: created === ANY ? undefined : daysAgo(Number(created)),
      sort: sorting[0]?.id,
      direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
    };
  }, [view, submittedSearch, filters, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customers", "list", listFilters, pageIndex),
    queryFn: () => listCustomers({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const customers = listQuery.data?.customers ?? [];
  const total = listQuery.data?.total ?? 0;
  const finance = Boolean(options?.showsFinancials);

  const columns = useMemo<ColumnDef<Customer, unknown>[]>(() => [
    { id: "customerNumber", accessorKey: "customerNumber", header: "Customer no.", cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{row.original.customerNumber}</span> },
    {
      id: "displayName", accessorKey: "displayName", header: "Customer",
      cell: ({ row }) => (
        <span className="flex min-w-44 flex-col">
          <span className="font-medium text-text">{row.original.displayName}</span>
          {row.original.legalName && row.original.legalName !== row.original.displayName && <span className="text-xs text-text-muted">{row.original.legalName}</span>}
        </span>
      ),
    },
    { id: "primaryContactName", header: "Primary contact", enableSorting: false, cell: ({ row }) => row.original.primaryContactName ?? "" },
    { id: "phone", header: "Phone", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.phone ?? row.original.primaryContactPhone ?? ""}</span> },
    { id: "gstin", header: "GSTIN", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.gstin ?? ""}</span> },
    { id: "city", accessorKey: "city", header: "City / State", cell: ({ row }) => <span className="whitespace-nowrap">{cityState(row.original)}</span> },
    { id: "currencyCode", header: "Currency", enableSorting: false, cell: ({ row }) => row.original.currencyCode ?? "" },
    { id: "paymentTermName", header: "Payment terms", enableSorting: false, cell: ({ row }) => row.original.paymentTermName ?? "" },
    { id: "ownerName", header: "Salesperson", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    ...(finance ? [{
      id: "outstanding", accessorKey: "outstanding", header: "Outstanding",
      cell: ({ row }: { row: { original: Customer } }) => (
        <span className="flex flex-col whitespace-nowrap tabular-nums">
          <span>{row.original.outstanding ? formatMoney(row.original.currencyCode, row.original.outstanding) : <span className="text-text-muted">Nil</span>}</span>
          {Boolean(row.original.overdue) && <span className="text-xs text-danger">{formatMoney(row.original.currencyCode, row.original.overdue ?? 0)} overdue</span>}
        </span>
      ),
    } satisfies ColumnDef<Customer, unknown>] : []),
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <CustomerStatusBadge status={row.original.status} /> },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.createdAt)}</span> },
  ], [finance]);

  if (optionsQuery.isError && errorCode(optionsQuery.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to customers" description="Ask an administrator for the View customers permission." />;

  const filterOptions = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const select = (key: FilterKey, label: string, list: Array<{ value: string; label: string }>, anyLabel: string) => (
    <Select aria-label={label} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters({ ...filters, [key]: String(value) })} options={filterOptions(list, anyLabel)} />
  );
  const yes = [{ value: "true", label: "Yes" }];
  const choices: Partial<Record<FilterKey, Array<{ value: string; label: string }>>> = options ? {
    status: options.statuses.map((entry) => ({ value: entry.code, label: entry.label })),
    customerKind: options.kinds.map((entry) => ({ value: entry.code, label: entry.label })),
    ownerUserId: [{ value: "unassigned", label: "Unassigned" }, ...options.salespeople.map((user) => ({ value: user.id, label: user.name }))],
    state: options.gstStates.map((state) => ({ value: state.name, label: state.name })),
    countryCode: options.countries.map((country) => ({ value: country.code, label: country.name })),
    gstRegistrationType: options.gstRegistrationTypes.map((entry) => ({ value: entry.code, label: entry.label })),
    currencyCode: options.currencies.map((currency) => ({ value: currency.code, label: currency.code })),
    priceListId: options.priceLists.map((list) => ({ value: list.id, label: list.name })),
    paymentTermId: options.paymentTerms.map((term) => ({ value: term.id, label: term.name })),
    created: CREATED,
    hasOutstanding: yes,
    hasOverdue: yes,
  } : {};
  const activeFilters: ActiveFilter[] = (Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY)
    .map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${choices[key]?.find((entry) => entry.value === filters[key])?.label ?? filters[key]}` }));
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "all";

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={optionsQuery.isError ? "The customer filters could not be loaded. Refresh the page." : null} />
      <EnterpriseListPage
        header={{
          title: "Customers",
          description: "The companies and people you quote, sell and deliver to, with their addresses, contacts, terms and tax details.",
          primaryAction: can?.create ? <LinkButton href="/sales/customers/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New customer</LinkButton> : undefined,
          secondaryActions: (
            <>
              {can?.import && can.create && <LinkButton href="/sales/customers/import" variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && (
                <MenuTrigger>
                  <Button variant="outline"><Download className="size-4" aria-hidden="true" />Export</Button>
                  <Menu onAction={(key) => {
                    // The download follows the view, search and filters on screen.
                    window.location.assign(key === "customers" ? customerExportUrl(listFilters) : customerRelatedExportUrl(key as "addresses" | "contacts", listFilters));
                  }}>
                    <MenuItem id="customers">Customers</MenuItem>
                    {can.viewAddresses && <MenuItem id="addresses">Customer addresses</MenuItem>}
                    {can.viewContacts && <MenuItem id="contacts">Customer contacts</MenuItem>}
                  </Menu>
                </MenuTrigger>
              )}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search customers" placeholder="Search number, name, GSTIN, phone, email, contact or city" className="w-full sm:w-96" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  {select("status", "Status", choices.status ?? [], "Any status")}
                  {select("customerKind", "Type", choices.customerKind ?? [], "Any type")}
                  {select("ownerUserId", "Salesperson", choices.ownerUserId ?? [], "Any salesperson")}
                  {select("state", "State", choices.state ?? [], "Any state")}
                  {select("countryCode", "Country", choices.countryCode ?? [], "Any country")}
                  {select("gstRegistrationType", "GST registration", choices.gstRegistrationType ?? [], "Any GST type")}
                  {select("currencyCode", "Currency", choices.currencyCode ?? [], "Any currency")}
                  {options.priceLists.length > 0 && select("priceListId", "Price list", choices.priceListId ?? [], "Any price list")}
                  {options.paymentTerms.length > 0 && select("paymentTermId", "Payment terms", choices.paymentTermId ?? [], "Any payment terms")}
                  {select("created", "Created", CREATED, "Created any time")}
                  {finance && select("hasOutstanding", "Outstanding", [{ value: "true", label: "Has outstanding" }], "Any balance")}
                  {finance && select("hasOverdue", "Overdue", [{ value: "true", label: "Has overdue" }], "Overdue or not")}
                </>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: (id) => setFilters({ ...filters, [id]: ANY }), onClearAll: () => setFilters(NO_FILTERS) } : undefined}
      >
        <EnterpriseDataGrid<Customer>
          aria-label="Customers"
          columns={columns}
          data={customers}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : customers.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading customers" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load customers" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={
            <EmptyState title="No customers yet" description="Add your first customer, import a list, or create one from a CRM account."
              action={can?.create ? { label: "New customer", onPress: () => router.push("/sales/customers/new") } : undefined} />
          }
          noResultsContent={<NoResultsState title="No customers match" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          onRowClick={(row) => router.push(`/sales/customers/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.displayName}</span>
              <span className="text-xs text-text-muted">{[row.customerNumber, cityState(row)].filter(Boolean).join(" · ")}</span>
              <span><CustomerStatusBadge status={row.status} /></span>
              <span className="text-xs text-text-secondary">{[row.primaryContactName, row.phone ?? row.primaryContactPhone].filter(Boolean).join(" · ")}</span>
            </div>
          )}
        />
      </EnterpriseListPage>
    </div>
  );
}
