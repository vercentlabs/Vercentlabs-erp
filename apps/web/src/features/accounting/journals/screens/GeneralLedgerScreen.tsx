"use client";

// General Ledger: every posting account between two dates — brought forward, debits, credits and closing balance — grouped by class with
// subtotals, from posted entries only. Narrow it to a class, a department or a cost centre; an account opens its ledger (with the same
// dates and filter) and every line there opens its journal and document. The whole books must balance: the screen says so, or says by how
// much they don't.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ErrorState, PageHeader, PermissionState, Select, Switch, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, generalLedger, journalOptions, plain, type GeneralLedger, type Sided } from "../api/journals-api";

const CLASSES: Array<[string, string]> = [["asset", "Assets"], ["liability", "Liabilities"], ["equity", "Equity"], ["revenue", "Revenue"], ["expense", "Expenses"]];
const sided = (value: Sided) => (value.side ? `${plain(value.amount)} ${value.side}` : "—");
type Row = GeneralLedger["accounts"][number];

export function GeneralLedgerScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountClass, setAccountClass] = useState("all");
  const [departmentId, setDepartmentId] = useState("all");
  const [costCenterId, setCostCenterId] = useState("all");
  const [includeZero, setIncludeZero] = useState(false);
  const filters = {
    from: from || undefined, to: to || undefined, accountClass: accountClass === "all" ? undefined : accountClass, departmentId: departmentId === "all" ? undefined : departmentId,
    costCenterId: costCenterId === "all" ? undefined : costCenterId, includeZero: includeZero ? "true" : undefined,
  };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "general-ledger", filters), queryFn: () => generalLedger(filters), placeholderData: (previous) => previous, retry: false });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "journal-options"), queryFn: journalOptions, staleTime: 60_000, retry: false });
  const groups = useMemo(() => CLASSES.map(([code, label]) => {
    const rows = (query.data?.accounts ?? []).filter((row) => row.accountClass === code);
    return { code, label, rows, debit: rows.reduce((sum, row) => sum + Number(row.debit), 0), credit: rows.reduce((sum, row) => sum + Number(row.credit), 0) };
  }).filter((group) => group.rows.length), [query.data]);

  if (query.isLoading) return <LoadingState label="Loading the general ledger" rows={10} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the general ledger" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  }
  const gl = query.data;
  const ledgerHref = (row: Row) => {
    const params = new URLSearchParams({ from: gl.from, to: gl.to });
    if (filters.departmentId) params.set("departmentId", filters.departmentId);
    if (filters.costCenterId) params.set("costCenterId", filters.costCenterId);
    return `/accounting/ledger/${row.id}?${params.toString()}`;
  };
  const difference = Number(gl.totals.debit) - Number(gl.totals.credit);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="General Ledger" description="Every account's movement in the period, from posted entries. Open an account to see each entry with its running balance." />
      <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-panel)] border border-border bg-surface p-3">
        <TextField label="From" size="compact" type="date" value={from || gl.from} onChange={setFrom} />
        <TextField label="To" size="compact" type="date" value={to || gl.to} onChange={setTo} />
        <Select label="Class" size="compact" className="w-40" selectedKey={accountClass} onSelectionChange={(key) => setAccountClass(String(key))}
          options={[{ value: "all", label: "All classes" }, ...CLASSES.map(([value, label]) => ({ value, label }))]} />
        {(options.data?.departments.length ?? 0) > 0 && (
          <Select label="Department" size="compact" className="w-44" selectedKey={departmentId} onSelectionChange={(key) => setDepartmentId(String(key))}
            options={[{ value: "all", label: "All departments" }, ...options.data!.departments.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        )}
        {(options.data?.costCenters.length ?? 0) > 0 && (
          <Select label="Cost centre" size="compact" className="w-44" selectedKey={costCenterId} onSelectionChange={(key) => setCostCenterId(String(key))}
            options={[{ value: "all", label: "All cost centres" }, ...options.data!.costCenters.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        )}
        <Switch isSelected={includeZero} onChange={setIncludeZero}>Show accounts with no activity</Switch>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Period" value={`${formatDate(gl.from)} – ${formatDate(gl.to)}`} />
        <Metric label="Total debits" value={plain(gl.totals.debit) || "0.00"} />
        <Metric label="Total credits" value={plain(gl.totals.credit) || "0.00"} />
        <div className={`flex items-center gap-2 rounded-[var(--radius-panel)] border p-3 text-sm font-medium ${gl.balanced === false ? "border-danger-emphasis/30 bg-danger-soft text-danger"
          : gl.balanced ? "border-success-emphasis/30 bg-success-soft text-success" : "border-border bg-surface text-text-secondary"}`}>
          {gl.balanced === false ? <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
          {gl.balanced === null ? "Filtered: a part of the books need not balance" : gl.balanced ? "Debits equal credits" : `Out by ${plain(Math.abs(difference))}`}
        </div>
      </div>
      {gl.balanced === false && <Notice>The books don&apos;t balance for this period. Check Automatic Postings › Health for an unbalanced entry.</Notice>}
      {groups.length === 0 && <Notice tone="neutral">No posted entries in this period{filters.accountClass || filters.departmentId || filters.costCenterId ? " for this filter" : ""}.</Notice>}

      {/* Wide screens: one table, a heading and subtotal per class. */}
      {groups.length > 0 && (
        <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-border bg-surface md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="px-4 py-2.5 font-medium">Account</th>{["Brought forward", "Debits", "Credits", "Closing"].map((name) => <th key={name} className="px-4 py-2.5 text-right font-medium">{name}</th>)}</tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.code} className="border-b border-border last:border-0">
                <tr className="bg-surface-muted"><td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">{group.label}</td></tr>
                {group.rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer border-t border-border/60 hover:bg-surface-muted/60" onClick={() => router.push(ledgerHref(row))}>
                    <td className="px-4 py-2"><Link className="text-text hover:text-brand hover:underline" href={ledgerHref(row)} onClick={(event) => event.stopPropagation()}>
                      <span className="tabular-nums text-text-secondary">{row.code}</span> {row.name}</Link>
                      {row.status === "inactive" && <span className="ml-2 text-xs text-text-muted">inactive</span>}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{sided(row.opening)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{plain(row.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{plain(row.credit)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{sided(row.closing)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-medium"><td className="px-4 py-2 text-text-secondary">Total {group.label.toLowerCase()}</td><td />
                  <td className="px-4 py-2 text-right tabular-nums">{plain(group.debit)}</td><td className="px-4 py-2 text-right tabular-nums">{plain(group.credit)}</td><td /></tr>
              </tbody>
            ))}
          </table>
        </div>
      )}

      {/* Phones and small tablets: a card per account under its class. */}
      {groups.map((group) => (
        <section key={group.code} className="flex flex-col gap-2 md:hidden">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{group.label}</h2>
          {group.rows.map((row) => (
            <Link key={row.id} href={ledgerHref(row)} className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-border bg-surface p-3">
              <span className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate font-medium text-text">{row.code} · {row.name}</span>
                <span className="whitespace-nowrap text-sm font-medium tabular-nums">{sided(row.closing)}</span></span>
              <span className="text-xs tabular-nums text-text-muted">B/f {sided(row.opening)} · Dr {plain(row.debit) || "0.00"} · Cr {plain(row.credit) || "0.00"}</span>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-panel)] border border-border bg-surface p-3">
      <span className="text-xs text-text-muted">{label}</span><span className="text-sm font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}
