"use client";

// CRM Leads: opens on the user's own leads (managers and admins on all of them), with the five most used views as chips and the rest under
// More views; search first; every filter in one popover, applying at once; eight columns by default with the status shown beside the name;
// and a call link, an email link and Log activity on a row on hover. Import and Export sit in the "…" menu; the dashboard is under Insights.
import { formatPhone } from "@vercentlabs/shared-types";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import { Columns3, Filter, Mail, NotebookPen, Phone, Plus } from "lucide-react";
import {
  Button, Checkbox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, LinkButton, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { TagList } from "@/features/crm/shared/ui/TagChips";
import { ON_SCREEN_EXPORT_LIMIT, startExport } from "@/features/crm/shared/data-jobs-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BulkConvertDialog } from "../components/BulkConvertDialog";
import { SavedViews } from "@/features/crm/shared/ui/SavedViews";
import { getLeadOptions, leadExportUrl, listLeads, type Lead, type LeadBulkResult, type LeadListFilters, type LeadViewKey } from "../api/leads-api";
import { ChangeStageDialog, DisqualifyLeadsDialog } from "../components/LeadActionDialogs";
import { AssignLeadsDialog } from "../components/LeadAssignment";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { LogActivityDialog } from "../components/LeadWorkPanels";
import { ErrorBanner, FollowUpCell, LeadStageBadge, LeadStatusBadge, PRIORITY_OPTIONS, PriorityBadge, RATING_OPTIONS, RatingBadge, STATUS_LABELS, StaleBadge, days, leadName } from "../lead-format";
import { LIVE_LEAD_QUERY } from "../live-query";

const PAGE_SIZE = 25;
const ANY = "any";
const COLUMN_STORAGE_KEY = "crm.leads.columns.v2";
// The five views shown as chips; the other eight sit under More views.
const PINNED_VIEWS = ["mine", "unassigned", "due_today", "overdue", "no_activity"];

// Columns the user can hide. The lead (with its status beside the name) always stays visible. Eight are shown by default.
const OPTIONAL_COLUMNS: Array<{ id: string; label: string; hiddenByDefault?: boolean }> = [
  { id: "companyName", label: "Company" },
  { id: "stage", label: "Stage" },
  { id: "ownerName", label: "Owner" },
  { id: "nextFollowUpAt", label: "Next follow-up" },
  { id: "rating", label: "Rating" },
  { id: "score", label: "Score" },
  { id: "estimatedValue", label: "Value" },
  { id: "sourceName", label: "Source", hiddenByDefault: true },
  { id: "priority", label: "Priority", hiddenByDefault: true },
  { id: "lastActivityAt", label: "Last activity", hiddenByDefault: true },
  { id: "teamName", label: "Team", hiddenByDefault: true },
  { id: "assignedAt", label: "Assigned", hiddenByDefault: true },
  { id: "contact", label: "Contact", hiddenByDefault: true },
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

type FilterKey = "status" | "stage" | "ownerId" | "sourceId" | "priority" | "rating" | "teamId" | "qualificationStatus" | "campaignId" | "medium" | "tagId" | "scoreMin";
type Filters = Record<FilterKey, string>;
const NO_FILTERS: Filters = { status: ANY, stage: ANY, ownerId: ANY, sourceId: ANY, priority: ANY, rating: ANY, teamId: ANY, qualificationStatus: ANY, campaignId: ANY, medium: ANY, tagId: ANY, scoreMin: ANY };

// Where the lead is, what it wants and how long it has waited: the filters
// the unassigned queue is worked by.
type QueueFilters = { state: string; city: string; productInterest: string; olderThanDays: string };
const NO_QUEUE_FILTERS: QueueFilters = { state: "", city: "", productInterest: "", olderThanDays: "" };
const QUEUE_FILTER_NAMES: Record<keyof QueueFilters, string> = { state: "State", city: "City", productInterest: "Interest", olderThanDays: "Waiting" };
const AGE_OPTIONS = [
  { value: ANY, label: "Any age" },
  ...[1, 2, 3, 7, 14, 30].map((days) => ({ value: String(days), label: `Created more than ${days} ${days === 1 ? "day" : "days"} ago` })),
];

type DialogKind = "assign" | "stage" | "disqualify" | "convert" | null;
type FilterRange = { qualifiedFrom: string; qualifiedTo: string; convertedFrom: string; convertedTo: string };

export function LeadListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Someone who owns leads opens on their own; a manager or administrator who sees every lead opens on all of them.
  const seesAll = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.leads.view_all");
  const [view, setViewState] = useState<LeadViewKey>((params.get("view") as LeadViewKey) || (seesAll ? "all" : "mine"));
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearchState] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Filters>({
    status: params.get("status") ?? ANY,
    stage: params.get("stage") ?? ANY,
    ownerId: params.get("ownerId") ?? ANY,
    sourceId: params.get("sourceId") ?? ANY,
    priority: params.get("priority") ?? ANY,
    rating: params.get("rating") ?? ANY,
    teamId: params.get("teamId") ?? ANY,
    qualificationStatus: params.get("qualificationStatus") ?? ANY,
    campaignId: params.get("campaignId") ?? ANY,
    medium: params.get("medium") ?? ANY,
    tagId: params.get("tagId") ?? ANY,
    scoreMin: params.get("scoreMin") ?? ANY,
  });
  const [queue, setQueueState] = useState<QueueFilters>({
    state: params.get("state") ?? "", city: params.get("city") ?? "", productInterest: params.get("productInterest") ?? "", olderThanDays: params.get("olderThanDays") ?? "",
  });
  const [ranges, setRanges] = useState<FilterRange>({ qualifiedFrom: params.get("qualifiedFrom") ?? "", qualifiedTo: params.get("qualifiedTo") ?? "",
    convertedFrom: params.get("convertedFrom") ?? "", convertedTo: params.get("convertedTo") ?? "" });
  const [logging, setLogging] = useState<Lead | null>(null);
  const [created, setCreated] = useState({ from: params.get("createdFrom") ?? "", to: params.get("createdTo") ?? "" });
  // Open leads with no activity for a while; set from the dashboard or the filter panel.
  const [staleOnly, setStaleOnlyState] = useState(params.get("stale") === "yes");
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
  const setStaleOnly = (next: boolean) => { setStaleOnlyState(next); restart(); };
  const setQueue = (next: QueueFilters) => { setQueueState(next); restart(); };
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
    stale: staleOnly ? "yes" : undefined,
    ...Object.fromEntries(Object.entries(queue).filter(([, value]) => value.trim())),
    ...Object.fromEntries(Object.entries(ranges).filter(([, value]) => value)),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc === false ? "asc" : "desc",
  }), [view, submittedSearch, filters, created, staleOnly, queue, ranges, sorting]);

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
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">{leadName(row.original)}<LeadStatusBadge status={row.original.status} /><StaleBadge lead={row.original} /></span>
          <span className="text-xs whitespace-nowrap text-text-muted">{row.original.code}{row.original.jobTitle ? ` · ${row.original.jobTitle}` : ""}</span>
          <TagList tags={row.original.tags} />
        </span>
      ),
    },
    { id: "companyName", accessorKey: "companyName", header: "Company", cell: ({ row }) => <span className="block min-w-36">{row.original.companyName ?? ""}</span> },
    {
      id: "stage",
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <LeadStageBadge name={row.original.stageName} />
          {row.original.status === "open" && <span className="text-xs text-text-muted">{days(row.original.stageAgeDays)}</span>}
        </span>
      ),
    },
    { id: "ownerName", accessorKey: "ownerName", header: "Owner", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerName ?? <span className="text-text-muted">Unassigned</span>}</span> },
    { id: "sourceName", accessorKey: "sourceName", header: "Source", cell: ({ row }) => row.original.sourceName ?? "" },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
    { id: "rating", accessorKey: "rating", header: "Rating", cell: ({ row }) => <RatingBadge rating={row.original.rating} /> },
    // the lead score (CRM plan 5.3)
    { id: "score", accessorKey: "score", header: "Score", cell: ({ row }) => (row.original.score === null || row.original.score === undefined ? <span className="text-text-muted">—</span>
      : <span className={`tabular-nums ${row.original.scoreDetails?.hot ? "font-semibold text-danger" : ""}`}>{row.original.score}</span>) },
    {
      id: "estimatedValue",
      accessorKey: "estimatedValue",
      header: "Value",
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
          <span className="text-text-muted">{formatPhone(row.original.mobile || row.original.phone)}</span>
        </span>
      ),
    },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
    {
      // On hover: call, email and log an activity without opening the lead.
      id: "quick", header: "", enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const phone = row.original.mobile || row.original.phone;
        return (
          <span className="flex items-center gap-0.5 opacity-100 transition-opacity group-hover:opacity-100 lg:opacity-0 lg:focus-within:opacity-100" onClick={(event) => event.stopPropagation()} role="presentation">
            {phone && <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} aria-label={`Call ${leadName(row.original)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text"><Phone className="size-4" aria-hidden="true" /></a>}
            {row.original.email && <a href={`mailto:${row.original.email}`} aria-label={`Email ${leadName(row.original)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text"><Mail className="size-4" aria-hidden="true" /></a>}
            {row.original.status === "open" && <IconButton aria-label={`Log activity on ${leadName(row.original)}`} size="compact" variant="ghost" onPress={() => setLogging(row.original)}><NotebookPen className="size-4" aria-hidden="true" /></IconButton>}
          </span>
        );
      },
    },
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
    if (key === "status") return STATUS_LABELS[value as Lead["status"]] ?? value;
    if (key === "ownerId") return ownerOptions.find((entry) => entry.value === value)?.label ?? value;
    if (key === "sourceId") return options.sources.find((entry) => entry.id === value)?.name ?? value;
    if (key === "teamId") return options.teams.find((entry) => entry.id === value)?.name ?? value;
    if (key === "qualificationStatus") return options.qualificationStatuses.find((entry) => entry.code === value)?.label ?? value;
    if (key === "campaignId") return options.campaigns?.find((entry) => entry.id === value)?.name ?? "Campaign";
    if (key === "medium") return options.mediums?.find((entry) => entry.code === value)?.label ?? value;
    if (key === "tagId") return options.tags?.find((entry) => entry.id === value)?.name ?? "Tag";
    if (key === "scoreMin") return `${value} or more`;
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const FILTER_NAMES: Record<FilterKey, string> = { status: "Status", stage: "Stage", ownerId: "Owner", sourceId: "Source", priority: "Priority", rating: "Rating", teamId: "Team", qualificationStatus: "Qualification", campaignId: "Campaign", medium: "Medium", tagId: "Tag", scoreMin: "Score" };
  const activeFilters: ActiveFilter[] = [
    ...(Object.keys(filters) as FilterKey[])
      .filter((key) => filters[key] !== ANY)
      .map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(Object.keys(queue) as Array<keyof QueueFilters>)
      .filter((key) => queue[key].trim())
      .map((key) => ({ id: `queue:${key}`, label: key === "olderThanDays" ? `Waiting: more than ${queue[key]} ${queue[key] === "1" ? "day" : "days"}` : `${QUEUE_FILTER_NAMES[key]}: ${queue[key]}` })),
    ...(staleOnly ? [{ id: "stale", label: `Stale: no activity for ${options?.staleDays ?? 7}+ days` }] : []),
    // Set by links from the dashboards; removable here.
    ...(created.from || created.to ? [{ id: "created", label: `Created: ${created.from ? formatDate(created.from) : "start"} – ${created.to ? formatDate(created.to) : "today"}` }] : []),
    ...(ranges.qualifiedFrom || ranges.qualifiedTo ? [{ id: "qualified", label: `Qualified: ${ranges.qualifiedFrom ? formatDate(ranges.qualifiedFrom) : "start"} – ${ranges.qualifiedTo ? formatDate(ranges.qualifiedTo) : "today"}` }] : []),
    ...(ranges.convertedFrom || ranges.convertedTo ? [{ id: "converted", label: `Converted: ${ranges.convertedFrom ? formatDate(ranges.convertedFrom) : "start"} – ${ranges.convertedTo ? formatDate(ranges.convertedTo) : "today"}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "created") {
      setCreated({ from: "", to: "" });
      restart();
    } else if (id === "qualified") { setRanges({ ...ranges, qualifiedFrom: "", qualifiedTo: "" }); restart(); }
    else if (id === "converted") { setRanges({ ...ranges, convertedFrom: "", convertedTo: "" }); restart(); }
    else if (id === "stale") setStaleOnly(false);
    else if (id.startsWith("queue:")) setQueue({ ...queue, [id.slice("queue:".length)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => {
    setCreated({ from: "", to: "" });
    setRanges({ qualifiedFrom: "", qualifiedTo: "", convertedFrom: "", convertedTo: "" });
    setStaleOnlyState(false);
    setQueue(NO_QUEUE_FILTERS);
    setFilters(NO_FILTERS);
  };
  const statusOptions = [{ value: ANY, label: "Any status" }, ...(options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label }))];
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== (seesAll ? "all" : "mine");

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
          description: "People and companies that might buy. Work each lead until it is qualified, then convert it into a company, contact and deal.",
          primaryAction: can?.create ? (
            <LinkButton href="/crm/leads/new" variant="primary"><Plus className="size-4" aria-hidden="true" />New lead</LinkButton>
          ) : undefined,
          secondaryActions: <><SavedViews screen="leads" basePath="/crm/leads" filters={listFilters} /><MoreMenu label="More lead actions" items={[
            ...(can?.import ? [{ id: "import", label: "Import", onAction: () => router.push("/crm/data/import-export?type=leads") }] : []),
            ...(can?.export ? [{ id: "export", label: total > ON_SCREEN_EXPORT_LIMIT ? "Export in the background" : "Export", onAction: () => { void startExport("leads", leadExportUrl(listFilters), total, (href) => router.push(href)); } }] : []),
          ]} /></>,
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as LeadViewKey), pinned: PINNED_VIEWS } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search leads" placeholder="Search name, company, email, phone or lead number" className="w-full sm:min-w-64 sm:flex-1" value={search} onChange={setSearch} onSubmit={(value) => setSubmittedSearch(value.trim())} />
              {options && (
                <>
                  <PopoverTrigger>
                    <Button variant={activeFilters.length ? "secondary" : "outline"} size="compact">
                      <Filter className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Filters</span>
                      {activeFilters.length > 0 && <span className="rounded-full bg-brand px-1.5 text-xs tabular-nums text-white">{activeFilters.length}</span>}
                    </Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(48rem,calc(100vw-4rem))] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Select label="Status" size="compact" selectedKey={filters.status} onSelectionChange={(key) => setFilters({ ...filters, status: String(key) })} options={statusOptions} />
                        <Select label="Stage" size="compact" selectedKey={filters.stage} onSelectionChange={(key) => setFilters({ ...filters, stage: String(key) })}
                          options={filterOptions(options.stages.map((entry) => ({ value: entry.code, label: entry.label })), "Any stage")} />
                        <Select label="Owner" size="compact" selectedKey={filters.ownerId} onSelectionChange={(key) => setFilters({ ...filters, ownerId: String(key) })} options={ownerOptions} />
                        <Select label="Team" size="compact" selectedKey={filters.teamId} onSelectionChange={(key) => setFilters({ ...filters, teamId: String(key) })}
                          options={filterOptions(options.teams.map((entry) => ({ value: entry.id, label: entry.name })), "Any team")} />
                        <Select label="Source" size="compact" selectedKey={filters.sourceId} onSelectionChange={(key) => setFilters({ ...filters, sourceId: String(key) })}
                          options={filterOptions(options.sources.map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
                        <Select label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={filterOptions(PRIORITY_OPTIONS, "Any priority")} />
                        <Select label="Qualification" size="compact" selectedKey={filters.qualificationStatus} onSelectionChange={(key) => setFilters({ ...filters, qualificationStatus: String(key) })}
                          options={filterOptions(options.qualificationStatuses.map((entry) => ({ value: entry.code, label: entry.label })), "Any qualification")} />
                        <Select label="Rating" size="compact" selectedKey={filters.rating} onSelectionChange={(key) => setFilters({ ...filters, rating: String(key) })} options={filterOptions(RATING_OPTIONS, "Any rating")} />
                        <Select label="Score" size="compact" selectedKey={filters.scoreMin} onSelectionChange={(key) => setFilters({ ...filters, scoreMin: String(key) })}
                          options={filterOptions([{ value: "70", label: "70 or more" }, { value: "40", label: "40 or more" }, { value: "1", label: "Scored" }], "Any score")} />
                        <Select label="Campaign" size="compact" selectedKey={filters.campaignId} onSelectionChange={(key) => setFilters({ ...filters, campaignId: String(key) })}
                          options={filterOptions((options.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any campaign")} />
                        <Select label="Medium" size="compact" selectedKey={filters.medium} onSelectionChange={(key) => setFilters({ ...filters, medium: String(key) })}
                          options={filterOptions((options.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label })), "Any medium")} />
                        <Select label="Tag" size="compact" selectedKey={filters.tagId} onSelectionChange={(key) => setFilters({ ...filters, tagId: String(key) })}
                          options={filterOptions((options.tags ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any tag")} />
                        <p className="border-t border-border pt-3 text-xs font-medium text-text-secondary sm:col-span-2 lg:col-span-3">Location, interest and age</p>
                        <TextField label="State" value={queue.state} onChange={(state) => setQueue({ ...queue, state })} />
                        <TextField label="City" value={queue.city} onChange={(city) => setQueue({ ...queue, city })} />
                        <TextField label="Product / service interest" value={queue.productInterest} onChange={(productInterest) => setQueue({ ...queue, productInterest })} />
                        <Select label="Waiting" size="compact" selectedKey={queue.olderThanDays || ANY}
                          onSelectionChange={(key) => setQueue({ ...queue, olderThanDays: String(key) === ANY ? "" : String(key) })} options={AGE_OPTIONS} />
                        <Checkbox className="sm:col-span-2 lg:col-span-3" isSelected={staleOnly} onChange={setStaleOnly}>
                          Only stale leads (open, no activity for {options.staleDays}+ days)
                        </Checkbox>
                        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
                          <Button variant="ghost" size="compact" onPress={clearFilters}>Clear all</Button>
                        </div>
                      </div>
                    </Popover>
                  </PopoverTrigger>
                </>
              )}
            </>
          ),
          end: (
            <span className="hidden md:flex">{/* cards below md: no columns to choose */}<PopoverTrigger>
              <Button variant="outline" size="compact"><Columns3 className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Columns</span></Button>
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
            </PopoverTrigger></span>
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
              {can?.convert && <Button variant="secondary" size="compact" onPress={() => setDialog("convert")}>Convert</Button>}
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
              {/* On a phone the number is what a rep needs: tap to call, or the email to write. */}
              {(row.mobile || row.phone || row.email) && (
                <span className="flex flex-wrap gap-3 text-sm" onClick={(event) => event.stopPropagation()}>
                  {(row.mobile || row.phone) && <a className="text-brand" href={`tel:${(row.mobile || row.phone || "").replace(/[^0-9+]/g, "")}`}>{formatPhone(row.mobile || row.phone)}</a>}
                  {row.email && <a className="truncate text-brand" href={`mailto:${row.email}`}>{row.email}</a>}
                </span>
              )}
              <span className="flex flex-wrap gap-1"><LeadStatusBadge status={row.status} /><LeadStageBadge name={row.stageName} /><StaleBadge lead={row} /></span>
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
          {dialog === "convert" && <BulkConvertDialog isOpen onOpenChange={(open) => !open && setDialog(null)} leadIds={selectedIds} options={options} onDone={refresh} />}
          <DisqualifyLeadsDialog isOpen={dialog === "disqualify"} onOpenChange={(open) => !open && setDialog(null)} leadIds={selectedIds} options={options} onDone={refresh} />
          {logging && <LogActivityDialog isOpen onOpenChange={(open) => !open && setLogging(null)} leadId={logging.id} options={options} currentStage={logging.stage} onDone={() => { setLogging(null); refresh(); }} />}
        </>
      )}
    </div>
  );
}
