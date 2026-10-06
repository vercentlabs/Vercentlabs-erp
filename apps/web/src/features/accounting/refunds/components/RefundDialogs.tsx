"use client";

// The steps of a customer refund that need something from the user first.
// Each sends only what was entered; the server takes the customer and
// currency from the credit source, checks the amount against the credit
// really left, and checks again at posting.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, NumberField, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { AccountingAlert } from "@/features/accounting/shared/AccountingUi";
import { useAccountingOptions } from "@/features/accounting/shared/client";
import { calendarDate, money } from "@/features/accounting/shared/format";

import {
  cancelRefund, createRefund, getCustomerCredit, markRefundSent, postRefund, reverseRefund, sendRefund, updateRefund, validateRefund,
  type CreditSource, type RefundAccount, type RefundDetail, type RefundSourceType, type RefundStatusKey,
} from "../api/refunds-api";

export const failureText = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message || fallback : fallback);
const optional = (value: string) => value.trim() || undefined;
const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const TONES: Record<RefundStatusKey, "neutral" | "success" | "danger"> = { draft: "neutral", posted: "success", reversed: "danger", cancelled: "danger" };

export function RefundStatusBadge({ status, label }: { status: RefundStatusKey; label: string }) {
  return <StatusBadge tone={TONES[status] ?? "neutral"}>{label}</StatusBadge>;
}

function Shell({ title, description, size, error, fallback, onClose, label, isLoading, isDisabled, onPress, children, tone = "primary" }: {
  title: string; description?: string; size?: "lg"; error: unknown; fallback: string; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean;
  onPress: () => void; children: ReactNode; tone?: "primary" | "danger";
}) {
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title} description={description} size={size}>
      <div className="flex flex-col gap-3">
        {Boolean(error) && <AccountingAlert>{failureText(error, fallback)}</AccountingAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

const accountLabel = (account: RefundAccount) => `${account.account_name} · ${account.bank_name}${account.masked_account_number ? ` ${account.masked_account_number}` : ""}`;
function AccountSelect({ accounts, value, onChange, isRequired }: { accounts: RefundAccount[]; value: string; onChange: (value: string) => void; isRequired?: boolean }) {
  return (
    <Select label="Bank / cash account" description="Where the money leaves from." isRequired={isRequired} placeholder="Choose" selectedKey={value || null}
      options={accounts.map((account) => ({ value: account.id, label: accountLabel(account) }))} onSelectionChange={(selected) => onChange(String(selected ?? ""))} />
  );
}

// A draft refund of one credit source. With `preset`, the source is fixed (Refund Credit on a credit note);
// without it, the customer is chosen and their refundable credit is listed.
export function CreateRefundDialog({ preset, partyId: chosenParty, onClose, onDone }: {
  // partyId alone: the customer is chosen (from the customer's page), the credit to refund is not.
  preset?: { partyId: string; sourceType: RefundSourceType; sourceId: string }; partyId?: string; onClose: () => void; onDone: (refundId: string, number: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const options = useAccountingOptions();
  const [partyId, setPartyId] = useState(preset?.partyId ?? chosenParty ?? "");
  const [sourceKey, setSourceKey] = useState(preset ? `${preset.sourceType}:${preset.sourceId}` : "");
  // Until an amount is typed, the whole available credit of the chosen source is proposed.
  const [entered, setAmount] = useState<number | null>(null);
  const [refundDate, setRefundDate] = useState(today());
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [externalReference, setExternalReference] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const credit = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "customer-credit", partyId),
    queryFn: () => getCustomerCredit(partyId).then((r) => r.credit),
    enabled: Boolean(partyId), staleTime: 0, gcTime: 0,
  });
  const sources = credit.data?.sources ?? [];
  const keyOf = (source: CreditSource) => `${source.sourceType}:${source.sourceId}`;
  const source = sources.find((entry) => keyOf(entry) === sourceKey) ?? null;
  const amount = entered ?? source?.available ?? 0;
  const choose = (key: string) => { setSourceKey(key); setAmount(null); };
  const reason = reasonCode || (source?.sourceType === "receipt" ? "overpayment" : "customer_credit");
  const save = useMutation({
    mutationFn: () => createRefund({
      idempotencyKey, sourceType: source!.sourceType, sourceId: source!.sourceId, amount, refundDate, reasonCode: reason, reasonNote: optional(reasonNote), paymentMethod,
      externalReference: optional(externalReference), customerNotes: optional(customerNotes), internalNotes: optional(internalNotes),
    }),
    onSuccess: ({ result }) => onDone(result.refundId, result.refundNumber),
  });
  const owed = credit.data?.owed.find((entry) => entry.currencyCode === source?.currencyCode);
  return (
    <Shell title="Refund customer credit"
      description="A refund pays back credit the customer really has: what is left on a posted credit note, or unapplied on a receipt. It is created as a draft; nothing is paid until it is posted."
      size="lg" error={save.error ?? credit.error} fallback="The refund could not be created." onClose={onClose} label="Create Draft Refund" isLoading={save.isPending}
      isDisabled={!source || amount <= 0 || amount > (source?.available ?? 0) + 0.005 || (reason === "other" && !reasonNote.trim())} onPress={() => save.mutate()}>
      {!preset && (
        <Select label="Customer" isRequired placeholder="Choose" selectedKey={partyId || null} options={(options.data?.customers ?? []).map((customer) => ({ value: customer.id, label: customer.name }))}
          onSelectionChange={(selected) => { setPartyId(String(selected ?? "")); setSourceKey(""); setAmount(null); }} />
      )}
      {partyId && credit.isLoading && <p className="text-sm text-text-muted">Loading the customer&apos;s credit…</p>}
      {credit.data && !sources.length && (
        <AccountingAlert tone="info">{credit.data.customer.name} has no credit to refund. Credit comes from a posted credit note that its invoice did not absorb, or from a receipt left unapplied.</AccountingAlert>
      )}
      {credit.data && sources.length > 0 && (
        <>
          <p className="text-sm">Available credit: <span className="font-medium tabular-nums">{credit.data.available.map((entry) => `${money(entry.amount)} ${entry.currencyCode}`).join(" · ")}</span></p>
          {preset && source ? (
            <p className="text-sm">{source.label} <span className="font-medium tabular-nums">{source.number}</span> · {calendarDate(source.date)} · {money(source.available)} {source.currencyCode} available</p>
          ) : (
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Credit source">
              {sources.map((entry) => (
                <button key={keyOf(entry)} type="button" role="radio" aria-checked={keyOf(entry) === sourceKey} onClick={() => choose(keyOf(entry))}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm ${keyOf(entry) === sourceKey ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-muted"}`}>
                  <span className="flex flex-col">
                    <span className="font-medium tabular-nums">{entry.number}</span>
                    <span className="text-xs text-text-muted">{[entry.label, calendarDate(entry.date), entry.reference ? `ref ${entry.reference}` : null,
                      entry.onDraftRefunds ? `${money(entry.onDraftRefunds)} on draft refunds` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="tabular-nums">{money(entry.available)} {entry.currencyCode} available</span>
                </button>
              ))}
            </div>
          )}
          {source && owed && owed.amount > 0 && (
            <AccountingAlert tone="warning">The customer still owes {money(owed.amount)} {owed.currencyCode} on {owed.invoices} open invoice(s). The credit can be applied to them instead of being refunded.</AccountingAlert>
          )}
          {source && (
            <>
              <NumberField label={`Refund now (${source.currencyCode})`} isRequired value={amount} minValue={0} maxValue={source.available} step={0.01} onChange={(value) => setAmount(Number.isFinite(value) ? value : 0)}
                description={`Up to ${money(source.available)}. A part can be refunded now and the rest later, or applied to an invoice.`} />
              <TextField label="Refund date" type="date" value={refundDate} onChange={setRefundDate} />
              <ReasonFields detailReasons={null} reasonCode={reason} setReasonCode={setReasonCode} reasonNote={reasonNote} setReasonNote={setReasonNote} />
              <Select label="Payment method" selectedKey={paymentMethod} options={METHODS} onSelectionChange={(selected) => setPaymentMethod(String(selected ?? "bank_transfer"))} />
              <TextField label="Transaction reference" description="Bank UTR, cheque number or other reference. It can be added when the refund is posted." value={externalReference} onChange={setExternalReference} />
              <TextArea label="Customer notes" description="Printed on the refund voucher." value={customerNotes} onChange={setCustomerNotes} />
              <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
            </>
          )}
        </>
      )}
    </Shell>
  );
}

const METHODS = [{ value: "bank_transfer", label: "Bank transfer" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "other", label: "Other" }];
const REASONS = [
  { value: "customer_credit", label: "Customer credit refund" }, { value: "overpayment", label: "Overpayment refund" }, { value: "order_cancellation", label: "Order cancellation" },
  { value: "returned_goods", label: "Returned goods" }, { value: "billing_adjustment", label: "Billing adjustment" }, { value: "duplicate_payment", label: "Duplicate payment" }, { value: "other", label: "Other" },
];
function ReasonFields({ detailReasons, reasonCode, setReasonCode, reasonNote, setReasonNote }: {
  detailReasons: Array<{ code: string; label: string }> | null; reasonCode: string; setReasonCode: (value: string) => void; reasonNote: string; setReasonNote: (value: string) => void;
}) {
  return (
    <>
      <Select label="Reason" isRequired selectedKey={reasonCode || null} options={detailReasons ? detailReasons.map((reason) => ({ value: reason.code, label: reason.label })) : REASONS}
        onSelectionChange={(selected) => setReasonCode(String(selected ?? ""))} />
      <TextArea label={reasonCode === "other" ? "Explain the reason" : "Reason details"} isRequired={reasonCode === "other"} value={reasonNote} onChange={setReasonNote} />
    </>
  );
}

// A draft's amount, date, reason, payment details and notes. The credit source stays.
export function EditRefundDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: () => void }) {
  const refund = detail.refund;
  const [amount, setAmount] = useState(Number(refund.amount));
  const [refundDate, setRefundDate] = useState(day(refund.refund_date));
  const [reasonCode, setReasonCode] = useState(refund.reason_code);
  const [reasonNote, setReasonNote] = useState(refund.reason_note ?? "");
  const [paymentMethod, setPaymentMethod] = useState(refund.payment_method);
  const [bankAccountId, setBankAccountId] = useState(refund.bank_account_id ?? "");
  const [externalReference, setExternalReference] = useState(refund.external_reference ?? "");
  const [customerNotes, setCustomerNotes] = useState(refund.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(refund.internal_notes ?? "");
  const limit = detail.source.available;
  const save = useMutation({
    mutationFn: () => updateRefund(refund.id, {
      expectedVersion: refund.version, amount, refundDate, reasonCode, reasonNote: reasonNote.trim() || null, paymentMethod,
      ...(detail.actions.selectAccount ? { bankAccountId: bankAccountId || null } : {}), externalReference: externalReference.trim() || null,
      customerNotes: customerNotes.trim() || null, internalNotes: internalNotes.trim() || null,
    }),
    onSuccess: onDone,
  });
  return (
    <Shell title={`Edit ${refund.refund_number}`} description={`Refund of ${detail.source.typeLabel.toLowerCase()} ${detail.source.number}. To refund another source, cancel this draft and start from that source.`}
      size="lg" error={save.error} fallback="The refund could not be saved." onClose={onClose} label="Save Draft" isLoading={save.isPending}
      isDisabled={amount <= 0 || (limit !== null && amount > limit + 0.005) || (reasonCode === "other" && !reasonNote.trim())} onPress={() => save.mutate()}>
      <NumberField label={`Amount (${refund.currency_code})`} isRequired value={amount} minValue={0} maxValue={limit ?? undefined} step={0.01} onChange={(value) => setAmount(Number.isFinite(value) ? value : 0)}
        description={limit !== null ? `Up to ${money(limit)} is left on ${detail.source.number}.` : undefined} />
      <TextField label="Refund date" type="date" value={refundDate} onChange={setRefundDate} />
      <ReasonFields detailReasons={detail.reasons} reasonCode={reasonCode} setReasonCode={setReasonCode} reasonNote={reasonNote} setReasonNote={setReasonNote} />
      <Select label="Payment method" selectedKey={paymentMethod} options={detail.methods.map((method) => ({ value: method.code, label: method.label }))}
        onSelectionChange={(selected) => setPaymentMethod(String(selected ?? "bank_transfer"))} />
      {detail.actions.selectAccount && <AccountSelect accounts={detail.accounts} value={bankAccountId} onChange={setBankAccountId} />}
      <TextField label="Transaction reference" value={externalReference} onChange={setExternalReference} />
      <TextArea label="Customer notes" description="Printed on the refund voucher." value={customerNotes} onChange={setCustomerNotes} />
      <TextArea label="Internal notes" description="Never printed." value={internalNotes} onChange={setInternalNotes} />
    </Shell>
  );
}

// Posting is the payment: the account and reference are confirmed here, and everything is checked again.
export function PostRefundDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const refund = detail.refund;
  const [bankAccountId, setBankAccountId] = useState(refund.bank_account_id ?? (detail.accounts.length === 1 ? detail.accounts[0].id : ""));
  const [paymentMethod, setPaymentMethod] = useState(refund.payment_method);
  const [externalReference, setExternalReference] = useState(refund.external_reference ?? "");
  const [refundDate, setRefundDate] = useState(day(refund.refund_date));
  const check = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", "customer-refund", refund.id, "posting-check"),
    queryFn: () => validateRefund(refund.id).then((r) => r.check),
    staleTime: 0, gcTime: 0,
  });
  const save = useMutation({
    mutationFn: () => postRefund(refund.id, { expectedVersion: refund.version, bankAccountId: bankAccountId || undefined, paymentMethod, externalReference: externalReference.trim(), refundDate }),
    onSuccess: ({ result }) => onDone(`Refund ${result.refundNumber} is posted: ${money(refund.amount)} ${refund.currency_code} was paid to the customer.`
      + `${result.creditLeft !== undefined ? ` ${money(result.creditLeft)} ${refund.currency_code} of credit is left on ${detail.source.number}.` : ""}`),
  });
  // What is completed in this dialog (the account, the date) is not a blocker.
  const blocking = (check.data?.problems ?? []).filter((problem) => !(problem.field === "bankAccountId" && bankAccountId) && problem.field !== "refundDate");
  return (
    <Shell title={`Post ${refund.refund_number}?`}
      description="Posting is the payment: the customer's credit is consumed and the bank or cash account is credited. A posted refund cannot be edited; one entered in error is reversed."
      size="lg" error={save.error ?? check.error} fallback="The refund could not be posted." onClose={onClose} label="Post Refund" isLoading={save.isPending}
      isDisabled={check.isLoading || blocking.length > 0 || !bankAccountId} onPress={() => save.mutate()}>
      <p className="text-sm">Refund <span className="font-medium tabular-nums">{money(refund.amount)} {refund.currency_code}</span> to {refund.customer_name} · from {detail.source.typeLabel.toLowerCase()} {detail.source.number}</p>
      <AccountSelect accounts={detail.accounts} value={bankAccountId} onChange={setBankAccountId} isRequired />
      <Select label="Payment method" selectedKey={paymentMethod} options={detail.methods.map((method) => ({ value: method.code, label: method.label }))}
        onSelectionChange={(selected) => setPaymentMethod(String(selected ?? "bank_transfer"))} />
      <TextField label="Transaction reference" description="Bank UTR, cheque number or other reference." value={externalReference} onChange={setExternalReference} />
      <TextField label="Refund date" type="date" value={refundDate} onChange={setRefundDate} />
      {check.isLoading ? <p className="text-sm text-text-muted">Checking the refund…</p> : blocking.length ? (
        <AccountingAlert tone="warning"><ul className="list-disc pl-4">{blocking.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul></AccountingAlert>
      ) : <AccountingAlert tone="success">The credit is available.</AccountingAlert>}
      {(check.data?.warnings ?? []).map((warning, index) => <AccountingAlert key={index} tone="warning">{warning.message}</AccountingAlert>)}
    </Shell>
  );
}

export function CancelRefundDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelRefund(detail.refund.id, optional(reason)), onSuccess: onDone });
  return (
    <Shell title={`Cancel draft ${detail.refund.refund_number}?`} description="Nothing was paid and no credit was consumed. The number is kept, cancelled."
      error={save.error} fallback="The refund could not be cancelled." onClose={onClose} label="Cancel Draft" tone="danger" isLoading={save.isPending} onPress={() => save.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}

export function ReverseRefundDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const refund = detail.refund;
  const save = useMutation({
    mutationFn: () => reverseRefund(refund.id, reason.trim()),
    onSuccess: () => onDone(`The refund was reversed: ${money(refund.amount)} ${refund.currency_code} of credit is back on ${detail.source.number}.`),
  });
  return (
    <Shell title={`Reverse ${refund.refund_number}?`}
      description="For a refund entered in error or a payment that did not go through: a reversing entry takes the bank or cash movement back and the credit returns to its source. The refund is kept, marked Reversed. No new credit note is made."
      error={save.error} fallback="The refund could not be reversed." onClose={onClose} label="Reverse Refund" tone="danger" isLoading={save.isPending} isDisabled={!reason.trim()} onPress={() => save.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

export function SendRefundDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: (sentTo: string) => void }) {
  const refund = detail.refund;
  const [to, setTo] = useState(refund.customer_email ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Refund ${refund.refund_number}`);
  const [message, setMessage] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({
    mutationFn: () => sendRefund(refund.id, { to: to.trim(), cc: optional(cc), subject: optional(subject), message: optional(message), idempotencyKey }),
    onSuccess: ({ result }) => onDone(result.sentTo),
  });
  return (
    <Shell title={`Send confirmation of ${refund.refund_number}`} description="The refund voucher is attached; the exact PDF sent is kept with the refund."
      error={save.error} fallback="The confirmation could not be sent." onClose={onClose} label="Send Confirmation" isLoading={save.isPending} isDisabled={!to.trim()} onPress={() => save.mutate()}>
      <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
      <TextField label="CC" value={cc} onChange={setCc} />
      <TextField label="Subject" value={subject} onChange={setSubject} />
      <TextArea label="Message" description="Left empty, a standard message with the amount and reference is used." value={message} onChange={setMessage} />
    </Shell>
  );
}

export function MarkRefundSentDialog({ detail, onClose, onDone }: { detail: RefundDetail; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState("");
  const [recipient, setRecipient] = useState(detail.refund.customer_email ?? "");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({ mutationFn: () => markRefundSent(detail.refund.id, { channel, recipient: optional(recipient), note: optional(note), idempotencyKey }), onSuccess: onDone });
  return (
    <Shell title={`${detail.refund.refund_number}: confirmation sent another way`} error={save.error} fallback="The confirmation could not be marked as sent." onClose={onClose} label="Mark as Sent"
      isLoading={save.isPending} isDisabled={!channel} onPress={() => save.mutate()}>
      <Select label="How was it sent?" isRequired placeholder="Choose" options={detail.sentChannels.map((entry) => ({ value: entry.code, label: entry.label }))}
        selectedKey={channel || null} onSelectionChange={(selected) => setChannel(String(selected ?? ""))} />
      <TextField label="Sent to" value={recipient} onChange={setRecipient} />
      <TextField label="Note" value={note} onChange={setNote} />
    </Shell>
  );
}
