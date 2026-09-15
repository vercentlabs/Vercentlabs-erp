"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Plus, Play, UserMinus, UserPlus, X } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  IconButton,
  NoResultsState,
  PermissionState,
  Select,
  StatusBadge,
  type ActiveFilter,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { cancelTask, claimTask, completeTask, listMyTaskTeams, listTasks, releaseTask, startTask, TaskApiError } from "../api/tasks-api";
import type { Task, TaskListFilters } from "../types";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  in_progress: "info",
  overdue: "danger",
  completed: "success",
  cancelled: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function TaskListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);

  const [filters, setFilters] = useState<TaskListFilters>({ limit: PAGE_SIZE, offset: 0, mine: true });
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", filters),
    queryFn: () => listTasks(filters),
    placeholderData: (previous) => previous,
  });

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "teams"), queryFn: listMyTaskTeams });
  const teamOptions: SelectOption[] = useMemo(
    () => [{ value: "", label: "No team filter" }, ...(teamsQuery.data?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))],
    [teamsQuery.data],
  );

  function updateFilter<K extends keyof TaskListFilters>(key: K, value: TaskListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
  }

  function handleError(error: unknown) {
    setActionError(error instanceof TaskApiError ? error.message : "This action could not be completed.");
    // A stale-write conflict means this row's local updatedAt is already
    // wrong — refetch so the next attempt uses current data instead of
    // failing the same way again.
    if (error instanceof TaskApiError && error.code === "CRM_STALE_WRITE") invalidate();
  }

  const startMutation = useMutation({ mutationFn: (task: Task) => startTask(task.id, task.updatedAt), onSuccess: invalidate, onError: handleError });
  const completeMutation = useMutation({ mutationFn: (task: Task) => completeTask(task.id, undefined, task.updatedAt), onSuccess: invalidate, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: (task: Task) => cancelTask(task.id, task.updatedAt), onSuccess: invalidate, onError: handleError });
  const claimMutation = useMutation({ mutationFn: (task: Task) => claimTask(task.id, task.updatedAt), onSuccess: invalidate, onError: handleError });
  const releaseMutation = useMutation({ mutationFn: (task: Task) => releaseTask(task.id, task.updatedAt), onSuccess: invalidate, onError: handleError });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.due && filters.due !== "all") active.push({ id: "due", label: `Due: ${filters.due}` });
    if (filters.teamId) active.push({ id: "teamId", label: "Team filter" });
    if (filters.queueOnly) active.push({ id: "queueOnly", label: "Unclaimed only" });
    return active;
  }, [filters]);

  const columns: ColumnDef<Task, unknown>[] = useMemo(
    () => [
      { id: "subject", header: "Task", accessorKey: "subject", cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span> },
      { id: "priority", header: "Priority", accessorKey: "priority" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "assignedName", header: "Assignee", accessorFn: (row) => row.assignedName || (row.teamId ? "Unclaimed (queue)" : "Unassigned") },
      { id: "teamName", header: "Team", accessorFn: (row) => row.teamName || "—" },
      { id: "dueAt", header: "Due", accessorFn: (row) => (row.dueAt ? dateTimeFormatter.format(new Date(row.dueAt)) : "—") },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof TaskApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Tasks",
        description: "Your work queue — mine, team queues, and everything due.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/tasks/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New task
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <Select
              aria-label="Scope"
              size="compact"
              options={[
                { value: "mine", label: "My tasks" },
                { value: "team", label: "Team queue" },
                { value: "all", label: "All (managers)" },
              ]}
              selectedKey={filters.queueOnly ? "team" : filters.mine ? "mine" : "all"}
              onSelectionChange={(key) => {
                if (key === "mine") setFilters((current) => ({ ...current, mine: true, queueOnly: undefined, offset: 0 }));
                else if (key === "team") setFilters((current) => ({ ...current, mine: undefined, queueOnly: true, offset: 0 }));
                else setFilters((current) => ({ ...current, mine: undefined, queueOnly: undefined, offset: 0 }));
              }}
            />
            <Select aria-label="Team" size="compact" options={teamOptions} selectedKey={filters.teamId ?? ""} onSelectionChange={(key) => updateFilter("teamId", key ? String(key) : undefined)} />
            <Select
              aria-label="Due"
              size="compact"
              options={[
                { value: "all", label: "Any due date" },
                { value: "overdue", label: "Overdue" },
                { value: "today", label: "Due today" },
                { value: "upcoming", label: "Upcoming" },
              ]}
              selectedKey={filters.due ?? "all"}
              onSelectionChange={(key) => updateFilter("due", key === "all" ? undefined : (String(key) as TaskListFilters["due"]))}
            />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "all", label: "Any status" },
                { value: "planned", label: "Planned" },
                { value: "in_progress", label: "In progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
              ]}
              selectedKey={filters.status ?? "all"}
              onSelectionChange={(key) => updateFilter("status", key === "all" ? undefined : String(key))}
            />
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => ({ ...current, [id]: undefined, offset: 0 })),
        onClearAll: activeFilters.length > 0 ? () => setFilters({ limit: PAGE_SIZE, offset: 0, mine: true }) : undefined,
      }}
    >
      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      <EnterpriseDataGrid<Task>
        aria-label="Tasks"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/crm/tasks/${row.id}`)}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading tasks…</p>}
        emptyContent={<NoResultsState title="No tasks here" description="Nothing matches this scope right now." />}
        errorContent={<ErrorState title="Could not load tasks" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Tasks" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        rowActions={(row) => {
          if (["completed", "cancelled"].includes(row.status)) return null;
          return (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              {row.teamId && !row.assignedTo && (
                <IconButton aria-label={`Claim ${row.subject}`} size="compact" variant="ghost" onPress={() => claimMutation.mutate(row)}>
                  <UserPlus className="size-4" aria-hidden="true" />
                </IconButton>
              )}
              {row.teamId && row.assignedTo && (
                <IconButton aria-label={`Release ${row.subject}`} size="compact" variant="ghost" onPress={() => releaseMutation.mutate(row)}>
                  <UserMinus className="size-4" aria-hidden="true" />
                </IconButton>
              )}
              {row.status !== "in_progress" && (
                <IconButton aria-label={`Start ${row.subject}`} size="compact" variant="ghost" onPress={() => startMutation.mutate(row)}>
                  <Play className="size-4" aria-hidden="true" />
                </IconButton>
              )}
              <IconButton aria-label={`Complete ${row.subject}`} size="compact" variant="ghost" onPress={() => completeMutation.mutate(row)}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton aria-label={`Cancel ${row.subject}`} size="compact" variant="danger" onPress={() => cancelMutation.mutate(row)}>
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          );
        }}
      />
    </EnterpriseListPage>
  );
}
