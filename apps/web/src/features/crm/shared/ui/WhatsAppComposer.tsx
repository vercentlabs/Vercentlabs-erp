"use client";

// WhatsApp from a record (CRM plan 4.2). Click-to-chat opens WhatsApp with the message ready and logs it; with the Business API connected
// CRM sends it — a free message inside 24 hours of the customer's last message, else an approved template to someone who agreed.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button, Dialog, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, listWhatsAppMessages, logClickToChat, prepareWhatsApp, sendWhatsApp, type WhatsAppEntity } from "../whatsapp-api";

export function WhatsAppButton({ entity, recordId }: { entity: WhatsAppEntity; recordId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</Button>
      {open && <WhatsAppDialog entity={entity} recordId={recordId} onClose={() => setOpen(false)} />}
    </>
  );
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = { logged: "neutral", sent: "info", delivered: "info", read: "success", failed: "danger", received: "neutral" };

function WhatsAppDialog({ entity, recordId, onClose }: { entity: WhatsAppEntity; recordId: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const draftQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "whatsapp-draft", entity, recordId), queryFn: () => prepareWhatsApp(entity, recordId) });
  const messages = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "whatsapp-messages", entity, recordId), queryFn: () => listWhatsAppMessages(entity, recordId) });
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateLanguage, setTemplateLanguage] = useState("en");
  const [parameters, setParameters] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = draftQuery.data;
  const refresh = () => { for (const key of ["whatsapp-messages", "timeline"]) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", key) }); };
  const send = useMutation({
    mutationFn: async () => {
      if (draft?.mode === "cloud_api") {
        return sendWhatsApp(entity, recordId, draft.needsTemplate || useTemplate
          ? { templateName, templateLanguage, parameters: parameters.split("|").map((value) => value.trim()).filter(Boolean) }
          : { body });
      }
      const logged = await logClickToChat(entity, recordId, body);
      window.open(logged.link, "_blank", "noopener,noreferrer");
      return logged;
    },
    onSuccess: () => { setBody(""); setTemplateName(""); setParameters(""); setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const api = draft?.mode === "cloud_api";
  const template = api && (draft?.needsTemplate || useTemplate);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`WhatsApp${draft?.name ? ` ${draft.name}` : ""}`} size="lg">
      <div className="flex flex-col gap-4">
        {draft?.refused && <Notice tone="warning">{draft.refused}</Notice>}
        {draft && !draft.phone && <Notice tone="warning">This record has no mobile number.</Notice>}
        {error && <Notice>{error}</Notice>}
        {draft?.phone && !draft.refused && (
          <>
            <p className="text-sm text-text-secondary">
              To {draft.phone}. {api
                ? (draft.windowOpen ? "They messaged you in the last 24 hours: you can write freely." : "More than 24 hours since their last message: WhatsApp allows only an approved template.")
                : "WhatsApp opens with the message ready; it is logged here when you press Send."}
              {api && draft.needsTemplate && !draft.consented ? " They have not agreed to WhatsApp messages yet, so a template cannot be sent." : ""}
            </p>
            {template ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField label="Template name" value={templateName} onChange={setTemplateName} description="As approved in WhatsApp Manager." />
                <TextField label="Language" value={templateLanguage} onChange={setTemplateLanguage} description="Such as en or hi." />
                <TextField label="Values" value={parameters} onChange={setParameters} description="For {{1}}, {{2}}…, separated by |" />
              </div>
            ) : (
              <TextArea label="Message" value={body} onChange={setBody} rows={5} />
            )}
            {api && draft.windowOpen && <Button variant="ghost" size="compact" onPress={() => setUseTemplate(!useTemplate)}>{useTemplate ? "Write a message instead" : "Use a template instead"}</Button>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose}>Close</Button>
              <Button variant="primary" isLoading={send.isPending} isDisabled={template ? !templateName.trim() : !body.trim()} onPress={() => send.mutate()}>
                {api ? "Send" : "Open WhatsApp and log"}
              </Button>
            </div>
          </>
        )}
        {(messages.data?.length ?? 0) > 0 && (
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto border-t border-border pt-3">
            {messages.data!.map((message) => (
              <li key={message.id} className={`flex max-w-[85%] flex-col gap-1 rounded-[var(--radius-card)] px-3 py-2 text-sm ${message.direction === "inbound" ? "self-start bg-surface-muted" : "self-end bg-success-soft"}`}>
                <span className="whitespace-pre-wrap">{message.body}</span>
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {formatDateTime(message.createdAt)}{message.sentByName ? ` · ${message.sentByName}` : ""}
                  {message.direction === "outbound" && <StatusBadge tone={STATUS_TONE[message.status] ?? "neutral"}>{message.status === "logged" ? "Sent from phone" : message.status}</StatusBadge>}
                </span>
                {message.error && <span className="text-xs text-danger">{message.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
