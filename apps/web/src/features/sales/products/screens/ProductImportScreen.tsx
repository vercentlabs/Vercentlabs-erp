"use client";

// Import products and services from a CSV or Excel file: choose the file,
// confirm the columns, check it, then import. Category, unit and tax
// category are matched to existing records; rows that fail are listed with
// the reason and can be downloaded to fix.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, LinkButton, PageHeader, PermissionState, Select, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { analyzeProductImport, errorMessage, getProductOptions, importProducts, productImportTemplateUrl, type ImportAnalysis, type ImportResult, type ImportRow } from "../api/products-api";
import { ErrorBanner } from "../product-format";

const SKIP = "skip-column";
const card = "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";
const OUTCOME: Record<ImportRow["outcome"], { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  created: { label: "Created", tone: "success" }, updated: { label: "Updated", tone: "info" }, skipped: { label: "Skipped", tone: "neutral" }, failed: { label: "Error", tone: "danger" },
};

export function ProductImportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getProductOptions, staleTime: 60_000 });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState("skip");
  const [outcome, setOutcome] = useState<{ result: ImportResult; errorFile: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzeProductImport(chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setOutcome(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importProducts(file!, { mapping, existing, dryRun }),
    onSuccess: (data) => { setOutcome(data); setError(null); if (!data.result.dryRun) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  if (optionsQuery.isLoading) return <LoadingState label="Loading" rows={4} />;
  const can = optionsQuery.data?.capabilities;
  if (!can?.import || !can.create) return <PermissionState title="You cannot import products" description="Ask an administrator for the Import products permission." />;

  const mapped = new Set(Object.values(mapping));
  const ready = mapped.has("name") && mapped.has("baseUom");
  const result = outcome?.result;
  const downloadErrors = () => {
    if (!outcome?.errorFile) return;
    const url = URL.createObjectURL(new Blob([outcome.errorFile], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "product-import-rows-to-fix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Import products and services" description="Each row is checked exactly like one entered by hand. Nothing is created from a misspelt category, unit or tax category."
        secondaryActions={<LinkButton href="/sales/products" variant="outline">Back to products</LinkButton>} />
      <ErrorBanner message={error} />
      <section className={card} aria-label="File">
        <h2 className="text-base font-semibold">1. Choose the file</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx" aria-label="Product file" className="text-sm" onChange={(event) => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); setAnalysis(null); setOutcome(null); if (chosen) analyze.mutate(chosen); }} />
          <a className={buttonVariants({ variant: "outline", size: "compact" })} href={productImportTemplateUrl} download><Download className="size-4" aria-hidden="true" />Download template</a>
        </div>
        <p className="text-xs text-text-muted">Up to 5,000 rows. Name and UOM are required. Give HSN for goods and SAC for services. Flags are Yes or No. Cost columns need the Edit Cost permission.</p>
        {analyze.isPending && <LoadingState label="Reading the file" rows={2} />}
      </section>
      {analysis && (
        <section className={card} aria-label="Columns">
          <h2 className="text-base font-semibold">2. Match the columns</h2>
          <p className="text-sm text-text-secondary">{analysis.rowCount} {analysis.rowCount === 1 ? "row" : "rows"} in {analysis.fileName}.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.headers.map((header) => (
              <Select key={header} label={header} description={analysis.sampleRows[0]?.[header] ? `e.g. ${analysis.sampleRows[0][header]}` : undefined} selectedKey={mapping[header] ?? SKIP}
                onSelectionChange={(key) => { const next = { ...mapping }; if (String(key) === SKIP) delete next[header]; else next[header] = String(key); setMapping(next); setOutcome(null); }}
                options={[{ value: SKIP, label: "Do not import" }, ...analysis.fields.map((field) => ({ value: field.key, label: field.label, isDisabled: mapped.has(field.key) && mapping[header] !== field.key }))]} />
            ))}
          </div>
          {!ready && <p role="alert" className="text-sm text-danger">Choose which columns hold the Name and the UOM.</p>}
          <Select className="sm:max-w-lg" label="When a row's code already exists" selectedKey={existing} onSelectionChange={(key) => { setExisting(String(key)); setOutcome(null); }}
            options={[{ value: "skip", label: "Skip the row" }, ...(can.edit ? [{ value: "update", label: "Update the existing product from the row" }] : [])]} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" isDisabled={!ready || run.isPending} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check the file</Button>
            <Button variant="primary" isDisabled={!ready || run.isPending} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import</Button>
          </div>
        </section>
      )}
      {result && (
        <section className={card} aria-label="Result">
          <h2 className="text-base font-semibold">{result.dryRun ? "3. Check result (nothing was saved)" : "3. Import result"}</h2>
          <p role="status" className="text-sm">{result.total} rows: {result.created} {result.dryRun ? "would be created" : "created"}, {result.updated} {result.dryRun ? "would be updated" : "updated"}, {result.skipped} skipped, {result.failed} with errors.</p>
          {outcome?.errorFile && <div><Button variant="secondary" size="compact" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download rows to fix</Button></div>}
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-secondary"><tr>{["Row", "Name", "Result", "Details"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {result.results.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-3 py-2 tabular-nums">{row.rowNumber}</td>
                    <th scope="row" className="px-3 py-2 font-medium">{row.name ?? "(no name)"}</th>
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
