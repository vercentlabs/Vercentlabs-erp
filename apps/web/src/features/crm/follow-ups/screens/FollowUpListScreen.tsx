"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Clock, Plus, X } from "lucide-react";
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
import { cancelFollowUp, completeFollowUp, FollowUpApiError, listFollowUps, snoozeFollowUp } from "../api/follow-ups-api";
import type { FollowUp, FollowUpListFilters } from "../types";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  in_progress: "info",
  overdue: "danger",
  completed: "success",
  cancelled: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function FollowUpListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);

  const [filters, setFilters] = useState<FollowUpListFilters>({ limit: PAGE_SIZE, offset: 0, due: "overdue" });
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "follow-ups", filters),
    queryFn: () => listFollowUps(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof FollowUpListFilters>(key: K, value: FollowUpListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
  }

  function handleError(error: unknown) {
    setActionError(error instanceof FollowUpApiError ? error.message : "This action could not be completed.");
    // A stale-write conflict means this row's local updatedAt is already
    // wrong — refetch so the next attempt uses current data instead of
    // failing the same way again.
    if (error instanceof FollowUpApiError && error.code === "CRM_STALE_WRITE") invalidate();
  }

  const snoozeMutation = useMutation({
    mutationFn: (followUp: FollowUp) => snoozeFollowUp(followUp.id, new Date(Date.now() + 24 * 60 * 60_000).toISOString(), followUp.updatedAt),
    onSuccess: invalidate,
    onError: handleError,
  });
  const completeMutation = useMutation({ mutationFn: (followUp: FollowUp) => completeFollowUp(followUp.id, followUp.updatedAt), onSuccess: invalidate, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: (followUp: FollowUp) => cancelFollowUp(followUp.id, followUp.updatedAt), onSuccess: invalidate, onError: handleError });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (filters.due && filters.due !== "all") active.push({ id: "due", label: `Due: ${filters.due}` });
    return active;
  }, [filters]);

  const columns: ColumnDef<FollowUp, unknown>[] = useMemo(
    () => [
      { id: "subject", header: "Follow-up", accessorKey: "subject", cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span> },
      { id: "followUpReason", header: "Reason", accessorFn: (row) => row.followUpReason || "—" },
      { id: "followUpChannel", header: "Channel", accessorFn: (row) => row.followUpChannel || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "assignedName", header: "Assignee", accessorFn: (row) => row.assignedName || "Unassigned" },
      { id: "dueAt", header: "Due", accessorFn: (row) => (row.dueAt ? dateTimeFormatter.format(new Date(row.dueAt)) : "—") },
      { id: "followUpSnoozeCount", header: "Snoozed", accessorFn: (row) => row.followUpSnoozeCount ?? 0 },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof FollowUpApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Follow-ups",
        description: "Reminders that need action, with multi-stage delivery and escalation.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/follow-ups/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New follow-up
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <Select
              aria-label="Due"
              size="compact"
              options={[
                { value: "all", label: "Any date" },
                { value: "overdue", label: "Overdue" },
                { value: "today", label: "Due today" },
                { value: "upcoming", label: "Upcoming" },
              ]}
              selectedKey={filters.due ?? "overdue"}
              onSelectionChange={(key) => updateFilter("due", key === "all" ? undefined : (String(key) as FollowUpListFilters["due"]))}
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
        onClearAll: activeFilters.length > 0 ? () => setFilters({ limit: PAGE_SIZE, offset: 0, due: "overdue" }) : undefined,
      }}
    >
      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      <EnterpriseDataGrid<FollowUp>
        aria-label="Follow-ups"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/crm/follow-ups/${row.id}`)}
        state={gridState}
        loadingContent={<LoadingState label="Loading follow-ups" rows={3} />}
        emptyContent={<NoResultsState title="No follow-ups here" description="Nothing matches this scope right now." />}
        errorContent={<ErrorState title="Could not load follow-ups" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Follow-ups" />}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        rowActions={(row) => {
          if (["completed", "cancelled"].includes(row.status)) return null;
          return (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Snooze ${row.subject} one day`} size="compact" variant="ghost" onPress={() => snoozeMutation.mutate(row)}>
                <Clock className="size-4" aria-hidden="true" />
              </IconButton>
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
