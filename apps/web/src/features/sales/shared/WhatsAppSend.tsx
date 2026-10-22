"use client";

// Send on WhatsApp (Sales audit M6): the message is written for the document (number, amount, validity or due date) to the contact's
// mobile, or the number entered; sending records the document as sent on WhatsApp and gives the link that opens WhatsApp with the
// message ready. Download the PDF first and attach it in WhatsApp.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";

import { post, SalesApiError } from "./http";

// A receipt and a payment reminder too (Sales plan): a reminder is sent to the customer (id is the customer's).
export type WhatsAppKind = "quotation" | "proforma" | "order" | "invoice" | "credit_note" | "debit_note" | "receipt" | "reminder";
type Kind = WhatsAppKind;
const NOUN: Record<Kind, string> = { quotation: "quotation", proforma: "proforma invoice", order: "order confirmation", invoice: "invoice", credit_note: "credit note",
  debit_note: "debit note", receipt: "payment receipt", reminder: "payment reminder" };

export function WhatsAppSendButton({ kind, id, pdfUrl, size, label = "WhatsApp", onSent }: { kind: Kind; id: string; pdfUrl?: string; size?: "compact" | "standard"; label?: string; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size={size} onPress={() => setOpen(true)}>{label}</Button>
      {open && <WhatsAppSendDialog kind={kind} id={id} pdfUrl={pdfUrl} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}

function WhatsAppSendDialog({ kind, id, pdfUrl, onClose, onSent }: { kind: Kind; id: string; pdfUrl?: string; onClose: () => void; onSent?: () => void }) {
  const [phone, setPhone] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const send = useMutation({
    mutationFn: () => post<{ result: { phone: string; body: string; link: string } }>("/whatsapp", { kind, id, phone: phone.trim() || undefined, idempotencyKey }),
    onSuccess: () => onSent?.(),
  });
  const result = send.data?.result;
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Send the ${NOUN[kind]} on WhatsApp`} size="md"
      description="The message is written for you, to the contact's mobile unless you enter another number. WhatsApp opens with it ready; attach the PDF there.">
      <div className="flex flex-col gap-4">
        {send.isError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {send.error instanceof SalesApiError ? send.error.message : "The message could not be prepared."}
          </p>
        )}
        {!result ? (
          <>
            <TextField label="WhatsApp number" description="Leave empty to use the contact's mobile." inputMode="tel" value={phone} onChange={setPhone} placeholder="98200 12345" />
            {pdfUrl && <a className="text-sm text-brand underline-offset-2 hover:underline" href={pdfUrl} download>Download the PDF to attach</a>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose}>Cancel</Button>
              <Button variant="primary" isLoading={send.isPending} onPress={() => send.mutate()}>Prepare message</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">To {result.phone}:</p>
            <pre className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm whitespace-pre-wrap">{result.body}</pre>
            <p className="text-xs text-text-muted">Recorded as sent on WhatsApp.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose}>Close</Button>
              <a className="inline-flex items-center rounded-[var(--radius-control)] bg-brand px-3 py-2 text-sm font-medium text-white" href={result.link} target="_blank" rel="noreferrer" onClick={onClose}>
                Open WhatsApp
              </a>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
