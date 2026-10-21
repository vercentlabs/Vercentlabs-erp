"use client";

// The customer's link to a quotation or invoice (Sales audit: customer portal): they open it without signing in to read it, download the
// PDF, accept the quotation or pay the invoice by UPI. The same link every time; it can be stopped.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog } from "@vercentlabs/design-system";

import { post, SalesApiError } from "./http";

export function ShareLinkButton({ kind, id, size }: { kind: "quotation" | "invoice"; id: string; size?: "compact" | "standard" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const share = useMutation({ mutationFn: (revoke: boolean) => post<{ result: { url?: string; revoked?: boolean } }>("/document-links", { kind, id, revoke }) });
  const url = share.data?.result.url;
  return (
    <>
      <Button variant="secondary" size={size} onPress={() => { setOpen(true); setCopied(false); share.mutate(false); }}>Share link</Button>
      {open && (
        <Dialog isOpen onOpenChange={(isOpen) => !isOpen && setOpen(false)} title="The customer's link" size="md"
          description={kind === "quotation" ? "They open it without signing in to read the quotation, download the PDF and accept it." : "They open it without signing in to read the invoice, download the PDF and pay by UPI."}>
          <div className="flex flex-col gap-4">
            {share.isPending && <p className="text-sm text-text-muted">Making the link…</p>}
            {share.isError && <p role="alert" className="text-sm text-danger">{share.error instanceof SalesApiError ? share.error.message : "The link could not be made."}</p>}
            {url && <p className="break-all rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">{url}</p>}
            {share.data?.result.revoked !== undefined && <p className="text-sm">The link no longer works.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {url && <Button variant="ghost" onPress={() => share.mutate(true)}>Stop this link</Button>}
              {url && <Button variant="primary" onPress={() => { void navigator.clipboard?.writeText(url); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>}
              <Button variant="secondary" onPress={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
