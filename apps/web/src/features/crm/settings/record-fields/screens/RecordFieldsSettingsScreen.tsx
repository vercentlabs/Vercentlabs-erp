"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power } from "lucide-react";
import {
  AlertDialog,
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

import { formatDate } from "@/features/crm/shared/human";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
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

const ENTITY_TYPE_OPTIONS: SelectOption[] = [
  { value: "lead", label: "Leads" },
  { value: "opportunity", label: "Opportunities" },
  { value: "party", label: "Accounts" },
  { value: "contact", label: "Contacts" },
];

const DATA_TYPE_LABELS: Record<string, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  currency: "Money",
  percentage: "Percentage",
  boolean: "Yes or no",
  date: "Date",
  datetime: "Date and time",
  select: "Choose one option",
  multi_select: "Choose several options",
};
const dataTypeLabel = (value: string) => DATA_TYPE_LABELS[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const DATA_TYPE_OPTIONS: SelectOption[] = CUSTOM_FIELD_DATA_TYPES.map((value) => ({ value, label: dataTypeLabel(value) }));
const RECORD_KIND: Record<string, string> = { lead: "Leads", opportunity: "Opportunities", party: "Accounts", contact: "Contacts" };
const keyFromLabel = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

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
  const [turningOff, setTurningOff] = useState<CrmCustomFieldDefinition | null>(null);

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
      {
        id: "label",
        header: "Field",
        accessorKey: "label",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium text-text">{row.original.label}</span>
            <span className="text-xs text-text-muted">{"Internal name: " + row.original.fieldKey}</span>
          </span>
        ),
      },
      { id: "appearsOn", header: "Appears on", accessorFn: () => RECORD_KIND[entityType] ?? "" },
      { id: "dataType", header: "What people enter", accessorFn: (row) => dataTypeLabel(row.dataType) },
      { id: "required", header: "Must be filled in", accessorFn: (row) => (row.required ? "Yes" : "No") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{getValue() === "active" ? "In use" : "Turned off"}</StatusBadge>,
      },
      { id: "updatedAt", header: "Last changed", accessorFn: (row) => formatDate(row.updatedAt) },
    ],
    [entityType],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Select label="Which records do these fields belong to?" options={ENTITY_TYPE_OPTIONS} selectedKey={entityType} onSelectionChange={(key) => setEntityType(String(key ?? "lead") as CrmCustomFieldEntityType)} className="max-w-[280px]" />

      <EnterpriseListPage
        header={{
          title: `Fields on ${(RECORD_KIND[entityType] ?? "records").toLowerCase()}`,
          description: "Extra details your team wants to keep on each record. They appear on the record's form and on its detail page, and entries are checked against the type you choose.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New field
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomFieldDefinition>
          aria-label="Fields on this kind of record"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "record fields", { title: "No record fields yet", description: "A field adds your own detail to a kind of record, such as a preferred contact channel on a lead. Pick the records above, then add the first field." , action: { label: "New field", onPress: () => setCreateOpen(true) } })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <IconButton
                aria-label={row.status === "active" ? `Turn off ${row.label}` : `Turn ${row.label} back on`}
                size="compact"
                variant={row.status === "active" ? "danger" : "ghost"}
                onPress={() => (row.status === "active" ? setTurningOff(row) : toggleActiveMutation.mutate(row))}
                isDisabled={toggleActiveMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          )}
        />
      </EnterpriseListPage>

      {turningOff && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setTurningOff(null); }}
          title={"Turn off " + turningOff.label + "?"}
          description="It disappears from forms and detail pages. Values people already entered are kept, and you can turn the field back on at any time."
          confirmLabel="Turn off"
          isConfirming={toggleActiveMutation.isPending}
          onConfirm={() => toggleActiveMutation.mutate(turningOff, { onSettled: () => setTurningOff(null) })}
        />
      )}

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
  const [keyEdited, setKeyEdited] = useState(false);

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
      setKeyEdited(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New custom field">
      <div className="flex flex-col gap-4">
        <TextField label="Field name" description="What people see on the form." placeholder="For example, Preferred channel" value={label} onChange={(v) => { setLabel(v); if (!keyEdited) setFieldKey(keyFromLabel(v)); }} />
        <TextField label="Internal name" description="Made from the field name. Lowercase letters, numbers and underscores. It cannot be changed later." value={fieldKey} onChange={(v) => { setKeyEdited(true); setFieldKey(v.toLowerCase()); }} />
        <Select label="What people enter" options={DATA_TYPE_OPTIONS} selectedKey={dataType} onSelectionChange={(key) => setDataType(String(key ?? "text") as CrmCustomFieldDataType)} />
        {isChoiceType && (
          <TextField label="Choices" description="Separate choices with commas." placeholder="Email, Phone, WhatsApp" value={optionsText} onChange={setOptionsText} />
        )}
        <Checkbox isSelected={required} onChange={setRequired}>Must be filled in before a record can be saved</Checkbox>
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
