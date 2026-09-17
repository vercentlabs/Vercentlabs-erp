"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  MultiSelect,
  PermissionState,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archivePlaybook,
  archiveQualificationCriterion,
  createPlaybook,
  createQualificationCriterion,
  listPlaybooks,
  listQualificationCriteria,
  SettingsApiError,
} from "../api/qualification-and-playbooks-api";
import {
  QUALIFICATION_CHECK_TYPES,
  QUALIFICATION_FIELD_KEYS,
  QUALIFICATION_TIERS,
  type CrmPlaybook,
  type QualificationCheckType,
  type QualificationCriterion,
  type QualificationTier,
} from "../types";

const TIER_OPTIONS: SelectOption[] = QUALIFICATION_TIERS.map((value) => ({ value, label: value.replace(/^./, (c) => c.toUpperCase()) }));
const CHECK_TYPE_OPTIONS: SelectOption[] = QUALIFICATION_CHECK_TYPES.map((value) => ({ value, label: value === "positive_number" ? "Positive number" : "Any field filled" }));
const FIELD_KEY_OPTIONS = QUALIFICATION_FIELD_KEYS.map((value) => ({ value, label: value }));

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// F006 Tranche I (Stage A) — qualification-criteria is a genuine match
// (not a dead-table decoy like F005/F027's generic resources): confirmed
// lead-qualification.js's evaluateLeadQualificationReadiness reads this
// exact table/columns before wiring anything. Playbooks (tenant.
// crm_playbooks) is a separate, generic, pipeline-scoped resource not
// actually consumed by any Lead-qualification logic (confirmed by grep)
// — included here only because the nav registry's pre-existing
// "Qualification / Playbooks" placeholder groups both under one
// destination; not fabricated as a Lead-specific feature.
export function QualificationAndPlaybooksSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const [criterionDialogOpen, setCriterionDialogOpen] = useState(false);
  const [playbookDialogOpen, setPlaybookDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const criteriaQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "qualification-criteria"), queryFn: listQualificationCriteria });
  const playbooksQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "playbooks"), queryFn: listPlaybooks });
  const criteria = useMemo(() => [...(criteriaQuery.data?.rows ?? [])].sort((a, b) => a.sequence - b.sequence), [criteriaQuery.data]);
  const playbooks = playbooksQuery.data?.rows ?? [];

  function invalidateCriteria() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "qualification-criteria") });
  }
  function invalidatePlaybooks() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "playbooks") });
  }
  function handleError(err: unknown) {
    setError(err instanceof SettingsApiError ? err.message : "This action could not be completed.");
  }

  const archiveCriterionMutation = useMutation({
    mutationFn: (row: QualificationCriterion) => archiveQualificationCriterion(row.id, row.updatedAt),
    onSuccess: invalidateCriteria,
    onError: handleError,
  });
  const archivePlaybookMutation = useMutation({
    mutationFn: (row: CrmPlaybook) => archivePlaybook(row.id, row.updatedAt),
    onSuccess: invalidatePlaybooks,
    onError: handleError,
  });

  const criteriaColumns: ColumnDef<QualificationCriterion, unknown>[] = useMemo(
    () => [
      { id: "sequence", header: "Order", accessorKey: "sequence" },
      { id: "label", header: "Label", accessorKey: "label", cell: ({ row }) => <span className="font-medium text-text">{row.original.label}</span> },
      { id: "tier", header: "Tier", accessorKey: "tier" },
      { id: "checkType", header: "Check", accessorFn: (row) => (row.checkType === "positive_number" ? "Positive number" : "Any field filled") },
      { id: "fieldKeys", header: "Fields", accessorFn: (row) => row.fieldKeys.join(", ") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [],
  );

  const playbookColumns: ColumnDef<CrmPlaybook, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "framework", header: "Framework", accessorFn: (row) => row.framework || "—" },
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
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Lead qualification criteria",
          description: "Required and recommended readiness checks shown on a Lead's Qualification tab.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCriterionDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New criterion
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<QualificationCriterion>
          aria-label="Qualification criteria"
          columns={criteriaColumns}
          data={criteria}
          getRowId={(row) => row.id}
          state={criteriaQuery.isLoading ? "loading" : criteria.length === 0 ? "empty" : "ready"}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.label}`} size="compact" variant="danger" onPress={() => archiveCriterionMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Playbooks",
          description: "Sales methodology guidance available on a pipeline's Opportunities.",
          primaryAction: (
            <Button variant="primary" onPress={() => setPlaybookDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New playbook
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmPlaybook>
          aria-label="Playbooks"
          columns={playbookColumns}
          data={playbooks}
          getRowId={(row) => row.id}
          state={playbooksQuery.isLoading ? "loading" : playbooks.length === 0 ? "empty" : "ready"}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archivePlaybookMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <CriterionDialog isOpen={criterionDialogOpen} onOpenChange={setCriterionDialogOpen} onCreated={invalidateCriteria} onError={handleError} />
      <PlaybookDialog isOpen={playbookDialogOpen} onOpenChange={setPlaybookDialogOpen} onCreated={invalidatePlaybooks} onError={handleError} />
    </div>
  );
}

function CriterionDialog({ isOpen, onOpenChange, onCreated, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [criterionKey, setCriterionKey] = useState("");
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<QualificationTier>("required");
  const [checkType, setCheckType] = useState<QualificationCheckType>("non_empty_any");
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: () => createQualificationCriterion({ criterionKey, label, tier, checkType, fieldKeys }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setCriterionKey("");
      setLabel("");
      setFieldKeys([]);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New qualification criterion">
      <div className="flex flex-col gap-4">
        <TextField label="Key" description="A stable identifier, e.g. has_budget." isRequired value={criterionKey} onChange={setCriterionKey} />
        <TextField label="Label" isRequired value={label} onChange={setLabel} />
        <Select label="Tier" options={TIER_OPTIONS} selectedKey={tier} onSelectionChange={(key) => setTier((key as QualificationTier) ?? "required")} />
        <Select label="Check" options={CHECK_TYPE_OPTIONS} selectedKey={checkType} onSelectionChange={(key) => setCheckType((key as QualificationCheckType) ?? "non_empty_any")} />
        <MultiSelect
          label="Fields"
          description={checkType === "positive_number" ? "Exactly one field for a positive-number check." : "Met if any selected field is filled."}
          options={FIELD_KEY_OPTIONS}
          value={fieldKeys}
          onChange={setFieldKeys}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!criterionKey.trim() || !label.trim() || !fieldKeys.length}>
            Create criterion
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PlaybookDialog({ isOpen, onOpenChange, onCreated, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [framework, setFramework] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () => createPlaybook({ name, framework: framework || null, description: description || null }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setFramework("");
      setDescription("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New playbook">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Framework" placeholder="e.g. MEDDIC, BANT" value={framework} onChange={setFramework} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create playbook
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
