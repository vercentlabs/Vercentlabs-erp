"use client";

// Receivables (or payables) aging: what each customer (supplier) owes by how long past due — not yet due, 1–30, 31–60, 61–90 and over
// 90 days — with the advances and credits it holds and its net balance, in the company's currency. The totals agree with the control
// account. A row opens that party's open items; its name opens its statement.
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ErrorState, PageHeader, PermissionState, SearchField, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { SIDE_TEXT, errorMessage, errorStatus, getAging, getOpenItems, money, type AgingRow, type BucketKey, type Side } from "../api/ledgers-api";

const TONE: Record<BucketKey, string> = { notDue: "text-text", d1_30: "text-text", d31_60: "text-warning", d61_90: "text-warning", over90: "text-danger" };

export function AgingScreen({ side }: { side: Side }) {
  const workspace = useWorkspaceContext();
  const text = SIDE_TEXT[side];
  const [asOf, setAsOf] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "aging", side, asOf), queryFn: () => getAging(side, asOf || undefined), placeholderData: (previous) => previous, retry: false });
  const rows = useMemo(() => (query.data?.rows ?? []).filter((row) => !search.trim() || row.name.toLowerCase().includes(search.trim().toLowerCase())), [query.data, search]);
  if (query.isLoading) return <LoadingState label={`Loading ${text.ledger.toLowerCase()} aging`} rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the aging" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  }
  const aging = query.data;
  const overdue = aging.totals.d1_30 + aging.totals.d31_60 + aging.totals.d61_90 + aging.totals.over90;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${text.ledger} Aging`}
        description={side === "receivable" ? "What each customer owes, by how long past due. Advances and unapplied credits are shown against it. The total agrees with the receivables account."
          : "What you owe each supplier, by how long past due. Advances and supplier credits are shown against it. The total agrees with the payables account."} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="As of" size="compact" type="date" value={asOf || aging.asOf} onChange={setAsOf} description="Days past due are counted to this date." />
        <SearchField aria-label={`Search ${text.parties.toLowerCase()}`} placeholder={`Find a ${text.party.toLowerCase()}`} className="w-full sm:w-72" value={search} onChange={setSearch} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {aging.buckets.map((bucket) => <Tile key={bucket.key} label={bucket.label} value={aging.totals[bucket.key]} tone={TONE[bucket.key]} />)}
        <Tile label={text.credit} value={aging.totals.credits} />
      </div>
      <p className="text-sm text-text-secondary">Net: <span className="font-semibold tabular-nums text-text">{money(aging.totals.net) === "—" ? "0.00" : money(aging.totals.net)}</span>
        {overdue > 0 && <> · <span className="text-danger tabular-nums">{money(overdue)}</span> past due</>}</p>
      {rows.length === 0 ? <Notice tone="neutral">{search ? "Nothing matches." : side === "receivable" ? "No customer owes anything." : "Nothing is owed to suppliers."}</Notice> : (
        <>
          <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-border bg-surface lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <tr><th className="px-4 py-2.5 font-medium">{text.party}</th>{aging.buckets.map((bucket) => <th key={bucket.key} className="px-3 py-2.5 text-right font-medium">{bucket.label}</th>)}
                  <th className="px-3 py-2.5 text-right font-medium">Credits</th><th className="px-4 py-2.5 text-right font-medium">Net</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.partyId}>
                    <tr className="cursor-pointer border-t border-border/60 hover:bg-surface-muted/60" onClick={() => setOpen(open === row.partyId ? null : row.partyId)}>
                      <td className="px-4 py-2"><span className="flex items-center gap-1.5">
                        {open === row.partyId ? <ChevronDown className="size-4 text-text-muted" aria-hidden="true" /> : <ChevronRight className="size-4 text-text-muted" aria-hidden="true" />}
                        <Link className="text-text hover:text-brand hover:underline" href={`/accounting/statements/${text.statementPath}/${row.partyId}`} onClick={(event) => event.stopPropagation()}>{row.name}</Link></span></td>
                      {aging.buckets.map((bucket) => <td key={bucket.key} className={`px-3 py-2 text-right tabular-nums ${row[bucket.key] ? TONE[bucket.key] : "text-text-muted"}`}>{money(row[bucket.key])}</td>)}
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{money(row.credits)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(row.net)}</td>
                    </tr>
                    {open === row.partyId && <tr><td colSpan={aging.buckets.length + 3} className="bg-surface-muted/40 px-4 py-2"><OpenItems side={side} row={row} asOf={aging.asOf} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr><td className="px-4 py-2">Total</td>{aging.buckets.map((bucket) => <td key={bucket.key} className="px-3 py-2 text-right tabular-nums">{money(aging.totals[bucket.key])}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums">{money(aging.totals.credits)}</td><td className="px-4 py-2 text-right tabular-nums">{money(aging.totals.net)}</td></tr>
              </tfoot>
            </table>
          </div>
          <ul className="flex flex-col gap-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.partyId} className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-border bg-surface p-3">
                <span className="flex items-baseline justify-between gap-2">
                  <Link className="min-w-0 truncate font-medium text-text underline-offset-2 hover:underline" href={`/accounting/statements/${text.statementPath}/${row.partyId}`}>{row.name}</Link>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{money(row.net)}</span></span>
                <span className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs tabular-nums sm:grid-cols-6">
                  {aging.buckets.map((bucket) => <span key={bucket.key} className="flex flex-col"><span className="text-text-muted">{bucket.label}</span><span className={row[bucket.key] ? TONE[bucket.key] : "text-text-muted"}>{money(row[bucket.key])}</span></span>)}
                  <span className="flex flex-col"><span className="text-text-muted">Credits</span><span>{money(row.credits)}</span></span>
                </span>
                <button type="button" className="self-start text-xs text-brand underline" onClick={() => setOpen(open === row.partyId ? null : row.partyId)}>{open === row.partyId ? "Hide items" : "Show items"}</button>
                {open === row.partyId && <OpenItems side={side} row={row} asOf={aging.asOf} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "text-text" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-panel)] border border-border bg-surface p-3">
      <span className="text-xs text-text-muted">{label}</span><span className={`text-base font-semibold tabular-nums ${value ? tone : "text-text-muted"}`}>{money(value)}</span>
    </div>
  );
}

function OpenItems({ side, row, asOf }: { side: Side; row: AgingRow; asOf: string }) {
  const workspace = useWorkspaceContext();
  const items = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "aging-items", side, row.partyId, asOf), queryFn: () => getOpenItems(side, row.partyId, asOf) });
  if (items.isLoading) return <LoadingState label="Loading open items" rows={2} />;
  if (!items.data?.length) return <p className="text-xs text-text-muted">Nothing open.</p>;
  const kind = (value: string) => (value === "unapplied" ? (side === "receivable" ? "Unapplied receipt" : "Unapplied payment") : value === "credit_note" ? "Credit note" : side === "receivable" ? "Invoice" : "Bill");
  return (
    <ul className="flex flex-col divide-y divide-border/60 text-xs">
      {items.data.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span className="flex flex-col"><span className="font-medium text-text">{kind(item.kind)} {item.number}</span>
            <span className="text-text-muted">{formatDate(item.date)}{item.dueDate ? ` · due ${formatDate(item.dueDate)}` : ""}{item.daysPastDue > 0 ? ` · ${item.daysPastDue} days past due` : ""}</span></span>
          <span className={`tabular-nums ${item.amount < 0 ? "text-text-secondary" : "font-medium text-text"}`}>{money(item.amount)}{item.currency !== "INR" ? ` (${item.outstanding.toFixed(2)} ${item.currency})` : ""}</span>
        </li>
      ))}
    </ul>
  );
}
