"use client";

// The steps of a sales invoice that need something from the user first. Each
// sends only what was entered; the server checks quantities against what is
// really left to invoice, checks everything again at posting, and does all
// the arithmetic (values come from the order as agreed).
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { SalesAlert } from "@/features/sales/shared/SalesUi";

import {
  cancelInvoice, changeInvoiceDueDate, createInvoiceFromDelivery, createInvoiceFromOrder, getInvoiceProposal, markInvoiceSent, postInvoice, reverseInvoice, sendInvoice,
  updateDraftInvoice, validateInvoice, type InvoiceDetail,
} from "../api/invoices-api";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const optional = (value: string) => value.trim() || undefined;
const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : "");

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children, tone = "primary" }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode; tone?: "primary" | "danger";
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <SalesAlert>{failureText(error, fallback)}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type QuantityRow = { id: string; name: string; unit: string | null; max: number; initial: number; hint: string };
function QuantityRows({ rows, values, onChange }: { rows: QuantityRow[]; values: Record<string, number>; onChange: (next: Record<string, number>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <span className="flex flex-col text-sm">
            <span className="font-medium">{row.name}</span>
            <span className="text-xs text-text-muted">{row.hint}</span>
          </span>
          <NumberField aria-label={`Quantity of ${row.name}`} value={values[row.id] ?? row.initial} minValue={0} maxValue={row.max} step={1}
            onChange={(value) => onChange({ ...values, [row.id]: Number.isFinite(value) ? value : 0 })} />
        </div>
      ))}
    </div>
  );
}
const chosen = (rows: QuantityRow[], values: Record<string, number>) => rows.map((row) => ({ id: row.id, quantity: values[row.id] ?? row.initial })).filter((line) => line.quantity > 0);

// From a confirmed order: a Draft invoice for what can be invoiced now, on the company's basis.
export function CreateInvoiceDialog({ orderId, number, onClose, onDone }: { orderId: string; number: string; onClose: () => void; onDone: (invoiceId: string) => void }) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "invoice-proposal"),
    queryFn: () => getInvoiceProposal(orderId).then((r) => r.proposal),
    staleTime: 0, gcTime: 0,
  });
  const delivered = proposal.data?.basis === "delivered";
  const rows: QuantityRow[] = (proposal.data?.lines ?? []).filter((line) => line.eligible > 0).map((line) => ({
    id: line.salesOrderLineId, name: line.itemName, unit: line.unit, max: line.eligible, initial: line.eligible,
    hint: [`Ordered ${amount(line.ordered)}`, !line.isService ? `delivered ${amount(line.delivered)}` : null, line.cancelled ? `cancelled ${amount(line.cancelled)}` : null,
      `invoiced ${amount(line.invoiced)}`, `available to invoice ${amount(line.eligible)}${line.unit ? ` ${line.unit}` : ""}`,
      line.pendingDelivery ? `${amount(line.pendingDelivery)} awaiting delivery` : null,
      line.onDrafts ? `also on draft ${line.draftInvoices.map((draft) => `${draft.invoiceNumber} (${amount(draft.quantity)})`).join(", ")}` : null].filter(Boolean).join(" · "),
  }));
  const waiting = (proposal.data?.lines ?? []).filter((line) => line.eligible <= 0);
  const [values, setValues] = useState<Record<string, number>>({});
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const lines = chosen(rows, values).map((line) => ({ salesOrderLineId: line.id, quantity: line.quantity }));
  const save = useMutation({
    mutationFn: () => createInvoiceFromOrder(orderId, { idempotencyKey, lines, customerNotes: optional(customerNotes), internalNotes: optional(internalNotes) }),
    onSuccess: ({ result }) => onDone(result.invoiceId),
  });
  return (
    <Shell title={`Invoice ${number}`}
      description={delivered ? "Goods are invoiced once delivered; services as ordered. The invoice is created as a draft: check it, then post it."
        : "Enter what is invoiced now; what is left can be invoiced later. The invoice is created as a draft: check it, then post it."}
      size="lg" error={save.error ?? proposal.error} fallback="The invoice could not be created." onClose={onClose} label="Create Draft Invoice" isLoading={save.isPending}
      isDisabled={!lines.length} onPress={() => save.mutate()}>
      {proposal.isLoading ? <p className="text-sm text-text-muted">Loading what is left to invoice…</p>
        : !rows.length ? <p className="text-sm text-text-muted">{delivered ? "Nothing delivered is left to invoice. Deliver the goods first." : "Nothing is left to invoice on this order."}</p>
          : <QuantityRows rows={rows} values={values} onChange={setValues} />}
      {waiting.length > 0 && rows.length > 0 && <p className="text-xs text-text-muted">{waiting.map((line) => line.itemName).join(", ")}: nothing to invoice now.</p>}
      {(proposal.data?.lines ?? []).some((line) => line.onDrafts > 0 && line.eligible > 0) && (
        <SalesAlert tone="warning">Other draft invoices already bill some of these lines. Drafts are not invoiced: whichever is posted first goes through, and the rest are refused for what is no longer left.</SalesAlert>
      )}
      <TextArea label="Customer notes" description="Printed on the invoice. Left empty, the order's customer notes are used." value={customerNotes} onChange={setCustomerNotes} />
      <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

// From a dispatched delivery: a Draft invoice for what it delivered and is not yet invoiced.
export function DeliveryInvoiceDialog({ deliveryId, number, lines: deliveryLines, onClose, onDone }: {
  deliveryId: string; number: string; lines: Array<{ id: string; item_name_snapshot: string; uom_snapshot: string | null; quantity: number; invoiced_quantity: number }>;
  onClose: () => void; onDone: (invoiceId: string) => void;
}) {
  const rows: QuantityRow[] = deliveryLines.map((line) => ({ line, max: Math.max(0, line.quantity - line.invoiced_quantity) })).filter((row) => row.max > 0).map(({ line, max }) => ({
    id: line.id, name: line.item_name_snapshot, unit: line.uom_snapshot, max, initial: max,
    hint: `Delivered ${amount(line.quantity)} · invoiced ${amount(line.invoiced_quantity)}${line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}`,
  }));
  const [values, setValues] = useState<Record<string, number>>({});
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const lines = chosen(rows, values).map((line) => ({ deliveryLineId: line.id, quantity: line.quantity }));
  const save = useMutation({ mutationFn: () => createInvoiceFromDelivery(deliveryId, { idempotencyKey, lines }), onSuccess: ({ result }) => onDone(result.invoiceId) });
  return (
    <Shell title={`Invoice ${number}`} description="A draft invoice for what this delivery delivered, at the order's agreed prices, discounts and tax. Check it, then post it."
      size="lg" error={save.error} fallback="The invoice could not be created." onClose={onClose} label="Create Draft Invoice" isLoading={save.isPending} isDisabled={!lines.length} onPress={() => save.mutate()}>
      {rows.length ? <QuantityRows rows={rows} values={values} onChange={setValues} /> : <p className="text-sm text-text-muted">Everything on this delivery has been invoiced.</p>}
    </Shell>
  );
}

// A draft: quantities, dates and notes. Lines are the full set: 0 takes a line off.
// termsOnly: for whoever may settle the payment terms and due date of a draft without the right to edit the rest of it.
export function EditInvoiceDialog({ detail, canChangeDates, termsOnly = false, onClose, onDone }: { detail: InvoiceDetail; canChangeDates: boolean; termsOnly?: boolean; onClose: () => void; onDone: () => void }) {
  const invoice = detail.invoice;
  const rows: QuantityRow[] = detail.lines.map((line) => ({
    id: line.source_sales_order_line_id, name: line.item_name_snapshot, unit: line.uom_snapshot, max: Number.MAX_SAFE_INTEGER, initial: Number(line.quantity),
    hint: `${money(invoice.currency_code, line.unit_price)} each${line.delivery_number ? ` · from ${line.delivery_number}` : ""}`,
  }));
  const [values, setValues] = useState<Record<string, number>>({});
  const [invoiceDate, setInvoiceDate] = useState(day(invoice.invoice_date));
  const [postingDate, setPostingDate] = useState(day(invoice.accounting_date));
  // Sent only when the user sets it: left alone, the server works the due date out from the terms and the invoice date.
  const [dueDate, setDueDate] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");
  const [clearOverride, setClearOverride] = useState(false);
  const workspace = useWorkspaceContext();
  const terms = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options.paymentTerms), staleTime: 60_000, enabled: detail.actions.changePaymentTerms });
  const [paymentTermId, setPaymentTermId] = useState(invoice.paymentTerm?.id ?? "");
  const [paymentTermsNote, setPaymentTermsNote] = useState(invoice.paymentTerm?.note ?? "");
  const chosenTerm = (terms.data ?? []).find((term) => term.id === paymentTermId);
  const termType = chosenTerm?.calculation_type ?? invoice.paymentTerm?.calculationType ?? "net_days";
  const termOptions = [
    ...(terms.data ?? []).map((term) => ({ value: term.id, label: `${term.name}${term.calculation_type === "net_days" ? ` (${term.days} days)` : ""}` })),
    ...(invoice.paymentTerm?.id && !(terms.data ?? []).some((term) => term.id === invoice.paymentTerm?.id) ? [{ value: invoice.paymentTerm.id, label: `${invoice.paymentTerm.name} (as agreed)` }] : []),
  ];
  const [customerNotes, setCustomerNotes] = useState(invoice.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(invoice.internal_notes ?? "");
  const lines = rows.map((row) => ({ salesOrderLineId: row.id, quantity: values[row.id] ?? row.initial }));
  const linesChanged = rows.some((row) => values[row.id] !== undefined && values[row.id] !== row.initial);
  const save = useMutation({
    mutationFn: () => updateDraftInvoice(invoice.id, {
      expectedVersion: invoice.version, ...(!termsOnly && linesChanged ? { lines } : {}),
      ...(!termsOnly && invoiceDate && invoiceDate !== day(invoice.invoice_date) ? { invoiceDate } : {}),
      ...(!termsOnly && canChangeDates && postingDate && postingDate !== day(invoice.accounting_date) ? { postingDate } : {}),
      ...(detail.actions.changePaymentTerms && paymentTermId && paymentTermId !== (invoice.paymentTerm?.id ?? "") ? { paymentTermId } : {}),
      ...(detail.actions.changePaymentTerms && paymentTermsNote.trim() !== (invoice.paymentTerm?.note ?? "") ? { paymentTermsNote: paymentTermsNote.trim() || null } : {}),
      ...(detail.actions.overrideDueDate && clearOverride ? { dueDate: null } : detail.actions.overrideDueDate && dueDate ? { dueDate, dueDateReason: dueDateReason.trim() || null } : {}),
      ...(termsOnly ? {} : { customerNotes: customerNotes.trim() || null, internalNotes: internalNotes.trim() || null }),
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={termsOnly ? `Payment terms and due date of ${invoice.invoice_number}` : `Edit ${invoice.invoice_number}`}
      description={termsOnly ? "The due date follows the payment terms and the invoice date, unless another date is set with a reason." : "The values are worked out again from the order as agreed. The due date follows the payment terms and the invoice date."}
      size="lg" error={save.error} fallback="The invoice could not be saved." onClose={onClose} label="Save" isLoading={save.isPending}
      isDisabled={(!termsOnly && !lines.some((line) => line.quantity > 0)) || Boolean(dueDate && !clearOverride && termType !== "custom" && !dueDateReason.trim())} onPress={() => save.mutate()}>
      {!termsOnly && <QuantityRows rows={rows} values={values} onChange={setValues} />}
      {!termsOnly && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Invoice date" type="date" value={invoiceDate} onChange={setInvoiceDate} />
          {canChangeDates && <TextField label="Posting date" type="date" value={postingDate} onChange={setPostingDate} />}
        </div>
      )}
      {detail.actions.changePaymentTerms ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Payment terms" selectedKey={paymentTermId || null} options={termOptions} onSelectionChange={(selected) => setPaymentTermId(String(selected ?? ""))}
            description={chosenTerm?.description ?? invoice.paymentTerm?.description ?? "Inherited from the sales order. Other terms work the due date out again."} />
          <TextField label="Additional payment terms" description="Optional, for this invoice only. Printed with the payment terms." value={paymentTermsNote} onChange={setPaymentTermsNote} />
        </div>
      ) : <p className="text-sm">Payment terms: <span className="font-medium">{invoice.paymentTerm?.name ?? "None"}</span></p>}
      <p className="text-sm text-text-secondary">
        Due date now <span className="font-medium tabular-nums text-text">{invoice.dueDateRequired ? "not entered" : day(invoice.due_date)}</span>
        {invoice.due_date_overridden && termType !== "custom" ? ` (set by hand${invoice.due_date_override_reason ? `: ${invoice.due_date_override_reason}` : ""}; the terms work out ${day(invoice.calculated_due_date) || "no date"})` : ""}.
        {termType === "custom" ? " These terms set no date: enter the due date before posting." : " Saving another invoice date or other terms works it out again."}
      </p>
      {detail.actions.overrideDueDate && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label={termType === "custom" ? "Due date" : "Set another due date"} type="date" value={dueDate} isDisabled={clearOverride} onChange={setDueDate} />
          {termType !== "custom" && <TextField label="Reason" isRequired={Boolean(dueDate)} isDisabled={clearOverride || !dueDate} description="Why the date differs from the payment terms." value={dueDateReason} onChange={setDueDateReason} />}
        </div>
      )}
      {detail.actions.overrideDueDate && invoice.due_date_overridden && termType !== "custom" && (
        <Button variant="secondary" onPress={() => { setClearOverride(!clearOverride); setDueDate(""); }}>{clearOverride ? "Keep the hand-set due date" : "Go back to the due date from the payment terms"}</Button>
      )}
      {!termsOnly && <TextArea label="Customer notes" description="Printed on the invoice." value={customerNotes} onChange={setCustomerNotes} />}
      {!termsOnly && <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />}
    </Shell>
  );
}

// Checks the draft, shows what stops it, and posts it.
export function PostInvoiceDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const invoice = detail.invoice;
  const check = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "invoice", invoice.id, "posting-check"),
    queryFn: () => validateInvoice(invoice.id).then((r) => r.check),
    staleTime: 0, gcTime: 0,
  });
  const recalculate = useMutation({ mutationFn: () => updateDraftInvoice(invoice.id, { expectedVersion: invoice.version, recalculateTax: true }), onSuccess: () => onDone("The tax was worked out again on the invoice date. Check the invoice, then post it.") });
  const save = useMutation({
    mutationFn: () => postInvoice(invoice.id, invoice.version),
    onSuccess: ({ result }) => onDone(result.awaitingApproval ? "The invoice is waiting for Finance approval before it is posted." : `Invoice ${result.invoiceNumber} is posted: it is now the customer's receivable.`),
  });
  const problems = check.data?.problems ?? [];
  return (
    <Shell title={`Post ${invoice.invoice_number}?`}
      description="Posting makes the invoice the customer's receivable and enters it in the books (receivable, revenue and output tax). A posted invoice cannot be edited: corrections are credit notes."
      error={save.error ?? recalculate.error ?? check.error} fallback="The invoice could not be posted." onClose={onClose} label="Post Invoice" isLoading={save.isPending}
      isDisabled={check.isLoading || problems.length > 0} onPress={() => save.mutate()}>
      <p className="text-sm">Total <span className="font-medium tabular-nums">{money(invoice.currency_code, invoice.grand_total)}</span> · due {day(invoice.due_date)} · posting date {day(invoice.accounting_date)}</p>
      {check.isLoading ? <p className="text-sm text-text-muted">Checking the invoice…</p> : problems.length ? (
        <SalesAlert tone="warning">
          <ul className="list-disc pl-4">{problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul>
        </SalesAlert>
      ) : <SalesAlert tone="success">Quantities, tax, period and totals are in order.</SalesAlert>}
      {(check.data?.warnings ?? []).map((warning, index) => <SalesAlert key={index} tone="info">{warning.message}</SalesAlert>)}
      {(check.data?.taxDifferences.length ?? 0) > 0 && detail.actions.edit && (
        <Button variant="secondary" isLoading={recalculate.isPending} onPress={() => recalculate.mutate()}>Recalculate Tax</Button>
      )}
    </Shell>
  );
}

export function CancelInvoiceDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelInvoice(detail.invoice.id, optional(reason)), onSuccess: onDone });
  return (
    <Shell title={`Cancel draft ${detail.invoice.invoice_number}?`} description="The draft never reached the books. Its number is kept, cancelled, and its quantities can be invoiced again."
      error={save.error} fallback="The invoice could not be cancelled." onClose={onClose} label="Cancel Draft" tone="danger" isLoading={save.isPending} onPress={() => save.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function ReverseInvoiceDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => reverseInvoice(detail.invoice.id, reason.trim()), onSuccess: onDone });
  return (
    <Shell title={`Reverse ${detail.invoice.invoice_number}?`}
      description="For an invoice posted in error, with no payment or credit applied: a reversing entry takes back the receivable, revenue and output tax. The invoice is kept, marked Reversed. For anything else, use a credit note."
      error={save.error} fallback="The invoice could not be reversed." onClose={onClose} label="Reverse Invoice" tone="danger" isLoading={save.isPending} isDisabled={!reason.trim()} onPress={() => save.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

export function SendInvoiceDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: (sentTo: string) => void }) {
  const invoice = detail.invoice;
  const [to, setTo] = useState(invoice.contact_snapshot?.email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Invoice ${invoice.invoice_number}`);
  const [message, setMessage] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => sendInvoice(invoice.id, { to: to.trim(), cc: optional(cc), subject: optional(subject), message: optional(message), idempotencyKey }),
    onSuccess: ({ result }) => onDone(result.sentTo),
  });
  return (
    <Shell title={`Send ${invoice.invoice_number}`} description="The invoice PDF is attached; the exact PDF sent is kept with the invoice."
      error={save.error} fallback="The invoice could not be sent." onClose={onClose} label="Send Invoice" isLoading={save.isPending} isDisabled={!to.trim()} onPress={() => save.mutate()}>
      <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
      <TextField label="CC" value={cc} onChange={setCc} />
      <TextField label="Subject" value={subject} onChange={setSubject} />
      <TextArea label="Message" description="Left empty, a standard message with the due date is used." value={message} onChange={setMessage} />
    </Shell>
  );
}

export function MarkSentDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState("");
  const [recipient, setRecipient] = useState(detail.invoice.contact_snapshot?.email ?? "");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({ mutationFn: () => markInvoiceSent(detail.invoice.id, { channel, recipient: optional(recipient), note: optional(note), idempotencyKey }), onSuccess: onDone });
  return (
    <Shell title={`${detail.invoice.invoice_number} sent another way`} error={save.error} fallback="The invoice could not be marked as sent." onClose={onClose} label="Mark as Sent"
      isLoading={save.isPending} isDisabled={!channel} onPress={() => save.mutate()}>
      <Select label="How was it sent?" isRequired placeholder="Choose" options={detail.sentChannels.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={channel || null} onSelectionChange={(selected) => setChannel(String(selected ?? ""))} />
      <TextField label="Sent to" value={recipient} onChange={setRecipient} />
      <TextField label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}


// A posted invoice's due date corrected by Finance: only the date moves, with a reason kept in the history.
export function ChangeDueDateDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const invoice = detail.invoice;
  const [dueDate, setDueDate] = useState(day(invoice.due_date));
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => changeInvoiceDueDate(invoice.id, { dueDate, reason: reason.trim() }), onSuccess: onDone });
  return (
    <Shell title={`Change the due date of ${invoice.invoice_number}`}
      description="The invoice is posted: only its due date changes, and overdue and ageing follow the new date. The amounts, the payment terms and the books stay as they are."
      error={save.error} fallback="The due date could not be changed." onClose={onClose} label="Change Due Date" isLoading={save.isPending}
      isDisabled={!dueDate || dueDate === day(invoice.due_date) || !reason.trim()} onPress={() => save.mutate()}>
      <p className="text-sm">Payment terms <span className="font-medium">{invoice.paymentTerm?.name ?? "none"}</span> · invoice date {day(invoice.invoice_date)} · due {day(invoice.due_date)}</p>
      <TextField label="New due date" type="date" isRequired value={dueDate} onChange={setDueDate} />
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}
