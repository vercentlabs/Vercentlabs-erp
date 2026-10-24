"use client";

// Deals: every deal, any status, as a list. The common views are chips (My deals, Closing this month, Overdue, Won, Lost) with the rest under
// More views; one Filters button holds every filter, each applying the moment it changes, and the active ones show as chips. New deal is the
// primary action; Export sits in the "…" menu and the dashboard is under Insights.
import { SavedViews } from "@/features/crm/shared/ui/SavedViews";
import { TagList } from "@/features/crm/shared/ui/TagChips";
import { UnconvertedNotice } from "@/features/crm/shared/ui/UnconvertedNotice";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Plus } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ON_SCREEN_EXPORT_LIMIT, startExport } from "@/features/crm/shared/data-jobs-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { CustomFieldFilters, customFilterParams } from "@/features/crm/shared/ui/CustomFields";
import {
  getOpportunityOptions, listOpportunities, opportunityExportUrl,
  type Opportunity, type OpportunityBulkResult, type OpportunityListFilters, type OpportunityViewKey,
} from "../api/opportunities-api";
import { AssignOpportunitiesDialog, ChangeStageDialog } from "../components/OpportunityActionDialogs";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { ErrorBanner, OpportunityFlags, OpportunityStageBadge, OpportunityStatusBadge, PRIORITY_OPTIONS, PriorityBadge, STATUS_LABELS, days } from "../opportunity-format";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.opportunities.columns.v2";
const PINNED_VIEWS = ["mine", "closing_this_month", "overdue", "won", "lost"];

// Columns the user can hide; the deal name always stays. Eight show by default.
const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "accountName", label: "Company" },
  { id: "stage", label: "Stage" },
  { id: "amount", label: "Value" },
  { id: "expectedCloseDate", label: "Close date" },
  { id: "ownerName", label: "Owner" },
  { id: "nextActivity", label: "Next activity" },
  { id: "lastActivityAt", label: "Last activity" },
  { id: "status", label: "Status", hiddenByDefault: true },
  { id: "probability", label: "Probability", hiddenByDefault: true },
  { id: "weightedValue", label: "Expected value", hiddenByDefault: true },
  { id: "priority", label: "Priority", hiddenByDefault: true },
  { id: "nextStep", label: "Next step", hiddenByDefault: true },
  { id: "nextFollowUpAt", label: "Next follow-up", hiddenByDefault: true },
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

type FilterKey = "status" | "stageId" | "ownerId" | "teamId" | "sourceId" | "priority" | "campaignId" | "medium" | "tagId" | "recurringPlanId";
type Filters = Record<FilterKey, string>;
const FILTER_KEYS: FilterKey[] = ["status", "stageId", "ownerId", "teamId", "sourceId", "priority", "campaignId", "medium", "tagId", "recurringPlanId"];
const FILTER_NAMES: Record<FilterKey, string> = { status: "Status", stageId: "Stage", ownerId: "Owner", teamId: "Team", sourceId: "Source", priority: "Priority", campaignId: "Campaign", medium: "Came through", tagId: "Tag", recurringPlanId: "Repeat plan" };

// Who the deal is with, what is sold, and the ranges.
type MoreKey = "accountId" | "contactId" | "product" | "expectedCloseFrom" | "expectedCloseTo" | "closedFrom" | "closedTo" | "valueMin" | "valueMax" | "createdFrom" | "createdTo";
type MoreFilters = Record<MoreKey, string>;
const MORE_KEYS: MoreKey[] = ["accountId", "contactId", "product", "expectedCloseFrom", "expectedCloseTo", "closedFrom", "closedTo", "valueMin", "valueMax", "createdFrom", "createdTo"];
const NO_MORE = Object.fromEntries(MORE_KEYS.map((key) => [key, ""])) as MoreFilters;
const range = (from: string, to: string, show: (value: string) => string) => `${from ? show(from) : "any"} – ${to ? show(to) : "any"}`;

type DialogKind = "assign" | "stage" | null;

export function OpportunityListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // People who see every deal start on all deals; everyone else on their own.
  const seesAll = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.opportunities.view_all");
  const defaultView: OpportunityViewKey = seesAll ? "all" : "mine";
  const [view, setViewState] = useState<OpportunityViewKey>((params.get("view") as OpportunityViewKey) || defaultView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Filters);
  const [more, setMoreState] = useState<MoreFilters>(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as MoreFilters);
  const [staleOnly, setStaleOnlyState] = useState(params.get("stale") === "yes");
  // The pipeline's High value and No next activity switches, carried over when its List toggle opens this page.
  const [switches, setSwitches] = useState({ highValue: params.get("highValue") === "yes", noNextActivity: params.get("noNextActivity") === "yes", recurring: params.get("recurring") === "yes" });
  // Names for the company and contact chips; ids alone mean nothing to a person.
  const [names, setNames] = useState<{ account: string | null; contact: string | null }>({ account: params.get("accountName"), contact: null });
  const [sorting, setSortingState] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>(storedVisibility);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [bulkResult, setBulkResult] = useState<OpportunityBulkResult | null>(null);

  // Changing what is listed starts again from the first page with nothing selected.
  const restart = () => { setPageIndex(0); setSelection({}); };
  // The organization's choice and yes/no fields as filters: { key: value }.
  const [customFilters, setCustomFiltersState] = useState<Record<string, string>>(() =>
    Object.fromEntries([...params].filter(([key]) => key.startsWith("cf.")).map(([key, value]) => [key.slice(3), value])));
  const setView = (next: OpportunityViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Filters) => { setFiltersState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  const setStaleOnly = (next: boolean) => { setStaleOnlyState(next); restart(); };
  const setMore = (next: MoreFilters) => { setMoreState(next); restart(); };
  const setMoreKey = (key: MoreKey) => (value: string) => setMore({ ...more, [key]: value });
  const setSubmittedSearch = (next: string) => {
    if (next === submittedSearch) return;
    setSubmittedSearchState(next);
    restart();
  };
  const changeVisibility = (next: VisibilityState) => {
    setVisibility(next);
    try { window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  };

  // Typing searches after a short pause; Enter searches immediately.
  useEffect(() => {
    const timer = setTimeout(() => setSubmittedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the typed text changes
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  // The contact filter offers the people at the chosen company.
  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-contacts", more.accountId),
    queryFn: () => listContacts({ accountId: more.accountId, limit: 100 }),
    enabled: Boolean(more.accountId),
  });
  const accountContacts = contactsQuery.data?.rows ?? [];

  const listFilters: OpportunityListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
    stale: staleOnly ? "yes" : undefined,
    highValue: switches.highValue ? "yes" : undefined,
    noNextActivity: switches.noNextActivity ? "yes" : undefined,
    recurring: switches.recurring ? "yes" : undefined,
    ...customFilterParams(customFilters, ANY),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, more, staleOnly, switches, customFilters, sorting]);

  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", listFilters, pageIndex),
    queryFn: () => listOpportunities({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
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
        id: "name", accessorKey: "name", header: "Deal", enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-48 flex-col">
            <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">
              {row.original.name}
              {row.original.status !== "open" && <OpportunityStatusBadge status={row.original.status} />}
              <OpportunityFlags opportunity={row.original} />
            </span>
            <span className="text-xs whitespace-nowrap text-text-muted">{row.original.code}</span>
            <TagList tags={row.original.tags} />
          </span>
        ),
      },
      { id: "accountName", accessorKey: "accountName", header: "Company", cell: ({ row }) => <span className="block min-w-36">{row.original.accountName ?? ""}</span> },
      {
        id: "stage", accessorKey: "stageName", header: "Stage",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <OpportunityStageBadge opportunity={row.original} />
            {row.original.status === "open" && <span className="text-xs text-text-muted">{days(row.original.stageAgeDays)}</span>}
          </span>
        ),
      },
      { id: "amount", accessorKey: "amount", header: "Value", cell: ({ row }) => money(row.original, row.original.amount) },
      {
        id: "expectedCloseDate", accessorKey: "expectedCloseDate", header: "Close date",
        cell: ({ row }) => <span className={`whitespace-nowrap ${row.original.isOverdue ? "font-medium text-danger" : ""}`}>{formatDate(row.original.expectedCloseDate)}</span>,
      },
      { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
      {
        id: "nextActivity", header: "Next activity", enableSorting: false,
        cell: ({ row }) => row.original.nextActivity
          ? <span className="block max-w-56 truncate">{row.original.nextActivity.subject}{row.original.nextActivity.dueAt ? ` · ${formatDate(row.original.nextActivity.dueAt)}` : ""}</span>
          : row.original.hasNoNextActivity ? <span className="whitespace-nowrap text-warning">No next activity</span> : "",
      },
      { id: "lastActivityAt", accessorKey: "lastActivityAt", header: "Last activity", cell: ({ row }) => formatDate(row.original.lastActivityAt) },
      { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <OpportunityStatusBadge status={row.original.status} /> },
      { id: "probability", accessorKey: "probability", header: "Probability", cell: ({ row }) => <span className="tabular-nums">{row.original.probability}%</span> },
      { id: "weightedValue", accessorKey: "weightedValue", header: "Expected value", cell: ({ row }) => money(row.original, row.original.weightedValue) },
      { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
      { id: "nextStep", accessorKey: "nextStep", header: "Next step", enableSorting: false, cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.nextStep ?? ""}</span> },
      { id: "nextFollowUpAt", accessorKey: "nextFollowUpAt", header: "Next follow-up", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.nextFollowUpAt ? formatDateTime(row.original.nextFollowUpAt) : ""}</span> },
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
    if (key === "campaignId") return options.campaigns?.find((entry) => entry.id === value)?.name ?? "Chosen campaign";
    if (key === "medium") return options.mediums?.find((entry) => entry.code === value)?.label ?? value;
    if (key === "tagId") return options.tags?.find((entry) => entry.id === value)?.name ?? "Chosen tag";
    if (key === "recurringPlanId") return options.recurringPlans?.find((entry) => entry.id === value)?.name ?? "Chosen plan";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Company: ${names.account ?? "chosen company"}` }] : []),
    ...(more.contactId ? [{ id: "more:contactId", label: `Contact: ${names.contact ?? "chosen contact"}` }] : []),
    ...(more.product.trim() ? [{ id: "more:product", label: `Product / service: ${more.product}` }] : []),
    ...(more.expectedCloseFrom || more.expectedCloseTo ? [{ id: "more:expectedClose", label: `Close date: ${range(more.expectedCloseFrom, more.expectedCloseTo, formatDate)}` }] : []),
    ...(more.closedFrom || more.closedTo ? [{ id: "more:closed", label: `Closed: ${range(more.closedFrom, more.closedTo, formatDate)}` }] : []),
    ...(more.valueMin || more.valueMax ? [{ id: "more:value", label: `Value: ${range(more.valueMin, more.valueMax, (value) => formatMoney(baseCurrency, Number(value)))}` }] : []),
    ...(more.createdFrom || more.createdTo ? [{ id: "more:created", label: `Created: ${range(more.createdFrom, more.createdTo, formatDate)}` }] : []),
    ...(staleOnly ? [{ id: "stale", label: `Stale: no activity for ${options?.staleDays ?? 14}+ days` }] : []),
    ...(switches.highValue ? [{ id: "highValue", label: "High value" }] : []),
    ...(switches.noNextActivity ? [{ id: "noNextActivity", label: "No next activity" }] : []),
    ...(switches.recurring ? [{ id: "recurring", label: "With repeat revenue" }] : []),
    ...Object.entries(customFilters).filter(([, value]) => value !== ANY).map(([key, value]) => {
      const field = (options?.customFields ?? []).find((entry) => entry.key === key);
      return { id: `cf.${key}`, label: `${field?.label ?? key}: ${field?.type === "checkbox" ? (value === "true" ? "Yes" : "No") : value}` };
    }),
  ];
  const removeFilter = (id: string) => {
    if (id === "stale") setStaleOnly(false);
    else if (id.startsWith("cf.")) { setCustomFiltersState({ ...customFilters, [id.slice(3)]: ANY }); restart(); }
    else if (id === "highValue" || id === "noNextActivity" || id === "recurring") { setSwitches({ ...switches, [id]: false }); restart(); }
    else if (id === "more:accountId") setMore({ ...more, accountId: "", contactId: "" });
    else if (id === "more:expectedClose") setMore({ ...more, expectedCloseFrom: "", expectedCloseTo: "" });
    else if (id === "more:closed") setMore({ ...more, closedFrom: "", closedTo: "" });
    else if (id === "more:value") setMore({ ...more, valueMin: "", valueMax: "" });
    else if (id === "more:created") setMore({ ...more, createdFrom: "", createdTo: "" });
    else if (id.startsWith("more:")) setMore({ ...more, [id.slice("more:".length)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setStaleOnlyState(false);
    setSwitches({ highValue: false, noNextActivity: false, recurring: false });
    setMore(NO_MORE);
    setCustomFiltersState({});
    setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Filters);
  };
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== defaultView;

  if (optionsQuery.isError && !workspace.permissions.includes("crm.opportunities.view") && !workspace.permissions.includes("crm.opportunities.manage"))
    return <PermissionState title="You don't have access to deals" description="Ask an administrator for the View deals permission." />;

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
      <ErrorBanner message={optionsQuery.isError ? "The deal filters could not be loaded. Refresh the page." : null} />

      <EnterpriseListPage
        header={{
          title: "Deals",
          description: "Every deal with your companies, open or closed. Move each through the sales stages, quote it, and mark it won or lost.",
          primaryAction: can?.create ? <LinkButton href="/crm/opportunities/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New deal</LinkButton> : undefined,
          secondaryActions: <MoreMenu label="More deal actions" items={[
            ...(can?.import && can?.create ? [{ id: "import", label: "Import", onAction: () => router.push("/crm/data/import-export?type=deals") }] : []),
            ...(can?.export ? [{ id: "export", label: total > ON_SCREEN_EXPORT_LIMIT ? "Export in the background" : "Export", onAction: () => { void startExport("opportunities", opportunityExportUrl(listFilters), total, (href) => router.push(href)); } }] : []),
          ]} />,
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as OpportunityViewKey), pinned: PINNED_VIEWS } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search deals" placeholder="Search name, number, company, contact or product" className="w-full sm:min-w-64 sm:flex-1" value={search} onChange={setSearch}
                onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <Select label="Stage" size="compact" selectedKey={filters.stageId} onSelectionChange={(key) => setFilters({ ...filters, stageId: String(key) })}
                    options={withAny(options.stages.map((entry) => ({ value: entry.id, label: entry.name })), "Any stage")} />
                  <Select label="Status" size="compact" selectedKey={filters.status} onSelectionChange={(key) => setFilters({ ...filters, status: String(key) })}
                    options={withAny(options.statuses.map((entry) => ({ value: entry.code, label: entry.label })), "Any status")} />
                  <Select label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                  <Select label="Team" size="compact" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                    options={withAny(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                  <Select label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                    options={withAny(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                  <Select label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  <Select label="Campaign" size="compact" selectedKey={filters.campaignId} onSelectionChange={(key) => setFilters({ ...filters, campaignId: String(key) })}
                    options={withAny((options.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any campaign")} />
                  <Select label="Came through" size="compact" selectedKey={filters.medium} onSelectionChange={(key) => setFilters({ ...filters, medium: String(key) })}
                    options={withAny((options.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label })), "Any medium")} />
                  <Select label="Tag" size="compact" selectedKey={filters.tagId} onSelectionChange={(key) => setFilters({ ...filters, tagId: String(key) })}
                    options={withAny((options.tags ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any tag")} />
                  <CustomFieldFilters fields={options.customFields ?? []} values={customFilters} anyValue={ANY} onChange={(next) => { setCustomFiltersState(next); restart(); }} />
                  {(options.recurringPlans ?? []).length > 0 && (
                    <Select label="Repeat plan" size="compact" selectedKey={filters.recurringPlanId} onSelectionChange={(key) => setFilters({ ...filters, recurringPlanId: String(key) })}
                      options={withAny((options.recurringPlans ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any or none")} />
                  )}
                  <p className="col-span-2 border-t border-border pt-3 text-xs font-medium text-text-secondary">Who, what and when</p>
                  <div className="col-span-2">
                    <AccountPicker label="Company" value={more.accountId || null}
                      onChange={(id, name) => { setMore({ ...more, accountId: id ?? "", contactId: "" }); setNames({ account: name, contact: null }); }} />
                  </div>
                  <Select label="Contact" className="col-span-2" isDisabled={!more.accountId} selectedKey={more.contactId || ANY}
                    onSelectionChange={(key) => {
                      const id = String(key) === ANY ? "" : String(key);
                      setMoreKey("contactId")(id);
                      setNames((current) => ({ ...current, contact: accountContacts.find((row) => row.id === id)?.displayName ?? null }));
                    }}
                    options={withAny(accountContacts.map((row) => ({ value: row.id, label: row.displayName })), more.accountId ? "Any contact" : "Choose a company first")} />
                  <TextField label="Product / service" className="col-span-2" value={more.product} onChange={setMoreKey("product")} />
                  <DateInput label="Close date from" value={more.expectedCloseFrom} onChange={setMoreKey("expectedCloseFrom")} />
                  <DateInput label="Close date to" value={more.expectedCloseTo} onChange={setMoreKey("expectedCloseTo")} />
                  <DateInput label="Closed from" value={more.closedFrom} onChange={setMoreKey("closedFrom")} />
                  <DateInput label="Closed to" value={more.closedTo} onChange={setMoreKey("closedTo")} />
                  <TextField label="Value from" inputMode="decimal" value={more.valueMin} onChange={setMoreKey("valueMin")} />
                  <TextField label="Value to" inputMode="decimal" value={more.valueMax} onChange={setMoreKey("valueMax")} />
                  <DateInput label="Created from" value={more.createdFrom} onChange={setMoreKey("createdFrom")} />
                  <DateInput label="Created to" value={more.createdTo} onChange={setMoreKey("createdTo")} />
                  <Checkbox className="col-span-2" isSelected={staleOnly} onChange={setStaleOnly}>Only stale deals (open, no activity for {options.staleDays}+ days)</Checkbox>
                </FiltersPopover>
              )}
            </>
          ),
          end: (
            <><SavedViews screen="opportunities" basePath="/crm/opportunities" filters={listFilters} /><span className="hidden md:flex">{/* cards below md: no columns to choose */}<PopoverTrigger>
                <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" /><span>Columns</span></Button>
                <Popover>
                  <div className="flex flex-col gap-2 p-1">
                    <p className="text-xs font-medium text-text-secondary">Show columns</p>
                    {OPTIONAL_COLUMNS.map((column) => (
                      <Checkbox key={column.id} isSelected={visibility[column.id] !== false} onChange={(checked) => changeVisibility({ ...visibility, [column.id]: checked })}>{column.label}</Checkbox>
                    ))}
                  </div>
                </Popover>
            </PopoverTrigger></span></>
          ),
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
        bulkActionBar={selectedIds.length ? {
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
        <div className="flex flex-col gap-2">
            {listQuery.data && total > 0 && (
              <p className="text-sm text-text-secondary">
                {total} {total === 1 ? "deal" : "deals"} · value {formatMoney(baseCurrency, listQuery.data.totalValue)} · weighted {formatMoney(baseCurrency, listQuery.data.weightedValue)}
              </p>
            )}
            {listQuery.data && <UnconvertedNotice currency={listQuery.data.currency} />}
            <EnterpriseDataGrid<Opportunity>
              aria-label="Deals"
              columns={columns}
              data={opportunities}
              getRowId={(row) => row.id}
              state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : opportunities.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
              loadingContent={<LoadingState label="Loading deals" rows={8} onRetry={() => void listQuery.refetch()} />}
              errorContent={<ErrorState title="Could not load deals" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
              emptyContent={
                <EmptyState title="No deals yet" description="Create one for a company, or convert a qualified lead."
                  action={can?.create ? { label: "New deal", onPress: () => router.push("/crm/opportunities/new") } : undefined} />
              }
              noResultsContent={<NoResultsState title="No deals match" description="Try a different view, search or filter." />}
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
