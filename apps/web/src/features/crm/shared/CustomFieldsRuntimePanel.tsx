"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, CheckboxGroup, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  CustomFieldApiError,
  getCustomFieldValueHistory,
  getCustomFieldValues,
  setCustomFieldValues,
  type CrmCustomFieldEntityType,
  type CrmCustomFieldValueRow,
} from "./custom-fields-api";

// F028 runtime custom fields, composed into a record 360 the same way
// Notes/Attachments are. A single schema-driven renderer — one row of UI
// per active definition, keyed off dataType — not a hardcoded component
// per field. Server-side validation (custom-field-runtime.js's
// coerceValue) is authoritative; this only mirrors the same rules for
// immediate feedback (required/select-options), never trusts client
// validation alone.
export function CustomFieldsRuntimePanel({ entityType, entityId }: { entityType: CrmCustomFieldEntityType; entityId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "custom-field-values", entityType, entityId),
    queryFn: () => getCustomFieldValues(entityType, entityId),
  });
  const rows = query.data?.rows ?? [];
  const historyQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "custom-field-values", entityType, entityId, "history"),
    queryFn: () => getCustomFieldValueHistory(entityType, entityId),
  });
  const history = historyQuery.data?.rows ?? [];

  // Adjusting state while rendering (React's own sanctioned alternative
  // to an effect that would call setState synchronously) — seeded once
  // per fetch, guarded so the user's in-progress edits are never
  // clobbered by a background refetch. Same pattern as the former SavedViewsBar's
  // default-view selection.
  const [seededFor, setSeededFor] = useState<unknown>(undefined);
  if (!dirty && query.data && query.data !== seededFor) {
    setSeededFor(query.data);
    const initial: Record<string, unknown> = {};
    for (const row of rows) initial[row.fieldKey] = row.value;
    setDraft(initial);
  }

  const mutation = useMutation({
    mutationFn: () => setCustomFieldValues(entityType, entityId, draft),
    onSuccess: () => {
      setError(null);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "custom-field-values", entityType, entityId) });
    },
    onError: (err: unknown) => setError(err instanceof CustomFieldApiError ? err.message : "These fields could not be saved."),
  });

  function updateField(fieldKey: string, value: unknown) {
    setDirty(true);
    setDraft((current) => ({ ...current, [fieldKey]: value }));
  }

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading custom fields…</p>;
  if (rows.length === 0) return <p className="text-sm text-text-muted">No custom fields configured for this record type.</p>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {rows.map((row) => (
        <CustomFieldInput key={row.fieldKey} row={row} value={draft[row.fieldKey]} onChange={(value) => updateField(row.fieldKey, value)} />
      ))}
      <Button variant="secondary" size="compact" className="self-start" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dirty}>
        Save custom fields
      </Button>
      {history.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4" aria-label="Custom field history">
          <p className="text-sm font-semibold text-text">Change history</p>
          <ul className="flex flex-col gap-1">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm text-text-secondary">
                <span className="font-medium text-text">{entry.fieldLabel}</span>
                {`: ${showValue(entry.previousValue)} → ${showValue(entry.newValue)}`}
                <span className="text-xs text-text-muted">{` · ${entry.changedByName ?? "System"}, ${new Date(entry.changedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function showValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function CustomFieldInput({ row, value, onChange }: { row: CrmCustomFieldValueRow; value: unknown; onChange: (value: unknown) => void }) {
  const label = row.required ? `${row.label} *` : row.label;

  if (row.dataType === "boolean") {
    return (
      <Checkbox isSelected={Boolean(value)} onChange={onChange}>
        {label}
      </Checkbox>
    );
  }
  if (row.dataType === "textarea") {
    return <TextArea label={label} value={String(value ?? "")} onChange={onChange} />;
  }
  if (row.dataType === "select") {
    const options: SelectOption[] = (row.configuration?.options ?? []).map((option) => ({ value: option, label: option }));
    return <Select label={label} options={options} selectedKey={String(value ?? "")} onSelectionChange={(key) => onChange(key ? String(key) : null)} />;
  }
  if (row.dataType === "multi_select") {
    const options = row.configuration?.options ?? [];
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <CheckboxGroup label={label} value={selected} onChange={onChange} orientation="horizontal">
        {options.map((option) => (
          <Checkbox key={option} value={option}>
            {option}
          </Checkbox>
        ))}
      </CheckboxGroup>
    );
  }
  if (row.dataType === "date" || row.dataType === "datetime") {
    return <TextField label={label} placeholder="YYYY-MM-DD" value={value ? String(value).slice(0, 10) : ""} onChange={onChange} />;
  }
  // text / number / currency / percentage — plain text input, matching
  // this codebase's established convention elsewhere (e.g. Opportunity
  // probability/amount) of not using a native number input.
  return <TextField label={label} value={value === null || value === undefined ? "" : String(value)} onChange={onChange} />;
}
