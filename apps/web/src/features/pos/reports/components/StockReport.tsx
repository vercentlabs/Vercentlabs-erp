"use client";

// Stock reduction this month, from Inventory's own movements (never inferred from payments or receipts): quantity sold against quantity issued,
// cost of goods consumed, by item and by outlet and warehouse, batches and serials sold, sale lines whose movements disagree, bills waiting on
// stock recovery, and checkout reservations (active, overdue, expired).
import { useQuery } from "@tanstack/react-query";

import { stockSummary } from "@/features/pos/stock/api/stock-api";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function StockReport({ currency = "INR" }: { currency?: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stock-summary"), queryFn: stockSummary, retry: false });
  const data = query.data;
  if (!data || (data.totals.soldQuantity === 0 && data.totals.activeHolds === 0 && data.totals.recoveryRequired === 0)) return null;
  const t = data.totals;
  return (
    <PosPanel title="Stock reduction" description={`${data.from} to ${data.to}. What POS sales took from Inventory, and anything that needs reconciling.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Sold (base units)", String(t.soldQuantity)], ["Issued from stock", String(t.issuedQuantity)], ["Cost of goods", money(currency, t.costConsumed)],
          ["Lines not matching", String(t.discrepancies)], ["Bills needing stock recovery", String(t.recoveryRequired)], ["Checkout holds now", String(t.activeHolds)],
          ["Holds past expiry", String(t.overdueHolds)], ["Holds expired", String(t.expiredHolds)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Item</th><th className="pb-1 text-right">Sold</th><th className="pb-1 text-right">Cost</th></tr></thead>
          <tbody>{data.byItem.slice(0, 10).map((row) => (
            <tr key={row.sku} className="border-t border-border"><td className="py-1.5">{row.name} <span className="text-text-muted">{row.sku}</span></td>
              <td className="text-right tabular-nums">{row.quantity}{row.baseUom ? ` ${row.baseUom}` : ""}</td><td className="text-right tabular-nums">{money(currency, row.cost)}</td></tr>
          ))}</tbody>
        </table>
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Outlet / warehouse</th><th className="pb-1 text-right">Sales</th><th className="pb-1 text-right">Units</th></tr></thead>
          <tbody>{data.byOutlet.map((row) => (
            <tr key={`${row.outlet}:${row.warehouse}`} className="border-t border-border"><td className="py-1.5">{row.outlet} · {row.warehouse}</td>
              <td className="text-right tabular-nums">{row.sales}</td><td className="text-right tabular-nums">{row.quantity}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {data.discrepancies.length > 0 && (
        <div className="text-sm"><p className="font-medium text-danger-emphasis">Sale lines whose stock does not match</p>
          <ul>{data.discrepancies.map((row) => <li key={`${row.saleId}:${row.lineNumber}`}>{row.receiptNumber} line {row.lineNumber} {row.description}: sold {row.expected}, issued {row.issued}</li>)}</ul></div>
      )}
      {data.recovery.length > 0 && (
        <div className="text-sm"><p className="font-medium text-danger-emphasis">Paid bills waiting on stock</p>
          <ul>{data.recovery.map((row) => <li key={row.cartId}>{row.outlet} · {row.cartReference}: {row.message}</li>)}</ul></div>
      )}
    </PosPanel>
  );
}
