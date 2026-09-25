"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";
import { SalesAlert, SalesFacts } from "@/features/sales/shared/SalesUi";
import { checkLineAvailability, reserveLineStock } from "@/features/sales/operations/api/operations-api";
import type { SalesOrderLine } from "@/features/sales/orders/api/orders-api";

// F045/F046 -- can this line be promised, when, and why; then reserve it. Stock's
// numbers are base units (a carton of 12 is 12 units); the promise date comes
// from free stock, open purchase orders, or the supplier lead time. The
// reservation is idempotent on its key, so a retried click never reserves twice.
export function LineStockDialog({ orderId, line, onClose, onReserved }: { orderId: string; line: SalesOrderLine; onClose: () => void; onReserved: () => void }) {
  const [quantity, setQuantity] = useState<number | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const check = useQuery({ queryKey: ["sales-line-availability", orderId, line.id, quantity], queryFn: () => checkLineAvailability(orderId, line.id, quantity ?? undefined).then((r) => r.availability), retry: false });
  const reservable = check.data?.line.remainingReservableQuantity ?? 0;
  const effective = quantity ?? reservable;
  const reserve = useMutation({ mutationFn: () => reserveLineStock(orderId, line.id, effective, idempotencyKey), onSuccess: onReserved });
  const error = check.error ?? reserve.error;
  const message = error ? (error instanceof SalesApiError ? error.message : "Stock could not be checked.") : null;
  const a = check.data?.availability;
  const p = check.data?.promise;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Stock for ${line.item_name_snapshot}`}>
      <div className="flex flex-col gap-4">
        {message && <SalesAlert tone={reserve.error ? "danger" : "warning"}>{message}</SalesAlert>}
        {a && p && (
          <SalesFacts
            columns={2}
            items={[
              { label: "On hand", value: `${Number(a.onHandQuantity)} units` },
              { label: "Already reserved (all orders)", value: `${Number(a.reservedQuantity)} units` },
              { label: "Free to promise", value: `${Number(a.availableToPromise)} units` },
              { label: "This line still to reserve", value: `${reservable} ${p.unit ?? ""} (${reservable * p.conversionFactor} units)`.trim() },
              { label: "Promise date", value: p.basis === "reserved" ? "Already reserved" : (p.promisedDate ?? "Cannot promise yet") },
              { label: "Supplier lead time", value: p.supplierLeadTimeDays != null ? `${p.supplierLeadTimeDays} days` : "—" },
            ]}
          />
        )}
        {p && <SalesAlert tone={p.basis === "in_stock" || p.basis === "reserved" ? "success" : p.basis === "no_supply" ? "danger" : "warning"}>{p.explanation}</SalesAlert>}
        {p && p.incoming.length > 0 && (
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text">Incoming supply</p>
            <ul className="list-disc pl-5">
              {p.incoming.map((supply) => (
                <li key={`${supply.purchaseOrderNumber}-${supply.expectedDate}`}>
                  {supply.purchaseOrderNumber ?? "Purchase order"}: {supply.openQuantity} units{supply.expectedDate ? `, expected ${supply.expectedDate}` : ", no date yet"}
                </li>
              ))}
            </ul>
          </div>
        )}
        {reservable > 0 && <NumberField label="Quantity to reserve" value={effective} onChange={(value) => setQuantity(value)} minValue={0} maxValue={reservable} step={1} />}
        {reservable === 0 && check.data && <p className="text-sm text-text-muted">This line is already fully reserved.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => reserve.mutate()} isLoading={reserve.isPending} isDisabled={!a?.canPromise || effective <= 0}>
            Reserve stock
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
