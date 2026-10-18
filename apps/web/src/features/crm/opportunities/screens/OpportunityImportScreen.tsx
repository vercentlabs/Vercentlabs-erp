"use client";

// Import deals from a CSV or XLSX file (CRM plan 2.5) in three steps: choose the file, map its columns, then import. Each row becomes a
// deal exactly as one typed in by hand; a row marked Won or Lost is closed with its reason and date, so the win/loss figures count it.
// The company is found by its number or name (or created, if asked). Failed rows come back as a file to fix. A file with more rows than
// an import takes at once runs in the background.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button, Checkbox, LinkButton, PermissionState, Select, buttonVariants } from "@vercentlabs/design-system";

import { BackgroundRunsPanel, QueuedImportNotice, useBackgroundImport } from "@/features/crm/shared/ui/BackgroundRunsPanel";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  analyzeOpportunityImport, errorMessage, getOpportunityOptions, importOpportunities, opportunityImportTemplateUrl,
  type OpportunityImportAnalysis, type OpportunityImportResult,
} from "../api/opportunities-api";
import { ErrorBanner } from "../opportunity-format";

const SKIP = "__skip__";
const NONE = "__none__";

export function OpportunityImportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<OpportunityImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [createMissingCompanies, setCreateMissingCompanies] = useState(false);
  const [defaultOwnerUserId, setDefaultOwnerUserId] = useState(NONE);
  const [result, setResult] = useState<OpportunityImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzeOpportunityImport(chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setResult(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const importOptions = () => ({
    mapping,
    createMissingCompanies,
    defaultOwnerUserId: defaultOwnerUserId === NONE ? undefined : defaultOwnerUserId,
  });
  const run = useMutation({
    mutationFn: () => importOpportunities(file as File, importOptions()),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const background = useBackgroundImport("opportunities", (failure) => setError(errorMessage(failure)));

  if (optionsQuery.isLoading) return <LoadingState label="Loading" />;
  if (options && !(options.capabilities.import && options.capabilities.create))
    return <PermissionState title="You can't import deals" description="Ask an administrator for the Import deals and Create deals permissions." />;

  const chooseFile = (chosen: File | null) => {
    setFile(chosen);
    setAnalysis(null);
    setResult(null);
    background.reset();
    if (chosen) analyze.mutate(chosen);
  };
  const mappedFields = new Set(Object.values(mapping));
  const ready = mappedFields.has("name") && mappedFields.has("company");
  const downloadErrors = () => {
    if (!result?.errorCsv) return;
    const url = URL.createObjectURL(new Blob([result.errorCsv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "deal-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Bring in deals from a CSV or Excel (.xlsx) file, up to 2,000 rows at once, or up to 20,000 in the background. Each deal needs a name and
          its company; a Status of Won or Lost, with the day it closed and the reason, brings in a closed deal.
        </p>
        <a className={buttonVariants({ variant: "outline" })} href={opportunityImportTemplateUrl} download>
          <Download className="size-4" aria-hidden="true" />Download template
        </a>
      </div>
      <ErrorBanner message={error} />

      <Step number={1} title="Choose the file">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface-muted px-6 py-8 text-center text-sm">
          <Upload className="size-6 text-text-muted" aria-hidden="true" />
          <span className="font-medium">{file ? file.name : "Select a .csv or .xlsx file"}</span>
          <span className="text-text-secondary">The first row must contain the column names. Use the template for the expected columns.</span>
          <input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
        </label>
        {analyze.isPending && <LoadingState label="Reading the file" rows={2} />}
      </Step>

      {analysis && (
        <Step number={2} title={`Map the columns (${analysis.rowCount} ${analysis.rowCount === 1 ? "row" : "rows"} found)`}>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary">
                <tr><th className="px-3 py-2 font-medium">Column in your file</th><th className="px-3 py-2 font-medium">Example</th><th className="px-3 py-2 font-medium">Deal field</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analysis.headers.map((header) => (
                  <tr key={header}>
                    <td className="px-3 py-2 font-medium">{header}</td>
                    <td className="px-3 py-2 text-text-secondary">{analysis.sampleRows.find((row) => row[header])?.[header] ?? ""}</td>
                    <td className="px-3 py-2">
                      <Select
                        aria-label={`Deal field for ${header}`}
                        size="compact"
                        selectedKey={mapping[header] ?? SKIP}
                        onSelectionChange={(key) => {
                          const next = { ...mapping };
                          if (String(key) === SKIP) delete next[header];
                          else next[header] = String(key);
                          setMapping(next);
                        }}
                        options={[
                          { value: SKIP, label: "Do not import" },
                          ...analysis.fields.map((field) => ({ value: field.key, label: field.label, isDisabled: mappedFields.has(field.key) && mapping[header] !== field.key })),
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ready && <ErrorBanner message="Map the Deal Name and Company columns." />}
        </Step>
      )}

      {analysis && options && (
        <Step number={3} title="Import options">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Deal owner" description="Used for rows that have no owner email." selectedKey={defaultOwnerUserId}
              onSelectionChange={(key) => setDefaultOwnerUserId(String(key))}
              options={[{ value: NONE, label: "Me" }, ...options.users.filter((user) => options.capabilities.assign || user.id === options.currentUserId).map((user) => ({ value: user.id, label: user.name }))]} />
          </div>
          <Checkbox isSelected={createMissingCompanies} onChange={setCreateMissingCompanies}>
            Create a company that does not exist yet (otherwise the row is not imported)
          </Checkbox>
          <div>
            <Button variant="primary" onPress={() => (analysis.rowCount > background.limit ? background.queue.mutate({ file: file as File, ...importOptions() }) : run.mutate())}
              isLoading={run.isPending || background.queue.isPending} isDisabled={!ready || !file || Boolean(background.queued)}>
              Import {analysis.rowCount} {analysis.rowCount === 1 ? "row" : "rows"}{analysis.rowCount > background.limit ? " in the background" : ""}
            </Button>
          </div>
        </Step>
      )}

      <QueuedImportNotice job={background.queued} />
      <BackgroundRunsPanel entity="opportunities" />

      {result && (
        <section aria-live="polite" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-base font-semibold">Import finished</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Count label="Rows read" value={result.total} />
            <Count label="Deals created" value={result.created} />
            <Count label="Of which won / lost" value={`${result.won} / ${result.lost}`} />
            <Count label="Rows failed" value={result.failed} />
          </dl>
          {result.errors.length > 0 && (
            <>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {result.errors.map((entry) => <li key={entry.row}><span className="font-medium">Row {entry.row}:</span> {entry.message}</li>)}
              </ul>
              <div><Button variant="outline" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download failed rows</Button></div>
            </>
          )}
          <div><LinkButton variant="primary" href="/crm/opportunities">View deals</LinkButton></div>
        </section>
      )}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold"><span className="text-text-muted">{number}.</span> {title}</h2>
      {children}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
