"use client";

// F297/F298 — the conflict-resolution workspace for offline sync. A real,
// functional screen (not just an API): an authorized operator sees every
// queued conflict, inspects the frozen offline snapshot against the
// server-side context captured at the moment it conflicted, and resolves
// it (retry through the original completePointOfSale pipeline, or void
// with a mandatory reason) -- see resolvePosOfflineSyncConflict
// (services/api/src/modules/point-of-sale/index.js). Nothing here is ever
// auto-discarded or auto-overwritten; every row starts and stays
// `pending` until a human acts on it.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw, XCircle } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  listPosOfflineSyncConflicts,
  resolvePosOfflineSyncConflict,
  POS_CONFLICT_TYPE_LABEL as CONFLICT_TYPE_LABEL,
  type PosOfflineSyncConflict,
} from "@/features/pos/offline/api/offline-api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function PosOfflineSyncConflictsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canResolve = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.offlineResolve);

  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PosOfflineSyncConflict | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "offline-sync-conflicts", "pending"),
    queryFn: () => listPosOfflineSyncConflicts({ status: "pending" }),
    enabled: canResolve,
  });
  const rows = query.data?.conflicts ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "offline-sync-conflicts", "pending") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const columns: ColumnDef<PosOfflineSyncConflict, unknown>[] = useMemo(
    () => [
      { id: "localTransactionId", header: "Local transaction", accessorFn: (row) => row.local_transaction_id.slice(0, 8) },
      {
        id: "conflictType",
        header: "Conflict",
        cell: ({ row }) => <StatusBadge tone="warning">{CONFLICT_TYPE_LABEL[row.original.conflict_type] ?? row.original.conflict_type}</StatusBadge>,
      },
      { id: "detail", header: "Detail", accessorFn: (row) => row.detail ?? "—" },
      { id: "createdAt", header: "Captured", accessorFn: (row) => dateFormatter.format(new Date(row.created_at)) },
    ],
    [],
  );

  if (!canResolve) {
    return <PermissionState title="You don't have access to offline sync conflicts" description="Ask an administrator to grant pos.offline.resolve." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Offline sync conflicts",
          description: "Queued offline sales that could not be safely completed as-is. Nothing here is discarded automatically — resolve each one explicitly.",
        }}
      >
        <EnterpriseDataGrid<PosOfflineSyncConflict>
          aria-label="Offline sync conflicts"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isError ? "error" : query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          errorContent={<ErrorState title="Could not load offline sync conflicts" description="Something went wrong fetching the conflict queue." action={{ label: "Retry", onPress: () => query.refetch() }} />}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <Button variant="secondary" size="compact" onPress={() => setSelected(row)}>
                Review
              </Button>
            </span>
          )}
        />
      </EnterpriseListPage>

      {selected && (
        <ResolveConflictDialog
          conflict={selected}
          onClose={() => setSelected(null)}
          onResolved={() => {
            setSelected(null);
            setError(null);
            invalidate();
          }}
          onError={handleError}
        />
      )}
    </div>
  );
}

function ResolveConflictDialog({
  conflict,
  onClose,
  onResolved,
  onError,
}: {
  conflict: PosOfflineSyncConflict;
  onClose: () => void;
  onResolved: () => void;
  onError: (error: unknown) => void;
}) {
  const [reason, setReason] = useState("");

  const voidMutation = useMutation({
    mutationFn: () => resolvePosOfflineSyncConflict(conflict.id, { action: "void", reason }),
    onSuccess: onResolved,
    onError,
  });
  const retryMutation = useMutation({
    mutationFn: () => resolvePosOfflineSyncConflict(conflict.id, { action: "retry", reason: reason || undefined }),
    onSuccess: onResolved,
    onError,
  });

  const payload = conflict.captured_payload as { lines?: Array<{ itemId: string; quantity: number; capturedUnitPrice: number }> };
  const serverContext = conflict.server_context_snapshot as Record<string, unknown>;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Resolve conflict — ${CONFLICT_TYPE_LABEL[conflict.conflict_type] ?? conflict.conflict_type}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">{conflict.detail}</p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-[var(--radius-control)] border border-border-strong p-2">
            <p className="mb-1 font-medium text-text">Offline snapshot at capture</p>
            <ul className="flex flex-col gap-1">
              {(payload.lines ?? []).map((line, index) => (
                <li key={index} className="tabular-nums text-text-secondary">
                  {line.quantity} × item {line.itemId.slice(0, 8)} @ {line.capturedUnitPrice}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[var(--radius-control)] border border-border-strong p-2">
            <p className="mb-1 font-medium text-text">Server state at conflict time</p>
            <pre className="whitespace-pre-wrap break-all text-text-secondary">{JSON.stringify(serverContext, null, 2)}</pre>
          </div>
        </div>

        <TextField label="Resolution reason" value={reason} onChange={setReason} placeholder="Required to void; optional to retry" />

        <div className="flex justify-between gap-2">
          <Button variant="danger" onPress={() => voidMutation.mutate()} isLoading={voidMutation.isPending} isDisabled={!reason.trim()}>
            <XCircle className="size-4" aria-hidden="true" />
            Void offline attempt
          </Button>
          <Button variant="primary" onPress={() => retryMutation.mutate()} isLoading={retryMutation.isPending}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Retry at current price
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
