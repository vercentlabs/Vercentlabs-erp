"use client";

// The steps after a quotation is confirmed, wherever it is shown (the Sales
// quotation page and the opportunity's quotations): download its PDF, email
// it, mark it sent when it went out another way, record the customer's
// acceptance or rejection, cancel it, and turn an accepted one into a sales
// order. The server checks every step against the quotation's state.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, TextArea, TextField } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";
import {
  cancelSalesQuotation, convertSalesQuotation, emailSalesQuotation, markSalesQuotationSent, recordSalesQuotationDecision,
} from "../api/quotations-api";

export type LifecycleQuotation = {
  id: string; number: string; status: string; isExpired: boolean; convertedOrderId: string | null; contactName?: string | null; contactEmail?: string | null;
};
type Can = (permission: string) => boolean;
type DialogKind = "email" | "markSent" | "accept" | "reject" | "cancel" | null;

const OFFER = ["approved", "sent", "viewed"];

export function QuotationLifecycleActions({ quotation, can, onChanged, size = "standard", showOrder = true }: {
  quotation: LifecycleQuotation; can: Can; onChanged: () => void; size?: "compact" | "standard"; showOrder?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const convert = useMutation({
    mutationFn: () => convertSalesQuotation(quotation.id),
    onSuccess: ({ result }) => { onChanged(); router.push(`/sales/orders/${result.orderId}`); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The sales order could not be created."),
  });
  const offer = OFFER.includes(quotation.status);
  const done = () => { setDialog(null); setError(null); onChanged(); };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton variant="secondary" size={size} href={`/api/documents/sales.quotation/${quotation.id}/pdf`} download>PDF</LinkButton>
        {offer && !quotation.isExpired && can("sales.quotation.send") && (
          <>
            <Button variant="secondary" size={size} onPress={() => setDialog("email")}>Email</Button>
            <Button variant="secondary" size={size} onPress={() => setDialog("markSent")}>Mark as sent</Button>
          </>
        )}
        {offer && !quotation.isExpired && can("sales.quotation.accept_on_behalf") && <Button variant="secondary" size={size} onPress={() => setDialog("accept")}>Record acceptance</Button>}
        {offer && can("sales.quotation.reject") && <Button variant="secondary" size={size} onPress={() => setDialog("reject")}>Record rejection</Button>}
        {showOrder && quotation.status === "accepted" && can("sales.order.create") && (quotation.convertedOrderId
          ? <LinkButton variant="primary" size={size} href={`/sales/orders/${quotation.convertedOrderId}`}>Open sales order</LinkButton>
          : <Button variant="primary" size={size} isLoading={convert.isPending} onPress={() => convert.mutate()}>Create sales order</Button>)}
        {!["converted", "cancelled"].includes(quotation.status) && !quotation.convertedOrderId && can("sales.quotation.cancel") && (
          <Button variant="ghost" size={size} onPress={() => setDialog("cancel")}>Cancel quotation</Button>
        )}
      </div>
      {error && !dialog && <p role="alert" className="text-sm text-danger">{error}</p>}
      {dialog === "email" && <EmailDialog quotation={quotation} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "markSent" && <MarkSentDialog quotation={quotation} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === "accept" || dialog === "reject") && <DecisionDialog quotation={quotation} decision={dialog === "accept" ? "accepted" : "rejected"} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "cancel" && <CancelDialog quotation={quotation} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function failureText(failure: unknown, fallback: string) {
  return failure instanceof SalesApiError || failure instanceof Error ? failure.message || fallback : fallback;
}

function Footer({ onClose, label, isLoading, isDisabled, onPress }: { onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onClose}>Close</Button>
      <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
    </div>
  );
}

function EmailDialog({ quotation, onClose, onDone }: { quotation: LifecycleQuotation; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(quotation.contactEmail ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Quotation ${quotation.number}`);
  const [message, setMessage] = useState(`Dear ${quotation.contactName ?? "Sir/Madam"},\n\nPlease find attached our quotation ${quotation.number}.\n\nRegards`);
  const send = useMutation({ mutationFn: () => emailSalesQuotation(quotation.id, { to: to.trim(), cc: cc.trim() || undefined, subject, message }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Email ${quotation.number}`} description="The quotation PDF is attached. The send is recorded on the quotation." size="lg">
      <div className="flex flex-col gap-3">
        {send.isError && <p role="alert" className="text-sm text-danger">{failureText(send.error, "The email could not be sent.")}</p>}
        <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
        <TextField label="CC" description="Optional. Separate addresses with commas." value={cc} onChange={setCc} />
        <TextField label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Message" value={message} onChange={setMessage} />
        <Footer onClose={onClose} label="Send email" isLoading={send.isPending} isDisabled={!to.trim()} onPress={() => send.mutate()} />
      </div>
    </Dialog>
  );
}

function MarkSentDialog({ quotation, onClose, onDone }: { quotation: LifecycleQuotation; onClose: () => void; onDone: () => void }) {
  const [recipient, setRecipient] = useState(quotation.contactName ?? "");
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => markSalesQuotationSent(quotation.id, { recipient: recipient.trim() || undefined, note: note.trim() || undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Mark ${quotation.number} as sent`} description="For a quotation sent outside Vercentlabs, for example on WhatsApp.">
      <div className="flex flex-col gap-3">
        {save.isError && <p role="alert" className="text-sm text-danger">{failureText(save.error, "The quotation could not be marked as sent.")}</p>}
        <TextField label="Sent to" value={recipient} onChange={setRecipient} />
        <TextField label="How it was sent" description="Optional, for example: WhatsApp to the procurement head." value={note} onChange={setNote} />
        <Footer onClose={onClose} label="Mark as sent" isLoading={save.isPending} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

function DecisionDialog({ quotation, decision, onClose, onDone }: { quotation: LifecycleQuotation; decision: "accepted" | "rejected"; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const save = useMutation({ mutationFn: () => recordSalesQuotationDecision(quotation.id, { decision, reference: reference.trim() || undefined, notes: notes.trim() || undefined }), onSuccess: onDone });
  const accepted = decision === "accepted";
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={accepted ? `Record acceptance of ${quotation.number}` : `Record rejection of ${quotation.number}`}
      description={accepted ? "The opportunity stays open: mark it won when the deal is closed." : "The opportunity stays open: you can send a revised quotation."}>
      <div className="flex flex-col gap-3">
        {save.isError && <p role="alert" className="text-sm text-danger">{failureText(save.error, "The decision could not be recorded.")}</p>}
        {accepted && <TextField label="Customer reference" description="Optional, for example the customer's PO number." value={reference} onChange={setReference} />}
        <TextArea label={accepted ? "Notes" : "Reason given by the customer"} value={notes} onChange={setNotes} />
        <Footer onClose={onClose} label={accepted ? "Record acceptance" : "Record rejection"} isLoading={save.isPending} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

function CancelDialog({ quotation, onClose, onDone }: { quotation: LifecycleQuotation; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => cancelSalesQuotation(quotation.id, reason.trim()), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Cancel ${quotation.number}?`} description="The quotation is kept for the record but can no longer be sent or accepted. The opportunity is not affected.">
      <div className="flex flex-col gap-3">
        {save.isError && <p role="alert" className="text-sm text-danger">{failureText(save.error, "The quotation could not be cancelled.")}</p>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <Footer onClose={onClose} label="Cancel quotation" isLoading={save.isPending} isDisabled={!reason.trim()} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}
