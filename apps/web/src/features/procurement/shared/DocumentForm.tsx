"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { createRecord, getOptions, getRecord, updateRecord, type ProcOptions, type ProcRecord } from "@/features/procurement/shared/api";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/procurement/shared/FieldInput";
import { useSubmitKey } from "@/shared/http/submit-once";
import { Notice, Panel } from "@/shared/ui/Panel";

// A simple Procurement configuration record (a supplier category, a policy):
// a few fields, created or edited as a whole. The server validates every field.
export type FormConfig = {
  resource: string;
  noun: string;
  backHref: string;
  detailHref: (id: string) => string;
  fields: FieldDef[];
};

export function DocumentForm({ config, id }: { config: FormConfig; id?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "options"), queryFn: getOptions });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", config.resource, id), queryFn: () => getRecord(config.resource, id!), enabled: Boolean(id) });
  if (options.isLoading || (id && existing.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (options.isError || !options.data) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => options.refetch() }} />;
  if (id && (existing.isError || !existing.data))
    return <ErrorState title={`Could not load this ${config.noun}`} action={{ label: "Retry", onPress: () => existing.refetch() }} />;
  return <FormBody key={id ?? "new"} config={config} id={id} existing={existing.data ?? null} options={options.data} />;
}

function FormBody({ config, id, existing, options }: { config: FormConfig; id?: string; existing: ProcRecord | null; options: ProcOptions }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, FieldValue>>(() => Object.fromEntries(config.fields.map((field) => {
    const stored = existing?.[field.name];
    return [field.name, stored !== undefined && stored !== null ? (typeof stored === "number" ? stored : String(stored)) : field.defaultValue ?? (field.kind === "number" ? 0 : "")];
  })));
  const [error, setError] = useState<string | null>(null);
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const payload = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
      return id ? updateRecord(config.resource, id, { ...payload, expectedVersion: existing?.version }) : createRecord(config.resource, payload);
    }),
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
      router.push(config.detailHref(record.id));
    },
    onError: (err) => setError(err instanceof ProcApiError ? err.message : "This could not be saved."),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={id ? `Edit ${config.noun}` : `New ${config.noun}`}
        secondaryActions={<Button variant="secondary" onPress={() => router.push(config.backHref)}>Cancel</Button>}
        primaryAction={<Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending || save.isSuccess}>{id ? "Save changes" : `Save ${config.noun}`}</Button>} />
      {error && <Notice>{error}</Notice>}
      <Panel title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className={field.wide || field.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <FieldInput field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} options={options} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
