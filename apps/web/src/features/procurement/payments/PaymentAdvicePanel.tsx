"use client";

// The payment advice on a recorded payment (Procurement report Phase 2): to whom it went and when, emailing it now (to the supplier's
// accounts contact, or another address), and the same summary on WhatsApp.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { Button, Dialog, StatusBadge, TextField, buttonVariants } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { post, request } from "@/features/procurement/shared/http";

type Advice = {
  sends: Array<{ channel: string; recipients: string; status: "sent" | "not_sent"; reason: string | null; automatic: boolean; at: string; by: string | null }>;
  recipient: { email: string | null; name: string | null };
  whatsapp: string;
};
const when = (value: string) => new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function PaymentAdvicePanel({ paymentId }: { paymentId: string }) {
  const queryClient = useQueryClient();
  const key = ["procurement", "payment-advice", paymentId];
  const query = useQuery({ queryKey: key, queryFn: () => request<{ advice: Advice }>(`/payments/${paymentId}/advice`).then((result) => result.advice) });
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const send = useMutation({
    mutationFn: () => post<{ result: { sent: boolean; to: string } }>(`/payments/${paymentId}/advice`, { to: to.trim() || undefined }).then((result) => result.result),
    onSuccess: () => { setOpen(false); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const advice = query.data;
  return (
    <Panel title="Payment advice" description="Tells the supplier which invoices this payment settles."
      actions={advice ? (
        <div className="flex flex-wrap gap-2">
          <Button size="compact" variant="secondary" onPress={() => { setTo(advice.recipient.email ?? ""); setOpen(true); }}><Mail className="size-3.5" aria-hidden="true" />Email advice</Button>
          <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={advice.whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="size-3.5" aria-hidden="true" />WhatsApp</a>
        </div>
      ) : undefined}>
      {send.data?.sent && <Notice tone="success">Sent to {send.data.to}.</Notice>}
      {query.isError && <Notice>{query.error instanceof Error ? query.error.message : "Could not load the advice."}</Notice>}
      {advice && (advice.sends.length ? (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {advice.sends.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{entry.status === "sent" ? `Emailed to ${entry.recipients}` : `Not sent: ${entry.reason ?? "unknown reason"}`}
                <span className="block text-xs text-text-muted">{when(entry.at)}{entry.automatic ? " · automatically" : entry.by ? ` · by ${entry.by}` : ""}</span></span>
              <StatusBadge tone={entry.status === "sent" ? "success" : "warning"}>{entry.status === "sent" ? "Sent" : "Not sent"}</StatusBadge>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted">Not sent yet{advice.recipient.email ? ` · goes to ${advice.recipient.email}` : " · the supplier has no email address"}.</p>)}
      {open && (
        <Dialog isOpen onOpenChange={(isOpen) => !isOpen && setOpen(false)} title="Email the payment advice" description="The advice PDF goes with the email." size="md">
          <div className="flex flex-col gap-3">
            {send.error && <Notice>{send.error instanceof Error ? send.error.message : "Could not send."}</Notice>}
            <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" isDisabled={!to.trim()} isLoading={send.isPending} onPress={() => send.mutate()}>Send</Button>
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
