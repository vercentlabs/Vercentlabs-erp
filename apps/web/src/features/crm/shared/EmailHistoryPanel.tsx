"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Lock, Mail, MessageSquare, Phone } from "lucide-react";
import { Button, Dialog, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "./crm-options-api";
import { getEmailThread, listEmailHistory, type EmailHistoryRow } from "./email-history-api";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const channelIcon: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, sms: MessageSquare, call: Phone, call_log: Phone };
const channelLabel: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", call: "Call", call_log: "Call" };

function engagementCounts(row: EmailHistoryRow) {
  const counts = new Map<string, number>();
  for (const event of row.engagementEvents ?? []) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  return counts;
}

// F018 Email history composed into a record 360. Read-only by design: rows
// are written by mailbox sync / outbound send, never by hand. Content
// visibility is decided server-side per row (full vs metadata-only); this
// panel only renders the lock state it is given.
export function EmailHistoryPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const workspace = useWorkspaceContext();
  const [openId, setOpenId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("all");
  const [now] = useState(() => Date.now());
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "email-history", entityType, entityId),
    queryFn: () => listEmailHistory(entityType, entityId),
  });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const userNames = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return new Map(rows.map((row) => [String(row.id), String(row.fullName || row.name || row.id)]));
  }, [optionsQuery.data]);

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading communications…</p>;
  if (query.isError) return <p role="alert" className="text-sm text-danger">Communications could not be loaded.</p>;

  const all = query.data?.rows ?? [];
  if (all.length === 0) return <p className="text-sm text-text-muted">No communications recorded for this record yet.</p>;
  const channels = Array.from(new Set(all.map((row) => row.channel)));
  const rows = channel === "all" ? all : all.filter((row) => row.channel === channel);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by channel">
        {["all", ...channels].map((id) => (
          <Button key={id} variant={channel === id ? "primary" : "secondary"} onPress={() => setChannel(id)}>
            {id === "all" ? `All (${all.length})` : (channelLabel[id] ?? id)}
          </Button>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {rows.map((row) => {
          const Icon = channelIcon[row.channel] ?? Mail;
          const restricted = row.contentVisibility === "metadata";
          const expanded = openId === row.id;
          const counts = engagementCounts(row);
          const opened = (counts.get("opened") ?? 0) + (counts.get("open") ?? 0);
          const clicked = (counts.get("clicked") ?? 0) + (counts.get("click") ?? 0);
          const bounced = (counts.get("soft_bounce") ?? 0) + (counts.get("hard_bounce") ?? 0) + (counts.get("bounced") ?? 0);
          const complained = counts.get("complaint") ?? 0;
          const unsubscribed = counts.get("unsubscribe") ?? 0;
          const label = channelLabel[row.channel] ?? row.channel;
          return (
            <li key={row.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                    {restricted ? (
                      <span className="flex items-center gap-1.5 text-text-muted">
                        <Lock className="size-3.5" aria-hidden="true" />
                        {`${label} ${row.direction === "inbound" ? "received" : "sent"} — content restricted`}
                      </span>
                    ) : (
                      <>
                        <Icon className="size-3.5 text-text-muted" aria-hidden="true" />
                        {row.subject || `${label} ${row.direction ?? ""}`.trim()}
                      </>
                    )}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {restricted
                      ? dateTimeFormatter.format(new Date(row.occurredAt))
                      : `${row.fromAddress || "Unknown sender"}${row.toAddresses?.length ? ` → ${row.toAddresses.join(", ")}` : ""} · ${dateTimeFormatter.format(new Date(row.occurredAt))}`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.direction && <StatusBadge tone="neutral">{row.direction === "inbound" ? "Inbound" : "Outbound"}</StatusBadge>}
                  {opened > 0 && <StatusBadge tone="success">{`Opened${opened > 1 ? ` ×${opened}` : ""}`}</StatusBadge>}
                  {clicked > 0 && <StatusBadge tone="info">{`Clicked${clicked > 1 ? ` ×${clicked}` : ""}`}</StatusBadge>}
                  {bounced > 0 && <StatusBadge tone="danger">Bounced</StatusBadge>}
                  {complained > 0 && <StatusBadge tone="danger">Spam complaint</StatusBadge>}
                  {unsubscribed > 0 && <StatusBadge tone="warning">Unsubscribed</StatusBadge>}
                </div>
              </div>
              {!restricted && (row.body || row.threadId) && (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {row.body && (
                    <button type="button" className="inline-flex items-center gap-1 text-brand hover:underline" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : row.id)}>
                      {expanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
                      {expanded ? "Hide message" : "Show message"}
                    </button>
                  )}
                  {row.threadId && (
                    <button type="button" className="text-brand hover:underline" onClick={() => setThreadId(row.threadId ?? null)}>
                      View conversation
                    </button>
                  )}
                  {row.assignedUserId && <span className="text-text-muted">{`Assigned to ${userNames.get(row.assignedUserId) ?? "a teammate"}`}</span>}
                  {row.firstResponseDueAt && row.firstRespondedAt && <span className="text-text-muted">{`Replied ${dateTimeFormatter.format(new Date(row.firstRespondedAt))}`}</span>}
                  {row.firstResponseDueAt && !row.firstRespondedAt && (
                    <span className={new Date(row.firstResponseDueAt).getTime() < now ? "font-medium text-danger" : "text-text-muted"}>
                      {new Date(row.firstResponseDueAt).getTime() < now ? `First response overdue since ${dateTimeFormatter.format(new Date(row.firstResponseDueAt))}` : `First response due ${dateTimeFormatter.format(new Date(row.firstResponseDueAt))}`}
                    </span>
                  )}
                </div>
              )}
              {expanded && row.body && <p className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-border p-3 text-sm text-text">{row.body}</p>}
            </li>
          );
        })}
      </ul>
      {threadId && <ThreadDialog threadId={threadId} onClose={() => setThreadId(null)} />}
    </div>
  );
}

function ThreadDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "email-thread", threadId), queryFn: () => getEmailThread(threadId) });
  const thread = query.data?.thread;
  const messages = query.data?.messages ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={thread?.subject || "Conversation"} description="Every message in this conversation, oldest first." size="lg">
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading conversation…</p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">{query.error instanceof Error ? query.error.message : "This conversation could not be loaded."}</p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-border overflow-y-auto">
          {messages.length === 0 && <p className="py-2 text-sm text-text-muted">No messages you are allowed to see.</p>}
          {messages.map((message) => (
            <div key={message.id} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                {message.redacted ? (
                  <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" />Content restricted</span>
                ) : (
                  <span className="font-medium text-text">{message.fromAddress || "Unknown sender"}</span>
                )}
                <span>{dateTimeFormatter.format(new Date(message.sentAt || message.receivedAt || message.createdAt))}</span>
                {message.direction && <span>{message.direction === "inbound" ? "Inbound" : "Outbound"}</span>}
              </div>
              {!message.redacted && <p className="whitespace-pre-wrap text-sm text-text">{message.bodyText || "(no text content)"}</p>}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
