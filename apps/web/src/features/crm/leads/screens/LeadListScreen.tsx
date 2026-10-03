"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Download, Filter, Plus, Upload } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getLeadOptions, leadExportUrl, listLeads, type Lead, type LeadBulkResult, type LeadListFilters, type LeadViewKey } from "../api/leads-api";
import { ChangeStageDialog, DisqualifyLeadsDialog } from "../components/LeadActionDialogs";
import { AssignLeadsDialog } from "../components/LeadAssignment";
import { ErrorBanner, FollowUpCell, LeadStageBadge, LeadStatusBadge, PRIORITY_OPTIONS, PriorityBadge, RATING_OPTIONS, RatingBadge, leadName } from "../lead-format";
import { LIVE_LEAD_QUERY } from "../live-query";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.leads.columns";

// Columns the user can hide. Lead and status always stay visible.
const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "companyName", label: "Company" },
  { id: "stage", label: "Stage" },
  { id: "ownerName", label: "Owner" },
  { id: "sourceName", label: "Source" },
  { id: "priority", label: "Priority" },
  { id: "rating", label: "Rating" },
  { id: "estimatedValue", label: "Estimated value" },
  { id: "nextFollowUpAt", label: "Next follow-up" },
  { id: "lastActivityAt", label: "Last activity", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
  { id: "assignedAt", label: "Assigned", hiddenByDefault: true },
  { id: "contact", label: "Contact", hiddenByDefault: true },
  { id: "tags", label: "Tags", hiddenByDefault: true },
  { id: "createdAt", label: "Created" },
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

type FilterKey = "stage" | "ownerId" | "sourceId" | "priority" | "rating" | "teamId" | "qualificationStatus";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { stage: ANY, ownerId: ANY, sourceId: ANY, priority: ANY, rating: ANY, teamId: ANY, qualificationStatus: ANY };

// Where the lead is, what it wants and how long it has waited: the filters
// the unassigned queue is worked by.
type QueueFilters = { state: string; city: string; productInterest: string; olderThanDays: string };
const NO_QUEUE_FILTERS: QueueFilters = { state: "", city: "", productInterest: "", olderThanDays: "" };
const QUEUE_FILTER_NAMES: Record<keyof QueueFilters, string> = { state: "State", city: "City", productInterest: "Interest", olderThanDays: "Waiting" };
const AGE_OPTIONS = [
  { value: ANY, label: "Any age" },
  ...[1, 2, 3, 7, 14, 30].map((days) => ({ value: String(days), label: `Created more than ${days} ${days === 1 ? "day" : "days"} ago` })),
];

type DialogKind = "assign" | "stage" | "disqualify" | null;

export function LeadListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [view, setViewState] = useState<LeadViewKey>((params.get("view") as LeadViewKey) || "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>({
    stage: params.get("stage") ?? ANY,
    ownerId: params.get("ownerId") ?? ANY,
    sourceId: params.get("sourceId") ?? ANY,
    priority: params.get("priority") ?? ANY,
    rating: params.get("rating") ?? ANY,
    teamId: params.get("teamId") ?? ANY,
    qualificationStatus: params.get("qualificationStatus") ?? ANY,
  });
  const [queue, setQueueState] = useState<QueueFilters>({
    state: params.get("state") ?? "", city: params.get("city") ?? "", productInterest: params.get("productInterest") ?? "", olderThanDays: params.get("olderThanDays") ?? "",
  });
  const [queueDraft, setQueueDraft] = useState<QueueFilters>(queue);
  const [created, setCreated] = useState({ from: params.get("createdFrom") ?? "", to: params.get("createdTo") ?? "" });
  const [sorting, setSortingState] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(storedVisibility);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [bulkResult, setBulkResult] = useState<LeadBulkResult | null>(null);

  // Changing what is listed starts again from the first page with nothing selected.
  const restart = () => {
    setPageIndex(0);
    setSelection({});
  };
  const setView = (next: LeadViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Filters) => { setFiltersState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  const setQueue = (next: QueueFilters) => { setQueueState(next); setQueueDraft(next); restart(); };
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

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const listFilters: LeadListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    createdFrom: created.from || undefined,
    createdTo: created.to || undefined,
    ...Object.fromEntries(Object.entries(queue).filter(([, value]) => value.trim())),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, created, queue, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", listFilters, pageIndex),
    queryFn: () => listLeads({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE_LEAD_QUERY,
  });
  const leads = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const can = options?.capabilities;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(() => [
    {
      id: "name",
      accessorFn: (row) => leadName(row),
      header: "Lead",
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-40 flex-col">
          <span className="font-medium text-text">{leadName(row.original)}</span>
          <span className="text-xs whitespace-nowrap text-text-muted">{row.original.code}{row.original.jobTitle ? ` · ${row.original.jobTitle}` : ""}</span>
        </span>
      ),
    },
    { id: "companyName", accessorKey: "companyName", header: "Company", cell: ({ row }) => <span className="block min-w-36">{row.original.companyName ?? ""}</span> },
    { id: "status", accessorKey: "status", header: "Status", enableHiding: false, cell: ({ row }) => <LeadStatusBadge status={row.original.status} /> },
    { id: "stage", accessorKey: "stage", header: "Stage", cell: ({ row }) => <LeadStageBadge stage={row.original.stage} /> },
    { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    { id: "sourceName", accessorKey: "sourceName", header: "Source", cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
    { id: "rating", accessorKey: "rating", header: "Rating", cell: ({ row }) => <RatingBadge rating={row.original.rating} /> },
    {
      id: "estimatedValue",
      accessorKey: "estimatedValue",
      header: "Estimated value",
      cell: ({ row }) => <span className="tabular-nums">{row.original.estimatedValue ? formatMoney(row.original.currencyCode ?? options?.baseCurrency, row.original.estimatedValue) : ""}</span>,
    },
    { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <FollowUpCell value={row.original.nextFollowUpAt} /> },
    { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => formatDate(row.original.lastActivityAt) },
    { id: "teamName", accessorKey: "teamName", header: "Team", cell: ({ row }) => row.original.teamName ?? "" },
    { id: "assignedAt", accessorKey: "assignedAt", header: "Assigned", cell: ({ row }) => formatDate(row.original.assignedAt) },
    {
      id: "contact",
      header: "Contact",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col text-xs">
          <span>{row.original.email}</span>
          <span className="text-text-muted">{row.original.mobile || row.original.phone}</span>
        </span>
      ),
    },
    { id: "tags", header: "Tags", enableSorting: false, cell: ({ row }) => row.original.tags.map((tag) => tag.name).join(", ") },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
  ], [options?.baseCurrency]);

  const refresh = (result?: LeadBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  };

  const filterOptions = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const ownerOptions = options
    ? filterOptions([
        { value: "me", label: "Me" },
        { value: "team", label: "My team" },
        { value: "unassigned", label: "Unassigned" },
        ...options.users.map((user) => ({ value: user.id, label: user.name })),
      ], "Any owner")
    : [];
  const labelOf = (key: FilterKey, value: string) => {
    if (!options) return value;
    if (key === "stage") return options.stages.find((entry) => entry.code === value)?.label ?? value;
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? value;
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? value;
    if (key === "teamId") return options.teams.find((entry) => entry.id === value)?.name ?? value;
    if (key === "qualificationStatus") return options.qualificationStatuses.find((entry) => entry.code === value)?.label ?? value;
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const FILTER_NAMES: Record<FilterKey, string> = { stage: "Stage", ownerId: "Owner", sourceId: "Source", priority: "Priority", rating: "Rating", teamId: "Team", qualificationStatus: "Qualification" };
  const activeFilters: ActiveFilter[] = [
    ...(Object.keys(filters) as FilterKey[])
      .filter((key) => filters[key] !== ANY)
      .map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(Object.keys(queue) as Array<keyof QueueFilters>)
      .filter((key) => queue[key].trim())
      .map((key) => ({ id: `queue:${key}`, label: key === "olderThanDays" ? `Waiting: more than ${queue[key]} ${queue[key] === "1" ? "day" : "days"}` : `${QUEUE_FILTER_NAMES[key]}: ${queue[key]}` })),
    // Set by links from the dashboards; removable here.
    ...(created.from || created.to ? [{ id: "created", label: `Created: ${created.from ? formatDate(created.from) : "start"} – ${created.to ? formatDate(created.to) : "today"}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "created") {
      setCreated({ from: "", to: "" });
      restart();
    } else if (id.startsWith("queue:")) setQueue({ ...queue, [id.slice("queue:".length)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setCreated({ from: "", to: "" });
    setQueue(NO_QUEUE_FILTERS);
    setFilters(NO_FILTERS);
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "all";

  if (optionsQuery.isError && !workspace.permissions.includes("crm.leads.view"))
    return <PermissionState title="You don't have access to leads" description="Ask an administrator for the View leads permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">
              {bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.
            </p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => (
              <p key={entry.leadId} className="text-text-secondary">{entry.message}</p>
            ))}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={optionsQuery.isError ? "The lead filters could not be loaded. Refresh the page." : null} />

      <EnterpriseListPage
        header={{
          title: "Leads",
          description: "People and companies that might buy. Work each lead until it is qualified, then convert it into an account, contact and opportunity.",
          primaryAction: can?.create ? (
            <LinkButton href="/crm/leads/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New lead</LinkButton>
          ) : undefined,
          secondaryActions: (
            <>
              <LinkButton href="/crm/leads/dashboard" variant="outline">Dashboard</LinkButton>
              {can?.import && <LinkButton href="/crm/leads/import" variant="outline"><Upload className="size-4" aria-hidden="true" />Import</LinkButton>}
              {can?.export && (
                <a className={buttonVariants({ variant: "outline" })} href={leadExportUrl(listFilters)} download>
                  <Download className="size-4" aria-hidden="true" />Export
                </a>
              )}
            </>
          ),
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as LeadViewKey) } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search leads" placeholder="Search name, company, email, phone or lead number" className="w-full sm:w-80" value={search} onChange={setSearch} onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  <Select aria-label="Stage" size="compact" selectedKey={filters.stage} onSelectionChange={(key) => setFilters({ ...filters, stage: String(key) })}
                    options={filterOptions(options.stages.map((entry) => ({ value: entry.code, label: entry.label })), "Any stage")} />
                  <Select aria-label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select aria-label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={filterOptions(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select aria-label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={filterOptions(PRIORITY_OPTIONS, "Any priority")} />
                  <Select aria-label="Qualification" size="compact" selectedKey={filters.qualificationStatus} onSelectionChange={(key) => setFilters({ ...filters, qualificationStatus: String(key) })}
                    options={filterOptions(options.qualificationStatuses.map((entry) => ({ value: entry.code, label: entry.label })), "Any qualification")} />
                  <Select aria-label="Rating" size="compact" selectedKey={filters.rating} onSelectionChange={(key) => setFilters({ ...filters, rating: String(key) })} options={filterOptions(RATING_OPTIONS, "Any rating")} />
                  <PopoverTrigger>
                    <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Location, interest and age</Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(22rem,calc(100vw-4rem))] grid-cols-2 gap-3">
                        <Select label="Team" className="col-span-2" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                          options={filterOptions(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                        <TextField label="State" value={queueDraft.state} onChange={(state) => setQueueDraft({ ...queueDraft, state })} />
                        <TextField label="City" value={queueDraft.city} onChange={(city) => setQueueDraft({ ...queueDraft, city })} />
                        <TextField label="Product / service interest" className="col-span-2" value={queueDraft.productInterest} onChange={(productInterest) => setQueueDraft({ ...queueDraft, productInterest })} />
                        <Select label="Waiting" className="col-span-2" selectedKey={queueDraft.olderThanDays || ANY}
                          onSelectionChange={(key) => setQueueDraft({ ...queueDraft, olderThanDays: String(key) === ANY ? "" : String(key) })} options={AGE_OPTIONS} />
                        <div className="col-span-2 flex justify-end gap-2">
                          <Button variant="ghost" size="compact" onPress={() => setQueue(NO_QUEUE_FILTERS)}>Clear</Button>
                          <Button variant="primary" size="compact" onPress={() => setQueue(queueDraft)}>Apply</Button>
                        </div>
                      </div>
                    </Popover>
                  </PopoverTrigger>
                </>
              )}
            </>
          ),
          end: (
            <PopoverTrigger>
              <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" />Columns</Button>
              <Popover>
                <div className="flex flex-col gap-2 p-1">
                  <p className="text-xs font-medium text-text-secondary">Show columns</p>
                  {OPTIONAL_COLUMNS.map((column) => (
                    <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>
                      {column.label}
                    </Checkbox>
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
              {(selectedIds.length === 1 ? can?.assign || can?.reassign : can?.bulkAssign) && <Button variant="secondary" size="compact" onPress={() => setDialog("assign")}>Assign</Button>}
              {can?.edit && <Button variant="secondary" size="compact" onPress={() => setDialog("stage")}>Change stage</Button>}
              {can?.disqualify && <Button variant="secondary" size="compact" onPress={() => setDialog("disqualify")}>Disqualify</Button>}
              {can?.export && (
                <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={leadExportUrl({ view: view === "archived" ? "archived" : "all", ids: selectedIds.join(",") })} download>
                  Export selected
                </a>
              )}
            </>
          ),
        } : undefined}
      >
        <EnterpriseDataGrid<Lead>
          aria-label="Leads"
          columns={columns}
          data={leads}
          getRowId={(row) => row.id}
          state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : leads.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading leads" rows={8} onRetry={() => void listQuery.refetch()} />}
          errorContent={<ErrorState title="Could not load leads" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
          emptyContent={
            <EmptyState
              title="No leads yet"
              description="Add your first lead, or import a list from a spreadsheet."
              action={can?.create ? { label: "New lead", onPress: () => router.push("/crm/leads/new") } : undefined}
            />
          }
          noResultsContent={<NoResultsState title="No leads match" description="Try a different view, search or filter." />}
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
          onRowClick={(row) => router.push(`/crm/leads/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="font-medium">{leadName(row)}</span>
              <span className="text-xs text-text-muted">{row.code}{row.companyName && row.fullName ? ` · ${row.companyName}` : ""}</span>
              <span className="flex flex-wrap gap-1"><LeadStatusBadge status={row.status} /><LeadStageBadge stage={row.stage} /></span>
              {(row.ownerName || row.nextFollowUpAt) && (
                <span className="text-xs text-text-secondary">{row.ownerName ?? "Unassigned"}{row.nextFollowUpAt ? ` · Follow-up ${formatDate(row.nextFollowUpAt)}` : ""}</span>
              )}
            </div>
          )}
        />
      </EnterpriseListPage>

      {options && (
        <>
          <AssignLeadsDialog isOpen={dialog === "assign"} onOpenChange={(open) => !open && setDialog(null)} leadIds={selectedIds}
            lead={selectedIds.length === 1 ? leads.find((entry) => entry.id === selectedIds[0]) : undefined} options={options} onDone={refresh} />
          <ChangeStageDialog isOpen={dialog === "stage"} onOpenChange={(open) => !open && setDialog(null)} leadIds={selectedIds} options={options} onDone={refresh} />
          <DisqualifyLeadsDialog isOpen={dialog === "disqualify"} onOpenChange={(open) => !open && setDialog(null)} leadIds={selectedIds} options={options} onDone={refresh} />
        </>
      )}
    </div>
  );
}
