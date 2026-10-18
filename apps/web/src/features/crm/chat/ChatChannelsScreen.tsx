"use client";

// CRM › Setup › Website chat (CRM plan 5.8): the chat boxes for your websites — the greeting, the websites allowed to show it, who answers
// new chats, and the one line of code that puts it on a page.
import { useState } from "react";
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
  const [editing, setEditing] = useState<Channel | "new" | null>(null);
  const toggle = useMutation({ mutationFn: (channel: Channel) => request(`/api/crm/chat-channels/${channel.id}`, { method: "PATCH", json: { isActive: !channel.isActive } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  if (!canManage) return <PermissionState title="You can't manage website chat" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (query.isError) return <ErrorState title="Could not load website chat" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Website chat" description="A chat box on your website. A visitor's chat opens a lead (or joins theirs) and is answered from CRM › Website chat."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New chat</Button>} />
      {(query.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">No chat yet.</p> : (
        <ul className="flex max-w-4xl flex-col gap-3">
          {(query.data ?? []).map((channel) => (
            <li key={channel.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><span className="font-medium">{channel.name}</span>{!channel.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                  <span className="text-text-muted">{channel.openChats} open</span></div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="compact" onPress={() => setEditing(channel)}>Edit</Button>
                  <Button variant="ghost" size="compact" isDisabled={toggle.isPending} onPress={() => toggle.mutate(channel)}>{channel.isActive ? "Switch off" : "Switch on"}</Button>
                </div>
              </div>
              <span className="text-text-secondary">Put this line before &lt;/body&gt; on your website&apos;s pages:</span>
              <code className="block overflow-x-auto rounded bg-surface-muted p-2 text-xs">{`<script src="${origin}/api/crm/public/chat/${channel.publicKey}/widget.js" async></script>`}</code>
              <span className="text-xs text-text-muted">{channel.allowedOrigins.length ? `Only on ${channel.allowedOrigins.join(", ")}.` : "On any website."}</span>
            </li>
          ))}
        </ul>
      )}
      {editing && <ChannelDialog channel={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => void queryClient.invalidateQueries({ queryKey: key })} />}
    </div>
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
        <TextField label="Name" isRequired value={name} onChange={setName} maxLength={80} />
        <TextArea label="Greeting" value={welcome} onChange={setWelcome} maxLength={500} />
        <TextArea label="Websites that may show it" description="One per line, such as https://www.yourcompany.in. Empty: any." value={origins} onChange={setOrigins} />
        <Select label="New chats go to" description="When the lead has no owner yet." selectedKey={ownerUserId || "rules"}
          onSelectionChange={(key) => setOwnerUserId(String(key) === "rules" ? "" : String(key))} options={[{ value: "rules", label: "The lead's owner (assignment rules)" }, ...users]} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>{channel ? "Save" : "Create"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
