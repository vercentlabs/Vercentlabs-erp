"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Phone, PhoneCall, Plus, X } from "lucide-react";
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
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { CallApiError, cancelCall, completeCall, listCalls, startCall } from "../api/calls-api";
import type { Call, CallListFilters } from "../types";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  overdue: "danger",
  in_progress: "info",
  completed: "success",
  cancelled: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function CallListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);

  const [filters, setFilters] = useState<CallListFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "calls", filters),
    queryFn: () => listCalls(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof CallListFilters>(key: K, value: CallListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "calls") });
  }

  function handleError(error: unknown) {
    setActionError(error instanceof CallApiError ? error.message : "This action could not be completed.");
  }

  const startMutation = useMutation({ mutationFn: (call: Call) => startCall(call.id, call.updatedAt), onSuccess: invalidate, onError: handleError });
  const completeMutation = useMutation({ mutationFn: (call: Call) => completeCall(call.id, "connected", undefined, call.updatedAt), onSuccess: invalidate, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: (call: Call) => cancelCall(call.id, call.updatedAt), onSuccess: invalidate, onError: handleError });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.direction) active.push({ id: "direction", label: `Direction: ${filters.direction}` });
    if (filters.due && filters.due !== "all") active.push({ id: "due", label: `Due: ${filters.due}` });
    return active;
  }, [filters]);

  const columns: ColumnDef<Call, unknown>[] = useMemo(
    () => [
      { id: "subject", header: "Call", accessorKey: "subject", cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span> },
      {
        id: "direction",
        header: "Direction",
        accessorFn: (row) => row.direction || "—",
        cell: ({ getValue }) => (
          <span className="flex items-center gap-1.5">
            {getValue() === "outbound" ? <PhoneCall className="size-3.5 text-text-muted" aria-hidden="true" /> : <Phone className="size-3.5 text-text-muted" aria-hidden="true" />}
            {String(getValue())}
          </span>
        ),
      },
      { id: "phoneNumber", header: "Number", accessorFn: (row) => row.phoneNumber || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "assignedName", header: "Assignee", accessorFn: (row) => row.assignedName || "Unassigned" },
      { id: "dueAt", header: "Due", accessorFn: (row) => (row.dueAt ? dateTimeFormatter.format(new Date(row.dueAt)) : "—") },
      { id: "outcome", header: "Outcome", accessorFn: (row) => row.outcomeCode || "—" },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof CallApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Calls",
        description: "Scheduled and logged calls across your Leads, Accounts and Opportunities.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/calls/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New call
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
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
            <Select
              aria-label="Direction"
              size="compact"
              options={[
                { value: "all", label: "Any direction" },
                { value: "inbound", label: "Inbound" },
                { value: "outbound", label: "Outbound" },
              ]}
              selectedKey={filters.direction ?? "all"}
              onSelectionChange={(key) => updateFilter("direction", key === "all" ? undefined : (String(key) as CallListFilters["direction"]))}
            />
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
              onSelectionChange={(key) => updateFilter("due", key === "all" ? undefined : (String(key) as CallListFilters["due"]))}
            />
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => ({ ...current, [id]: undefined, offset: 0 })),
        onClearAll: activeFilters.length > 0 ? () => setFilters({ limit: PAGE_SIZE, offset: 0 }) : undefined,
      }}
    >
      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      <EnterpriseDataGrid<Call>
        aria-label="Calls"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading calls…</p>}
        emptyContent={<NoResultsState title="No calls yet" action={canManage ? { label: "New call", onPress: () => router.push("/crm/calls/new") } : undefined} />}
        errorContent={<ErrorState title="Could not load calls" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Calls" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        rowActions={(row) => {
          if (["completed", "cancelled"].includes(row.status)) return null;
          return (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              {row.status !== "in_progress" && (
                <IconButton aria-label={`Start ${row.subject}`} size="compact" variant="ghost" onPress={() => startMutation.mutate(row)}>
                  <PhoneCall className="size-4" aria-hidden="true" />
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
