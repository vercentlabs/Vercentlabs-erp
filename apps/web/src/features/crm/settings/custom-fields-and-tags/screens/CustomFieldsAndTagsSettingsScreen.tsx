"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus } from "lucide-react";
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

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

const DATA_TYPE_OPTIONS: SelectOption[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text area" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
];

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
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [],
  );

  const objectColumns: ColumnDef<CrmCustomObjectDefinition, unknown>[] = useMemo(
    () => [
      { id: "objectKey", header: "Key", accessorKey: "objectKey" },
      { id: "pluralLabel", header: "Name", accessorKey: "pluralLabel", cell: ({ row }) => <span className="font-medium text-text">{row.original.pluralLabel}</span> },
      { id: "companyScoped", header: "Company-scoped", accessorFn: (row) => (row.companyScoped ? "Yes" : "No") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [],
  );

  const fieldColumns: ColumnDef<CrmCustomFieldDefinition, unknown>[] = useMemo(
    () => [
      { id: "objectDefinitionId", header: "Object", accessorFn: (row) => objectLabelById.get(row.objectDefinitionId) || "—" },
      { id: "fieldKey", header: "Key", accessorKey: "fieldKey" },
      { id: "label", header: "Label", accessorKey: "label", cell: ({ row }) => <span className="font-medium text-text">{row.original.label}</span> },
      { id: "dataType", header: "Type", accessorKey: "dataType" },
      { id: "required", header: "Required", accessorFn: (row) => (row.required ? "Yes" : "No") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
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

      <EnterpriseListPage
        header={{
          title: "Tags",
          description: "The tag library available across CRM records.",
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
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archiveTagMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Custom objects",
          description: "Tenant-defined entity types, separate from the built-in Lead/Account/Contact/Opportunity records.",
          primaryAction: (
            <Button variant="primary" onPress={() => setObjectDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New object
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomObjectDefinition>
          aria-label="Custom objects"
          columns={objectColumns}
          data={objectsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          {...gridStates(objectsQuery, (objectsQuery.data?.rows.length ?? 0), "custom objects", { title: "No custom objects yet", description: "A custom object is a new kind of record you track alongside leads and accounts, for example Site visit or Contract." })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.pluralLabel}`} size="compact" variant="danger" onPress={() => archiveObjectMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Custom fields",
          description: "Typed fields attached to a custom object above.",
          primaryAction: (
            <Button variant="primary" onPress={() => setFieldDialogOpen(true)} isDisabled={objectOptions.length === 0}>
              <Plus className="size-4" aria-hidden="true" />
              New field
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmCustomFieldDefinition>
          aria-label="Custom fields"
          columns={fieldColumns}
          data={fieldsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          {...gridStates(fieldsQuery, (fieldsQuery.data?.rows.length ?? 0), "custom fields", { title: "No custom fields yet", description: "A custom field adds your own detail to leads, accounts, contacts or opportunities, such as Preferred language or Contract end date." })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.label}`} size="compact" variant="danger" onPress={() => archiveFieldMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

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
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tag-color" className="text-sm font-medium text-text">Color</label>
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

  const mutation = useMutation({
    mutationFn: () => createCustomObjectDefinition({ objectKey, singularLabel, pluralLabel, companyScoped }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setObjectKey("");
      setSingularLabel("");
      setPluralLabel("");
      setCompanyScoped(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New custom object">
      <div className="flex flex-col gap-4">
        <TextField label="Object key" placeholder="e.g. site_visit" isRequired value={objectKey} onChange={setObjectKey} />
        <TextField label="Singular label" placeholder="e.g. Site Visit" isRequired value={singularLabel} onChange={setSingularLabel} />
        <TextField label="Plural label" placeholder="e.g. Site Visits" isRequired value={pluralLabel} onChange={setPluralLabel} />
        <Checkbox isSelected={companyScoped} onChange={setCompanyScoped}>Company-scoped</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!objectKey.trim() || !singularLabel.trim() || !pluralLabel.trim()}>
            Create object
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
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New custom field">
      <div className="flex flex-col gap-4">
        <Select label="Object" isRequired options={objectOptions} selectedKey={objectDefinitionId} onSelectionChange={(key) => setObjectDefinitionId(String(key ?? ""))} />
        <TextField label="Field key" placeholder="e.g. preferred_channel" isRequired value={fieldKey} onChange={setFieldKey} />
        <TextField label="Label" placeholder="e.g. Preferred Channel" isRequired value={label} onChange={setLabel} />
        <Select label="Data type" options={DATA_TYPE_OPTIONS} selectedKey={dataType} onSelectionChange={(key) => setDataType(String(key ?? "text") as CrmCustomFieldDataType)} />
        <Checkbox isSelected={required} onChange={setRequired}>Required</Checkbox>
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
