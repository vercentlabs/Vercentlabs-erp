"use client";

// Refunds this month: owed, refunded, still outstanding, processing, failed and being checked; by method; cash refunds by session. A posted
// return is never counted as money paid back.
import { useQuery } from "@tanstack/react-query";

import { request } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Summary = {
  from: string; to: string;
  totals: { refunds: number; authorized: string; paid: string; outstanding: string; processing: number; failed: number; unknown: number; approved: number; average_seconds: string };
  byMethod: Array<{ method: string; status: string; components: number; amount: string; paid: string }>;
  cashBySession: Array<{ session: string; payouts: number; amount: string }>;
};

export function RefundsReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "refunds-summary"), queryFn: () => request<{ summary: Summary }>("/reports/refunds").then((result) => result.summary), retry: false });
  const data = query.data;
  if (!data || data.totals.refunds === 0) return null;
  const t = data.totals;
  return (
    <PosPanel title="Refunds" description={`${data.from} to ${data.to}. Money owed to customers and what has really been paid back.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Owed", money(currency, t.authorized)], ["Refunded", money(currency, t.paid)], ["Still outstanding", money(currency, t.outstanding)], ["Refunds", String(t.refunds)],
          ["Processing", String(t.processing)], ["Failed — action needed", String(t.failed)], ["Being checked", String(t.unknown)], ["Supervisor-approved", String(t.approved)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Method</th><th className="pb-1 text-left">Status</th><th className="pb-1 text-right">Owed</th><th className="pb-1 text-right">Paid</th></tr></thead>
          <tbody>{data.byMethod.map((row) => (
            <tr key={`${row.method}:${row.status}`} className="border-t border-border"><td className="py-1.5">{row.method.toUpperCase()}</td><td>{row.status}</td>
              <td className="text-right tabular-nums">{money(currency, row.amount)}</td><td className="text-right tabular-nums">{money(currency, row.paid)}</td></tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Cash refunds by session</th><th className="pb-1 text-right">Payouts</th><th className="pb-1 text-right">Amount</th></tr></thead>
          <tbody>{data.cashBySession.map((row) => (
            <tr key={row.session} className="border-t border-border"><td className="py-1.5">{row.session}</td><td className="text-right tabular-nums">{row.payouts}</td>
              <td className="text-right tabular-nums">{money(currency, row.amount)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </PosPanel>
  );
}
