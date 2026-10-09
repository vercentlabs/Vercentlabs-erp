"use client";

// Import customers, their addresses or their contacts from a CSV or Excel
// file: choose what the file holds, choose the file, confirm which column is
// which, check it, then import. Rows that fail or are skipped are listed with
// the reason. Address and contact rows name their customer by customer
// number; a contact row with a known email or mobile is linked, not copied.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, LinkButton, PageHeader, PermissionState, Select, Tab, TabList, Tabs, buttonVariants } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  analyzeCustomerImport, customerImportTemplateUrl, errorMessage, getCustomerOptions, importCustomers, type ImportAnalysis, type ImportKind, type ImportResult, type ImportRow,
} from "../api/customers-api";
import { ErrorBanner } from "../customer-format";

const SKIP = "skip-column";
const card = "flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-6";
const MODES = [
  { value: "skip", label: "Skip: leave the existing customer as it is" },
  { value: "update", label: "Update: fill the existing customer from the file" },
  { value: "review", label: "Review: do not import, list them for me" },
];
const KINDS: Record<ImportKind, { noun: string; required: string; requiredKeys: string[]; hint: string }> = {
  customers: { noun: "customers", required: "Customer Name", requiredKeys: ["displayName"], hint: "Each row becomes a customer, checked exactly like one typed in by hand." },
  addresses: { noun: "addresses", required: "Customer Number and Address Line 1", requiredKeys: ["customerNumber", "line1"], hint: "Each row adds an address to the customer named by its customer number. An address the customer already has is skipped." },
  contacts: { noun: "contacts", required: "Customer Number and First Name", requiredKeys: ["customerNumber", "firstName"], hint: "Each row adds a person to the customer named by its customer number. A row whose email or mobile matches an existing contact links that contact." },
};
const OUTCOME: Record<ImportRow["outcome"], { label: string; tone: "success" | "info" | "neutral" | "warning" | "danger" }> = {
  created: { label: "Created", tone: "success" }, updated: { label: "Updated", tone: "info" }, linked: { label: "Linked existing", tone: "info" }, skipped: { label: "Skipped", tone: "neutral" },
  review: { label: "Needs review", tone: "warning" }, failed: { label: "Error", tone: "danger" },
};

export function CustomerImportScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, staleTime: 60_000 });
  const [kind, setKind] = useState<ImportKind>("customers");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [outcome, setOutcome] = useState<{ result: ImportResult; errorFile: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: (chosen: File) => analyzeCustomerImport(kind, chosen),
    onSuccess: (data) => { setAnalysis(data); setMapping(data.suggestedMapping); setOutcome(null); setError(null); },
    onError: (failure) => { setAnalysis(null); setError(errorMessage(failure)); },
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importCustomers(kind, file!, {
      mapping, duplicateMode, dryRun, countryCode: optionsQuery.data?.defaults.countryCode, currencyCode: optionsQuery.data?.defaults.currencyCode ?? undefined,
    }),
    onSuccess: (data) => {
      setOutcome(data);
      setError(null);
      if (!data.result.dryRun) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  if (optionsQuery.isLoading) return <LoadingState label="Loading" rows={4} />;
  const can = optionsQuery.data?.capabilities;
  const shape = KINDS[kind];
  if (!can?.import || !(can.create || can.manageAddresses || can.manageContacts)) return <PermissionState title="You cannot import customers" description="Ask an administrator for the Import customers permission." />;

  const choose = (chosen: File | null) => {
    setFile(chosen);
    setAnalysis(null);
    setOutcome(null);
    if (chosen) analyze.mutate(chosen);
  };
  const mapped = new Set(Object.values(mapping));
  const hasName = shape.requiredKeys.every((key) => mapped.has(key));
  const changeKind = (next: ImportKind) => { setKind(next); setFile(null); setAnalysis(null); setOutcome(null); setError(null); };
  const result = outcome?.result;
  const downloadErrors = () => {
    if (!outcome?.errorFile) return;
    const url = URL.createObjectURL(new Blob([outcome.errorFile], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "customer-import-rows-to-fix.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Import customers" description="Upload a CSV or Excel file of customers, customer addresses or customer contacts."
        secondaryActions={<LinkButton href="/sales/customers" variant="outline">Back to customers</LinkButton>} />
      <Tabs selectedKey={kind} onSelectionChange={(key) => changeKind(String(key) as ImportKind)}>
        <TabList aria-label="What to import">
          {can.create && <Tab id="customers">Customers</Tab>}
          {can.manageAddresses && <Tab id="addresses">Addresses</Tab>}
          {can.manageContacts && <Tab id="contacts">Contacts</Tab>}
        </TabList>
      </Tabs>
      <ErrorBanner message={error} />

      <section className={card} aria-label="File">
        <h2 className="text-base font-semibold">1. Choose the file</h2>
        <p className="text-sm text-text-secondary">{shape.hint}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input key={kind} type="file" accept=".csv,.xlsx" aria-label={`File of ${shape.noun}`} className="text-sm" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          <a className={buttonVariants({ variant: "outline", size: "compact" })} href={customerImportTemplateUrl(kind)} download><Download className="size-4" aria-hidden="true" />Download template</a>
        </div>
        <p className="text-xs text-text-muted">
          Up to 2,000 rows and 5 MB. {shape.required} {shape.requiredKeys.length > 1 ? "are" : "is"} required.
          {kind === "customers" ? ` Rows without a country or currency use ${optionsQuery.data?.defaults.countryCode} and ${optionsQuery.data?.defaults.currencyCode}.` : ""}
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
                onSelectionChange={(key) => {
                  const next = { ...mapping };
                  if (String(key) === SKIP) delete next[header]; else next[header] = String(key);
                  setMapping(next);
                  setOutcome(null);
                }}
                options={[{ value: SKIP, label: "Do not import" }, ...analysis.fields.map((field) => ({ value: field.key, label: field.label, isDisabled: mapped.has(field.key) && mapping[header] !== field.key }))]} />
            ))}
          </div>
          {!hasName && <p role="alert" className="text-sm text-danger">Choose which {shape.requiredKeys.length > 1 ? "columns hold" : "column holds"} the {shape.required}.</p>}
          {kind === "customers" && <Select className="sm:max-w-lg" label="When a row matches an existing customer" selectedKey={duplicateMode} onSelectionChange={(key) => { setDuplicateMode(String(key)); setOutcome(null); }}
            options={MODES.filter((mode) => mode.value !== "update" || can.edit)} description="A match is the same GSTIN, legal name or website." />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" isDisabled={!hasName || run.isPending} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check the file</Button>
            <Button variant="primary" isDisabled={!hasName || run.isPending} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Import {shape.noun}</Button>
          </div>
        </section>
      )}

      {result && (
        <section className={card} aria-label="Result">
          <h2 className="text-base font-semibold">{result.dryRun ? "3. Check result (nothing was saved)" : "3. Import result"}</h2>
          <p role="status" className="text-sm">
            {result.total} {result.total === 1 ? "row" : "rows"}: {result.created} {result.dryRun ? "would be created" : "created"}, {result.updated} {result.dryRun ? "would be updated" : "updated"},
            {kind === "contacts" ? ` ${result.linked ?? 0} linked to an existing contact,` : ""}
            {" "}{result.skipped} skipped,{kind === "customers" ? ` ${result.review} to review,` : ""} {result.failed} with errors.
          </p>
          <div className="flex flex-wrap gap-2">
            {outcome?.errorFile && <Button variant="secondary" size="compact" onPress={downloadErrors}><Download className="size-4" aria-hidden="true" />Download rows to fix</Button>}
            {!result.dryRun && result.created + result.updated > 0 && <LinkButton href="/sales/customers?view=recently_created" variant="secondary" size="compact">View customers</LinkButton>}
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Row", "Customer", "Result", "Details"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
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
