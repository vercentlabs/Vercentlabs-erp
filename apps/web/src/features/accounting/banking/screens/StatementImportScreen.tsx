"use client";

// Import a bank statement in two steps. Choose the account and the bank's CSV or Excel export: the file is read straight away (its column
// headings are found even below the bank's account details) and every row is checked — a readable date, one amount in or out — with rows
// already imported left out. Correct the column mapping if a column was not recognised, check the balances add up (opening + in − out =
// closing), then import: the lines open in the reconciliation with the best matches already suggested.
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Breadcrumb, Button, ComboBox, ErrorState, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  cents, errorMessage, errorStatus, fromCents, importStatement, inr, listBankAccounts, listStatements, previewStatement, type PreviewRow, type StatementField, type StatementPreview,
} from "../api/banking-api";

const SHOWN_ROWS = 200;

export function StatementImportScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const accounts = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-accounts", "active"), queryFn: () => listBankAccounts(false), retry: false });
  const [accountId, setAccountId] = useState<string | null>(params.get("accountId"));
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-statements", accountId), queryFn: () => listStatements(accountId!), enabled: Boolean(accountId) });
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null> | undefined>(undefined);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const read = useMutation({
    mutationFn: (input: { accountId: string; file: File; mapping?: Record<string, string | null> }) =>
      previewStatement({ bankAccountId: input.accountId, file: input.file, mapping: input.mapping }),
    onSuccess: (result) => setPreview(result),
    onError: () => setPreview(null),
  });
  const reread = (next: { accountId?: string | null; file?: File | null; mapping?: Record<string, string | null> }) => {
    const chosenAccount = next.accountId !== undefined ? next.accountId : accountId;
    const chosenFile = next.file !== undefined ? next.file : file;
    if (chosenAccount && chosenFile) read.mutate({ accountId: chosenAccount, file: chosenFile, mapping: next.mapping ?? mapping });
  };
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(() => importStatement({ bankAccountId: accountId!, file: file!, mapping, openingBalance: openingValue || undefined, closingBalance: closingValue || undefined })),
    onSuccess: (statement) => router.replace(`/accounting/reconciliation/${statement.id}`),
  });
  const busy = save.isPending || save.isSuccess;

  if (accounts.isLoading) return <LoadingState label="Loading the import" rows={6} />;
  if (errorStatus(accounts.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!accounts.data) return <ErrorState title="Could not load the import" description={errorMessage(accounts.error)} />;
  const banks = accounts.data.filter((account) => account.kind === "bank");
  const account = banks.find((entry) => entry.id === accountId);
  const currency = account?.currency ?? "INR";
  const last = history.data?.[0] ?? null;
  // The opening balance defaults to the last statement's closing; the closing to the file's last running balance.
  const openingValue = opening ?? (last ? fromCents(cents(last.closing)) : "");
  const closingValue = closing ?? preview?.summary.lastBalance ?? "";
  const summary = preview?.summary;
  const computed = summary && openingValue !== "" ? cents(openingValue) + cents(summary.moneyIn) - cents(summary.moneyOut) : null;
  const unbalanced = computed !== null && closingValue !== "" && computed !== cents(closingValue);
  const ready = Boolean(preview && summary && summary.ready > 0 && summary.invalid === 0 && preview.missing.length === 0 && !unbalanced);

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/reconciliation">Bank reconciliation</Breadcrumb>, <Breadcrumb key="this" isCurrent>Import statement</Breadcrumb>],
        title: "Import bank statement",
        description: "Download the statement from your bank's net banking as CSV or Excel and choose it here. Nothing is saved until you import.",
      }}
      banner={Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      aside={summary ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">This file</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Rows read</dt><dd className="text-right">{summary.rows}</dd>
            <dt className="text-text-secondary">To import</dt><dd className="text-right">{summary.ready}</dd>
            <dt className="text-text-secondary">Already imported</dt><dd className="text-right">{summary.duplicates}</dd>
            <dt className={summary.invalid ? "text-danger" : "text-text-secondary"}>Can&apos;t be read</dt><dd className={`text-right ${summary.invalid ? "text-danger" : ""}`}>{summary.invalid}</dd>
            <dt className="text-text-secondary">Period</dt><dd className="text-right">{summary.from ? `${formatDate(summary.from)} – ${formatDate(summary.to)}` : "—"}</dd>
            <dt className="text-text-secondary">Money in</dt><dd className="text-right">{inr(summary.moneyIn, currency)}</dd>
            <dt className="text-text-secondary">Money out</dt><dd className="text-right">{inr(summary.moneyOut, currency)}</dd>
          </dl>
          <div className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${summary.invalid || unbalanced ? "bg-danger-soft text-danger" : summary.ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            {summary.invalid ? `Fix ${summary.invalid} row${summary.invalid === 1 ? "" : "s"} in the file or the mapping`
              : unbalanced ? `Opening + in − out is ${inr((computed ?? 0) / 100, currency)}, not the closing ${inr(closingValue, currency)}`
              : summary.ready ? `Ready: ${summary.ready} line${summary.ready === 1 ? "" : "s"}` : "Nothing new in this file"}
          </div>
          {summary.repeated > 0 && <p className="text-xs text-text-muted">{summary.repeated} row{summary.repeated === 1 ? " repeats" : "s repeat"} another row of the file exactly. They are imported; check they are genuine.</p>}
        </div>
      ) : undefined}
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace(account ? `/accounting/bank-accounts/${account.id}` : "/accounting/reconciliation")}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready || read.isPending} onPress={() => save.mutate()}>Import statement</Button>
        </>
      }
    >
      <FormSection columns={1} title="Statement file">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ComboBox label="Bank account" isRequired placeholder="Choose the account" selectedKey={accountId}
            onSelectionChange={(key) => { const next = key ? String(key) : null; setAccountId(next); setOpening(null); reread({ accountId: next }); }}
            options={banks.map((entry) => ({ value: entry.id, label: [entry.name, entry.bankName, entry.accountNumber].filter(Boolean).join(" · ") }))}
            description={last ? `Last statement ${last.number} ended ${formatDate(last.to)}.` : accountId ? "No statement imported on this account yet." : undefined} />
          <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-text">File (.csv or .xlsx)</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Bank statement file" disabled={busy}
              className="rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 text-sm"
              onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setMapping(undefined); setClosing(null); reread({ file: next, mapping: undefined }); }} />
            <span className="text-xs text-text-muted">{file ? `Chosen: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : "Up to 5 MB. Old .xls files: open in Excel and save as .xlsx or CSV."}</span></label>
        </div>
        {banks.length === 0 && <Notice tone="info">No bank account yet. <Link className="font-medium underline" href="/accounting/bank-accounts">Add a bank account</Link>, then come back to import.</Notice>}
        {read.isPending && <LoadingState label="Reading the file" rows={3} />}
        {read.error && <Notice>{errorMessage(read.error)}</Notice>}
      </FormSection>

      {preview && (
        <FormSection columns={1} title="Columns" description={`Headings found on row ${preview.headerRow} of the file. Change a column if it was not recognised; the file is read again.`}>
          {preview.missing.length > 0 && <Notice tone="warning">Choose the {preview.missing.join(" and ")} column{preview.missing.length > 1 ? "s" : ""}.</Notice>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {preview.fields.map((field) => (
              <Select key={field.key} label={field.label} selectedKey={preview.mapping[field.key as StatementField] ?? "__none"}
                onSelectionChange={(key) => {
                  const next = { ...preview.mapping, ...(mapping ?? {}), [field.key]: key === "__none" ? null : String(key) };
                  setMapping(next); reread({ mapping: next });
                }}
                options={[{ value: "__none", label: "Not in the file" }, ...preview.headers.filter(Boolean).map((header) => ({ value: header, label: header }))]} />
            ))}
          </div>
        </FormSection>
      )}

      {preview && (
        <FormSection columns={1} title="Balances" description="A statement must add up: opening + money in − money out = closing. Leave them empty if the bank's file has no balances.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={`Opening balance (${currency})`} inputMode="decimal" value={openingValue} onChange={setOpening}
              description={last ? `${last.number} closed at ${inr(last.closing, currency)}.` : "The balance before the first line."} />
            <TextField label={`Closing balance (${currency})`} inputMode="decimal" value={closingValue} onChange={setClosing}
              errorMessage={unbalanced ? "Doesn't add up" : undefined} description={preview.summary.lastBalance ? "From the file's last running balance." : "The balance after the last line."} />
          </div>
        </FormSection>
      )}

      {preview && (
        <FormSection columns={1} title="Rows" description={preview.rows.length > SHOWN_ROWS ? `The first ${SHOWN_ROWS} of ${preview.rows.length} rows; every row is checked.` : undefined}>
          <LinesTable columns={["Row", "Date", "Description", "Reference", { label: "In", numeric: true }, { label: "Out", numeric: true }, "Check"]}
            empty={preview.rows.length ? undefined : "No transactions found below the headings."}>
            {preview.rows.slice(0, SHOWN_ROWS).map((row) => (
              <tr key={row.row} className={row.duplicate ? "text-text-muted" : undefined}>
                <Cell>{row.row}</Cell>
                <Cell>{row.date ? formatDate(row.date) : "—"}</Cell>
                <Cell><span className="line-clamp-2 max-w-72">{row.description ?? "—"}</span></Cell>
                <Cell>{row.reference ?? "—"}</Cell>
                <Cell numeric>{row.direction === "in" && row.amount ? inr(row.amount, currency) : ""}</Cell>
                <Cell numeric>{row.direction === "out" && row.amount ? inr(row.amount, currency) : ""}</Cell>
                <Cell><RowCheck row={row} /></Cell>
              </tr>
            ))}
          </LinesTable>
        </FormSection>
      )}
    </DocumentFormPage>
  );
}

function RowCheck({ row }: { row: PreviewRow }) {
  if (row.errors.length) return <span className="flex flex-col gap-0.5"><StatusBadge tone="danger">Can&apos;t read</StatusBadge><span className="text-xs text-danger">{row.errors.join("; ")}</span></span>;
  if (row.duplicate) return <span className="flex flex-col gap-0.5"><StatusBadge tone="neutral">Already imported</StatusBadge><span className="text-xs">In {row.duplicate.statement}</span></span>;
  if (row.repeatOf) return <span className="flex flex-col gap-0.5"><StatusBadge tone="warning">{`Repeats row ${row.repeatOf}`}</StatusBadge></span>;
  return <StatusBadge tone="success">Ready</StatusBadge>;
}
