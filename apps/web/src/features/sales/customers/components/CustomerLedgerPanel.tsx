"use client";

// The customer's ledger (Sales audit M7): opening balance, every invoice, credit note, payment and refund with a running balance, and what
// is open by age — from the books, so it agrees with Accounting's statement.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { Panel } from "@/shared/ui/Panel";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getCustomerLedger } from "../api/customers-api";

const amount = (value: number) => (value ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const AGES: Array<[string, string]> = [["notDue", "Not yet due"], ["d1_30", "1–30 days"], ["d31_60", "31–60 days"], ["d61_90", "61–90 days"], ["over90", "Over 90 days"], ["credits", "Credits held"]];

export function CustomerLedgerPanel({ customerId }: { customerId: string }) {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer", customerId, "ledger", from, to),
    queryFn: () => getCustomerLedger(customerId, { from: from || undefined, to: to || undefined }),
  });
  const ledger = query.data;
  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="From" type="date" value={from || ledger?.from || ""} onChange={setFrom} />
        <TextField label="To" type="date" value={to || ledger?.to || ""} onChange={setTo} />
      </div>
      {query.isLoading && <LoadingState label="Loading the ledger" rows={6} />}
      {query.isError && <ErrorState title="Could not load the ledger" description={query.error instanceof Error ? query.error.message : undefined} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      {ledger && (
        <>
          <Panel title="Outstanding by age" description="Open invoices by how long past their due date, in the company's currency.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {AGES.map(([key, label]) => (
                <div key={key} className="flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border px-3 py-2">
                  <span className="text-xs text-text-muted">{label}</span>
                  <span className="text-sm font-medium tabular-nums">{amount(ledger.aging[key] ?? 0) || "0.00"}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Ledger" description={`${formatDate(ledger.from)} to ${formatDate(ledger.to)} · opening ${amount(ledger.opening) || "0.00"} · closing ${amount(ledger.closing) || "0.00"}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Document</th><th className="py-2 pr-3 font-medium">Number</th>
                    <th className="py-2 pr-3 text-right font-medium">Debit (owes more)</th><th className="py-2 pr-3 text-right font-medium">Credit (paid / credited)</th><th className="py-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60 text-text-muted"><td className="py-1.5 pr-3">{formatDate(ledger.from)}</td><td className="py-1.5 pr-3" colSpan={4}>Opening balance</td>
                    <td className="py-1.5 text-right tabular-nums">{amount(ledger.opening) || "0.00"}</td></tr>
                  {ledger.lines.map((line, index) => (
                    <tr key={`${line.number}-${index}`} className="border-b border-border/60">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(line.date)}</td>
                      <td className="py-1.5 pr-3">{line.document}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{line.number}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{amount(line.increase)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{amount(line.decrease)}</td>
                      <td className="py-1.5 text-right tabular-nums">{amount(line.balance) || "0.00"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ledger.lines.length === 0 && <p className="text-sm text-text-muted">Nothing in this period.</p>}
          </Panel>
        </>
      )}
    </div>
  );
}
