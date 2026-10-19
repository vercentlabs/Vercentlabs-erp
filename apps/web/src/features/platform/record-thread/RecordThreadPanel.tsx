"use client";

// The shared record thread (Shared Platform plan 4), placed on main document screens: comments and internal notes with @mentions,
// scheduled activities, followers, and the record's history. <RecordThreadPanel type="sales.order" id={orderId} />
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";

type Person = { id: string; name: string };
type Thread = {
  title: string;
  comments: Array<{ id: string; kind: "comment" | "note"; body: string | null; deleted: boolean; authorName: string | null; at: string; editedAt: string | null; mine: boolean }>;
  activities: Array<{ id: string; typeLabel: string; summary: string; note: string | null; dueDate: string; assigneeName: string | null; status: string; overdue: boolean; doneNote: string | null }>;
  followers: Array<{ userId: string; name: string }>;
  following: boolean;
  history: Array<{ label: string; at: string; by: string | null }>;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const when = (value: string) => new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function RecordThreadPanel({ type, id }: { type: string; id: string }) {
  const queryClient = useQueryClient();
  const key = ["record-thread", type, id];
  const url = `/api/record-threads/${type}/${id}`;
  const thread = useQuery({ queryKey: key, queryFn: () => call<{ thread: Thread }>(url).then((result) => result.thread) });
  const people = useQuery({ queryKey: ["people"], queryFn: () => call<{ people: Person[] }>("/api/people").then((result) => result.people), staleTime: 300_000 });
  const [tab, setTab] = useState<"comments" | "activities" | "history">("comments");
  const [body, setBody] = useState("");
  const [note, setNote] = useState(false);
  const [activity, setActivity] = useState({ type: "to_do", summary: "", dueDate: today(), assignedTo: "" });
  const act = useMutation({
    mutationFn: (input: Record<string, unknown>) => call<{ thread: Thread }>(url, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (result) => queryClient.setQueryData(key, result.thread),
  });
  // @Name in the text mentions that person.
  const mentions = useMemo(() => (people.data ?? []).filter((person) => body.includes(`@${person.name}`)).map((person) => person.id), [people.data, body]);
  const data = thread.data;
  if (thread.isLoading) return <Panel title="Comments and activities"><p className="text-sm text-text-muted">Loading…</p></Panel>;
  if (!data) return null;
  const open = data.activities.filter((entry) => entry.status === "open");
  return (
    <Panel
      title="Comments and activities"
      description={`${data.followers.length} follower${data.followers.length === 1 ? "" : "s"}${data.followers.length ? `: ${data.followers.map((follower) => follower.name).join(", ")}` : ""}`}
      actions={<Button variant="ghost" size="compact" isDisabled={act.isPending} onPress={() => act.mutate({ action: "follow", following: !data.following })}>{data.following ? "Following" : "Follow"}</Button>}
    >
      {act.error && <Notice>{act.error instanceof Error ? act.error.message : "That did not work."}</Notice>}
      <div className="flex gap-1 border-b border-border text-sm" role="tablist">
        {(["comments", "activities", "history"] as const).map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}
            className={`px-3 py-1.5 ${tab === name ? "border-b-2 border-brand font-medium" : "text-text-secondary"}`}>
            {name === "comments" ? `Comments (${data.comments.filter((comment) => !comment.deleted).length})` : name === "activities" ? `Activities (${open.length})` : "History"}
          </button>
        ))}
      </div>
      {tab === "comments" && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {data.comments.map((comment) => (
              <li key={comment.id} className={`rounded-[var(--radius-control)] border p-2 text-sm ${comment.kind === "note" ? "border-warning-emphasis/30 bg-warning-soft" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                  <span>{`${comment.authorName ?? "Someone"} · ${when(comment.at)}${comment.editedAt ? " · edited" : ""}${comment.kind === "note" ? " · internal note" : ""}`}</span>
                  {comment.mine && !comment.deleted && <button type="button" className="hover:underline" onClick={() => act.mutate({ action: "delete", commentId: comment.id })}>Remove</button>}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{comment.deleted ? <span className="italic text-text-muted">Removed</span> : comment.body}</p>
              </li>
            ))}
            {!data.comments.length && <li className="text-sm text-text-muted">No comments yet.</li>}
          </ul>
          <TextArea aria-label="Comment" placeholder="Write a comment… type @ and a name to mention someone" rows={3} value={body} onChange={setBody} />
          {mentions.length > 0 && <p className="text-xs text-text-muted">{`Will tell: ${(people.data ?? []).filter((person) => mentions.includes(person.id)).map((person) => person.name).join(", ")}`}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {(people.data ?? []).slice(0, 8).map((person) => (
                <button key={person.id} type="button" className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-surface-hover" onClick={() => setBody((text) => `${text}${text && !text.endsWith(" ") ? " " : ""}@${person.name} `)}>@{person.name}</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Checkbox isSelected={note} onChange={setNote}>Internal note</Checkbox>
              <Button variant="primary" size="compact" isLoading={act.isPending} isDisabled={!body.trim()}
                onPress={() => act.mutate({ action: "comment", body, kind: note ? "note" : "comment", mentions }, { onSuccess: () => { setBody(""); setNote(false); } })}>Post</Button>
            </div>
          </div>
        </div>
      )}
      {tab === "activities" && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2 text-sm">
            {data.activities.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border p-2">
                <span>
                  <span className="font-medium">{`${entry.typeLabel}: ${entry.summary}`}</span>
                  <span className="text-text-muted">{` · ${entry.assigneeName ?? ""} · due ${entry.dueDate}`}</span>
                  {entry.status !== "open" && <span className="ml-2"><StatusBadge tone={entry.status === "done" ? "success" : "neutral"}>{entry.status === "done" ? "Done" : "Cancelled"}</StatusBadge></span>}
                  {entry.overdue && <span className="ml-2"><StatusBadge tone="danger">Overdue</StatusBadge></span>}
                </span>
                {entry.status === "open" && (
                  <span className="flex gap-1">
                    <Button variant="secondary" size="compact" onPress={() => act.mutate({ action: "close", activityId: entry.id, outcome: "done" })}>Done</Button>
                    <Button variant="ghost" size="compact" onPress={() => act.mutate({ action: "close", activityId: entry.id, outcome: "cancelled" })}>Cancel</Button>
                  </span>
                )}
              </li>
            ))}
            {!data.activities.length && <li className="text-text-muted">No activities planned.</li>}
          </ul>
          <div className="grid gap-2 rounded-[var(--radius-control)] border border-border p-2 sm:grid-cols-4">
            <Select label="Type" size="compact" selectedKey={activity.type} onSelectionChange={(value) => setActivity((current) => ({ ...current, type: String(value) }))}
              options={[{ value: "to_do", label: "To-do" }, { value: "call", label: "Call" }, { value: "meeting", label: "Meeting" }, { value: "email", label: "Email" }]} />
            <TextField label="What" size="compact" value={activity.summary} onChange={(value) => setActivity((current) => ({ ...current, summary: value }))} />
            <TextField label="Due" size="compact" type="date" value={activity.dueDate} onChange={(value) => setActivity((current) => ({ ...current, dueDate: value }))} />
            <Select label="For" size="compact" selectedKey={activity.assignedTo || null} onSelectionChange={(value) => setActivity((current) => ({ ...current, assignedTo: String(value) }))}
              options={(people.data ?? []).map((person) => ({ value: person.id, label: person.name }))} placeholder="Me" />
            <div className="sm:col-span-4 flex justify-end">
              <Button variant="primary" size="compact" isLoading={act.isPending} isDisabled={!activity.summary.trim()}
                onPress={() => act.mutate({ action: "activity", ...activity, assignedTo: activity.assignedTo || undefined }, { onSuccess: () => setActivity({ type: "to_do", summary: "", dueDate: today(), assignedTo: "" }) })}>Plan activity</Button>
            </div>
          </div>
        </div>
      )}
      {tab === "history" && (
        <ul className="flex flex-col gap-1 text-sm">
          {data.history.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex justify-between gap-2 border-b border-border/50 py-1">
              <span className="capitalize">{entry.label}</span>
              <span className="text-text-muted">{`${entry.by ?? "System"} · ${when(entry.at)}`}</span>
            </li>
          ))}
          {!data.history.length && <li className="text-text-muted">Nothing recorded yet.</li>}
        </ul>
      )}
    </Panel>
  );
}
