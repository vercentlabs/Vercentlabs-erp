"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";
import { Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, IconButton, PermissionState } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  grantPosStoreAccess,
  listPosEligibleCashiers,
  listPosStores,
  PosApiError,
  revokePosStoreAccess,
  type PosEligibleCashier,
} from "@/features/pos/shared/pos-api";

// F270/F271 -- real cashier-eligibility administration. Only active
// organization members who already hold a real POS role (pos_cashier/
// pos_supervisor/pos_manager, or any custom role with a pos.* grant) show
// up here at all -- see listPosEligibleCashiers -- so this screen can only
// ever ASSIGN which store(s) a genuinely eligible person may operate,
// never invent a cashier identity or grant POS access itself (that stays
// governed entirely by the platform's own role-assignment screens).
export function PosCashiersSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.storeManage);

  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<PosEligibleCashier | null>(null);

  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers"), queryFn: listPosEligibleCashiers, enabled: canManage });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const rows = cashiersQuery.data?.rows ?? [];
  const storeById = useMemo(() => new Map((storesQuery.data?.rows ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const columns: ColumnDef<PosEligibleCashier, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "fullName", cell: ({ row }) => <span className="font-medium text-text">{row.original.fullName}</span> },
      { id: "email", header: "Email", accessorKey: "email" },
      { id: "roles", header: "POS roles", accessorFn: (row) => row.roleSlugs.join(", ") || "—" },
      {
        id: "stores",
        header: "Assigned stores",
        accessorFn: (row) => (row.assignedStoreIds.length ? row.assignedStoreIds.map((id) => storeById.get(id) ?? id).join(", ") : "All stores (unrestricted)"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()}>
            <IconButton aria-label={`Manage stores for ${row.original.fullName}`} size="compact" variant="ghost" onPress={() => setManaging(row.original)}>
              <Settings2 className="size-4" aria-hidden="true" />
            </IconButton>
          </span>
        ),
      },
    ],
    [storeById],
  );

  if (!canManage) return <PermissionState title="You don't have access to POS Cashiers" description="Ask an administrator to grant pos.store.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-text-secondary">
        Only active organization members already holding a POS role appear here. Assigning no stores leaves a cashier unrestricted (able to operate any
        store) until the first assignment is made for this company — the same &ldquo;unconfigured is permissive&rdquo; rule the checkout enforcement itself uses.
      </p>

      <EnterpriseListPage header={{ title: "Cashiers", description: "Which store(s) each eligible cashier or supervisor may operate." }}>
        <EnterpriseDataGrid<PosEligibleCashier>
          aria-label="Cashiers"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={cashiersQuery.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
        />
      </EnterpriseListPage>

      {managing && storesQuery.data && (
        <ManageStoreAccessDialog
          cashier={managing}
          stores={storesQuery.data.rows}
          onClose={() => setManaging(null)}
          onChanged={invalidate}
          onError={handleError}
        />
      )}
    </div>
  );
}

function ManageStoreAccessDialog({
  cashier,
  stores,
  onClose,
  onChanged,
  onError,
}: {
  cashier: PosEligibleCashier;
  stores: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const [assigned, setAssigned] = useState(new Set(cashier.assignedStoreIds));
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);

  const grantMutation = useMutation({
    mutationFn: (storeId: string) => grantPosStoreAccess(cashier.id, storeId),
    onMutate: (storeId) => setPendingStoreId(storeId),
    onSuccess: (_, storeId) => {
      setAssigned((prev) => new Set(prev).add(storeId));
      onChanged();
    },
    onError,
    onSettled: () => setPendingStoreId(null),
  });
  const revokeMutation = useMutation({
    mutationFn: (storeId: string) => revokePosStoreAccess(cashier.id, storeId),
    onMutate: (storeId) => setPendingStoreId(storeId),
    onSuccess: (_, storeId) => {
      setAssigned((prev) => {
        const next = new Set(prev);
        next.delete(storeId);
        return next;
      });
      onChanged();
    },
    onError,
    onSettled: () => setPendingStoreId(null),
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Store access — ${cashier.fullName}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Check the stores {cashier.fullName} may operate. Unchecking removes access immediately.</p>
        <ul className="flex flex-col gap-2">
          {stores.map((store) => (
            <li key={store.id} className="flex items-center justify-between gap-2">
              <Checkbox
                isSelected={assigned.has(store.id)}
                isDisabled={pendingStoreId === store.id}
                onChange={(checked) => (checked ? grantMutation.mutate(store.id) : revokeMutation.mutate(store.id))}
              >
                {store.name}
              </Checkbox>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
