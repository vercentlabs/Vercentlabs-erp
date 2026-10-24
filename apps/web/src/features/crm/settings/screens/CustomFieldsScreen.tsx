"use client";

// CRM › Setup › Custom fields (CRM plan 5.3, companies and contacts: CRM audit M4): the organization's own fields on leads, deals,
// companies and contacts — a machine model, a tender number, an outlet's channel (GT/MT) or beat. They show on the forms and pages in the
// order set here, come in through import (a column with the field's name) and go out in export, and choice and yes/no fields filter the
// lists. A switched-off field is hidden but its values are kept; each field says how many records use it.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import {
  CUSTOM_FIELD_TYPES, createCustomField, errorMessage, listCustomFields, reorderCustomFields, updateCustomField, type CustomField, type CustomFieldEntity,
  type CustomFieldType, type CustomValues,
} from "@/features/crm/shared/fields-api";
import { CustomFieldInputs } from "@/features/crm/shared/ui/CustomFields";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const ENTITIES: Array<{ value: CustomFieldEntity; label: string; one: string; many: string }> = [
  { value: "lead", label: "Leads", one: "lead", many: "leads" }, { value: "opportunity", label: "Deals", one: "deal", many: "deals" },
  { value: "party", label: "Companies", one: "company", many: "companies" }, { value: "contact", label: "Contacts", one: "contact", many: "contacts" },
];
const TYPE_LABEL = Object.fromEntries(CUSTOM_FIELD_TYPES.map((entry) => [entry.value, entry.label])) as Record<string, string>;
const TYPE_HELP: Record<CustomFieldType, string> = {
  text: "Any words or numbers, such as a tender number.", number: "A number, such as a machine count.", date: "A date, such as a warranty end.",
  select: "One of a list you set; also a list filter.", checkbox: "Yes or no; also a list filter.",
};
const MAX_FIELDS = 50;
const entityOf = (value: CustomFieldEntity) => ENTITIES.find((entry) => entry.value === value)!;

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
    for (const options of ["lead-options", "opportunity-options", "account-options", "contact-options"])
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", options) });
  };
  const toggle = useMutation({ mutationFn: (field: CustomField) => updateCustomField(field.id, { isActive: !field.isActive }), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => reorderCustomFields(entity, ids), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const fields = useMemo(() => query.data ?? [], [query.data]);
  const active = fields.filter((field) => field.isActive);
  const off = fields.filter((field) => !field.isActive);
  const kind = entityOf(entity);
  const busy = toggle.isPending || reorder.isPending;
  const move = (index: number, by: -1 | 1) => {
    const ids = active.map((field) => field.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate([...ids, ...off.map((field) => field.id)]);
  };

  if (!canManage) return <PermissionState title="You can't manage custom fields" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Custom fields" description="Your own fields on leads, deals, companies and contacts: on the forms and record pages, in import and export, and as list filters."
        primaryAction={<Button variant="primary" className="w-full sm:w-auto" isDisabled={active.length >= MAX_FIELDS} onPress={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" />New field</Button>} />
      <div role="group" aria-label="Fields on" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {ENTITIES.map((entry) => (
          <Button key={entry.value} size="compact" variant={entry.value === entity ? "primary" : "secondary"} aria-pressed={entry.value === entity}
            onPress={() => { setEntity(entry.value); setError(null); }}>{entry.label}</Button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {query.isLoading ? <LoadingState label="Loading custom fields" rows={4} /> : query.isError ? (
        <ErrorState title="Could not load the custom fields" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : (
        <div className="flex max-w-5xl flex-col gap-5">
          <p className="text-sm text-text-secondary">
            {`${active.length} of ${MAX_FIELDS} fields on ${kind.many}. They show on the ${kind.one} form and page in this order. In import, a column with the field's name fills it.`}
          </p>
          {active.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6">
              <p className="text-sm font-medium">{`No custom fields on ${kind.many} yet`}</p>
              <p className="text-sm text-text-secondary">Add what your team records that the standard fields don&apos;t cover, such as a machine model, a tender number or a channel.</p>
              <Button variant="secondary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />{`Add a field to ${kind.many}`}</Button>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
              {active.map((field, index) => (
                <FieldRow key={field.id} field={field} one={kind.one} many={kind.many} busy={busy} onEdit={() => setEditing(field)} onToggle={() => toggle.mutate(field)}
                  onUp={index > 0 ? () => move(index, -1) : undefined} onDown={index < active.length - 1 ? () => move(index, 1) : undefined} />
              ))}
            </ul>
          )}
          {off.length > 0 && (
            <Panel title={`Switched off (${off.length})`} description="Hidden from the forms, pages, import and filters. Their values are kept; switch one on to show it again.">
              <ul className="flex flex-col divide-y divide-border">
                {off.map((field) => (
                  <FieldRow key={field.id} field={field} one={kind.one} many={kind.many} busy={busy} onEdit={() => setEditing(field)} onToggle={() => toggle.mutate(field)} />
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
      {editing && <FieldDialog entity={entity} field={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function FieldRow({ field, one, many, busy, onEdit, onToggle, onUp, onDown }: {
  field: CustomField; one: string; many: string; busy: boolean; onEdit: () => void; onToggle: () => void; onUp?: () => void; onDown?: () => void;
}) {
  const shown = field.options.slice(0, 8);
  return (
    <li className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${field.isActive ? "" : "text-text-secondary"}`}>{field.label}</span>
          <Badge tone="neutral">{TYPE_LABEL[field.type]}</Badge>
          {field.isRequired && <Badge tone="warning">Required</Badge>}
          {!field.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
        </div>
        {field.type === "select" && (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((option) => <span key={option} className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary">{option}</span>)}
            {field.options.length > shown.length && <span className="px-1 py-0.5 text-xs text-text-muted">{`+${field.options.length - shown.length} more`}</span>}
          </div>
        )}
        {field.helpText && <span className="text-text-secondary">{field.helpText}</span>}
        <span className="text-xs text-text-muted">{field.usedOn ? `Filled on ${field.usedOn} ${field.usedOn === 1 ? one : many}` : `Not filled on any ${many} yet`}</span>
      </div>
      <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
        {field.isActive && (
          <>
            <Button variant="ghost" size="compact" isDisabled={busy || !onUp} onPress={onUp}><ArrowUp className="size-4" aria-hidden="true" />Up</Button>
            <Button variant="ghost" size="compact" isDisabled={busy || !onDown} onPress={onDown}><ArrowDown className="size-4" aria-hidden="true" />Down</Button>
          </>
        )}
        <Button variant="secondary" size="compact" onPress={onEdit}>Edit</Button>
        <Button variant="ghost" size="compact" isDisabled={busy} onPress={onToggle}>{field.isActive ? "Switch off" : "Switch on"}</Button>
      </div>
    </li>
  );
}

function FieldDialog({ entity, field, onClose, onSaved }: { entity: CustomFieldEntity; field: CustomField | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [options, setOptions] = useState((field?.options ?? []).join("\n"));
  const [isRequired, setRequired] = useState(field?.isRequired ?? false);
  const [helpText, setHelpText] = useState(field?.helpText ?? "");
  const [preview, setPreview] = useState<CustomValues>({});
  const [error, setError] = useState<string | null>(null);
  const kind = field?.type ?? type;
  const lines = options.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const choices = [...new Map(lines.map((line) => [line.toLowerCase(), line])).values()];
  const repeated = lines.length - choices.length;
  const removed = field ? field.options.filter((option) => !choices.some((choice) => choice.toLowerCase() === option.toLowerCase())) : [];
  const save = useMutation({
    mutationFn: () => field
      ? updateCustomField(field.id, { label, isRequired, helpText, ...(field.type === "select" ? { options: choices } : {}) })
      : createCustomField({ entityType: entity, label, type, isRequired, helpText, ...(type === "select" ? { options: choices } : {}) }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const ready = Boolean(label.trim()) && (kind !== "select" || (choices.length >= 2 && choices.length <= 50));
  const sample: CustomField = { id: "preview", entityType: entity, key: "preview", label: label.trim() || "Your field", type: kind, options: choices, isRequired: isRequired && kind !== "checkbox",
    helpText: helpText.trim() || null, sequence: 0, isActive: true };
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={field ? `Edit ${field.label}` : `New field on ${entityOf(entity).many}`} size="lg">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="flex flex-col gap-4">
          {error && <Notice>{error}</Notice>}
          <TextField label="Name" isRequired value={label} onChange={setLabel} maxLength={80} description="Also the import and export column." />
          <Select label="Kind" isDisabled={Boolean(field)} description={field ? "A field keeps its kind." : TYPE_HELP[kind]} selectedKey={kind}
            onSelectionChange={(next) => setType(String(next) as CustomFieldType)} options={CUSTOM_FIELD_TYPES} />
          {kind === "select" && (
            <div className="flex flex-col gap-1">
              <TextArea label="Choices" isRequired description="One per line, 2 to 50." rows={5} value={options} onChange={setOptions} />
              <span className={`text-xs ${choices.length > 50 ? "text-danger" : "text-text-muted"}`}>
                {`${choices.length} choice${choices.length === 1 ? "" : "s"}${repeated ? `; ${repeated} repeated line${repeated === 1 ? "" : "s"} ignored` : ""}`}
              </span>
              {removed.length > 0 && (
                <span className="text-xs text-warning">{`Taking off ${removed.join(", ")}: records that have it keep it until someone changes it.`}</span>
              )}
            </div>
          )}
          <TextField label="Help text" description="Optional. Shown under the field on the form." value={helpText} onChange={setHelpText} maxLength={200} />
          {kind !== "checkbox" && <Checkbox isSelected={isRequired} onChange={setRequired}>Required on the form</Checkbox>}
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
          <span className="text-xs font-medium text-text-secondary">On the form</span>
          <CustomFieldInputs fields={[sample]} values={preview} onChange={setPreview} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end md:col-span-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending} onPress={() => save.mutate()}>{field ? "Save" : "Add field"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
