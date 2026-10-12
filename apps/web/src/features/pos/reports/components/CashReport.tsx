"use client";

// Cash this month: cash-settled sales (only the cash part of mixed tenders, so payment methods add up to the sales), the cash handed over
// and the change given, refunds paid in cash, cash still in hand on bills not finalised, tenders handed back, session shortages and
// excesses, and the split by outlet, terminal, cashier and session.
import { useQuery } from "@tanstack/react-query";
import type { PosCashPaymentSummary } from "@vercentlabs/api";

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

export function CashReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cash-summary"),
    queryFn: () => request<{ summary: PosCashPaymentSummary }>("/reports/cash").then((response) => response.summary),
  });
  const data = query.data;
  if (!data) return null;
  const m = (value: string) => money(currency, value);
  const t = data.totals;
  const rows = (list: PosCashPaymentSummary["byOutlet"]) => list.map((entry) => [entry.name, entry.sales, m(entry.cash), m(entry.received), m(entry.change)]);
  return (
    <PosPanel title="Cash" description={`${data.from} to ${data.to}. Completed sales only; cash in mixed tenders counts only its cash part.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Cash sales", `${m(t.cash_sales)} · ${t.cash_sale_count}`], ["Cash received", m(t.received)], ["Change given", m(t.change)], ["Cash refunds", m(t.refunds)],
          ["Cash share of payments", `${t.cash_share_percent}%`], ["Cash in mixed tenders", m(t.split_cash)], ["Cash in hand, not finalised", m(t.pending_custody)],
          ["Handed back", `${m(t.returned)} · ${t.returned_count}`], ["Session shortages", m(t.shortages)], ["Session excesses", m(t.excesses)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table head={["Outlet", "Sales", "Cash", "Received", "Change"]} rows={rows(data.byOutlet)} />
        <Table head={["Terminal", "Sales", "Cash", "Received", "Change"]} rows={rows(data.byTerminal)} />
        <Table head={["Cashier", "Sales", "Cash", "Received", "Change"]} rows={rows(data.byCashier)} />
        <Table head={["Session", "Sales", "Cash", "Received", "Change"]} rows={rows(data.bySession)} />
      </div>
    </PosPanel>
  );
}
