"use client";

// One import of the shared set (Settings › Bring your data): choose the file, confirm which column is which, check it, then import.
// Every row is checked by its app exactly like a record typed in by hand, and says what happened.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, ErrorState, LinkButton, PageHeader, Select, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";

type Field = { key: string; label: string; required: boolean };
type Importer = { key: string; label: string; description: string; groupBy: string | null; fields: Field[] };
type Analysis = { fileName: string; headers: string[]; rowCount: number; sampleRows: Record<string, string>[]; suggestedMapping: Record<string, string>; fields: Field[] };
type Result = {
  dryRun: boolean; total: number; created: number; duplicates: number; failed: number;
  results: Array<{ rows: number[]; label: string | null; outcome: "created" | "duplicate" | "failed"; reference?: string | null; message: string }>;
};

const SKIP = "skip-column";
const card = "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";
const OUTCOME = { created: { label: "Created", tone: "success" }, duplicate: { label: "Already there", tone: "warning" }, failed: { label: "Error", tone: "danger" } } as const;

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function SharedImportScreen({ importerKey }: { importerKey: string }) {
  const list = useQuery({ queryKey: ["imports"], queryFn: () => send<{ importers: Importer[] }>("/api/imports") });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/imports/${encodeURIComponent(importerKey)}`;

  const analyze = useMutation({
    mutationFn: (chosen: File) => { const form = new FormData(); form.set("file", chosen); return send<{ analysis: Analysis }>(`${base}/analyze`, { method: "POST", body: form }); },
    onSuccess: (data) => { setAnalysis(data.analysis); setMapping(data.analysis.suggestedMapping); setResult(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError((failure as Error).message); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => {
      const form = new FormData();
      form.set("file", file!);
      form.set("mapping", JSON.stringify(mapping));
      form.set("dryRun", String(dryRun));
      return send<{ result: Result }>(base, { method: "POST", body: form });
    },
    onSuccess: (data) => { setResult(data.result); setError(null); },
    onError: (failure) => setError((failure as Error).message),
  });

  if (list.isLoading) return <LoadingState label="Loading" rows={4} />;
  const importer = list.data?.importers.find((entry) => entry.key === importerKey);
  if (list.isError || !importer)
    return <ErrorState title="This import is not available" description="The app is off for your company, or you do not have the permission it needs." action={{ label: "Back", onPress: () => history.back() }} />;

  const choose = (chosen: File | null) => { setFile(chosen); setAnalysis(null); setResult(null); if (chosen) analyze.mutate(chosen); };
  const mapped = new Set(Object.values(mapping));
  const missing = importer.fields.filter((field) => field.required && !mapped.has(field.key));
  const downloadErrors = () => {
    if (!result) return;
    const rows = [["Rows", "Record", "Result", "Reason"], ...result.results.filter((row) => row.outcome !== "created").map((row) => [row.rows.join(" "), row.label ?? "", row.outcome, row.message])];
    const url = URL.createObjectURL(new Blob([`﻿${rows.map((row) => row.map((value) => cell(String(value))).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${importer.key}-rows-to-fix.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title={`Import ${importer.label.toLowerCase()}`} description={importer.description}
        secondaryActions={<LinkButton href="/settings/data-import" variant="outline">Back to Bring your data</LinkButton>} />
      {error && <Notice>{error}</Notice>}

      <section className={card} aria-label="File">
        <h2 className="text-base font-semibold">1. Choose the file</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx" aria-label={`File of ${importer.label.toLowerCase()}`} className="text-sm" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          <a className={buttonVariants({ variant: "outline", size: "compact" })} href={`${base}/template`} download><Download className="size-4" aria-hidden="true" />Download template</a>
        </div>
        <p className="text-xs text-text-muted">
          CSV (saved from Excel is fine) or Excel, up to 5,000 rows and 5 MB. Required: {importer.fields.filter((field) => field.required).map((field) => field.label).join(", ")}.
          {importer.groupBy && ` Rows with the same ${importer.fields.find((field) => field.key === importer.groupBy)?.label} become one record.`}
        </p>
        {analyze.isPending && <LoadingState label="Reading the file" rows={2} />}
      </section>

      {analysis && (
        <section className={card} aria-label="Columns">
          <h2 className="text-base font-semibold">2. Match the columns</h2>
          <p className="text-sm text-text-secondary">{analysis.rowCount} {analysis.rowCount === 1 ? "row" : "rows"} in {analysis.fileName}. Columns set to “Do not import” are ignored.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.headers.map((header) => (
              <Select key={header} label={header} description={analysis.sampleRows[0]?.[header] ? `e.g. ${analysis.sampleRows[0][header]}` : undefined} selectedKey={mapping[header] ?? SKIP}
                onSelectionChange={(selected) => {
                  const next = { ...mapping };
                  if (String(selected) === SKIP) delete next[header]; else next[header] = String(selected);
                  setMapping(next);
                  setResult(null);
                }}
                options={[{ value: SKIP, label: "Do not import" }, ...analysis.fields.map((field) => ({ value: field.key, label: `${field.label}${field.required ? " *" : ""}`, isDisabled: mapped.has(field.key) && mapping[header] !== field.key }))]} />
            ))}
          </div>
          {missing.length > 0 && <p role="alert" className="text-sm text-danger">Choose the column for {missing.map((field) => field.label).join(", ")}.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" isDisabled={missing.length > 0 || run.isPending} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check the file</Button>
            <Button variant="primary" isDisabled={missing.length > 0 || run.isPending} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import</Button>
          </div>
        </section>
      )}

      {result && (
        <section className={card} aria-label="Result">
          <h2 className="text-base font-semibold">{result.dryRun ? "3. Check result (nothing was saved)" : "3. Import result"}</h2>
          <p role="status" className="text-sm">
            {result.total} {result.total === 1 ? "record" : "records"}: {result.created} {result.dryRun ? "ready to import" : "created"}, {result.duplicates} already there, {result.failed} with errors.
          </p>
          {result.duplicates + result.failed > 0 && (
            <div><Button variant="secondary" size="compact" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download rows to fix</Button></div>
          )}
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Row", "Record", "Result", "Details"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {result.results.map((row) => (
                  <tr key={row.rows.join("-")}>
                    <td className="px-3 py-2 tabular-nums">{row.rows.length > 1 ? `${row.rows[0]}–${row.rows.at(-1)}` : row.rows[0]}</td>
                    <th scope="row" className="px-3 py-2 font-medium">{row.label ?? "—"}</th>
                    <td className="px-3 py-2"><Badge tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</Badge></td>
                    <td className="px-3 py-2 text-text-secondary">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
