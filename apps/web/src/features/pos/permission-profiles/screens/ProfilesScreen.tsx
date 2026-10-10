"use client";

// Cashier Permissions: the permission profiles that decide what cashiers may do at a POS and within which limits. Views: All, Active, Draft,
// Inactive. Every cashier holds one active profile; administering profiles is a separate, role-based permission.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PROFILES_BASE, STATUS_TONE, errorCode, errorMessage, listProfiles, statusLabel, type ProfileSummary } from "../api/profiles-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "draft", label: "Draft" }, { id: "inactive", label: "Inactive" }];
const sortValue = (row: ProfileSummary, id: string) => (row as Record<string, unknown>)[id];

export function ProfilesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos-profiles", "list", filters), queryFn: () => listProfiles(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.profiles ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "name", desc: false }], sortValue });
  const can = list.data?.capabilities;

  const columns = useMemo(() => [
    { id: "name", accessorKey: "name", header: "Profile", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span><span className="text-xs text-text-muted tabular-nums">{row.original.code}</span></span>
    ) },
    { id: "activeCashiers", accessorKey: "assignedCashiers", header: "Assigned cashiers", cell: ({ row }) => <span className="tabular-nums">{row.original.assignedCashiers}</span> },
    { id: "summary", header: "Permissions", enableSorting: false, cell: ({ row }) => (
      <span className="text-xs text-text-secondary">{row.original.summary?.join(" · ") || "Nothing granted"}</span>
    ) },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "updatedAt", accessorKey: "updatedAt", header: "Updated", cell: ({ row }) => (
      <span className="flex flex-col"><span>{formatDateTime(row.original.updatedAt)}</span>{row.original.updatedBy && <span className="text-xs text-text-muted">{row.original.updatedBy}</span>}</span>
    ) },
  ] satisfies ColumnDef<ProfileSummary, unknown>[], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to cashier permissions" description="Ask an administrator for access." />;
  const create = () => router.push(`${PROFILES_BASE}/new`);
  return (
    <EnterpriseListPage
      header={{
        title: "Cashier Permissions",
        description: "Permission profiles decide what cashiers may do at a POS, within which limits, and when a supervisor must approve. Each cashier holds one active profile.",
        primaryAction: can?.manage ? <Button variant="primary" onPress={create}><Plus className="size-4" aria-hidden="true" />New profile</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search profiles" placeholder="Search name or code" className="w-full sm:w-72" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<ProfileSummary>
        aria-label="Permission profiles"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading profiles" rows={5} />}
        errorContent={<ErrorState title="Could not load profiles" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No permission profiles yet" description="Create a profile such as Standard Cashier and set its limits." action={can?.manage ? { label: "New profile", onPress: create } : undefined} />}
        noResultsContent={<NoResultsState title="No profiles match" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${PROFILES_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.code} · {row.assignedCashiers} cashier{row.assignedCashiers === 1 ? "" : "s"}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
