"use client";

// A manual journal, new or a draft being edited (also one sent back for changes). Header: journal, posting date (decides the period),
// the document's own date, reference, kind and description; then the lines — account, description, debit or credit, and where the company
// uses them, department, cost centre, party and accounting dimensions. The totals stay in view and say how far the entry is out of
// balance; "Balance here" puts the difference on a line. Saving keeps a draft; "Save and submit" sends it on for approval (or straight to
// Approved when the journal needs none). The server checks everything again: accounts, balance, the period, every reference.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Scale, Trash2 } from "lucide-react";
import { Breadcrumb, Button, ComboBox, ErrorState, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createJournal, errorMessage, errorStatus, getJournal, journalOptions, journalStep, updateJournal, type JournalDetail, type JournalInput, type JournalOptions,
} from "../api/journals-api";

type Line = {
  key: string; accountId: string | null; description: string; debit: string; credit: string; departmentId: string | null; costCenterId: string | null; partyId: string | null;
  dimensions: Record<string, string>;
};
const blank = (): Line => ({ key: crypto.randomUUID(), accountId: null, description: "", debit: "", credit: "", departmentId: null, costCenterId: null, partyId: null, dimensions: {} });
const KINDS = [["standard", "Standard"], ["adjustment", "Adjustment"], ["accrual", "Accrual"], ["deferral", "Deferral / prepayment"]];
// Paise, as whole numbers: the totals shown while typing never drift (the server does the real arithmetic).
const cents = (value: string) => { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const show = (value: number) => (value / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function JournalFormScreen({ journalId }: { journalId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "journal-options"), queryFn: journalOptions, staleTime: 60_000, retry: false });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "journal", journalId), queryFn: () => getJournal(journalId!), enabled: Boolean(journalId), retry: false });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading the journal form" rows={8} />;
  if (errorStatus(options.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options.data || (journalId && !existing.data)) return <ErrorState title="Could not load the journal form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && !existing.data.editable)
    return <ErrorState title="This journal can't be edited" description="Only a draft, or a journal sent back for changes, is edited. Correct a posted journal by reversing it (Reverse and correct)." />;
  return <JournalForm options={options.data} existing={existing.data ?? null} />;
}

function JournalForm({ options, existing }: { options: JournalOptions; existing: JournalDetail | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const general = options.journals.find((journal) => journal.type === "general") ?? options.journals[0];
  const [header, setHeader] = useState({
    journalId: existing?.journalId ?? general?.id ?? "", accountingDate: existing?.accountingDate ?? options.today, documentDate: existing?.documentDate ?? "",
    reference: existing?.reference ?? "", description: existing?.description ?? "", entryType: existing?.entryType ?? "standard",
    currencyCode: existing?.currency?.trim() ?? options.baseCurrency, exchangeRate: existing && existing.currency !== existing.functionalCurrency ? existing.exchangeRate : "",
  });
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const [lines, setLines] = useState<Line[]>(() => existing?.formLines.length
    ? existing.formLines.map((line) => ({ key: crypto.randomUUID(), accountId: line.accountId, description: line.description, debit: line.debit ? String(Number(line.debit)) : "",
      credit: line.credit ? String(Number(line.credit)) : "", departmentId: line.departmentId, costCenterId: line.costCenterId, partyId: line.partyId,
      dimensions: Object.fromEntries(line.dimensions.map((entry) => [entry.dimensionId, entry.dimensionValueId])) }))
    : [blank(), blank()]);
  const change = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const foreign = header.currencyCode !== options.baseCurrency;
  const debit = lines.reduce((sum, line) => sum + cents(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + cents(line.credit), 0);
  const difference = debit - credit;
  const filled = lines.filter((line) => line.accountId && (cents(line.debit) > 0 || cents(line.credit) > 0));
  const ready = Boolean(header.journalId && header.accountingDate && header.description.trim()) && filled.length >= 2 && difference === 0;
  const accountOptions = useMemo(() => options.accounts.map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` })), [options.accounts]);
  const partyOptions = useMemo(() => options.parties.map((party) => ({ value: party.id, label: party.name })), [options.parties]);
  const usesDimensions = options.departments.length > 0 || options.costCenters.length > 0 || options.dimensions.length > 0;
  useFormChangesWarning({ header, lines: lines.map((line) => ({ ...line, key: undefined })) });

  const payload = (): JournalInput => ({
    journalId: header.journalId, accountingDate: header.accountingDate, documentDate: header.documentDate || null, reference: header.reference || null, description: header.description.trim(),
    entryType: header.entryType, currencyCode: header.currencyCode, ...(foreign && header.exchangeRate ? { exchangeRate: header.exchangeRate } : {}),
    ...(existing ? { expectedUpdatedAt: existing.updatedAt } : {}),
    lines: filled.map((line) => ({
      accountId: line.accountId!, description: line.description || null, debit: cents(line.debit) > 0 ? line.debit : undefined, credit: cents(line.credit) > 0 ? line.credit : undefined,
      departmentId: line.departmentId, costCenterId: line.costCenterId, partyId: line.partyId,
      dimensions: Object.entries(line.dimensions).filter(([, value]) => value).map(([dimensionId, dimensionValueId]) => ({ dimensionId, dimensionValueId })),
    })),
  });
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: (submit: boolean) => submitKey.run(async () => {
      const saved = existing ? await updateJournal(existing.id, payload()) : await createJournal(payload());
      if (submit) {
        try { await journalStep(saved.id, "submit"); } catch (error) { router.replace(`/accounting/journals/${saved.id}`); throw error; }
      }
      return saved.id;
    }),
    onSuccess: (id) => router.replace(`/accounting/journals/${id}`),
  });
  const busy = save.isPending || save.isSuccess;
  const journal = options.journals.find((entry) => entry.id === header.journalId);
  const threshold = Number(options.approval.threshold);
  const needsApproval = Boolean(journal?.approvalRequired) || (options.approval.required && debit / 100 >= threshold);
  const approvalText = needsApproval
    ? "After you submit it, a second person approves it; then it can be posted."
    : options.approval.required && threshold > 0 ? `Journals from ${threshold.toLocaleString("en-IN")} need a second person's approval; this one posts after you submit it.`
      : "No approval is needed: it can be posted once submitted.";

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/journals">Journal entries</Breadcrumb>, <Breadcrumb key="this" isCurrent>{existing ? existing.number : "New"}</Breadcrumb>],
        title: existing ? `Edit journal ${existing.number}` : "New manual journal",
        description: "For entries no business document records: accruals, adjustments, reclassifications, corrections. Debits must equal credits.",
      }}
      banner={<div className="flex flex-col gap-3">
        {existing?.status === "rejected" && <Notice tone="warning">The approver sent this journal back. Saving returns it to draft; submit it again when it is right.</Notice>}
        {Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      </div>}
      aside={
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">Totals{foreign ? ` (${header.currencyCode})` : ""}</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Debits</dt><dd className="text-right">{show(debit)}</dd>
            <dt className="text-text-secondary">Credits</dt><dd className="text-right">{show(credit)}</dd>
          </dl>
          <div className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${difference === 0 && debit > 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {debit === 0 && credit === 0 ? "Enter the amounts" : difference === 0 ? "Balanced" : `Out of balance by ${show(Math.abs(difference))} (${difference > 0 ? "more debit" : "more credit"})`}
          </div>
          <p className="text-xs text-text-muted">{approvalText}</p>
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace(existing ? `/accounting/journals/${existing.id}` : "/accounting/journals")}>Cancel</Button>
          <Button variant="secondary" isLoading={busy && save.variables === false} isDisabled={busy || !ready} onPress={() => save.mutate(false)}>Save draft</Button>
          {can("accounting.journal.submit") && (
            <Button variant="primary" isLoading={busy && save.variables === true} isDisabled={busy || !ready} onPress={() => save.mutate(true)}>Save and submit</Button>
          )}
        </>
      }
    >
      <FormSection columns={1} title="Entry">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Journal" isRequired selectedKey={header.journalId || null} onSelectionChange={(value) => set("journalId")(String(value))}
            options={options.journals.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}${entry.approvalRequired ? " (always approved by a second person)" : ""}` }))} />
          <TextField label="Posting date" type="date" isRequired value={header.accountingDate} onChange={set("accountingDate")} description="Decides the period; it must be open." />
          <TextField label="Document date" type="date" value={header.documentDate} onChange={set("documentDate")} description="The date on the voucher or evidence, if different." />
          <Select label="Kind" selectedKey={header.entryType} onSelectionChange={(value) => set("entryType")(String(value))} options={KINDS.map(([value, label]) => ({ value, label }))} />
          <TextField label="Reference" value={header.reference} onChange={set("reference")} maxLength={200} description="Voucher number or other evidence." />
          <Select label="Currency" selectedKey={header.currencyCode} onSelectionChange={(value) => set("currencyCode")(String(value))}
            options={(options.currencies.length ? options.currencies : [{ code: options.baseCurrency, name: options.baseCurrency }]).map((entry) => ({ value: entry.code, label: `${entry.code} · ${entry.name}` }))} />
          {foreign && <TextField label={`Exchange rate (1 ${header.currencyCode} in ${options.baseCurrency})`} inputMode="decimal" value={header.exchangeRate} onChange={set("exchangeRate")}
            description="Finance's rate for the posting date if empty." />}
          <div className="sm:col-span-2 lg:col-span-3">
            <TextArea label="Description" isRequired value={header.description} onChange={set("description")} maxLength={1000} description="Why this entry is made — it stays with the entry for the audit." />
          </div>
        </div>
      </FormSection>

      <FormSection columns={1} title="Lines" description="Each line is either a debit or a credit. Accounts owned by a sub-ledger (customers, suppliers, stock, GST, payroll) take no manual journals and are not listed."
        actions={<Button size="compact" variant="secondary" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add line</Button>}>
        <div className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const missing = difference === 0 ? 0 : -difference;
            const costCenters = options.costCenters.filter((entry) => !line.departmentId || !entry.departmentId || entry.departmentId === line.departmentId);
            return (
              <div key={line.key} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-12">
                  <span className="col-span-2 text-xs font-medium text-text-muted lg:hidden">Line {index + 1}</span>
                  <div className="col-span-2 lg:col-span-5">
                    <ComboBox label={index === 0 ? "Account" : undefined} aria-label={`Line ${index + 1} account`} placeholder="Choose an account" selectedKey={line.accountId}
                      onSelectionChange={(value) => change(line.key, { accountId: value ? String(value) : null })} options={accountOptions} />
                  </div>
                  <div className="col-span-2 lg:col-span-3">
                    <TextField label={index === 0 ? "Description" : undefined} aria-label={`Line ${index + 1} description`} placeholder={header.description || "Line description"} value={line.description}
                      onChange={(value) => change(line.key, { description: value })} />
                  </div>
                  <div className="lg:col-span-2">
                    <TextField label={index === 0 ? "Debit" : undefined} aria-label={`Line ${index + 1} debit`} inputMode="decimal" placeholder="0.00" value={line.debit}
                      onChange={(value) => change(line.key, { debit: value, ...(value ? { credit: "" } : {}) })} />
                  </div>
                  <div className="lg:col-span-2">
                    <TextField label={index === 0 ? "Credit" : undefined} aria-label={`Line ${index + 1} credit`} inputMode="decimal" placeholder="0.00" value={line.credit}
                      onChange={(value) => change(line.key, { credit: value, ...(value ? { debit: "" } : {}) })} />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {options.departments.length > 0 && (
                    <Select size="compact" aria-label={`Line ${index + 1} department`} className="w-full sm:w-48" selectedKey={line.departmentId ?? "none"}
                      onSelectionChange={(value) => change(line.key, { departmentId: value === "none" ? null : String(value), costCenterId: null })}
                      options={[{ value: "none", label: "No department" }, ...options.departments.map((entry) => ({ value: entry.id, label: entry.name }))]} />
                  )}
                  {costCenters.length > 0 && (
                    <Select size="compact" aria-label={`Line ${index + 1} cost centre`} className="w-full sm:w-48" selectedKey={line.costCenterId ?? "none"}
                      onSelectionChange={(value) => change(line.key, { costCenterId: value === "none" ? null : String(value) })}
                      options={[{ value: "none", label: "No cost centre" }, ...costCenters.map((entry) => ({ value: entry.id, label: entry.name }))]} />
                  )}
                  {options.dimensions.map((dimension) => (
                    <Select key={dimension.id} size="compact" aria-label={`Line ${index + 1} ${dimension.name}`} className="w-full sm:w-48" selectedKey={line.dimensions[dimension.id] ?? "none"}
                      onSelectionChange={(value) => change(line.key, { dimensions: { ...line.dimensions, [dimension.id]: value === "none" ? "" : String(value) } })}
                      options={[{ value: "none", label: `No ${dimension.name.toLowerCase()}` }, ...dimension.values.map((value) => ({ value: value.id, label: `${value.code} · ${value.name}` }))]} />
                  ))}
                  {partyOptions.length > 0 && (
                    <ComboBox size="compact" aria-label={`Line ${index + 1} party`} placeholder="Party (optional)" className="w-full sm:w-56" selectedKey={line.partyId}
                      onSelectionChange={(value) => change(line.key, { partyId: value ? String(value) : null })} options={partyOptions} />
                  )}
                  <span className="ml-auto flex gap-1">
                    {missing !== 0 && !line.debit && !line.credit && (
                      <Button size="compact" variant="ghost" onPress={() => change(line.key, missing > 0 ? { debit: (missing / 100).toFixed(2), credit: "" } : { credit: (-missing / 100).toFixed(2), debit: "" })}>
                        <Scale className="size-4" aria-hidden="true" />Balance here
                      </Button>
                    )}
                    {lines.length > 2 && (
                      <Button size="compact" variant="ghost" aria-label={`Remove line ${index + 1}`} onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          {!usesDimensions && <p className="text-xs text-text-muted">Departments and cost centres appear here once they are set up in Settings.</p>}
        </div>
      </FormSection>
    </DocumentFormPage>
  );
}
