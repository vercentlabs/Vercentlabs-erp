"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, NumberField, PageHeader, PermissionState, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, readView, SupportApiError, type Row } from "@/features/support/shared/client";
import { dateTime, label, tone } from "@/features/support/shared/format";
import { SupportAlert, SupportPanel } from "@/features/support/shared/SupportUi";

const errorText = (e: unknown) => (e instanceof SupportApiError ? e.message : "This could not be completed.");
const NOT_LINKED = <PermissionState title="You don't have portal access" description="Ask the company you're in touch with to invite you to their support portal." />;

// F371: a customer's own ticket -- their conversation (private staff notes are already excluded by
// the server), a reply box, and a satisfaction rating once it is resolved.
export function PortalTicketDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [csatScore, setCsatScore] = useState(5);
  const [csatComment, setCsatComment] = useState("");

  const ticket = useQuery({ queryKey: scopedQueryKey(workspace, "support", "my-ticket", id), queryFn: () => readView<{ ticket: Row }>("my-ticket", { id }).then((r) => r.ticket) });
  const comms = useQuery({ queryKey: scopedQueryKey(workspace, "support", "my-communications", id), queryFn: () => readView<{ rows: Row[] }>("my-communications", { ticketId: id }).then((r) => r.rows) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "support") });
  const go = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  if (ticket.isError) return NOT_LINKED;
  const t = ticket.data;
  if (!t) return <p className="text-sm text-text-muted">Loading…</p>;
  const canRate = ["resolved", "closed"].includes(String(t.status)) && !t.csat_submitted_at;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${String(t.ticket_number)} — ${String(t.subject)}`} description={`Opened ${dateTime(t.created_at)}`} />
      {notice && <SupportAlert tone="success">{notice}</SupportAlert>}
      {error && <SupportAlert>{error}</SupportAlert>}
      <MetricStrip metrics={[{ label: "Status", value: label(t.status) }]} />
      <SupportPanel title="Conversation">
        <ul className="flex flex-col gap-2 text-sm">
          {(comms.data ?? []).map((m) => (
            <li key={String(m.id)} className="rounded-[var(--radius-control)] border border-border p-2">
              <div className="flex items-center gap-2 text-xs text-text-muted"><StatusBadge tone={tone(m.direction)}>{m.direction === "inbound" ? "You" : "Support"}</StatusBadge><span>{dateTime(m.created_at)}</span></div>
              <p className="whitespace-pre-wrap text-text">{String(m.body)}</p>
            </li>
          ))}
          {(comms.data ?? []).length === 0 && <li className="text-text-muted">No messages yet.</li>}
        </ul>
        {!["closed", "cancelled", "merged"].includes(String(t.status)) && (
          <div className="flex flex-col gap-2">
            <TextArea label="Reply" value={reply} onChange={setReply} />
            <div className="flex justify-end">
              <Button variant="primary" isDisabled={!reply.trim()} isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("my-ticket-reply", { ticketId: id, body: reply }); setReply(""); setNotice("Sent."); })}>Send</Button>
            </div>
          </div>
        )}
      </SupportPanel>
      {canRate && (
        <SupportPanel title="How did we do?" description="Rate this from 1 (poor) to 5 (excellent).">
          <div className="flex flex-col gap-2">
            <NumberField label="Rating" value={csatScore} onChange={setCsatScore} minValue={1} maxValue={5} step={1} />
            <TextArea label="Comments (optional)" value={csatComment} onChange={setCsatComment} />
            <div className="flex justify-end">
              <Button variant="primary" isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("my-csat-submit", { ticketId: id, score: csatScore, comment: csatComment }); setNotice("Thanks for the feedback!"); })}>Submit rating</Button>
            </div>
          </div>
        </SupportPanel>
      )}
      {t.csat_submitted_at && <SupportAlert tone="success">You rated this {String(t.satisfaction_score)} / 5. Thank you.</SupportAlert>}
    </div>
  );
}

// F369/F371: a published article, read through the portal.
export function PortalArticleScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "support", "my-article", id), queryFn: () => readView<{ article: Row }>("my-knowledge-article", { id }).then((r) => r.article) });
  if (query.isError) return <PermissionState title="Article not found" description="It may have been unpublished." />;
  const a = query.data;
  if (!a) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={String(a.title)} description={a.summary ? String(a.summary) : undefined} />
      <SupportPanel>
        <p className="whitespace-pre-wrap text-sm text-text">{String(a.content)}</p>
      </SupportPanel>
    </div>
  );
}
