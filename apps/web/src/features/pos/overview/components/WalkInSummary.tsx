"use client";

// Walk-in and registered sales over the last 30 days, from finished sales and returns. Walk-in figures are transactions, never customers:
// anonymous purchases cannot be tied to a person.
import { useQuery } from "@tanstack/react-query";
import type { PosWalkInFigures } from "@vercentlabs/api";

import { request } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Summary = {
  from: string; to: string; currency: string; walkIn: PosWalkInFigures; registered: PosWalkInFigures; note: string;
  walkInByOutlet: Array<{ code: string; name: string; transactions: number; net: string }>; walkInByPaymentMethod: Array<{ method: string; transactions: number; amount: string }>;
};
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", wallet: "Wallet", bank_transfer: "Bank transfer" };

export function WalkInSummary() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "walk-in-summary"), queryFn: () => request<{ summary: Summary }>("/reports/walk-in").then((response) => response.summary) });
  const data = query.data;
  if (!data) return null;
  const currency = data.currency;
  const row = (label: string, figures: PosWalkInFigures) => (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-3 font-medium">{label}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{figures.transactions}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{money(currency, figures.net)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{money(currency, figures.tax)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{money(currency, figures.refunds)}</td>
      <td className="py-1.5 text-right tabular-nums">{money(currency, figures.averageBill)}</td>
    </tr>
  );
  return (
    <PosPanel title="Walk-in and registered sales" description={`${data.from} to ${data.to}. ${data.note}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted">
            <tr><th className="pb-1 text-left">Customer</th><th className="pb-1 text-right">Transactions</th><th className="pb-1 text-right">Net sales</th>
              <th className="pb-1 text-right">Tax</th><th className="pb-1 text-right">Refunds</th><th className="pb-1 text-right">Average bill</th></tr>
          </thead>
          <tbody>{row("Walk-in", data.walkIn)}{row("Registered", data.registered)}</tbody>
        </table>
      </div>
      {(data.walkInByPaymentMethod.length > 0 || data.walkInByOutlet.length > 1) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-text-secondary">
          {data.walkInByPaymentMethod.map((entry) => <span key={entry.method}>Walk-in by {METHOD[entry.method] ?? entry.method}: {money(currency, entry.amount)} ({entry.transactions})</span>)}
          {data.walkInByOutlet.length > 1 && data.walkInByOutlet.map((entry) => <span key={entry.code}>{entry.code}: {money(currency, entry.net)} ({entry.transactions})</span>)}
        </div>
      )}
    </PosPanel>
  );
}
