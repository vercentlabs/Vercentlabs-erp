"use client";

// CRM › Setup › Calls and SMS (CRM plan 4.4): Exotel for click-to-call (the salesperson's phone rings first, then the customer, through
// your ExoPhone; Exotel's callback logs the call on the record), and Exotel or MSG91 for SMS with your DLT registration — the sender ID
// (header), your principal entity ID, and each template exactly as approved on DLT with its template ID. Each connection can be checked:
// Exotel is asked for the account, and a test SMS goes to a number. Everyone sets the mobile their own calls ring.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareText, Pencil, Phone, Plus, Power, Send, XCircle } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PasswordField, PermissionState, Radio, RadioGroup, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import {
  checkTelephony, errorMessage, getChannelSettings, listSmsTemplates, saveChannelSettings, saveSmsTemplate, sendTestSms, setMyCallPhone, type ChannelSettings, type SmsTemplate,
} from "@/features/crm/shared/channels-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const REGIONS = [{ value: "api.exotel.com", label: "Singapore (api.exotel.com)" }, { value: "api.in.exotel.com", label: "Mumbai (api.in.exotel.com)" }];
const CATEGORY_LABEL: Record<SmsTemplate["category"], string> = { service: "Service", transactional: "Transactional", promotional: "Promotional" };
// Keeps the browser's saved sign-in out of fields that hold a provider's keys.
const noAutofill = { autoComplete: "off" } as const;

function Status({ connected, label }: { connected: boolean; label: string }) {
  return connected
    ? <StatusBadge tone="success">{label}</StatusBadge>
    : <StatusBadge tone="neutral">Not connected</StatusBadge>;
}

export function CallsSmsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "channel-settings"), queryFn: getChannelSettings });
  const [keys, setKeys] = useState<{ call: string | null; sms: string | null }>({ call: null, sms: null });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (query.isLoading) return <LoadingState label="Loading calls and SMS" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load calls and SMS" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const settings = query.data;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Calls and SMS" description="Call and text customers from their page; every call and SMS is logged on the record." />
      {(keys.call || keys.sms) && (
        <Notice tone="warning">
          <span className="flex flex-col gap-1">
            <span>Callback addresses: CRM gives them to the provider with each call and SMS. Keep them for your records; they are not shown again.</span>
            {keys.call && <code className="break-all text-xs">Calls: {origin}/api/crm/channels/hooks/{keys.call}</code>}
            {keys.sms && <code className="break-all text-xs">SMS delivery reports: {origin}/api/crm/channels/hooks/{keys.sms}</code>}
          </span>
        </Notice>
      )}
      <MyPhoneCard phone={settings.myCallPhone} calling={settings.telephony.provider === "exotel"} onSaved={() => void query.refetch()} />
      {canManage ? (
        <>
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <TelephonyCard key={`t${query.dataUpdatedAt}`} settings={settings} onSaved={(key) => { if (key) setKeys((current) => ({ ...current, call: key })); void query.refetch(); }} />
            <SmsCard key={`s${query.dataUpdatedAt}`} settings={settings} onSaved={(key) => { if (key) setKeys((current) => ({ ...current, sms: key })); void query.refetch(); }} />
          </div>
          <SmsTemplates connected={settings.sms.provider !== "none"} myPhone={settings.myCallPhone} />
        </>
      ) : (
        <Notice tone="info">{`Calling is ${settings.telephony.provider === "exotel" ? "connected (Exotel)" : "not connected"}; SMS is ${settings.sms.provider === "none" ? "not connected" : `connected (${settings.sms.provider === "msg91" ? "MSG91" : "Exotel"})`}. A CRM administrator sets these up.`}</Notice>
      )}
    </div>
  );
}

// Everyone: the mobile their own calls ring (and reminders reach).
function MyPhoneCard({ phone, calling, onSaved }: { phone: string | null; calling: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(phone ?? "");
  const [saved, setSaved] = useState(false);
  const save = useMutation({ mutationFn: () => setMyCallPhone(value.trim() || null), onSuccess: () => { setSaved(true); onSaved(); } });
  const changed = value.trim() !== (phone ?? "");
  return (
    <Panel title="My mobile for calls" description={calling ? "When you press Call on a record, this phone rings first, then the customer." : "Used when calling is connected, and for your reminders on WhatsApp or SMS."}>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); if (changed) save.mutate(); }}>
        <TextField label="Mobile" type="tel" className="sm:max-w-xs sm:flex-1" value={value} onChange={(next) => { setValue(next); setSaved(false); }} placeholder="+91 98765 43210"
          errorMessage={save.isError ? errorMessage(save.error) : undefined} isInvalid={save.isError} />
        <Button type="submit" variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!changed || save.isPending}>Save</Button>
        {saved && !changed && <span className="text-sm text-text-secondary sm:pb-2">Saved.</span>}
      </form>
    </Panel>
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
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveChannelSettings({ telephony: { provider, accountSid, apiHost, callerId, recordCalls, apiKey, apiToken } }),
    onSuccess: (result) => { setDone(provider === "exotel" ? "Saved. Check the connection to be sure Exotel accepts it." : "Saved: calling is off."); onSaved(result.callWebhookKey); },
  });
  const check = useMutation({ mutationFn: checkTelephony });
  const kept = (key: string) => (current.credentialsSet.includes(key) ? "Saved and hidden. Enter a new one only to replace it." : undefined);
  const connected = current.provider === "exotel";
  return (
    <Panel title="Click-to-call" description="Exotel rings your mobile, then connects the customer from your ExoPhone."
      actions={<Status connected={connected} label="Exotel" />}>
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        {done && !save.isPending && !save.isError && <Notice tone="success">{done}</Notice>}
        <RadioGroup label="Calling" value={provider} onChange={(value) => { setProvider(value as typeof provider); setDone(null); }}>
          <Radio value="none">Not connected: salespeople ring from their own phone and log the call</Radio>
          <Radio value="exotel">Exotel</Radio>
        </RadioGroup>
        {provider === "exotel" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Account SID" isRequired value={accountSid} onChange={setAccountSid} {...noAutofill} />
            <Select label="Region" selectedKey={apiHost} onSelectionChange={(value) => setApiHost(String(value))} options={REGIONS} />
            <TextField label="ExoPhone (caller ID)" isRequired type="tel" value={callerId} onChange={setCallerId} description="The virtual number customers see." {...noAutofill} />
            <div className="flex items-end pb-2"><Checkbox isSelected={recordCalls} onChange={setRecordCalls}>Record calls</Checkbox></div>
            <PasswordField label="API key" value={apiKey} onChange={setApiKey} autoComplete="new-password" description={kept("apiKey")} />
            <PasswordField label="API token" value={apiToken} onChange={setApiToken} autoComplete="new-password" description={kept("apiToken")} />
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button>
          {connected && provider === "exotel" && (
            <Button variant="secondary" className="w-full sm:w-auto" isLoading={check.isPending} onPress={() => check.mutate()}><Phone className="size-4" aria-hidden="true" />Check connection</Button>
          )}
        </div>
        {check.isError && <Notice>{errorMessage(check.error)}</Notice>}
        {check.data && <Notice tone="success">{`Exotel answered for ${check.data.name}: calling works.`}</Notice>}
      </div>
    </Panel>
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
  const [done, setDone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveChannelSettings({ sms: { provider, senderId, dltEntityId, accountSid, apiHost, apiKey, apiToken, authKey } }),
    onSuccess: (result) => { setDone(provider === "none" ? "Saved: SMS is off." : "Saved. Send yourself a test from a template below."); onSaved(result.smsWebhookKey); },
  });
  const kept = (key: string) => (current.credentialsSet.includes(key) ? "Saved and hidden. Enter a new one only to replace it." : undefined);
  const connected = current.provider !== "none";
  return (
    <Panel title="SMS" description="Sent only from templates approved on DLT, as TRAI requires."
      actions={<Status connected={connected} label={current.provider === "msg91" ? "MSG91" : "Exotel"} />}>
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        {done && !save.isPending && !save.isError && <Notice tone="success">{done}</Notice>}
        <RadioGroup label="Provider" value={provider} onChange={(value) => { setProvider(value as typeof provider); setDone(null); }}>
          <Radio value="none">Not connected</Radio>
          <Radio value="exotel">Exotel</Radio>
          <Radio value="msg91">MSG91</Radio>
        </RadioGroup>
        {provider !== "none" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Sender ID (DLT header)" isRequired value={senderId} onChange={(value) => setSenderId(value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              description="3 to 11 letters or digits, such as ACMEIN." {...noAutofill} />
            <TextField label="DLT principal entity ID" isRequired inputMode="numeric" value={dltEntityId} onChange={(value) => setDltEntityId(value.replace(/\D/g, ""))} {...noAutofill} />
            {provider === "exotel" ? (
              <>
                <TextField label="Account SID" isRequired value={accountSid} onChange={setAccountSid} {...noAutofill} />
                <Select label="Region" selectedKey={apiHost} onSelectionChange={(value) => setApiHost(String(value))} options={REGIONS} />
                <PasswordField label="API key" value={apiKey} onChange={setApiKey} autoComplete="new-password" description={kept("apiKey")} />
                <PasswordField label="API token" value={apiToken} onChange={setApiToken} autoComplete="new-password" description={kept("apiToken")} />
              </>
            ) : (
              <PasswordField label="Auth key" value={authKey} onChange={setAuthKey} autoComplete="new-password" description={kept("authKey")} />
            )}
          </div>
        )}
        <div><Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </div>
    </Panel>
  );
}

function SmsTemplates({ connected, myPhone }: { connected: boolean; myPhone: string | null }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "sms-templates", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listSmsTemplates(true) });
  const [editing, setEditing] = useState<SmsTemplate | "new" | null>(null);
  const [testing, setTesting] = useState<SmsTemplate | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sms-templates") });
  const toggle = useMutation({
    mutationFn: (row: SmsTemplate) => saveSmsTemplate(row.id, { name: row.name, dltTemplateId: row.dltTemplateId, category: row.category, body: row.body, status: row.status === "active" ? "inactive" : "active" }),
    onSuccess: refresh,
  });
  const rows = query.data ?? [];
  return (
    <Panel title="SMS templates (DLT)" description="Each template exactly as approved on your DLT portal, with {#var#} where values go."
      actions={<Button variant="secondary" size="compact" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />Add template</Button>}>
      <div className="flex flex-col gap-3">
        {toggle.isError && <Notice>{errorMessage(toggle.error)}</Notice>}
        {query.isLoading ? <LoadingState label="Loading templates" rows={2} /> : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">No templates yet. Add the ones approved for you on DLT: a service template is needed for SMS reminders.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((row) => (
              <li key={row.id} className={`flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3 ${row.status === "active" ? "" : "opacity-75"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-xs text-text-muted">{`DLT ${row.dltTemplateId}`}</span>
                  </span>
                  <StatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Off"}</StatusBadge>
                </div>
                <p className="break-words rounded-[var(--radius-control)] bg-surface-muted p-2 font-mono text-xs">{row.body}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge tone={row.category === "promotional" ? "warning" : "neutral"}>{CATEGORY_LABEL[row.category]}</Badge>
                  <span className="text-text-secondary">{`${row.variables} value${row.variables === 1 ? "" : "s"}`}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 sm:flex sm:flex-wrap sm:justify-end">
                  <Button variant="secondary" size="compact" className="order-first w-full sm:order-none sm:w-auto" aria-label={`Edit ${row.name}`} onPress={() => setEditing(row)}>
                    <Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
                  <Button variant="ghost" size="compact" className="w-full sm:w-auto" aria-label={`${row.status === "active" ? "Switch off" : "Switch on"} ${row.name}`} isDisabled={toggle.isPending}
                    onPress={() => toggle.mutate(row)}><Power className="size-3.5" aria-hidden="true" />{row.status === "active" ? "Switch off" : "Switch on"}</Button>
                  {connected && row.status === "active" && row.category !== "promotional" && (
                    <Button variant="ghost" size="compact" className="col-span-2 w-full sm:w-auto" aria-label={`Send a test of ${row.name}`} onPress={() => setTesting(row)}>
                      <Send className="size-3.5" aria-hidden="true" />Send a test</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {testing && <TestSmsDialog template={testing} myPhone={myPhone} onClose={() => setTesting(null)} />}
    </Panel>
  );
}

function TestSmsDialog({ template, myPhone, onClose }: { template: SmsTemplate; myPhone: string | null; onClose: () => void }) {
  const [phone, setPhone] = useState(myPhone ?? "");
  const send = useMutation({ mutationFn: () => sendTestSms(template.id, phone.trim()) });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Test · ${template.name}`} description="Each value is filled with Test. It counts towards your SMS for the month.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (phone.trim()) send.mutate(); }}>
        <TextField label="Send to" type="tel" value={phone} onChange={(value) => { setPhone(value); send.reset(); }} placeholder="+91 98765 43210" />
        <p className="break-words rounded-[var(--radius-control)] bg-surface-muted p-2 font-mono text-xs">{template.body.replace(/\{#var#\}/gi, "Test")}</p>
        {send.isError && <Notice>{errorMessage(send.error)}</Notice>}
        {send.data && (send.data.sent
          ? <Notice tone="success"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" aria-hidden="true" />The provider accepted it: check the phone.</span></Notice>
          : <Notice><span className="inline-flex items-center gap-2"><XCircle className="size-4" aria-hidden="true" />{`Not sent: ${send.data.error ?? "the provider refused it"}.`}</span></Notice>)}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button type="submit" variant="primary" isLoading={send.isPending} isDisabled={!phone.trim() || send.isPending}><MessageSquareText className="size-4" aria-hidden="true" />Send test</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TemplateDialog({ template, onClose, onSaved }: { template: SmsTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [dltTemplateId, setDltTemplateId] = useState(template?.dltTemplateId ?? "");
  const [category, setCategory] = useState<SmsTemplate["category"]>(template?.category ?? "service");
  const [body, setBody] = useState(template?.body ?? "");
  const [active, setActive] = useState((template?.status ?? "active") === "active");
  const save = useMutation({ mutationFn: () => saveSmsTemplate(template?.id ?? null, { name, dltTemplateId, category, body, status: active ? "active" : "inactive" }), onSuccess: onSaved });
  const values = (body.match(/\{#var#\}/gi) ?? []).length;
  const idWrong = Boolean(dltTemplateId) && !/^[0-9]{10,25}$/.test(dltTemplateId);
  const ready = Boolean(name.trim() && body.trim()) && /^[0-9]{10,25}$/.test(dltTemplateId);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={template ? `Edit ${template.name}` : "Add SMS template"} size="lg">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="Name" isRequired value={name} onChange={setName} description="For your team." />
          <TextField label="DLT template ID" isRequired inputMode="numeric" value={dltTemplateId} onChange={(value) => setDltTemplateId(value.replace(/\s/g, ""))}
            isInvalid={idWrong} errorMessage={idWrong ? "Digits only, from your DLT portal." : undefined} />
          <Select label="Category" selectedKey={category} onSelectionChange={(value) => setCategory(String(value) as SmsTemplate["category"])}
            options={[{ value: "service", label: "Service (implicit)" }, { value: "transactional", label: "Transactional" }, { value: "promotional", label: "Promotional (needs consent)" }]} />
        </div>
        <TextArea label="Template text" isRequired value={body} onChange={setBody} rows={4}
          description="Exactly as approved, such as: Dear {#var#}, your quotation {#var#} is ready. - ACME" />
        <p className="text-xs text-text-secondary">{`${values} value${values === 1 ? "" : "s"} to fill when sending. ${body.length} characters.`}</p>
        <Checkbox isSelected={active} onChange={setActive}>Active (offered when sending SMS)</Checkbox>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
