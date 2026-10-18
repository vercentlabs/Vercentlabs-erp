"use client";

// CRM › Data › Past notes and activities (CRM plan 5.7), with the guide for moving in from another tool. Choose a file, check how its
// columns are read, import: each row goes onto the lead, deal, contact or company it names, dated when it happened.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, LinkButton, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class HistoryError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(HistoryError, "body");
type Column = { key: string; label: string };
type Analysis = { headers: string[]; mapping: Record<string, string>; rowCount: number };
type Result = { created: number; notes: number; skipped: number; failed: number; errors: Array<{ row: number; message: string }> };

async function upload<T>(file: File, step: "analyze" | "import", mapping?: Record<string, string>) {
  const body = new FormData();
  body.set("file", file);
  body.set("step", step);
  if (mapping) body.set("mapping", JSON.stringify(mapping));
  const response = await fetch("/api/crm/history-import", { method: "POST", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message ?? json?.message ?? "The file could not be read.");
  return json as T;
}

export function HistoryImportScreen() {
  const workspace = useWorkspaceContext();
  const canImport = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.import");
  const info = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "history-import"), queryFn: () => request<{ columns: Column[]; sources: Array<{ key: string; label: string; howTo: string }> }>("/api/crm/history-import"), enabled: canImport });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const analyze = useMutation({
    mutationFn: (chosen: File) => upload<{ analysis: Analysis }>(chosen, "analyze"),
    onSuccess: ({ analysis: next }) => { setAnalysis(next); setMapping(next.mapping); setResult(null); },
  });
  const run = useMutation({ mutationFn: () => upload<{ result: Result }>(file!, "import", mapping), onSuccess: ({ result: next }) => setResult(next) });
  if (!canImport) return <PermissionState title="You can't import into CRM" description="Ask an administrator for the Import permission." />;
  const columns = info.data?.columns ?? [];
  const mapped = new Set(Object.values(mapping));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Past notes and activities" description="Bring the calls, emails, meetings and notes from your old tool onto the records already in CRM, dated when they happened."
        secondaryActions={<><LinkButton variant="outline" href="/api/crm/history-import?template=1" download>Template</LinkButton><LinkButton variant="ghost" href="/crm/data/import-export">Import records</LinkButton></>} />
      <section className="flex max-w-4xl flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm" aria-label="Moving in">
        <h2 className="font-semibold">Moving in from another tool</h2>
        <p className="text-text-secondary">Import companies, contacts, leads and deals first (Import records): their files from these tools map onto CRM&apos;s columns on their own. Then import past activities here.</p>
        <ul className="flex flex-col gap-1">
          {(info.data?.sources ?? []).map((source) => <li key={source.key}><span className="font-medium">{source.label}:</span> <span className="text-text-secondary">{source.howTo}</span></li>)}
        </ul>
      </section>
      <section className="flex max-w-4xl flex-col gap-3" aria-label="Import">
        <input type="file" accept=".csv,.xlsx" aria-label="Choose the file" onChange={(event) => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); if (chosen) analyze.mutate(chosen); }} />
        {analyze.isError && <Notice>{analyze.error instanceof Error ? analyze.error.message : "The file could not be read."}</Notice>}
        {analysis && (
          <>
            <p className="text-sm text-text-secondary">{analysis.rowCount} rows. Check how each column is read; Record and Date are needed.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {analysis.headers.map((header) => (
                <Select key={header} label={header} size="compact" selectedKey={mapping[header] ?? "skip"}
                  onSelectionChange={(next) => setMapping((current) => { const copy = { ...current }; if (String(next) === "skip") delete copy[header]; else copy[header] = String(next); return copy; })}
                  options={[{ value: "skip", label: "Not imported" }, ...columns.map((column) => ({ value: column.key, label: column.label }))]} />
              ))}
            </div>
            <div><Button variant="primary" isLoading={run.isPending} isDisabled={!mapped.has("record") || !mapped.has("date")} onPress={() => run.mutate()}>Import</Button></div>
          </>
        )}
        {run.isError && <Notice>{run.error instanceof Error ? run.error.message : "The import failed."}</Notice>}
        {result && (
          <Notice tone={result.failed ? "warning" : "info"}>
            {`${result.created} activities and ${result.notes} notes imported${result.skipped ? `, ${result.skipped} already there` : ""}${result.failed ? `, ${result.failed} rows not imported` : ""}.`}
            {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5">{result.errors.slice(0, 20).map((entry) => <li key={entry.row}>{`Row ${entry.row}: ${entry.message}`}</li>)}</ul>}
          </Notice>
        )}
      </section>
    </div>
  );
}
