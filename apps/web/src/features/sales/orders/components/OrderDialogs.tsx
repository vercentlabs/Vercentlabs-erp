"use client";

// The steps of a sales order that need something from the user first: the
// quantities of a delivery, an invoice or a cancellation, a reason, or the
// recipient of the confirmation. Each sends only what was entered; the server
// checks the quantities against what is really left and does the arithmetic.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";
import { SalesAlert } from "@/features/sales/shared/SalesUi";

import {
  cancelSalesOrder, cancelSalesOrderRemaining, createSalesOrderDelivery, createSalesOrderInvoice, getDeliveryProposal, getInvoiceProposal, recordDeliveryReceipt,
  recordDeliveryShipment, reopenSalesOrder, type SalesOrderDelivery, type SalesOrderDetail, type SalesOrderLine,
} from "../api/orders-api";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode;
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <SalesAlert>{failureText(error, fallback)}</SalesAlert>}
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

export function CreateDeliveryDialog({ orderId, number, onClose, onDone }: { orderId: string; number: string; onClose: () => void; onDone: (deliveryNumber: string) => void }) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "delivery-proposal"),
    queryFn: () => getDeliveryProposal(orderId).then((r) => r.proposal),
    staleTime: 0, gcTime: 0,
  });
  const [values, setValues] = useState<Record<string, number>>({});
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");
  // One key per opened dialog: a double click or a retry creates one delivery.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const rows: QuantityRow[] = (proposal.data?.lines ?? []).map((line) => ({
    id: line.salesOrderLineId, name: line.itemName, unit: line.unit, max: line.remaining,
    hint: `Ordered ${amount(line.ordered)} · delivered ${amount(line.delivered)} · remaining ${amount(line.remaining)}${line.unit ? ` ${line.unit}` : ""}${line.stockTracked ? ` · reserved ${amount(line.reserved)}` : ""}`,
  }));
  const lines = chosenLines(rows, values);
  const save = useMutation({
    mutationFn: () => createSalesOrderDelivery(orderId, {
      idempotencyKey, lines, deliveryDate: deliveryDate || undefined, carrier: carrier.trim() || undefined, trackingNumber: trackingNumber.trim() || undefined, notes: notes.trim() || undefined,
    }),
    onSuccess: ({ result }) => onDone(result.deliveryNumber),
  });
  return (
    <Shell title={`Create a delivery for ${number}`} description="Enter what is delivered now. Stock is issued from each line's warehouse; what is left stays open for the next delivery."
      size="lg" error={save.error ?? proposal.error} fallback="The delivery could not be created." onClose={onClose} label="Create Delivery" isLoading={save.isPending}
      isDisabled={!lines.length} onPress={() => save.mutate()}>
      {proposal.isLoading ? <p className="text-sm text-text-muted">Loading what is left to deliver…</p>
        : !rows.length ? <p className="text-sm text-text-muted">Nothing is left to deliver on this order.</p>
          : <QuantityRows rows={rows} values={values} onChange={setValues} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Delivery date" type="date" value={deliveryDate} onChange={setDeliveryDate} />
        <TextField label="Carrier" value={carrier} onChange={setCarrier} />
        <TextField label="Tracking number" value={trackingNumber} onChange={setTrackingNumber} />
      </div>
      <TextArea label="Notes" value={notes} onChange={setNotes} />
    </Shell>
  );
}

export function CreateInvoiceDialog({ orderId, number, currencyCode, lines: orderLines, onClose, onDone }: {
  orderId: string; number: string; currencyCode: string; lines: SalesOrderLine[]; onClose: () => void; onDone: (invoiceNumber: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "invoice-proposal"),
    queryFn: () => getInvoiceProposal(orderId).then((r) => r.proposal),
    staleTime: 0, gcTime: 0,
  });
  const [values, setValues] = useState<Record<string, number>>({});
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const delivered = proposal.data?.quantityBasis === "fulfilled";
  const rows: QuantityRow[] = (proposal.data?.lines ?? []).filter((line) => line.eligible > 0).map((line) => ({
    id: line.salesOrderLineId, name: line.itemName, unit: line.unit, max: line.eligible,
    hint: `Ordered ${amount(line.ordered)}${line.isService ? "" : ` · delivered ${amount(line.delivered)}`} · invoiced ${amount(line.invoiced)} · can be invoiced now ${amount(line.eligible)}${line.unit ? ` ${line.unit}` : ""}`,
  }));
  const waiting = (proposal.data?.lines ?? []).filter((line) => line.eligible <= 0).length;
  const lines = chosenLines(rows, values);
  // Shown as a guide only: the invoice itself is calculated by the server.
  const byId = new Map(orderLines.map((line) => [line.id, line]));
  const estimate = lines.reduce((total, line) => {
    const source = byId.get(line.salesOrderLineId);
    return source && Number(source.quantity) ? total + (Number(source.line_total) * line.quantity) / Number(source.quantity) : total;
  }, 0);
  const save = useMutation({
    mutationFn: () => createSalesOrderInvoice(orderId, { idempotencyKey, lines }),
    onSuccess: ({ result }) => onDone(result.invoiceNumber),
  });
  return (
    <Shell title={`Create an invoice for ${number}`}
      description={delivered ? "Goods are invoiced once delivered; services as ordered. The invoice is created as a draft for Finance to post."
        : "Enter what is invoiced now. The invoice is created as a draft for Finance to post; what is left can be invoiced later."}
      size="lg" error={save.error ?? proposal.error} fallback="The invoice could not be created." onClose={onClose} label="Create Invoice" isLoading={save.isPending}
      isDisabled={!lines.length} onPress={() => save.mutate()}>
      {proposal.isLoading ? <p className="text-sm text-text-muted">Loading what is left to invoice…</p>
        : !rows.length ? <p className="text-sm text-text-muted">{delivered ? "Nothing delivered is left to invoice. Deliver the goods first." : "Nothing is left to invoice on this order."}</p>
          : <QuantityRows rows={rows} values={values} onChange={setValues} />}
      {delivered && waiting > 0 && rows.length > 0 && <p className="text-xs text-text-muted">{waiting} line(s) can be invoiced once delivered.</p>}
      {lines.length > 0 && (
        <p className="text-sm text-text-secondary">
          About <span className="font-medium text-text tabular-nums">{money(currencyCode, estimate)}</span> including tax. Discounts and tax are billed in proportion to the quantity.
        </p>
      )}
    </Shell>
  );
}

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

export function DeliveryShipmentDialog({ delivery, onClose, onDone }: { delivery: SalesOrderDelivery; onClose: () => void; onDone: () => void }) {
  const [carrier, setCarrier] = useState(delivery.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(delivery.tracking_number ?? "");
  const save = useMutation({ mutationFn: () => recordDeliveryShipment(delivery.id, { carrier: carrier.trim(), trackingNumber: trackingNumber.trim() || undefined }), onSuccess: onDone });
  return (
    <Shell title={`Shipment of ${delivery.delivery_number}`} error={save.error} fallback="The shipment could not be saved." onClose={onClose} label="Save shipment"
      isLoading={save.isPending} isDisabled={!carrier.trim()} onPress={() => save.mutate()}>
      <TextField label="Carrier" isRequired value={carrier} onChange={setCarrier} />
      <TextField label="Tracking number" value={trackingNumber} onChange={setTrackingNumber} />
    </Shell>
  );
}

export function DeliveryReceiptDialog({ delivery, onClose, onDone }: { delivery: SalesOrderDelivery; onClose: () => void; onDone: () => void }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => recordDeliveryReceipt(delivery.id, { receivedBy: receivedBy.trim(), note: note.trim() || undefined }), onSuccess: onDone });
  return (
    <Shell title={`${delivery.delivery_number} received by the customer`} error={save.error} fallback="The receipt could not be saved." onClose={onClose} label="Mark received"
      isLoading={save.isPending} isDisabled={!receivedBy.trim()} onPress={() => save.mutate()}>
      <TextField label="Received by" isRequired value={receivedBy} onChange={setReceivedBy} />
      <TextField label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}
