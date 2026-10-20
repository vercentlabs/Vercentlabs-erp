"use client";

// A customer's (or supplier's) statement for a period, straight from the ledger: balance brought forward, every invoice, credit note,
// receipt, refund, write-off and reversal with its running balance, the closing balance, and what is still open by age. Print it (or save
// it as PDF) to send: only the statement sheet prints, with the company's and the party's details.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Breadcrumb, Button, ErrorState, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { SIDE_TEXT, errorMessage, errorStatus, getStatement, money, type Side } from "../api/ledgers-api";

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #statement-sheet, #statement-sheet * { visibility: visible !important; }
  #statement-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  #statement-sheet a { color: inherit !important; text-decoration: none !important; }
}`;

export function StatementScreen({ side, partyId }: { side: Side; partyId: string }) {
  const workspace = useWorkspaceContext();
  const text = SIDE_TEXT[side];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "statement", side, partyId, from, to), queryFn: () => getStatement(side, partyId, { from: from || undefined, to: to || undefined }),
    placeholderData: (previous) => previous, retry: false });
  if (query.isLoading) return <LoadingState label="Loading the statement" rows={10} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the statement" description={errorMessage(query.error)} />;
  }
  const statement = query.data;
  const owes = statement.closing > 0.005;
  const agingPage = side === "receivable" ? "/accounting/receivables-aging" : "/accounting/payables-aging";
  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <PageHeader
        breadcrumbs={[<Breadcrumb key="aging" href={agingPage}>{`${text.ledger} aging`}</Breadcrumb>, <Breadcrumb key="this" isCurrent>{statement.party.name}</Breadcrumb>]}
        title={`Statement · ${statement.party.name}`}
        description={`Every entry on ${statement.party.name}'s account for the period, from the books.`}
        primaryAction={<Button variant="primary" onPress={() => window.print()}><Printer className="size-4" aria-hidden="true" />Print or save as PDF</Button>} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="From" size="compact" type="date" value={from || statement.from} onChange={setFrom} />
        <TextField label="To" size="compact" type="date" value={to || statement.to} onChange={setTo} />
        {side === "receivable" && <Link className="pb-2 text-sm text-brand underline" href={`/accounting/customer-invoices?partyId=${partyId}`}>Open invoices</Link>}
      </div>

      <article id="statement-sheet" className="flex flex-col gap-5 rounded-[var(--radius-panel)] border border-border bg-surface p-5 sm:p-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row">
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="text-lg font-semibold text-text">{statement.company?.name ?? ""}</span>
            {statement.company?.address && <span className="text-text-secondary">{statement.company.address}</span>}
            {statement.company?.gstin && <span className="text-text-secondary">GSTIN {statement.company.gstin}</span>}
            {(statement.company?.email || statement.company?.phone) && <span className="text-text-secondary">{[statement.company.email, statement.company.phone].filter(Boolean).join(" · ")}</span>}
          </div>
          <div className="flex flex-col gap-0.5 text-sm sm:text-right">
            <span className="text-base font-semibold uppercase tracking-wide text-text">Statement of account</span>
            <span className="text-text-secondary">{formatDate(statement.from)} – {formatDate(statement.to)}</span>
          </div>
        </header>
        <section className="flex flex-col justify-between gap-3 border-y border-border py-3 text-sm sm:flex-row">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs uppercase tracking-wide text-text-muted">{text.party}</span>
            <span className="font-medium text-text">{statement.party.legalName || statement.party.name}{statement.party.code ? ` (${statement.party.code})` : ""}</span>
            {statement.party.gstin && <span className="text-text-secondary">GSTIN {statement.party.gstin}</span>}
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 tabular-nums sm:text-right">
            <dt className="text-text-secondary">Brought forward</dt><dd>{money(statement.opening) === "—" ? "0.00" : money(statement.opening)}</dd>
            <dt className="text-text-secondary">{text.increase}</dt><dd>{money(statement.increases)}</dd>
            <dt className="text-text-secondary">{text.decrease}</dt><dd>{money(statement.decreases)}</dd>
            <dt className="font-semibold text-text">{owes ? (side === "receivable" ? "Balance due" : "Balance you owe") : statement.closing < -0.005 ? "In credit" : "Balance"}</dt>
            <dd className="font-semibold text-text">{money(Math.abs(statement.closing)) === "—" ? "0.00" : money(Math.abs(statement.closing))}</dd>
          </dl>
        </section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <tr><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Document</th><th className="py-2 pr-3 font-medium">Details</th>
                <th className="py-2 pr-3 text-right font-medium">{text.increase}</th><th className="py-2 pr-3 text-right font-medium">{text.decrease}</th><th className="py-2 text-right font-medium">Balance</th></tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 text-text-secondary"><td className="py-1.5 pr-3 tabular-nums">{formatDate(statement.from)}</td><td className="py-1.5 pr-3" colSpan={4}>Brought forward</td>
                <td className="py-1.5 text-right tabular-nums">{money(statement.opening) === "—" ? "0.00" : money(statement.opening)}</td></tr>
              {statement.lines.map((line, index) => (
                <tr key={`${line.journalEntryId}-${index}`} className="border-b border-border/60">
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDate(line.date)}</td>
                  <td className="py-1.5 pr-3"><span className="flex flex-col"><span>{line.document}</span>
                    {line.href ? <Link className="text-xs text-brand underline" href={line.href}>{line.number}</Link> : <span className="text-xs text-text-muted">{line.number}</span>}</span></td>
                  <td className="py-1.5 pr-3 text-text-secondary">{line.description}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(line.increase)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(line.decrease)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{money(line.balance) === "—" ? "0.00" : money(line.balance)}</td>
                </tr>
              ))}
              {statement.lines.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-text-muted">No entries in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <section className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-text-muted">Open on {formatDate(statement.to)}, by age</span>
          <div className="grid grid-cols-3 gap-2 text-sm tabular-nums sm:grid-cols-6">
            {([["Not yet due", "notDue"], ["1–30 days", "d1_30"], ["31–60 days", "d31_60"], ["61–90 days", "d61_90"], ["Over 90 days", "over90"], [text.credit, "credits"]] as const).map(([label, key]) => (
              <span key={key} className="flex flex-col rounded-[var(--radius-control)] border border-border px-2 py-1.5"><span className="text-xs text-text-muted">{label}</span><span>{money(statement.aging[key])}</span></span>
            ))}
          </div>
        </section>
        {side === "receivable" && owes && <p className="text-sm text-text-secondary">Please pay the balance due by its due dates, quoting the invoice numbers. Thank you for your business.</p>}
      </article>
    </div>
  );
}
