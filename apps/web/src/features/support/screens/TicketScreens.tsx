"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, PageHeader, PermissionState, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, readView, SupportApiError, type Row } from "@/features/support/shared/client";
import { dateTime, label, quantity, tone } from "@/features/support/shared/format";
import { SupportAlert, SupportPanel, useCan } from "@/features/support/shared/SupportUi";
import type { RegisterConfig } from "@/features/support/shared/Register";
import { badge, col, link, opts, text } from "@/features/support/shared/helpers";

const errorText = (e: unknown) => (e instanceof SupportApiError ? e.message : "This could not be completed.");
const PRIORITIES = opts("low", "normal", "high", "urgent", "critical");

// ---------------------------------------------------------------- ticket list registers (F343-346,348,349)
export function ticketsRegister(scope: "all" | "mine" | "unassigned" | "escalated" | "breached"): RegisterConfig {
  const titles = { all: "All tickets", mine: "My tickets", unassigned: "Unassigned tickets", escalated: "Escalated tickets", breached: "Breached SLAs" } as const;
  const params: Record<string, string> = { all: {}, mine: { scope: "mine" }, unassigned: { status: "new" }, escalated: {}, breached: { breachedOnly: "true" } }[scope] as Record<string, string>;
  return {
    key: `tickets-${scope}`,
    title: titles[scope],
    description: scope === "mine" ? "Tickets assigned to you." : scope === "unassigned" ? "New tickets nobody has picked up yet." : scope === "escalated" ? "Tickets with an open escalation." : scope === "breached" ? "Tickets past their first-response or resolution SLA." : "Every ticket.",
    searchLabel: "Search tickets",
    emptyTitle: "No tickets",
    emptyDescription: "A ticket appears here once created.",
    source: scope === "escalated" ? { kind: "view", view: "escalations", params: { status: "open" } } : { kind: "view", view: "tickets", params },
    filters: scope === "all" ? [{ name: "status", label: "Status", options: opts("new", "open", "pending_customer", "pending_internal", "resolved", "closed", "cancelled") }, { name: "priority", label: "Priority", options: PRIORITIES }] : undefined,
    createLabel: scope === "all" || scope === "mine" ? "New ticket" : undefined,
    createPermission: "support.ticket.create",
    save: scope === "all" || scope === "mine" ? { action: "ticket-create", success: "Ticket created." } : undefined,
    fields: scope === "all" || scope === "mine" ? [
      { name: "subject", label: "Subject", kind: "text", required: true, wide: true },
      { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
      { name: "customerId", label: "Customer", kind: "select", options: "customers" },
      { name: "categoryId", label: "Category", kind: "select", options: "categories" },
      { name: "channel", label: "Channel", kind: "select", defaultValue: "internal", options: opts("web", "email", "phone", "chat", "whatsapp", "social", "internal") },
      { name: "priority", label: "Priority", kind: "select", options: PRIORITIES },
    ] : undefined,
    columns: () =>
      scope === "escalated"
        ? [link("ticket", "Ticket", (r) => String(r.ticket_number), (r) => `/support/ticket/${String(r.ticket_id)}`), col("subject", "Subject", (r) => String(r.subject)), badge("level", "Level", (r) => `Level ${r.escalation_level}`), col("reason", "Reason", (r) => String(r.reason)), col("escalated", "Escalated", (r) => dateTime(r.escalated_at)), badge("status", "Status", (r) => r.status)]
        : [
            link("ticket", "Ticket", (r) => String(r.ticket_number), (r) => `/support/ticket/${String(r.id)}`),
            col("subject", "Subject", (r) => String(r.subject)),
            col("customer", "Customer", (r) => String(r.party_name ?? "—")),
            badge("priority", "Priority", (r) => r.priority),
            badge("status", "Status", (r) => r.status),
            col("queue", "Queue", (r) => String(r.queue_name ?? "—")),
            col("due", "Resolution due", (r) => (r.resolution_due_at ? dateTime(r.resolution_due_at) : "—")),
            col("created", "Created", (r) => dateTime(r.created_at)),
          ],
    searchText: (r) => text(r, ["ticket_number", "subject", "party_name", "status", "priority"]),
    rowActions: scope === "escalated" ? [] : [
      { label: "Assign to me", permission: "support.ticket.assign", show: (r) => !r.assigned_user_id, run: (r) => act("ticket-assign", { id: r.id }), success: "Assigned." },
    ],
  };
}

// ---------------------------------------------------------------- ticket detail (F343-368 lifecycle)
const TRANSITIONS: Record<string, { label: string; permission: string; needsCode?: boolean; needsReason?: boolean }> = {
  open: { label: "Open", permission: "support.ticket.assign" },
  pending_customer: { label: "Wait on customer", permission: "support.ticket.assign" },
  pending_internal: { label: "Wait internally", permission: "support.ticket.assign" },
  resume_from_customer: { label: "Resume", permission: "support.ticket.assign" },
  resume_from_internal: { label: "Resume", permission: "support.ticket.assign" },
  resolve: { label: "Resolve", permission: "support.ticket.resolve", needsCode: true },
  close: { label: "Close", permission: "support.ticket.close" },
  reopen: { label: "Reopen", permission: "support.ticket.assign", needsReason: true },
  cancel: { label: "Cancel", permission: "support.ticket.assign" },
};
const NEXT_ACTIONS: Record<string, string[]> = {
  new: ["open", "cancel"],
  open: ["pending_customer", "pending_internal", "resolve"],
  pending_customer: ["resume_from_customer"],
  pending_internal: ["resume_from_internal"],
  resolved: ["close", "reopen"],
};

export function TicketDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [resolutionCode, setResolutionCode] = useState("");

  const ticket = useQuery({ queryKey: scopedQueryKey(workspace, "support", "ticket", id), queryFn: () => readView<{ ticket: Row }>("ticket", { id }).then((r) => r.ticket) });
  const comms = useQuery({ queryKey: scopedQueryKey(workspace, "support", "communications", id), queryFn: () => readView<{ rows: Row[] }>("communications", { ticketId: id }).then((r) => r.rows) });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "support", "ticket-history", id), queryFn: () => readView<{ history: Row }>("ticket-history", { ticketId: id }).then((r) => r.history) });
  const linked = useQuery({ queryKey: scopedQueryKey(workspace, "support", "linked", id), queryFn: () => readView<{ linked: Row }>("ticket-linked-records", { ticketId: id }).then((r) => r.linked) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "support") });
  const go = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  if (ticket.isError) return <PermissionState title="You don't have access to this ticket" description="Ask an administrator to grant support.view." />;
  const t = ticket.data;
  if (!t) return <p className="text-sm text-text-muted">Loading…</p>;
  const nextActions = NEXT_ACTIONS[String(t.status)] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${String(t.ticket_number)} — ${String(t.subject)}`} description={`${t.party_name ?? "No customer"} · ${label(t.channel)} · opened ${dateTime(t.created_at)}`} />
      {notice && <SupportAlert tone="success">{notice}</SupportAlert>}
      {error && <SupportAlert>{error}</SupportAlert>}
      <MetricStrip metrics={[
        { label: "Status", value: label(t.status) },
        { label: "Priority", value: label(t.priority) },
        { label: "Queue", value: String(t.queue_name ?? "—") },
        { label: "First response due", value: t.first_response_due_at ? dateTime(t.first_response_due_at) : "—" },
        { label: "Resolution due", value: t.resolution_due_at ? dateTime(t.resolution_due_at) : "—" },
      ]} />
      <div className="flex flex-wrap gap-2">
        {nextActions.map((action) => {
          const cfg = TRANSITIONS[action];
          if (!can(cfg.permission)) return null;
          return (
            <Button key={action} variant="secondary" onPress={() => (cfg.needsCode || cfg.needsReason ? setPendingAction(action) : go.mutate(async () => { await act("ticket-transition", { id, action }); setNotice(`${cfg.label} done.`); }))} isLoading={go.isPending}>
              {cfg.label}
            </Button>
          );
        })}
        {can("support.ticket.assign") && !t.assigned_user_id && (
          <Button variant="secondary" onPress={() => go.mutate(async () => { await act("ticket-assign", { id }); setNotice("Assigned to you."); })}>Assign to me</Button>
        )}
        {can("support.escalation.manage") && (
          <Button variant="ghost" onPress={() => setPendingAction("escalate")}>Escalate</Button>
        )}
      </div>

      <SupportPanel title="Linked records">
        <ul className="text-sm text-text-secondary">
          <li>Product: {linked.data?.product ? String(linked.data.product.name) : "—"}</li>
          <li>Asset: {linked.data?.asset ? `${String(linked.data.asset.name)}${linked.data.assetUnderWarranty === false ? " (out of warranty)" : linked.data.assetUnderWarranty ? " (under warranty)" : ""}` : "—"}</li>
          <li>Sales order: {linked.data?.order ? String(linked.data.order.sales_order_number) : "—"}</li>
        </ul>
      </SupportPanel>

      <SupportPanel title="Conversation" description="Customer-visible replies and internal notes, in order.">
        <ul className="flex flex-col gap-2 text-sm">
          {(comms.data ?? []).map((m) => (
            <li key={String(m.id)} className={`rounded-[var(--radius-control)] border p-2 ${m.private_note ? "border-warning-emphasis/30 bg-warning-soft" : "border-border"}`}>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <StatusBadge tone={tone(m.direction)}>{label(m.direction)}</StatusBadge>
                {Boolean(m.private_note) && <StatusBadge tone="warning">Private note</StatusBadge>}
                <span>{dateTime(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-text">{String(m.body)}</p>
            </li>
          ))}
          {(comms.data ?? []).length === 0 && <li className="text-text-muted">No messages yet.</li>}
        </ul>
        {can("support.communication.manage") && (
          <div className="flex flex-col gap-2">
            <TextArea label="Reply to the customer" value={reply} onChange={setReply} />
            <div className="flex justify-end">
              <Button variant="primary" isDisabled={!reply.trim()} isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("communication-add", { ticketId: id, direction: "outbound", body: reply }); setReply(""); setNotice("Reply sent."); })}>Send reply</Button>
            </div>
            <TextArea label="Internal note (not visible to the customer)" value={note} onChange={setNote} />
            <div className="flex justify-end">
              <Button variant="secondary" isDisabled={!note.trim()} isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("communication-add", { ticketId: id, direction: "internal", privateNote: true, body: note }); setNote(""); setNotice("Note added."); })}>Add note</Button>
            </div>
          </div>
        )}
      </SupportPanel>

      <SupportPanel title="History">
        <ul className="text-xs text-text-muted">
          {(history.data?.statusHistory ?? []).map((h: Row) => <li key={String(h.id)}>{dateTime(h.changed_at)} — {label(h.from_status ?? "created")} → {label(h.to_status)}{h.reason ? `: ${h.reason}` : ""}</li>)}
        </ul>
      </SupportPanel>

      {pendingAction && pendingAction !== "escalate" && (
        <Dialog isOpen onOpenChange={(o) => !o && setPendingAction(null)} title={TRANSITIONS[pendingAction].label}>
          <div className="flex flex-col gap-4">
            {TRANSITIONS[pendingAction].needsCode && <TextField label="Resolution code" value={resolutionCode} onChange={setResolutionCode} isRequired />}
            {TRANSITIONS[pendingAction].needsReason && <TextArea label="Reason" value={reason} onChange={setReason} isRequired />}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setPendingAction(null)}>Close</Button>
              <Button variant="primary" isLoading={go.isPending} onPress={() => go.mutate(async () => {
                await act("ticket-transition", { id, action: pendingAction, resolutionCode: resolutionCode || undefined, reason: reason || undefined });
                setNotice(`${TRANSITIONS[pendingAction].label} done.`);
                setPendingAction(null); setReason(""); setResolutionCode("");
              })}>{TRANSITIONS[pendingAction].label}</Button>
            </div>
          </div>
        </Dialog>
      )}
      {pendingAction === "escalate" && (
        <Dialog isOpen onOpenChange={(o) => !o && setPendingAction(null)} title="Escalate">
          <div className="flex flex-col gap-4">
            <TextArea label="Reason" value={reason} onChange={setReason} isRequired />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setPendingAction(null)}>Close</Button>
              <Button variant="primary" isDisabled={!reason.trim()} isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("escalation-raise", { ticketId: id, reason }); setNotice("Escalated."); setPendingAction(null); setReason(""); })}>Escalate</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- F379: dashboard
export function SupportDashboardScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "support", "dashboard"), queryFn: () => readView<{ dashboard: Row }>("dashboard").then((r) => r.dashboard) });
  if (query.isError) return <PermissionState title="You don't have access to Support" description="Ask an administrator to grant support.view." />;
  const d = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Support" description="Ticket volume, SLA health and what needs attention right now." />
      {d && (
        <MetricStrip metrics={[
          { label: "Open tickets", value: quantity(d.open_tickets) },
          { label: "Unassigned", value: quantity(d.unassigned_tickets) },
          { label: "High priority", value: quantity(d.high_priority_tickets) },
          { label: "First-response breaches", value: quantity(d.first_response_breaches) },
          { label: "Resolution breaches", value: quantity(d.resolution_breaches) },
          { label: "Open escalations", value: quantity(d.open_escalations) },
          { label: "My open tickets", value: quantity(d.my_open) },
          { label: "Resolved today", value: quantity(d.resolved_today) },
        ]} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- escalations (decide)
export const escalationsRegister: RegisterConfig = {
  key: "escalations-admin",
  title: "Escalations",
  description: "Every escalation, open or resolved.",
  searchLabel: "Search escalations",
  emptyTitle: "No escalations",
  emptyDescription: "An escalation appears here once one is raised.",
  source: { kind: "view", view: "escalations" },
  filters: [{ name: "status", label: "Status", options: opts("open", "acknowledged", "resolved", "cancelled") }],
  columns: () => [link("ticket", "Ticket", (r) => String(r.ticket_number), (r) => `/support/ticket/${String(r.ticket_id)}`), col("subject", "Subject", (r) => String(r.subject)), badge("level", "Level", (r) => `Level ${r.escalation_level}`), col("reason", "Reason", (r) => String(r.reason)), col("escalated", "Escalated", (r) => dateTime(r.escalated_at)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["ticket_number", "subject", "reason", "status"]),
  rowActions: [
    { label: "Acknowledge", permission: "support.escalation.manage", show: (r) => r.status === "open", run: (r) => act("escalation-decide", { id: r.id, action: "acknowledge" }), success: "Acknowledged." },
    { label: "Resolve", permission: "support.escalation.manage", show: (r) => ["open", "acknowledged"].includes(String(r.status)), run: (r) => act("escalation-decide", { id: r.id, action: "resolve" }), success: "Resolved." },
    { label: "Cancel", permission: "support.escalation.manage", show: (r) => ["open", "acknowledged"].includes(String(r.status)), run: (r) => act("escalation-decide", { id: r.id, action: "cancel" }), success: "Cancelled." },
  ],
};
