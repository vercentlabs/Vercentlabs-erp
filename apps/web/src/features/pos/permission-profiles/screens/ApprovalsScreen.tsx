"use client";

// Supervisor Approvals: cashier exceptions waiting for a decision (a discount, price override, refund or cash movement above the cashier's
// limit). A supervisor approves only what their own profile allows, never their own request; an approval is used once, for exactly the
// action and amount asked for. "My requests" shows the caller's own.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, StatusBadge } from "@vercentlabs/design-system";

import { ErrorBanner } from "@/features/items/item-format";
import { formatDateTime } from "@/shared/format/human";
import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_TONE, approveApproval, errorMessage, listApprovals, rejectApproval, statusLabel, type Approval } from "../api/profiles-api";

const VIEWS = [
  { id: "pending", label: "Waiting" }, { id: "approved", label: "Approved" }, { id: "consumed", label: "Used" }, { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" }, { id: "mine", label: "My requests" },
];
const asked = (row: Approval) => [row.percentage !== null ? `${row.percentage}%` : null, row.amount !== null ? `${row.amount.toLocaleString("en-IN")} ${row.currency ?? ""}`.trim() : null].filter(Boolean).join(" · ");

export function ApprovalsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState("pending");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filters = view === "mine" ? { status: "all", mine: true } : { status: view };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos-approvals", filters), queryFn: () => listApprovals(filters), refetchInterval: 15_000 });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "requestedAt", desc: true }], sortValue: (row, id) => (row as Record<string, unknown>)[id] });
  const done = (message: string) => { setError(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-approvals") }); };
  const approve = useMutation({ mutationFn: (id: string) => approveApproval(id), onSuccess: () => done("Approved. The cashier can apply it now, once."), onError: (failure) => setError(errorMessage(failure)) });
  const reject = useMutation({ mutationFn: (id: string) => rejectApproval(id), onSuccess: () => done("Rejected."), onError: (failure) => setError(errorMessage(failure)) });

  const columns = useMemo(() => [
    { id: "permissionLabel", accessorKey: "permissionLabel", header: "Exception", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium">{row.original.permissionLabel}</span><span className="text-xs text-text-muted">{row.original.reason}</span></span>
    ) },
    { id: "asked", header: "Asked for", enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{asked(row.original)}</span> },
    { id: "requestedBy", accessorKey: "requestedBy", header: "Cashier", cell: ({ row }) => row.original.requestedBy ?? "" },
    { id: "where", header: "Where", enableSorting: false, cell: ({ row }) => [row.original.outlet, row.original.terminal, row.original.session].filter(Boolean).join(" · ") },
    { id: "requestedAt", accessorKey: "requestedAt", header: "Asked", cell: ({ row }) => formatDateTime(row.original.requestedAt) },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-col"><StatusBadge tone={STATUS_TONE[row.original.status]}>{statusLabel(row.original.status === "consumed" ? "used" : row.original.status)}</StatusBadge>
        {row.original.approver && <span className="text-xs text-text-muted">{row.original.approver}</span>}</span>
    ) },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => row.original.status === "pending" && row.original.requestedById !== workspace.userId ? (
      <span className="flex justify-end gap-2">
        <Button variant="secondary" size="compact" onPress={() => reject.mutate(row.original.id)}>Reject</Button>
        <Button variant="primary" size="compact" onPress={() => approve.mutate(row.original.id)}>Approve</Button>
      </span>
    ) : null },
  ] satisfies ColumnDef<Approval, unknown>[], [approve, reject, workspace.userId]);

  return (
    <EnterpriseListPage
      header={{ title: "Supervisor Approvals", description: "Cashier exceptions above their limits. You can approve only what your own permission profile allows, and never your own request." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
    >
      <ErrorBanner message={error} />
      {notice && <Notice tone="success">{notice}</Notice>}
      <EnterpriseDataGrid<Approval>
        aria-label="Supervisor approvals"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading approvals" rows={4} />}
        errorContent={<ErrorState title="Could not load approvals" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title={view === "pending" ? "Nothing is waiting for approval" : "Nothing here"} description="Requests appear here when a cashier goes above a limit." />}
        {...paged.grid}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.permissionLabel}</span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</StatusBadge></span>
            <span className="text-xs text-text-muted">{[asked(row), row.requestedBy].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
