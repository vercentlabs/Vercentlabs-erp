"use client";

// CRM › Inbox (CRM audit navigation): what customers sent lately — website chats, WhatsApp messages and emails — in one list, newest
// first; each opens its lead, deal, company or contact (a chat opens the chat inbox to answer it).
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle, MessagesSquare } from "lucide-react";
import { Button, EmptyState, EnterpriseListPage, ErrorState, StatusBadge } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class InboxApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(InboxApiError, "body");
type InboxItem = { id: string; channel: "chat" | "whatsapp" | "email"; from: string | null; text: string; at: string | null; unread: boolean; recordName: string | null; href: string | null };
const CHANNELS = [{ key: "all", label: "All" }, { key: "chat", label: "Website chat" }, { key: "whatsapp", label: "WhatsApp" }, { key: "email", label: "Email" }] as const;
const ICON = { chat: MessagesSquare, whatsapp: MessageCircle, email: Mail };
const LABEL = { chat: "Chat", whatsapp: "WhatsApp", email: "Email" };

export function InboxScreen() {
  const workspace = useWorkspaceContext();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["key"]>("all");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "inbox", channel),
    queryFn: () => request<{ items: InboxItem[] }>(`/api/crm/inbox?channel=${channel}`),
    refetchInterval: 30_000,
  });
  return (
    <EnterpriseListPage
      header={{ title: "Inbox", description: "Chats, WhatsApp messages and emails from customers in the last 30 days, newest first." }}
      actionBar={{ start: <span className="flex flex-wrap gap-2">{CHANNELS.map((entry) => (
        <Button key={entry.key} size="compact" variant={entry.key === channel ? "primary" : "ghost"} onPress={() => setChannel(entry.key)}>{entry.label}</Button>
      ))}</span> }}
    >
      {query.isLoading ? <LoadingState label="Loading the inbox" rows={5} />
        : query.isError ? <ErrorState title="The inbox could not be loaded" description={query.error instanceof Error ? query.error.message : "Try again."} />
          : !query.data?.items.length ? <EmptyState title="Nothing new" description="Messages from customers on the records you can see show here." />
            : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                {query.data.items.map((item) => {
                  const Icon = ICON[item.channel];
                  const body = (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className={`truncate ${item.unread ? "font-semibold" : "font-medium"} text-text`}>{item.from ?? item.recordName ?? "A customer"}</span>
                        {item.recordName && item.from && <span className="truncate text-xs text-text-muted">{item.recordName}</span>}
                      </span>
                      <span className="truncate text-text-secondary">{item.text || "(no text)"}</span>
                    </span>
                  );
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <Icon className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                      {item.href ? <Link href={item.href} className="flex min-w-0 flex-1 hover:underline">{body}</Link> : body}
                      {item.unread && <StatusBadge tone="info">New</StatusBadge>}
                      <span className="hidden shrink-0 text-xs text-text-muted sm:inline">{LABEL[item.channel]} · {item.at ? formatDateTime(item.at) : ""}</span>
                    </li>
                  );
                })}
              </ul>
            )}
    </EnterpriseListPage>
  );
}
