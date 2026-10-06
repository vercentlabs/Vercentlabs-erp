"use client";

// Import suppliers from a CSV or Excel file: choose the file, confirm which
// column is which and the defaults for rows that leave something out, check
// it, then import. Every row is checked like a supplier typed in by hand,
// duplicates included; each row says what happened.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, LinkButton, PageHeader, PermissionState, Select, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert } from "@/features/procurement/shared/ProcUi";

import { analyzeImport, errorMessage, getSupplierOptions, runImport, templateUrl, type ImportAnalysis, type ImportResult } from "../api/suppliers-api";

const SKIP = "skip-column";
const NONE = "none";
const card = "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";
const OUTCOME: Record<ImportResult["results"][number]["outcome"], { label: string; tone: "success" | "warning" | "danger" }> = {
  created: { label: "Created", tone: "success" }, duplicate: { label: "Duplicate", tone: "warning" }, failed: { label: "Error", tone: "danger" },
};

export function SupplierImportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, staleTime: 60_000 });
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [paymentTermId, setPaymentTermId] = useState(NONE);
  const [category, setCategory] = useState(NONE);
  const [outcome, setOutcome] = useState<{ result: ImportResult; errorFile: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = optionsQuery.data;

  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzeImport(chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setOutcome(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => runImport(file!, {
      mapping, dryRun, countryCode: options?.countryCode, currency: options?.baseCurrency ?? undefined,
      paymentTermId: paymentTermId === NONE ? undefined : paymentTermId, category: category === NONE ? undefined : category,
    }),
    onSuccess: (data) => {
      setOutcome(data);
      setError(null);
      if (!data.result.dryRun) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement", "suppliers") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (optionsQuery.isLoading) return <LoadingState label="Loading" rows={4} />;
  if (!options?.capabilities.import || !options.capabilities.create)
    return <PermissionState title="You cannot import suppliers" description="Ask an administrator for the Import suppliers and Create suppliers permissions." />;

  const choose = (chosen: File | null) => { setFile(chosen); setAnalysis(null); setOutcome(null); if (chosen) analyze.mutate(chosen); };
  const mapped = new Set(Object.values(mapping));
  const result = outcome?.result;
  const downloadErrors = () => {
    if (!outcome?.errorFile) return;
    const url = URL.createObjectURL(new Blob([outcome.errorFile], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "supplier-import-rows-to-fix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Import suppliers" description="Upload a CSV or Excel file of your existing suppliers."
        secondaryActions={<LinkButton href="/procurement/suppliers" variant="outline">Back to suppliers</LinkButton>} />
      {error && <ProcAlert>{error}</ProcAlert>}

      <section className={card} aria-label="File">
        <h2 className="text-base font-semibold">1. Choose the file</h2>
        <p className="text-sm text-text-secondary">Each row becomes a supplier, checked exactly like one typed in by hand: a GSTIN that already belongs to a supplier, or the same name, is reported and not imported.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,.xlsx" aria-label="File of suppliers" className="text-sm" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          <a className={buttonVariants({ variant: "outline", size: "compact" })} href={templateUrl} download><Download className="size-4" aria-hidden="true" />Download template</a>
        </div>
        <p className="text-xs text-text-muted">Up to 2,000 rows and 5 MB. Supplier Name is required. Rows without a country or currency use {options.countryCode} and {options.baseCurrency}.</p>
        {analyze.isPending && <LoadingState label="Reading the file" rows={2} />}
      </section>

      {analysis && (
        <section className={card} aria-label="Columns">
          <h2 className="text-base font-semibold">2. Match the columns</h2>
          <p className="text-sm text-text-secondary">{analysis.rowCount} {analysis.rowCount === 1 ? "row" : "rows"} in {analysis.fileName}. Columns set to “Do not import” are ignored.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.headers.map((header) => (
              <Select key={header} label={header} description={analysis.sampleRows[0]?.[header] ? `e.g. ${analysis.sampleRows[0][header]}` : undefined} selectedKey={mapping[header] ?? SKIP}
                onSelectionChange={(key) => {
                  const next = { ...mapping };
                  if (String(key) === SKIP) delete next[header]; else next[header] = String(key);
                  setMapping(next);
                  setOutcome(null);
                }}
                options={[{ value: SKIP, label: "Do not import" }, ...analysis.fields.map((field) => ({ value: field.key, label: field.label, isDisabled: mapped.has(field.key) && mapping[header] !== field.key }))]} />
            ))}
          </div>
          {!mapped.has("supplierName") && <p role="alert" className="text-sm text-danger">Choose which column holds the Supplier Name.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Payment terms for rows without them" selectedKey={paymentTermId} onSelectionChange={(key) => { setPaymentTermId(String(key)); setOutcome(null); }}
              options={[{ value: NONE, label: "None: such rows are reported" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
            <Select label="Category for rows without one" selectedKey={category} onSelectionChange={(key) => { setCategory(String(key)); setOutcome(null); }}
              options={[{ value: NONE, label: "None: such rows are reported" }, ...options.categories.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" isDisabled={!mapped.has("supplierName") || run.isPending} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check the file</Button>
            <Button variant="primary" isDisabled={!mapped.has("supplierName") || run.isPending} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import suppliers</Button>
          </div>
        </section>
      )}

      {result && (
        <section className={card} aria-label="Result">
          <h2 className="text-base font-semibold">{result.dryRun ? "3. Check result (nothing was saved)" : result.created === 0 ? "3. No suppliers were imported" : "3. Import result"}</h2>
          <p role="status" className="text-sm">
            {result.total} {result.total === 1 ? "row" : "rows"}: {result.created} {result.dryRun ? "ready to import" : "created"}, {result.duplicates} duplicates, {result.failed} with errors.
          </p>
          <div className="flex flex-wrap gap-2">
            {outcome?.errorFile && <Button variant="secondary" size="compact" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download rows to fix</Button>}
            {!result.dryRun && result.created > 0 && <LinkButton href="/procurement/suppliers" variant="secondary" size="compact">View suppliers</LinkButton>}
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-secondary"><tr>{["Row", "Supplier", "Result", "Details"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
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
