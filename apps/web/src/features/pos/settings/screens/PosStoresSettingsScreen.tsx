"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, IconButton, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createPosStore,
  getPosStoreSetupOptions,
  listPosStores,
  PosApiError,
  setPosStoreActiveRecord,
  updatePosStoreRecord,
  type PosStore,
} from "@/features/pos/shared/pos-api";

// F268 -- real store administration: list/create/edit/activate-deactivate,
// backed entirely by services/api/src/modules/point-of-sale/index.js's
// createStore/updatePosStore/setPosStoreActive. Deactivation and warehouse/
// currency changes are blocked server-side while a shift is open on the
// store (POS_STORE_HAS_OPEN_SHIFT/POS_STORE_HAS_ACTIVE_CART/
// POS_STORE_UNSAFE_TRANSITION) -- this screen surfaces those errors rather
// than re-deriving the safety check client-side.
export function PosStoresSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.storeManage);

  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosStore | null>(null);

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "store-setup-options"), queryFn: getPosStoreSetupOptions, enabled: canManage });
  const rows = storesQuery.data?.rows ?? [];
  const warehouseById = useMemo(() => new Map((optionsQuery.data?.warehouses ?? []).map((w) => [w.id, w.name])), [optionsQuery.data]);
  const branchById = useMemo(() => new Map((optionsQuery.data?.branches ?? []).map((b) => [b.id, b.name])), [optionsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "stores") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (store: PosStore) => setPosStoreActiveRecord(store.id, !store.active),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<PosStore, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "branch", header: "Branch", accessorFn: (row) => branchById.get(row.branch_id ?? "") ?? "—" },
      { id: "warehouse", header: "Warehouse", accessorFn: (row) => warehouseById.get(row.warehouse_id ?? row.warehouseId ?? "") ?? "—" },
      { id: "currency", header: "Currency", accessorFn: (row) => row.currency_code ?? row.currencyCode ?? "—" },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.active ? "success" : "neutral"}>{row.original.active ? "active" : "inactive"}</StatusBadge> },
    ],
    [branchById, warehouseById],
  );

  if (!canManage) return <PermissionState title="You don't have access to POS Stores" description="Ask an administrator to grant pos.store.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Stores",
          description: "Physical or virtual retail locations selling through POS.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)} isDisabled={!optionsQuery.data}>
              <Plus className="size-4" aria-hidden="true" />
              New store
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<PosStore>
          aria-label="Stores"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={storesQuery.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          onRowClick={(row) => setEditing(row)}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <IconButton
                aria-label={row.active ? `Deactivate ${row.name}` : `Activate ${row.name}`}
                size="compact"
                variant={row.active ? "danger" : "ghost"}
                onPress={() => toggleActiveMutation.mutate(row)}
                isDisabled={toggleActiveMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          )}
        />
      </EnterpriseListPage>

      {optionsQuery.data && (
        <CreateStoreDialog
          isOpen={createOpen}
          onOpenChange={setCreateOpen}
          options={optionsQuery.data}
          onCreated={invalidate}
          onError={handleError}
        />
      )}
      {editing && optionsQuery.data && (
        <EditStoreDialog
          store={editing}
          options={optionsQuery.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
          onError={handleError}
        />
      )}
    </div>
  );
}

type SetupOptions = { branches: { id: string; name: string }[]; warehouses: { id: string; name: string }[]; priceLists: { id: string; name: string; currency_code: string }[] };

function CreateStoreDialog({
  isOpen,
  onOpenChange,
  options,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  options: SetupOptions;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");

  const mutation = useMutation({
    mutationFn: () => createPosStore({ name, code, branchId, warehouseId, priceListId: priceListId || undefined, currencyCode }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setCode("");
      setBranchId("");
      setWarehouseId("");
      setPriceListId("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New store">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <Select label="Branch" isRequired options={options.branches.map((b) => ({ value: b.id, label: b.name }))} selectedKey={branchId} onSelectionChange={(key) => setBranchId(String(key ?? ""))} />
        <Select label="Warehouse" isRequired options={options.warehouses.map((w) => ({ value: w.id, label: w.name }))} selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key ?? ""))} />
        <Select label="Price list (optional)" options={options.priceLists.map((p) => ({ value: p.id, label: p.name }))} selectedKey={priceListId} onSelectionChange={(key) => setPriceListId(String(key ?? ""))} />
        <TextField label="Currency code" value={currencyCode} onChange={(v) => setCurrencyCode(v.toUpperCase())} maxLength={3} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !code.trim() || !branchId || !warehouseId}>
            Create store
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EditStoreDialog({
  store,
  options,
  onClose,
  onSaved,
  onError,
}: {
  store: PosStore;
  options: SetupOptions;
  onClose: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(store.name);
  const [branchId, setBranchId] = useState(store.branch_id ?? "");
  const [warehouseId, setWarehouseId] = useState(store.warehouse_id ?? store.warehouseId ?? "");
  const [priceListId, setPriceListId] = useState(store.price_list_id ?? store.priceListId ?? "");
  const [timezone, setTimezone] = useState(store.timezone ?? "Asia/Kolkata");

  const mutation = useMutation({
    mutationFn: () => updatePosStoreRecord(store.id, { name, branchId, warehouseId, priceListId: priceListId || null, timezone }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Edit ${store.name}`}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Branch" options={options.branches.map((b) => ({ value: b.id, label: b.name }))} selectedKey={branchId} onSelectionChange={(key) => setBranchId(String(key ?? ""))} />
        <Select label="Warehouse" options={options.warehouses.map((w) => ({ value: w.id, label: w.name }))} selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key ?? ""))} />
        <Select label="Price list" options={options.priceLists.map((p) => ({ value: p.id, label: p.name }))} selectedKey={priceListId} onSelectionChange={(key) => setPriceListId(String(key ?? ""))} />
        <TextField label="Timezone" value={timezone} onChange={setTimezone} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
