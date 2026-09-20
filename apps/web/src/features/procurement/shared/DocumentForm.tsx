"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, ErrorState, IconButton, PageHeader, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { actOn, createRecord, getOptions, getRecord, updateRecord, type ProcOptions, type ProcRecord } from "@/features/procurement/shared/api";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/procurement/shared/FieldInput";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";

export type FormConfig = {
  resource: string;
  noun: string;
  backHref: string;
  detailHref: (id: string) => string;
  fields: FieldDef[];
  lines?: { key: string; label: string; addLabel: string; fields: FieldDef[]; minimum?: number };
  // Optional: shape the payload before it is sent (e.g. drop empty fields).
  toInput?: (values: Record<string, FieldValue>, lines: Array<Record<string, FieldValue>>) => Record<string, unknown>;
  // Pre-fill from the query string on create (e.g. ?supplier=<id>).
  initial?: Record<string, FieldValue>;
  // Create from another document (a PO from an approved requisition, ...): the
  // source is loaded by id from the query string and mapped onto the form.
  fromSources?: Record<string, { resource: string; map: (record: ProcRecord) => { values: Record<string, FieldValue>; lines?: Array<Record<string, FieldValue>> } }>;
};

type LineState = Record<string, FieldValue> & { _key: number };
let lineKey = 0;

function blankLine(fields: FieldDef[]): LineState {
  const line: LineState = { _key: ++lineKey };
  for (const field of fields) if (field.defaultValue !== undefined) line[field.name] = field.defaultValue;
  return line;
}

// Create or edit any Procurement document. The form only collects; totals,
// numbering, reference checks and state rules are the server's, and its error
// message is shown as-is.
export function DocumentForm({ config, id, sourceKind, sourceId, amend }: { config: FormConfig; id?: string; sourceKind?: string; sourceId?: string; amend?: boolean }) {
  const sourceDef = sourceKind ? config.fromSources?.[sourceKind] : undefined;
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "options"), queryFn: getOptions });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", config.resource, id), queryFn: () => getRecord(config.resource, id!), enabled: Boolean(id) });
  const source = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "source", sourceId), queryFn: () => getRecord(sourceDef!.resource, sourceId!), enabled: Boolean(sourceId && sourceDef) });
  if (options.isLoading || (id && existing.isLoading) || (sourceId && sourceDef && source.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (options.isError || !options.data) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => options.refetch() }} />;
  if (id && (existing.isError || !existing.data)) return <ErrorState title={`Could not load this ${config.noun}`} action={{ label: "Retry", onPress: () => existing.refetch() }} />;
  return <FormBody key={id ?? sourceId ?? "new"} config={config} id={id} existing={existing.data ?? null} options={options.data} sourceMapped={source.data && sourceDef ? sourceDef.map(source.data) : null} amend={Boolean(amend)} />;
}

function FormBody({ config, id, existing, options, sourceMapped, amend }: { config: FormConfig; id?: string; existing: ProcRecord | null; options: ProcOptions; sourceMapped: { values: Record<string, FieldValue>; lines?: Array<Record<string, FieldValue>> } | null; amend: boolean }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(id);
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const initial: Record<string, FieldValue> = {};
    for (const field of config.fields) {
      const fromRecord = existing?.[field.name];
      initial[field.name] = fromRecord !== undefined && fromRecord !== null ? (typeof fromRecord === "number" ? fromRecord : String(fromRecord).slice(0, field.kind === "date" ? 10 : undefined)) : (sourceMapped?.values[field.name] ?? config.initial?.[field.name] ?? field.defaultValue ?? (field.kind === "number" ? 0 : ""));
    }
    return initial;
  });
  const [lines, setLines] = useState<LineState[]>(() => {
    if (!config.lines) return [];
    const rows = Array.isArray(existing?.[config.lines.key]) ? (existing![config.lines.key] as Array<Record<string, unknown>>) : [];
    if (rows.length) {
      return rows.map((row) => {
        const line: LineState = { _key: ++lineKey };
        // Keep every scalar the server stored on the line (purchaseOrderLineId, itemId, ...),
        // not just the visible fields, or editing would silently drop the links to other documents.
        const numeric = new Set(config.lines!.fields.filter((field) => field.kind === "number").map((field) => field.name));
        for (const [key, value] of Object.entries(row)) {
          if (["createdAt", "updatedAt", "status", "version"].includes(key)) continue;
          if (typeof value === "string" || typeof value === "number") line[key] = numeric.has(key) ? Number(value) : value;
        }
        return line;
      });
    }
    if (sourceMapped?.lines?.length) return sourceMapped.lines.map((row) => ({ ...blankLine(config.lines!.fields), ...row }));
    return Array.from({ length: config.lines.minimum ?? 1 }, () => blankLine(config.lines!.fields));
  });
  const [error, setError] = useState<string | null>(null);
  const [amendReason, setAmendReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const cleanLines = lines.map((line) => {
        const out: Record<string, FieldValue> = {};
        for (const [key, value] of Object.entries(line)) if (key !== "_key" && value !== "" && value !== undefined) out[key] = value;
        return out;
      });
      const payload = config.toInput ? config.toInput(values, cleanLines) : { ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")), ...(config.lines ? { [config.lines.key]: cleanLines } : {}) };
      if (editing && amend) return actOn(config.resource, id!, "amend", { ...payload, reason: amendReason.trim(), expectedVersion: existing?.version });
      if (editing) return updateRecord(config.resource, id!, { ...payload, expectedVersion: existing?.version });
      return createRecord(config.resource, payload);
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
      router.push(config.detailHref(record.id));
    },
    onError: (err) => setError(err instanceof ProcApiError ? err.message : "This could not be saved."),
  });

  function setLine(key: number, name: string, value: FieldValue) {
    setLines((current) =>
      current.map((line) => {
        if (line._key !== key) return line;
        const next = { ...line, [name]: value };
        // Picking an item pre-fills the description (still editable).
        if (name === "itemId") {
          const item = options.items.find((candidate) => candidate.id === value);
          if (item && !line.description) next.description = item.name;
        }
        return next;
      }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={amend ? `Amend ${config.noun}` : editing ? `Edit ${config.noun}` : `New ${config.noun}`}
        description={amend ? "An amendment is a versioned change; someone else must approve it before it takes effect." : editing ? "Only draft or rejected documents can be edited." : "Totals and the document number are set by the server when you save."}
        secondaryActions={
          <Button variant="secondary" onPress={() => router.push(editing ? config.detailHref(id!) : config.backHref)}>
            Cancel
          </Button>
        }
        primaryAction={
          <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={amend && !amendReason.trim()}>
            {amend ? "Submit amendment" : editing ? "Save changes" : `Save ${config.noun}`}
          </Button>
        }
      />
      {error && <ProcAlert>{error}</ProcAlert>}
      {amend && (
        <ProcPanel title="Reason for the amendment">
          <TextArea label="Reason" isRequired value={amendReason} onChange={setAmendReason} />
        </ProcPanel>
      )}
      <ProcPanel title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className={field.wide || field.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <FieldInput field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} options={options} />
            </div>
          ))}
        </div>
      </ProcPanel>
      {config.lines && (
        <ProcPanel
          title={config.lines.label}
          actions={
            <Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blankLine(config.lines!.fields)])}>
              <Plus className="size-3.5" aria-hidden="true" />
              {config.lines.addLabel}
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <div key={line._key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))_auto]">
                {config.lines!.fields.map((field) => (
                  <FieldInput key={field.name} field={field} value={line[field.name]} onChange={(value) => setLine(line._key, field.name, value)} options={options} ariaSuffix={String(index + 1)} />
                ))}
                <IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" isDisabled={lines.length <= (config.lines!.minimum ?? 1)} onPress={() => setLines((current) => current.filter((candidate) => candidate._key !== line._key))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>
        </ProcPanel>
      )}
    </div>
  );
}
