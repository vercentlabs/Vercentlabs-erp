"use client";

// The pipeline: the open deals by sales stage, as a board. The List toggle opens Deals with the same filters (one list, not two); the
// breakdowns by owner, stage and source live on the deal dashboard. Four figures sit above the board, each choosing its deals.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2 } from "lucide-react";
import { EnterpriseListPage, ErrorState, LinkButton, PermissionState, SearchField, Select, TextField, type ActiveFilter } from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { getOpportunityOptions, opportunityExportUrl, type Opportunity, type OpportunityListFilters, type OpportunityViewKey } from "@/features/crm/opportunities/api/opportunities-api";
import { MarkLostDialog, MarkWonDialog } from "@/features/crm/close-reasons/components/CloseDialogs";
import { LogActivityDialog } from "@/features/crm/opportunities/components/OpportunityPanels";
import { createQuotationHref } from "@/features/crm/quotations/screens/CreateQuotationScreen";
import { ScheduleFollowUpForRecord } from "@/features/crm/follow-ups/components/RelatedFollowUpsPanel";
import { getTaskOptions } from "@/features/crm/tasks/api/tasks-api";
import { TaskFormDialog } from "@/features/crm/tasks/components/TaskDialogs";
import { LIVE_OPPORTUNITY_QUERY } from "@/features/crm/opportunities/live-query";
import { ErrorBanner, PRIORITY_OPTIONS } from "@/features/crm/opportunities/opportunity-format";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getPipeline, getPipelineSummary, type PipelineCardSort, type PipelineFilters, type PipelineStatus } from "../api/pipeline-api";
import { PipelineBoard } from "../components/PipelineBoard";
import type { CardAction } from "../components/PipelineCard";
import { PipelineSummaryStrip, type SummaryPreset } from "../components/PipelineInsights";
import { QuickEditDialog } from "../components/QuickEditDialog";

const ANY = "any";

// Ready-made pipelines. Each is a set of filters, nothing more. Mine · Team · All and the three switches are chips; the rest sit under More views.
type PresetId = "open" | "mine" | "team" | "closing_this_month" | "overdue" | "stale" | "high_value" | "no_next_activity";
const PRESETS: Array<{ id: PresetId; label: string; filters: Pick<PipelineFilters, "view" | "highValue" | "noNextActivity"> }> = [
  { id: "mine", label: "Mine", filters: { view: "mine" } },
  { id: "team", label: "Team", filters: { view: "team" } },
  { id: "open", label: "All", filters: {} },
  { id: "overdue", label: "Overdue", filters: { view: "overdue" } },
  { id: "stale", label: "Stale", filters: { view: "stale" } },
  { id: "no_next_activity", label: "No next activity", filters: { noNextActivity: "yes" } },
  { id: "closing_this_month", label: "Closing this month", filters: { view: "closing_this_month" } },
  { id: "high_value", label: "High value", filters: { highValue: "yes" } },
];
const PINNED_PRESETS: PresetId[] = ["mine", "team", "open", "overdue", "stale", "no_next_activity"];
const STATUS_OPTIONS: Array<{ value: PipelineStatus; label: string }> = [
  { value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All statuses" },
];
const SORT_OPTIONS: Array<{ value: PipelineCardSort; label: string }> = [
  { value: "expectedCloseDate", label: "Sort: close date" },
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

type DialogState = { kind: CardAction; card: Opportunity } | null;

export function PipelineScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [preset, setPresetState] = useState<PresetId>(PRESETS.some((entry) => entry.id === params.get("preset")) ? (params.get("preset") as PresetId) : "open");
  const [status, setStatusState] = useState<PipelineStatus>(STATUS_OPTIONS.some((entry) => entry.value === params.get("status")) ? (params.get("status") as PipelineStatus) : "open");
  const [cardSort, setCardSort] = useState<PipelineCardSort>("expectedCloseDate");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [filters, setFilters] = useState(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Record<FilterKey, string>);
  const [more, setMore] = useState(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<MoreKey, string>);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);

  const setPreset = (next: PresetId) => { setPresetState(next); if (next !== "open") setStatusState("open"); };
  const setStatus = (next: PipelineStatus) => { setStatusState(next); if (next !== "open") setPresetState("open"); };
  const setMoreKey = (key: MoreKey) => (value: string) => setMore({ ...more, [key]: value });

  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const currency = options?.baseCurrency ?? "INR";

  // One set of filters for the board, the figures, the export and the Deals list.
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
  }), [shared, status]);
  const listHref = (extra: Partial<OpportunityListFilters> = {}) => {
    const search = new URLSearchParams(Object.entries({ ...listFilters, ...extra }).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
    if (more.accountId && accountName) search.set("accountName", accountName);
    return `/crm/opportunities?${search.toString()}`;
  };

  // The old list layout (?layout=list) is the Deals list now.
  useEffect(() => {
    if (params.get("layout") === "list") router.replace(listHref());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for an old link
  }, []);

  const pipelineKey = scopedQueryKey(workspace, "crm", "opportunities", "pipeline", pipelineFilters);
  const pipelineQuery = useQuery({ queryKey: pipelineKey, queryFn: () => getPipeline(pipelineFilters), placeholderData: keepPreviousData, ...LIVE_OPPORTUNITY_QUERY });
  const summaryQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "pipeline-summary", shared),
    queryFn: () => getPipelineSummary(shared),
    placeholderData: keepPreviousData,
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const pipeline = pipelineQuery.data;

  // Every deal query (board, figures, list, record) starts with this key.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity") });
  };
  const taskOptions = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000, enabled: dialog?.kind === "task" }).data;
  const onCardAction = (kind: CardAction, card: Opportunity) => {
    setError(null);
    if (kind === "quotation") router.push(createQuotationHref(card.id));
    else setDialog({ kind, card });
  };
  const close = (isOpen: boolean) => !isOpen && setDialog(null);
  const card = dialog?.card ?? null;

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
    ...(more.accountId ? [{ id: "more:accountId", label: `Company: ${accountName ?? "chosen company"}` }] : []),
    ...(more.product.trim() ? [{ id: "more:product", label: `Product / service: ${more.product}` }] : []),
    ...(more.expectedCloseFrom || more.expectedCloseTo ? [{ id: "more:expectedClose", label: `Close date: ${range(more.expectedCloseFrom, more.expectedCloseTo, formatDate)}` }] : []),
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
  const onSummarySelect = (selected: SummaryPreset) => setPreset(selected);

  if (optionsQuery.isError && !workspace.permissions.includes("crm.opportunities.view") && !workspace.permissions.includes("crm.opportunities.manage"))
    return <PermissionState title="You don't have access to the pipeline" description="Ask an administrator for the View deals permission." />;

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error ?? (optionsQuery.isError ? "The pipeline filters could not be loaded. Refresh the page." : null)} />

      <EnterpriseListPage
        header={{
          title: "Pipeline",
          description: "Your open deals by sales stage. Drag a card, use Move to, or press ← / → on a card to move a deal; close it with Mark won or Mark lost.",
          primaryAction: can?.create ? <LinkButton href="/crm/opportunities/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New deal</LinkButton> : undefined,
          secondaryActions: (
            <>
              <LinkButton href="/crm/opportunities/dashboard" variant="outline">Dashboard</LinkButton>
              {can?.manageStages && (
                <LinkButton href="/crm/settings/opportunities/stages" variant="ghost" aria-label="Sales stages (Setup)"><Settings2 className="size-4" aria-hidden="true" /></LinkButton>
              )}
              {can?.export && <MoreMenu label="More pipeline actions" items={[{ id: "export", label: "Export", onAction: () => { window.location.href = opportunityExportUrl(listFilters); } }]} />}
            </>
          ),
        }}
        savedViews={{ views: PRESETS.map((entry) => ({ id: entry.id, label: entry.label })), activeViewId: preset, onSelect: (id) => setPreset(id as PresetId), pinned: PINNED_PRESETS }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search the pipeline" placeholder="Search deal, company, contact or number" className="w-full sm:min-w-64 sm:flex-1" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <Select label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select label="Team" size="compact" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                    options={withAny(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                  <Select label="Stage" size="compact" selectedKey={filters.stageId} onSelectionChange={(key) => setFilters({ ...filters, stageId: String(key) })}
                    options={withAny(options.stages.map((entry) => ({ value: entry.id, label: entry.name })), "Any stage")} />
                  <Select label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key) as PipelineStatus)} options={STATUS_OPTIONS} />
                  <Select label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={withAny(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  <p className="col-span-2 border-t border-border pt-3 text-xs font-medium text-text-secondary">Who, what and when</p>
                  <div className="col-span-2">
                    <AccountPicker label="Company" value={more.accountId || null} onChange={(id, name) => { setMoreKey("accountId")(id ?? ""); setAccountName(name); }} />
                  </div>
                  <TextField label="Product / service" className="col-span-2" value={more.product} onChange={setMoreKey("product")} />
                  <DateInput label="Close date from" value={more.expectedCloseFrom} onChange={setMoreKey("expectedCloseFrom")} />
                  <DateInput label="Close date to" value={more.expectedCloseTo} onChange={setMoreKey("expectedCloseTo")} />
                  <TextField label="Value from" inputMode="decimal" value={more.valueMin} onChange={setMoreKey("valueMin")} />
                  <TextField label="Value to" inputMode="decimal" value={more.valueMax} onChange={setMoreKey("valueMax")} />
                  <DateInput label="Created from" value={more.createdFrom} onChange={setMoreKey("createdFrom")} />
                  <DateInput label="Created to" value={more.createdTo} onChange={setMoreKey("createdTo")} />
                </FiltersPopover>
              )}
            </>
          ),
          end: (
            <>
              <Select aria-label="Sort cards" size="compact" selectedKey={cardSort} onSelectionChange={(key) => setCardSort(String(key) as PipelineCardSort)} options={SORT_OPTIONS} />
              <ViewToggle label="Layout" value="board" onChange={(id) => { if (id === "list") router.push(listHref()); }} options={[{ id: "board", label: "Board" }, { id: "list", label: "List" }]} />
            </>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
      >
        <div className="flex flex-col gap-4">
          {summaryQuery.data && <PipelineSummaryStrip summary={summaryQuery.data} currency={currency} onSelect={onSummarySelect} />}

          {pipelineQuery.isLoading || !options ? <LoadingState label="Loading pipeline" rows={6} />
            : pipelineQuery.isError || !pipeline ? <ErrorState title="Could not load the pipeline" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void pipelineQuery.refetch() }} />
            : (
              <>
                {status !== "open" && (
                  <p className="text-sm text-text-secondary">
                    {status === "all" ? "All deals" : status === "won" ? "Won deals" : "Lost deals"}, shown in the stage they were closed from: {pipeline.total} · {formatMoney(currency, pipeline.totalValue)}.
                    Cards move only on the open pipeline.
                  </p>
                )}
                <PipelineBoard pipeline={pipeline} pipelineKey={pipelineKey} options={options} stageListHref={(stageId) => listHref({ stageId })} onChanged={refresh} onError={setError} onAction={onCardAction} />
              </>
            )}
        </div>
      </EnterpriseListPage>

      {options && card && (
        <>
          {dialog?.kind === "quickEdit" && <QuickEditDialog opportunity={card} options={options} onClose={() => setDialog(null)} onSaved={refresh} />}
          {dialog?.kind === "won" && <MarkWonDialog isOpen onOpenChange={close} options={options} opportunity={card} onDone={refresh} />}
          {dialog?.kind === "lost" && <MarkLostDialog isOpen onOpenChange={close} options={options} opportunity={card} onDone={refresh} />}
          {dialog?.kind === "activity" && <LogActivityDialog isOpen onOpenChange={close} opportunity={card} options={options} onDone={refresh} />}
          {dialog?.kind === "followUp" && (
            <ScheduleFollowUpForRecord isOpen onOpenChange={close} related={{ type: "opportunity", id: card.id, name: card.name, accountId: card.accountId }} onDone={refresh} />
          )}
          {dialog?.kind === "task" && taskOptions && (
            <TaskFormDialog isOpen onOpenChange={close} options={taskOptions} related={{ type: "opportunity", id: card.id, name: card.name }} onSaved={refresh} />
          )}
        </>
      )}
    </div>
  );
}
