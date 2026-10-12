"use client";

// A sale's Inventory movements: what left which warehouse, location, batch or serial, the checkout reservation it consumed and its cost from
// Inventory valuation (never the selling price) — and whether the sale's quantities and the movements agree. Posted movements are never edited.
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { saleStockMovements } from "@/features/pos/stock/api/stock-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function SaleStockMovements({ saleId, currency }: { saleId: string; currency: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "sale-stock", saleId), queryFn: () => saleStockMovements(saleId), retry: false });
  const stock = query.data;
  if (!stock || (!stock.movements.length && stock.reconciliation.every((line) => !line.stocked))) return null;
  const matched = stock.inventoryReconciliationStatus === "MATCHED";
  return (
    <PosPanel
      title="Stock movements"
      description={`Posted automatically when the sale completed. Cost of goods ${money(currency, stock.costConsumed)} from Inventory valuation.`}
      actions={<StatusBadge tone={matched ? "success" : "danger"}>{matched ? "Sale and Inventory agree" : "Needs reconciliation"}</StatusBadge>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Movement</th><th className="pb-1 text-left">Item</th><th className="pb-1 text-left">From</th>
            <th className="pb-1 text-right">Quantity</th><th className="pb-1 text-right">Cost</th><th className="pb-1 text-left">Reservation</th><th className="pb-1 text-left">Posted</th></tr></thead>
          <tbody>{stock.movements.map((movement) => (
            <tr key={movement.id} className="border-t border-border align-top">
              <td className="py-1.5">{movement.number}</td>
              <td>{movement.description}{movement.batch ? ` · batch ${movement.batch}` : ""}{movement.serial ? ` · S/N ${movement.serial}` : ""}</td>
              <td>{movement.warehouse}{movement.location !== "MAIN" ? ` / ${movement.location}` : ""}</td>
              <td className="text-right tabular-nums">{movement.quantity}{movement.baseUom ? ` ${movement.baseUom}` : ""}</td>
              <td className="text-right tabular-nums">{money(currency, movement.value)}</td>
              <td>{movement.reservation ?? "—"}</td>
              <td>{dateTime(movement.postedAt)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!matched && (
        <ul className="text-sm text-danger-emphasis">{stock.reconciliation.filter((line) => line.status !== "MATCHED").map((line) => (
          <li key={line.lineId}>Line {line.lineNumber} {line.description}: sold {line.expectedBaseQuantity}, issued {line.issuedBaseQuantity}.</li>
        ))}</ul>
      )}
    </PosPanel>
  );
}
