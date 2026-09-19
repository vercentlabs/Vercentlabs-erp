"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";
import { Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, PermissionState } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals, type PosTerminal } from "@/features/pos/terminals/api/terminals-api";
import {
  grantPosStoreAccess,
  listPosEligibleCashiers,
  listPosStoreAccess,
  revokePosStoreAccess,
  type PosEligibleCashier,
  type PosStoreAccessGrant,
} from "@/features/pos/cashiers/api/cashiers-api";

// F270/F271 -- real cashier-eligibility administration. Only active
// organization members who already hold a real POS role (pos_cashier/
// pos_supervisor/pos_manager, or any custom role with a pos.* grant) show
// up here at all -- see listPosEligibleCashiers -- so this screen can only
// ever ASSIGN which store(s)/terminal(s) a genuinely eligible person may
// operate, never invent a cashier identity or grant POS access itself
// (that stays governed entirely by the platform's own role-assignment
// screens).
export function PosCashiersScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.storeManage);

  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<PosEligibleCashier | null>(null);

  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers"), queryFn: listPosEligibleCashiers, enabled: canManage });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals, enabled: canManage });
  // Every grant for the company, fetched once -- lets the dialog show
  // per-terminal grants (not just the flat "which stores" summary
  // listPosEligibleCashiers itself returns) without a separate request per
  // cashier.
  const grantsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "store-access", "all"), queryFn: () => listPosStoreAccess(), enabled: canManage });
  const rows = cashiersQuery.data?.rows ?? [];
  const storeById = useMemo(() => new Map((storesQuery.data?.rows ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);
  const grantsByCashier = useMemo(() => {
    const map = new Map<string, PosStoreAccessGrant[]>();
    for (const grant of grantsQuery.data?.rows ?? []) {
      const list = map.get(grant.userId) ?? [];
      list.push(grant);
      map.set(grant.userId, list);
    }
    return map;
  }, [grantsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "eligible-cashiers") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "store-access") });
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
        id: "terminals",
        header: "Terminal restriction",
        cell: ({ row }) => {
          const grants = grantsByCashier.get(row.original.id) ?? [];
          const terminalScoped = grants.filter((g) => g.terminalId);
          if (!terminalScoped.length) return <span className="text-text-muted">None (all terminals at assigned stores)</span>;
          return <span>{terminalScoped.map((g) => g.terminalName ?? g.terminalId).join(", ")}</span>;
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <span onClick={(event) => event.stopPropagation()}>
            <IconButton aria-label={`Manage store/terminal access for ${row.original.fullName}`} size="compact" variant="ghost" onPress={() => setManaging(row.original)}>
              <Settings2 className="size-4" aria-hidden="true" />
            </IconButton>
          </span>
        ),
      },
    ],
    [storeById, grantsByCashier],
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
        store) until the first assignment is made for this company — the same &ldquo;unconfigured is permissive&rdquo; rule the checkout enforcement itself
        uses. Within an assigned store, a cashier may further be restricted to specific terminals instead of all of them.
      </p>

      <EnterpriseListPage header={{ title: "Cashiers", description: "Which store(s) and terminal(s) each eligible cashier or supervisor may operate." }}>
        <EnterpriseDataGrid<PosEligibleCashier>
          aria-label="Cashiers"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={cashiersQuery.isError ? "error" : cashiersQuery.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          errorContent={<ErrorState title="Could not load cashiers" description="Something went wrong fetching eligible cashiers." action={{ label: "Retry", onPress: () => cashiersQuery.refetch() }} />}
        />
      </EnterpriseListPage>

      {managing && storesQuery.data && (
        <ManageStoreAccessDialog
          cashier={managing}
          stores={storesQuery.data.rows}
          terminals={terminalsQuery.data?.rows ?? []}
          grants={grantsByCashier.get(managing.id) ?? []}
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
  terminals,
  grants,
  onClose,
  onChanged,
  onError,
}: {
  cashier: PosEligibleCashier;
  stores: { id: string; name: string }[];
  terminals: PosTerminal[];
  grants: PosStoreAccessGrant[];
  onClose: () => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  // Local state mirrors the server, updated optimistically on each
  // grant/revoke so the dialog doesn't have to wait for a full requery
  // between clicks.
  const [current, setCurrent] = useState(grants);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const storeWideIds = new Set(current.filter((g) => !g.terminalId).map((g) => g.storeId));
  const terminalGrantIds = new Set(current.filter((g) => g.terminalId).map((g) => g.terminalId as string));

  const grantMutation = useMutation({
    mutationFn: ({ storeId, terminalId }: { storeId: string; terminalId?: string | null }) => grantPosStoreAccess(cashier.id, storeId, terminalId),
    onMutate: ({ storeId, terminalId }) => setPendingKey(`${storeId}:${terminalId ?? ""}`),
    onSuccess: (result, { storeId, terminalId }) => {
      setCurrent((prev) => [...prev, result.grant ?? { id: `${storeId}:${terminalId ?? ""}`, userId: cashier.id, storeId, terminalId: terminalId ?? null, terminalName: null, fullName: cashier.fullName, email: cashier.email, createdAt: new Date().toISOString() }]);
      onChanged();
    },
    onError,
    onSettled: () => setPendingKey(null),
  });
  const revokeMutation = useMutation({
    mutationFn: ({ storeId, terminalId }: { storeId: string; terminalId?: string | null }) => revokePosStoreAccess(cashier.id, storeId, terminalId),
    onMutate: ({ storeId, terminalId }) => setPendingKey(`${storeId}:${terminalId ?? ""}`),
    onSuccess: (_, { storeId, terminalId }) => {
      setCurrent((prev) => prev.filter((g) => !(g.storeId === storeId && (g.terminalId ?? null) === (terminalId ?? null))));
      onChanged();
    },
    onError,
    onSettled: () => setPendingKey(null),
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Store & terminal access — ${cashier.fullName}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">
          Check &ldquo;All terminals&rdquo; for unrestricted access to a store, or expand a store to restrict {cashier.fullName} to specific terminals
          instead.
        </p>
        <ul className="flex flex-col gap-2">
          {stores.map((store) => {
            const storeTerminals = terminals.filter((t) => (t.storeId ?? (t as unknown as { store_id?: string }).store_id) === store.id);
            const isStoreWide = storeWideIds.has(store.id);
            const storeKey = `${store.id}:`;
            return (
              <li key={store.id} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border p-2">
                <div className="flex items-center justify-between gap-2">
                  <Checkbox
                    isSelected={isStoreWide}
                    isDisabled={pendingKey === storeKey}
                    onChange={(checked) =>
                      checked ? grantMutation.mutate({ storeId: store.id }) : revokeMutation.mutate({ storeId: store.id })
                    }
                  >
                    {store.name} — All terminals
                  </Checkbox>
                  {storeTerminals.length > 0 && (
                    <Button variant="ghost" size="compact" onPress={() => setExpandedStoreId(expandedStoreId === store.id ? null : store.id)}>
                      {expandedStoreId === store.id ? "Hide terminals" : "Restrict to specific terminals"}
                    </Button>
                  )}
                </div>
                {expandedStoreId === store.id && (
                  <ul className="ml-6 flex flex-col gap-1 border-l border-border pl-3">
                    {storeTerminals.map((terminal) => {
                      const terminalKey = `${store.id}:${terminal.id}`;
                      return (
                        <li key={terminal.id}>
                          <Checkbox
                            isSelected={terminalGrantIds.has(terminal.id)}
                            isDisabled={isStoreWide || pendingKey === terminalKey}
                            onChange={(checked) =>
                              checked
                                ? grantMutation.mutate({ storeId: store.id, terminalId: terminal.id })
                                : revokeMutation.mutate({ storeId: store.id, terminalId: terminal.id })
                            }
                          >
                            {terminal.name}
                          </Checkbox>
                        </li>
                      );
                    })}
                    {isStoreWide && <p className="text-xs text-text-muted">Already granted all terminals at this store — uncheck that first to restrict.</p>}
                  </ul>
                )}
              </li>
            );
          })}
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
