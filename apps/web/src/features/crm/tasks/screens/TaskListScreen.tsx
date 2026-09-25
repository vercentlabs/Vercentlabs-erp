"use client";

import { humanize } from "@/features/crm/shared/human";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  SearchField,
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
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { DueCell } from "@/features/crm/shared/ui/DueCell";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  in_progress: "info",
  overdue: "danger",
  completed: "success",
  cancelled: "neutral",
};


export function TaskListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);

  // F024 — the dashboard drills in with ?due=overdue and a scope (mine=true,
  // myTeam=true, or mine=false for everything visible); honour them so the
  // list's count reconciles with the dashboard figure.
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<TaskListFilters>(() => {
    const initial: TaskListFilters = { limit: PAGE_SIZE, offset: 0, mine: true };
    const due = searchParams.get("due");
    if (due === "overdue" || due === "today" || due === "upcoming") initial.due = due;
    if (searchParams.get("myTeam") === "true") { initial.mine = undefined; initial.myTeam = true; }
    else if (searchParams.get("mine") === "false") initial.mine = undefined;
    return initial;
  });
  const [searchInput, setSearchInput] = useState("");
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

  function submitSearch() {
    updateFilter("search", searchInput || undefined);
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
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.due && filters.due !== "all") active.push({ id: "due", label: `Due: ${filters.due}` });
    if (filters.teamId) active.push({ id: "teamId", label: "Team filter" });
    if (filters.queueOnly) active.push({ id: "queueOnly", label: "Unclaimed only" });
    return active;
  }, [filters]);

  const columns: ColumnDef<Task, unknown>[] = useMemo(
    () => [
      { id: "subject", header: "Task", accessorKey: "subject", cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span> },
      { id: "priority", header: "Priority", accessorKey: "priority", cell: ({ getValue }) => humanize(String(getValue() ?? "")) },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "assignedName", header: "Assignee", accessorFn: (row) => row.assignedName || (row.teamId ? "Unclaimed (queue)" : "Unassigned") },
      { id: "teamName", header: "Team", accessorFn: (row) => row.teamName || "—" },
      { id: "dueAt", header: "Due", accessorFn: (row) => row.dueAt ?? "", cell: ({ row }) => <DueCell value={row.original.dueAt} done={["completed", "cancelled"].includes(row.original.status)} /> },
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
            <SearchField
              aria-label="Search tasks"
              placeholder="Search by subject or description…"
              value={searchInput}
              onChange={setSearchInput}
              onKeyDown={(event) => event.key === "Enter" && submitSearch()}
              className="min-w-[240px]"
            />
            <Select
              aria-label="Scope"
              size="compact"
              options={[
                { value: "mine", label: "My tasks" },
                { value: "team", label: "Team queue" },
                { value: "my_team", label: "My team's tasks" },
                { value: "all", label: "All (managers)" },
              ]}
              selectedKey={filters.queueOnly ? "team" : filters.myTeam ? "my_team" : filters.mine ? "mine" : "all"}
              onSelectionChange={(key) => {
                if (key === "mine") setFilters((current) => ({ ...current, mine: true, myTeam: undefined, queueOnly: undefined, offset: 0 }));
                else if (key === "team") setFilters((current) => ({ ...current, mine: undefined, myTeam: undefined, queueOnly: true, offset: 0 }));
                else if (key === "my_team") setFilters((current) => ({ ...current, mine: undefined, myTeam: true, queueOnly: undefined, offset: 0 }));
                else setFilters((current) => ({ ...current, mine: undefined, myTeam: undefined, queueOnly: undefined, offset: 0 }));
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
        end: <Button variant="secondary" onPress={submitSearch}>Search</Button>,
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => {
          if (id === "search") setSearchInput("");
          setFilters((current) => ({ ...current, [id]: undefined, offset: 0 }));
        },
        onClearAll:
          activeFilters.length > 0
            ? () => {
                setSearchInput("");
                setFilters({ limit: PAGE_SIZE, offset: 0, mine: true });
              }
            : undefined,
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
        loadingContent={<LoadingState label="Loading tasks" rows={3} />}
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
