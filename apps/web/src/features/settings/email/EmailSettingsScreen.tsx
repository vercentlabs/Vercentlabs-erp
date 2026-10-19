"use client";

// Settings › Email (Shared Platform plan 4): how the company's invoices, quotations and other mail are sent — the platform's server,
// the company's own domain (DKIM record to publish), or the company's own SMTP server — and the delivery log.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PasswordField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

type Settings = {
  mode: "platform" | "domain" | "smtp"; fromName: string | null; fromAddress: string | null; replyTo: string | null; domain: string | null; domainVerifiedAt: string | null;
  dnsRecords: Array<{ type: string; host: string; value: string; note?: string }>; smtp: { host: string; port: number; secure: boolean; username: string; verifiedAt: string | null } | null;
  lastError: string | null; active: boolean;
};
type LogEntry = { id: string; kind: string; recipients: string[]; subject: string | null; status: string; via: string | null; attempts: number; error: string | null; createdAt: string };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const KEY = ["settings", "email"];
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { sent: "success", queued: "info", sending: "info", failed: "danger", bounced: "danger", not_configured: "warning" };

export function EmailSettingsScreen() {
  const query = useQuery({ queryKey: KEY, queryFn: () => call<{ settings: Settings; log: LogEntry[] }>("/api/settings/email") });
  if (query.isLoading) return <LoadingState label="Loading email settings" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load email settings" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <EmailForms settings={query.data.settings} log={query.data.log} />;
}

function EmailForms({ settings, log }: { settings: Settings; log: LogEntry[] }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const [form, setForm] = useState({ mode: settings.mode, fromName: settings.fromName ?? "", fromAddress: settings.fromAddress ?? "", replyTo: settings.replyTo ?? "" });
  const [domain, setDomain] = useState(settings.domain ?? "");
  const [smtp, setSmtp] = useState({ host: settings.smtp?.host ?? "", port: String(settings.smtp?.port ?? 587), username: settings.smtp?.username ?? "", password: "" });
  const save = useMutation({ mutationFn: () => call("/api/settings/email", { method: "PUT", body: JSON.stringify(form) }), onSuccess: refresh });
  const setup = useMutation({ mutationFn: () => call("/api/settings/email/domain", { method: "POST", body: JSON.stringify({ domain }) }), onSuccess: refresh });
  const verify = useMutation({ mutationFn: () => call<{ verified: boolean; problems: string[] }>("/api/settings/email/domain", { method: "PUT" }), onSuccess: refresh });
  const test = useMutation({
    mutationFn: () => call<{ verified: boolean; error: string | null }>("/api/settings/email/smtp", { method: "POST", body: JSON.stringify({ host: smtp.host, port: Number(smtp.port), username: smtp.username, password: smtp.password || undefined }) }),
    onSuccess: refresh,
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const error = (save.error ?? setup.error ?? verify.error ?? test.error) as Error | null;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Email" description="How your invoices, quotations, orders and other mail reach customers and suppliers." />
      {error && <Notice>{error.message}</Notice>}
      <Panel title="Sender" description={settings.active ? "In use now." : "Not in use yet: mail goes from the platform until the setup below is verified."}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Send email" selectedKey={form.mode} onSelectionChange={(key) => set("mode")(String(key))}
            options={[{ value: "platform", label: "From Vercentlabs (\"Your company via Vercentlabs\")" }, { value: "domain", label: "From our own domain (DNS records)" }, { value: "smtp", label: "Through our own mail server (SMTP)" }]} />
          <TextField label="Sender name" description="Your company's name, usually." value={form.fromName} onChange={set("fromName")} />
          {form.mode !== "platform" && <TextField label="From address" description="Like accounts@yourcompany.in." value={form.fromAddress} onChange={set("fromAddress")} />}
          <TextField label="Replies go to" value={form.replyTo} onChange={set("replyTo")} />
        </div>
        <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </Panel>
      {form.mode === "domain" && (
        <Panel title="Your domain" description="Publish these records at your domain's DNS provider, then check. Until then mail goes from the platform.">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64"><TextField label="Domain" value={domain} onChange={setDomain} /></div>
            <Button variant="secondary" isLoading={setup.isPending} onPress={() => setup.mutate()}>{settings.domain ? "Make new records" : "Make records"}</Button>
            {settings.domain && <Button variant="primary" isLoading={verify.isPending} onPress={() => verify.mutate()}>Check DNS</Button>}
            {settings.domainVerifiedAt ? <StatusBadge tone="success">Verified</StatusBadge> : settings.domain ? <StatusBadge tone="warning">Not verified</StatusBadge> : null}
          </div>
          {verify.data && !verify.data.verified && <Notice tone="warning">{verify.data.problems.join(" ")}</Notice>}
          {settings.dnsRecords.map((record) => (
            <div key={record.host} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border p-2 text-xs">
              <span><span className="font-medium">{record.type}</span> record · host <code>{record.host}</code></span>
              <code className="break-all rounded bg-surface-muted p-1">{record.value}</code>
              {record.note && <span className="text-text-muted">{record.note}</span>}
            </div>
          ))}
        </Panel>
      )}
      {form.mode === "smtp" && (
        <Panel title="Your mail server" description="Google Workspace: smtp.gmail.com, 587, with an app password. Microsoft 365: smtp.office365.com, 587. A test message is sent to you first.">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Server" value={smtp.host} onChange={(value) => setSmtp((current) => ({ ...current, host: value }))} />
            <TextField label="Port" inputMode="numeric" value={smtp.port} onChange={(value) => setSmtp((current) => ({ ...current, port: value }))} />
            <TextField label="Username" value={smtp.username} onChange={(value) => setSmtp((current) => ({ ...current, username: value }))} />
            <PasswordField label={settings.smtp ? "Password (leave empty to keep)" : "Password"} value={smtp.password} onChange={(value) => setSmtp((current) => ({ ...current, password: value }))} />
          </div>
          {test.data && <Notice tone={test.data.verified ? "success" : "danger"}>{test.data.verified ? "The test message was sent; your server is in use." : test.data.error}</Notice>}
          <div className="flex justify-end"><Button variant="primary" isLoading={test.isPending} onPress={() => test.mutate()}>Save and send a test</Button></div>
        </Panel>
      )}
      <Panel title="Delivery log" description="The last 100 emails: business mail and the security mail (sign-in links, invitations) sent for your company.">
        {log.length === 0 ? <p className="text-sm text-text-muted">Nothing sent yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="font-medium">{entry.subject || "(no subject)"}</span>
                  <span className="text-text-muted">{` · to ${entry.recipients.join(", ")}`}</span>
                  {entry.error && <span className="block text-xs text-danger">{entry.error}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {new Date(entry.createdAt).toLocaleString("en-IN")}
                  <StatusBadge tone={TONE[entry.status] ?? "neutral"}>{entry.status.replace("_", " ")}</StatusBadge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
