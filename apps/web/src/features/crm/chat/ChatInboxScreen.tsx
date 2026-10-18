"use client";

// CRM › Chat (CRM plan 5.8): the website chats, newest first, with unread counts; open one to read and answer it, and close it when done
// (the conversation stays on the lead's timeline). Refreshes itself every few seconds.
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyState, PageHeader, Select, TextArea } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class ChatError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ChatError, "body");
type Session = {
  id: string; channelName: string; visitorName: string | null; visitorEmail: string | null; visitorMobile: string | null; pageUrl: string | null; leadId: string | null;
  leadCode: string | null; opportunityId: string | null; assignedName: string | null; status: "open" | "closed"; unread: number; lastMessageAt: string; lastMessage: string | null;
};
type Message = { id: string; sender: "visitor" | "agent" | "system"; body: string; authorName: string | null; at: string };

export function ChatInboxScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState<string | null>(params.get("session"));
  const key = scopedQueryKey(workspace, "crm", "chat", "sessions", status);
  const sessions = useQuery({ queryKey: key, queryFn: () => request<{ sessions: Session[] }>(`/api/crm/chat/sessions?status=${status}`).then((result) => result.sessions), refetchInterval: 5000 });
  const chatKey = scopedQueryKey(workspace, "crm", "chat", "session", selected ?? "none");
  const chat = useQuery({
    queryKey: chatKey, queryFn: () => request<{ chat: Session & { messages: Message[] } }>(`/api/crm/chat/sessions/${selected}`).then((result) => result.chat),
    enabled: Boolean(selected), refetchInterval: 4000,
  });
  const [reply, setReply] = useState("");
  const act = useMutation({
    mutationFn: (input: { body?: string; close?: boolean }) => request(`/api/crm/chat/sessions/${selected}`, { method: "POST", json: input }),
    onSuccess: () => { setReply(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "chat") }); },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Website chat" description="Chats from your website. Each one is on its lead; answer here, and close it when you are done."
        secondaryActions={<Select aria-label="Show" size="compact" selectedKey={status} onSelectionChange={(next) => setStatus(String(next))}
          options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />} />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section aria-label="Chats" className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {sessions.isLoading ? <LoadingState label="Loading chats" rows={4} /> : (sessions.data ?? []).length === 0 ? (
            <div className="p-4"><EmptyState title="No chats" description="Add the chat to your website from Setup › Website chat." /></div>
          ) : (sessions.data ?? []).map((session) => (
            <button key={session.id} type="button" onClick={() => setSelected(session.id)}
              className={`flex flex-col gap-0.5 p-3 text-left text-sm hover:bg-surface-hover ${selected === session.id ? "bg-surface-hover" : ""}`}>
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{session.visitorName ?? "Visitor"}</span>{session.unread > 0 && <Badge tone="brand">{session.unread}</Badge>}</span>
              <span className="truncate text-text-secondary">{session.lastMessage}</span>
              <span className="text-xs text-text-muted">{formatDateTime(session.lastMessageAt)} · {session.channelName}</span>
            </button>
          ))}
        </section>
        <section aria-label="Conversation" className="flex min-h-96 flex-col rounded-[var(--radius-card)] border border-border bg-surface">
          {!selected || !chat.data ? <p className="p-4 text-sm text-text-secondary">{selected ? "Loading…" : "Choose a chat."}</p> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{chat.data.visitorName}</span>
                  <span className="text-xs text-text-muted">{[chat.data.visitorEmail, chat.data.visitorMobile, chat.data.pageUrl].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="flex items-center gap-2">
                  {chat.data.opportunityId ? <Link className="text-brand hover:underline" href={`/crm/opportunities/${chat.data.opportunityId}`}>Open the deal</Link>
                    : chat.data.leadId ? <Link className="text-brand hover:underline" href={`/crm/leads/${chat.data.leadId}`}>Open {chat.data.leadCode ?? "the lead"}</Link> : null}
                  {chat.data.status === "open" && <Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ close: true })}>Close chat</Button>}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
                {chat.data.messages.map((message) => (
                  <div key={message.id} className={`flex ${message.sender === "visitor" ? "justify-start" : "justify-end"}`}>
                    <p className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${message.sender === "visitor" ? "bg-surface-muted" : message.sender === "agent" ? "bg-brand text-white" : "bg-surface-muted text-text-muted italic"}`}>
                      {message.body}
                      <span className="mt-0.5 block text-[10px] opacity-70">{message.sender === "agent" ? `${message.authorName ?? "Us"} · ` : ""}{formatDateTime(message.at)}</span>
                    </p>
                  </div>
                ))}
              </div>
              {act.isError && <div className="px-3"><Notice>{act.error instanceof Error ? act.error.message : "That did not work."}</Notice></div>}
              {chat.data.status === "open" ? (
                <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); if (reply.trim()) act.mutate({ body: reply.trim() }); }}>
                  <div className="flex-1"><TextArea aria-label="Reply" rows={2} value={reply} onChange={setReply} /></div>
                  <Button type="submit" variant="primary" isLoading={act.isPending} isDisabled={!reply.trim()}>Send</Button>
                </form>
              ) : <p className="border-t border-border p-3 text-sm text-text-muted">This chat is closed; its transcript is on the record&apos;s timeline.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
