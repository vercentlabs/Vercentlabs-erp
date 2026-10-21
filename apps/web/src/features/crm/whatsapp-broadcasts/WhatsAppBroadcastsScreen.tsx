"use client";

// CRM › WhatsApp broadcasts (CRM audit M2): one approved WhatsApp template to many leads or contacts — only those who agreed to WhatsApp
// and have not opted out — sent by the connected WhatsApp Business number. Then see how many were sent, delivered, read and replied.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { getWhatsAppSettings } from "@/features/crm/shared/whatsapp-api";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class BroadcastError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(BroadcastError, "body");
type Broadcast = {
  id: string; name: string; audience: "leads" | "contacts"; filters: Record<string, string>; templateName: string; templateLanguage: string; parameters: string[];
  status: string; scheduledAt: string | null; finishedAt: string | null; createdAt: string;
  counts: { recipients: number; sent: number; skipped: number; failed: number; delivered: number; read: number; replied: number };
};
type Preview = { total: number; eligible: number; skipped: Record<string, number>; tooMany: boolean };
const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "Draft", tone: "neutral" }, scheduled: { label: "Scheduled", tone: "info" }, sending: { label: "Sending", tone: "info" }, sent: { label: "Sent", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
};
const LANGUAGES = [
  { value: "en", label: "English" }, { value: "en_US", label: "English (US)" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" }, { value: "gu", label: "Gujarati" },
  { value: "ta", label: "Tamil" }, { value: "te", label: "Telugu" }, { value: "kn", label: "Kannada" }, { value: "bn", label: "Bengali" }, { value: "ml", label: "Malayalam" }, { value: "pa", label: "Punjabi" },
];
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export function WhatsAppBroadcastsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "whatsapp-broadcasts");
  const query = useQuery({ queryKey: key, queryFn: () => request<{ broadcasts: Broadcast[] }>("/api/crm/whatsapp-broadcasts").then((result) => result.broadcasts), enabled: canManage, refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "whatsapp-settings"), queryFn: getWhatsAppSettings, enabled: canManage, staleTime: 60_000 });
  const [editing, setEditing] = useState<Broadcast | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" }) => request(`/api/crm/whatsapp-broadcasts/${id}/${action}`, { method: "POST", json: {} }),
    onSuccess: refresh,
  });
  if (!canManage) return <PermissionState title="You can't send WhatsApp broadcasts" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading WhatsApp broadcasts" rows={4} />;
  if (query.isError) return <ErrorState title="Could not load WhatsApp broadcasts" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const notConnected = settings.data && settings.data.mode !== "cloud_api";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="WhatsApp broadcasts" description="One approved WhatsApp template to many leads or contacts — only those who agreed to WhatsApp and have not opted out. A reply of STOP opts them out."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New broadcast</Button>} />
      {notConnected && (
        <Notice>
          Broadcasts are sent by WhatsApp itself, so your WhatsApp Business number must be connected first.{" "}
          <Link className="font-medium underline" href="/crm/settings/whatsapp">Connect it in Setup › WhatsApp</Link>. You can prepare drafts meanwhile.
        </Notice>
      )}
      {act.isError && <Notice>{act.error instanceof Error ? act.error.message : "That did not work."}</Notice>}
      {(query.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">No WhatsApp broadcasts yet.</p> : (
        <ul className="flex max-w-5xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {(query.data ?? []).map((broadcast) => (
            <li key={broadcast.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{broadcast.name}</span>
                  <StatusBadge tone={STATUS[broadcast.status]?.tone ?? "neutral"}>{STATUS[broadcast.status]?.label ?? broadcast.status}</StatusBadge>
                  <Badge tone="neutral">{broadcast.audience === "leads" ? "Leads" : "Contacts"}</Badge>
                </div>
                <span className="text-text-secondary">{`Template ${broadcast.templateName} (${broadcast.templateLanguage})`}</span>
                {broadcast.status !== "draft" && (
                  <span className="text-xs text-text-muted">
                    {`${broadcast.counts.sent} sent of ${broadcast.counts.recipients - broadcast.counts.skipped} · delivered ${pct(broadcast.counts.delivered, broadcast.counts.sent)} · read ${pct(broadcast.counts.read, broadcast.counts.sent)} · ${broadcast.counts.replied} replied${broadcast.counts.failed ? ` · ${broadcast.counts.failed} failed` : ""}${broadcast.counts.skipped ? ` · ${broadcast.counts.skipped} skipped` : ""}`}
                    {broadcast.scheduledAt && broadcast.status === "scheduled" ? ` · goes ${formatDateTime(broadcast.scheduledAt)}` : ""}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {broadcast.status === "draft" && <Button variant="ghost" size="compact" onPress={() => setEditing(broadcast)}>Edit and send</Button>}
                {["draft", "scheduled", "sending"].includes(broadcast.status) && <Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ id: broadcast.id, action: "cancel" })}>Cancel</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <BroadcastDialog broadcast={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  );
}

function BroadcastDialog({ broadcast, onClose, onDone }: { broadcast: Broadcast | null; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const [name, setName] = useState(broadcast?.name ?? "");
  const [audience, setAudience] = useState<"leads" | "contacts">(broadcast?.audience ?? "leads");
  const [filters, setFilters] = useState<Record<string, string>>(broadcast?.filters ?? {});
  const [templateName, setTemplateName] = useState(broadcast?.templateName ?? "");
  const [templateLanguage, setTemplateLanguage] = useState(broadcast?.templateLanguage ?? "en");
  const [parameters, setParameters] = useState<string[]>(broadcast?.parameters ?? []);
  const [when, setWhen] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setFilter = (key: string) => (value: string) => setFilters((current) => { const next = { ...current }; if (!value || value === "any") delete next[key]; else next[key] = value; return next; });
  const check = useMutation({
    mutationFn: () => request<{ preview: Preview }>("/api/crm/whatsapp-broadcasts/preview", { method: "POST", json: { audience, filters } }).then((result) => result.preview),
    onSuccess: setPreview, onError: (failure) => setError(failure instanceof Error ? failure.message : "The audience could not be counted."),
  });
  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const input = { name, audience, filters, templateName: templateName.trim(), templateLanguage, parameters };
      const saved = broadcast
        ? (await request<{ broadcast: Broadcast }>(`/api/crm/whatsapp-broadcasts/${broadcast.id}`, { method: "PATCH", json: input })).broadcast
        : (await request<{ broadcast: Broadcast }>("/api/crm/whatsapp-broadcasts", { method: "POST", json: input })).broadcast;
      if (send) await request(`/api/crm/whatsapp-broadcasts/${saved.id}/schedule`, { method: "POST", json: when ? { scheduledAt: new Date(when).toISOString() } : {} });
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The broadcast could not be saved."),
  });
  const any = (list: Array<{ value: string; label: string }>, label: string) => [{ value: "any", label }, ...list];
  const ready = name.trim() && templateName.trim() && parameters.every((value) => value.trim());
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={broadcast ? `Edit ${broadcast.name}` : "New WhatsApp broadcast"} size="xl">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" description="For you; the recipients see only the template." isRequired value={name} onChange={setName} maxLength={120} />
          <Select label="Send to" selectedKey={audience} onSelectionChange={(key) => { setAudience(String(key) as "leads" | "contacts"); setFilters({}); setPreview(null); }}
            options={[{ value: "leads", label: "Leads" }, { value: "contacts", label: "Contacts" }]} />
        </div>
        <fieldset className="grid gap-3 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">Who (optional filters)</legend>
          {audience === "leads" ? (
            <>
              <Select label="Status" size="compact" selectedKey={filters.status ?? "any"} onSelectionChange={(key) => setFilter("status")(String(key))}
                options={any([{ value: "open", label: "Open" }, { value: "qualified", label: "Qualified" }, { value: "disqualified", label: "Not interested" }], "Any status")} />
              <Select label="Source" size="compact" selectedKey={filters.sourceId ?? "any"} onSelectionChange={(key) => setFilter("sourceId")(String(key))}
                options={any((options.data?.sources ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any source")} />
              <Select label="Tag" size="compact" selectedKey={filters.tagId ?? "any"} onSelectionChange={(key) => setFilter("tagId")(String(key))}
                options={any((options.data?.tags ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any tag")} />
              <Select label="Campaign" size="compact" selectedKey={filters.campaignId ?? "any"} onSelectionChange={(key) => setFilter("campaignId")(String(key))}
                options={any((options.data?.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Any campaign")} />
              <TextField label="State" size="compact" value={filters.state ?? ""} onChange={setFilter("state")} />
              <TextField label="District" size="compact" value={filters.district ?? ""} onChange={setFilter("district")} />
              <TextField label="City" size="compact" value={filters.city ?? ""} onChange={setFilter("city")} />
            </>
          ) : <TextField label="City" size="compact" value={filters.city ?? ""} onChange={setFilter("city")} />}
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button variant="secondary" size="compact" isLoading={check.isPending} onPress={() => check.mutate()}>Count who gets it</Button>
            {preview && (
              <span className="text-sm">
                {`${preview.eligible} of ${preview.total} will receive it.`}
                {Object.entries(preview.skipped).length > 0 && <span className="text-text-secondary">{` Left out: ${Object.entries(preview.skipped).map(([reason, count]) => `${reason} (${count})`).join(", ")}.`}</span>}
              </span>
            )}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Template name" isRequired value={templateName} onChange={setTemplateName} placeholder="diwali_offer_2026"
            description="Exactly as approved in WhatsApp Manager. WhatsApp allows only approved templates for messages to many people." />
          <Select label="Template language" selectedKey={templateLanguage} onSelectionChange={(key) => setTemplateLanguage(String(key))} options={LANGUAGES} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Template values</legend>
          <p className="text-xs text-text-secondary">One for each {"{{1}}"}, {"{{2}}"}… in the template, in order. {"{{first_name}}"}, {"{{name}}"} and {"{{company}}"} are filled in for each person.</p>
          {parameters.map((value, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextField className="flex-1" label={`{{${index + 1}}}`} value={value} onChange={(next) => setParameters((current) => current.map((entry, position) => (position === index ? next : entry)))} />
              <Button variant="ghost" size="compact" aria-label={`Remove value ${index + 1}`} onPress={() => setParameters((current) => current.filter((_entry, position) => position !== index))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="secondary" size="compact" isDisabled={parameters.length >= 10} onPress={() => setParameters((current) => [...current, current.length === 0 ? "{{first_name}}" : ""])}>Add a value</Button>
          </div>
        </fieldset>
        <DateTimeInput label="Send at (optional)" description="Empty: as soon as you press Send." value={when} onChange={setWhen} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="secondary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate(false)}>Save draft</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!ready} onPress={() => save.mutate(true)}>{when ? "Schedule" : "Send"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
