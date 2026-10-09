"use client";

// The steps of a credit note that need something from the user first. Each
// sends only what was entered; the server checks every quantity and amount
// against what is left to credit on the invoice, checks again at posting and
// does all the arithmetic (values come from the invoice line, never today's
// prices or tax rates).
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

import {
  cancelCreditNote, createCreditNote, getCreditProposal, markCreditNoteSent, postCreditNote, reverseCreditNote, sendCreditNote, updateDraftCreditNote,
  validateCreditNote, type CreditLineInput, type CreditNoteDetail, type CreditProposal, type CreditType,
} from "../api/credit-notes-api";
import { Notice } from "@/shared/ui/Panel";

export function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}
const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const optional = (value: string) => value.trim() || undefined;
const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children, tone = "primary" }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode; tone?: "primary" | "danger";
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <Notice>{failureText(error, fallback)}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type LineValue = { type: CreditType; value: number };
// Each invoice line: what is left to credit, and the quantity (or, with the permission, the amount) to credit now.
function CreditLines({ proposal, values, onChange, allowAmount, exceptNumber }: {
  proposal: CreditProposal; values: Record<string, LineValue>; onChange: (next: Record<string, LineValue>) => void; allowAmount: boolean; exceptNumber?: string;
}) {
  const currency = proposal.currencyCode;
  return (
    <div className="flex flex-col gap-2">
      {proposal.lines.map((line) => {
        const current = values[line.invoiceLineId] ?? { type: "quantity" as CreditType, value: 0 };
        const byAmount = current.type === "amount";
        const done = line.quantityLeft <= 0 && line.valueLeft <= 0.005;
        return (
          <div key={line.invoiceLineId} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
            <span className="flex flex-col text-sm">
              <span className="font-medium">{line.itemName}</span>
              <span className="text-xs text-text-muted">
                {[`Invoiced ${amount(line.invoicedQuantity)}${line.unit ? ` ${line.unit}` : ""} at ${money(currency, line.unitPrice)}`, `taxable ${money(currency, line.taxableAmount)}`,
                  line.taxes.length ? line.taxes.map((tax) => `${tax.label ?? tax.taxType.toUpperCase()} ${tax.rate}%`).join(" + ") : "no tax",
                  line.creditedQuantity ? `credited ${amount(line.creditedQuantity)}` : null, line.creditedValue ? `credited value ${money(currency, line.creditedValue)}` : null,
                  `left ${amount(line.quantityLeft)}${line.unit ? ` ${line.unit}` : ""} · ${money(currency, line.valueLeft)}`,
                  line.draftCreditNotes.some((number) => number !== exceptNumber) ? `also on draft ${line.draftCreditNotes.filter((number) => number !== exceptNumber).join(", ")}` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            {allowAmount ? (
              <Select aria-label={`How ${line.itemName} is credited`} size="compact" selectedKey={current.type} isDisabled={done}
                options={[{ value: "quantity", label: "By quantity" }, { value: "amount", label: "By amount" }]}
                onSelectionChange={(selected) => onChange({ ...values, [line.invoiceLineId]: { type: selected === "amount" ? "amount" : "quantity", value: 0 } })} />
            ) : <span className="text-xs text-text-muted sm:text-right">By quantity</span>}
            <NumberField aria-label={byAmount ? `Taxable amount to credit on ${line.itemName}` : `Quantity of ${line.itemName} to credit`} value={current.value} minValue={0}
              maxValue={byAmount ? line.valueLeft : line.quantityLeft} step={byAmount ? 0.01 : 1} isDisabled={done}
              onChange={(value) => onChange({ ...values, [line.invoiceLineId]: { ...current, value: Number.isFinite(value) ? value : 0 } })} />
          </div>
        );
      })}
    </div>
  );
}
const linesOf = (values: Record<string, LineValue>): CreditLineInput[] =>
  Object.entries(values).filter(([, line]) => line.value > 0).map(([invoiceLineId, line]) => ({
    invoiceLineId, creditType: line.type, ...(line.type === "amount" ? { amount: line.value } : { quantity: line.value }),
  }));

function ReasonFields({ reasons, reasonCode, setReasonCode, reasonNote, setReasonNote, fixed }: {
  reasons: Array<{ code: string; label: string }>; reasonCode: string; setReasonCode: (value: string) => void; reasonNote: string; setReasonNote: (value: string) => void; fixed?: boolean;
}) {
  return (
    <>
      {!fixed && (
        <Select label="Reason" isRequired placeholder="Choose" options={reasons.map((reason) => ({ value: reason.code, label: reason.label }))}
          selectedKey={reasonCode || null} onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
      )}
      <TextArea label={reasonCode === "other" ? "Explain the reason" : "Reason details"} isRequired={reasonCode === "other"} value={reasonNote} onChange={setReasonNote} />
    </>
  );
}

// From a posted invoice: a Draft credit note for quantities (or amounts) of its lines.
export function CreateCreditNoteDialog({ invoiceId, onClose, onDone }: { invoiceId: string; onClose: () => void; onDone: (creditNoteId: string, number: string) => void }) {
  const workspace = useWorkspaceContext();
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "invoice", invoiceId, "credit-proposal"),
    queryFn: () => getCreditProposal(invoiceId).then((r) => r.proposal),
    staleTime: 0, gcTime: 0,
  });
  const [values, setValues] = useState<Record<string, LineValue>>({});
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [creditDate, setCreditDate] = useState(today());
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const lines = linesOf(values);
  const save = useMutation({
    mutationFn: () => createCreditNote(invoiceId, {
      idempotencyKey, reasonCode, reasonNote: optional(reasonNote), creditDate, customerNotes: optional(customerNotes), internalNotes: optional(internalNotes), lines,
    }),
    onSuccess: ({ result }) => onDone(result.creditNoteId, result.creditNoteNumber),
  });
  const data = proposal.data;
  return (
    <Shell title={`Credit note against ${data?.invoiceNumber ?? "the invoice"}`}
      description="The invoice itself never changes. The credit note is created as a draft; posting it reduces what the customer owes and applies it to this invoice."
      size="lg" error={save.error ?? proposal.error} fallback="The credit note could not be created." onClose={onClose} label="Create Draft Credit Note" isLoading={save.isPending}
      isDisabled={!lines.length || !reasonCode || (reasonCode === "other" && !reasonNote.trim())} onPress={() => save.mutate()}>
      {proposal.isLoading || !data ? <p className="text-sm text-text-muted">Loading what is left to credit…</p> : (
        <>
          <p className="text-sm">Invoice total <span className="font-medium tabular-nums">{money(data.currencyCode, data.grandTotal)}</span> · credited so far{" "}
            <span className="tabular-nums">{money(data.currencyCode, data.creditedTotal)}</span> · still owed <span className="tabular-nums">{money(data.currencyCode, data.outstanding)}</span></p>
          <CreditLines proposal={data} values={values} onChange={setValues} allowAmount={data.canCreditAmount} />
          {data.lines.some((line) => line.draftCreditNotes.length > 0) && (
            <Notice tone="warning">Other draft credit notes already credit some of these lines. Drafts credit nothing yet: whichever is posted first goes through.</Notice>
          )}
          <ReasonFields reasons={data.reasons} reasonCode={reasonCode} setReasonCode={setReasonCode} reasonNote={reasonNote} setReasonNote={setReasonNote} />
          <TextField label="Credit note date" type="date" value={creditDate} onChange={setCreditDate} />
          <TextArea label="Customer notes" description="Printed on the credit note." value={customerNotes} onChange={setCustomerNotes} />
          <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
        </>
      )}
    </Shell>
  );
}

// A draft's lines, date, reason and notes.
export function EditCreditNoteDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const creditNote = detail.creditNote;
  const editLines = detail.actions.editLines;
  const proposal = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "invoice", creditNote.source_invoice_id, "credit-proposal"),
    queryFn: () => getCreditProposal(creditNote.source_invoice_id).then((r) => r.proposal),
    staleTime: 0, gcTime: 0, enabled: editLines,
  });
  const initial = Object.fromEntries(detail.lines.map((line) => [line.source_invoice_line_id,
    { type: line.credit_type, value: line.credit_type === "amount" ? Number(line.net_amount) : Number(line.quantity) } as LineValue]));
  const [values, setValues] = useState<Record<string, LineValue>>(initial);
  const [reasonCode, setReasonCode] = useState(creditNote.reason_code);
  const [reasonNote, setReasonNote] = useState(creditNote.reason_note ?? "");
  const [creditDate, setCreditDate] = useState(day(creditNote.invoice_date));
  const [customerNotes, setCustomerNotes] = useState(creditNote.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(creditNote.internal_notes ?? "");
  const lines = linesOf(values);
  // The draft's own quantities are on it: what is left for it is what posted credit notes left.
  const withOwn = proposal.data;
  const save = useMutation({
    mutationFn: () => updateDraftCreditNote(creditNote.id, {
      expectedVersion: creditNote.version, ...(editLines ? { lines } : {}), ...(creditNote.sales_return_id ? {} : { reasonCode }), reasonNote: reasonNote.trim() || null,
      creditDate, customerNotes: customerNotes.trim() || null, internalNotes: internalNotes.trim() || null,
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`Edit ${creditNote.invoice_number}`} size="lg" error={save.error ?? proposal.error} fallback="The credit note could not be saved." onClose={onClose} label="Save Draft"
      isLoading={save.isPending} isDisabled={(editLines && !lines.length) || (reasonCode === "other" && !reasonNote.trim())} onPress={() => save.mutate()}>
      {editLines ? (withOwn ? <CreditLines proposal={withOwn} values={values} onChange={setValues} allowAmount={detail.actions.creditAmount} exceptNumber={creditNote.invoice_number} />
        : <p className="text-sm text-text-muted">Loading the invoice lines…</p>)
        : creditNote.sales_return_id ? <Notice tone="info">The lines follow return {creditNote.return_number}. To change them, cancel this draft and credit the return again.</Notice> : null}
      <ReasonFields reasons={detail.reasons.filter((reason) => reason.code !== "sales_return")} reasonCode={reasonCode} setReasonCode={setReasonCode} reasonNote={reasonNote}
        setReasonNote={setReasonNote} fixed={Boolean(creditNote.sales_return_id)} />
      <TextField label="Credit note date" type="date" value={creditDate} onChange={setCreditDate} />
      <TextArea label="Customer notes" description="Printed on the credit note." value={customerNotes} onChange={setCustomerNotes} />
      <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

export function PostCreditNoteDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const creditNote = detail.creditNote;
  const check = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "credit-note", creditNote.id, "posting-check"),
    queryFn: () => validateCreditNote(creditNote.id).then((r) => r.check),
    staleTime: 0, gcTime: 0,
  });
  const currency = creditNote.currency_code;
  const save = useMutation({
    mutationFn: () => postCreditNote(creditNote.id, creditNote.version),
    onSuccess: ({ result }) => onDone(result.awaitingApproval ? "The credit note is waiting for Finance approval before it is posted."
      : `Credit note ${result.creditNoteNumber} is posted. ${money(currency, result.applied ?? 0)} was applied to invoice ${creditNote.sourceInvoice.invoiceNumber}`
        + `${(result.unapplied ?? 0) > 0.005 ? `; ${money(currency, result.unapplied ?? 0)} is left as the customer's credit.` : "."}`),
  });
  const problems = check.data?.problems ?? [];
  return (
    <Shell title={`Post ${creditNote.invoice_number}?`}
      description="Posting reduces what the customer owes and enters it in the books (receivable, revenue and output tax taken back). It is applied to the invoice for as much as the invoice still owes; the rest is the customer's credit. A posted credit note cannot be edited."
      error={save.error ?? check.error} fallback="The credit note could not be posted." onClose={onClose} label="Post Credit Note" isLoading={save.isPending}
      isDisabled={check.isLoading || problems.length > 0} onPress={() => save.mutate()}>
      <p className="text-sm">Total credit <span className="font-medium tabular-nums">{money(currency, creditNote.grand_total)}</span> · against {creditNote.sourceInvoice.invoiceNumber} · posting date {day(creditNote.accounting_date)}</p>
      {check.isLoading ? <p className="text-sm text-text-muted">Checking the credit note…</p> : problems.length ? (
        <Notice tone="warning"><ul className="list-disc pl-4">{problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></Notice>
      ) : <Notice tone="success">Quantities, value left on the invoice, period and totals are in order.</Notice>}
      {(check.data?.warnings ?? []).map((warning, index) => <Notice key={index} tone="info">{warning.message}</Notice>)}
    </Shell>
  );
}

export function CancelCreditNoteDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelCreditNote(detail.creditNote.id, optional(reason)), onSuccess: onDone });
  return (
    <Shell title={`Cancel draft ${detail.creditNote.invoice_number}?`} description="The draft never reached the books. Its number is kept, cancelled."
      error={save.error} fallback="The credit note could not be cancelled." onClose={onClose} label="Cancel Draft" tone="danger" isLoading={save.isPending} onPress={() => save.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function ReverseCreditNoteDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => reverseCreditNote(detail.creditNote.id, reason.trim()),
    onSuccess: ({ result }) => onDone(`The credit note was reversed.${result.unapplied?.length ? ` ${result.unapplied.map((entry) => `${entry.invoiceNumber} owes ${money(detail.creditNote.currency_code, entry.amount)} again`).join("; ")}.` : ""}`),
  });
  return (
    <Shell title={`Reverse ${detail.creditNote.invoice_number}?`}
      description="For a credit note posted in error: it is unapplied from the invoices it was applied to (they owe it again), and a reversing entry restores the receivable, revenue and output tax. The credit note is kept, marked Reversed."
      error={save.error} fallback="The credit note could not be reversed." onClose={onClose} label="Reverse Credit Note" tone="danger" isLoading={save.isPending} isDisabled={!reason.trim()}
      onPress={() => save.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

export function SendCreditNoteDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: (sentTo: string) => void }) {
  const creditNote = detail.creditNote;
  const [to, setTo] = useState(creditNote.contact_snapshot?.email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Credit note ${creditNote.invoice_number} against invoice ${creditNote.sourceInvoice.invoiceNumber}`);
  const [message, setMessage] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => sendCreditNote(creditNote.id, { to: to.trim(), cc: optional(cc), subject: optional(subject), message: optional(message), idempotencyKey }),
    onSuccess: ({ result }) => onDone(result.sentTo),
  });
  return (
    <Shell title={`Send ${creditNote.invoice_number}`} description="The credit note PDF is attached; the exact PDF sent is kept with the credit note."
      error={save.error} fallback="The credit note could not be sent." onClose={onClose} label="Send Credit Note" isLoading={save.isPending} isDisabled={!to.trim()} onPress={() => save.mutate()}>
      <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
      <TextField label="CC" value={cc} onChange={setCc} />
      <TextField label="Subject" value={subject} onChange={setSubject} />
      <TextArea label="Message" description="Left empty, a standard message naming the invoice is used." value={message} onChange={setMessage} />
    </Shell>
  );
}

export function MarkCreditNoteSentDialog({ detail, onClose, onDone }: { detail: CreditNoteDetail; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState("");
  const [recipient, setRecipient] = useState(detail.creditNote.contact_snapshot?.email ?? "");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({ mutationFn: () => markCreditNoteSent(detail.creditNote.id, { channel, recipient: optional(recipient), note: optional(note), idempotencyKey }), onSuccess: onDone });
  return (
    <Shell title={`${detail.creditNote.invoice_number} sent another way`} error={save.error} fallback="The credit note could not be marked as sent." onClose={onClose} label="Mark as Sent"
      isLoading={save.isPending} isDisabled={!channel} onPress={() => save.mutate()}>
      <Select label="How was it sent?" isRequired placeholder="Choose" options={detail.sentChannels.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={channel || null} onSelectionChange={(selected) => setChannel(String(selected ?? ""))} />
      <TextField label="Sent to" value={recipient} onChange={setRecipient} />
      <TextField label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}
