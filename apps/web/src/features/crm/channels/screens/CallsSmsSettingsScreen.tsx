"use client";

// CRM › Setup › Calls and SMS (CRM plan 4.4): Exotel for click-to-call (the salesperson's phone rings first, then the customer, through
// your ExoPhone), and Exotel or MSG91 for SMS with your DLT registration — the sender ID (header), your principal entity ID, and each
// template exactly as approved on DLT with its template ID.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, PermissionState, Radio, RadioGroup, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { errorMessage, getChannelSettings, listSmsTemplates, saveChannelSettings, saveSmsTemplate, type ChannelSettings, type SmsTemplate } from "@/features/crm/shared/channels-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function CallsSmsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "channel-settings"), queryFn: getChannelSettings, enabled: canManage });
  const [keys, setKeys] = useState<{ call: string | null; sms: string | null }>({ call: null, sms: null });
  if (!canManage) return <PermissionState title="You can't set up calls and SMS" description="Ask an administrator for the Manage CRM settings permission." />;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <div>
        <h1 className="text-xl font-semibold">Calls and SMS</h1>
        <p className="text-sm text-text-secondary">Call and text customers from their page; every call and SMS is logged on the record.</p>
      </div>
      {(keys.call || keys.sms) && (
        <Notice tone="warning">
          <span className="flex flex-col gap-1">
            <span>Callback addresses — CRM gives them to the provider with each call and SMS; keep them for your records (they are not shown again).</span>
            {keys.call && <code className="break-all">Calls: {origin}/api/crm/channels/hooks/{keys.call}</code>}
            {keys.sms && <code className="break-all">SMS delivery reports: {origin}/api/crm/channels/hooks/{keys.sms}</code>}
          </span>
        </Notice>
      )}
      {query.isLoading ? <LoadingState label="Loading" rows={4} /> : query.data && (
        <>
          <TelephonyCard key={`t${query.dataUpdatedAt}`} settings={query.data} onSaved={(key) => { if (key) setKeys((current) => ({ ...current, call: key })); void query.refetch(); }} />
          <SmsCard key={`s${query.dataUpdatedAt}`} settings={query.data} onSaved={(key) => { if (key) setKeys((current) => ({ ...current, sms: key })); void query.refetch(); }} />
          <SmsTemplates />
        </>
      )}
    </div>
  );
}

function TelephonyCard({ settings, onSaved }: { settings: ChannelSettings; onSaved: (key: string | null) => void }) {
  const current = settings.telephony;
  const [provider, setProvider] = useState(current.provider);
  const [accountSid, setAccountSid] = useState(current.accountSid ?? "");
  const [apiHost, setApiHost] = useState(current.apiHost);
  const [callerId, setCallerId] = useState(current.callerId ?? "");
  const [recordCalls, setRecordCalls] = useState(current.recordCalls);
  const [apiKey, setApiKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const save = useMutation({
    mutationFn: () => saveChannelSettings({ telephony: { provider, accountSid, apiHost, callerId, recordCalls, apiKey, apiToken } }),
    onSuccess: (result) => onSaved(result.callWebhookKey),
  });
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Click-to-call</h2>
      {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
      <RadioGroup label="Calling" value={provider} onChange={(value) => setProvider(value as typeof provider)}>
        <Radio value="none">Not connected (salespeople ring from their own phone and log the call)</Radio>
        <Radio value="exotel">Exotel</Radio>
      </RadioGroup>
      {provider === "exotel" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Account SID" value={accountSid} onChange={setAccountSid} />
          <Select label="Region" selectedKey={apiHost} onSelectionChange={(value) => setApiHost(String(value))}
            options={[{ value: "api.exotel.com", label: "Singapore (api.exotel.com)" }, { value: "api.in.exotel.com", label: "Mumbai (api.in.exotel.com)" }]} />
          <TextField label="ExoPhone (caller ID)" value={callerId} onChange={setCallerId} description="The virtual number customers see." />
          <Checkbox isSelected={recordCalls} onChange={setRecordCalls}>Record calls</Checkbox>
          <TextField label="API key" type="password" value={apiKey} onChange={setApiKey} description={current.credentialsSet.includes("apiKey") ? "Kept. Type a new one only to replace it." : undefined} />
          <TextField label="API token" type="password" value={apiToken} onChange={setApiToken} description={current.credentialsSet.includes("apiToken") ? "Kept. Type a new one only to replace it." : undefined} />
        </div>
      )}
      <div><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
    </section>
  );
}

function SmsCard({ settings, onSaved }: { settings: ChannelSettings; onSaved: (key: string | null) => void }) {
  const current = settings.sms;
  const [provider, setProvider] = useState(current.provider);
  const [senderId, setSenderId] = useState(current.senderId ?? "");
  const [dltEntityId, setDltEntityId] = useState(current.dltEntityId ?? "");
  const [accountSid, setAccountSid] = useState(current.accountSid ?? "");
  const [apiHost, setApiHost] = useState(current.apiHost);
  const [apiKey, setApiKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [authKey, setAuthKey] = useState("");
  const save = useMutation({
    mutationFn: () => saveChannelSettings({ sms: { provider, senderId, dltEntityId, accountSid, apiHost, apiKey, apiToken, authKey } }),
    onSuccess: (result) => onSaved(result.smsWebhookKey),
  });
  const kept = (key: string) => (current.credentialsSet.includes(key) ? "Kept. Type a new one only to replace it." : undefined);
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">SMS</h2>
      {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
      <RadioGroup label="Provider" value={provider} onChange={(value) => setProvider(value as typeof provider)}>
        <Radio value="none">Not connected</Radio>
        <Radio value="exotel">Exotel</Radio>
        <Radio value="msg91">MSG91</Radio>
      </RadioGroup>
      {provider !== "none" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Sender ID (DLT header)" value={senderId} onChange={(value) => setSenderId(value.toUpperCase())} />
          <TextField label="DLT principal entity ID" value={dltEntityId} onChange={setDltEntityId} />
          {provider === "exotel" ? (
            <>
              <TextField label="Account SID" value={accountSid} onChange={setAccountSid} />
              <Select label="Region" selectedKey={apiHost} onSelectionChange={(value) => setApiHost(String(value))}
                options={[{ value: "api.exotel.com", label: "Singapore" }, { value: "api.in.exotel.com", label: "Mumbai" }]} />
              <TextField label="API key" type="password" value={apiKey} onChange={setApiKey} description={kept("apiKey")} />
              <TextField label="API token" type="password" value={apiToken} onChange={setApiToken} description={kept("apiToken")} />
            </>
          ) : (
            <TextField label="Auth key" type="password" value={authKey} onChange={setAuthKey} description={kept("authKey")} />
          )}
        </div>
      )}
      <div><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
    </section>
  );
}

function SmsTemplates() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "sms-templates", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listSmsTemplates(true) });
  const [editing, setEditing] = useState<SmsTemplate | "new" | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">SMS templates (DLT)</h2>
          <p className="text-sm text-text-secondary">Paste each template exactly as approved on your DLT portal, with {"{#var#}"} where values go.</p>
        </div>
        <Button variant="secondary" onPress={() => setEditing("new")}>Add template</Button>
      </div>
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
        {query.data?.length === 0 && <li className="px-3 py-4 text-text-secondary">No templates yet.</li>}
        {(query.data ?? []).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="flex min-w-60 flex-1 flex-col"><span className="font-medium">{row.name}</span><span className="text-xs text-text-muted">{row.body}</span></span>
            <span className="text-xs text-text-muted">DLT {row.dltTemplateId} · {row.category}</span>
            <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Off"}</StatusBadge>
            <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Edit</Button>
          </li>
        ))}
      </ul>
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sms-templates") }); }} />}
    </section>
  );
}

function TemplateDialog({ template, onClose, onSaved }: { template: SmsTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [dltTemplateId, setDltTemplateId] = useState(template?.dltTemplateId ?? "");
  const [category, setCategory] = useState<SmsTemplate["category"]>(template?.category ?? "service");
  const [body, setBody] = useState(template?.body ?? "");
  const [active, setActive] = useState((template?.status ?? "active") === "active");
  const save = useMutation({ mutationFn: () => saveSmsTemplate(template?.id ?? null, { name, dltTemplateId, category, body, status: active ? "active" : "inactive" }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={template ? `Edit ${template.name}` : "Add SMS template"} size="lg">
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="DLT template ID" value={dltTemplateId} onChange={setDltTemplateId} />
          <Select label="Category" selectedKey={category} onSelectionChange={(value) => setCategory(String(value) as SmsTemplate["category"])}
            options={[{ value: "service", label: "Service (implicit)" }, { value: "transactional", label: "Transactional" }, { value: "promotional", label: "Promotional (needs consent)" }]} />
        </div>
        <TextArea label="Template text" value={body} onChange={setBody} description="Exactly as approved, such as: Dear {#var#}, your quotation {#var#} is ready. - ACME" />
        <Checkbox isSelected={active} onChange={setActive}>Active</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
