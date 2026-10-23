"use client";

// CRM › Setup › Website chat (CRM plan 5.8): the chat boxes for your websites — the greeting, the websites allowed to show it, who answers
// new chats, and the one line of code that puts it on a page.
// Desktop: the chats on the left, how it works on the right. Tablet and phone: one column, the chats first; each chat's actions wrap
// under it, full width on a phone, and the embed code wraps instead of scrolling sideways.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class ChannelError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ChannelError, "body");
type Channel = { id: string; name: string; publicKey: string; welcomeMessage: string; allowedOrigins: string[]; ownerUserId: string | null; isActive: boolean; openChats: number };

export const listChatChannels = () => request<{ channels: Channel[] }>("/api/crm/chat-channels").then((result) => result.channels);

export function ChatChannelsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "chat-channels");
  const query = useQuery({ queryKey: key, queryFn: listChatChannels, enabled: canManage });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions, enabled: canManage });
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const toggle = useMutation({ mutationFn: (channel: Channel) => request(`/api/crm/chat-channels/${channel.id}`, { method: "PATCH", json: { isActive: !channel.isActive } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  if (!canManage) return <PermissionState title="You can't manage website chat" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (query.isError) return <ErrorState title="Could not load website chat" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const userName = new Map((options.data?.options.users ?? []).map((user) => [String(user.id), String(user.name ?? "")]));
  const channels = query.data ?? [];
  const create = <Button variant="primary" className="w-full sm:w-auto" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New chat</Button>;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Website chat" description="A chat box on your website. Each conversation opens a lead (or joins the visitor's) and is answered from CRM › Website chat."
        primaryAction={channels.length ? create : undefined} />
      {toggle.isError && <Notice>{toggle.error instanceof Error ? toggle.error.message : "It could not be changed."}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          {channels.length === 0 ? (
            <section className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-6">
              <h2 className="text-base font-semibold text-text">No website chat yet</h2>
              <p className="text-sm text-text-secondary">Create one, then paste one line of code on your website. Visitors chat with your team; every chat becomes a lead.</p>
              {create}
            </section>
          ) : channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} ownerName={channel.ownerUserId ? userName.get(channel.ownerUserId) ?? null : null}
              onEdit={() => setEditing(channel)} onToggle={() => toggle.mutate(channel)} toggling={toggle.isPending && toggle.variables?.id === channel.id} />
          ))}
        </div>

        <section aria-labelledby="chat-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="chat-how" className="text-sm font-semibold text-text">How it works</h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>Paste the line of code on your website. A Chat button appears in the bottom corner.</li>
            <li>A visitor gives their name and email or mobile, and writes.</li>
            <li>The chat opens a lead (or joins their open lead), and whoever answers it is notified.</li>
            <li>Reply from CRM › Website chat. Closing a chat saves the conversation on the lead.</li>
          </ol>
          <p className="border-t border-border pt-3 text-xs text-text-muted">List your website under &ldquo;Websites that may show it&rdquo; so the chat works only there.</p>
        </section>
      </div>
      {editing && <ChannelDialog channel={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />}
    </div>
  );
}

function ChannelCard({ channel, ownerName, onEdit, onToggle, toggling }: { channel: Channel; ownerName: string | null; onEdit: () => void; onToggle: () => void; toggling: boolean }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = `<script src="${origin}/api/crm/public/chat/${channel.publicKey}/widget.js" async></script>`;
  const copy = () => { void navigator.clipboard.writeText(snippet).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }).catch(() => setCopied(false)); };
  return (
    <section aria-label={channel.name} className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-base font-semibold text-text">{channel.name}</h2>
          <p className="text-sm text-text-secondary">
            {channel.openChats ? <Link className="font-medium text-brand hover:underline" href="/crm/chat">{`${channel.openChats} open chat${channel.openChats === 1 ? "" : "s"}`}</Link> : "No open chats"}
            {` · answered by ${ownerName ?? "the lead's owner"}`}
          </p>
        </div>
        <StatusBadge tone={channel.isActive ? "success" : "neutral"}>{channel.isActive ? "Live" : "Off"}</StatusBadge>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">Greeting</dt>
          <dd className="text-text">{channel.welcomeMessage}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">Shown on</dt>
          <dd className="break-words text-text">{channel.allowedOrigins.length ? channel.allowedOrigins.join(", ") : "Any website"}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-secondary">Put this line before <code className="font-mono text-xs">&lt;/body&gt;</code> on your website&apos;s pages:</p>
        <code className="block break-all rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-text">{snippet}</code>
      </div>

      {/* Phone: one full-width button per line, Copy first. Tablet and desktop: one row, Switch off at the far end. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <Button variant="primary" size="compact" className="w-full sm:w-auto" onPress={copy}>{copied ? "Copied" : "Copy code"}</Button>
        <Button variant="secondary" size="compact" className="w-full sm:w-auto" onPress={() => window.open(`/chat/${channel.publicKey}`, "_blank", "noopener")}>Preview</Button>
        <Button variant="secondary" size="compact" className="w-full sm:w-auto" onPress={onEdit}>Edit</Button>
        <Button variant="ghost" size="compact" className="w-full sm:ml-auto sm:w-auto" isLoading={toggling} onPress={onToggle}>{channel.isActive ? "Switch off" : "Switch on"}</Button>
      </div>
    </section>
  );
}

function ChannelDialog({ channel, onClose, onSaved }: { channel: Channel | null; onClose: () => void; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const users = (options.data?.options.users ?? []).map((user) => ({ value: String(user.id), label: String(user.name ?? "") }));
  const [name, setName] = useState(channel?.name ?? "Website");
  const [welcome, setWelcome] = useState(channel?.welcomeMessage ?? "Hello! How can we help you?");
  const [origins, setOrigins] = useState((channel?.allowedOrigins ?? []).join("\n"));
  const [ownerUserId, setOwnerUserId] = useState(channel?.ownerUserId ?? "");
  const save = useMutation({
    mutationFn: () => {
      const input = { name, welcomeMessage: welcome, allowedOrigins: origins.split(/[\s,]+/).filter(Boolean), ownerUserId: ownerUserId || null };
      return channel ? request(`/api/crm/chat-channels/${channel.id}`, { method: "PATCH", json: input }) : request("/api/crm/chat-channels", { method: "POST", json: input });
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={channel ? `Edit ${channel.name}` : "New website chat"}>
      <div className="flex flex-col gap-4">
        {save.isError && <Notice>{save.error instanceof Error ? save.error.message : "It could not be saved."}</Notice>}
        <TextField label="Name" description="Shown at the top of the chat box." isRequired value={name} onChange={setName} maxLength={80} />
        <TextArea label="Greeting" description="The first message a visitor sees." value={welcome} onChange={setWelcome} maxLength={500} />
        <TextArea label="Websites that may show it" description="One per line, such as https://www.yourcompany.in. Leave empty to allow any website." value={origins} onChange={setOrigins} />
        <Select label="New chats go to" description="When the lead has no owner yet." selectedKey={ownerUserId || "rules"}
          onSelectionChange={(key) => setOwnerUserId(String(key) === "rules" ? "" : String(key))} options={[{ value: "rules", label: "The lead's owner (assignment rules)" }, ...users]} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>{channel ? "Save" : "Create"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
