"use client";

// The steps of a sales order that need something from the user first: the
// quantities of a cancellation or a reason (a delivery's, an invoice's and the
// confirmation's are in their own features). Each sends only what was
// entered; the server checks the quantities against what is really left.
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";

import {
  cancelSalesOrder, cancelSalesOrderRemaining, reopenSalesOrder, type SalesOrderDetail,
} from "../api/orders-api";
import { Notice } from "@/shared/ui/Panel";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode;
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <Notice>{failureText(error, fallback)}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// One row per line: what is left, and the quantity for this document.
type QuantityRow = { id: string; name: string; unit: string | null; max: number; hint: string };
function QuantityRows({ rows, values, onChange }: { rows: QuantityRow[]; values: Record<string, number>; onChange: (next: Record<string, number>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <span className="flex flex-col text-sm">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-text-muted">{row.hint}</span>
          </span>
          <NumberField aria-label={`Quantity of ${row.name}`} value={values[row.id] ?? row.max} minValue={0} maxValue={row.max} step={1}
            onChange={(value) => onChange({ ...values, [row.id]: Number.isFinite(value) ? value : 0 })} />
        </div>
      ))}
    </div>
  );
}
const chosenLines = (rows: QuantityRow[], values: Record<string, number>) =>
  rows.map((row) => ({ salesOrderLineId: row.id, quantity: values[row.id] ?? row.max })).filter((line) => line.quantity > 0);

export function CancelRemainingDialog({ orderId, detail, onClose, onDone }: { orderId: string; detail: SalesOrderDetail; onClose: () => void; onDone: () => void }) {
  // A product can lose what is not yet delivered; a service what is not yet invoiced.
  const rows: QuantityRow[] = detail.lines.map((line) => {
    const max = line.is_service ? line.remaining_to_invoice : Math.min(line.remaining_to_deliver, Math.max(0, line.ordered_quantity - line.cancelled_quantity - line.invoiced_quantity));
    return {
      id: line.id, name: line.item_name_snapshot, unit: line.uom_snapshot, max,
      hint: `Ordered ${amount(line.ordered_quantity)} · ${line.is_service ? `invoiced ${amount(line.invoiced_quantity)}` : `delivered ${amount(line.delivered_quantity)}`} · can be cancelled ${amount(max)}${line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}`,
    };
  }).filter((row) => row.max > 0);
  const [values, setValues] = useState<Record<string, number>>({});
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const lines = chosenLines(rows, values);
  const save = useMutation({ mutationFn: () => cancelSalesOrderRemaining(orderId, { lines, reasonCode: reasonCode || undefined, reason: reason.trim() || undefined }), onSuccess: onDone });
  return (
    <Shell title={`Cancel the remaining quantity of ${detail.order.sales_order_number}`}
      description="What was delivered and invoiced stays. The ordered quantity is kept and the cancelled quantity is recorded beside it; stock reserved for it is released."
      size="lg" error={save.error} fallback="The quantity could not be cancelled." onClose={onClose} label="Cancel Remaining" isLoading={save.isPending}
      isDisabled={!lines.length || !reasonCode || (reasonCode === "other" && !reason.trim())} onPress={() => save.mutate()}>
      {rows.length ? <QuantityRows rows={rows} values={values} onChange={setValues} /> : <p className="text-sm text-text-muted">Nothing is left to cancel on this order.</p>}
      <Select label="Reason" isRequired placeholder="Choose a reason" options={detail.cancelReasons.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={reasonCode || null} onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
      <TextArea label="Details" isRequired={reasonCode === "other"} value={reason} onChange={setReason} />
    </Shell>
  );
}

export function CancelOrderDialog({ orderId, number, reasons, reasonRequired, onClose, onDone }: {
  orderId: string; number: string; reasons: Array<{ code: string; label: string }>; reasonRequired: boolean; onClose: () => void; onDone: () => void;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelSalesOrder(orderId, { reasonCode: reasonCode || undefined, reason: reason.trim() || undefined }), onSuccess: onDone });
  return (
    <Shell title={`Cancel ${number}?`} description="The order is kept for the record and its stock reservations are released. A cancelled order cannot be confirmed again."
      error={save.error} fallback="The order could not be cancelled." onClose={onClose} label="Cancel Order" isLoading={save.isPending}
      isDisabled={(reasonRequired && !reasonCode) || (reasonCode === "other" && !reason.trim())} onPress={() => save.mutate()}>
      <Select label="Reason" isRequired={reasonRequired} placeholder="Choose a reason" options={reasons.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={reasonCode || null} onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
      <TextArea label="Details" isRequired={reasonCode === "other"} value={reason} onChange={setReason} />
    </Shell>
  );
}

export function ReopenOrderDialog({ orderId, number, onClose, onDone }: { orderId: string; number: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => reopenSalesOrder(orderId, reason.trim()), onSuccess: onDone });
  return (
    <Shell title={`Reopen ${number} to draft?`} description="The order becomes a draft again so it can be changed: its current Order Confirmation is superseded (kept as history) and the stock reserved for it is released. Confirming it again makes the next revision."
      error={save.error} fallback="The order could not be reopened." onClose={onClose} label="Reopen to Draft" isLoading={save.isPending} isDisabled={!reason.trim()} onPress={() => save.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}
