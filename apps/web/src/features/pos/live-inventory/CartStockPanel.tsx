"use client";

// The bill's items against the store's stock now, kept live: each line's availability in plain words (In Stock, Only 2 Left, Out of Stock,
// Not Tracked), a warning when the bill asks for more than there is, and — for one item — its stock in detail (on hand and reserved for those
// who may see Inventory; eligible batches and serial numbers). A draft bill reserves nothing; checkout checks and reserves again.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import { STATUS_TONE, cartAvailability, itemStock } from "@/features/pos/live-inventory/api/live-inventory-api";
import { LiveStockIndicator, useLiveInventory } from "@/features/pos/live-inventory/LiveInventory";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

function ItemStockDetail({ itemId, cartId }: { itemId: string; cartId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "item-stock", itemId, cartId), queryFn: () => itemStock(itemId, { cartId }), retry: false });
  const stock = query.data;
  if (query.isError) return <p className="text-xs text-danger-emphasis">{query.error instanceof PosApiError ? query.error.message : "Stock cannot be checked right now."}</p>;
  if (!stock) return <p className="text-xs text-text-muted">Checking stock…</p>;
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-xs">
      <p className="text-text-muted">{stock.storeName} · {stock.warehouseName}{stock.lastUpdatedAt ? ` · updated ${dateTime(stock.lastUpdatedAt)}` : ""}</p>
      <dl className="grid grid-cols-4 gap-2">
        {stock.onHandQuantity !== undefined && <div><dt className="text-text-muted">On hand</dt><dd className="tabular-nums">{stock.onHandQuantity}</dd></div>}
        {stock.reservedQuantity !== undefined && <div><dt className="text-text-muted">Reserved</dt><dd className="tabular-nums">{stock.reservedQuantity}</dd></div>}
        {stock.nonSellableQuantity !== undefined && <div><dt className="text-text-muted">Not sellable</dt><dd className="tabular-nums">{stock.nonSellableQuantity}</dd></div>}
        <div><dt className="text-text-muted">Available</dt><dd className="font-semibold tabular-nums">{stock.availableQuantity ?? "—"}{stock.baseUom ? ` ${stock.baseUom}` : ""}</dd></div>
      </dl>
      {stock.batches.length > 0 && <p>Batches: {stock.batches.map((batch) => `${batch.batchNumber} (${batch.availableQuantity}${batch.expiresOn ? `, exp ${batch.expiresOn}` : ""})`).join(" · ")}</p>}
      {stock.trackingType === "SERIAL" && <p>Serial numbers available: {stock.serials.length ? stock.serials.map((serial) => serial.serialNumber).join(", ") : "none"}</p>}
      <p className="text-text-muted">Availability is verified again when checkout begins.</p>
    </div>
  );
}

export function CartStockPanel({ cartId, version }: { cartId: string; version: number }) {
  const workspace = useWorkspaceContext();
  const live = useLiveInventory();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cart-availability", cartId, version),
    queryFn: () => cartAvailability(cartId),
    retry: false,
    // Without the live stream, the figures are checked again every 20 seconds.
    refetchInterval: live.status === "live" ? false : 20_000,
  });
  const data = query.data;
  if ((!data && !query.isError) || (data && !data.lines.length)) return null;
  return (
    <PosPanel title="Stock" description={data ? `${data.storeName} · ${data.warehouseName}` : undefined} actions={<LiveStockIndicator />}>
      {query.isError && <p className="text-sm text-danger-emphasis">{query.error instanceof PosApiError ? query.error.message : "Stock cannot be checked right now."}</p>}
      {live.stale && data && (
        <p className="text-sm text-warning-emphasis">
          {live.status === "offline" ? "Live stock updates are disconnected." : "Reconnecting and updating stock."} Figures may be out of date; checkout checks stock again.
        </p>
      )}
      {data && (
        <ul className="flex flex-col gap-2 text-sm">
          {data.lines.map((line) => (
            <li key={line.lineId} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="compact" variant="ghost" onPress={() => setOpen(open === line.itemId ? null : line.itemId)}>{line.description}</Button>
                <span className="flex items-center gap-2">
                  {line.availableQuantity !== null && line.stockStatus !== "LOW_STOCK" && <span className="text-xs text-text-muted tabular-nums">{line.availableQuantity} available</span>}
                  <StatusBadge tone={STATUS_TONE[line.stockStatus] ?? "neutral"}>{line.statusLabel}</StatusBadge>
                </span>
              </div>
              {line.warning && <p className="text-xs text-danger-emphasis">{line.warning.message}</p>}
              {open === line.itemId && <ItemStockDetail itemId={line.itemId} cartId={cartId} />}
            </li>
          ))}
        </ul>
      )}
    </PosPanel>
  );
}
