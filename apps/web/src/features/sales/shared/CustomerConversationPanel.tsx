"use client";

// Customer & emails on a Sales document (CRM parity: a lead or deal shows whom to call and the emails with them): the contact on the
// document with Call, WhatsApp and Email, and every email sent with the document and every reply that came back, newest first.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { request } from "@/features/sales/shared/http";
import { Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Conversation = { contact: { name: string | null; phone: string | null; email: string | null } | null;
  emails: Array<{ direction: "in" | "out"; sender: string | null; recipients: string | null; subject: string | null; body: string | null; at: string }> };
type DocumentType = "sales.quotation" | "sales.order" | "sales.invoice" | "sales.credit_note";

const when = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const digits = (phone: string) => phone.replace(/\D/g, "");
const action = "inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-surface-muted";

export function CustomerConversationPanel({ type, id }: { type: DocumentType; id: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "conversation", type, id),
    queryFn: () => request<Conversation>(`/conversations/${encodeURIComponent(type)}/${id}`) });
  const [open, setOpen] = useState<number | null>(null);
  const contact = query.data?.contact;
  const emails = query.data?.emails ?? [];
  if (query.isLoading || (!contact && !emails.length)) return null;
  const phone = contact?.phone ? digits(contact.phone) : "";
  return (
    <Panel title="Customer & emails" description="Reach the customer, and see what was emailed with this document and what came back.">
      {contact && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-text">{contact.name ?? "Customer"}</p>
            <p className="truncate text-text-secondary">{[contact.phone, contact.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            {phone && <a className={action} href={`tel:${phone.length === 10 ? `+91${phone}` : `+${phone}`}`}>Call</a>}
            {phone && <a className={action} href={`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            {contact.email && <a className={action} href={`mailto:${contact.email}`}>Email</a>}
          </div>
        </div>
      )}
      {emails.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {emails.map((email, index) => (
            <li key={`${email.at}-${index}`} className="py-2.5 text-sm">
              <button type="button" className="flex w-full flex-col gap-0.5 text-left sm:flex-row sm:items-baseline sm:justify-between sm:gap-3" aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}>
                <span className="min-w-0">
                  <span className={`mr-2 text-xs font-medium ${email.direction === "in" ? "text-brand" : "text-text-muted"}`}>{email.direction === "in" ? "Reply" : "Sent"}</span>
                  <span className="font-medium text-text">{email.subject || "(no subject)"}</span>
                  <span className="block truncate text-xs text-text-secondary">{email.direction === "in" ? `From ${email.sender ?? ""}` : `To ${email.recipients ?? ""}`}</span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">{when(email.at)}</span>
              </button>
              {open === index && email.body && <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-muted p-2 text-text-secondary">{email.body}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="border-t border-border pt-2 text-sm text-text-muted">Nothing emailed with this document yet.</p>}
    </Panel>
  );
}
