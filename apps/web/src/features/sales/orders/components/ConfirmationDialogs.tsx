"use client";

// Confirming a sales order and getting its Order Confirmation to the
// customer. The confirm dialog shows what the server found when it checked
// and priced the order again (problems that stop it, warnings, the
// comparison with the accepted quotation, stock that is short) before
// anything changes; the server checks again when Confirm is pressed.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { dateTime, money } from "@/features/sales/shared/format";

import {
  confirmSalesOrder, getConfirmationCheck, markConfirmationSent, recordConfirmationAcknowledgement, sendOrderConfirmation, type ConfirmResult,
} from "../api/orders-api";
import { failureText } from "./OrderDialogs";
import { Notice } from "@/shared/ui/Panel";

const amount = (value: number | null | undefined) => (value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const SENT_CHANNELS = [
  { value: "external_email", label: "Email from another mailbox" }, { value: "whatsapp", label: "WhatsApp" }, { value: "printed", label: "Printed copy" }, { value: "other", label: "Other" },
];

function Footer({ onClose, label, isLoading, isDisabled, onPress }: { onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onClose}>Close</Button>
      <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><span className="text-xs font-medium text-text-muted">{title}</span>{children}</div>;
}

export function ConfirmOrderDialog({ orderId, number, versionNumber, onClose, onDone }: {
  orderId: string; number: string; versionNumber: number; onClose: () => void; onDone: (result: ConfirmResult) => void;
}) {
  const workspace = useWorkspaceContext();
  const check = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "confirmation-check"),
    queryFn: () => getConfirmationCheck(orderId).then((r) => r.check),
    staleTime: 0, gcTime: 0,
  });
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState<string[] | null>(null);
  const confirm = useMutation({
    mutationFn: () => confirmSalesOrder(orderId, { expectedVersionNumber: versionNumber, quotationVarianceReason: reason.trim() || undefined }),
    onSuccess: ({ result }) => (result.confirmed ? onDone(result) : setRefused(result.problems ?? [])),
  });
  const data = check.data;
  const quotation = data?.quotation;
  const varianceBlocked = Boolean(quotation?.differs) && (data?.varianceNeedsPermission || !reason.trim());
  const problems = refused ?? data?.problems ?? [];
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Confirm ${number}`} size="lg"
      description="Confirming commits the order: it is priced and taxed again by the server, recorded as the Order Confirmation, and opens it to reservation, delivery and invoicing.">
      <div className="flex flex-col gap-4">
        {check.isLoading && <p className="text-sm text-text-muted">Checking the order…</p>}
        {check.isError && <Notice>{failureText(check.error, "The order could not be checked.")}</Notice>}
        {confirm.isError && <Notice>{failureText(confirm.error, "The order could not be confirmed.")}</Notice>}
        {problems.length > 0 && (
          <Notice>
            <span className="font-medium">The order cannot be confirmed yet:</span>
            <ul className="mt-1 list-disc pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          </Notice>
        )}
        {data && (
          <>
            {data.ready && !refused && <Notice tone="success">Everything needed is on the order. This becomes Order Confirmation {number}{data.nextConfirmationVersion > 1 ? `, revision ${data.nextConfirmationVersion}` : ""}.</Notice>}
            <Section title="Total">
              <p className="text-sm">
                {money(data.totals.currencyCode, data.totals.saved)}
                {data.totals.recalculated && data.totals.recalculated !== data.totals.saved && <span className="text-danger"> · priced again now: {money(data.totals.currencyCode, data.totals.recalculated)}</span>}
              </p>
            </Section>
            {quotation && (
              <Section title="Compared with the accepted quotation">
                <p className="text-sm">Quotation {quotation.quotationNumber}: {money(data.totals.currencyCode, quotation.quotationTotal)} · this order: {money(data.totals.currencyCode, quotation.orderTotal)}</p>
                {quotation.differs ? (
                  <>
                    <Notice tone="warning">
                      This order differs from the accepted quotation.
                      {quotation.changes.length > 0 && <ul className="mt-1 list-disc pl-5">{quotation.changes.map((change) => (
                        <li key={`${change.item}-${change.change}`}>{change.item}: {change.change === "added" ? `added, ${amount(change.to)}` : change.change === "removed" ? "removed" : `${amount(change.from)} → ${amount(change.to)}`}{change.unit ? ` ${change.unit}` : ""}</li>
                      ))}</ul>}
                    </Notice>
                    {data.varianceNeedsPermission
                      ? <p className="text-sm text-danger">Confirming an order that differs from its quotation needs a manager&apos;s permission.</p>
                      : <TextArea label="Why the order differs from the quotation" isRequired value={reason} onChange={setReason} />}
                  </>
                ) : <p className="text-sm text-success">Matches the accepted quotation.</p>}
              </Section>
            )}
            {data.availabilitySummary && (
              <p className="text-sm">Stock: <span className="font-medium">{data.availabilitySummary}</span>{data.availabilityCheckedAt ? <span className="text-text-muted"> · checked {dateTime(data.availabilityCheckedAt)}</span> : null}</p>
            )}
            {data.shortages.length > 0 && (
              <Section title="Stock">
                <ul className="flex flex-col gap-0.5 text-sm">
                  {data.shortages.map((line) => (
                    <li key={line.itemName}>{line.itemName}: {line.problem ?? `needs ${amount(line.required)}, available ${amount(line.available)}, short ${amount(line.shortage)}${line.unit ? ` ${line.unit}` : ""}`}</li>
                  ))}
                </ul>
                <p className="text-xs text-text-muted">A shortage does not stop the confirmation; the rest is reserved when it arrives.</p>
              </Section>
            )}
            <p className="text-xs text-text-muted">
              {data.reservesOnConfirm ? "Stock that is available is reserved as soon as the order is confirmed." : "Stock is not reserved automatically: use Reserve Stock after confirming."} Services are never reserved.
            </p>
          </>
        )}
        <Footer onClose={onClose} label="Confirm Order" isLoading={confirm.isPending} isDisabled={!data?.ready || varianceBlocked} onPress={() => { setRefused(null); confirm.mutate(); }} />
      </div>
    </Dialog>
  );
}

export function SendConfirmationDialog({ orderId, number, version, contactName, contactEmail, customerPo, onClose, onDone }: {
  orderId: string; number: string; version: number; contactName: string | null; contactEmail: string | null; customerPo: string | null; onClose: () => void; onDone: (sentTo: string) => void;
}) {
  const revision = version > 1 ? ` (revision ${version})` : "";
  const [to, setTo] = useState(contactEmail ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Order Confirmation ${number}${revision}`);
  const [message, setMessage] = useState(
    `Dear ${contactName ?? "Sir/Madam"},\n\nThank you for your order. Please find attached our order confirmation ${number}${revision}${customerPo ? ` against your PO ${customerPo}` : ""}.\n\nRegards`);
  // One key per opened dialog: a retry never sends the email twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const send = useMutation({
    mutationFn: () => sendOrderConfirmation(orderId, { to: to.trim(), cc: cc.trim() || undefined, subject, message, idempotencyKey }),
    onSuccess: ({ result }) => onDone(result.sentTo),
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Send Order Confirmation ${number}${revision}`} size="lg"
      description="The confirmation PDF is attached and kept with the order. The order's status does not change.">
      <div className="flex flex-col gap-3">
        {send.isError && <Notice>{failureText(send.error, "The email could not be sent.")}</Notice>}
        <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
        <TextField label="CC" description="Optional. Separate addresses with commas." value={cc} onChange={setCc} />
        <TextField label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Message" value={message} onChange={setMessage} />
        <p className="text-xs text-text-muted">Attachments on the order (such as the customer&apos;s PO) are not sent.</p>
        <Footer onClose={onClose} label="Send Confirmation" isLoading={send.isPending} isDisabled={!to.trim()} onPress={() => send.mutate()} />
      </div>
    </Dialog>
  );
}

export function MarkConfirmationSentDialog({ orderId, number, contactName, onClose, onDone }: { orderId: string; number: string; contactName: string | null; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState("external_email");
  const [recipient, setRecipient] = useState(contactName ?? "");
  const [note, setNote] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const save = useMutation({ mutationFn: () => markConfirmationSent(orderId, { channel, recipient: recipient.trim() || undefined, note: note.trim() || undefined, idempotencyKey }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Mark the confirmation of ${number} as sent`} description="For a confirmation sent outside Vercentlabs: from Outlook or Gmail, on WhatsApp, or on paper.">
      <div className="flex flex-col gap-3">
        {save.isError && <Notice>{failureText(save.error, "The confirmation could not be marked as sent.")}</Notice>}
        <Select label="How it was sent" options={SENT_CHANNELS} selectedKey={channel} onSelectionChange={(key) => setChannel(String(key ?? "external_email"))} />
        <TextField label="Sent to" value={recipient} onChange={setRecipient} />
        <TextField label="Note" value={note} onChange={setNote} />
        <Footer onClose={onClose} label="Mark as Sent" isLoading={save.isPending} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

export function AcknowledgeConfirmationDialog({ orderId, number, onClose, onDone }: { orderId: string; number: string; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState("Email confirmation received");
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => recordConfirmationAcknowledgement(orderId, { reference: reference.trim() || undefined, note: note.trim() || undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Customer acknowledged ${number}`} description="Optional: delivery and invoicing never wait for it.">
      <div className="flex flex-col gap-3">
        {save.isError && <Notice>{failureText(save.error, "The acknowledgement could not be recorded.")}</Notice>}
        <TextField label="Reference" isRequired value={reference} onChange={setReference} />
        <TextField label="Note" value={note} onChange={setNote} />
        <Footer onClose={onClose} label="Record Acknowledgement" isLoading={save.isPending} isDisabled={!reference.trim() && !note.trim()} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}
