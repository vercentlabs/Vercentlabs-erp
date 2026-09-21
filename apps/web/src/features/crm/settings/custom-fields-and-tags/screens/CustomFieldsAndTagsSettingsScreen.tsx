"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus } from "lucide-react";
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
  archiveCustomFieldDefinition,
  archiveCustomObjectDefinition,
  archiveTag,
  createCustomFieldDefinition,
  createCustomObjectDefinition,
  createTag,
  listCustomFieldDefinitions,
  listCustomObjectDefinitions,
  listTags,
  SettingsApiError,
} from "../api/custom-fields-and-tags-api";
import type { CrmCustomFieldDataType, CrmCustomFieldDefinition, CrmCustomObjectDefinition, CrmTag } from "../types";

const DATA_TYPE_OPTIONS: SelectOption[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes or no" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choose one option" },
];
const dataTypeLabel = (value: string) => DATA_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const keyFromLabel = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const statusBadge = (value: unknown) => <StatusBadge tone={value === "active" ? "success" : "neutral"}>{value === "active" ? "In use" : "Archived"}</StatusBadge>;

type Archiving = { kind: "tag"; row: CrmTag } | { kind: "object"; row: CrmCustomObjectDefinition } | { kind: "field"; row: CrmCustomFieldDefinition };

// F028 Custom fields and tags — the "definitions" half of this feature:
// a real tag library and a real custom-object/custom-field builder, both
// reusing the generic /api/crm/[resource] boundary (crm.settings.manage).
// Deliberately does NOT attempt to bind these field definitions onto the
// built-in Lead/Opportunity/Account/Contact entities — see the register
// for why (their own customData JSONB column has no schema validation
// wired to this definition system; adding that would be real, risk-
// sensitive backend work to already-shipped governed commands, not a
// frontend-only task).
export function CustomFieldsAndTagsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Archiving | null>(null);

  const tagsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tags"), queryFn: listTags });
  const objectsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "custom-object-definitions"), queryFn: listCustomObjectDefinitions });
  const fieldsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "custom-field-definitions"), queryFn: listCustomFieldDefinitions });

  const objectLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of objectsQuery.data?.rows ?? []) map.set(row.id, row.pluralLabel);
    return map;
  }, [objectsQuery.data]);

  const objectOptions: SelectOption[] = useMemo(
    () => (objectsQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: row.pluralLabel })),
    [objectsQuery.data],
  );

  function invalidateTags() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tags") });
  }
  function invalidateObjects() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "custom-object-definitions") });
  }
  function invalidateFields() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "custom-field-definitions") });
  }
  function handleError(err: unknown) {
    setError(err instanceof SettingsApiError ? err.message : "This action could not be completed.");
    // A stale-write conflict means a row's local updatedAt is already
    // wrong — refetch every list so the next attempt uses current data.
    if (err instanceof SettingsApiError && err.code === "CRM_STALE_WRITE") {
      invalidateTags();
      invalidateObjects();
      invalidateFields();
    }
  }

  const archiveTagMutation = useMutation({ mutationFn: (tag: CrmTag) => archiveTag(tag.id, tag.updatedAt), onSuccess: invalidateTags, onError: handleError });
  const archiveObjectMutation = useMutation({ mutationFn: (row: CrmCustomObjectDefinition) => archiveCustomObjectDefinition(row.id, row.updatedAt), onSuccess: invalidateObjects, onError: handleError });
  const archiveFieldMutation = useMutation({ mutationFn: (row: CrmCustomFieldDefinition) => archiveCustomFieldDefinition(row.id, row.updatedAt), onSuccess: invalidateFields, onError: handleError });

  const tagColumns: ColumnDef<CrmTag, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-medium text-text">
            <span className="size-3 rounded-full border border-border" style={{ backgroundColor: row.original.color || undefined }} aria-hidden="true" />
            {row.original.name}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => statusBadge(getValue()),
      },
      { id: "updatedAt", header: "Last changed", accessorFn: (row) => formatDate(row.updatedAt) },
    ],
    [],
  );

  const objectColumns: ColumnDef<CrmCustomObjectDefinition, unknown>[] = useMemo(
    () => [
      {
        id: "pluralLabel",
        header: "Record type",
        accessorKey: "pluralLabel",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium text-text">{row.original.pluralLabel}</span>
            <span className="text-xs text-text-muted">{"Internal name: " + row.original.objectKey}</span>
          </span>
        ),
      },
      { id: "companyScoped", header: "Kept separately per company", accessorFn: (row) => (row.companyScoped ? "Yes" : "No, shared by all companies") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => statusBadge(getValue()),
      },
    ],
    [],
  );

  const fieldColumns: ColumnDef<CrmCustomFieldDefinition, unknown>[] = useMemo(
    () => [
      { id: "objectDefinitionId", header: "On record type", accessorFn: (row) => objectLabelById.get(row.objectDefinitionId) || "A record type that was archived" },
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
      { id: "dataType", header: "What people enter", accessorFn: (row) => dataTypeLabel(row.dataType) },
      { id: "required", header: "Must be filled in", accessorFn: (row) => (row.required ? "Yes" : "No") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => statusBadge(getValue()),
      },
    ],
    [objectLabelById],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <p className="rounded-[var(--radius-control)] border border-border-strong bg-surface-muted px-3 py-2 text-sm text-text-secondary">
        This page has three separate tools. <strong>Tags</strong> are labels you stick on records to group them. <strong>Custom record types</strong> are whole new kinds of record you track next to leads and accounts.
        <strong> Fields on custom record types</strong> are the details each of those records holds. To add a detail to leads, accounts, contacts or opportunities themselves, use{" "}
        <a className="font-medium text-brand underline" href="/crm/settings/record-fields">Custom Record Fields</a>.
      </p>

      <EnterpriseListPage
        header={{
          title: "Tags",
          description: "Short labels anyone can put on CRM records to group and find them.",
          primaryAction: (
            <Button variant="primary" onPress={() => setTagDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New tag
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmTag>
          aria-label="Tags"
          columns={tagColumns}
          data={tagsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          {...gridStates(tagsQuery, (tagsQuery.data?.rows.length ?? 0), "tags", { title: "No tags yet", description: "Tags are short labels you put on leads to group and find them, such as Event lead or Partner referral. Create one with New tag." })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive tag ${row.name}`} size="compact" variant="danger" onPress={() => setArchiving({ kind: "tag", row })}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Custom record types",
          description: "New kinds of record your business needs, kept apart from leads, accounts, contacts and opportunities.",
          primaryAction: (
            <Button variant="primary" onPress={() => setObjectDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New record type
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomObjectDefinition>
          aria-label="Custom record types"
          columns={objectColumns}
          data={objectsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          {...gridStates(objectsQuery, (objectsQuery.data?.rows.length ?? 0), "custom record types", { title: "No custom record types yet", description: "A custom record type is a new kind of record you track alongside leads and accounts, for example Site visit or Contract.", action: { label: "New record type", onPress: () => setObjectDialogOpen(true) } })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.pluralLabel}`} size="compact" variant="danger" onPress={() => setArchiving({ kind: "object", row })}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Fields on custom record types",
          description: "The details each custom record type holds, such as a visit date or a contract value. Add a record type first.",
          primaryAction: (
            <Button variant="primary" onPress={() => setFieldDialogOpen(true)} isDisabled={objectOptions.length === 0}>
              <Plus className="size-4" aria-hidden="true" />
              New field
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomFieldDefinition>
          aria-label="Fields on custom record types"
          columns={fieldColumns}
          data={fieldsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          {...gridStates(fieldsQuery, (fieldsQuery.data?.rows.length ?? 0), "fields", { title: objectOptions.length === 0 ? "Add a custom record type first" : "No fields yet", description: objectOptions.length === 0 ? "Fields belong to a custom record type, so create one above before adding fields." : "A field is a detail a custom record type holds, such as Visit date or Contract value. Use New field to add the first one." })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.label}`} size="compact" variant="danger" onPress={() => setArchiving({ kind: "field", row })}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      {archiving && (
        <AlertDialog
          isOpen
          onOpenChange={(open) => { if (!open) setArchiving(null); }}
          title={"Archive " + (archiving.kind === "object" ? archiving.row.pluralLabel : archiving.kind === "field" ? archiving.row.label : archiving.row.name) + "?"}
          description={
            archiving.kind === "tag"
              ? "The tag can no longer be added to records. Records that already have it keep it in their history."
              : archiving.kind === "object"
                ? "You will no longer be able to create these records, and their fields are hidden. Records already saved are kept."
                : "The field disappears from forms. Values people already entered are kept."
          }
          confirmLabel="Archive"
          isConfirming={archiveTagMutation.isPending || archiveObjectMutation.isPending || archiveFieldMutation.isPending}
          onConfirm={() => {
            const done = { onSettled: () => setArchiving(null) };
            if (archiving.kind === "tag") archiveTagMutation.mutate(archiving.row, done);
            else if (archiving.kind === "object") archiveObjectMutation.mutate(archiving.row, done);
            else archiveFieldMutation.mutate(archiving.row, done);
          }}
        />
      )}

      <TagDialog isOpen={tagDialogOpen} onOpenChange={setTagDialogOpen} onCreated={invalidateTags} onError={handleError} />
      <CustomObjectDialog isOpen={objectDialogOpen} onOpenChange={setObjectDialogOpen} onCreated={invalidateObjects} onError={handleError} />
      <CustomFieldDialog isOpen={fieldDialogOpen} onOpenChange={setFieldDialogOpen} objectOptions={objectOptions} onCreated={invalidateFields} onError={handleError} />
    </div>
  );
}

function TagDialog({
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
  const [color, setColor] = useState("#2563eb");

  const mutation = useMutation({
    mutationFn: () => createTag({ name, color }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setColor("#2563eb");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New tag">
      <div className="flex flex-col gap-4">
        <TextField label="Tag name" value={name} onChange={setName} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tag-color" className="text-sm font-medium text-text">Colour</label>
          <input id="tag-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-16 rounded-[var(--radius-control)] border border-border" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create tag
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CustomObjectDialog({
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
  const [objectKey, setObjectKey] = useState("");
  const [singularLabel, setSingularLabel] = useState("");
  const [pluralLabel, setPluralLabel] = useState("");
  const [companyScoped, setCompanyScoped] = useState(false);
  const [keyEdited, setKeyEdited] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createCustomObjectDefinition({ objectKey, singularLabel, pluralLabel, companyScoped }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setObjectKey("");
      setSingularLabel("");
      setPluralLabel("");
      setCompanyScoped(false);
      setKeyEdited(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New custom record type">
      <div className="flex flex-col gap-4">
        <TextField label="Name of one record" description="For example, Site visit." value={singularLabel} onChange={(v) => { setSingularLabel(v); if (!keyEdited) setObjectKey(keyFromLabel(v)); }} />
        <TextField label="Name of many records" description="For example, Site visits. Shown in lists and menus." value={pluralLabel} onChange={setPluralLabel} />
        <TextField label="Internal name" description="Made from the name. Lowercase letters, numbers and underscores. It cannot be changed later." value={objectKey} onChange={(v) => { setKeyEdited(true); setObjectKey(v.toLowerCase()); }} />
        <Checkbox isSelected={companyScoped} onChange={setCompanyScoped}>Keep these records separate for each company</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!objectKey.trim() || !singularLabel.trim() || !pluralLabel.trim()}>
            Create record type
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CustomFieldDialog({
  isOpen,
  onOpenChange,
  objectOptions,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  objectOptions: SelectOption[];
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [objectDefinitionId, setObjectDefinitionId] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [dataType, setDataType] = useState<CrmCustomFieldDataType>("text");
  const [required, setRequired] = useState(false);
  const [keyEdited, setKeyEdited] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createCustomFieldDefinition({ objectDefinitionId, fieldKey, label, dataType, required }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setObjectDefinitionId("");
      setFieldKey("");
      setLabel("");
      setDataType("text");
      setRequired(false);
      setKeyEdited(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New field">
      <div className="flex flex-col gap-4">
        <Select label="Belongs to record type" options={objectOptions} selectedKey={objectDefinitionId} onSelectionChange={(key) => setObjectDefinitionId(String(key ?? ""))} />
        <TextField label="Field name" description="What people see on the form." placeholder="For example, Visit date" value={label} onChange={(v) => { setLabel(v); if (!keyEdited) setFieldKey(keyFromLabel(v)); }} />
        <TextField label="Internal name" description="Made from the field name. It cannot be changed later." value={fieldKey} onChange={(v) => { setKeyEdited(true); setFieldKey(v.toLowerCase()); }} />
        <Select label="What people enter" options={DATA_TYPE_OPTIONS} selectedKey={dataType} onSelectionChange={(key) => setDataType(String(key ?? "text") as CrmCustomFieldDataType)} />
        <Checkbox isSelected={required} onChange={setRequired}>Must be filled in before a record can be saved</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!objectDefinitionId || !fieldKey.trim() || !label.trim()}
          >
            Create field
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
