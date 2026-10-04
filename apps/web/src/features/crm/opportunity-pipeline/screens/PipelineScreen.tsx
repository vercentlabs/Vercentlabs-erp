"use client";

// The Opportunity Pipeline: the open deals by sales stage, as a board
// (default) or a list. Both read the same opportunities with the same
// filters, so they cannot disagree.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Download, Filter, Plus, Settings2 } from "lucide-react";
import {
  Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover, PopoverTrigger, SearchField, Select,
  TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import {
  getOpportunityOptions, listOpportunities, opportunityExportUrl,
  type Opportunity, type OpportunityBulkResult, type OpportunityListFilters, type OpportunityViewKey,
} from "@/features/crm/opportunities/api/opportunities-api";
import { AssignOpportunitiesDialog, ChangeStageDialog, MarkLostDialog, MarkWonDialog } from "@/features/crm/opportunities/components/OpportunityActionDialogs";
import { LogActivityDialog, ScheduleFollowUpDialog, useStartQuotation } from "@/features/crm/opportunities/components/OpportunityPanels";
import { LIVE_OPPORTUNITY_QUERY } from "@/features/crm/opportunities/live-query";
import { ErrorBanner, OpportunityFlags, OpportunityStageBadge, OpportunityStatusBadge, PRIORITY_OPTIONS } from "@/features/crm/opportunities/opportunity-format";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getPipeline, getPipelineSummary, type PipelineCardSort, type PipelineFilters, type PipelineStatus } from "../api/pipeline-api";
import { PipelineBoard } from "../components/PipelineBoard";
import type { CardAction } from "../components/PipelineCard";
import { PipelineBreakdowns, PipelineSummaryStrip, type SummaryPreset } from "../components/PipelineInsights";
import { QuickEditDialog } from "../components/QuickEditDialog";

const PAGE_SIZE = 25;
const ANY = "any";

// Ready-made pipelines. Each is a set of filters, nothing more.
type PresetId = "open" | "mine" | "team" | "closing_this_month" | "overdue" | "stale" | "high_value" | "no_next_activity";
const PRESETS: Array<{ id: PresetId; label: string; filters: Pick<PipelineFilters, "view" | "highValue" | "noNextActivity"> }> = [
  { id: "open", label: "Pipeline", filters: {} },
  { id: "mine", label: "My Pipeline", filters: { view: "mine" } },
  { id: "team", label: "Team Pipeline", filters: { view: "team" } },
  { id: "closing_this_month", label: "Closing This Month", filters: { view: "closing_this_month" } },
  { id: "overdue", label: "Overdue", filters: { view: "overdue" } },
  { id: "stale", label: "Stale", filters: { view: "stale" } },
  { id: "high_value", label: "High Value", filters: { highValue: "yes" } },
  { id: "no_next_activity", label: "No Next Activity", filters: { noNextActivity: "yes" } },
];
const STATUS_OPTIONS: Array<{ value: PipelineStatus; label: string }> = [
  { value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All statuses" },
];
const SORT_OPTIONS: Array<{ value: PipelineCardSort; label: string }> = [
  { value: "expectedCloseDate", label: "Sort: expected close" },
  { value: "amount", label: "Sort: deal value" },
  { value: "lastActivityAt", label: "Sort: last activity" },
  { value: "createdAt", label: "Sort: newest" },
  { value: "priority", label: "Sort: priority" },
];

type FilterKey = "stageId" | "ownerId" | "teamId" | "sourceId" | "priority";
const FILTER_KEYS: FilterKey[] = ["stageId", "ownerId", "teamId", "sourceId", "priority"];
const FILTER_NAMES: Record<FilterKey, string> = { stageId: "Stage", ownerId: "Owner", teamId: "Team", sourceId: "Source", priority: "Priority" };
type MoreKey = "accountId" | "product" | "expectedCloseFrom" | "expectedCloseTo" | "valueMin" | "valueMax" | "createdFrom" | "createdTo";
const MORE_KEYS: MoreKey[] = ["accountId", "product", "expectedCloseFrom", "expectedCloseTo", "valueMin", "valueMax", "createdFrom", "createdTo"];
const NO_MORE = Object.fromEntries(MORE_KEYS.map((key) => [key, ""])) as Record<MoreKey, string>;
const range = (from: string, to: string, show: (value: string) => string) => `${from ? show(from) : "any"} – ${to ? show(to) : "any"}`;

type Layout = "board" | "list";
type DialogState = { kind: CardAction; card: Opportunity } | { kind: "assign" | "stage" } | null;

export function PipelineScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [layout, setLayout] = useState<Layout>(params.get("layout") === "list" ? "list" : "board");
  const [preset, setPresetState] = useState<PresetId>(PRESETS.some((entry) => entry.id === params.get("preset")) ? (params.get("preset") as PresetId) : "open");
  const [status, setStatusState] = useState<PipelineStatus>(STATUS_OPTIONS.some((entry) => entry.value === params.get("status")) ? (params.get("status") as PipelineStatus) : "open");
  const [cardSort, setCardSort] = useState<PipelineCardSort>("expectedCloseDate");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Record<FilterKey, string>);
  const [more, setMoreState] = useState(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<MoreKey, string>);
  const [moreDraft, setMoreDraft] = useState(more);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([{ id: "expectedCloseDate", desc: false }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<OpportunityBulkResult | null>(null);

  // Changing what is shown starts the list again from the first page with nothing selected.
  const restart = () => { setPageIndex(0); setSelection({}); };
  const setPreset = (next: PresetId) => { setPresetState(next); if (next !== "open") setStatusState("open"); restart(); };
  const setStatus = (next: PipelineStatus) => { setStatusState(next); if (next !== "open") setPresetState("open"); restart(); };
  const setFilters = (next: Record<FilterKey, string>) => { setFiltersState(next); restart(); };
  const setMore = (next: Record<MoreKey, string>) => { setMoreState(next); setMoreDraft(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };

  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => { setSubmittedSearch(search.trim()); setPageIndex(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const currency = options?.baseCurrency ?? "INR";

  // One set of filters for the board, the list, the summary and the export.
  const shared = useMemo(() => ({
    ...PRESETS.find((entry) => entry.id === preset)?.filters,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
  }), [preset, submittedSearch, filters, more]);
  const pipelineFilters: PipelineFilters = useMemo(() => ({ ...shared, status, cardSort }), [shared, status, cardSort]);
  const listFilters: OpportunityListFilters = useMemo(() => ({
    ...shared,
    view: (shared.view ?? "all") as OpportunityViewKey,
    status: status === "all" ? undefined : status,
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [shared, status, sorting]);

  const pipelineKey = scopedQueryKey(workspace, "crm", "opportunities", "pipeline", pipelineFilters);
  const pipelineQuery = useQuery({ queryKey: pipelineKey, queryFn: () => getPipeline(pipelineFilters), placeholderData: keepPreviousData, ...LIVE_OPPORTUNITY_QUERY });
  const summaryQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "pipeline-summary", shared),
    queryFn: () => getPipelineSummary(shared),
    placeholderData: keepPreviousData,
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", listFilters, pageIndex),
    queryFn: () => listOpportunities({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: layout === "list",
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const pipeline = pipelineQuery.data;
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  // Every opportunity query (board, summary, list, record) starts with this key.
  const refresh = (result?: OpportunityBulkResult) => {
    if (result && result.results.length > 1) setBulkResult(result);
    setSelection({});
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity") });
  };
  const startQuotation = useStartQuotation(setError);
  const onCardAction = (kind: CardAction, card: Opportunity) => {
    setError(null);
    if (kind === "quotation") startQuotation.mutate(card);
    else setDialog({ kind, card });
  };
  const close = (isOpen: boolean) => !isOpen && setDialog(null);
  const card = dialog && "card" in dialog ? dialog.card : null;

  const columns = useMemo<ColumnDef<Opportunity, unknown>[]>(() => {
    const money = (row: Opportunity, amount: number) => <span className="tabular-nums whitespace-nowrap">{formatMoney(row.currencyCode ?? currency, amount)}</span>;
    return [
      {
        id: "name", accessorKey: "name", header: "Opportunity",
        cell: ({ row }) => (
          <span className="flex min-w-48 flex-col">
            <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">{row.original.name}<OpportunityFlags opportunity={row.original} /></span>
            <span className="text-xs whitespace-nowrap text-text-muted">{row.original.code}</span>
          </span>
        ),
      },
      { id: "accountName", accessorKey: "accountName", header: "Account", cell: ({ row }) => <span className="block min-w-36">{row.original.accountName ?? ""}</span> },
      { id: "stage", accessorKey: "stageName", header: "Stage", cell: ({ row }) => <OpportunityStageBadge opportunity={row.original} /> },
      { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <OpportunityStatusBadge status={row.original.status} /> },
      { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
      { id: "amount", accessorKey: "amount", header: "Value", cell: ({ row }) => money(row.original, row.original.amount) },
      { id: "probability", accessorKey: "probability", header: "Probability", cell: ({ row }) => <span className="tabular-nums">{row.original.probability}%</span> },
      { id: "weightedValue", accessorKey: "weightedValue", header: "Weighted value", cell: ({ row }) => money(row.original, row.original.weightedValue) },
      {
        id: "expectedCloseDate", accessorKey: "expectedCloseDate", header: "Expected close",
        cell: ({ row }) => <span className={`whitespace-nowrap ${row.original.isOverdue ? "font-medium text-danger" : ""}`}>{formatDate(row.original.expectedCloseDate)}</span>,
      },
      {
        id: "nextActivity", header: "Next activity", enableSorting: false,
        cell: ({ row }) => row.original.nextActivity
          ? <span className="block max-w-56 truncate">{row.original.nextActivity.subject}{row.original.nextActivity.dueAt ? ` · ${formatDate(row.original.nextActivity.dueAt)}` : ""}</span>
          : row.original.hasNoNextActivity ? <span className="whitespace-nowrap text-warning">No next activity</span> : "",
      },
      { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => formatDate(row.original.lastActivityAt) },
    ];
  }, [currency]);

  const withAny = (list: Array<{ value: string; label: string }>, anyLabel: string) => [{ value: ANY, label: anyLabel }, ...list];
  const ownerOptions = options
    ? withAny([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))], "Any owner")
    : [];
  const labelOf = (key: FilterKey, value: string) => {
    if (!options) return value;
    if (key === "stageId") return options.stages.find((entry) => entry.id === value)?.name ?? "Chosen stage";
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? "Chosen owner";
    if (key === "teamId") return options.teams.find((entry) => entry.id === value)?.name ?? "Chosen team";
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? "Chosen source";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const activeFilters: ActiveFilter[] = [
    ...(status !== "open" ? [{ id: "status", label: `Status: ${STATUS_OPTIONS.find((entry) => entry.value === status)?.label}` }] : []),
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Account: ${accountName ?? "chosen account"}` }] : []),
    ...(more.product.trim() ? [{ id: "more:product", label: `Product / service: ${more.product}` }] : []),
    ...(more.expectedCloseFrom || more.expectedCloseTo ? [{ id: "more:expectedClose", label: `Expected close: ${range(more.expectedCloseFrom, more.expectedCloseTo, formatDate)}` }] : []),
    ...(more.valueMin || more.valueMax ? [{ id: "more:value", label: `Value: ${range(more.valueMin, more.valueMax, (value) => formatMoney(currency, Number(value)))}` }] : []),
    ...(more.createdFrom || more.createdTo ? [{ id: "more:created", label: `Created: ${range(more.createdFrom, more.createdTo, formatDate)}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "status") setStatus("open");
    else if (id === "more:expectedClose") setMore({ ...more, expectedCloseFrom: "", expectedCloseTo: "" });
    else if (id === "more:value") setMore({ ...more, valueMin: "", valueMax: "" });
    else if (id === "more:created") setMore({ ...more, createdFrom: "", createdTo: "" });
    else if (id.startsWith("more:")) setMore({ ...more, [id.slice("more:".length)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setStatusState("open");
    setMore(NO_MORE);
    setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Record<FilterKey, string>);
  };
  const draft = (key: MoreKey) => (value: string) => setMoreDraft((current) => ({ ...current, [key]: value }));
  const onSummarySelect = (selected: SummaryPreset) => setPreset(selected);
  const stageListHref = (stageId: string) => {
    const search = new URLSearchParams(Object.entries({ ...listFilters, stageId, sortBy: undefined, sortDirection: undefined }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return `/crm/opportunities?${search.toString()}`;
  };

  if (optionsQuery.isError && !workspace.permissions.includes("crm.opportunities.view") && !workspace.permissions.includes("crm.opportunities.manage"))
    return <PermissionState title="You don't have access to the pipeline" description="Ask an administrator for the View opportunities permission." />;

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
      <ErrorBanner message={error ?? (optionsQuery.isError ? "The pipeline filters could not be loaded. Refresh the page." : null)} />

      <EnterpriseListPage
        header={{
          title: "Pipeline",
          description: "Your open deals by sales stage. Drag a card to move a deal; close it with Mark won or Mark lost.",
          primaryAction: can?.create ? <LinkButton href="/crm/opportunities/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New opportunity</LinkButton> : undefined,
          secondaryActions: (
            <>
              <LinkButton href="/crm/opportunities/dashboard" variant="outline">Reports</LinkButton>
              {can?.manageStages && <LinkButton href="/crm/settings/sales-stages" variant="outline"><Settings2 className="size-4" aria-hidden="true" />Sales stages</LinkButton>}
              {can?.export && (
                <a className={buttonVariants({ variant: "outline" })} href={opportunityExportUrl(listFilters)} download>
                  <Download className="size-4" aria-hidden="true" />Export
                </a>
              )}
            </>
          ),
        }}
        savedViews={{ views: PRESETS.map((entry) => ({ id: entry.id, label: entry.label })), activeViewId: preset, onSelect: (id) => setPreset(id as PresetId) }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search the pipeline" placeholder="Search opportunity, account, contact or number" className="w-full sm:w-80" value={search} onChange={setSearch}
                onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
              {options && (
                <>
                  <Select aria-label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select aria-label="Team" size="compact" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                    options={withAny(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                  <Select aria-label="Stage" size="compact" selectedKey={filters.stageId} onSelectionChange={(key) => setFilters({ ...filters, stageId: String(key) })}
                    options={withAny(options.stages.map((entry) => ({ value: entry.id, label: entry.name })), "Any stage")} />
                  <Select aria-label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={withAny(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select aria-label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key) as PipelineStatus)} options={STATUS_OPTIONS} />
                  <PopoverTrigger>
                    <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Account, product, dates and value</Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(24rem,calc(100vw-4rem))] grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <AccountPicker label="Account" value={moreDraft.accountId || null} onChange={(id, name) => { draft("accountId")(id ?? ""); setAccountName(name); }} />
                        </div>
                        <TextField label="Product / service" className="col-span-2" value={moreDraft.product} onChange={draft("product")} />
                        <DateInput label="Expected close from" value={moreDraft.expectedCloseFrom} onChange={draft("expectedCloseFrom")} />
                        <DateInput label="Expected close to" value={moreDraft.expectedCloseTo} onChange={draft("expectedCloseTo")} />
                        <TextField label="Value from" inputMode="decimal" value={moreDraft.valueMin} onChange={draft("valueMin")} />
                        <TextField label="Value to" inputMode="decimal" value={moreDraft.valueMax} onChange={draft("valueMax")} />
                        <DateInput label="Created from" value={moreDraft.createdFrom} onChange={draft("createdFrom")} />
                        <DateInput label="Created to" value={moreDraft.createdTo} onChange={draft("createdTo")} />
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
              {layout === "board" && <Select aria-label="Sort cards" size="compact" selectedKey={cardSort} onSelectionChange={(key) => setCardSort(String(key) as PipelineCardSort)} options={SORT_OPTIONS} />}
              <ViewToggle label="Layout" value={layout} onChange={(id) => { setLayout(id as Layout); setSelection({}); }} options={[{ id: "board", label: "Board" }, { id: "list", label: "List" }]} />
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
        bulkActionBar={layout === "list" && selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {(selectedIds.length === 1 ? can?.assign || can?.reassign : can?.bulkUpdate && can.reassign) && <Button variant="secondary" size="compact" onPress={() => setDialog({ kind: "assign" })}>Assign owner</Button>}
              {(selectedIds.length === 1 ? can?.changeStage : can?.bulkUpdate && can.changeStage) && <Button variant="secondary" size="compact" onPress={() => setDialog({ kind: "stage" })}>Change stage</Button>}
              {can?.export && <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={opportunityExportUrl({ view: "all", ids: selectedIds.join(",") })} download>Export selected</a>}
            </>
          ),
        } : undefined}
      >
        <div className="flex flex-col gap-4">
          {summaryQuery.data && <PipelineSummaryStrip summary={summaryQuery.data} currency={currency} onSelect={onSummarySelect} />}

          {layout === "board" ? (
            pipelineQuery.isLoading || !options ? <LoadingState label="Loading pipeline" rows={6} />
              : pipelineQuery.isError || !pipeline ? <ErrorState title="Could not load the pipeline" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void pipelineQuery.refetch() }} />
              : (
                <>
                  {status !== "open" && (
                    <p className="text-sm text-text-secondary">
                      {status === "all" ? "All opportunities" : status === "won" ? "Won opportunities" : "Lost opportunities"}, shown in the stage they were closed from: {pipeline.total} · {formatMoney(currency, pipeline.totalValue)}.
                      Cards move only on the open pipeline.
                    </p>
                  )}
                  <PipelineBoard pipeline={pipeline} pipelineKey={pipelineKey} options={options} stageListHref={stageListHref} onChanged={() => refresh()} onError={setError} onAction={onCardAction} />
                </>
              )
          ) : (
            <EnterpriseDataGrid<Opportunity>
              aria-label="Pipeline opportunities"
              columns={columns}
              data={rows}
              getRowId={(row) => row.id}
              state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? "no-results" : "ready"}
              loadingContent={<LoadingState label="Loading opportunities" rows={8} onRetry={() => void listQuery.refetch()} />}
              errorContent={<ErrorState title="Could not load opportunities" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
              noResultsContent={<NoResultsState title="No opportunities here" description="Try a different pipeline, search or filter." />}
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
              onRowClick={(row) => router.push(`/crm/opportunities/${row.id}`)}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-xs text-text-muted">{row.code}{row.accountName ? ` · ${row.accountName}` : ""}</span>
                  <span className="flex flex-wrap gap-1"><OpportunityStageBadge opportunity={row} /><OpportunityFlags opportunity={row} /></span>
                  <span className="text-xs text-text-secondary">{formatMoney(row.currencyCode ?? currency, row.amount)} · {row.probability}% · {row.ownerName ?? "Unassigned"}</span>
                </div>
              )}
            />
          )}

          {summaryQuery.data && (
            <PipelineBreakdowns summary={summaryQuery.data} pipeline={status === "open" ? pipeline : undefined} currency={currency}
              onSelectOwner={(ownerId) => setFilters({ ...filters, ownerId: ownerId ?? "unassigned" })} />
          )}
        </div>
      </EnterpriseListPage>

      {options && (
        <>
          <AssignOpportunitiesDialog isOpen={dialog?.kind === "assign"} onOpenChange={close} opportunityIds={selectedIds}
            opportunity={selectedIds.length === 1 ? rows.find((entry) => entry.id === selectedIds[0]) : undefined} options={options} onDone={refresh} />
          <ChangeStageDialog isOpen={dialog?.kind === "stage"} onOpenChange={close} opportunityIds={selectedIds} options={options} onDone={refresh} />
          {card && dialog?.kind === "quickEdit" && <QuickEditDialog opportunity={card} options={options} onClose={() => setDialog(null)} onSaved={() => refresh()} />}
          {card && dialog?.kind === "won" && <MarkWonDialog isOpen onOpenChange={close} opportunity={card} onDone={() => refresh()} />}
          {card && dialog?.kind === "lost" && <MarkLostDialog isOpen onOpenChange={close} options={options} opportunity={card} onDone={() => refresh()} />}
          {card && dialog?.kind === "activity" && <LogActivityDialog isOpen onOpenChange={close} opportunity={card} options={options} onDone={() => refresh()} />}
          {card && (dialog?.kind === "followUp" || dialog?.kind === "task") && (
            <ScheduleFollowUpDialog key={dialog.kind} isOpen onOpenChange={close} opportunity={card} options={options} onDone={() => refresh()} initialType={dialog.kind === "task" ? "task" : "call"} />
          )}
        </>
      )}
    </div>
  );
}
