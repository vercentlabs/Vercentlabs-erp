"use client";

// Inventory Valuation on an item and on a warehouse, for those who may see stock value: the method, and per warehouse (or item) quantity,
// value and rate, with links to the valuation history, FIFO layers, stock ledger and reconciliation. Nothing is editable: there is no
// "current cost" or "inventory value" field anywhere.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { money, quantity } from "@/features/items/item-format";
import { formatDate } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { VALUATION_BASE, getItemValuation, getWarehouseValuation } from "../api/valuation-api";

export function ItemValuationCard({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const valuation = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "item", itemId), queryFn: () => getItemValuation(itemId), retry: false });
  if (!valuation.data) return null;
  const data = valuation.data;
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
      <h2 className="font-medium">Valuation</h2>
      <p>Valuation method: <span className="font-medium">{data.item.methodLabel}</span>{data.item.methodLocked ? <span className="text-text-muted"> · fixed (stock has moved)</span> : null}</p>
      {data.warehouses.length === 0 ? <p className="text-text-muted">No stock to value.</p> : (
        <ul className="flex flex-col gap-1">
          {data.warehouses.map((row) => <li key={row.key} className={row.negative ? "text-danger" : ""}>{row.warehouse}: {quantity(row.onHand ?? 0, data.item.baseUom)} · value {money(row.value)}
            {row.rate !== undefined && row.rate !== null ? ` · rate ${money(row.rate)}${row.rateKind === "carrying" ? " (carrying)" : ""}` : ""}{row.negative ? " · provisional (negative stock)" : ""}</li>)}
        </ul>
      )}
      <p className="font-medium">Company: {quantity(data.total.quantity ?? 0, data.item.baseUom)} · {money(data.total.value)}</p>
      <div className="flex flex-wrap gap-3">
        {data.capabilities.movements && <Link className="text-brand hover:underline" href={`${VALUATION_BASE}?itemId=${itemId}`}>View valuation history</Link>}
        {data.capabilities.layers && data.item.method === "fifo" && <Link className="text-brand hover:underline" href={`${VALUATION_BASE}?itemId=${itemId}`}>View FIFO layers</Link>}
        <Link className="text-brand hover:underline" href={`/inventory/transactions?tab=ledger&itemId=${itemId}`}>View stock ledger</Link>
        {data.capabilities.finance && <Link className="text-brand hover:underline" href={VALUATION_BASE}>View finance reconciliation</Link>}
      </div>
    </section>
  );
}

export function WarehouseValuationCard({ warehouseId }: { warehouseId: string }) {
  const workspace = useWorkspaceContext();
  const valuation = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "warehouse", warehouseId), queryFn: () => getWarehouseValuation(warehouseId), retry: false });
  if (!valuation.data) return null;
  const data = valuation.data;
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
      <h2 className="font-medium">Inventory value: {money(data.total)}</h2>
      {data.items.length === 0 ? <p className="text-text-muted">No stock to value.</p> : (
        <ul className="flex flex-col gap-1">{data.items.slice(0, 15).map((row) => <li key={row.key}>{row.sku} · {row.itemName}: {quantity(row.onHand ?? 0, row.baseUom)} · {money(row.value)}</li>)}</ul>
      )}
      {data.items.length > 15 && <Link className="text-brand hover:underline" href={`${VALUATION_BASE}?warehouseId=${warehouseId}`}>All {data.items.length} items</Link>}
      {data.movements.length > 0 && <div><p className="font-medium">Recent value movements</p>
        <ul className="flex flex-col gap-0.5">{data.movements.slice(0, 8).map((row) => <li key={row.id}>{formatDate(row.date)} · {row.type} · {row.sku} · {row.value > 0 ? "+" : ""}{money(row.value)}</li>)}</ul></div>}
    </section>
  );
}
