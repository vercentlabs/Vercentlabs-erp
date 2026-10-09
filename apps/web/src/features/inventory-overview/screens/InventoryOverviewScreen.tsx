"use client";

// The Inventory Overview, in CRM's shape: what needs attention today. Four headline stock figures, today's operations and what needs attention
// side by side, the stock by disposition, and recent activity — with the Inventory search and the negative-stock alert at the top. Every number
// opens the list behind it; each part shows only what the user may see (null figures are left out).
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { ErrorState, PermissionState } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { NegativeStockAlert } from "@/features/negative-stock/components/NegativeStockAlert";
import { ModuleCreateMenu } from "@/shell/app-shell/ModuleCreateMenu";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityList, CountList, OverviewCards, OverviewHeader, OverviewPanel, TileGrid } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Overview = {
  stock: { onHand: number; available: number; reserved: number; restricted: number; inTransit: number; negative: number };
  attention: Record<"outOfStock" | "replenishmentRequired" | "lowStock" | "qualityHolds" | "reservationExceptions" | "negativeStock" | "countsInProgress", number | null>;
  operations: Record<"pendingTransfers" | "receiptsToday" | "issuesToday" | "openCounts" | "holdsDue", number | null>;
  recent: Array<{ id: string; label: string; source: { number: string | null; label: string }; item: { sku: string; name: string } | null; items: number; quantity: number | null;
    uom: string | null; from: string; to: string; postedAt: string; href: string }> | null;
  actions: Record<"goodsIssue" | "transfer" | "adjustment" | "stockCount" | "qualityHold", boolean>;
};
type SearchResult = { kind: string; kindLabel: string; id: string; title: string; subtitle: string | null; href: string };

class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new ApiError(payload.message || "The request could not be completed.", response.status);
  return payload;
}

export function InventoryOverviewScreen() {
  const workspace = useWorkspaceContext();
  const overview = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "overview"), queryFn: () => read<{ overview: Overview }>("/api/inventory/overview").then((r) => r.overview) });
  if (overview.isError && overview.error instanceof ApiError && overview.error.status === 403)
    return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant View stock." />;
  const data = overview.data;
  return (
    <div className="flex flex-1 flex-col gap-6">
      <OverviewHeader description="What needs your attention today, across the warehouses you can see. Every number opens the list behind it."
        action={<ModuleCreateMenu moduleKey="stock" />} />
      <NegativeStockAlert />
      <InventorySearch />
      {overview.isLoading ? <LoadingState label="Loading inventory" rows={5} />
        : overview.isError || !data ? <ErrorState title="Could not load the inventory overview" description={overview.error instanceof Error ? overview.error.message : ""} action={{ label: "Try again", onPress: () => void overview.refetch() }} />
        : (
          <>
            <OverviewCards label="Stock" cards={[
              { label: "On hand", value: quantity(data.stock.onHand), href: "/inventory/stock" },
              { label: "Available", value: quantity(data.stock.available), href: "/inventory/stock?view=available" },
              { label: "Reserved", value: quantity(data.stock.reserved), href: "/inventory/stock?view=reserved" },
              { label: "Out of stock", value: data.attention.outOfStock, href: "/inventory/replenishment?tab=alerts&alerts=out_of_stock" },
            ]} />

            <div className="grid gap-6 lg:grid-cols-2">
              <OverviewPanel title="Today's operations">
                <CountList empty="You cannot see stock operations." rows={[
                  { label: "Goods receipts today", value: data.operations.receiptsToday, href: "/inventory/goods-receipts" },
                  { label: "Goods issues today", value: data.operations.issuesToday, href: "/inventory/goods-issues?view=posted" },
                  { label: "Pending transfers", value: data.operations.pendingTransfers, href: "/inventory/transfers" },
                  { label: "Open stock counts", value: data.operations.openCounts, href: "/inventory/stock-counts" },
                  { label: "Quality holds due for review", value: data.operations.holdsDue, href: "/inventory/quality-holds?view=overdue", tone: "warning" },
                ]} />
              </OverviewPanel>

              <OverviewPanel title="Needs attention">
                <CountList empty="Nothing needs attention." rows={[
                  { label: "Out of stock", value: data.attention.outOfStock, href: "/inventory/replenishment?tab=alerts&alerts=out_of_stock", tone: "danger" },
                  { label: "Replenishment required", value: data.attention.replenishmentRequired, href: "/inventory/replenishment?tab=required", tone: "warning" },
                  { label: "Low stock, covered by incoming", value: data.attention.lowStock, href: "/inventory/replenishment?tab=covered" },
                  { label: "Quality holds", value: data.attention.qualityHolds, href: "/inventory/quality-holds" },
                  { label: "Reservation exceptions", value: data.attention.reservationExceptions, href: "/inventory/reservations?view=exceptions", tone: "warning" },
                  { label: "Negative stock positions", value: data.attention.negativeStock, href: "/inventory/negative-stock", tone: "danger" },
                  { label: "Counts in progress", value: data.attention.countsInProgress, href: "/inventory/stock-counts?view=in_progress" },
                ]} />
              </OverviewPanel>
            </div>

            <OverviewPanel title="Stock by status">
              <TileGrid tiles={[
                { key: "available", label: "Available", value: quantity(data.stock.available), caption: "Free to sell or issue", href: "/inventory/stock?view=available" },
                { key: "reserved", label: "Reserved", value: quantity(data.stock.reserved), caption: "Held for orders and transfers", href: "/inventory/stock?view=reserved" },
                { key: "restricted", label: "Restricted", value: quantity(data.stock.restricted), caption: "On hold, quarantined, damaged or expired", href: "/inventory/stock?view=restricted" },
                { key: "transit", label: "In transit", value: quantity(data.stock.inTransit), caption: "Between warehouses", href: "/inventory/stock?view=in_transit" },
                { key: "negative", label: "Negative", value: quantity(data.stock.negative), caption: "Below zero by override", href: "/inventory/stock?view=negative" },
              ]} />
              <p className="text-xs text-text-muted">Quantities summed across items in their base units: a guide to volume, not a single unit of measure.</p>
            </OverviewPanel>

            {data.recent && (
              <OverviewPanel title="Recent activity" action={<Link className="text-sm font-medium text-brand hover:underline" href="/inventory/transactions?tab=movements&mode=events">Movement history</Link>}>
                <ActivityList empty="Nothing has moved yet." entries={data.recent.map((entry) => ({
                  key: entry.id, href: entry.href, title: entry.source.number ?? entry.label,
                  summary: `${entry.label} · ${entry.item ? entry.item.sku : `${entry.items} items`} · ${entry.from} → ${entry.to}${entry.quantity === null ? "" : ` · ${quantity(entry.quantity, entry.uom ?? undefined)}`}`,
                  meta: formatDateTime(entry.postedAt),
                }))} />
              </OverviewPanel>
            )}
          </>
        )}
    </div>
  );
}

// One search for SKU, item, barcode, warehouse, location, batch, serial and every stock document; each result opens its own page.
export function InventorySearch() {
  const workspace = useWorkspaceContext();
  const [term, setTerm] = useState("");
  const query = term.trim();
  const results = useQuery({
    queryKey: scopedQueryKey(workspace, "inventory", "search", query),
    queryFn: () => read<{ results: SearchResult[] }>(`/api/inventory/search?q=${encodeURIComponent(query)}`).then((r) => r.results),
    enabled: query.length >= 2, staleTime: 15_000,
  });
  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 focus-within:border-brand">
        <Search aria-hidden="true" className="size-4 text-text-muted" />
        <input type="search" aria-label="Search inventory" placeholder="Search SKU, item, barcode, warehouse, location, batch, serial, GRN, issue, transfer, count, hold, PO or SO"
          value={term} onChange={(event) => setTerm(event.target.value)} className="w-full bg-transparent text-sm outline-none" />
      </label>
      {query.length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-subtle)]">
          {results.isLoading ? <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>
            : !results.data?.length ? <p className="px-3 py-2 text-sm text-text-muted">Nothing found.</p>
            : <ul className="divide-y divide-border">{results.data.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}><Link href={entry.href} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-muted">
                <span><span className="font-medium">{entry.title}</span>{entry.subtitle && <span className="ml-2 text-text-muted">{entry.subtitle}</span>}</span>
                <span className="text-xs text-text-muted">{entry.kindLabel}</span></Link></li>))}</ul>}
        </div>)}
    </div>
  );
}
