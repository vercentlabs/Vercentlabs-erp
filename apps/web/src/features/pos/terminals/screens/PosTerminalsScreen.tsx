"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField, type ActiveFilter } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { POS_ADMIN_LIST_LIMIT, listPosStores } from "@/features/pos/stores/api/stores-api";
import { statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert } from "@/features/pos/shared/PosUi";
import {
  createPosTerminal,
  listPosTerminals,
  setPosTerminalStatusRecord,
  updatePosTerminalRecord,
  type PosTerminal,
} from "@/features/pos/terminals/api/terminals-api";

// F269 -- real terminal administration: list/create/edit/status transition
// (active/inactive/maintenance), backed by store-terminal-and-cashier-
// control/terminal-operations.js's createTerminal/updatePosTerminal/
// setPosTerminalStatus. Any transition away from 'active', or reassigning a
// terminal to a different store, is blocked server-side while a shift is
// open on it (POS_TERMINAL_HAS_OPEN_SHIFT/POS_TERMINAL_UNSAFE_TRANSITION).
export function PosTerminalsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.terminalManage);

  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosTerminal | null>(null);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals, enabled: canManage });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const allRows = terminalsQuery.data?.rows;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (allRows ?? []).filter((terminal) => {
      if (storeFilter && (terminal.store_id ?? terminal.storeId) !== storeFilter) return false;
      if (statusFilter && terminal.status !== statusFilter) return false;
      if (!needle) return true;
      return [terminal.name, terminal.code, terminal.store_name].some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [allRows, search, storeFilter, statusFilter]);
  const hitPageCeiling = (allRows?.length ?? 0) >= POS_ADMIN_LIST_LIMIT;
  const hasFilters = Boolean(search.trim() || storeFilter || statusFilter);
  const storeById = useMemo(() => new Map((storesQuery.data?.rows ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "terminals") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const statusMutation = useMutation({
    mutationFn: ({ terminal, status }: { terminal: PosTerminal; status: "active" | "inactive" | "maintenance" }) => setPosTerminalStatusRecord(terminal.id, status),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<PosTerminal, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "store", header: "Store", accessorFn: (row) => row.store_name ?? storeById.get(row.store_id ?? row.storeId ?? "") ?? "—" },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    ],
    [storeById],
  );

  const activeFilters: ActiveFilter[] = [];
  if (storeFilter) activeFilters.push({ id: "store", label: `Store: ${storeById.get(storeFilter) ?? "selected"}` });
  if (statusFilter) activeFilters.push({ id: "status", label: `Status: ${statusLabel(statusFilter)}` });
  if (search.trim()) activeFilters.push({ id: "search", label: `Search: ${search.trim()}` });
  function removeFilter(id: string) {
    if (id === "store") setStoreFilter("");
    if (id === "status") setStatusFilter("");
    if (id === "search") setSearch("");
  }
  function clearFilters() {
    setSearch("");
    setStoreFilter("");
    setStatusFilter("");
  }

  if (!canManage) return <PermissionState title="You don't have access to POS Terminals" description="Ask an administrator to grant pos.terminal.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && <PosAlert>{error}</PosAlert>}

      <EnterpriseListPage
        header={{
          title: "Terminals",
          description: "Checkout devices, each belonging to exactly one store.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)} isDisabled={!storesQuery.data}>
              <Plus className="size-4" aria-hidden="true" />
              New terminal
            </Button>
          ),
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search terminals" placeholder="Search name, code or store…" value={search} onChange={setSearch} className="min-w-[240px]" />
              <Select
                aria-label="Store"
                size="compact"
                options={[{ value: "", label: "Any store" }, ...(storesQuery.data?.rows ?? []).map((store) => ({ value: store.id, label: store.name }))]}
                selectedKey={storeFilter}
                onSelectionChange={(key) => setStoreFilter(String(key ?? ""))}
              />
              <Select
                aria-label="Status"
                size="compact"
                options={[
                  { value: "", label: "Any status" },
                  { value: "active", label: "Active" },
                  { value: "maintenance", label: "Maintenance" },
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
        {hitPageCeiling && <PosAlert tone="warning">Showing the first {POS_ADMIN_LIST_LIMIT} terminals — narrow the list with the filters above.</PosAlert>}
        <EnterpriseDataGrid<PosTerminal>
          aria-label="Terminals"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={terminalsQuery.isError ? "error" : terminalsQuery.isLoading ? "loading" : rows.length === 0 && hasFilters ? "no-results" : rows.length === 0 ? "empty" : "ready"}
          emptyContent={<NoResultsState title="No terminals yet" description="Create a terminal to start selling from a store." />}
          noResultsContent={<NoResultsState title="No terminals match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearFilters }} />}
          errorContent={<ErrorState title="Could not load terminals" description="Something went wrong fetching the terminal list." action={{ label: "Retry", onPress: () => terminalsQuery.refetch() }} />}
          onRowClick={(row) => setEditing(row)}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <Select
                aria-label={`Status for ${row.name}`}
                size="compact"
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                  { value: "maintenance", label: "Maintenance" },
                ]}
                selectedKey={row.status}
                onSelectionChange={(key) => key && key !== row.status && statusMutation.mutate({ terminal: row, status: key as "active" | "inactive" | "maintenance" })}
              />
            </span>
          )}
        />
      </EnterpriseListPage>

      {storesQuery.data && (
        <CreateTerminalDialog isOpen={createOpen} onOpenChange={setCreateOpen} stores={storesQuery.data.rows} onCreated={invalidate} onError={handleError} />
      )}
      {editing && storesQuery.data && (
        <EditTerminalDialog
          terminal={editing}
          stores={storesQuery.data.rows}
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

function CreateTerminalDialog({
  isOpen,
  onOpenChange,
  stores,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  stores: { id: string; name: string }[];
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [storeId, setStoreId] = useState("");
  const [receiptPrefix, setReceiptPrefix] = useState("POS");

  const mutation = useMutation({
    mutationFn: () => createPosTerminal({ name, code, storeId, receiptPrefix }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setCode("");
      setStoreId("");
      setReceiptPrefix("POS");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New terminal">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <Select label="Store" isRequired options={stores.map((s) => ({ value: s.id, label: s.name }))} selectedKey={storeId} onSelectionChange={(key) => setStoreId(String(key ?? ""))} />
        <TextField label="Receipt prefix" value={receiptPrefix} onChange={(v) => setReceiptPrefix(v.toUpperCase())} maxLength={10} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !code.trim() || !storeId}>
            Create terminal
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EditTerminalDialog({
  terminal,
  stores,
  onClose,
  onSaved,
  onError,
}: {
  terminal: PosTerminal;
  stores: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(terminal.name);
  const [storeId, setStoreId] = useState(terminal.store_id ?? terminal.storeId ?? "");

  const mutation = useMutation({
    mutationFn: () => updatePosTerminalRecord(terminal.id, { name, storeId }),
    onSuccess: onSaved,
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Edit ${terminal.name}`}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Store" options={stores.map((s) => ({ value: s.id, label: s.name }))} selectedKey={storeId} onSelectionChange={(key) => setStoreId(String(key ?? ""))} />
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
