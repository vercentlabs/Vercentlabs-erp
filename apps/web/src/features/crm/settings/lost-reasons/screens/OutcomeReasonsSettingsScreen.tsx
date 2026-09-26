"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { humanize } from "@/shared/format/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { archiveOutcomeReason, createOutcomeReason, listOutcomeReasons, OutcomeReasonApiError, updateOutcomeReason } from "../api/lost-reasons-api";
import { LOST_REASON_CATEGORIES, OUTCOME_TYPES, type CrmOutcomeReason, type OutcomeType } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

const CATEGORY_OPTIONS: SelectOption[] = LOST_REASON_CATEGORIES.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));
const OUTCOME_TYPE_OPTIONS: SelectOption[] = OUTCOME_TYPES.map((value) => ({ value, label: value.replace(/^./, (c) => c.toUpperCase()) }));

// F026 Won/Lost reasons — a governed setup screen for the reason
// catalogue the Opportunity 360's stage-move dialog already reads
// (getCrmOptions().lostReasons) but could never manage. Reuses the
// generic /api/crm/[resource] boundary ("lost-reasons" has no
// governance redirect, confirmed by reading resource-mutation-
// service.js). Governed reason CAPTURE at close time was already real
// (F026 IN_PROGRESS); this closes the setup-UI half.
export function OutcomeReasonsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingReason, setEditingReason] = useState<CrmOutcomeReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lost-reasons"), queryFn: listOutcomeReasons });
  const rows = useMemo(() => [...(query.data?.rows ?? [])].sort((a, b) => a.sequence - b.sequence), [query.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lost-reasons") });
  }
  function handleError(err: unknown) {
    setError(err instanceof OutcomeReasonApiError ? err.message : "This action could not be completed.");
    if (err instanceof OutcomeReasonApiError && err.code === "CRM_STALE_WRITE") invalidate();
  }

  // Order is changed with move up / move down. A swap is done in three writes through a temporary slot so the two rows never
  // hold the same position at once.
  const ordered = useMemo(() => [...rows].sort((a, b) => a.outcomeType.localeCompare(b.outcomeType) || a.sequence - b.sequence), [rows]);
  const moveMutation = useMutation({
    mutationFn: async ({ row, direction }: { row: CrmOutcomeReason; direction: -1 | 1 }) => {
      const peers = ordered.filter((r) => r.outcomeType === row.outcomeType);
      const at = peers.findIndex((r) => r.id === row.id);
      const other = peers[at + direction];
      if (!other) return;
      const parked = await updateOutcomeReason(row.id, { sequence: 100000 + row.sequence }, row.updatedAt);
      await updateOutcomeReason(other.id, { sequence: row.sequence }, other.updatedAt);
      await updateOutcomeReason(row.id, { sequence: other.sequence }, parked.record.updatedAt);
    },
    onSuccess: () => { setError(null); invalidate(); },
    onError: handleError,
  });

  const archiveMutation = useMutation({ mutationFn: (row: CrmOutcomeReason) => archiveOutcomeReason(row.id, row.updatedAt), onSuccess: invalidate, onError: handleError });

  const columns: ColumnDef<CrmOutcomeReason, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "outcomeType", header: "Applies to", accessorFn: (row) => humanize(row.outcomeType) },
      { id: "category", header: "Category", accessorFn: (row) => humanize(row.category) },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Won / lost reasons",
          description: "Why deals are won or lost. Use the arrows to set the order people see them in.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New reason
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmOutcomeReason>
          aria-label="Won / lost reasons"
          columns={columns}
          data={ordered}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "reasons", { title: "No reasons yet", description: "Reasons explain why a deal was won or lost. Choosing one when closing a deal makes your win and loss reports meaningful." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Move ${row.name} up`} size="compact" variant="outline" isDisabled={moveMutation.isPending || ordered.filter((r) => r.outcomeType === row.outcomeType)[0]?.id === row.id} onPress={() => moveMutation.mutate({ row, direction: -1 })}>
                <ArrowUp className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton aria-label={`Move ${row.name} down`} size="compact" variant="outline" isDisabled={moveMutation.isPending || ordered.filter((r) => r.outcomeType === row.outcomeType).at(-1)?.id === row.id} onPress={() => moveMutation.mutate({ row, direction: 1 })}>
                <ArrowDown className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="outline" onPress={() => setEditingReason(row)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              {row.status === "active" && <MoreMenu label={`More actions for ${row.name}`} isBusy={archiveMutation.isPending} items={[{ id: "archive", label: "Archive reason", danger: true, onAction: () => archiveMutation.mutate(row), confirm: { title: `Archive ${row.name}?`, description: "It is no longer offered when closing a deal. Deals that already used it keep it.", confirmLabel: "Archive" } }]} />}
            </span>
          )}
        />
      </EnterpriseListPage>

      <CreateReasonDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} onError={handleError} />
      <EditReasonDialog reason={editingReason} onOpenChange={(open) => !open && setEditingReason(null)} onSaved={invalidate} onError={handleError} />
    </div>
  );
}

function CreateReasonDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [outcomeType, setOutcomeType] = useState<OutcomeType>("lost");
  const [category, setCategory] = useState("other");

  const mutation = useMutation({
    mutationFn: () => createOutcomeReason({ name, outcomeType, category }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setOutcomeType("lost");
      setCategory("other");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New won/lost reason">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Applies to" options={OUTCOME_TYPE_OPTIONS} selectedKey={outcomeType} onSelectionChange={(key) => setOutcomeType(String(key ?? "lost") as OutcomeType)} />
        <Select label="Category" options={CATEGORY_OPTIONS} selectedKey={category} onSelectionChange={(key) => setCategory(String(key ?? "other"))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create reason
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// F026 — closes the register's own disclosed gap ("edit form for reasons
// (create/archive only), sequence reordering UI"). "lost-reasons" is a
// GENERIC_VERSIONED_RESOURCES entry (resource-validation.js), so this
// PATCH is real optimistic-concurrency, not a no-op precondition like the
// F020/F002 sales-teams/account-plans disclosed gaps.
function EditReasonDialog({
  reason,
  onOpenChange,
  onSaved,
  onError,
}: {
  reason: CrmOutcomeReason | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(reason?.name ?? "");
  const [outcomeType, setOutcomeType] = useState<OutcomeType>(reason?.outcomeType ?? "lost");
  const [category, setCategory] = useState(reason?.category ?? "other");
  const [sequence, setSequence] = useState(String(reason?.sequence ?? 100));

  const [seededFor, setSeededFor] = useState<CrmOutcomeReason | null | undefined>(undefined);
  if (reason && reason !== seededFor) {
    setSeededFor(reason);
    setName(reason.name);
    setOutcomeType(reason.outcomeType);
    setCategory(reason.category);
    setSequence(String(reason.sequence));
  }

  const mutation = useMutation({
    mutationFn: () => updateOutcomeReason(reason!.id, { name, outcomeType, category, sequence: Number(sequence) || 0 }, reason!.updatedAt),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={Boolean(reason)} onOpenChange={onOpenChange} title={reason ? `Edit ${reason.name}` : "Edit reason"}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Applies to" options={OUTCOME_TYPE_OPTIONS} selectedKey={outcomeType} onSelectionChange={(key) => setOutcomeType(String(key ?? "lost") as OutcomeType)} />
        <Select label="Category" options={CATEGORY_OPTIONS} selectedKey={category} onSelectionChange={(key) => setCategory(String(key ?? "other"))} />
        <TextField label="Order" description="Lower numbers appear first in the close-reason picker." value={sequence} onChange={setSequence} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
