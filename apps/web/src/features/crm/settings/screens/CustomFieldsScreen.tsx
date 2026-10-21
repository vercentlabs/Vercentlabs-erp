"use client";

// CRM › Setup › Custom fields (CRM plan 5.3, companies and contacts: CRM audit M4): the organization's own fields on leads, deals,
// companies and contacts — a machine model, a tender number, an outlet's channel (GT/MT) or beat. They show on the forms and pages, come
// in through import and go out in export, and filter the lists; a switched-off field is hidden but its values are kept.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { CUSTOM_FIELD_TYPES, createCustomField, errorMessage, listCustomFields, updateCustomField, type CustomField, type CustomFieldType, type CustomFieldEntity } from "@/features/crm/shared/fields-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const ENTITIES = [{ value: "lead", label: "Leads" }, { value: "opportunity", label: "Deals" }, { value: "party", label: "Companies" }, { value: "contact", label: "Contacts" }] as const;
const PLURAL: Record<CustomFieldEntity, string> = { lead: "leads", opportunity: "deals", party: "companies", contact: "contacts" };
const TYPE_LABEL = Object.fromEntries(CUSTOM_FIELD_TYPES.map((entry) => [entry.value, entry.label])) as Record<string, string>;

export function CustomFieldsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const [entity, setEntity] = useState<CustomFieldEntity>("lead");
  const key = scopedQueryKey(workspace, "crm", "custom-fields", entity, "all");
  const query = useQuery({ queryKey: key, queryFn: () => listCustomFields(entity, true), enabled: canManage });
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "custom-fields") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact-options") });
  };
  const toggle = useMutation({ mutationFn: (field: CustomField) => updateCustomField(field.id, { isActive: !field.isActive }), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });

  if (!canManage) return <PermissionState title="You can't manage custom fields" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Custom fields" description="Your own fields on leads, deals, companies and contacts. They appear on the forms and record pages, in import and export, and as list filters."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New field</Button>} />
      {error && <Notice>{error}</Notice>}
      <div className="max-w-xs">
        <Select label="Fields on" selectedKey={entity} onSelectionChange={(next) => setEntity(String(next) as CustomFieldEntity)} options={ENTITIES.map((entry) => ({ ...entry }))} />
      </div>
      {query.isLoading ? <LoadingState label="Loading custom fields" rows={4} /> : query.isError ? (
        <ErrorState title="Could not load the custom fields" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-sm text-text-secondary">No custom fields on {PLURAL[entity]} yet.</p>
      ) : (
        <ul className="flex max-w-4xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {(query.data ?? []).map((field) => (
            <li key={field.id} className="flex items-start justify-between gap-3 p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{field.label}</span>
                  <Badge tone="neutral">{TYPE_LABEL[field.type]}</Badge>
                  {field.isRequired && <Badge tone="warning">Required</Badge>}
                  {!field.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                </div>
                <span className="text-text-secondary">{field.type === "select" ? field.options.join(" · ") : field.helpText ?? `Key: ${field.key}`}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="compact" onPress={() => setEditing(field)}>Edit</Button>
                <Button variant="ghost" size="compact" isDisabled={toggle.isPending} onPress={() => toggle.mutate(field)}>{field.isActive ? "Switch off" : "Switch on"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <FieldDialog entity={entity} field={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function FieldDialog({ entity, field, onClose, onSaved }: { entity: CustomFieldEntity; field: CustomField | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [options, setOptions] = useState((field?.options ?? []).join("\n"));
  const [isRequired, setRequired] = useState(field?.isRequired ?? false);
  const [helpText, setHelpText] = useState(field?.helpText ?? "");
  const [error, setError] = useState<string | null>(null);
  const choices = options.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => field
      ? updateCustomField(field.id, { label, isRequired, helpText, ...(field.type === "select" ? { options: choices } : {}) })
      : createCustomField({ entityType: entity, label, type, isRequired, helpText, ...(type === "select" ? { options: choices } : {}) }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const kind = field?.type ?? type;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={field ? `Edit ${field.label}` : `New field on ${PLURAL[entity]}`}>
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <TextField label="Name" isRequired value={label} onChange={setLabel} maxLength={80} />
        <Select label="Kind" isDisabled={Boolean(field)} description={field ? "A field keeps its kind." : undefined} selectedKey={kind}
          onSelectionChange={(next) => setType(String(next) as CustomFieldType)} options={CUSTOM_FIELD_TYPES} />
        {kind === "select" && <TextArea label="Choices" description="One per line, 2 to 50." value={options} onChange={setOptions} />}
        <TextField label="Help text" description="Optional. Shown under the field on the form." value={helpText} onChange={setHelpText} maxLength={200} />
        {kind !== "checkbox" && <Checkbox isSelected={isRequired} onChange={setRequired}>Required on the form</Checkbox>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!label.trim() || (kind === "select" && choices.length < 2)} onPress={() => save.mutate()}>{field ? "Save" : "Add field"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
