"use client";

// Import prices into one price list: choose the file, match the columns,
// check it, then import. A row for a product and unit that already has a
// price from the same date changes it; other rows add a price.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, LinkButton, PageHeader, PermissionState, Select, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { analyzePriceImport, errorMessage, getPriceList, importPrices, priceExportUrl, priceImportTemplateUrl, type ImportAnalysis, type ImportResult, type ImportRow } from "../api/price-lists-api";

const SKIP = "skip-column";
const card = "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";
const OUTCOME: Record<ImportRow["outcome"], { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  added: { label: "Added", tone: "success" }, updated: { label: "Changed", tone: "info" }, unchanged: { label: "Unchanged", tone: "neutral" }, failed: { label: "Error", tone: "danger" },
};

export function PriceImportScreen({ priceListId }: { priceListId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", "list", priceListId), queryFn: () => getPriceList(priceListId) });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ result: ImportResult; errorFile: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzePriceImport(priceListId, chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setOutcome(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importPrices(priceListId, file!, { mapping, dryRun }),
    onSuccess: (data) => { setOutcome(data); setError(null); if (!data.result.dryRun) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "price-lists") }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  if (listQuery.isLoading) return <LoadingState label="Loading" rows={4} />;
  const list = listQuery.data;
  if (!list?.capabilities?.import || !list.capabilities.managePrices) return <PermissionState title="You cannot import prices" description="Ask an administrator for the Import prices permission." />;
  const mapped = new Set(Object.values(mapping));
  const ready = mapped.has("productCode") && mapped.has("unitPrice");
  const result = outcome?.result;
  const downloadErrors = () => {
    if (!outcome?.errorFile) return;
    const url = URL.createObjectURL(new Blob([outcome.errorFile], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "price-import-rows-to-fix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Import prices: ${list.name}`} description={`Prices are in ${list.currencyCode}, ${list.taxInclusive ? "including" : "excluding"} tax. Each row is checked like a price entered by hand.`}
        secondaryActions={<LinkButton href={`/sales/price-lists/${list.id}`} variant="outline">Back to the price list</LinkButton>} />
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <section className={card} aria-label="File">
        <h2 className="text-base font-semibold">1. Choose the file</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx" aria-label="Price file" className="text-sm" onChange={(event) => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); setAnalysis(null); setOutcome(null); if (chosen) analyze.mutate(chosen); }} />
          <a className={buttonVariants({ variant: "outline", size: "compact" })} href={priceImportTemplateUrl} download><Download className="size-4" aria-hidden="true" />Template</a>
          {list.capabilities.export && <a className={buttonVariants({ variant: "outline", size: "compact" })} href={priceExportUrl(list.id)} download><Download className="size-4" aria-hidden="true" />Current prices</a>}
        </div>
        <p className="text-xs text-text-muted">Columns: Product Code (or SKU), UOM (the base unit when empty), Unit Price, Valid From and Valid Until (optional, YYYY-MM-DD or DD/MM/YYYY). Export the current prices, edit them, and import the file back.</p>
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
          {!ready && <p role="alert" className="text-sm text-danger">Choose which columns hold the Product Code and the Unit Price.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" isDisabled={!ready || run.isPending} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check the file</Button>
            <Button variant="primary" isDisabled={!ready || run.isPending} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import prices</Button>
          </div>
        </section>
      )}
      {result && (
        <section className={card} aria-label="Result">
          <h2 className="text-base font-semibold">{result.dryRun ? "3. Check result (nothing was saved)" : "3. Import result"}</h2>
          <p role="status" className="text-sm">{result.total} rows: {result.added} {result.dryRun ? "would be added" : "added"}, {result.updated} {result.dryRun ? "would change" : "changed"}, {result.unchanged} unchanged, {result.failed} with errors.</p>
          {outcome?.errorFile && <div><Button variant="secondary" size="compact" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download rows to fix</Button></div>}
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Row", "Product / Unit", "Result", "Details"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {result.results.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-3 py-2 tabular-nums">{row.rowNumber}</td>
                    <th scope="row" className="px-3 py-2 font-medium">{row.name ?? ""}</th>
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
