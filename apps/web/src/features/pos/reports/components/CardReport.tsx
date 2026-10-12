"use client";

// Cards this month: completed card sales (provider verified apart from payments recorded from a standalone machine), declines, failures,
// attempts still unresolved, captured cards whose sale was not finalised, refunds, what settled with its fees and fee tax, what has not
// settled yet and settlement entries that do not match, by outlet, terminal and cashier.
import { useQuery } from "@tanstack/react-query";
import type { PosCardPaymentSummary } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

function Table({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted">
          <tr>{head.map((label, index) => <th key={label} className={`pb-1 ${index === 0 ? "text-left" : "text-right"}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((cell, cellIndex) => <td key={cellIndex} className={`py-1.5 pr-2 ${cellIndex === 0 ? "" : "text-right tabular-nums"}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "card-summary"),
    queryFn: () => request<{ summary: PosCardPaymentSummary }>("/reports/card").then((response) => response.summary),
  });
  const data = query.data;
  if (!data) return null;
  const m = (value: string) => money(currency, value);
  const t = data.totals;
  const rows = (list: PosCardPaymentSummary["byOutlet"]) => list.map((entry) => [entry.name, entry.sales, m(entry.amount), entry.declined]);
  return (
    <PosPanel title="Cards" description={`${data.from} to ${data.to}. A card counts as paid only when the provider confirmed it, or it was recorded from a standalone machine.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Card sales", `${m(t.card_amount)} · ${t.card_sales}`], ["Provider verified", m(t.provider_verified)], ["Recorded from machines", m(t.externally_attested)],
          ["Declined · failed", `${t.declined} · ${t.failed}`], ["Unresolved", String(t.unresolved)], ["Charged, sale not finalised", String(t.captured_not_finalized)],
          ["Refunded", m(t.refunded)], ["Settled (gross)", m(t.settled_gross)], ["Fees + fee tax", `${m(t.fees)}`], ["Not settled yet", m(t.unsettled)],
          ["Settlement mismatches", String(t.mismatched)], ["Unmatched settlement lines", String(t.unmatched)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Table head={["Outlet", "Sales", "Amount", "Declined"]} rows={rows(data.byOutlet)} />
        <Table head={["Terminal", "Sales", "Amount", "Declined"]} rows={rows(data.byTerminal)} />
        <Table head={["Cashier", "Sales", "Amount", "Declined"]} rows={rows(data.byCashier)} />
      </div>
    </PosPanel>
  );
}
