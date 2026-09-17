"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createPosTerminal,
  listPosStores,
  listPosTerminals,
  PosApiError,
  setPosTerminalStatusRecord,
  updatePosTerminalRecord,
  type PosTerminal,
} from "@/features/pos/shared/pos-api";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = { active: "success", maintenance: "warning", inactive: "neutral" };

// F269 -- real terminal administration: list/create/edit/status transition
// (active/inactive/maintenance), backed by createTerminal/updatePosTerminal/
// setPosTerminalStatus. Any transition away from 'active', or reassigning a
// terminal to a different store, is blocked server-side while a shift is
// open on it (POS_TERMINAL_HAS_OPEN_SHIFT/POS_TERMINAL_UNSAFE_TRANSITION).
export function PosTerminalsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.terminalManage);

  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PosTerminal | null>(null);

  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals, enabled: canManage });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores, enabled: canManage });
  const rows = terminalsQuery.data?.rows ?? [];
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
      { id: "store", header: "Store", accessorFn: (row) => storeById.get(row.store_id ?? row.storeId ?? "") ?? "—" },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.status}</StatusBadge> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Select
            aria-label={`Status for ${row.original.name}`}
            size="compact"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "maintenance", label: "Maintenance" },
            ]}
            selectedKey={row.original.status}
            onSelectionChange={(key) => key && statusMutation.mutate({ terminal: row.original, status: key as "active" | "inactive" | "maintenance" })}
          />
        ),
      },
    ],
    [storeById, statusMutation],
  );

  if (!canManage) return <PermissionState title="You don't have access to POS Terminals" description="Ask an administrator to grant pos.terminal.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

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
      >
        <EnterpriseDataGrid<PosTerminal>
          aria-label="Terminals"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={terminalsQuery.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          onRowClick={(row) => setEditing(row)}
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
