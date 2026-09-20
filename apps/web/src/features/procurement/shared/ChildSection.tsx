"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { createRecord, getOptions, listRecords, updateRecord, type ProcRecord } from "@/features/procurement/shared/api";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/procurement/shared/FieldInput";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";

export type ChildConfig = {
  resource: string; // e.g. "supplier-sites"
  title: string;
  description?: string;
  noun: string;
  fields: FieldDef[];
  columns: ColumnDef<ProcRecord, unknown>[];
  manage: string; // permission that reveals add/edit
  emptyText: string;
  // Only offer add/edit while the parent is in one of these states (server enforces too).
  parentStates?: string[];
  // Extra static values sent with every create/update (e.g. a fixed record type).
  fixed?: Record<string, unknown>;
  editable?: boolean;
  // Derive fields from the entered ones before saving (e.g. an overall score).
  transform?: (values: Record<string, FieldValue>) => Record<string, unknown>;
};

// List, add and edit the child records of a parent document (sites,
// qualifications, invitations, bids, ...). Children are separate records with
// their own version, so edits carry expectedVersion like any other write.
export function ChildSection({ config, parentId, parentStatus, onChanged }: { config: ChildConfig; parentId: string; parentStatus: string; onChanged?: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [editing, setEditing] = useState<ProcRecord | "new" | null>(null);
  const key = scopedQueryKey(workspace, "procurement", config.resource, "children", parentId);
  const query = useQuery({ queryKey: key, queryFn: () => listRecords(config.resource, { parentId, limit: 200 }).then((r) => r.rows) });
  const rows = query.data ?? [];
  const canManage = can(config.manage) && (!config.parentStates || config.parentStates.includes(parentStatus));
  const columns: ColumnDef<ProcRecord, unknown>[] = config.editable === false || !canManage
    ? config.columns
    : [...config.columns, { id: "edit", header: "", cell: ({ row }) => <Button variant="ghost" size="compact" onPress={() => setEditing(row.original)}>Edit</Button> }];

  return (
    <ProcPanel
      title={config.title}
      description={config.description}
      actions={
        canManage ? (
          <Button variant="secondary" size="compact" onPress={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add {config.noun}
          </Button>
        ) : undefined
      }
    >
      <EnterpriseDataGrid<ProcRecord> aria-label={config.title} columns={columns} data={rows} getRowId={(row) => row.id} density="compact" state={query.isLoading ? "loading" : rows.length ? "ready" : "empty"} loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">{config.emptyText}</p>} />
      {editing && (
        <ChildDialog
          config={config}
          parentId={parentId}
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
            onChanged?.();
          }}
        />
      )}
    </ProcPanel>
  );
}

function ChildDialog({ config, parentId, record, onClose, onSaved }: { config: ChildConfig; parentId: string; record: ProcRecord | null; onClose: () => void; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "options"), queryFn: getOptions });
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    for (const field of config.fields) {
      const existing = record?.[field.name];
      initial[field.name] = existing !== undefined && existing !== null ? (field.kind === "number" ? Number(existing) : String(existing).slice(0, field.kind === "date" ? 10 : undefined)) : (field.defaultValue ?? (field.kind === "number" ? 0 : ""));
    }
    return initial;
  });
  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")), ...(config.transform ? config.transform(values) : {}), ...(config.fixed ?? {}) };
      return record ? updateRecord(config.resource, record.id, { ...payload, parentId, expectedVersion: record.version }) : createRecord(config.resource, { ...payload, parentId });
    },
    onSuccess: onSaved,
  });
  const message = mutation.error ? (mutation.error instanceof ProcApiError ? mutation.error.message : "This could not be saved.") : null;
  const missing = config.fields.some((field) => field.required && (values[field.name] === "" || values[field.name] === undefined));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`${record ? "Edit" : "Add"} ${config.noun}`}>
      <div className="flex flex-col gap-4">
        {message && <ProcAlert>{message}</ProcAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className={field.wide || field.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <FieldInput field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} options={options.data} />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={missing}>
            {record ? "Save changes" : `Add ${config.noun}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
