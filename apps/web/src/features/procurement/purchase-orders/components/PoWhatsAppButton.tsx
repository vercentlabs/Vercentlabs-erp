"use client";

// Send a confirmed purchase order on WhatsApp (Procurement plan Phase 3): a message with the supplier's link to the order's PDF, to the
// supplier contact's mobile unless another number is entered. WhatsApp opens with it ready; the link opens without signing in.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { post } from "@/features/procurement/shared/http";

type Shared = { url: string; body: string; phone: string | null; whatsapp: string };

export function PoWhatsAppButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const share = useMutation({ mutationFn: () => post<{ result: Shared }>(`/purchase-orders/${orderId}/share`, { phone: phone.trim() || undefined }).then((result) => result.result),
    onSuccess: (result) => { if (result.phone) window.open(result.whatsapp, "_blank", "noopener"); } });
  const result = share.data;
  return (
    <>
      <Button variant="ghost" onPress={() => setOpen(true)}>WhatsApp</Button>
      {open && (
        <Dialog isOpen onOpenChange={(isOpen) => !isOpen && setOpen(false)} title="Send the order on WhatsApp" size="md"
          description="The supplier gets a message with a link to the order's PDF. It goes to their contact's mobile unless you enter another number.">
          <div className="flex flex-col gap-3">
            {share.error && <Notice>{share.error instanceof Error ? share.error.message : "The link could not be made."}</Notice>}
            {!result ? (
              <>
                <TextField label="WhatsApp number" inputMode="tel" placeholder="98200 12345" value={phone} onChange={setPhone} description="Leave empty for the supplier contact's mobile." />
                <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
                  <Button variant="primary" isLoading={share.isPending} onPress={() => share.mutate()}>Open WhatsApp</Button></div>
              </>
            ) : (
              <>
                {!result.phone && <Notice tone="warning">The supplier has no mobile on record: copy the message and send it yourself.</Notice>}
                <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm">{result.body}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onPress={() => void navigator.clipboard?.writeText(result.body)}>Copy message</Button>
                  {result.phone && <a className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse" href={result.whatsapp} target="_blank" rel="noreferrer">Open WhatsApp again</a>}
                  <Button variant="ghost" onPress={() => setOpen(false)}>Done</Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
