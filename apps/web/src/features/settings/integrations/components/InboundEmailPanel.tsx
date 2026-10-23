"use client";

// Settings › Integrations › Inbound email: addresses that turn customer emails into Support tickets or CRM leads. Each address is a
// webhook URL with its own signing secret (shown once; "New keys" replaces both). "Send test email" sends a signed sample through the
// real path; "How to connect a mailbox" gives a ready Cloudflare Email Routing worker that forwards a real address here.
// Desktop: the addresses and the recent messages on the left, the mailbox guide on the right. Tablet and phone: one column; each
// address's actions wrap under it, full width on a phone.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EmptyState, ErrorState, Radio, RadioGroup, StatusBadge, TextField } from "@vercentlabs/design-system";
import { useState } from "react";

import { displayTimeZone } from "@/shared/format/display-time-zone";
import { requestJson } from "@/shared/http/request-json";

import { SecretRevealDialog, type RevealedSecret } from "./SecretRevealDialog";

type Route = {
  id: string;
  name: string;
  target: string;
  targetLabel: string;
  routeKeyPrefix: string;
  status: "active" | "disabled";
  lastReceivedAt: string | null;
  receivedCount: number;
};
type InboundEvent = {
  id: string;
  routeId: string | null;
  subject: string | null;
  status: string;
  outcome: string | null;
  error: string | null;
  ticketId: string | null;
  recordType?: "lead" | "opportunity" | "party" | "contact" | null;
  recordId?: string | null;
  receivedAt: string;
};
type Payload = { routes: Route[]; events: InboundEvent[]; targets: Array<{ key: string; label: string }> };
type TestResult = { outcome?: string; ticketId?: string | null; recordType?: string | null; recordId?: string | null };

const QUERY_KEY = ["settings", "integrations", "inbound-mail"];
// In the workspace's time zone, not the browser's.
const when = (at: string) => new Date(at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: displayTimeZone() });
const RECORD_HREF: Record<string, string> = { lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" };
const OUTCOME: Record<string, string> = {
  new_ticket: "New ticket",
  new_ticket_after_closed: "New ticket (earlier one was closed)",
  reply: "Added to its ticket",
  duplicate: "Duplicate ignored",
  crm_new_lead: "New lead",
  crm_reply: "Reply added to its record",
  crm_reference: "Added to the record named in the subject",
  crm_sender: "Added to the sender's lead",
};
// What each kind of address does, in a sentence, and the name it starts with.
const TARGET_HELP: Record<string, { title: string; text: string; name: string }> = {
  "support.email_to_ticket": { title: "Support tickets", text: "A new email opens a ticket; replies join the same ticket.", name: "Support inbox" },
  "crm.email_to_lead": { title: "CRM leads", text: "A new email opens a lead; replies join their lead or deal.", name: "Sales enquiries" },
};

function recordLink(item: { ticketId?: string | null; recordType?: string | null; recordId?: string | null }) {
  if (item.ticketId) return { href: `/support/tickets/${item.ticketId}`, label: "Open the ticket" };
  if (item.recordType && item.recordId && RECORD_HREF[item.recordType]) return { href: `${RECORD_HREF[item.recordType]}${item.recordId}`, label: `Open the ${item.recordType === "party" ? "company" : item.recordType}` };
  return null;
}

export function InboundEmailPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => requestJson<Payload>("/api/settings/integrations/inbound-mail") });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [tested, setTested] = useState<{ routeId: string; result: TestResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (failure: unknown, fallback: string) => setError(failure instanceof Error ? failure.message : fallback);
  const reveal = (name: string, webhookUrl: string, signingSecret: string, title: string) => setSecret({
    title,
    description: `Give these to your mailbox bridge for "${name}" (see How to connect a mailbox).`,
    items: [{ label: "Webhook URL", value: webhookUrl }, { label: "Signing secret", value: signingSecret }],
  });
  const toggle = useMutation({
    mutationFn: (route: Route) => requestJson(`/api/settings/integrations/inbound-mail/${route.id}/status`, { method: "POST", json: { status: route.status === "active" ? "disabled" : "active" } }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: (failure) => fail(failure, "The address could not be changed."),
  });
  const test = useMutation({
    mutationFn: (route: Route) => requestJson<{ result: TestResult }>(`/api/settings/integrations/inbound-mail/${route.id}/test`, { method: "POST" }).then((response) => response.result),
    onSuccess: (result, route) => { setError(null); setTested({ routeId: route.id, result }); void refresh(); },
    onError: (failure) => fail(failure, "The test email could not be sent."),
  });
  const rotate = useMutation({
    mutationFn: (route: Route) => requestJson<{ webhookUrl: string; signingSecret: string }>(`/api/settings/integrations/inbound-mail/${route.id}/keys`, { method: "POST" }),
    onSuccess: (result, route) => { setError(null); reveal(route.name, result.webhookUrl, result.signingSecret, "New keys issued"); void refresh(); },
    onError: (failure) => fail(failure, "New keys could not be issued."),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError)
    return <ErrorState title="Could not load inbound email" description={(query.error as Error).message} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const { routes, events, targets } = query.data!;
  const routeName = new Map(routes.map((route) => [route.id, route.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-text-secondary">
          Turn emails your customers send into Support tickets or CRM leads. Each address you create here is a secure link your mailbox
          forwards new email to.
        </p>
        {canManage && <Button variant="primary" className="w-full sm:w-auto" onPress={() => setCreating(true)}>New inbound address</Button>}
      </div>
      {error && <p role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-text">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {routes.length === 0 ? (
            <EmptyState title="No inbound addresses" description="Create one to turn customer emails into Support tickets or CRM leads." />
          ) : (
            <ul className="flex flex-col gap-3">
              {routes.map((route) => {
                const result = tested?.routeId === route.id ? tested.result : null;
                const link = result ? recordLink(result) : null;
                return (
                  <li key={route.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="font-medium text-text">{route.name}</h3>
                        <p className="text-sm text-text-secondary">{TARGET_HELP[route.target]?.text ?? route.targetLabel}</p>
                        <p className="text-xs text-text-muted">
                          {route.lastReceivedAt ? `${route.receivedCount} received · last ${when(route.lastReceivedAt)}` : "Nothing received yet"}
                          <span className="font-mono">{` · key ${route.routeKeyPrefix}…`}</span>
                        </p>
                      </div>
                      <StatusBadge tone={route.status === "active" ? "success" : "neutral"}>{route.status === "active" ? "Active" : "Disabled"}</StatusBadge>
                    </div>
                    {result && (
                      <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-[var(--radius-control)] border border-success/40 bg-success-soft px-3 py-2 text-sm text-text">
                        {`Test email received: ${OUTCOME[result.outcome ?? ""] ?? "processed"}.`}
                        {link && <Link className="font-medium text-brand hover:underline" href={link.href}>{link.label}</Link>}
                      </p>
                    )}
                    {canManage && (
                      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-center">
                        {route.status === "active" && (
                          <Button variant="secondary" size="compact" className="w-full sm:w-auto" isLoading={test.isPending && test.variables?.id === route.id}
                            onPress={() => test.mutate(route)}>Send test email</Button>
                        )}
                        <Button variant="secondary" size="compact" className="w-full sm:w-auto" isLoading={rotate.isPending && rotate.variables?.id === route.id}
                          onPress={() => rotate.mutate(route)}>New keys</Button>
                        <Button variant="ghost" size="compact" className="w-full sm:ml-auto sm:w-auto" isLoading={toggle.isPending && toggle.variables?.id === route.id}
                          onPress={() => toggle.mutate(route)}>{route.status === "active" ? "Disable" : "Enable"}</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <section aria-labelledby="inbound-recent" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <h3 id="inbound-recent" className="border-b border-border px-4 py-3 text-sm font-semibold text-text">Recent messages</h3>
            {events.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">No messages received yet. Use Send test email to try an address.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {events.map((event) => {
                  const link = recordLink(event);
                  const failed = event.status === "failed";
                  return (
                    <li key={event.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-text">{event.subject ?? "(no subject)"}</span>
                        <span className="text-xs text-text-muted">{[event.routeId ? routeName.get(event.routeId) : null, when(event.receivedAt)].filter(Boolean).join(" · ")}</span>
                        {event.error && <span className="text-xs text-danger">{event.error}</span>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm sm:justify-end">
                        <StatusBadge tone={failed ? "danger" : event.outcome ? "success" : "neutral"}>
                          {event.outcome ? OUTCOME[event.outcome] ?? event.outcome : failed ? "Failed" : "Processing"}
                        </StatusBadge>
                        {link && <Link className="text-xs font-medium text-brand hover:underline" href={link.href}>{link.label}</Link>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <MailboxGuide />
      </div>

      {creating && (
        <CreateRouteDialog
          targets={targets}
          onClose={() => setCreating(false)}
          onCreated={(name, webhookUrl, signingSecret) => { setCreating(false); reveal(name, webhookUrl, signingSecret, "Inbound address created"); void refresh(); }}
        />
      )}
      {secret && <SecretRevealDialog secret={secret} onDone={() => setSecret(null)} />}
    </div>
  );
}

// A free Cloudflare Email Routing worker: it receives mail for a real address (support@yourdomain.com), turns it into the message this
// app reads, signs it with the address's secret and posts it to the webhook URL. Any provider can do the same with its own adapter.
const WORKER = `import PostalMime from "postal-mime";

const toBase64 = (buffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export default {
  async email(message, env) {
    const mail = await PostalMime.parse(message.raw);
    const body = JSON.stringify({
      provider: "cloudflare",
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: (mail.references || "").split(/\\s+/).filter(Boolean),
      from: { email: mail.from?.address || message.from, name: mail.from?.name },
      to: (mail.to || []).map((to) => to.address),
      subject: mail.subject,
      text: mail.text || "",
      headers: { "auto-submitted": message.headers.get("auto-submitted") || "", precedence: message.headers.get("precedence") || "" },
      attachments: (mail.attachments || []).map((file) => ({ fileName: file.filename, contentType: file.mimeType, contentBase64: toBase64(file.content) })),
    });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    const signature = "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
    const response = await fetch(env.WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", "x-inbound-signature": signature }, body });
    if (!response.ok) message.setReject("Not accepted by the ERP (" + response.status + ")");
  },
};`;

function MailboxGuide() {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="inbound-guide" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h3 id="inbound-guide" className="text-sm font-semibold text-text">How to connect a mailbox</h3>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-text-secondary">
        <li>Create an inbound address here and copy its webhook URL and signing secret.</li>
        <li>In Cloudflare (free), turn on Email Routing for your domain and create an Email Worker with the code below.</li>
        <li>In the worker&apos;s settings, add <code className="font-mono text-xs">WEBHOOK_URL</code> and <code className="font-mono text-xs">SIGNING_SECRET</code> with the two values.</li>
        <li>Route your address (for example support@yourdomain.com) to the worker, then send it an email.</li>
      </ol>
      <details className="rounded-[var(--radius-control)] border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">Email Worker code</summary>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <pre className="max-h-72 overflow-auto rounded-[var(--radius-control)] bg-surface-muted p-3 font-mono text-[11px] leading-relaxed text-text">{WORKER}</pre>
          <Button variant="secondary" size="compact" className="w-full sm:w-auto"
            onPress={() => { void navigator.clipboard.writeText(WORKER).then(() => setCopied(true)).catch(() => setCopied(false)); }}>
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>
      </details>
      <p className="border-t border-border pt-3 text-xs text-text-muted">
        The webhook must be reachable from the internet (your live address, not localhost). Other providers work too: each request needs the
        JSON above and an <code className="font-mono">X-Inbound-Signature</code> header (sha256= HMAC of the raw body with the signing secret).
      </p>
    </section>
  );
}

function CreateRouteDialog({ targets, onClose, onCreated }: {
  targets: Payload["targets"];
  onClose: () => void;
  onCreated: (name: string, webhookUrl: string, signingSecret: string) => void;
}) {
  const [target, setTarget] = useState(targets[0]?.key ?? "");
  // The name follows the kind chosen until it is typed.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? TARGET_HELP[target]?.name ?? "Inbound address";
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => requestJson<{ webhookUrl: string; signingSecret: string }>("/api/settings/integrations/inbound-mail", { method: "POST", json: { name: name.trim(), target } }),
    onSuccess: (result) => onCreated(name.trim(), result.webhookUrl, result.signingSecret),
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The address could not be created."),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New inbound address">
      <div className="flex flex-col gap-4">
        <RadioGroup label="What should incoming email do?" value={target} onChange={setTarget}>
          {targets.map((option) => (
            <Radio key={option.key} value={option.key}>
              <span className="flex flex-col">
                <span className="font-medium text-text">{TARGET_HELP[option.key]?.title ?? option.label}</span>
                <span className="text-xs text-text-secondary">{TARGET_HELP[option.key]?.text ?? option.label}</span>
              </span>
            </Radio>
          ))}
        </RadioGroup>
        <TextField label="Name" description="Shown on this page and on each message received." value={name} onChange={setTypedName} isRequired />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" isDisabled={!name.trim() || !target} isLoading={create.isPending} onPress={() => create.mutate()}>Create address</Button>
        </div>
      </div>
    </Dialog>
  );
}
