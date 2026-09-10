"use client";

import { useState } from "react";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, FormField, StatePanel, StatusBadge, Surface } from "@/shared/design";

type Row = Record<string, unknown>;

function statusTone(status: unknown) {
  const value = String(status || "");
  if (value === "open") return "neutral" as const;
  if (value === "pending") return "warning" as const;
  if (value === "closed" || value === "archived") return "success" as const;
  if (value === "spam") return "danger" as const;
  return "neutral" as const;
}
function priorityTone(priority: unknown) {
  const value = String(priority || "");
  if (value === "urgent" || value === "high") return "danger" as const;
  return "neutral" as const;
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// F018 closeout (§33) — the shared inbox: team-inbox summary, unassigned/
// assigned threads, claim, honest thread status, and reply — reusing the
// SAME real send/consent/visibility infrastructure (queueOutboundEmail)
// rather than a parallel transport. Deliberately not a Support-ticket
// system: no SLA-breach escalation ladder, no queue routing engine — a
// thread is claimed, replied to, and marked open/pending/closed.
export default function InboxWorkspace({
  currentUserId,
  inboxes,
  initialThreads,
}: {
  currentUserId: string;
  inboxes: Row[];
  initialThreads: Row[];
}) {
  const [threads, setThreads] = useState<Row[]>(initialThreads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Row[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned" | "mine">("all");

  const selected = threads.find((thread) => String(thread.id) === selectedId) || null;
  const visibleThreads = threads.filter((thread) => {
    if (filter === "unassigned") return !thread.assigned_user_id;
    if (filter === "mine") return String(thread.assigned_user_id || "") === currentUserId;
    return true;
  });

  async function openThread(threadId: string) {
    setSelectedId(threadId);
    setMessages(null);
    setLoadingMessages(true);
    setMessage("");
    const result = await requestJson<{ messages?: Row[] }>(`/api/crm/communications/inbox/${threadId}/messages`);
    setLoadingMessages(false);
    if (!result.ok) {
      setMessage(result.message || "Messages could not be loaded.");
      setMessages([]);
      return;
    }
    setMessages(result.messages || []);
  }

  async function claim(threadId: string) {
    const result = await requestJson<{ thread?: Row }>(`/api/crm/communications/inbox/${threadId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!result.ok) {
      setMessage(result.message || "This conversation could not be claimed.");
      return;
    }
    setThreads((current) => current.map((thread) => (String(thread.id) === threadId ? { ...thread, ...result.thread } : thread)));
  }

  async function changeStatus(threadId: string, status: string) {
    const result = await requestJson<{ thread?: Row }>(`/api/crm/communications/inbox/${threadId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!result.ok) {
      setMessage(result.message || "Status could not be updated.");
      return;
    }
    setThreads((current) => current.map((thread) => (String(thread.id) === threadId ? { ...thread, ...result.thread } : thread)));
  }

  async function reply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    setMessage("");
    const participants = (Array.isArray(selected.participant_addresses) ? (selected.participant_addresses as string[]) : []).filter(Boolean);
    const result = await requestJson(`/api/crm/communications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toAddresses: participants,
        subject: String(selected.subject || "").startsWith("Re:") ? selected.subject : `Re: ${String(selected.subject || "")}`,
        bodyText: replyBody,
        provider: selected.provider,
        externalThreadId: selected.external_thread_id,
        inboxId: selected.inbox_id,
        leadId: selected.lead_id || undefined,
        opportunityId: selected.opportunity_id || undefined,
        partyId: selected.party_id || undefined,
        contactId: selected.contact_id || undefined,
      }),
    });
    setSending(false);
    if (!result.ok) {
      setMessage(result.message || "Reply could not be sent.");
      return;
    }
    setReplyBody("");
    await openThread(String(selected.id));
  }

  return (
    <div className="crm-suite-two-column">
      <Surface as="section" className="crm-suite-surface">
        <div className="crm-suite-two-column" style={{ marginBottom: "1rem" }}>
          {inboxes.map((inbox) => (
            <span key={String(inbox.id)}>
              <strong>{String(inbox.name)}</strong> · {Number(inbox.open_threads || 0)} open
              {Number(inbox.overdue_threads || 0) > 0 ? <StatusBadge tone="danger"> {Number(inbox.overdue_threads)} overdue</StatusBadge> : null}
            </span>
          ))}
          {!inboxes.length ? <StatePanel title="No shared inboxes configured yet." /> : null}
        </div>
        <div>
          <ActionButton type="button" tone={filter === "all" ? "primary" : "quiet"} onClick={() => setFilter("all")}>All</ActionButton>
          <ActionButton type="button" tone={filter === "unassigned" ? "primary" : "quiet"} onClick={() => setFilter("unassigned")}>Unassigned</ActionButton>
          <ActionButton type="button" tone={filter === "mine" ? "primary" : "quiet"} onClick={() => setFilter("mine")}>My conversations</ActionButton>
        </div>
        {visibleThreads.length ? (
          <ul className="crm-suite-list">
            {visibleThreads.map((thread) => (
              <li key={String(thread.id)}>
                <button type="button" onClick={() => void openThread(String(thread.id))} style={{ width: "100%", textAlign: "left" }}>
                  <strong>{String(thread.subject || "(no subject)")}</strong>
                  <StatusBadge tone={statusTone(thread.status)}>{String(thread.status)}</StatusBadge>
                  <StatusBadge tone={priorityTone(thread.priority)}>{String(thread.priority)}</StatusBadge>
                  <br />
                  <small>
                    {thread.assigned_user_id ? "Assigned" : "Unassigned"} · {dateTime(thread.last_message_at)}
                  </small>
                </button>
                {!thread.assigned_user_id ? (
                  <ActionButton type="button" tone="quiet" onClick={() => void claim(String(thread.id))}>Claim</ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <StatePanel title="No conversations here." />
        )}
      </Surface>

      <Surface as="section" className="crm-suite-surface">
        {message ? <p role="status">{message}</p> : null}
        {!selected ? (
          <StatePanel title="Select a conversation" description="Open a thread from the list to read its messages and reply." />
        ) : (
          <>
            <h2>{String(selected.subject || "(no subject)")}</h2>
            <div>
              <ActionButton type="button" tone="quiet" onClick={() => void changeStatus(String(selected.id), "pending")}>Mark pending</ActionButton>
              <ActionButton type="button" tone="quiet" onClick={() => void changeStatus(String(selected.id), "closed")}>Mark closed</ActionButton>
              <ActionButton type="button" tone="quiet" onClick={() => void changeStatus(String(selected.id), "open")}>Reopen</ActionButton>
            </div>
            {loadingMessages ? <StatePanel title="Loading messages…" /> : null}
            {messages && !messages.length ? <StatePanel title="No messages recorded for this thread." /> : null}
            {messages ? (
              <ul className="crm-suite-list">
                {messages.map((item) => (
                  <li key={String(item.id)}>
                    <strong>{item.direction === "outbound" ? "You" : String(item.from_address || "Unknown sender")}</strong>
                    <span> · {dateTime(item.sent_at || item.received_at || item.created_at)}</span>
                    <p>{String(item.body_text || "(no content)")}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <form className="crm-suite-form" onSubmit={reply}>
              <FormField label="Reply" htmlFor="inbox-reply-body" required>
                <textarea id="inbox-reply-body" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} required rows={5} />
              </FormField>
              <ActionButton type="submit" tone="primary" busy={sending}>
                {sending ? "Sending…" : "Send reply"}
              </ActionButton>
            </form>
          </>
        )}
      </Surface>
    </div>
  );
}
