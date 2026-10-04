"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Download, Filter, Plus } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  getOpportunityOptions, listOpportunities, opportunityExportUrl,
  type Opportunity, type OpportunityBulkResult, type OpportunityListFilters, type OpportunityViewKey,
} from "../api/opportunities-api";
import { AssignOpportunitiesDialog, ChangeStageDialog } from "../components/OpportunityActionDialogs";
import { OpportunityBoard } from "../components/OpportunityBoard";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { ErrorBanner, OpportunityFlags, OpportunityStageBadge, OpportunityStatusBadge, PRIORITY_OPTIONS, PriorityBadge, STATUS_LABELS, days } from "../opportunity-format";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.opportunities.columns";

// Columns the user can hide. Opportunity and status always stay visible.
const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "accountName", label: "Account" },
  { id: "stage", label: "Stage" },
  { id: "amount", label: "Estimated value" },
  { id: "probability", label: "Probability" },
  { id: "weightedValue", label: "Weighted value", hiddenByDefault: true },
  { id: "expectedCloseDate", label: "Expected close" },
  { id: "ownerName", label: "Owner" },
  { id: "priority", label: "Priority" },
  { id: "nextStep", label: "Next step", hiddenByDefault: true },
  { id: "nextFollowUpAt", label: "Next follow-up", hiddenByDefault: true },
  { id: "lastActivityAt", label: "Last activity", hiddenByDefault: true },
  { id: "contactName", label: "Primary contact", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
  { id: "sourceName", label: "Source", hiddenByDefault: true },
  { id: "productInterest", label: "Product / service", hiddenByDefault: true },
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

type FilterKey = "status" | "stageId" | "ownerId" | "teamId" | "sourceId" | "priority";
type Filters = Record<FilterKey, string>;
const FILTER_KEYS: FilterKey[] = ["status", "stageId", "ownerId", "teamId", "sourceId", "priority"];
const FILTER_NAMES: Record<FilterKey, string> = { status: "Status", stageId: "Stage", ownerId: "Owner", teamId: "Team", sourceId: "Source", priority: "Priority" };

// The filters kept in the panel: who the deal is with, what is sold, and the ranges.
type MoreKey = "accountId" | "contactId" | "product" | "expectedCloseFrom" | "expectedCloseTo" | "valueMin" | "valueMax" | "createdFrom" | "createdTo";
type MoreFilters = Record<MoreKey, string>;
const MORE_KEYS: MoreKey[] = ["accountId", "contactId", "product", "expectedCloseFrom", "expectedCloseTo", "valueMin", "valueMax", "createdFrom", "createdTo"];
const NO_MORE: MoreFilters = { accountId: "", contactId: "", product: "", expectedCloseFrom: "", expectedCloseTo: "", valueMin: "", valueMax: "", createdFrom: "", createdTo: "" };
const range = (from: string, to: string, show: (value: string) => string) => `${from ? show(from) : "any"} – ${to ? show(to) : "any"}`;

type Layout = "list" | "board";
type DialogKind = "assign" | "stage" | null;

export function OpportunityListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [layout, setLayout] = useState<Layout>(params.get("layout") === "board" ? "board" : "list");
  const [view, setViewState] = useState<OpportunityViewKey>((params.get("view") as OpportunityViewKey) || "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Filters);
  const [more, setMoreState] = useState<MoreFilters>(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as MoreFilters);
  const [moreDraft, setMoreDraft] = useState<MoreFilters>(more);
  const [staleOnly, setStaleOnlyState] = useState(params.get("stale") === "yes");
  // Names for the account and contact chips; ids alone mean nothing to a person.
  const [names, setNames] = useState<{ account: string | null; contact: string | null }>({ account: params.get("accountName"), contact: null });
  const [sorting, setSortingState] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(storedVisibility);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [bulkResult, setBulkResult] = useState<OpportunityBulkResult | null>(null);

  // Changing what is listed starts again from the first page with nothing selected.
  const restart = () => { setPageIndex(0); setSelection({}); };
  const setView = (next: OpportunityViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Filters) => { setFiltersState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  const setStaleOnly = (next: boolean) => { setStaleOnlyState(next); restart(); };
  const setMore = (next: MoreFilters) => { setMoreState(next); setMoreDraft(next); restart(); };
  const setSubmittedSearch = (next: string) => {
    if (next === submittedSearch) return;
    setSubmittedSearchState(next);
    restart();
  };
  const changeVisibility = (next: VisibilityState) => {
    setVisibility(next);
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next));
  };

  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  // The contact filter offers the people at the chosen account.
  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-contacts", moreDraft.accountId),
    queryFn: () => listContacts({ accountId: moreDraft.accountId, limit: 100 }),
    enabled: Boolean(moreDraft.accountId),
  });
  const accountContacts = contactsQuery.data?.rows ?? [];

  const listFilters: OpportunityListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
    stale: staleOnly ? "yes" : undefined,
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, more, staleOnly, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", listFilters, pageIndex),
    queryFn: () => listOpportunities({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: layout === "list",
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const opportunities = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const can = options?.capabilities;
  const baseCurrency = options?.baseCurrency;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const columns = useMemo<ColumnDef<Opportunity, unknown>[]>(() => {
    const money = (row: Opportunity, amount: number) => <span className="tabular-nums whitespace-nowrap">{formatMoney(row.currencyCode ?? baseCurrency, amount)}</span>;
    return [
      {
        id: "name", accessorKey: "name", header: "Opportunity", enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-48 flex-col">
            <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">{row.original.name}<OpportunityFlags opportunity={row.original} /></span>
            <span className="text-xs whitespace-nowrap text-text-muted">{row.original.code}</span>
          </span>
        ),
      },
      { id: "accountName", accessorKey: "accountName", header: "Account", cell: ({ row }) => <span className="block min-w-36">{row.original.accountName ?? ""}</span> },
      { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <OpportunityStatusBadge status={row.original.status} /> },
      {
        id: "stage", accessorKey: "stageName", header: "Stage",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <OpportunityStageBadge opportunity={row.original} />
            {row.original.status === "open" && <span className="text-xs text-text-muted">{days(row.original.stageAgeDays)}</span>}
          </span>
        ),
      },
      { id: "amount", accessorKey: "amount", header: "Estimated value", cell: ({ row }) => money(row.original, row.original.amount) },
      { id: "probability", accessorKey: "probability", header: "Probability", cell: ({ row }) => <span className="tabular-nums">{row.original.probability}%</span> },
      { id: "weightedValue", accessorKey: "weightedValue", header: "Weighted value", cell: ({ row }) => money(row.original, row.original.weightedValue) },
      {
        id: "expectedCloseDate", accessorKey: "expectedCloseDate", header: "Expected close",
        cell: ({ row }) => <span className={`whitespace-nowrap ${row.original.isOverdue ? "font-medium text-danger" : ""}`}>{formatDate(row.original.expectedCloseDate)}</span>,
      },
      { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
      { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
      { id: "nextStep", accessorKey: "nextStep", header: "Next step", enableSorting: false, cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.nextStep ?? ""}</span> },
      { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.nextFollowUpAt ? formatDateTime(row.original.nextFollowUpAt) : ""}</span> },
      { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => formatDate(row.original.lastActivityAt) },
      { id: "contactName", accessorKey: "contactName", header: "Primary contact", enableSorting: false, cell: ({ row }) => row.original.contactName ?? "" },
      { id: "teamName", accessorKey: "teamName", header: "Team", enableSorting: false, cell: ({ row }) => row.original.teamName ?? "" },
      { id: "sourceName", accessorKey: "sourceName", header: "Source", enableSorting: false, cell: ({ row }) => row.original.sourceName ?? "" },
      { id: "productInterest", accessorKey: "productInterest", header: "Product / service", enableSorting: false, cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.productInterest ?? ""}</span> },
      { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
    ];
  }, [baseCurrency]);

  const refresh = (result?: OpportunityBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
  };

  const withAny = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const ownerOptions = options
    ? withAny([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))], "Any owner")
    : [];
  const labelOf = (key: FilterKey, value: string) => {
    if (!options) return value;
    if (key === "status") return STATUS_LABELS[value as Opportunity["status"]] ?? value;
    if (key === "stageId") return options.stages.find((entry) => entry.id === value)?.name ?? "Chosen stage";
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? "Chosen owner";
    if (key === "teamId") return options.teams.find((entry) => entry.id === value)?.name ?? "Chosen team";
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? "Chosen source";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Account: ${names.account ?? "chosen account"}` }] : []),
    ...(more.contactId ? [{ id: "more:contactId", label: `Contact: ${names.contact ?? "chosen contact"}` }] : []),
    ...(more.product.trim() ? [{ id: "more:product", label: `Product / service: ${more.product}` }] : []),
    ...(more.expectedCloseFrom || more.expectedCloseTo ? [{ id: "more:expectedClose", label: `Expected close: ${range(more.expectedCloseFrom, more.expectedCloseTo, formatDate)}` }] : []),
    ...(more.valueMin || more.valueMax ? [{ id: "more:value", label: `Value: ${range(more.valueMin, more.valueMax, (value) => formatMoney(baseCurrency, Number(value)))}` }] : []),
    ...(more.createdFrom || more.createdTo ? [{ id: "more:created", label: `Created: ${range(more.createdFrom, more.createdTo, formatDate)}` }] : []),
    ...(staleOnly ? [{ id: "stale", label: `Stale: no activity for ${options?.staleDays ?? 14}+ days` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "stale") setStaleOnly(false);
    else if (id === "more:accountId") setMore({ ...more, accountId: "", contactId: "" });
    else if (id === "more:expectedClose") setMore({ ...more, expectedCloseFrom: "", expectedCloseTo: "" });
    else if (id === "more:value") setMore({ ...more, valueMin: "", valueMax: "" });
    else if (id === "more:created") setMore({ ...more, createdFrom: "", createdTo: "" });
    else if (id.startsWith("more:")) setMore({ ...more, [id.slice("more:".length)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setStaleOnlyState(false);
    setMore(NO_MORE);
    setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Filters);
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "all";
  const draft = <K extends MoreKey>(key: K) => (value: string) => setMoreDraft((current) => ({ ...current, [key]: value }));

  if (optionsQuery.isError && !workspace.permissions.includes("crm.opportunities.view") && !workspace.permissions.includes("crm.opportunities.manage"))
    return <PermissionState title="You don't have access to opportunities" description="Ask an administrator for the View opportunities permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.opportunityId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={optionsQuery.isError ? "The opportunity filters could not be loaded. Refresh the page." : null} />

      <EnterpriseListPage
        header={{
          title: "Opportunities",
          description: "Deals in progress with your accounts. Move each through the sales stages, quote it, and mark it won or lost.",
          primaryAction: can?.create ? <LinkButton href="/crm/opportunities/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New opportunity</LinkButton> : undefined,
          secondaryActions: (
            <>
              <LinkButton href="/crm/opportunities/dashboard" variant="outline">Dashboard</LinkButton>
              {can?.export && (
                <a className={buttonVariants({ variant: "outline" })} href={opportunityExportUrl(listFilters)} download>
                  <Download className="size-4" aria-hidden="true" />Export
                </a>
              )}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as OpportunityViewKey) } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search opportunities" placeholder="Search name, number, account, contact or product" className="w-full sm:w-80" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  <Select aria-label="Stage" size="compact" selectedKey={filters.stageId} onSelectionChange={(key) => setFilters({ ...filters, stageId: String(key) })}
                    options={withAny(options.stages.map((entry) => ({ value: entry.id, label: entry.name })), "Any stage")} />
                  <Select aria-label="Status" size="compact" selectedKey={filters.status} onSelectionChange={(key) => setFilters({ ...filters, status: String(key) })}
                    options={withAny(options.statuses.map((entry) => ({ value: entry.code, label: entry.label })), "Any status")} />
                  <Select aria-label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select aria-label="Team" size="compact" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                    options={withAny(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                  <Select aria-label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={withAny(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select aria-label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  <PopoverTrigger>
                    <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Account, product, dates and value</Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(24rem,calc(100vw-4rem))] grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <AccountPicker label="Account" value={moreDraft.accountId || null}
                            onChange={(id, name) => { setMoreDraft((current) => ({ ...current, accountId: id ?? "", contactId: "" })); setNames({ account: name, contact: null }); }} />
                        </div>
                        <Select label="Contact" className="col-span-2" isDisabled={!moreDraft.accountId} selectedKey={moreDraft.contactId || ANY}
                          onSelectionChange={(key) => {
                            const id = String(key) === ANY ? "" : String(key);
                            draft("contactId")(id);
                            setNames((current) => ({ ...current, contact: accountContacts.find((row) => row.id === id)?.displayName ?? null }));
                          }}
                          options={withAny(accountContacts.map((row) => ({ value: row.id, label: row.displayName })), moreDraft.accountId ? "Any contact" : "Choose an account first")} />
                        <TextField label="Product / service" className="col-span-2" value={moreDraft.product} onChange={draft("product")} />
                        <DateInput label="Expected close from" value={moreDraft.expectedCloseFrom} onChange={draft("expectedCloseFrom")} />
                        <DateInput label="Expected close to" value={moreDraft.expectedCloseTo} onChange={draft("expectedCloseTo")} />
                        <TextField label="Value from" inputMode="decimal" value={moreDraft.valueMin} onChange={draft("valueMin")} />
                        <TextField label="Value to" inputMode="decimal" value={moreDraft.valueMax} onChange={draft("valueMax")} />
                        <DateInput label="Created from" value={moreDraft.createdFrom} onChange={draft("createdFrom")} />
                        <DateInput label="Created to" value={moreDraft.createdTo} onChange={draft("createdTo")} />
                        <Checkbox className="col-span-2" isSelected={staleOnly} onChange={setStaleOnly}>Only stale opportunities (open, no activity for {options.staleDays}+ days)</Checkbox>
                        <div className="col-span-2 flex justify-end gap-2">
                          <Button variant="ghost" size="compact" onPress={() => setMore(NO_MORE)}>Clear</Button>
                          <Button variant="primary" size="compact" onPress={() => setMore(moreDraft)}>Apply</Button>
                        </div>
                      </div>
                    </Popover>
                  </PopoverTrigger>
                </>
              )}
            </>
          ),
          end: (
            <>
              <ViewToggle label="Layout" value={layout} onChange={(id) => { setLayout(id as Layout); setSelection({}); }} options={[{ id: "list", label: "List" }, { id: "board", label: "Board" }]} />
              {layout === "list" && (
                <PopoverTrigger>
                  <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" />Columns</Button>
                  <Popover>
                    <div className="flex flex-col gap-2 p-1">
                      <p className="text-xs font-medium text-text-secondary">Show columns</p>
                      {OPTIONAL_COLUMNS.map((column) => (
                        <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
                      ))}
                    </div>
                  </Popover>
                </PopoverTrigger>
              )}
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
        bulkActionBar={layout === "list" && selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {(can?.assign || can?.reassign) && <Button variant="secondary" size="compact" onPress={() => setDialog("assign")}>Assign owner</Button>}
              {can?.changeStage && <Button variant="secondary" size="compact" onPress={() => setDialog("stage")}>Change stage</Button>}
              {can?.export && (
                <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={opportunityExportUrl({ view: view === "archived" ? "archived" : "all", ids: selectedIds.join(",") })} download>
                  Export selected
                </a>
              )}
            </>
          ),
        } : undefined}
      >
        {layout === "board" ? (options ? <OpportunityBoard filters={listFilters} options={options} /> : <LoadingState label="Loading pipeline" rows={6} />) : (
          <div className="flex flex-col gap-2">
            {listQuery.data && total > 0 && (
              <p className="text-sm text-text-secondary">
                {total} {total === 1 ? "opportunity" : "opportunities"} · value {formatMoney(baseCurrency, listQuery.data.totalValue)} · weighted {formatMoney(baseCurrency, listQuery.data.weightedValue)}
              </p>
            )}
            <EnterpriseDataGrid<Opportunity>
              aria-label="Opportunities"
              columns={columns}
              data={opportunities}
              getRowId={(row) => row.id}
              state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : opportunities.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
              loadingContent={<LoadingState label="Loading opportunities" rows={8} onRetry={() => void listQuery.refetch()} />}
              errorContent={<ErrorState title="Could not load opportunities" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
              emptyContent={
                <EmptyState title="No opportunities yet" description="Create one for an account, or convert a qualified lead."
                  action={can?.create ? { label: "New opportunity", onPress: () => router.push("/crm/opportunities/new") } : undefined} />
              }
              noResultsContent={<NoResultsState title="No opportunities match" description="Try a different view, search or filter." />}
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
              onRowClick={(row) => router.push(`/crm/opportunities/${row.id}`)}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-xs text-text-muted">{row.code}{row.accountName ? ` · ${row.accountName}` : ""}</span>
                  <span className="flex flex-wrap gap-1"><OpportunityStatusBadge status={row.status} /><OpportunityStageBadge opportunity={row} /><OpportunityFlags opportunity={row} /></span>
                  <span className="text-xs text-text-secondary">
                    {formatMoney(row.currencyCode ?? baseCurrency, row.amount)} · {row.probability}% · {row.ownerName ?? "Unassigned"}{row.expectedCloseDate ? ` · closes ${formatDate(row.expectedCloseDate)}` : ""}
                  </span>
                </div>
              )}
            />
          </div>
        )}
      </EnterpriseListPage>

      {options && (
        <>
          <AssignOpportunitiesDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} opportunityIds={selectedIds}
            opportunity={selectedIds.length === 1 ? opportunities.find((entry) => entry.id === selectedIds[0]) : undefined} options={options} onDone={refresh} />
          <ChangeStageDialog isOpen={dialog === "stage"} onOpenChange={(open) => !open && setDialog(null)} opportunityIds={selectedIds} options={options} onDone={refresh} />
        </>
      )}
    </div>
  );
}
