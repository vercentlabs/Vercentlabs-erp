"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Play, Plus, Users, X } from "lucide-react";
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
import { cancelMeeting, completeMeeting, listMeetings, MeetingApiError, startMeeting } from "../api/meetings-api";
import type { Meeting, MeetingListFilters } from "../types";

const PAGE_SIZE = 25;

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned: "neutral",
  overdue: "danger",
  in_progress: "info",
  completed: "success",
  cancelled: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function MeetingListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);

  const [filters, setFilters] = useState<MeetingListFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "meetings", filters),
    queryFn: () => listMeetings(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof MeetingListFilters>(key: K, value: MeetingListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings") });
  }

  function handleError(error: unknown) {
    setActionError(error instanceof MeetingApiError ? error.message : "This action could not be completed.");
    // A stale-write conflict means this row's local updatedAt is already
    // wrong — refetch so the next attempt uses current data instead of
    // failing the same way again.
    if (error instanceof MeetingApiError && error.code === "CRM_STALE_WRITE") invalidate();
  }

  const startMutation = useMutation({ mutationFn: (meeting: Meeting) => startMeeting(meeting.id, meeting.updatedAt), onSuccess: invalidate, onError: handleError });
  const completeMutation = useMutation({ mutationFn: (meeting: Meeting) => completeMeeting(meeting.id, "held", undefined, meeting.updatedAt), onSuccess: invalidate, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: (meeting: Meeting) => cancelMeeting(meeting.id, meeting.updatedAt), onSuccess: invalidate, onError: handleError });

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

  const columns: ColumnDef<Meeting, unknown>[] = useMemo(
    () => [
      { id: "subject", header: "Meeting", accessorKey: "subject", cell: ({ row }) => <span className="font-medium text-text">{row.original.subject}</span> },
      { id: "locationType", header: "Location", accessorFn: (row) => row.locationType || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "assignedName", header: "Organizer", accessorFn: (row) => row.assignedName || "Unassigned" },
      {
        id: "attendeeCount",
        header: "Attendees",
        accessorFn: (row) => row.attendeeCount ?? 0,
        cell: ({ getValue }) => (
          <span className="flex items-center gap-1 tabular-nums">
            <Users className="size-3.5 text-text-muted" aria-hidden="true" />
            {String(getValue())}
          </span>
        ),
      },
      { id: "startAt", header: "Starts", accessorFn: (row) => (row.startAt ? dateTimeFormatter.format(new Date(row.startAt)) : "—") },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof MeetingApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Meetings",
        description: "Scheduled and logged meetings across your Leads, Accounts and Opportunities.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/meetings/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New meeting
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
              aria-label="Due"
              size="compact"
              options={[
                { value: "all", label: "Any date" },
                { value: "overdue", label: "Overdue" },
                { value: "today", label: "Today" },
                { value: "upcoming", label: "Upcoming" },
              ]}
              selectedKey={filters.due ?? "all"}
              onSelectionChange={(key) => updateFilter("due", key === "all" ? undefined : (String(key) as MeetingListFilters["due"]))}
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
      <EnterpriseDataGrid<Meeting>
        aria-label="Meetings"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/crm/meetings/${row.id}`)}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading meetings…</p>}
        emptyContent={<NoResultsState title="No meetings yet" action={canManage ? { label: "New meeting", onPress: () => router.push("/crm/meetings/new") } : undefined} />}
        errorContent={<ErrorState title="Could not load meetings" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Meetings" />}
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
