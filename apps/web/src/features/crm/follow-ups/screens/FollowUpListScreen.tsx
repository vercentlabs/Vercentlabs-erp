"use client";

// CRM To-dos › Follow-ups: the salesperson's action queue — who to contact, how, about which record and why. Laid out like tasks: whose
// follow-ups (Mine / Team / Everyone) is a switch in the toolbar; when they are due is a row of coloured, counted queues (Overdue · Due today ·
// Upcoming · All scheduled · Completed). Each scheduled row starts with a round Complete button and a ⋯ menu (Reschedule, Snooze), so they stay
// in reach however narrow the screen. Columns read When · What · About · Contact · Assigned to · Status; any can be hidden under Columns.
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Building2, CalendarClock, Check, Download, Mail, MapPin, MessageCircle, MonitorPlay, Phone, Plus, TriangleAlert, UserRound, Users } from "lucide-react";
import {
  AlertDialog, Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState,
  SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { QueueCards, ScopeSwitch, localDate, type QueueCard, type WorkScope } from "@/features/crm/shared/ui/WorkQueues";
import { WorkRowActions } from "@/features/crm/shared/ui/WorkRowActions";
import { formatDate } from "@/shared/format/human";
import { ColumnsMenu, useColumnVisibility, type OptionalColumn } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  bulkFollowUpAction, errorMessage, followUpExportUrl, getFollowUpOptions, getFollowUpSummary, listFollowUps,
  type FollowUp, type FollowUpBulkResult, type FollowUpListFilters, type FollowUpOptions,
} from "../api/follow-ups-api";
import { ScheduleFollowUpDialog } from "../components/FollowUpDialogs";
import { ErrorBanner, FollowUpStatusBadge, FollowUpWhen, RELATED_LABELS, TYPE_LABELS } from "../follow-up-format";

const PAGE_SIZE = 25;
const ANY = "any";
const LIVE = { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false } as const;

type FilterKey = "type" | "assigneeId" | "relatedType" | "createdBy" | "completedBy" | "outcome";
const FILTER_KEYS: FilterKey[] = ["type", "assigneeId", "relatedType", "createdBy", "completedBy", "outcome"];
const FILTER_NAMES: Record<FilterKey, string> = { type: "Type", assigneeId: "Assigned to", relatedType: "About", createdBy: "Created by", completedBy: "Completed by", outcome: "Outcome" };
type MoreKey = "accountId" | "dueFrom" | "dueTo";
const NO_MORE: Record<MoreKey, string> = { accountId: "", dueFrom: "", dueTo: "" };
const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Record<FilterKey, string>;
type BulkKind = "reassign" | "reschedule" | "cancel";

type Scope = WorkScope;
type Queue = "overdue" | "today" | "upcoming" | "open" | "completed" | "cancelled";
const QUEUES: Array<Omit<QueueCard<Exclude<Queue, "cancelled">>, "count">> = [
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "today", label: "Due today", tone: "warning" },
  { key: "upcoming", label: "Upcoming", tone: "info" },
  { key: "open", label: "All scheduled", tone: "brand" },
  { key: "completed", label: "Completed", tone: "success" },
];
// How the contact is reached, as a coloured icon in front of the subject.
const TYPE_STYLE: Record<FollowUp["type"], { icon: ComponentType<{ className?: string }>; className: string }> = {
  call: { icon: Phone, className: "bg-info-soft text-info" },
  whatsapp: { icon: MessageCircle, className: "bg-success-soft text-success" },
  email: { icon: Mail, className: "bg-brand-soft text-brand" },
  meeting: { icon: Users, className: "bg-warning-soft text-warning" },
  demo: { icon: MonitorPlay, className: "bg-brand-soft text-brand" },
  visit: { icon: MapPin, className: "bg-danger-soft text-danger" },
  other: { icon: CalendarClock, className: "bg-canvas-strong text-text-secondary" },
};

// The list request behind a scope and a queue. Mine uses the server's own views; Team (scheduled only) and Everyone add a status and dates.
function queueFilters(scope: Scope, queue: Queue): FollowUpListFilters {
  if (scope === "mine")
    return queue === "cancelled" ? { view: "cancelled", assigneeId: "me" }
      : { view: ({ overdue: "overdue", today: "due_today", upcoming: "upcoming", open: "mine", completed: "completed" } as const)[queue] };
  const base: FollowUpListFilters = { view: scope === "team" ? "team" : "all" };
  if (queue === "overdue") return { ...base, status: "overdue" };
  if (queue === "today") return { ...base, status: "scheduled", dueFrom: localDate(), dueTo: localDate() };
  if (queue === "upcoming") return { ...base, status: "scheduled", dueFrom: localDate(1) };
  if (queue === "completed" || queue === "cancelled") return { ...base, status: queue };
  return { ...base, status: "scheduled" };
}
// Older links (?view=… from bookmarks, ?due=… from Home) open the matching scope and queue.
function fromParams(params: URLSearchParams): { scope: Scope; queue: Queue; createdBy?: string } {
  const due = params.get("due");
  if (due === "overdue") return { scope: "mine", queue: "overdue" };
  if (due === "today") return { scope: "mine", queue: "today" };
  switch (params.get("view")) {
    case "overdue": return { scope: "mine", queue: "overdue" };
    case "due_today": return { scope: "mine", queue: "today" };
    case "upcoming": return { scope: "mine", queue: "upcoming" };
    case "completed": return { scope: "mine", queue: "completed" };
    case "team": return { scope: "team", queue: "open" };
    case "all": return { scope: "everyone", queue: "open" };
    case "created_by_me": return { scope: "everyone", queue: "open", createdBy: "me" };
    case "cancelled": return { scope: "mine", queue: "cancelled" };
    default: return { scope: "mine", queue: "open" };
  }
}

const OPTIONAL_COLUMNS: OptionalColumn[] = [
  { id: "related", label: "About" }, { id: "who", label: "Contact" }, { id: "assignee", label: "Assigned to" }, { id: "status", label: "Status" },
];

// tabs: the To-dos tab row, drawn under the page title.
export function FollowUpListScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [initial] = useState(() => fromParams(new URLSearchParams(params.toString())));
  const [scope, setScopeState] = useState<Scope>(initial.scope);
  const [queue, setQueueState] = useState<Queue>(initial.queue);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState<Record<FilterKey, string>>(() => ({
    ...(Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Record<FilterKey, string>),
    ...(initial.createdBy ? { createdBy: initial.createdBy } : {}),
  }));
  const [more, setMoreState] = useState<Record<MoreKey, string>>({ accountId: params.get("accountId") ?? "", dueFrom: params.get("dueFrom") ?? "", dueTo: params.get("dueTo") ?? "" });
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [notice, setNotice] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkResult, setBulkResult] = useState<FollowUpBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columnChoice = useColumnVisibility("crm.follow-ups.columns", OPTIONAL_COLUMNS);

  const restart = () => { setPageIndex(0); setSelection({}); };
  const setQueue = (next: Queue) => { setQueueState(next); restart(); };
  // Team shows scheduled follow-ups only, so its Completed and Cancelled queues fall back to All scheduled.
  const setScope = (next: Scope) => {
    setScopeState(next);
    if (next === "team" && (queue === "completed" || queue === "cancelled")) setQueueState("open");
    if (next === "mine" && filters.assigneeId !== ANY) setFiltersState({ ...filters, assigneeId: ANY });
    restart();
  };
  const setFilters = (next: Record<FilterKey, string>) => { setFiltersState(next); restart(); };
  const setMore = (next: Record<MoreKey, string>) => { setMoreState(next); restart(); };
  useEffect(() => {
    const timer = setTimeout(() => { setSubmittedSearch(search.trim()); setPageIndex(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const hasView = (key: string) => Boolean(options?.views.some((entry) => entry.key === key));
  const scopes: Scope[] = ["mine", ...(hasView("team") ? ["team" as const] : []), ...(hasView("all") ? ["everyone" as const] : [])];
  const queues = QUEUES.filter((entry) => scope !== "team" || entry.key !== "completed");
  const summaryQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "summary"), queryFn: getFollowUpSummary, ...LIVE });

  // What the person narrowed to (search, Filters) applies to the list and to every queue's count; the queue sets the view, status and dates.
  const narrowing = useMemo(() => ({
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
  }) as FollowUpListFilters, [submittedSearch, filters, more]);
  const filtersFor = (forQueue: Queue): FollowUpListFilters => ({ ...narrowing, ...queueFilters(scope, forQueue) });
  const listFilters: FollowUpListFilters = { ...filtersFor(queue), sortBy: sorting[0]?.id, sortDirection: sorting[0]?.desc ? "desc" : "asc" };
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "follow-ups", listFilters, pageIndex),
    queryFn: () => listFollowUps({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
  // One count per queue: the same request as its list, one row long.
  const countQueries = useQueries({
    queries: queues.map((entry) => {
      const countFilters = filtersFor(entry.key);
      return { queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "count", countFilters), queryFn: () => listFollowUps({ ...countFilters, limit: 1 }), placeholderData: keepPreviousData, ...LIVE };
    }),
  });
  const counts = Object.fromEntries(queues.map((entry, index) => [entry.key, countQueries[index]?.data?.total])) as Partial<Record<Queue, number>>;
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const refresh = (result?: FollowUpBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
  };

  const columns = useMemo<ColumnDef<FollowUp, unknown>[]>(() => [
    { id: "scheduledAt", accessorKey: "scheduledAt", header: "When", cell: ({ row }) => <FollowUpWhen followUp={row.original} /> },
    {
      id: "subject", accessorKey: "subject", header: "What", enableHiding: false,
      cell: ({ row }) => {
        const style = TYPE_STYLE[row.original.type] ?? TYPE_STYLE.other;
        const Icon = style.icon;
        return (
          <span className="flex min-w-56 items-start gap-2.5">
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${style.className}`} title={row.original.typeName ?? TYPE_LABELS[row.original.type]}>
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className={row.original.status === "scheduled" ? "font-medium text-text" : "text-text-secondary line-through"}>{row.original.subject}</span>
              <span className="text-xs text-text-muted">{row.original.typeName ?? TYPE_LABELS[row.original.type]} · {row.original.number}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: "related", header: "About", enableSorting: false,
      cell: ({ row }) => row.original.relatedHref ? (
        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation" className="flex min-w-40 flex-col">
          <Link className="text-brand hover:underline" href={row.original.relatedHref}>{row.original.relatedName}</Link>
          <span className="text-xs text-text-muted">{RELATED_LABELS[row.original.relatedType ?? ""]}{row.original.accountName && row.original.relatedType !== "party" && row.original.accountName !== row.original.relatedName ? ` · ${row.original.accountName}` : ""}</span>
        </span>
      ) : "",
    },
    { id: "who", header: "Contact", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.contactName ?? "—"}</span> },
    { id: "assignee", accessorKey: "assignedName", header: "Assigned to", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assignedName ?? "Unassigned"}</span> },
    { id: "status", accessorKey: "status", header: "Status", enableSorting: false, cell: ({ row }) => <span className="flex flex-col gap-1"><FollowUpStatusBadge status={row.original.status} />{row.original.outcomeLabel && <span className="text-xs text-text-muted">{row.original.outcomeLabel}</span>}</span> },
    {
      id: "done", header: () => <span className="sr-only">Actions</span>, enableSorting: false, enableHiding: false,
      // Snooze is for the person the reminder goes to.
      cell: ({ row }) => row.original.status === "completed"
        ? <span className="flex items-center justify-end gap-1.5 text-xs font-medium text-success"><span className="flex size-5 items-center justify-center rounded-full bg-success text-white"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span>Completed</span>
        : row.original.status === "scheduled" && can?.complete
          ? <WorkRowActions kind="follow_up" id={row.original.id} layout="check" labelled snooze={row.original.assignedTo === options?.currentUserId} onDone={() => refresh()} onMessage={setNotice} /> : null,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only invalidates the list
  ], [can?.complete, options?.currentUserId]);

  const withAny = (list: Array<{ value: string; label: string }>, label: string) => [{ value: ANY, label }, ...list];
  // You are offered as "Me", so you are not listed again by name.
  const people = (options?.users ?? []).filter((user) => user.id !== options?.currentUserId).map((user) => ({ value: user.id, label: user.name }));
  const labelOf = (key: FilterKey, value: string) => {
    if (key === "type") return TYPE_LABELS[value as FollowUp["type"]] ?? value;
    if (key === "relatedType") return RELATED_LABELS[value] ?? value;
    if (key === "outcome") return options?.outcomes.find((entry) => entry.code === value)?.label ?? value;
    if (value === "me") return "Me";
    return people.find((entry) => entry.value === value)?.label ?? "Chosen person";
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Company: ${accountName ?? "chosen company"}` }] : []),
    ...(more.dueFrom || more.dueTo ? [{ id: "more:due", label: `Date: ${more.dueFrom ? formatDate(more.dueFrom) : "any"} – ${more.dueTo ? formatDate(more.dueTo) : "any"}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "more:due") setMore({ ...more, dueFrom: "", dueTo: "" });
    else if (id === "more:accountId") setMore({ ...more, accountId: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => { setMore(NO_MORE); setFilters(NO_FILTERS); };
  const draft = (key: MoreKey) => (value: string) => setMore({ ...more, [key]: value });
  const summary = summaryQuery.data;
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || scope !== "mine" || queue !== "open";

  if (optionsQuery.isError && !workspace.permissions.includes("crm.follow_ups.view") && !workspace.permissions.includes("crm.activities.manage"))
    return <PermissionState title="You don't have access to follow-ups" description="Ask an administrator for the View follow-ups permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.followUpId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={error ?? (optionsQuery.isError ? "The follow-up filters could not be loaded. Refresh the page." : null)} />
      {notice && <p role="status" className="self-start rounded-[var(--radius-control)] bg-success-soft px-3 py-1.5 text-sm text-success">{notice}</p>}

      <EnterpriseListPage
        tabs={tabs}
        header={{
          title: tabs ? "To-dos" : "Follow-ups",
          description: "Who to contact, how, about which record and why: overdue first, then today, then what is coming up.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New follow-up</Button> : undefined,
          secondaryActions: can?.export ? <a className={buttonVariants({ variant: "outline" })} href={followUpExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" /><span>Export</span></a> : undefined,
        }}
        actionBar={{
          leading: scopes.length > 1 ? <ScopeSwitch label="Whose follow-ups" scopes={scopes} value={scope} onChange={setScope} /> : undefined,
          start: (
            <>
              <SearchField aria-label="Search follow-ups" placeholder="Search subject, contact, company or number" className="w-full sm:w-80" value={search} onChange={setSearch}
                onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <Select label="Type" selectedKey={filters.type} onSelectionChange={(key) => setFilters({ ...filters, type: String(key) })}
                    options={withAny(options.types.map((entry) => ({ value: entry.code, label: entry.label })), "Any type")} />
                  {scope !== "mine" && (
                    <Select label="Assigned to" selectedKey={filters.assigneeId} onSelectionChange={(key) => setFilters({ ...filters, assigneeId: String(key) })}
                      options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  )}
                  <Select label="About" selectedKey={filters.relatedType} onSelectionChange={(key) => setFilters({ ...filters, relatedType: String(key) })}
                    options={withAny(options.relatedTypes.map((entry) => ({ value: entry.code, label: RELATED_LABELS[entry.code] ?? entry.label })), "Any record")} />
                  <AccountPicker label="Company" description="Follow-ups on the company, its deals and its contacts." value={more.accountId || null}
                    onChange={(id, name) => { draft("accountId")(id ?? ""); setAccountName(name); }} />
                  <Select label="Outcome" selectedKey={filters.outcome} onSelectionChange={(key) => setFilters({ ...filters, outcome: String(key) })}
                    options={withAny(options.outcomes.map((entry) => ({ value: entry.code, label: entry.label })), "Any outcome")} />
                  <Select label="Created by" selectedKey={filters.createdBy} onSelectionChange={(key) => setFilters({ ...filters, createdBy: String(key) })} options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  <Select label="Completed by" selectedKey={filters.completedBy} onSelectionChange={(key) => setFilters({ ...filters, completedBy: String(key) })} options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  <DateInput label="From" value={more.dueFrom} onChange={draft("dueFrom")} />
                  <DateInput label="To" value={more.dueTo} onChange={draft("dueTo")} />
                </FiltersPopover>
              )}
            </>
          ),
          end: <ColumnsMenu columns={columnChoice.columns} visibility={columnChoice.visibility} onChange={columnChoice.setVisibility} />,
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: clearFilters } : undefined}
        bulkActionBar={selectedIds.length ? {
          selectedCount: selectedIds.length,
          onClearSelection: () => setSelection({}),
          actions: (
            <>
              {can?.reassign && <Button variant="secondary" size="compact" onPress={() => setBulk("reassign")}>Reassign</Button>}
              {can?.reschedule && <Button variant="secondary" size="compact" onPress={() => setBulk("reschedule")}>Reschedule</Button>}
              {can?.cancel && <Button variant="secondary" size="compact" onPress={() => setBulk("cancel")}>Cancel</Button>}
            </>
          ),
        } : undefined}
      >
        <div className="flex flex-col gap-4">
          <QueueCards<Queue> label="Follow-up queues" cards={queues.map((entry) => ({ ...entry, count: counts[entry.key] }))} value={queue} onChange={setQueue} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* The highlighted queue and the scope switch already say what is shown; only the cancelled list, which has no card, says so. */}
            {queue === "cancelled" ? <p className="text-sm font-medium text-text">Cancelled follow-ups</p> : <span />}
            <span className="flex flex-wrap items-center gap-3">
              {summary?.teamOverdue && scope !== "team" ? (
                <button type="button" onClick={() => { setScope("team"); setQueue("overdue"); }}
                  className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {`${summary.teamOverdue} of your team's follow-ups ${summary.teamOverdue === 1 ? "is" : "are"} overdue`}<span aria-hidden="true">→</span>
                </button>
              ) : null}
              {scope !== "team" && (
                <button type="button" onClick={() => setQueue(queue === "cancelled" ? "open" : "cancelled")}
                  className="text-xs font-medium text-text-secondary outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                  {queue === "cancelled" ? "Back to scheduled" : "Show cancelled"}
                </button>
              )}
            </span>
          </div>
          <EnterpriseDataGrid<FollowUp>
            aria-label="Follow-ups"
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            columnVisibility={columnChoice.visibility}
            onColumnVisibilityChange={columnChoice.setVisibility}
            state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading follow-ups" rows={8} onRetry={() => void listQuery.refetch()} />}
            errorContent={<ErrorState title="Could not load follow-ups" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
            emptyContent={<EmptyState title="Nobody to contact today" description="Schedule a follow-up from a lead, company, contact or deal, or here."
              action={can?.create ? { label: "New follow-up", onPress: () => setCreating(true) } : undefined} />}
            noResultsContent={queue === "overdue" && !submittedSearch && !activeFilters.length
              ? <NoResultsState title="Nothing overdue" description="Everyone has been contacted on time. Pick another queue to see what is next." />
              : <NoResultsState title="No follow-ups here" description="Try another queue, search or filter." />}
            manualSorting
            sorting={sorting}
            onSortingChange={(next) => { setSortingState(next); restart(); }}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
            totalRowCount={total}
            onPageChange={setPageIndex}
            enableRowSelection
            rowSelection={selection}
            onRowSelectionChange={setSelection}
            onRowClick={(row) => router.push(`/crm/follow-ups/${row.id}`)}
            // A phone card reads top to bottom: how and when, what to do, with whom and about what, then the actions.
            renderMobileCard={(row) => {
              const style = TYPE_STYLE[row.type] ?? TYPE_STYLE.other;
              const Icon = style.icon;
              const about = row.relatedName && row.relatedName !== row.contactName ? row.relatedName : row.accountName && row.accountName !== row.contactName ? row.accountName : null;
              return (
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
                      <Icon className="size-3.5" aria-hidden="true" />{row.typeName ?? TYPE_LABELS[row.type]}
                    </span>
                    <span className="text-xs"><FollowUpWhen followUp={row} /></span>
                  </div>
                  <span className={`text-sm ${row.status === "scheduled" ? "font-semibold text-text" : "text-text-secondary line-through"}`}>{row.subject}</span>
                  <span className="flex flex-col gap-0.5 text-xs text-text-secondary">
                    {row.contactName && <span className="flex items-center gap-1.5"><UserRound className="size-3.5 shrink-0" aria-hidden="true" />{row.contactName}</span>}
                    {about && <span className="flex items-center gap-1.5"><Building2 className="size-3.5 shrink-0" aria-hidden="true" />{about}{row.relatedType ? <span className="text-text-muted">· {RELATED_LABELS[row.relatedType]}</span> : null}</span>}
                  </span>
                  {row.status === "scheduled" && can?.complete ? (
                    <div className="border-t border-border pt-2">
                      <WorkRowActions kind="follow_up" id={row.id} layout="check" labelled snooze={row.assignedTo === options?.currentUserId} onDone={() => refresh()} onMessage={setNotice} />
                    </div>
                  ) : row.status !== "scheduled" ? <FollowUpStatusBadge status={row.status} /> : null}
                </div>
              );
            }}
          />
        </div>
      </EnterpriseListPage>

      {options && creating && <ScheduleFollowUpDialog isOpen onOpenChange={setCreating} options={options} onSaved={(saved) => { refresh(); router.push(`/crm/follow-ups/${saved.id}`); }} />}
      {options && bulk && <BulkDialog kind={bulk} ids={selectedIds} options={options} onClose={() => setBulk(null)} onDone={refresh} onError={setError} />}
    </div>
  );
}

// No bulk complete: each follow-up is a conversation with its own outcome.
function BulkDialog({ kind, ids, options, onClose, onDone, onError }: {
  kind: BulkKind; ids: string[]; options: FollowUpOptions; onClose: () => void; onDone: (result: FollowUpBulkResult) => void; onError: (message: string) => void;
}) {
  const [assignedTo, setAssignedTo] = useState("");
  const [shiftDays, setShiftDays] = useState("1");
  const [scheduledDate, setScheduledDate] = useState("");
  const [reason, setReason] = useState("");
  const count = `${ids.length} ${ids.length === 1 ? "follow-up" : "follow-ups"}`;
  const mutation = useMutation({
    mutationFn: () => bulkFollowUpAction({
      action: kind, followUpIds: ids, reason: reason || undefined,
      ...(kind === "reassign" ? { assignedTo } : kind === "reschedule" ? (scheduledDate ? { scheduledDate } : { shiftDays: Number(shiftDays) }) : {}),
    }),
    onSuccess: (result) => { onDone(result); onClose(); },
    onError: (failure) => { onError(errorMessage(failure)); onClose(); },
  });
  if (kind === "cancel")
    return <AlertDialog isOpen onOpenChange={(open) => !open && onClose()} tone="danger" title={`Cancel ${count}?`} description="Cancelled follow-ups are kept with their history; their reminders are cancelled."
      confirmLabel="Cancel follow-ups" isConfirming={mutation.isPending} onConfirm={() => mutation.mutate()} />;
  const valid = kind === "reassign" ? Boolean(assignedTo) : Boolean(scheduledDate) || (Number.isFinite(Number(shiftDays)) && Number(shiftDays) !== 0);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={kind === "reassign" ? `Reassign ${count}` : `Reschedule ${count}`}>
      <div className="flex flex-col gap-4">
        {kind === "reassign" ? (
          <Select label="Assign to" isRequired selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
            options={options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Move by days" inputMode="numeric" description="Negative moves earlier." value={shiftDays} onChange={setShiftDays} isDisabled={Boolean(scheduledDate)} />
            <DateInput label="Or set one date" value={scheduledDate} onChange={setScheduledDate} />
          </div>
        )}
        <TextField label="Reason" description="Optional. Kept in each follow-up's history." value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
