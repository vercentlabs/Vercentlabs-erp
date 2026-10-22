"use client";

// CRM To-dos › Tasks: the salesperson's work queue. Whose tasks (Mine / Team / Everyone) is a switch in the toolbar; when they are due is a
// row of coloured, counted queues (Overdue · Due today · Upcoming · All open · Completed). Each open row starts with a round Complete button,
// so it stays in reach however narrow the screen. Columns read When · What · About · Priority · Assigned to · Status · Created by · Created,
// any of them can be hidden under Columns; every other filter sits in one Filters button.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Check, Download, Plus, TriangleAlert } from "lucide-react";
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
  bulkTaskAction, errorMessage, getTaskOptions, getTaskSummary, listTasks, taskExportUrl,
  type Task, type TaskBulkResult, type TaskListFilters, type TaskOptions,
} from "../api/tasks-api";
import { TaskFormDialog } from "../components/TaskDialogs";
import { ErrorBanner, PRIORITY_OPTIONS, RELATED_LABELS, TaskDue, TaskPriorityBadge, TaskStatusBadge } from "../task-format";

const PAGE_SIZE = 25;
const ANY = "any";
const LIVE = { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false } as const;

type FilterKey = "priority" | "assigneeId" | "createdBy" | "relatedType";
const FILTER_KEYS: FilterKey[] = ["priority", "assigneeId", "createdBy", "relatedType"];
const FILTER_NAMES: Record<FilterKey, string> = { priority: "Priority", assigneeId: "Assigned to", createdBy: "Created by", relatedType: "About" };
type MoreKey = "accountId" | "dueFrom" | "dueTo" | "createdFrom" | "createdTo";
const MORE_KEYS: MoreKey[] = ["accountId", "dueFrom", "dueTo", "createdFrom", "createdTo"];
const NO_MORE = Object.fromEntries(MORE_KEYS.map((key) => [key, ""])) as Record<MoreKey, string>;
const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Record<FilterKey, string>;
const range = (from: string, to: string) => `${from ? formatDate(from) : "any"} – ${to ? formatDate(to) : "any"}`;
type BulkKind = "assign" | "priority" | "reschedule" | "complete" | "cancel";
const isOpen = (task: Task) => task.status === "open" || task.status === "in_progress";

type Scope = WorkScope;
type Queue = "overdue" | "today" | "upcoming" | "open" | "completed" | "cancelled";
const QUEUES: Array<Omit<QueueCard<Exclude<Queue, "cancelled">>, "count">> = [
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "today", label: "Due today", tone: "warning" },
  { key: "upcoming", label: "Upcoming", tone: "info" },
  { key: "open", label: "All open", tone: "brand" },
  { key: "completed", label: "Completed", tone: "success" },
];

// The list request behind a scope and a queue. Mine uses the server's own views; Team (open tasks only) and Everyone add a status and dates.
function queueFilters(scope: Scope, queue: Queue): TaskListFilters {
  if (scope === "mine")
    return queue === "cancelled" ? { view: "cancelled", assigneeId: "me" }
      : { view: ({ overdue: "overdue", today: "due_today", upcoming: "upcoming", open: "mine", completed: "completed" } as const)[queue] };
  const today = localDate();
  const tomorrow = localDate(1);
  const base: TaskListFilters = { view: scope === "team" ? "team" : "all" };
  if (queue === "overdue") return { ...base, status: "overdue" };
  if (queue === "today") return { ...base, status: "active", dueFrom: today, dueTo: today };
  if (queue === "upcoming") return { ...base, status: "active", dueFrom: tomorrow };
  if (queue === "completed" || queue === "cancelled") return { ...base, status: queue };
  return { ...base, status: "active" };
}
// Older links (?view=… from bookmarks, ?due=… from Home) open the matching scope and queue.
function fromParams(params: URLSearchParams): { scope: Scope; queue: Queue; priority?: string; createdBy?: string } {
  const due = params.get("due");
  if (due === "overdue") return { scope: "mine", queue: "overdue" };
  if (due === "today") return { scope: "mine", queue: "today" };
  switch (params.get("view")) {
    case "overdue": return { scope: "mine", queue: "overdue" };
    case "due_today": return { scope: "mine", queue: "today" };
    case "upcoming": return { scope: "mine", queue: "upcoming" };
    case "completed": return { scope: "mine", queue: "completed" };
    case "high_priority": return { scope: "mine", queue: "open", priority: "high" };
    case "team": return { scope: "team", queue: "open" };
    case "all": return { scope: "everyone", queue: "open" };
    case "created_by_me": return { scope: "everyone", queue: "open", createdBy: "me" };
    case "cancelled": return { scope: "mine", queue: "cancelled" };
    default: return { scope: "mine", queue: "open" };
  }
}

const OPTIONAL_COLUMNS: OptionalColumn[] = [
  { id: "related", label: "About" }, { id: "priority", label: "Priority" }, { id: "assignee", label: "Assigned to" }, { id: "status", label: "Status" },
  { id: "createdBy", label: "Created by" }, { id: "createdAt", label: "Created" },
];

// tabs: the To-dos tab row, drawn under the page title.
export function TaskListScreen({ tabs }: { tabs?: ReactNode } = {}) {
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
    ...(initial.priority ? { priority: initial.priority } : {}), ...(initial.createdBy ? { createdBy: initial.createdBy } : {}),
  }));
  const [more, setMoreState] = useState(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<MoreKey, string>);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkResult, setBulkResult] = useState<TaskBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const columnChoice = useColumnVisibility("crm.tasks.columns", OPTIONAL_COLUMNS);

  const restart = () => { setPageIndex(0); setSelection({}); };
  const setQueue = (next: Queue) => { setQueueState(next); restart(); };
  // Team shows open tasks only, so its Completed and Cancelled queues fall back to All open.
  const setScope = (next: Scope) => {
    setScopeState(next);
    if (next === "team" && (queue === "completed" || queue === "cancelled")) setQueueState("open");
    if (next === "mine" && filters.assigneeId !== ANY) setFiltersState({ ...filters, assigneeId: ANY });
    restart();
  };
  const setFilters = (next: Record<FilterKey, string>) => { setFiltersState(next); restart(); };
  const setMore = (next: Record<MoreKey, string>) => { setMoreState(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  useEffect(() => {
    const timer = setTimeout(() => { setSubmittedSearch(search.trim()); setPageIndex(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const hasView = (key: string) => Boolean(options?.views.some((entry) => entry.key === key));
  const scopes: Scope[] = ["mine", ...(hasView("team") ? ["team" as const] : []), ...(hasView("all") ? ["everyone" as const] : [])];
  const queues = QUEUES.filter((entry) => scope !== "team" || entry.key !== "completed");
  const summaryQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "summary"), queryFn: getTaskSummary, ...LIVE });

  // What the person narrowed to (search, Filters) applies to the list and to every queue's count; the queue sets the view, status and dates.
  const narrowing = useMemo(() => ({
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
  }) as TaskListFilters, [submittedSearch, filters, more]);
  const filtersFor = (forQueue: Queue): TaskListFilters => ({ ...narrowing, ...queueFilters(scope, forQueue) });
  const listFilters: TaskListFilters = { ...filtersFor(queue), sortBy: sorting[0]?.id, sortDirection: sorting[0]?.desc ? "desc" : "asc" };
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", listFilters, pageIndex),
    queryFn: () => listTasks({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
  // One count per queue: the same request as its list, one row long.
  const countQueries = useQueries({
    queries: queues.map((entry) => {
      const countFilters = filtersFor(entry.key);
      return { queryKey: scopedQueryKey(workspace, "crm", "tasks", "count", countFilters), queryFn: () => listTasks({ ...countFilters, limit: 1 }), placeholderData: keepPreviousData, ...LIVE };
    }),
  });
  const counts = Object.fromEntries(queues.map((entry, index) => [entry.key, countQueries[index]?.data?.total])) as Partial<Record<Queue, number>>;
  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const refresh = (result?: TaskBulkResult) => {
    if (result) setBulkResult(result);
    setSelection({});
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
  };

  const columns = useMemo<ColumnDef<Task, unknown>[]>(() => [
    {
      id: "done", header: () => <span className="sr-only">Complete</span>, enableSorting: false, enableHiding: false,
      cell: ({ row }) => row.original.status === "completed"
        ? <span className="flex size-6 items-center justify-center rounded-full bg-success text-white" title="Completed"><Check className="size-3.5" strokeWidth={3} aria-label="Completed" /></span>
        : isOpen(row.original) && can?.complete ? <WorkRowActions kind="task" id={row.original.id} layout="check" onDone={() => refresh()} onMessage={setNotice} /> : null,
    },
    { id: "dueAt", accessorKey: "dueAt", header: "When", cell: ({ row }) => <TaskDue task={row.original} /> },
    {
      id: "title", accessorKey: "title", header: "What", enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-56 flex-col">
          <span className={`font-medium ${isOpen(row.original) ? "text-text" : "text-text-secondary line-through"}`}>{row.original.title}</span>
          <span className="text-xs text-text-muted">{row.original.number}</span>
        </span>
      ),
    },
    {
      id: "related", header: "About", enableSorting: false,
      cell: ({ row }) => row.original.relatedType ? (
        <span className="flex min-w-36 flex-col text-sm">
          <span>{row.original.relatedName ?? RELATED_LABELS[row.original.relatedType]}</span>
          <span className="text-xs text-text-muted">{RELATED_LABELS[row.original.relatedType]}{row.original.accountName && row.original.relatedType !== "party" ? ` · ${row.original.accountName}` : ""}</span>
        </span>
      ) : <span className="text-text-muted">Personal</span>,
    },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <TaskPriorityBadge priority={row.original.priority} /> },
    { id: "assignee", accessorKey: "assignedName", header: "Assigned to", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assignedName ?? "Unassigned"}</span> },
    { id: "status", accessorKey: "status", header: "Status", enableSorting: false, cell: ({ row }) => <TaskStatusBadge status={row.original.status} /> },
    { id: "createdBy", accessorKey: "createdByName", header: "Created by", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.createdByName ?? ""}</span> },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only invalidates the list
  ], [can?.complete]);

  const withAny = (list: Array<{ value: string; label: string }>, label: string) => [{ value: ANY, label }, ...list];
  // You are offered as "Me", so you are not listed again by name.
  const people = (options?.users ?? []).filter((user) => user.id !== options?.currentUserId).map((user) => ({ value: user.id, label: user.name }));
  const labelOf = (key: FilterKey, value: string) => {
    if (key === "priority") return PRIORITY_OPTIONS.find((entry) => entry.value === value)?.label ?? value;
    if (key === "relatedType") return value === "none" ? "Personal" : RELATED_LABELS[value] ?? value;
    if (value === "me") return "Me";
    if (value === "unassigned") return "Unassigned";
    return people.find((entry) => entry.value === value)?.label ?? "Chosen person";
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Company: ${accountName ?? "chosen company"}` }] : []),
    ...(more.dueFrom || more.dueTo ? [{ id: "more:due", label: `Due: ${range(more.dueFrom, more.dueTo)}` }] : []),
    ...(more.createdFrom || more.createdTo ? [{ id: "more:created", label: `Created: ${range(more.createdFrom, more.createdTo)}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "more:due") setMore({ ...more, dueFrom: "", dueTo: "" });
    else if (id === "more:created") setMore({ ...more, createdFrom: "", createdTo: "" });
    else if (id.startsWith("more:")) setMore({ ...more, [id.slice(5)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const clearFilters = () => { setMore(NO_MORE); setFilters(NO_FILTERS); };
  const draft = (key: MoreKey) => (value: string) => setMore({ ...more, [key]: value });
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || scope !== "mine" || queue !== "open";
  const summary = summaryQuery.data;

  if (optionsQuery.isError && !workspace.permissions.includes("crm.tasks.view") && !workspace.permissions.includes("crm.activities.manage"))
    return <PermissionState title="You don't have access to tasks" description="Ask an administrator for the View tasks permission." />;

  return (
    <div className="flex flex-col gap-4">
      {bulkResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <div>
            <p className="font-medium">{bulkResult.succeeded} updated{bulkResult.failed ? `, ${bulkResult.failed} could not be updated` : ""}.</p>
            {bulkResult.results.filter((entry) => !entry.ok).slice(0, 5).map((entry) => <p key={entry.taskId} className="text-text-secondary">{entry.message}</p>)}
          </div>
          <Button variant="ghost" size="compact" onPress={() => setBulkResult(null)}>Dismiss</Button>
        </div>
      )}
      <ErrorBanner message={error ?? (optionsQuery.isError ? "The task filters could not be loaded. Refresh the page." : null)} />
      {notice && <p role="status" className="self-start rounded-[var(--radius-control)] bg-success-soft px-3 py-1.5 text-sm text-success">{notice}</p>}

      <EnterpriseListPage
        tabs={tabs}
        header={{
          title: tabs ? "To-dos" : "Tasks",
          description: "Overdue first, then today, then what is coming up.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New task</Button> : undefined,
          secondaryActions: can?.export ? (
            <a className={buttonVariants({ variant: "outline" })} href={taskExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" /><span>Export</span></a>
          ) : undefined,
        }}
        actionBar={{
          leading: scopes.length > 1 ? <ScopeSwitch label="Whose tasks" scopes={scopes} value={scope} onChange={setScope} /> : undefined,
          start: (
            <>
              <SearchField aria-label="Search tasks" placeholder="Search task or number" className="w-full sm:w-72" value={search} onChange={setSearch}
                onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
              {options && (
                <FiltersPopover active={activeFilters.length} onClear={clearFilters}>
                  <Select label="Priority" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  {scope !== "mine" && (
                    <Select label="Assigned to" selectedKey={filters.assigneeId} onSelectionChange={(key) => setFilters({ ...filters, assigneeId: String(key) })}
                      options={withAny([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...people], "Anyone")} />
                  )}
                  <Select label="About" selectedKey={filters.relatedType} onSelectionChange={(key) => setFilters({ ...filters, relatedType: String(key) })}
                    options={withAny([...options.relatedTypes.map((entry) => ({ value: entry.code, label: RELATED_LABELS[entry.code] ?? entry.label })), { value: "none", label: "Personal" }], "Any record")} />
                  <Select label="Created by" selectedKey={filters.createdBy} onSelectionChange={(key) => setFilters({ ...filters, createdBy: String(key) })}
                    options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  <AccountPicker label="Company" description="Tasks on the company, its deals and its contacts." value={more.accountId || null}
                    onChange={(id, name) => { draft("accountId")(id ?? ""); setAccountName(name); }} />
                  <DateInput label="Due from" value={more.dueFrom} onChange={draft("dueFrom")} />
                  <DateInput label="Due to" value={more.dueTo} onChange={draft("dueTo")} />
                  <DateInput label="Created from" value={more.createdFrom} onChange={draft("createdFrom")} />
                  <DateInput label="Created to" value={more.createdTo} onChange={draft("createdTo")} />
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
              {can?.reassign && <Button variant="secondary" size="compact" onPress={() => setBulk("assign")}>Reassign</Button>}
              {can?.edit && <Button variant="secondary" size="compact" onPress={() => setBulk("priority")}>Priority</Button>}
              {can?.edit && <Button variant="secondary" size="compact" onPress={() => setBulk("reschedule")}>Move due date</Button>}
              {can?.complete && <Button variant="secondary" size="compact" onPress={() => setBulk("complete")}>Complete</Button>}
              {can?.cancel && <Button variant="secondary" size="compact" onPress={() => setBulk("cancel")}>Cancel</Button>}
            </>
          ),
        } : undefined}
      >
        <div className="flex flex-col gap-4">
          <QueueCards<Queue> label="Task queues" cards={queues.map((entry) => ({ ...entry, count: counts[entry.key] }))} value={queue} onChange={setQueue} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* The highlighted queue and the scope switch already say what is shown; only the cancelled list, which has no card, says so. */}
            {queue === "cancelled" ? <p className="text-sm font-medium text-text">Cancelled tasks</p> : <span />}
            <span className="flex flex-wrap items-center gap-3">
              {summary?.teamOverdue && scope !== "team" ? (
                <button type="button" onClick={() => { setScope("team"); setQueue("overdue"); }}
                  className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {`${summary.teamOverdue} of your team's tasks ${summary.teamOverdue === 1 ? "is" : "are"} overdue`}<span aria-hidden="true">→</span>
                </button>
              ) : null}
              {scope !== "team" && (
                <button type="button" onClick={() => setQueue(queue === "cancelled" ? "open" : "cancelled")}
                  className="text-xs font-medium text-text-secondary outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand">
                  {queue === "cancelled" ? "Back to open tasks" : "Show cancelled"}
                </button>
              )}
            </span>
          </div>
          <EnterpriseDataGrid<Task>
            aria-label="Tasks"
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            columnVisibility={columnChoice.visibility}
            onColumnVisibilityChange={columnChoice.setVisibility}
            state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading tasks" rows={8} onRetry={() => void listQuery.refetch()} />}
            errorContent={<ErrorState title="Could not load tasks" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
            emptyContent={<EmptyState title="Nothing to do" description="You have no open tasks. Create one, or add one from a lead, company, contact or deal."
              action={can?.create ? { label: "New task", onPress: () => setCreating(true) } : undefined} />}
            noResultsContent={queue === "overdue" && !submittedSearch && !activeFilters.length
              ? <NoResultsState title="Nothing overdue" description="You are on top of things. Pick another queue to see what is next." />
              : <NoResultsState title="No tasks here" description="Try another queue, search or filter." />}
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
            onRowClick={(row) => router.push(`/crm/tasks/${row.id}`)}
            renderMobileCard={(row) => (
              // Read top to bottom: when and how urgent, what to do, about what and for whom, then the action.
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><TaskDue task={row} /><TaskPriorityBadge priority={row.priority} /></div>
                <span className={`text-sm ${isOpen(row) ? "font-semibold text-text" : "text-text-secondary line-through"}`}>{row.title}</span>
                <span className="text-xs text-text-secondary">{row.relatedName ? `${row.relatedName} · ${RELATED_LABELS[row.relatedType ?? ""] ?? ""}` : "Personal"} · {row.assignedName ?? "Unassigned"}</span>
                {isOpen(row) && can?.complete ? (
                  <div className="border-t border-border pt-2"><WorkRowActions kind="task" id={row.id} layout="check" labelled onDone={() => refresh()} onMessage={setNotice} /></div>
                ) : <TaskStatusBadge status={row.status} />}
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>

      {options && creating && <TaskFormDialog isOpen onOpenChange={setCreating} options={options} onSaved={(task) => { refresh(); router.push(`/crm/tasks/${task.id}`); }} />}
      {options && bulk && <BulkDialog kind={bulk} taskIds={selectedIds} options={options} onClose={() => setBulk(null)} onDone={refresh} onError={setError} />}
    </div>
  );
}

// Bulk actions ask first; each task is then checked on its own.
function BulkDialog({ kind, taskIds, options, onClose, onDone, onError }: {
  kind: BulkKind; taskIds: string[]; options: TaskOptions; onClose: () => void; onDone: (result: TaskBulkResult) => void; onError: (message: string) => void;
}) {
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState("medium");
  const [shiftDays, setShiftDays] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [reason, setReason] = useState("");
  const count = `${taskIds.length} ${taskIds.length === 1 ? "task" : "tasks"}`;
  const mutation = useMutation({
    mutationFn: () => bulkTaskAction({
      action: kind, taskIds,
      ...(kind === "assign" ? { assignedTo, reason: reason.trim() || undefined } : kind === "priority" ? { priority } : kind === "reschedule" ? (dueDate ? { dueDate } : { shiftDays: Number(shiftDays) }) : kind === "cancel" ? { reason } : {}),
    }),
    onSuccess: (result) => { onDone(result); onClose(); },
    onError: (failure) => { onError(errorMessage(failure)); onClose(); },
  });
  if (kind === "complete" || kind === "cancel")
    return (
      <AlertDialog isOpen onOpenChange={(open) => !open && onClose()} tone={kind === "cancel" ? "danger" : undefined}
        title={kind === "complete" ? `Complete ${count}?` : `Cancel ${count}?`}
        description={kind === "complete" ? "Each task is marked completed by you, now." : "Cancelled tasks are kept with their history and can be reopened."}
        confirmLabel={kind === "complete" ? "Complete" : "Cancel tasks"} isConfirming={mutation.isPending} onConfirm={() => mutation.mutate()} />
    );
  const valid = kind === "assign" ? Boolean(assignedTo) : kind === "reschedule" ? Boolean(dueDate) || (Number.isFinite(Number(shiftDays)) && Number(shiftDays) !== 0) : true;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={kind === "assign" ? `Reassign ${count}` : kind === "priority" ? `Set priority of ${count}` : `Move the due date of ${count}`}>
      <div className="flex flex-col gap-4">
        {kind === "assign" && (
          <>
            <Select label="Assign to" isRequired selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
              options={options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
            <TextField label="Reason" description="Optional." value={reason} onChange={setReason} />
          </>
        )}
        {kind === "priority" && <Select label="Priority" selectedKey={priority} onSelectionChange={(key) => setPriority(String(key))} options={PRIORITY_OPTIONS} />}
        {kind === "reschedule" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Move by days" inputMode="numeric" description="Negative moves earlier." value={shiftDays} onChange={setShiftDays} isDisabled={Boolean(dueDate)} />
            <DateInput label="Or set one due date" value={dueDate} onChange={setDueDate} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!valid}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
