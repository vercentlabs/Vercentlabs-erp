"use client";

// Split payments this month: sales paid with more than one method, by combination, how much each method carried in those sales, and split
// bills that were cancelled (every collected part reversed).
import { useQuery } from "@tanstack/react-query";
import type { PosSplitPaymentSummary } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { request } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function SplitReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "split-summary"),
    queryFn: () => request<{ summary: PosSplitPaymentSummary }>("/reports/split").then((response) => response.summary),
  });
  const data = query.data;
  if (!data || data.totals.split_sales === 0) return null;
  const t = data.totals;
  return (
    <PosPanel title="Split payments" description={`${data.from} to ${data.to}. One sale per bill, whatever the number of methods.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Split sales", `${t.split_sales} of ${t.all_sales}`], ["Value", money(currency, t.split_value)], ["Cancelled split bills", String(t.cancellations)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Combination</th><th className="pb-1 text-right">Sales</th><th className="pb-1 text-right">Value</th></tr></thead>
          <tbody>{data.byCombination.map((row) => (
            <tr key={row.combination} className="border-t border-border"><td className="py-1.5">{row.combination.toUpperCase()}</td><td className="text-right tabular-nums">{row.sales}</td><td className="text-right tabular-nums">{money(currency, row.value)}</td></tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Method (in split sales)</th><th className="pb-1 text-right">Amount</th></tr></thead>
          <tbody>{data.byMethod.map((row) => (
            <tr key={row.method} className="border-t border-border"><td className="py-1.5">{row.method.toUpperCase()}</td><td className="text-right tabular-nums">{money(currency, row.amount)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </PosPanel>
  );
}
