"use client";

// CRM › Setup › Past notes and activities (CRM plan 5.7), with the guide for moving in from another tool. Choose a file, check how its
// columns are read, import: each row goes onto the lead, deal, contact or company it names, dated when it happened.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { Button, LinkButton, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class HistoryError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(HistoryError, "body");
type Column = { key: string; label: string };
type Source = { key: string; label: string; howTo: string; activities: string };
type Analysis = { headers: string[]; mapping: Record<string, string>; rowCount: number };
type Result = { created: number; notes: number; skipped: number; failed: number; errors: Array<{ row: number; message: string }> };

// What each column of a row means (the template's columns).
const COLUMN_HELP: Record<string, string> = {
  record: "The lead or deal number (LEAD-000012), a contact's email, or a company's name.",
  type: "Call, email, meeting, visit, demo, WhatsApp, SMS, note or other.",
  date: "When it happened: 2025-11-04 15:30 or 04/11/2025.",
  subject: "A few words on what it was about.",
  details: "The notes, as long as needed.",
  outcome: "How it went, e.g. Interested.",
  by: "The email of the person in your team who did it.",
};
const REQUIRED = new Set(["record", "date"]);

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
  const info = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "history-import"), queryFn: () => request<{ columns: Column[]; sources: Source[] }>("/api/crm/history-import"), enabled: canImport });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [tool, setTool] = useState("zoho");
  const analyze = useMutation({
    mutationFn: (chosen: File) => upload<{ analysis: Analysis }>(chosen, "analyze"),
    onSuccess: ({ analysis: next }) => { setAnalysis(next); setMapping(next.mapping); setResult(null); },
  });
  const run = useMutation({ mutationFn: () => upload<{ result: Result }>(file!, "import", mapping), onSuccess: ({ result: next }) => setResult(next) });
  if (!canImport) return <PermissionState title="You can't import into CRM" description="Ask an administrator for the Import permission." />;
  const columns = info.data?.columns ?? [];
  const sources = info.data?.sources ?? [];
  const source = sources.find((entry) => entry.key === tool) ?? sources[0];
  const mapped = new Set(Object.values(mapping));
  const missing = [...REQUIRED].filter((key) => !mapped.has(key)).map((key) => columns.find((column) => column.key === key)?.label ?? key);
  const choose = (chosen: File | null) => { setFile(chosen); setAnalysis(null); setResult(null); if (chosen) analyze.mutate(chosen); };

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Past notes and activities" description="Bring the calls, emails, meetings and notes from your old tool onto the records already in CRM, dated when they happened."
        secondaryActions={<LinkButton variant="outline" href="/api/crm/history-import?template=1" download><Download className="size-4" aria-hidden="true" />Download template</LinkButton>} />

      {/* The order to work in. */}
      <ol className="grid gap-2 sm:grid-cols-3">
        {[
          { title: "Import your records", text: "Companies, contacts, leads and deals first.", href: "/crm/data/import-export", link: "Import records" },
          { title: "Export the activities", text: "From your old tool, or fill our template." },
          { title: "Upload the file here", text: "Check the columns, then import." },
        ].map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">{index + 1}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-text">{step.title}</span>
              <span className="text-text-secondary">{step.text}{step.href && <> <a href={step.href} className="font-medium text-brand hover:underline">{step.link}</a></>}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Desktop: the upload on the left, the guide for the old tool on the right. Tablet and phone: the upload first. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6">
        <section aria-labelledby="upload-heading" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5">
          <h2 id="upload-heading" className="text-base font-semibold text-text">Upload the file</h2>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface-muted px-4 py-8 text-center text-sm hover:border-brand focus-within:ring-2 focus-within:ring-brand">
            <FileUp className="size-6 text-text-muted" aria-hidden="true" />
            <span className="font-medium text-text">{file ? file.name : "Choose a CSV or Excel file"}</span>
            <span className="text-xs text-text-secondary">{file ? "Choose another file to replace it." : "One row per call, meeting, email or note. .csv or .xlsx"}</span>
            <input type="file" accept=".csv,.xlsx" className="sr-only" aria-label="Choose the file" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          </label>
          {analyze.isPending && <p className="text-sm text-text-secondary" role="status">Reading the file…</p>}
          {analyze.isError && <Notice>{analyze.error instanceof Error ? analyze.error.message : "The file could not be read."}</Notice>}

          {analysis && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-text">Check the columns</h3>
                <span className="text-xs text-text-secondary">{`${analysis.rowCount} ${analysis.rowCount === 1 ? "row" : "rows"} · Record and Date are needed`}</span>
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
                {analysis.headers.map((header) => (
                  <li key={header} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
                    <span className="min-w-0 truncate text-sm text-text" title={header}>{header}</span>
                    <Select aria-label={`What "${header}" is`} size="compact" selectedKey={mapping[header] ?? "skip"}
                      onSelectionChange={(next) => setMapping((current) => { const copy = { ...current }; if (String(next) === "skip") delete copy[header]; else copy[header] = String(next); return copy; })}
                      options={[{ value: "skip", label: "Not imported" }, ...columns.map((column) => ({ value: column.key, label: `${column.label}${REQUIRED.has(column.key) ? " (needed)" : ""}` }))]} />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {missing.length > 0 && <span className="text-sm text-warning">{`Choose the column for ${missing.join(" and ")}.`}</span>}
                <Button variant="primary" isLoading={run.isPending} isDisabled={missing.length > 0} onPress={() => run.mutate()}>{`Import ${analysis.rowCount} ${analysis.rowCount === 1 ? "row" : "rows"}`}</Button>
              </div>
            </div>
          )}
          {run.isError && <Notice>{run.error instanceof Error ? run.error.message : "The import failed."}</Notice>}
          {result && (
            <Notice tone={result.failed ? "warning" : "info"}>
              {`${result.created} activities and ${result.notes} notes imported${result.skipped ? `, ${result.skipped} already there` : ""}${result.failed ? `, ${result.failed} rows not imported` : ""}.`}
              {result.errors.length > 0 && <ul className="mt-2 list-disc pl-5">{result.errors.slice(0, 20).map((entry) => <li key={entry.row}>{`Row ${entry.row}: ${entry.message}`}</li>)}</ul>}
            </Notice>
          )}

          <details className="group border-t border-border pt-4 text-sm">
            <summary className="cursor-pointer font-medium text-text">What each column means</summary>
            <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
              {columns.map((column) => (
                <div key={column.key} className="contents">
                  <dt className="font-medium text-text">{column.label}{REQUIRED.has(column.key) && <span className="text-danger"> *</span>}</dt>
                  <dd className="text-text-secondary max-sm:mb-1">{COLUMN_HELP[column.key] ?? ""}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>

        <section aria-labelledby="guide-heading" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5">
          <h2 id="guide-heading" className="text-base font-semibold text-text">Moving in from another tool</h2>
          <Select label="Your old tool" selectedKey={source?.key ?? tool} onSelectionChange={(key) => setTool(String(key))}
            options={sources.map((entry) => ({ value: entry.key, label: entry.label }))} />
          {source && (
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">Records (step 1)</dt>
                <dd className="text-text">{source.howTo}</dd>
              </div>
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">Past activities and notes (step 2)</dt>
                <dd className="text-text">{source.activities}</dd>
              </div>
            </dl>
          )}
          <p className="border-t border-border pt-3 text-xs text-text-muted">Their usual column names are read on their own; you can change any on the left before importing.</p>
        </section>
      </div>
    </div>
  );
}
