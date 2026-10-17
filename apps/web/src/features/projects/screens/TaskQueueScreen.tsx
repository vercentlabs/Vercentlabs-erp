"use client";

// Tasks across every project the person may see: their own work (My Tasks), everything open, what is due soon or overdue, in review (and the
// reviews waiting for them), blocked, done, cancelled and archived — searched, filtered, sorted and paged on the server; as a table, grouped,
// or a status board; saved as personal views; and changed in bulk, task by task, with the outcome of each reported.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { filterBarOf, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  PRIORITY_LABEL, TASKS_BASE, TASK_STATUS_TEXT, TASK_TONE, TASK_TYPE_LABEL, bulkTasks, dateLabel, deleteTaskView, dueLabel, errorMessage, errorStatus, getOptions, getTaskViews,
  listTasks, newKey, saveTaskView, taskExportHref, type TaskBulkResult, type TaskRow,
  type Priority,
} from "../api/projects-api";
import { GROUP_OPTIONS, TaskBoard, TaskTable, type GroupBy } from "../components/TaskViews";
import { NeedsOwnerBadge } from "../assignees/AssigneeViews";
import { PriorityBadge, PriorityChips } from "../priority/Priority";
import { PRIORITIES, PRIORITY_DESCRIPTION } from "../priority/priority-api";

const VIEWS = [{ id: "mine", label: "Assigned to me" }, { id: "open", label: "All open" }, { id: "due_soon", label: "Due soon" }, { id: "overdue", label: "Overdue" },
  { id: "in_review", label: "In review" }, { id: "my_reviews", label: "My reviews" }, { id: "blocked", label: "Blocked" }, { id: "completed", label: "Done" }, { id: "all", label: "All" },
  { id: "cancelled", label: "Cancelled" }, { id: "archived", label: "Archived" }, { id: "unassigned", label: "Needs an owner" }];
const FILTER_KEYS = ["status", "priority", "assigneeId", "type"] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;
const EMPTY: Record<string, string> = { mine: "Nothing is assigned to you right now.", open: "No open tasks.", due_soon: "Nothing is due soon.", overdue: "Nothing is overdue.", in_review: "Nothing is in review.",
  my_reviews: "No task waits for your review.", blocked: "Nothing is blocked.", completed: "No task is done yet.", all: "No tasks yet.", cancelled: "No cancelled tasks.", archived: "Nothing is archived.",
  unassigned: "Every open task has an active owner on its team." };

export function TaskQueueScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const views = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task-views"), queryFn: getTaskViews });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [view, setView] = useState(() => (VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "mine"));
  // A link may open the list already filtered (?priority=URGENT from the overview, ?assigneeId= from the team's workload).
  const [filters, setFilters] = useState<Filters>(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]).filter(([, value]) => value)) as Filters);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [order, setOrder] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [dialog, setDialog] = useState<"save" | "bulk" | null>(null);
  const [outcome, setOutcome] = useState<TaskBulkResult | null>(null);
  const appliedDefault = useRef(false);
  const urlView = params.get("view");
  const [seenUrlView, setSeenUrlView] = useState(urlView);
  if (urlView !== seenUrlView) {
    setSeenUrlView(urlView);
    if (urlView && VIEWS.some((row) => row.id === urlView)) { setView(urlView); setPage(0); setSelection({}); }
  }
  useEffect(() => {
    if (appliedDefault.current || params.get("view") || !views.data) return;
    appliedDefault.current = true;
    const preferred = views.data.find((row) => row.isDefault);
    if (preferred) apply(`saved:${preferred.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the views arrive
  }, [views.data]);
  const saved = view.startsWith("saved:") ? views.data?.find((row) => `saved:${row.id}` === view) ?? null : null;
  const baseView = saved ? saved.filters.view ?? "open" : view;
  const board = layout === "board";
  // A column header's sort wins; otherwise the chosen order (My Tasks starts on "Needs attention").
  const query = { view: baseView, search: term || undefined, ...filters, sort: sorting[0]?.id ?? order, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : order === "updated" ? "desc" : undefined,
    page: board || groupBy !== "none" ? 1 : page + 1, pageSize: board || groupBy !== "none" ? 500 : 25 };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task-queue", query), queryFn: () => listTasks(query), placeholderData: (previous) => previous, retry: false });
  const rows = list.data?.rows ?? [];
  function apply(id: string) {
    setView(id); setPage(0); setSelection({});
    const entry = id.startsWith("saved:") ? views.data?.find((row) => `saved:${row.id}` === id) : null;
    if (entry) {
      setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, entry.filters[key]]).filter(([, value]) => value)) as Filters);
      setSearch(entry.filters.search ?? "");
      if (entry.filters.layout === "board" || entry.filters.layout === "list") setLayout(entry.filters.layout);
      if (entry.filters.groupBy) setGroupBy(entry.filters.groupBy as GroupBy);
    } else router.replace(`${pathname}?view=${id}`);
  }
  const setFilter = (key: keyof Filters) => (value: string | null) => { setFilters((current) => ({ ...current, [key]: value || undefined })); setPage(0); };
  const people = (options.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }));
  const columns = useMemo<ColumnDef<TaskRow, unknown>[]>(() => [
    { id: "title", accessorKey: "title", header: "Task", enableHiding: false, cell: ({ row }) => (
      <span className="flex min-w-0 flex-col"><span className="truncate font-medium text-text" title={row.original.title}>{row.original.title}</span>
        <span className="text-xs text-text-muted">{`${row.original.code}${row.original.reviewRequired ? " · review" : ""}`}</span>
        {row.original.attention?.length ? <span className="text-xs font-medium text-danger">{row.original.attention.join(" · ")}</span> : null}</span>) },
    { id: "project", accessorKey: "projectCode", header: "Project", cell: ({ row }) => <span className="flex min-w-0 flex-col"><span>{row.original.projectCode}</span>
      {row.original.projectName && <span className="truncate text-xs text-text-muted">{row.original.projectName}</span>}</span> },
    { id: "milestone", header: "Milestone", enableSorting: false, cell: ({ row }) => row.original.milestone?.code ?? <span className="text-text-muted">—</span> },
    { id: "assignee", accessorKey: "assignee", header: "Assigned to", cell: ({ row }) => <span className="flex flex-wrap items-center gap-1">{row.original.assignee ?? "—"}
      {row.original.needsOwner && <NeedsOwnerBadge />}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TASK_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
    { id: "due", accessorKey: "dueDate", header: "Due", cell: ({ row }) => <span className="flex flex-col"><span>{dateLabel(row.original.dueDate)}</span>
      {dueLabel(row.original) && <span className={`text-xs ${row.original.overdue ? "text-danger" : "text-text-muted"}`}>{dueLabel(row.original)}</span>}</span> },
    { id: "checklist", header: "Checklist", enableSorting: false, cell: ({ row }) => (row.original.checklist?.total ? `${row.original.checklist.done} / ${row.original.checklist.total}` : <span className="text-text-muted">—</span>) },
    { id: "updated", accessorKey: "updatedAt", header: "Last updated", cell: ({ row }) => dateLabel(row.original.updatedAt) },
  ], []);
  if (list.error && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to project tasks" description="Ask an administrator for access to project tasks." />;
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); };
  const allViews = [...VIEWS, ...(views.data ?? []).map((row) => ({ id: `saved:${row.id}`, label: row.isDefault ? `${row.name} (default)` : row.name }))];
  const chips = [
    { id: "status", active: Boolean(filters.status), label: `Status: ${TASK_STATUS_TEXT[filters.status as keyof typeof TASK_STATUS_TEXT] ?? filters.status}`, clear: () => setFilter("status")(null) },
    { id: "priority", active: Boolean(filters.priority), label: `Priority: ${(filters.priority ?? "").split(",").map((level) => PRIORITY_LABEL[level as Priority] ?? level).join(", ")}`, clear: () => setFilter("priority")(null) },
    { id: "assigneeId", active: Boolean(filters.assigneeId), label: `Assigned to: ${people.find((row) => row.value === filters.assigneeId)?.label ?? ""}`, clear: () => setFilter("assigneeId")(null) },
    { id: "type", active: Boolean(filters.type), label: `Type: ${TASK_TYPE_LABEL[filters.type ?? ""] ?? ""}`, clear: () => setFilter("type")(null) },
  ];
  const filtered = Boolean(term || Object.values(filters).some(Boolean));
  return (
    <EnterpriseListPage
      header={{ title: baseView === "mine" && !saved ? "My Tasks" : "Tasks", description: "The work of every project you can see: who does what, by when, and where it stands.",
        secondaryActions: (
          <span className="flex flex-wrap gap-2">
            <Select aria-label="Layout" size="compact" selectedKey={layout} onSelectionChange={(key) => { setLayout(key === "board" ? "board" : "list"); setSelection({}); }}
              options={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} />
            {list.data?.can.export && <LinkButton variant="secondary" href={taskExportHref({ view: baseView, search: term || undefined, ...filters })}>Export</LinkButton>}
          </span>
        ) }}
      savedViews={{ views: allViews, activeViewId: view, onSelect: apply, onCreateView: () => setDialog("save") }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search tasks" placeholder="Task, code, project or tag" className="w-full sm:w-80" value={search} onChange={(value) => { setSearch(value); setPage(0); }} />
            <Select aria-label="Status" label="Status" size="compact" placeholder="Any status" selectedKey={filters.status ?? null} onSelectionChange={(key) => setFilter("status")(key ? String(key) : null)}
              options={Object.entries(TASK_STATUS_TEXT).map(([value, label]) => ({ value, label }))} />
            <PriorityChips selected={filters.priority} counts={list.data?.priorityCounts} onChange={(next) => setFilter("priority")(next)} />
            <Select aria-label="Order" label="Order" size="compact" selectedKey={sorting[0] ? null : order ?? list.data?.sort ?? "due"}
              onSelectionChange={(key) => { setSorting([]); setOrder(String(key)); setPage(0); }} options={ORDER_OPTIONS} />
            <Select aria-label="Assigned to" label="Assigned to" size="compact" placeholder="Anyone" selectedKey={filters.assigneeId ?? null} onSelectionChange={(key) => setFilter("assigneeId")(key ? String(key) : null)} options={people} />
            <Select aria-label="Type" label="Type" size="compact" placeholder="Any type" selectedKey={filters.type ?? null} onSelectionChange={(key) => setFilter("type")(key ? String(key) : null)}
              options={Object.entries(TASK_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
            {!board && <Select aria-label="Group" label="Group" size="compact" selectedKey={groupBy} onSelectionChange={(key) => { setGroupBy(String(key) as GroupBy); setSelection({}); }} options={GROUP_OPTIONS} />}
          </>
        ),
      }}
      filterBar={filterBarOf(chips, () => setPage(0))}
      bulkActionBar={selectedIds.length && list.data?.can.bulk ? { selectedCount: selectedIds.length, onClearSelection: () => setSelection({}),
        actions: <Button size="compact" variant="primary" onPress={() => setDialog("bulk")}>Change selected…</Button> } : undefined}
    >
      {outcome && <Notice tone={outcome.failed ? "warning" : "success"}>
        <span className="flex flex-col gap-1"><span>{outcome.summary}</span>
          {outcome.results.filter((row) => !row.ok).map((row) => <span key={row.taskId} className="text-xs">{`${row.code ?? row.taskId}: ${row.error?.message ?? "not changed"}`}</span>)}</span>
      </Notice>}
      {board ? (list.isLoading ? <LoadingState label="Loading tasks" rows={6} /> : rows.length ? <TaskBoard rows={rows} onChanged={refresh} /> : <EmptyState title={EMPTY[baseView] ?? "No tasks."} description="Tasks are added on each project's Tasks tab." />)
        : groupBy !== "none" ? (list.isLoading ? <LoadingState label="Loading tasks" rows={6} /> : rows.length ? <TaskTable rows={rows} groupBy={groupBy} /> : <EmptyState title={EMPTY[baseView] ?? "No tasks."} description="Tasks are added on each project's Tasks tab." />)
        : (
          <EnterpriseDataGrid<TaskRow>
            aria-label="Tasks" columns={columns} data={rows} getRowId={(row) => row.id}
            state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading tasks" rows={8} />}
            errorContent={<ErrorState title="Could not load tasks" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
            emptyContent={<EmptyState title={EMPTY[baseView] ?? "No tasks."} description="Tasks are added on each project's Tasks tab." />}
            noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or filter." />}
            sorting={sorting} onSortingChange={(next) => { setSorting(next); setPage(0); }} manualSorting
            pageIndex={page} pageSize={25} pageCount={list.data?.pages ?? 1} totalRowCount={list.data?.total ?? 0} onPageChange={(next) => { setPage(next); setSelection({}); }}
            enableRowSelection={Boolean(list.data?.can.bulk)} rowSelection={selection} onRowSelectionChange={setSelection}
            onRowClick={(row) => router.push(`${TASKS_BASE}/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-1">
                <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium">{row.title}</span><StatusBadge tone={TASK_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
                <span className="text-xs text-text-muted">{[row.code, row.projectCode, row.assignee, dateLabel(row.dueDate), dueLabel(row)].filter(Boolean).join(" · ")}</span>
                <span className="flex flex-wrap items-center gap-2"><PriorityBadge priority={row.priority} />{row.attention?.length ? <span className="text-xs font-medium text-danger">{row.attention.filter((why) => why !== "Urgent" && why !== "High priority").join(" · ")}</span> : null}</span>
              </div>
            )}
          />
        )}
      {dialog === "save" && <SaveViewDialog filters={{ view: baseView, layout, groupBy, ...(term ? { search: term } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string> }}
        saved={saved} onClose={() => setDialog(null)} onSaved={async () => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "task-views") }); setDialog(null); }} />}
      {dialog === "bulk" && <BulkDialog taskIds={selectedIds} rows={rows} people={people} onClose={() => setDialog(null)}
        onDone={async (result) => { setOutcome(result); setSelection({}); setDialog(null); await refresh(); }} />}
    </EnterpriseListPage>
  );
}

function SaveViewDialog({ filters, saved, onClose, onSaved }: { filters: Record<string, string>; saved: { id: string; name: string; isDefault: boolean } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(saved?.name ?? "");
  const [isDefault, setDefault] = useState(saved?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Save this view">
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} isRequired maxLength={80} description="Only you see your views." />
        <Checkbox isSelected={isDefault} onChange={setDefault}>Open Tasks with this view</Checkbox>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          {saved && <Button variant="ghost" isDisabled={busy} onPress={async () => { setBusy(true); try { await deleteTaskView(saved.id); await onSaved(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } }}>Delete view</Button>}
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !name.trim()} onPress={async () => {
            setBusy(true); setError(null);
            try { await saveTaskView({ name, filters, isDefault }); await onSaved(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

const BULK_ACTIONS = [{ value: "assign", label: "Reassign" }, { value: "priority", label: "Change priority" }, { value: "due_date", label: "Set the due date" }, { value: "status", label: "Move to a status" },
  { value: "cancel", label: "Cancel" }];
function BulkDialog({ taskIds, rows, people, onClose, onDone }: { taskIds: string[]; rows: TaskRow[]; people: Array<{ value: string; label: string }>; onClose: () => void;
  onDone: (result: TaskBulkResult) => Promise<void> }) {
  const [action, setAction] = useState("assign");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versions = Object.fromEntries(rows.filter((row) => taskIds.includes(row.id)).map((row) => [row.id, row.version]));
  const urgentChange = action === "priority" && (value === "URGENT" || rows.some((row) => taskIds.includes(row.id) && row.priority === "URGENT"));
  const ready = action === "cancel" || urgentChange ? Boolean(action === "cancel" || value) && reason.trim().length >= 3 : Boolean(value);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Change ${taskIds.length} task(s)`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Each task is changed on its own and checked like a single change. Those that cannot change are listed afterwards with the reason.</p>
        <Select label="Change" selectedKey={action} onSelectionChange={(next) => { setAction(String(next)); setValue(""); }} options={BULK_ACTIONS} />
        {action === "assign" && <Select label="Assign to" selectedKey={value || null} onSelectionChange={(next) => setValue(String(next))} options={people}
          description="Each task's project must have this person on its team." />}
        {action === "priority" && <Select label="Priority" selectedKey={value || null} onSelectionChange={(next) => setValue(String(next))}
          options={PRIORITIES.map((level) => ({ value: level, label: `${PRIORITY_LABEL[level]} — ${PRIORITY_DESCRIPTION[level]}` }))}
          description="Only the priority changes: assignees, due dates, statuses and approvals stay as they are." />}
        {action === "priority" && (value === "URGENT" || rows.some((row) => taskIds.includes(row.id) && row.priority === "URGENT")) && (
          <TextArea label={value === "URGENT" ? "Why is this work Urgent?" : "Why is this work no longer Urgent?"} value={reason} onChange={setReason} maxLength={1000} isRequired
            description="Recorded on each task whose priority moves to or from Urgent." />
        )}
        {action === "due_date" && <TextField label="Due date" type="date" value={value} onChange={setValue} />}
        {action === "status" && <Select label="Move to" selectedKey={value || null} onSelectionChange={(next) => setValue(String(next))}
          options={["IN_PROGRESS", "IN_REVIEW", "DONE"].map((status) => ({ value: status, label: TASK_STATUS_TEXT[status as keyof typeof TASK_STATUS_TEXT] }))} />}
        {(action === "cancel" || action === "assign" || action === "due_date") && <TextArea label={action === "cancel" ? "Why they are cancelled" : "Note"} value={reason} onChange={setReason} maxLength={2000} isRequired={action === "cancel"} />}
        {action === "cancel" && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>I reviewed the tasks that wait for these</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Close</Button>
          <Button variant={action === "cancel" ? "danger" : "primary"} isLoading={busy} isDisabled={busy || !ready} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await bulkTasks({ taskIds, action, idempotencyKey: key, versions, reason: reason || undefined, acknowledgeDependents: acknowledge,
                ...(action === "assign" ? { assigneeUserId: value } : action === "priority" ? { priority: value } : action === "due_date" ? { dueDate: value } : action === "status" ? { to: value } : {}) });
              await onDone(result);
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}

const ORDER_OPTIONS = [
  { value: "attention", label: "Needs attention" }, { value: "priority", label: "Priority: highest first" }, { value: "due", label: "Due date: earliest first" },
  { value: "updated", label: "Recently updated" }, { value: "project", label: "Project" }, { value: "assignee", label: "Assignee" },
];
