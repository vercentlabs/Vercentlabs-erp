"use client";

// Import contacts from a CSV or XLSX file in three steps: choose the file,
// map its columns, then import. The server validates every row, matches the
// Company column against existing accounts, skips duplicate people (unless
// told otherwise) and returns the rows that failed as a file to fix.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button, Checkbox, LinkButton, PageHeader, PermissionState, Select, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  analyzeContactImport, contactImportTemplateUrl, errorMessage, getContactOptions, importContacts, type ContactImportAnalysis, type ContactImportResult,
} from "../api/contacts-api";
import { ErrorBanner } from "../contact-format";

const SKIP = "__skip__";
const NONE = "__none__";

export function ContactImportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact-options"), queryFn: getContactOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ContactImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultSourceId, setDefaultSourceId] = useState(NONE);
  const [defaultOwnerUserId, setDefaultOwnerUserId] = useState(NONE);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<ContactImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzeContactImport(chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setResult(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const run = useMutation({
    mutationFn: () => importContacts(file as File, {
      mapping,
      defaultSourceId: defaultSourceId === NONE ? undefined : defaultSourceId,
      defaultOwnerUserId: defaultOwnerUserId === NONE ? undefined : defaultOwnerUserId,
      skipDuplicates,
    }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (optionsQuery.isLoading) return <LoadingState label="Loading" />;
  if (options && !(options.capabilities.import && options.capabilities.create))
    return <PermissionState title="You can't import contacts" description="Ask an administrator for the Import contacts and Create contacts permissions." />;

  const chooseFile = (chosen: File | null) => {
    setFile(chosen);
    setAnalysis(null);
    setResult(null);
    if (chosen) analyze.mutate(chosen);
  };
  const mappedFields = new Set(Object.values(mapping));
  const hasName = mappedFields.has("firstName") || mappedFields.has("fullName");
  const downloadErrors = () => {
    if (!result?.errorCsv) return;
    const url = URL.createObjectURL(new Blob([result.errorCsv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "contact-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import contacts"
        description="Bring in people from a CSV or Excel (.xlsx) file, up to 2,000 rows at a time. The Company column is matched against your existing accounts."
        secondaryActions={
          <>
            <LinkButton variant="outline" href="/crm/contacts">Back to contacts</LinkButton>
            <a className={buttonVariants({ variant: "outline" })} href={contactImportTemplateUrl} download>
              <Download className="size-4" aria-hidden="true" />Download template
            </a>
          </>
        }
      />
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
                <tr><th className="px-3 py-2 font-medium">Column in your file</th><th className="px-3 py-2 font-medium">Example</th><th className="px-3 py-2 font-medium">Contact field</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analysis.headers.map((header) => (
                  <tr key={header}>
                    <td className="px-3 py-2 font-medium">{header}</td>
                    <td className="px-3 py-2 text-text-secondary">{analysis.sampleRows.find((row) => row[header])?.[header] ?? ""}</td>
                    <td className="px-3 py-2">
                      <Select
                        aria-label={`Contact field for ${header}`}
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
          {!hasName && <ErrorBanner message="Map the First Name or Name column." />}
        </Step>
      )}

      {analysis && options && (
        <Step number={3} title="Import options">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Source" description="Used for rows that have no source of their own." selectedKey={defaultSourceId}
              onSelectionChange={(key) => setDefaultSourceId(String(key))}
              options={[{ value: NONE, label: "Leave empty" }, ...options.sources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.name }))]} />
            <Select label="Contact owner" description="Used for rows that have no owner email. Otherwise the matched company's owner." selectedKey={defaultOwnerUserId}
              onSelectionChange={(key) => setDefaultOwnerUserId(String(key))}
              options={[{ value: NONE, label: "Company owner, else me" }, ...options.users.filter((user) => options.capabilities.assign || user.id === options.currentUserId).map((user) => ({ value: user.id, label: user.name }))]} />
          </div>
          <Checkbox isSelected={skipDuplicates} onChange={setSkipDuplicates}>
            Skip rows that match an existing contact (same email or phone number — recommended)
          </Checkbox>
          <div>
            <Button variant="primary" onPress={() => run.mutate()} isLoading={run.isPending} isDisabled={!hasName || !file}>
              Import {analysis.rowCount} {analysis.rowCount === 1 ? "row" : "rows"}
            </Button>
          </div>
        </Step>
      )}

      {result && (
        <section aria-live="polite" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="text-base font-semibold">Import finished</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Count label="Rows read" value={result.total} />
            <Count label="Contacts created" value={result.created} />
            <Count label="Rows failed" value={result.failed} />
            <Count label="Of which duplicates" value={result.duplicates} />
          </dl>
          {result.errors.length > 0 && (
            <>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {result.errors.map((entry) => <li key={entry.row}><span className="font-medium">Row {entry.row}:</span> {entry.message}</li>)}
              </ul>
              <div><Button variant="outline" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download failed rows</Button></div>
            </>
          )}
          {result.warnings.length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">Imported with a note</p>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-text-secondary">
                {result.warnings.map((entry) => <li key={entry.row}><span className="font-medium">Row {entry.row}:</span> {entry.message}</li>)}
              </ul>
            </div>
          )}
          <div><LinkButton variant="primary" href="/crm/contacts">View contacts</LinkButton></div>
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

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
