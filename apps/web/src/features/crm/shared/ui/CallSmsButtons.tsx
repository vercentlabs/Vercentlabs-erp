"use client";

// Call and SMS from a record (CRM plan 4.4). With Exotel connected, Call rings the salesperson's phone and then the customer, and the
// call logs itself; SMS goes from a DLT template. The record's calls and SMS are listed in the same window.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone } from "lucide-react";
import { Button, Dialog, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getChannelSettings, getRecordChannels, sendSms, setMyCallPhone, startCall, type ChannelEntity } from "../channels-api";

// Shown only when the organization connected calling or SMS (the plain phone link stays where it was).
export function CallSmsButtons({ entity, recordId }: { entity: ChannelEntity; recordId: string }) {
  const workspace = useWorkspaceContext();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "channel-settings"), queryFn: getChannelSettings, staleTime: 60_000 }).data;
  const [open, setOpen] = useState<"call" | "sms" | null>(null);
  if (!settings) return null;
  return (
    <>
      {settings.telephony.provider !== "none" && <Button variant="secondary" onPress={() => setOpen("call")}><Phone className="size-4" aria-hidden="true" />Call</Button>}
      {settings.sms.provider !== "none" && <Button variant="secondary" onPress={() => setOpen("sms")}><MessageSquare className="size-4" aria-hidden="true" />SMS</Button>}
      {open && <ChannelDialog entity={entity} recordId={recordId} mode={open} myCallPhone={settings.myCallPhone} onClose={() => setOpen(null)} />}
    </>
  );
}

const CALL_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = { completed: "success", ringing: "info", in_progress: "info", queued: "neutral", busy: "danger", no_answer: "danger", failed: "danger", canceled: "neutral" };
const minutes = (seconds: number | null) => (seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "");

function ChannelDialog({ entity, recordId, mode, myCallPhone, onClose }: { entity: ChannelEntity; recordId: string; mode: "call" | "sms"; myCallPhone: string | null; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "record-channels", entity, recordId);
  const data = useQuery({ queryKey: key, queryFn: () => getRecordChannels(entity, recordId), refetchInterval: mode === "call" ? 5000 : false }).data;
  const [phone, setPhone] = useState(myCallPhone ?? "");
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") }); };
  const call = useMutation({
    mutationFn: async () => {
      if (phone.trim() !== (myCallPhone ?? "")) {
        await setMyCallPhone(phone.trim() || null);
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "channel-settings") });
      }
      return startCall(entity, recordId);
    },
    onSuccess: (result) => { setMessage(result.error ? { tone: "danger", text: result.error } : { tone: "success", text: "Your phone is ringing. Answer it, and the customer is called next." }); refresh(); },
    onError: (failure) => setMessage({ tone: "danger", text: errorMessage(failure) }),
  });
  const template = data?.templates.find((entry) => entry.id === templateId);
  const sms = useMutation({
    mutationFn: () => sendSms(entity, recordId, templateId, values),
    onSuccess: (result) => { setMessage(result.error ? { tone: "danger", text: result.error } : { tone: "success", text: "SMS sent." }); setValues([]); refresh(); },
    onError: (failure) => setMessage({ tone: "danger", text: errorMessage(failure) }),
  });
  let preview = template?.body ?? "";
  if (template) { let index = 0; preview = template.body.replace(/\{#var#\}/gi, () => values[index++] || "…"); }
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={mode === "call" ? "Call" : "SMS"} size="lg">
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {mode === "call" ? (
          <>
            <TextField label="Your phone (rings first)" type="tel" value={phone} onChange={setPhone} description="Kept for your next calls." />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose}>Close</Button>
              <Button variant="primary" isLoading={call.isPending} isDisabled={!phone.trim()} onPress={() => call.mutate()}>Call now</Button>
            </div>
            {(data?.calls.length ?? 0) > 0 && (
              <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
                {data!.calls.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <StatusBadge tone={CALL_TONE[row.status] ?? "neutral"}>{row.status.replace("_", " ")}</StatusBadge>
                    <span className="flex-1">{row.customerPhone}{row.durationSeconds ? ` · ${minutes(row.durationSeconds)}` : ""}{row.agentName ? ` · ${row.agentName}` : ""}</span>
                    <span className="text-xs text-text-muted">{formatDateTime(row.createdAt)}</span>
                    {row.recordingUrl && <a className="text-xs text-brand hover:underline" href={row.recordingUrl} target="_blank" rel="noreferrer">Recording</a>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {data && data.templates.length === 0 && <Notice tone="warning">No SMS templates yet. Add your DLT-approved templates in Setup › Calls and SMS.</Notice>}
            {data && data.templates.length > 0 && (
              <>
                <Select label="Template" selectedKey={templateId} onSelectionChange={(value) => { setTemplateId(String(value ?? "")); setValues([]); }}
                  options={data.templates.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.category === "promotional" ? " (promotional)" : ""}` }))} />
                {template && Array.from({ length: template.variables }).map((_, index) => (
                  <TextField key={index} label={`Value ${index + 1}`} value={values[index] ?? ""} maxLength={30}
                    onChange={(value) => setValues((current) => { const next = [...current]; next[index] = value; return next; })} />
                ))}
                {template && <p className="rounded-[var(--radius-card)] bg-surface-muted px-3 py-2 text-sm">{preview}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onPress={onClose}>Close</Button>
                  <Button variant="primary" isLoading={sms.isPending} isDisabled={!template || values.filter((value) => value?.trim()).length < (template?.variables ?? 0)} onPress={() => sms.mutate()}>Send SMS</Button>
                </div>
              </>
            )}
            {(data?.sms.length ?? 0) > 0 && (
              <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
                {data!.sms.map((row) => (
                  <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span>{row.body}</span>
                    <span className="text-xs text-text-muted">{formatDateTime(row.createdAt)} · {row.status}{row.sentByName ? ` · ${row.sentByName}` : ""}{row.error ? ` · ${row.error}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
