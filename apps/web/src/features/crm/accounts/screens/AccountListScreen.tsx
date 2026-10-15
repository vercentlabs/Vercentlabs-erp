"use client";

// Companies: the businesses you sell to and work with. The common views are chips (My companies, Prospects, Customers, No recent activity)
// with their counts, the rest under More views; one Filters button holds every filter, each applying the moment it changes. New company
// is the primary action; Import and Export sit in the "…" menu, and the company report lives under Insights → Reports.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Plus } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { FollowUpCell } from "@/features/crm/leads/lead-format";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  accountExportUrl, getAccountListSummary, getAccountOptions, listAccounts, type Account, type AccountBulkResult, type AccountListFilters,
  type AccountStatus, type AccountViewKey,
} from "../api/accounts-api";
import { AccountStatusBadge, AccountTypeBadge, ErrorBanner, locationOf } from "../account-format";
import { AssignAccountsDialog, AccountStatusDialog } from "../components/AccountActionDialogs";
import { LIVE_ACCOUNT_QUERY } from "../live-query";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.accounts.columns.v2";
const PINNED_VIEWS = ["mine", "prospects", "customers", "no_recent_activity"];

// Columns the user can hide; the company name always stays. Seven show by default.
const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "accountType", label: "Type" },
  { id: "city", label: "City" },
  { id: "ownerName", label: "Owner" },
  { id: "openPipelineValue", label: "Open deals" },
  { id: "contacts", label: "Contacts" },
  { id: "lastActivityAt", label: "Last activity" },
  { id: "status", label: "Status", hiddenByDefault: true },
  { id: "industry", label: "Industry", hiddenByDefault: true },
  { id: "nextFollowUpAt", label: "Next follow-up", hiddenByDefault: true },
  { id: "sourceName", label: "Source", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
  { id: "phone", label: "Phone", hiddenByDefault: true },
  { id: "createdAt", label: "Created", hiddenByDefault: true },
];

const DEFAULT_VISIBILITY: VisibilityState = Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column.id, !column.hiddenByDefault]));

// Column choices are remembered on this device.
function storedVisibility(): VisibilityState {
  if (typeof window === "undefined") return DEFAULT_VISIBILITY;
  try {
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    return stored ? { ...DEFAULT_VISIBILITY, ...JSON.parse(stored) } : DEFAULT_VISIBILITY;
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

type FilterKey = "accountType" | "ownerId" | "industry" | "sourceId" | "hasOpenOpportunity" | "countryCode";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { accountType: ANY, ownerId: ANY, industry: ANY, sourceId: ANY, hasOpenOpportunity: ANY, countryCode: ANY };
const FILTER_NAMES: Record<FilterKey, string> = {
  accountType: "Type", ownerId: "Owner", industry: "Industry", sourceId: "Source", hasOpenOpportunity: "Open deals", countryCode: "Country",
};

type DialogKind = "assign" | AccountStatus | null;

export function AccountListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // People who see every company start on all companies; everyone else on their own.
  const seesAll = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.accounts.view_all");
  const defaultView: AccountViewKey = seesAll ? "all" : "mine";
  const [view, setViewState] = useState<AccountViewKey>((params.get("view") as AccountViewKey) || defaultView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => ({
    ...NO_FILTERS,
    ...Object.fromEntries((Object.keys(NO_FILTERS) as FilterKey[]).filter((key) => params.get(key)).map((key) => [key, params.get(key) as string])),
  }));
  const [lastActivityBefore, setLastActivityBefore] = useState(params.get("lastActivityBefore") ?? "");
  const [sorting, setSortingState] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(storedVisibility);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [bulkResult, setBulkResult] = useState<AccountBulkResult | null>(null);

  const restart = () => {
    setPageIndex(0);
    setSelection({});
  };
  const setView = (next: AccountViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Filters) => { setFiltersState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  const setSubmittedSearch = (next: string) => {
    if (next === submittedSearch) return;
    setSubmittedSearchState(next);
    restart();
  };
  const changeVisibility = (next: VisibilityState) => {
    setVisibility(next);
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Column choices are a convenience; nothing to do if storage is unavailable.
    }
  };

  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account-options"), queryFn: getAccountOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const listFilters: AccountListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    lastActivityBefore: lastActivityBefore || undefined,
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, lastActivityBefore, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", "list", listFilters, pageIndex),
    queryFn: () => listAccounts({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE_ACCOUNT_QUERY,
  });
  // The chips' counts: every company the search and filters match, whichever view is chosen.
  const summaryFilters = useMemo(() => ({ ...listFilters, view: "all" as AccountViewKey, sortBy: undefined, sortDirection: undefined }), [listFilters]);
  const summaryQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", "summary", summaryFilters),
    queryFn: () => getAccountListSummary(summaryFilters),
    placeholderData: keepPreviousData,
    ...LIVE_ACCOUNT_QUERY,
  });
  const accounts = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const summary = summaryQuery.data;
  const can = options?.capabilities;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const money = (value: number) => formatMoney(options?.baseCurrency, value);
  const counts: Partial<Record<AccountViewKey, number>> = summary
    ? { prospects: summary.prospects, customers: summary.customers, no_recent_activity: summary.withoutRecentActivity }
    : {};

  const columns = useMemo<ColumnDef<Account, unknown>[]>(() => [
    {
      id: "displayName",
      accessorKey: "displayName",
      header: "Company",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-44 flex-col">
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">
            {row.original.displayName}
            {row.original.status !== "active" && <AccountStatusBadge status={row.original.status} />}
          </span>
          <span className="text-xs whitespace-nowrap text-text-muted">
            {row.original.code}{row.original.customerNumber ? ` · ${row.original.customerNumber}` : ""}{row.original.parentName ? ` · part of ${row.original.parentName}` : ""}
          </span>
        </span>
      ),
    },
    { id: "accountType", accessorKey: "accountType", header: "Type", cell: ({ row }) => <AccountTypeBadge type={row.original.accountType} /> },
    { id: "city", accessorKey: "city", header: "City", cell: ({ row }) => <span className="whitespace-nowrap">{locationOf(row.original)}</span> },
    { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    {
      id: "openPipelineValue",
      accessorKey: "openPipelineValue",
      header: "Open deals",
      cell: ({ row }) => row.original.openOpportunities
        ? <span className="flex flex-col tabular-nums"><span>{money(row.original.openPipelineValue)}</span><span className="text-xs text-text-muted">{row.original.openOpportunities} open</span></span>
        : <span className="text-text-muted">None</span>,
    },
    { id: "contacts", header: "Contacts", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.contactCount}</span> },
    { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => row.original.lastActivityAt ? formatDate(row.original.lastActivityAt) : <span className="text-text-muted">Never</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <AccountStatusBadge status={row.original.status} /> },
    { id: "industry", accessorKey: "industry", header: "Industry", cell: ({ row }) => row.original.industry ?? "" },
    { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <FollowUpCell value={row.original.nextFollowUpAt} /> },
    { id: "sourceName", accessorKey: "sourceName", header: "Source", cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "teamName", header: "Team", enableSorting: false, cell: ({ row }) => row.original.teamName ?? "" },
    { id: "phone", header: "Phone", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.phone ?? ""}</span> },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- money reads only the base currency
  ], [options?.baseCurrency]);

  const refresh = (result?: AccountBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
  };

  const filterOptions = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const ownerOptions = options
    ? filterOptions([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))], "Any owner")
    : [];
  const yesNo = [{ value: "yes", label: "Has open deals" }, { value: "no", label: "No open deals" }];
  const labelOf = (key: FilterKey, value: string) => {
    if (!options) return value;
    if (key === "accountType") return options.types.find((entry) => entry.code === value)?.label ?? value;
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? value;
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? value;
    if (key === "hasOpenOpportunity") return value === "yes" ? "Yes" : "No";
    return value;
  };
  const activeFilters: ActiveFilter[] = [
    ...(Object.keys(filters) as FilterKey[]).filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(lastActivityBefore ? [{ id: "lastActivityBefore", label: `No activity since ${formatDate(lastActivityBefore)}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "lastActivityBefore") {
      setLastActivityBefore("");
      restart();
    } else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setLastActivityBefore("");
    setFilters(NO_FILTERS);
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== defaultView;

  if (optionsQuery.isError && !workspace.permissions.includes("crm.accounts.view"))
    return <PermissionState title="You don't have access to companies" description="Ask an administrator for the View companies permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.partyId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={optionsQuery.isError ? "The company filters could not be loaded. Refresh the page." : null} />

      <EnterpriseListPage
        header={{
          title: "Companies",
          description: "The businesses you sell to and work with — prospects, customers and partners — with their people, deals and history.",
          primaryAction: can?.create ? <LinkButton href="/crm/accounts/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New company</LinkButton> : undefined,
          secondaryActions: <MoreMenu label="More company actions" items={[
            ...(can?.import ? [{ id: "import", label: "Import", onAction: () => router.push("/crm/data/import-export?type=companies") }] : []),
            ...(can?.export ? [{ id: "export", label: "Export", onAction: () => { window.location.href = accountExportUrl(listFilters); } }] : []),
          ]} />,
        }}
        savedViews={options ? {
          views: options.views.map((entry) => ({ id: entry.key, label: entry.label, count: counts[entry.key] })),
          activeViewId: view, onSelect: (id) => setView(id as AccountViewKey), pinned: PINNED_VIEWS,
        } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search companies" placeholder="Search name, number, website, GSTIN or contact" className="w-full sm:min-w-64 sm:flex-1" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <Select label="Type" size="compact" selectedKey={filters.accountType} onSelectionChange={(key) => setFilters({ ...filters, accountType: String(key) })}
                    options={filterOptions(options.types.map((entry) => ({ value: entry.code, label: entry.label })), "Any type")} />
                  <Select label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  {options.industries.length > 0 && (
                    <Select label="Industry" size="compact" selectedKey={filters.industry} onSelectionChange={(key) => setFilters({ ...filters, industry: String(key) })}
                      options={filterOptions(options.industries.map((entry) => ({ value: entry, label: entry })), "Any industry")} />
                  )}
                  <Select label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={filterOptions(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select label="Open deals" size="compact" selectedKey={filters.hasOpenOpportunity}
                    onSelectionChange={(key) => setFilters({ ...filters, hasOpenOpportunity: String(key) })} options={filterOptions(yesNo, "Any")} />
                </FiltersPopover>
              )}
            </>
          ),
          end: (
            <PopoverTrigger>
              <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Columns</span></Button>
              <Popover>
                <div className="flex flex-col gap-2 p-1">
                  <p className="text-xs font-medium text-text-secondary">Show columns</p>
                  {OPTIONAL_COLUMNS.map((column) => (
                    <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
                  ))}
                </div>
              </Popover>
            </PopoverTrigger>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
        bulkActionBar={selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {(can?.assign || can?.reassign) && <Button variant="secondary" size="compact" onPress={() => setDialog("assign")}>Assign</Button>}
              {can?.archive && view !== "archived" && <Button variant="secondary" size="compact" onPress={() => setDialog("inactive")}>Deactivate</Button>}
              {can?.archive && view !== "archived" && <Button variant="secondary" size="compact" onPress={() => setDialog("archived")}>Archive</Button>}
              {can?.archive && (view === "archived" || view === "inactive") && <Button variant="secondary" size="compact" onPress={() => setDialog("active")}>Reactivate</Button>}
              {can?.export && (
                <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={accountExportUrl({ view: view === "archived" ? "archived" : "all", ids: selectedIds.join(",") })} download>
                  Export selected
                </a>
              )}
            </>
          ),
        } : undefined}
      >
        {listQuery.data && total > 0 && summary && (
          <p className="text-sm text-text-secondary">
            {total} {total === 1 ? "company" : "companies"}
            {summary.withOpenOpportunities > 0 && <> · <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => setFilters({ ...filters, hasOpenOpportunity: "yes" })}>
              {summary.withOpenOpportunities} with open deals</button> worth {money(summary.openPipelineValue)}</>}
          </p>
        )}
        <EnterpriseDataGrid<Account>
          aria-label="Companies"
          columns={columns}
          data={accounts}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : accounts.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading companies" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load companies" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={
            <EmptyState title="No companies yet" description="Add your first company, import a list, or convert a qualified lead."
              action={can?.create ? { label: "New company", onPress: () => router.push("/crm/accounts/new") } : undefined} />
          }
          noResultsContent={<NoResultsState title="No companies match" description="Try a different view, search or filter." />}
          manualSorting
          sorting={sorting}
          onSortingChange={setSorting}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          enableRowSelection
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          columnVisibility={visibility}
          onColumnVisibilityChange={changeVisibility}
          onRowClick={(row) => router.push(`/crm/accounts/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{row.displayName}</span>
              <span className="text-xs text-text-muted">{[row.code, locationOf(row)].filter(Boolean).join(" · ")}</span>
              <span className="flex flex-wrap gap-1"><AccountTypeBadge type={row.accountType} /><AccountStatusBadge status={row.status} /></span>
              <span className="text-xs text-text-secondary">
                {row.ownerName ?? "Unassigned"}{row.openOpportunities ? ` · ${row.openOpportunities} open · ${money(row.openPipelineValue)}` : ""}
              </span>
            </div>
          )}
        />
      </EnterpriseListPage>

      {options && (
        <>
          <AssignAccountsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} partyIds={selectedIds} options={options} onDone={refresh} />
          {(dialog === "active" || dialog === "inactive" || dialog === "archived") && (
            <AccountStatusDialog isOpen onOpenChange={(open) => !open && setDialog(null)} partyIds={selectedIds} status={dialog} onDone={refresh} />
          )}
        </>
      )}
    </div>
  );
}
