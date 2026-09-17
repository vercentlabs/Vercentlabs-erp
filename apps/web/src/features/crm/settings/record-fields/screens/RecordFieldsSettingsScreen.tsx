"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power } from "lucide-react";
import {
  Button,
  Checkbox,
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

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createCustomFieldDefinition,
  CustomFieldApiError,
  listCustomFieldDefinitions,
  setCustomFieldDefinitionActive,
  CUSTOM_FIELD_DATA_TYPES,
  type CrmCustomFieldDataType,
  type CrmCustomFieldDefinition,
  type CrmCustomFieldEntityType,
} from "@/features/crm/shared/custom-fields-api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

const ENTITY_TYPE_OPTIONS: SelectOption[] = [
  { value: "lead", label: "Leads" },
  { value: "opportunity", label: "Opportunities" },
  { value: "party", label: "Accounts" },
  { value: "contact", label: "Contacts" },
];

const DATA_TYPE_OPTIONS: SelectOption[] = CUSTOM_FIELD_DATA_TYPES.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

// F028 — governed setup for custom fields bound to BUILT-IN CRM entities
// (Leads/Opportunities/Accounts/Contacts), against the platform-level
// custom_field_definitions table. Deliberately a separate screen from
// /crm/settings/custom-fields-and-tags (the tenant-defined custom
// OBJECT system) — the two are architecturally distinct, confirmed by
// reading the schema, not assumed the same.
export function RecordFieldsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [entityType, setEntityType] = useState<CrmCustomFieldEntityType>("lead");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "record-field-definitions", entityType),
    queryFn: () => listCustomFieldDefinitions(entityType),
  });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "record-field-definitions", entityType) });
  }
  function handleError(err: unknown) {
    setError(err instanceof CustomFieldApiError ? err.message : "This action could not be completed.");
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (row: CrmCustomFieldDefinition) => setCustomFieldDefinitionActive(row.id, row.status !== "active"),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<CrmCustomFieldDefinition, unknown>[] = useMemo(
    () => [
      { id: "fieldKey", header: "Key", accessorKey: "fieldKey" },
      { id: "label", header: "Label", accessorKey: "label", cell: ({ row }) => <span className="font-medium text-text">{row.original.label}</span> },
      { id: "dataType", header: "Type", accessorFn: (row) => row.dataType.replace(/_/g, " ") },
      { id: "required", header: "Required", accessorFn: (row) => (row.required ? "Yes" : "No") },
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

      <Select aria-label="Entity type" options={ENTITY_TYPE_OPTIONS} selectedKey={entityType} onSelectionChange={(key) => setEntityType(String(key ?? "lead") as CrmCustomFieldEntityType)} className="max-w-[280px]" />

      <EnterpriseListPage
        header={{
          title: `Custom fields — ${ENTITY_TYPE_OPTIONS.find((o) => o.value === entityType)?.label}`,
          description: "Typed fields that appear on this record type's 360 and are validated server-side.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New field
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomFieldDefinition>
          aria-label="Custom fields"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <IconButton
                aria-label={row.status === "active" ? `Deactivate ${row.label}` : `Activate ${row.label}`}
                size="compact"
                variant={row.status === "active" ? "danger" : "ghost"}
                onPress={() => toggleActiveMutation.mutate(row)}
                isDisabled={toggleActiveMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          )}
        />
      </EnterpriseListPage>

      <CreateFieldDialog isOpen={createOpen} onOpenChange={setCreateOpen} entityType={entityType} onCreated={invalidate} onError={handleError} />
    </div>
  );
}

function CreateFieldDialog({
  isOpen,
  onOpenChange,
  entityType,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: CrmCustomFieldEntityType;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState<CrmCustomFieldDataType>("text");
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState("");

  const isChoiceType = dataType === "select" || dataType === "multi_select";

  const mutation = useMutation({
    mutationFn: () =>
      createCustomFieldDefinition(entityType, {
        fieldKey,
        label,
        dataType,
        required,
        options: isChoiceType ? optionsText.split(",").map((option) => option.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setFieldKey("");
      setLabel("");
      setDataType("text");
      setRequired(false);
      setOptionsText("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New custom field">
      <div className="flex flex-col gap-4">
        <TextField label="Field key" placeholder="e.g. preferred_channel" isRequired value={fieldKey} onChange={setFieldKey} />
        <TextField label="Label" placeholder="e.g. Preferred Channel" isRequired value={label} onChange={setLabel} />
        <Select label="Data type" options={DATA_TYPE_OPTIONS} selectedKey={dataType} onSelectionChange={(key) => setDataType(String(key ?? "text") as CrmCustomFieldDataType)} />
        {isChoiceType && (
          <TextField label="Options (comma-separated)" placeholder="Hot, Warm, Cold" value={optionsText} onChange={setOptionsText} />
        )}
        <Checkbox isSelected={required} onChange={setRequired}>Required</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!fieldKey.trim() || !label.trim() || (isChoiceType && !optionsText.trim())}
          >
            Create field
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
