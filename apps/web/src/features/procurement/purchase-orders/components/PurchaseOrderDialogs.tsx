"use client";

// The steps of a purchase order that need something from the user first.
// Each sends only what was entered; the server checks it against the order
// and its documents and explains any refusal.
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { quantity } from "@/features/procurement/shared/format";

import {
  errorMessage, issuesOf, orderAction, type PurchaseOrderDetail, type PurchaseOrderOptions,
} from "../api/purchase-orders-api";
import { Notice } from "@/shared/ui/Panel";

const trim = (value: string | null | undefined) => (value == null ? "" : String(Number(value)));

function Shell({ title, description, error, onClose, label, isLoading, isDisabled, onPress, children, size }: {
  title: string; description?: string; error: unknown; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void; children?: ReactNode; size?: "lg";
}) {
  const issues = issuesOf(error);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <Notice>{errorMessage(error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type DialogProps = { detail: PurchaseOrderDetail; options: PurchaseOrderOptions; onClose: () => void; onDone: (message: string) => void };

function useAction(detail: PurchaseOrderDetail, action: string, onDone: (message: string) => void, message: string | ((result: Record<string, unknown>) => string)) {
  const submit = useSubmitKey();
  return useMutation({ mutationFn: (input: Record<string, unknown>) => submit.run(() => orderAction(detail.order.id, action, input)),
    onSuccess: (result) => onDone(typeof message === "function" ? message(result ?? {}) : message) });
}

export function ConfirmDialog({ detail, onClose, onDone }: DialogProps) {
  // Under the company's approval rules a large order waits for its approver(s) first; it stays a draft until then.
  const run = useAction(detail, "confirm", onDone, (result) => {
    const pending = result.approvalRequired ? (result.pendingApproval as { level: number; approver: string | null; levels: number } | undefined) : undefined;
    if (pending) return `Sent for approval${pending.levels > 1 ? ` (level ${pending.level} of ${pending.levels})` : ""}${pending.approver ? ` to ${pending.approver}` : ""}. Confirm it again once it is approved.`;
    return detail.order.amending ? `Version ${detail.order.versionNumber + 1} confirmed.` : "The purchase order is confirmed.";
  });
  return (
    <Shell title={detail.order.amending ? `Confirm version ${detail.order.versionNumber + 1}` : "Confirm purchase order"} error={run.error} onClose={onClose} label="Confirm" isLoading={run.isPending}
      onPress={() => run.mutate({ expectedRevision: detail.order.revision })}
      description="Checks everything against today's records and keeps this as a confirmed version. No stock or payable moves.">
      <p className="text-sm">Total {detail.order.currencyCode} {Number(detail.order.grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })} for {detail.order.supplierName}.</p>
    </Shell>
  );
}

export function AmendDialog({ detail, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const run = useAction(detail, "amend", onDone, "The order is back in draft for the change. Confirm it again when it is ready.");
  return (
    <Shell title="Change purchase order" error={run.error} onClose={onClose} label="Change the order" isLoading={run.isPending} isDisabled={reason.trim().length < 3}
      onPress={() => run.mutate({ reason, expectedRevision: detail.order.revision })}
      description={`Version ${detail.order.versionNumber} stays on record. The reconfirmed order becomes version ${detail.order.versionNumber + 1} and must be sent to the supplier again.`}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

export function CancelDialog({ detail, options, onClose, onDone }: DialogProps) {
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const run = useAction(detail, "cancel", onDone, "The purchase order is cancelled.");
  return (
    <Shell title="Cancel purchase order" error={run.error} onClose={onClose} label="Cancel order" isLoading={run.isPending} isDisabled={!reasonCode}
      onPress={() => run.mutate({ reasonCode, reason, expectedRevision: detail.order.revision })} description="The order and its history stay; it can no longer be received or billed.">
      <Select label="Reason" isRequired selectedKey={reasonCode} onSelectionChange={(value) => setReasonCode(String(value))} options={options.cancelReasons.map((entry) => ({ value: entry.code, label: entry.label }))} />
      <TextArea label="Details" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function CancelRemainingDialog({ detail, options, onClose, onDone }: DialogProps) {
  const open = detail.lines.filter((line) => line.progress && (line.progress.receiptRequired ? Number(line.progress.remainingToReceive) > 0 : Number(line.progress.remainingToBill) > 0 || Number(line.progress.billed) < Number(line.orderedQuantity) - Number(line.progress.cancelled)));
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(open.map((line) => [line.id,
    trim(line.progress!.receiptRequired ? line.progress!.remainingToReceive : String(Number(line.orderedQuantity) - Number(line.progress!.cancelled) - Number(line.progress!.billed)))])));
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const run = useAction(detail, "cancel-remaining", onDone, "The outstanding quantity is cancelled. The ordered quantity is kept.");
  return (
    <Shell title="Cancel what is not received yet" error={run.error} onClose={onClose} label="Cancel quantity" isLoading={run.isPending} isDisabled={!reasonCode} size="lg"
      onPress={() => run.mutate({ reasonCode, reason, lines: Object.entries(quantities).filter(([, value]) => Number(value) > 0).map(([lineId, value]) => ({ lineId, quantity: value })) })}
      description="Only what is not received or billed can be cancelled. A billed quantity needs Finance first.">
      {open.map((line) => (
        <TextField key={line.id} label={`Line ${line.lineNumber}: ${line.description} (${line.uom.code})`} inputMode="decimal" value={quantities[line.id] ?? ""}
          onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))} description={`Ordered ${quantity(line.orderedQuantity)} · received ${quantity(line.progress?.received)} · billed ${quantity(line.progress?.billed)}`} />
      ))}
      <Select label="Reason" isRequired selectedKey={reasonCode} onSelectionChange={(value) => setReasonCode(String(value))} options={options.cancelReasons.map((entry) => ({ value: entry.code, label: entry.label }))} />
      <TextArea label="Details" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function CloseDialog({ detail, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const run = useAction(detail, "close", onDone, "The purchase order is closed.");
  return (
    <Shell title="Close purchase order" error={run.error} onClose={onClose} label="Close order" isLoading={run.isPending} onPress={() => run.mutate({ reason })}
      description="Nothing is left to receive or bill. Any amount still owed on its bills stays with Finance.">
      <TextArea label="Note" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function SendDialog({ detail, onClose, onDone }: DialogProps) {
  const [to, setTo] = useState(detail.order.contact?.email ?? detail.order.orderingAddress?.email ?? "");
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const run = useMutation({ mutationFn: () => orderAction(detail.order.id, "send", { to, cc: cc || undefined, message: message || undefined, idempotencyKey: key }),
    onSuccess: () => onDone(`Version ${detail.order.versionNumber} was emailed to ${to}.`) });
  return (
    <Shell title={`Email ${detail.order.purchaseOrderNumber}`} error={run.error} onClose={onClose} label="Send" isLoading={run.isPending} isDisabled={!to.trim()} onPress={() => run.mutate()}
      description="The PDF of the confirmed version is attached and kept with the order.">
      <TextField label="To" type="email" value={to} onChange={setTo} description={detail.order.contact ? `Ordering contact: ${detail.order.contact.name}` : undefined} />
      <TextField label="CC" value={cc} onChange={setCc} />
      <TextArea label="Message" value={message} onChange={setMessage} description="Leave empty for the standard message." />
    </Shell>
  );
}

export function MarkSentDialog({ detail, options, onClose, onDone }: DialogProps) {
  const [channel, setChannel] = useState<string | null>(null);
  const [recipient, setRecipient] = useState(detail.order.contact?.email ?? "");
  const [note, setNote] = useState("");
  const run = useAction(detail, "mark-sent", onDone, "Recorded as sent.");
  return (
    <Shell title="Mark as sent" error={run.error} onClose={onClose} label="Mark sent" isLoading={run.isPending} isDisabled={!channel} onPress={() => run.mutate({ channel, recipient, note })}
      description="The order went to the supplier another way.">
      <Select label="How" isRequired selectedKey={channel} onSelectionChange={(value) => setChannel(String(value))} options={options.sentChannels.map((entry) => ({ value: entry.code, label: entry.label }))} />
      <TextField label="Sent to" value={recipient} onChange={setRecipient} />
      <TextArea label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}

export function AcknowledgeDialog({ detail, onClose, onDone }: DialogProps) {
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const run = useAction(detail, "acknowledge", onDone, "The supplier's acknowledgement is recorded.");
  return (
    <Shell title="Supplier acknowledgement" error={run.error} onClose={onClose} label="Record" isLoading={run.isPending} onPress={() => run.mutate({ reference, note })}>
      <TextField label="Supplier's reference" value={reference} onChange={setReference} description="Their order confirmation number, if any." />
      <TextArea label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}

export function ExpectedDatesDialog({ detail, onClose, onDone }: DialogProps) {
  const [header, setHeader] = useState(detail.order.expectedDeliveryDate ?? "");
  const [lines, setLines] = useState<Record<string, string>>(() => Object.fromEntries(detail.lines.map((line) => [line.id, line.expectedDeliveryDate ?? ""])));
  const [reason, setReason] = useState("");
  const run = useAction(detail, "expected-dates", onDone, "The expected dates are updated.");
  return (
    <Shell title="Update expected delivery" error={run.error} onClose={onClose} label="Update" isLoading={run.isPending} isDisabled={reason.trim().length < 3} size="lg"
      onPress={() => run.mutate({
        reason, ...(header !== (detail.order.expectedDeliveryDate ?? "") ? { expectedDeliveryDate: header || null } : {}),
        lines: detail.lines.filter((line) => (lines[line.id] ?? "") !== (line.expectedDeliveryDate ?? "")).map((line) => ({ lineId: line.id, expectedDeliveryDate: lines[line.id] || null })),
      })} description="The confirmed version is not changed; the new dates and the reason are kept in the history.">
      <TextField label="Order expected delivery" type="date" value={header} onChange={setHeader} />
      {detail.lines.map((line) => (
        <TextField key={line.id} label={`Line ${line.lineNumber}: ${line.description}`} type="date" value={lines[line.id] ?? ""} onChange={(value) => setLines((current) => ({ ...current, [line.id]: value }))} />
      ))}
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

// Dropship (report Phase 3): the supplier delivered the goods to our customer. Records the goods receipt and the sales order's delivery
// together, for everything still to deliver.
export function DeliveredToCustomerDialog({ detail, onClose, onDone }: DialogProps) {
  const [deliveredOn, setDeliveredOn] = useState("");
  const [challan, setChallan] = useState("");
  const [tracking, setTracking] = useState("");
  const run = useAction(detail, "deliver-to-customer", onDone, "Recorded: the goods receipt and the customer's delivery.");
  const left = detail.lines.filter((line) => Number(line.progress?.remainingToReceive ?? 0) > 0);
  return (
    <Shell title="Delivered to the customer" error={run.error} onClose={onClose} label="Record delivery" isLoading={run.isPending}
      onPress={() => run.mutate({ deliveredOn: deliveredOn || undefined, supplierChallanNumber: challan.trim() || undefined, trackingReference: tracking.trim() || undefined })}
      description={`The supplier delivered to ${detail.order.dropship?.customerName ?? "the customer"}. Records the receipt and the sales delivery together; stock does not change.`}>
      <ul className="flex flex-col gap-1 text-sm">
        {left.map((line) => <li key={line.id}>{`Line ${line.lineNumber}: ${line.description} × ${quantity(line.progress?.remainingToReceive ?? "0")}`}</li>)}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Delivered on" type="date" value={deliveredOn} onChange={setDeliveredOn} description="Leave empty for today." />
        <TextField label="Supplier's challan" value={challan} onChange={setChallan} />
        <TextField label="LR / tracking number" value={tracking} onChange={setTracking} />
      </div>
    </Shell>
  );
}
