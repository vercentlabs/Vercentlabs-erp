"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CreditCard, Plus, Power } from "lucide-react";
import { AlertDialog, Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField, type ActiveFilter } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert } from "@/features/pos/shared/PosUi";
import { StorePaymentDialog } from "@/features/pos/stores/components/StorePaymentDialog";
import {
  POS_ADMIN_LIST_LIMIT,
  createPosStore,
  getPosStoreSetupOptions,
  listPosStores,
  setPosStoreActiveRecord,
  updatePosStoreRecord,
  type PosStore,
} from "@/features/pos/stores/api/stores-api";

// F268 -- real store administration: list/create/edit/activate-deactivate,
// backed entirely by services/api/src/modules/point-of-sale/
// store-terminal-and-cashier-control/store-operations.js's createStore/
// updatePosStore/setPosStoreActive. Deactivation and warehouse/currency
// changes are blocked server-side while a shift is open on the store
// (POS_STORE_HAS_OPEN_SHIFT/POS_STORE_HAS_ACTIVE_CART/
// POS_STORE_UNSAFE_TRANSITION) -- this screen surfaces those errors rather
// than re-deriving the safety check client-side.
export function PosStoresScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.storeManage);

  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosStore | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PosStore | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<PosStore | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "store-setup-options"), queryFn: getPosStoreSetupOptions, enabled: canManage });
  const allRows = storesQuery.data?.rows;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (allRows ?? []).filter((store) => {
      if (statusFilter === "active" && !store.active) return false;
      if (statusFilter === "inactive" && store.active) return false;
      if (!needle) return true;
      return [store.name, store.code].some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [allRows, search, statusFilter]);
  const hitPageCeiling = (allRows?.length ?? 0) >= POS_ADMIN_LIST_LIMIT;
  const hasFilters = Boolean(search.trim() || statusFilter);
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter) activeFilters.push({ id: "status", label: `Status: ${statusLabel(statusFilter)}` });
  if (search.trim()) activeFilters.push({ id: "search", label: `Search: ${search.trim()}` });
  function removeFilter(id: string) {
    if (id === "status") setStatusFilter("");
    if (id === "search") setSearch("");
  }
  function clearFilters() {
    setSearch("");
    setStatusFilter("");
  }
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
      setDeactivateTarget(null);
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
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.active ? "active" : "inactive")}>{statusLabel(row.original.active ? "active" : "inactive")}</StatusBadge> },
    ],
    [branchById, warehouseById],
  );

  if (!canManage) return <PermissionState title="You don't have access to POS Stores" description="Ask an administrator to grant pos.store.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && <PosAlert>{error}</PosAlert>}

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
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search stores" placeholder="Search name or code…" value={search} onChange={setSearch} className="min-w-[240px]" />
              <Select
                aria-label="Status"
                size="compact"
                options={[
                  { value: "", label: "Any status" },
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
                selectedKey={statusFilter}
                onSelectionChange={(key) => setStatusFilter(String(key ?? ""))}
              />
            </>
          ),
        }}
        filterBar={{ filters: activeFilters, onRemove: removeFilter, onClearAll: hasFilters ? clearFilters : undefined }}
      >
        {hitPageCeiling && <PosAlert tone="warning">Showing the first {POS_ADMIN_LIST_LIMIT} stores — narrow the list with the filters above.</PosAlert>}
        <EnterpriseDataGrid<PosStore>
          aria-label="Stores"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={storesQuery.isError ? "error" : storesQuery.isLoading ? "loading" : rows.length === 0 && hasFilters ? "no-results" : rows.length === 0 ? "empty" : "ready"}
          emptyContent={<NoResultsState title="No stores yet" description="Create a store to start selling." />}
          noResultsContent={<NoResultsState title="No stores match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearFilters }} />}
          errorContent={<ErrorState title="Could not load stores" description="Something went wrong fetching the store list." action={{ label: "Retry", onPress: () => storesQuery.refetch() }} />}
          onRowClick={(row) => setEditing(row)}
          rowActions={(row) => (
            <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              <IconButton aria-label={`Payment methods for ${row.name}`} size="compact" variant="ghost" onPress={() => setPaymentTarget(row)}>
                <CreditCard className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={row.active ? `Deactivate ${row.name}` : `Activate ${row.name}`}
                size="compact"
                variant={row.active ? "danger" : "ghost"}
                onPress={() => (row.active ? setDeactivateTarget(row) : toggleActiveMutation.mutate(row))}
                isDisabled={toggleActiveMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          )}
        />

        <AlertDialog
          isOpen={Boolean(deactivateTarget)}
          onOpenChange={(open) => !open && setDeactivateTarget(null)}
          title={`Deactivate ${deactivateTarget?.name ?? "this store"}?`}
          description={`Terminals at ${deactivateTarget?.name ?? "this store"} will no longer be able to complete sales or sync offline transactions until it is reactivated. This is blocked automatically while a shift or cart is still open, so use this only once the store is safely closed out.`}
          confirmLabel="Deactivate"
          isConfirming={toggleActiveMutation.isPending}
          onConfirm={() => deactivateTarget && toggleActiveMutation.mutate(deactivateTarget)}
        />
      </EnterpriseListPage>

      {paymentTarget && <StorePaymentDialog store={paymentTarget} onClose={() => setPaymentTarget(null)} />}

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
