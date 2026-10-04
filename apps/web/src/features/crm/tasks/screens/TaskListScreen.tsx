"use client";

// CRM Tasks: the salesperson's work queue. My Tasks is the default, with
// what is overdue, due today and upcoming counted at the top.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { Download, Filter, Plus } from "lucide-react";
import {
  AlertDialog, Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, NoResultsState, PermissionState, Popover,
  PopoverTrigger, SearchField, Select, TextField, buttonVariants, type ActiveFilter,
} from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  bulkTaskAction, errorMessage, getTaskOptions, getTaskSummary, listTasks, taskExportUrl,
  type Task, type TaskBulkResult, type TaskListFilters, type TaskOptions, type TaskViewKey,
} from "../api/tasks-api";
import { CompleteTaskDialog, TaskFormDialog } from "../components/TaskDialogs";
import { ErrorBanner, PRIORITY_OPTIONS, RELATED_LABELS, STATUS_LABELS, TaskDue, TaskPriorityBadge, TaskStatusBadge } from "../task-format";

const PAGE_SIZE = 25;
const ANY = "any";
const LIVE = { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchInterval: 60_000, refetchIntervalInBackground: false } as const;

type FilterKey = "status" | "priority" | "assigneeId" | "createdBy" | "relatedType";
const FILTER_KEYS: FilterKey[] = ["status", "priority", "assigneeId", "createdBy", "relatedType"];
const FILTER_NAMES: Record<FilterKey, string> = { status: "Status", priority: "Priority", assigneeId: "Assigned to", createdBy: "Created by", relatedType: "About" };
type MoreKey = "accountId" | "dueFrom" | "dueTo" | "createdFrom" | "createdTo";
const MORE_KEYS: MoreKey[] = ["accountId", "dueFrom", "dueTo", "createdFrom", "createdTo"];
const NO_MORE = Object.fromEntries(MORE_KEYS.map((key) => [key, ""])) as Record<MoreKey, string>;
const range = (from: string, to: string) => `${from ? formatDate(from) : "any"} – ${to ? formatDate(to) : "any"}`;
type BulkKind = "assign" | "priority" | "reschedule" | "complete" | "cancel";

export function TaskListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const initialView = (params.get("view") as TaskViewKey) || (params.get("due") === "overdue" ? "overdue" : params.get("due") === "today" ? "due_today" : "mine");
  const [view, setViewState] = useState<TaskViewKey>(initialView);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [submittedSearch, setSubmittedSearch] = useState(params.get("search") ?? "");
  const [filters, setFiltersState] = useState(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ANY])) as Record<FilterKey, string>);
  const [more, setMoreState] = useState(() => Object.fromEntries(MORE_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<MoreKey, string>);
  const [moreDraft, setMoreDraft] = useState(more);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [sorting, setSortingState] = useState<SortingState>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [completing, setCompleting] = useState<Task | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkResult, setBulkResult] = useState<TaskBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restart = () => { setPageIndex(0); setSelection({}); };
  const setView = (next: TaskViewKey) => { setViewState(next); restart(); };
  const setFilters = (next: Record<FilterKey, string>) => { setFiltersState(next); restart(); };
  const setMore = (next: Record<MoreKey, string>) => { setMoreState(next); setMoreDraft(next); restart(); };
  const setSorting = (next: SortingState) => { setSortingState(next); restart(); };
  useEffect(() => {
    const timer = setTimeout(() => { setSubmittedSearch(search.trim()); setPageIndex(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const summaryQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "summary"), queryFn: getTaskSummary, ...LIVE });
  const listFilters: TaskListFilters = useMemo(() => ({
    view,
    search: submittedSearch || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ANY)),
    ...Object.fromEntries(Object.entries(more).filter(([, value]) => value.trim())),
    sortBy: sorting[0]?.id,
    sortDirection: sorting[0]?.desc ? "desc" : "asc",
  }), [view, submittedSearch, filters, more, sorting]);
  const listQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", listFilters, pageIndex),
    queryFn: () => listTasks({ ...listFilters, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE }),
    placeholderData: keepPreviousData,
    ...LIVE,
  });
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
      id: "title", accessorKey: "title", header: "Task", enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-56 flex-col">
          <span className={`font-medium ${row.original.status === "completed" ? "text-text-secondary line-through" : "text-text"}`}>{row.original.title}</span>
          <span className="text-xs text-text-muted">{row.original.number}</span>
        </span>
      ),
    },
    { id: "dueAt", accessorKey: "dueAt", header: "Due", cell: ({ row }) => <TaskDue task={row.original} /> },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <TaskPriorityBadge priority={row.original.priority} /> },
    { id: "status", accessorKey: "status", header: "Status", enableSorting: false, cell: ({ row }) => <TaskStatusBadge status={row.original.status} /> },
    {
      id: "related", header: "About", enableSorting: false,
      cell: ({ row }) => row.original.relatedType ? (
        <span className="flex min-w-36 flex-col text-sm">
          <span>{row.original.relatedName ?? RELATED_LABELS[row.original.relatedType]}</span>
          <span className="text-xs text-text-muted">{RELATED_LABELS[row.original.relatedType]}{row.original.accountName && row.original.relatedType !== "party" ? ` · ${row.original.accountName}` : ""}</span>
        </span>
      ) : <span className="text-text-muted">Personal</span>,
    },
    { id: "assignee", accessorKey: "assignedName", header: "Assigned to", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.assignedName ?? "Unassigned"}</span> },
    { id: "createdBy", accessorKey: "createdByName", header: "Created by", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.createdByName ?? ""}</span> },
    { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: ({ row }) => formatDate(row.original.createdAt) },
    {
      id: "actions", header: "", enableSorting: false, enableHiding: false,
      cell: ({ row }) => (row.original.status === "open" || row.original.status === "in_progress") && can?.complete ? (
        <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} role="presentation">
          <Button variant="secondary" size="compact" onPress={() => setCompleting(row.original)}>Complete</Button>
        </span>
      ) : null,
    },
  ], [can?.complete]);

  const withAny = (list: Array<{ value: string; label: string }>, label: string) => [{ value: ANY, label }, ...list];
  const people = (options?.users ?? []).map((user) => ({ value: user.id, label: user.name }));
  const labelOf = (key: FilterKey, value: string) => {
    if (key === "status") return value === "overdue" ? "Overdue" : STATUS_LABELS[value as Task["status"]] ?? value;
    if (key === "priority") return PRIORITY_OPTIONS.find((entry) => entry.value === value)?.label ?? value;
    if (key === "relatedType") return value === "none" ? "Personal" : RELATED_LABELS[value] ?? value;
    if (value === "me") return "Me";
    return people.find((entry) => entry.value === value)?.label ?? "Chosen person";
  };
  const activeFilters: ActiveFilter[] = [
    ...FILTER_KEYS.filter((key) => filters[key] !== ANY).map((key) => ({ id: key, label: `${FILTER_NAMES[key]}: ${labelOf(key, filters[key])}` })),
    ...(more.accountId ? [{ id: "more:accountId", label: `Account: ${accountName ?? "chosen account"}` }] : []),
    ...(more.dueFrom || more.dueTo ? [{ id: "more:due", label: `Due: ${range(more.dueFrom, more.dueTo)}` }] : []),
    ...(more.createdFrom || more.createdTo ? [{ id: "more:created", label: `Created: ${range(more.createdFrom, more.createdTo)}` }] : []),
  ];
  const removeFilter = (id: string) => {
    if (id === "more:due") setMore({ ...more, dueFrom: "", dueTo: "" });
    else if (id === "more:created") setMore({ ...more, createdFrom: "", createdTo: "" });
    else if (id.startsWith("more:")) setMore({ ...more, [id.slice(5)]: "" });
    else setFilters({ ...filters, [id]: ANY });
  };
  const draft = (key: MoreKey) => (value: string) => setMoreDraft((current) => ({ ...current, [key]: value }));
  const hasCriteria = Boolean(submittedSearch) || activeFilters.length > 0 || view !== "mine";
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

      <EnterpriseListPage
        header={{
          title: "Tasks",
          description: "The work you have to do: overdue first, then today, then what is coming up.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New task</Button> : undefined,
          secondaryActions: can?.export ? (
            <a className={buttonVariants({ variant: "outline" })} href={taskExportUrl(listFilters)} download><Download className="size-4" aria-hidden="true" />Export</a>
          ) : undefined,
        }}
        savedViews={options ? { views: options.views.map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: (id) => setView(id as TaskViewKey) } : undefined}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search tasks" placeholder="Search task or number" className="w-full sm:w-72" value={search} onChange={setSearch}
                onSubmit={(value) => { setSubmittedSearch(value.trim()); setPageIndex(0); }} />
              {options && (
                <>
                  <Select aria-label="Status" size="compact" selectedKey={filters.status} onSelectionChange={(key) => setFilters({ ...filters, status: String(key) })}
                    options={withAny([...options.statuses.map((entry) => ({ value: entry.code, label: entry.label })), { value: "overdue", label: "Overdue" }], "Any status")} />
                  <Select aria-label="Priority" size="compact" selectedKey={filters.priority} onSelectionChange={(key) => setFilters({ ...filters, priority: String(key) })} options={withAny(PRIORITY_OPTIONS, "Any priority")} />
                  <Select aria-label="Assigned to" size="compact" selectedKey={filters.assigneeId} onSelectionChange={(key) => setFilters({ ...filters, assigneeId: String(key) })}
                    options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                  <Select aria-label="About" size="compact" selectedKey={filters.relatedType} onSelectionChange={(key) => setFilters({ ...filters, relatedType: String(key) })}
                    options={withAny([...options.relatedTypes.map((entry) => ({ value: entry.code, label: entry.label })), { value: "none", label: "Personal" }], "Any record")} />
                  <PopoverTrigger>
                    <Button variant="outline" size="compact"><Filter className="size-4" aria-hidden="true" />Creator, account and dates</Button>
                    <Popover placement="bottom start">
                      <div className="grid w-[min(24rem,calc(100vw-4rem))] grid-cols-2 gap-3">
                        <Select label="Created by" className="col-span-2" selectedKey={filters.createdBy} onSelectionChange={(key) => setFilters({ ...filters, createdBy: String(key) })}
                          options={withAny([{ value: "me", label: "Me" }, ...people], "Anyone")} />
                        <div className="col-span-2">
                          <AccountPicker label="Account" description="Tasks on the account, its opportunities and its contacts." value={moreDraft.accountId || null}
                            onChange={(id, name) => { draft("accountId")(id ?? ""); setAccountName(name); }} />
                        </div>
                        <DateInput label="Due from" value={moreDraft.dueFrom} onChange={draft("dueFrom")} />
                        <DateInput label="Due to" value={moreDraft.dueTo} onChange={draft("dueTo")} />
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
        }}
        filterBar={activeFilters.length ? { filters: activeFilters, onRemove: removeFilter, onClearAll: () => { setMore(NO_MORE); setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, ANY])) as Record<FilterKey, string>); } } : undefined}
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
          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="Overdue" value={summary.overdue} onPress={() => setView("overdue")} />
              <SummaryCard label="Due today" value={summary.dueToday} onPress={() => setView("due_today")} />
              <SummaryCard label="Upcoming" value={summary.upcoming} onPress={() => setView("upcoming")} />
              {summary.teamOverdue !== null
                ? <SummaryCard label="Team overdue" value={summary.teamOverdue} onPress={() => { setView("team"); setFilters({ ...filters, status: "overdue" }); }} />
                : <SummaryCard label="High priority" value={summary.highPriority} onPress={() => setView("high_priority")} />}
            </div>
          )}
          <EnterpriseDataGrid<Task>
            aria-label="Tasks"
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            state={listQuery.isLoading ? "loading" : listQuery.isError ? "error" : rows.length === 0 ? (hasCriteria ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading tasks" rows={8} onRetry={() => void listQuery.refetch()} />}
            errorContent={<ErrorState title="Could not load tasks" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void listQuery.refetch() }} />}
            emptyContent={<EmptyState title="Nothing to do" description="You have no open tasks. Create one, or add one from a lead, account, contact or opportunity."
              action={can?.create ? { label: "New task", onPress: () => setCreating(true) } : undefined} />}
            noResultsContent={<NoResultsState title="No tasks here" description="Try a different view, search or filter." />}
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
              <div className="flex flex-col gap-1">
                <span className="font-medium">{row.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs"><TaskDue task={row} /><TaskPriorityBadge priority={row.priority} /></span>
                <span className="text-xs text-text-secondary">{row.relatedName ?? "Personal"} · {row.assignedName ?? "Unassigned"}</span>
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>

      {options && creating && <TaskFormDialog isOpen onOpenChange={setCreating} options={options} onSaved={(task) => { refresh(); router.push(`/crm/tasks/${task.id}`); }} />}
      {options && completing && <CompleteTaskDialog isOpen onOpenChange={(isOpen) => !isOpen && setCompleting(null)} task={completing} options={options} onDone={() => refresh()} />}
      {options && bulk && <BulkDialog kind={bulk} taskIds={selectedIds} options={options} onClose={() => setBulk(null)} onDone={refresh} onError={setError} />}
    </div>
  );
}

function SummaryCard({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} className="rounded-[var(--radius-card)] text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
      <MetricCard label={label} value={value} />
    </button>
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
      ...(kind === "assign" ? { assignedTo } : kind === "priority" ? { priority } : kind === "reschedule" ? (dueDate ? { dueDate } : { shiftDays: Number(shiftDays) }) : kind === "cancel" ? { reason } : {}),
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
