"use client";

// The bill's stock at checkout: reserved at this store's warehouse while the customer pays, consumed automatically when the sale completes.
// The cashier never reduces stock by hand; this only shows what is held, until when, and anything that needs attention.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import { STOCK_STATUS_LABEL, STOCK_STATUS_TONE, checkoutStock, renewCheckoutStock } from "@/features/pos/stock/api/stock-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const amount = (value: number | null, unit: string | null) => (value === null ? "—" : `${value}${unit ? ` ${unit}` : ""}`);

export function CheckoutStockPanel({ cartId, version, inCheckout }: { cartId: string; version: number; inCheckout: boolean }) {
  const workspace = useWorkspaceContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "checkout-stock", cartId, version, inCheckout),
    queryFn: () => checkoutStock(cartId),
    retry: false,
    refetchInterval: inCheckout ? 30_000 : false,
  });
  const stock = query.data;
  if (!stock || stock.status === "NOT_REQUIRED") return null;
  if (!inCheckout && !stock.recovery) return null;
  const stocked = stock.lines.filter((line) => line.stocked);
  const renew = async () => {
    setBusy(true);
    setError(null);
    try { await renewCheckoutStock(cartId); await query.refetch(); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Stock could not be reserved. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <PosPanel
      title="Checkout stock check"
      description={stock.warehouse ? `${stock.warehouse.store} · ${stock.warehouse.name}` : stock.warehouseError?.message}
      actions={<StatusBadge tone={STOCK_STATUS_TONE[stock.status] ?? "neutral"}>{STOCK_STATUS_LABEL[stock.status] ?? stock.status}</StatusBadge>}
    >
      <ul className="flex flex-col gap-2 text-sm">
        {stocked.map((line) => (
          <li key={line.lineId} className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{line.description}{line.sku ? <span className="text-text-muted"> · {line.sku}</span> : null}</span>
              <StatusBadge tone={STOCK_STATUS_TONE[line.status] ?? "neutral"}>{STOCK_STATUS_LABEL[line.status] ?? line.status}</StatusBadge>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-text-muted">To sell</dt><dd className="tabular-nums">{amount(line.quantity, line.uom)}{line.uom !== line.baseUom ? ` = ${amount(line.baseQuantity, line.baseUom)}` : ""}</dd></div>
              <div><dt className="text-text-muted">Available before reservation</dt><dd className="tabular-nums">{amount(line.availableBeforeReservation, line.baseUom)}</dd></div>
              <div><dt className="text-text-muted">Allocated for this checkout</dt><dd className="tabular-nums">{amount(line.reserved, line.baseUom)}</dd></div>
            </dl>
            {line.allocations.filter((allocation) => allocation.status === "active" && (allocation.batch || allocation.serial)).map((allocation) => (
              <p key={allocation.id} className="text-xs text-text-muted">{allocation.serial ? `Serial ${allocation.serial}` : `Batch ${allocation.batch}`}{allocation.location !== "MAIN" ? ` · ${allocation.location}` : ""}</p>
            ))}
          </li>
        ))}
      </ul>
      {stock.status === "RESERVED" && stock.expiresAt && <p className="text-xs text-text-muted">Stock reserved for this checkout until {dateTime(stock.expiresAt)}.</p>}
      {stock.status === "EXPIRED" && <p className="text-sm text-warning-emphasis">Stock reservation expired. Checking availability again when you take payment.</p>}
      {stock.recovery?.status === "required" && (
        <p className="text-sm text-danger-emphasis">The payment was received but the sale could not take its stock: {stock.recovery.message}. Try completing the sale again, or refund the payment.</p>
      )}
      {inCheckout && ["RESERVED", "EXPIRED", "PARTLY_RESERVED", "RECOVERY_REQUIRED"].includes(stock.status) && (
        <div><Button size="compact" variant="ghost" isLoading={busy} onPress={renew}>Keep stock reserved</Button></div>
      )}
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
    </PosPanel>
  );
}
