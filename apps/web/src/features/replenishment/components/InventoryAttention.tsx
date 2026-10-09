"use client";

// Inventory Attention: live low-stock alerts by condition (out of stock, replenishment required, low stock covered) and open negative-stock
// exceptions, for the company or one warehouse. Each number opens the matching list. Shown only to those who may see low-stock alerts.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { REPLENISHMENT_BASE, getAlertCounts } from "../api/replenishment-api";

export function InventoryAttention({ warehouseId }: { warehouseId?: string }) {
  const workspace = useWorkspaceContext();
  const counts = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "alert-counts", warehouseId ?? "all"), queryFn: () => getAlertCounts(warehouseId), staleTime: 30_000 });
  const data = counts.data;
  if (!data) return null;
  const scope = warehouseId ? `&warehouseId=${warehouseId}` : "";
  const tiles = [
    { label: "Out of stock", value: data.outOfStock, href: `${REPLENISHMENT_BASE}?tab=alerts&alerts=out_of_stock${scope}`, tone: data.outOfStock ? "text-danger" : "" },
    { label: "Replenishment required", value: data.replenishmentRequired, href: `${REPLENISHMENT_BASE}?tab=alerts&alerts=replenishment_required${scope}`, tone: data.replenishmentRequired ? "text-warning" : "" },
    { label: "Low stock — covered", value: data.lowStock, href: `${REPLENISHMENT_BASE}?tab=alerts&alerts=low_stock${scope}`, tone: "" },
    { label: "Negative stock", value: data.negativeStock, href: "/inventory/negative-stock", tone: data.negativeStock ? "text-danger" : "" },
  ];
  return (
    <section aria-label="Inventory attention" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Inventory attention</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 hover:bg-surface-muted">
            <p className="text-xs text-text-muted">{tile.label}</p><p className={`text-lg font-semibold tabular-nums ${tile.tone}`}>{tile.value}</p>
          </Link>))}
      </div>
    </section>
  );
}
