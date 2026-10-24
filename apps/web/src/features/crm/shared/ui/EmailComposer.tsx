"use client";

// Email from a record (CRM plan 4.1): the record's emails both ways, and a composer — a template or a fresh email, to the record's person
// by default, with the signature and the record's number added when it is sent. Someone who refused email is never sent to; the
// composer says so instead.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerUpLeft, Mail, Paperclip } from "lucide-react";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, listEmails, prepareEmail, sendEmail, type EmailEntity, type RecordEmail } from "../email-api";

const NONE = "";

// templateId: a template to start from (an email follow-up's type names one in Setup › Activity types).
export function EmailButton({ entity, recordId, label = "Email", templateId, onSent }: { entity: EmailEntity; recordId: string; label?: string; templateId?: string | null; onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}><Mail className="size-4" aria-hidden="true" />{label}</Button>
      {open && <EmailDialog entity={entity} recordId={recordId} startTemplateId={templateId ?? null} onClose={() => setOpen(false)} onSent={() => { setOpen(false); onSent?.(); }} />}
    </>
  );
}

function EmailDialog({ entity, recordId, startTemplateId, onClose, onSent }: { entity: EmailEntity; recordId: string; startTemplateId: string | null; onClose: () => void; onSent: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState(NONE);
  const [replyTo, setReplyTo] = useState<RecordEmail | null>(null);
  const draftQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "email-draft", entity, recordId), queryFn: () => prepareEmail(entity, recordId) });
  const emails = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "record-emails", entity, recordId), queryFn: () => listEmails(entity, recordId) });
  const [to, setTo] = useState<string | null>(null);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const draft = draftQuery.data;
  const fill = useMutation({
    mutationFn: (id: string) => prepareEmail(entity, recordId, id),
    onSuccess: (filled) => { setSubject(filled.subject); setBody(filled.body); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  // Start from the given template once the draft is in, if it is still an active template.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !startTemplateId || !draft?.templates.some((entry) => entry.id === startTemplateId)) return;
    started.current = true;
    setTemplateId(startTemplateId);
    fill.mutate(startTemplateId);
  }, [draft, startTemplateId, fill]);
  const send = useMutation({
    mutationFn: () => sendEmail(entity, recordId, { to: to ?? draft?.to ?? "", cc, subject, body, templateId: templateId || null, replyToEmailId: replyTo?.id ?? null, attachmentIds: attached }),
    onSuccess: () => {
      for (const key of ["record-emails", "timeline"]) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", key) });
      onSent();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const answer = (email: RecordEmail) => {
    setReplyTo(email);
    setTo(email.direction === "inbound" ? email.from ?? "" : email.to.join(", "));
    setSubject(/^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`);
  };
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Email" size="lg">
      <div className="flex flex-col gap-4">
        {draft?.refused && <Notice tone="warning">{draft.refused}</Notice>}
        {error && <Notice>{error}</Notice>}
        {draft && (
          <>
            {replyTo && (
              <p className="flex items-center justify-between gap-2 text-sm text-text-secondary">
                <span>Answering “{replyTo.subject}”</span>
                <Button variant="ghost" size="compact" onPress={() => setReplyTo(null)}>Write a new email instead</Button>
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="To" type="email" value={to ?? draft.to} onChange={setTo} />
              <TextField label="Copy (CC)" value={cc} onChange={setCc} description="Separate addresses with commas." />
            </div>
            {draft.templates.length > 0 && !replyTo && (
              <Select label="Template" selectedKey={templateId} onSelectionChange={(value) => { const id = String(value ?? NONE); setTemplateId(id); if (id) fill.mutate(id); }}
                options={[{ value: NONE, label: "None — write it yourself" }, ...draft.templates.map((entry) => ({ value: entry.id, label: entry.name }))]} />
            )}
            <TextField label="Subject" value={subject} onChange={setSubject} description={draft.reference ? `${draft.reference} is added, so a reply comes back to this record.` : undefined} />
            <TextArea label="Message" value={body} onChange={setBody} rows={10} />
            {(draft.files?.length ?? 0) > 0 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">Attach files from this record</legend>
                {draft.files!.map((file) => (
                  <Checkbox key={file.id} isSelected={attached.includes(file.id)} isDisabled={!attached.includes(file.id) && attached.length >= 5}
                    onChange={(on) => setAttached((current) => (on ? [...current, file.id] : current.filter((id) => id !== file.id)))}>
                    {`${file.fileName} (${Math.max(1, Math.round(file.sizeBytes / 1024))} KB)`}
                  </Checkbox>
                ))}
                <p className="text-xs text-text-muted">Up to 5 files, 10 MB together. Add a brochure or price list under Files on the record.</p>
              </fieldset>
            )}
            {draft.signature && <p className="whitespace-pre-wrap text-xs text-text-muted">Signature added: {draft.signature}</p>}
            {!draft.replyTo && <p className="text-xs text-text-muted">Replies go to your own address. Set the CRM reply address in Setup › Email templates to have them land on this record.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose}>Cancel</Button>
              <Button variant="primary" isLoading={send.isPending} isDisabled={!draft.canSend || Boolean(draft.refused) || !subject.trim() || !body.trim()} onPress={() => send.mutate()}>Send</Button>
            </div>
          </>
        )}
        {(emails.data?.length ?? 0) > 0 && (
          <section className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">Emails on this record</h3>
            <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-card)] border border-border">
              {emails.data!.map((email) => (
                <li key={email.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{email.subject}</span>
                    <Button variant="ghost" size="compact" onPress={() => answer(email)}><CornerUpLeft className="size-3.5" aria-hidden="true" />Reply</Button>
                  </div>
                  <span className="text-xs text-text-muted">
                    {email.direction === "inbound" ? `From ${email.fromName ? `${email.fromName} <${email.from}>` : email.from}` : `To ${email.to.join(", ")}${email.sentByName ? ` · by ${email.sentByName}` : ""}`}
                    {" · "}{formatDateTime(email.createdAt)}
                  </span>
                  {email.body && <p className="line-clamp-3 whitespace-pre-wrap text-text-secondary">{email.body}</p>}
                  {(email.attachments?.length ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-text-muted"><Paperclip className="size-3" aria-hidden="true" />{email.attachments!.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
