"use client";

// Support — the ticket desk. The workspace (overview, every queue with its count, reports), one ticket (the conversation with the reply and
// private-note composer, details with deadlines, files, history) and the settings (targets, support mailboxes, categories). Replies go out by
// email through a support mailbox and show their real delivery state; private notes are never emailed.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, MetricStrip, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { errorMessage, errorStatus, newKey } from "@/features/quality/specifications/spec-api";
import { formatDateTime } from "@/shared/format/human";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  CLOCK_LABEL, CLOCK_TONE, DELIVERY_TONE, PRIORITY_TONE, STATUS_TONE, SUPPORT_BASE, deskApi,
  type Clock, type Counts, type Options, type TicketDetail, type TicketRow,
} from "./desk-api";

function Denied({ error, what }: { error: unknown; what: string }) {
  return errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs the Support view permission." /> : <Notice tone="danger">{errorMessage(error)}</Notice>;
}
const useKey = (...parts: string[]) => scopedQueryKey(useWorkspaceContext(), "support", "desk", ...parts);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "support", "desk") });
};
const useOptions = (enabled = true) => useQuery({ queryKey: useKey("options"), queryFn: deskApi.options, retry: false, enabled, staleTime: 60_000 });
const clock = (state: Clock, due: string | null) => (state ? <StatusBadge tone={CLOCK_TONE[state] ?? "neutral"}>{`${CLOCK_LABEL[state]}${due && state === "RUNNING" ? ` ${formatDateTime(due)}` : ""}`}</StatusBadge> : <span className="text-text-muted">—</span>);

// ------------------------------------------------------------------ the workspace
const VIEWS: Array<{ id: string; label: string; count?: keyof Counts }> = [{ id: "overview", label: "Overview" }, { id: "mine", label: "My Tickets", count: "mine" },
  { id: "open", label: "All Open", count: "open" }, { id: "unassigned", label: "Unassigned", count: "unassigned" }, { id: "pending_customer", label: "Pending Customer", count: "pending_customer" },
  { id: "pending_internal", label: "Pending Internal", count: "pending_internal" }, { id: "response_overdue", label: "Response Overdue", count: "response_overdue" },
  { id: "resolution_overdue", label: "Resolution Overdue", count: "resolution_overdue" }, { id: "unmatched", label: "Unmatched Senders", count: "unmatched" },
  { id: "resolved", label: "Resolved", count: "resolved" }, { id: "closed", label: "Closed" }, { id: "reports", label: "Reports" }];

export function SupportWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const counts = useQuery({ queryKey: useKey("counts"), queryFn: deskApi.counts, retry: false });
  const options = useOptions(!counts.isError);
  if (counts.isError) return <Denied error={counts.error} what="support tickets" />;
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  const c = counts.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Support" description="Customer cases from email and by hand. Each ticket keeps its whole conversation; replies go out from a support mailbox and private notes never leave the company."
        primaryAction={<span className="flex gap-2">{options.data?.can.settings || options.data?.can.mailboxes ? <Link className="self-center text-sm text-brand hover:underline" href={`${SUPPORT_BASE}/settings`}>Settings</Link> : null}
          {options.data?.can.create && <Button variant="primary" onPress={() => setAsk(newTicketAsk(options.data!, (id) => router.push(`${SUPPORT_BASE}/tickets/${id}`)))}>New ticket</Button>}</span>} />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Support views">{VIEWS.filter((v) => v.id !== "reports" || options.data?.can.reports).map((v) => <Tab key={v.id} id={v.id}>{v.count && c ? `${v.label} (${c[v.count] ?? 0})` : v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" ? <Overview onSelect={select} /> : view === "reports" ? <Reports /> : <Queue view={view} key={view} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function newTicketAsk(o: Options, onDone: (id: string) => void): Ask {
  // A caller who is not a customer yet is recorded by name and phone (Create-Where-You-Are SU1); the customer can be linked later.
  return { title: "New ticket", confirm: "Create ticket", description: "A case raised by hand (a call, a walk-in). Choose the customer, or note who called if they are not a customer yet; email tickets are created by themselves.",
    fields: [{ name: "subject", label: "Subject", kind: "text", required: true }, { name: "description", label: "Description", kind: "textarea", required: true },
      { name: "customerId", label: "Customer", kind: "select", options: o.customers },
      { name: "customerName", label: "Caller name (if not a customer yet)", kind: "text" }, { name: "customerPhone", label: "Caller phone", kind: "text" },
      { name: "customerEmail", label: "Customer email (for replies)", kind: "text" },
      { name: "categoryId", label: "Category", kind: "select", options: o.categories }, { name: "priority", label: "Priority", kind: "select", initial: "normal", options: o.priorities },
      { name: "assignedUserId", label: "Agent", kind: "select", options: o.agents }],
    run: async (v, key) => { const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "")); const made = await deskApi.create({ ...body, idempotencyKey: key }); onDone(made.id); } };
}
function Overview({ onSelect }: { onSelect: (view: string) => void }) {
  const q = useQuery({ queryKey: useKey("dashboard"), queryFn: deskApi.dashboard, retry: false });
  if (q.isLoading) return <LoadingState label="Loading the overview" rows={3} />;
  if (q.isError) return <Denied error={q.error} what="the overview" />;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-4">
      <MetricStrip metrics={[{ label: "Open tickets", value: String(d.counts.open) }, { label: "Unassigned", value: String(d.counts.unassigned) },
        { label: "Response overdue", value: String(d.counts.response_overdue) }, { label: "Resolution overdue", value: String(d.counts.resolution_overdue) },
        { label: "Urgent / high open", value: String(d.counts.urgent) }, { label: "Replies not delivered", value: String(d.failedReplies) },
        { label: "First response (30 days)", value: d.responseMinutes === null ? "—" : `${d.responseMinutes} min${d.responseMetRate !== null ? ` · ${d.responseMetRate}% on time` : ""}` },
        { label: "Created / resolved (30 days)", value: `${d.created30} / ${d.resolved30}` }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Queue view="mine" compact title="My tickets" onMore={() => onSelect("mine")} />
        <Queue view="unassigned" compact title="Unassigned" onMore={() => onSelect("unassigned")} />
        <Queue view="response_overdue" compact title="Response overdue" onMore={() => onSelect("response_overdue")} />
      </div>
      {d.counts.unmatched > 0 && <Notice tone="warning">{`${d.counts.unmatched} email ticket${d.counts.unmatched === 1 ? "" : "s"} came from a sender not matched to one customer. Link them under Unmatched Senders.`}</Notice>}
    </div>
  );
}
function Queue({ view, compact, title, onMore }: { view: string; compact?: boolean; title?: string; onMore?: () => void }) {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const q = useQuery({ queryKey: useKey("list", view, search, priority), queryFn: () => deskApi.list(view, search, priority), retry: false });
  if (q.isLoading) return <LoadingState label="Loading tickets" rows={compact ? 2 : 4} />;
  if (q.isError) return <Denied error={q.error} what="support tickets" />;
  const rows = q.data!.rows;
  if (compact) return (
    <Panel title={title ?? ""} actions={rows.length > 5 && onMore ? <Button size="compact" variant="ghost" onPress={onMore}>{`All ${rows.length}`}</Button> : undefined}>
      {rows.length ? <ul className="flex flex-col gap-2 text-sm">{rows.slice(0, 5).map((r) => <li key={r.id}><Link className="font-medium text-brand hover:underline" href={`${SUPPORT_BASE}/tickets/${r.id}`}>{r.number}</Link>
        <span className="block text-xs text-text-muted">{[r.subject, r.customer?.name ?? r.customerEmail, r.priorityLabel].filter(Boolean).join(" · ")}</span></li>)}</ul>
        : <p className="text-sm text-text-muted">Nothing here.</p>}
    </Panel>);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={setSearch} description="Ticket, subject, customer or email" />
        <Select label="Priority" selectedKey={priority || "any"} onSelectionChange={(k) => setPriority(k === "any" ? "" : String(k))}
          options={[{ value: "any", label: "Any" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }]} />
      </div>
      <TicketTable rows={rows} />
    </div>
  );
}
function TicketTable({ rows }: { rows: TicketRow[] }) {
  return (
    <LinesTable columns={["Ticket", "Customer", "Priority", "Agent", "Response", "Resolution", "Status"]} empty={rows.length ? undefined : "No tickets here."}>
      {rows.map((r) => <tr key={r.id}>
        <Cell><Link className="font-medium text-brand hover:underline" href={`${SUPPORT_BASE}/tickets/${r.id}`}>{r.number}</Link><span className="block text-xs text-text-muted">{r.subject}</span></Cell>
        <Cell>{r.customer?.name ?? r.customerName ?? "—"}<span className="block text-xs text-text-muted">{r.customerEmail ?? ""}{r.unmatched ? " · unmatched sender" : ""}</span></Cell>
        <Cell><StatusBadge tone={PRIORITY_TONE[r.priority] ?? "neutral"}>{r.priorityLabel}</StatusBadge></Cell><Cell>{r.agent?.name ?? "Unassigned"}</Cell>
        <Cell>{clock(r.response, r.responseDue)}</Cell><Cell>{clock(r.resolution, r.resolutionDue)}</Cell>
        <Cell><StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>{r.reopened > 0 && <span className="block text-xs text-text-muted">{`Reopened ${r.reopened}×`}</span>}</Cell>
      </tr>)}
    </LinesTable>
  );
}
function Reports() {
  const options = useOptions();
  const [kind, setKind] = useState("register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: useKey("report", kind, from, to), queryFn: () => deskApi.report(kind, from, to), retry: false });
  const columns = q.data ? [...new Set(q.data.rows.flatMap((r) => Object.keys(r)))] : [];
  const show = (v: unknown, c: string) => (v === null || v === undefined || v === "" ? "—" : /(_at|^due)$/.test(c) ? formatDateTime(String(v)) : String(v));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Report" selectedKey={kind} onSelectionChange={(k) => setKind(String(k))} options={options.data?.reports ?? [{ value: "register", label: "Ticket register" }]} />
        <TextField label="From" type="date" value={from} onChange={setFrom} /><TextField label="To" type="date" value={to} onChange={setTo} />
        <a className="self-center text-sm text-brand hover:underline" href={deskApi.csvHref(kind, from, to)}>Export CSV</a>
      </div>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={3} /> : q.isError ? <Denied error={q.error} what="this report" /> : (
        <LinesTable columns={columns.map((c) => c.replace(/_/g, " "))} empty={q.data!.rows.length ? undefined : "Nothing to report."}>
          {q.data!.rows.map((r, i) => <tr key={i}>{columns.map((c) => <Cell key={c}>{show(r[c], c)}</Cell>)}</tr>)}
        </LinesTable>)}
    </div>
  );
}

// ------------------------------------------------------------------ one ticket
const TABS = [{ id: "conversation", label: "Conversation" }, { id: "details", label: "Details" }, { id: "files", label: "Files" }, { id: "history", label: "History" }];
type Run = (action: string, body?: Record<string, unknown>) => Promise<unknown>;
export function TicketDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const refresh = useRefresh();
  const [tab, setTab] = useState(params.get("tab") ?? "conversation");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const q = useQuery({ queryKey: useKey("detail", id), queryFn: () => deskApi.get(id), retry: false, refetchInterval: (query) => (query.state.data?.messages.some((m) => m.delivery === "QUEUED") ? 5000 : false) });
  const options = useOptions(Boolean(q.data));
  if (q.isLoading) return <LoadingState label="Loading the ticket" rows={5} />;
  if (q.isError) return <Denied error={q.error} what="this ticket" />;
  const d = q.data!;
  const o = options.data;
  const go = (next: string) => { setTab(next); router.replace(`${pathname}?tab=${next}`, { scroll: false }); };
  const run: Run = async (action, body = {}) => {
    setFailure(null);
    try { const r = await deskApi.action(id, action, { version: d.rowVersion, ...body }); await refresh(); return r; }
    catch (error) { setFailure(errorMessage(error)); await refresh(); throw error; }
  };
  const actions: ReactNode[] = [];
  if (d.can.assign && o) actions.push(<Button key="assign" variant="secondary" onPress={() => setAsk({ title: d.agent ? "Reassign" : "Assign an agent", confirm: "Save",
    fields: [{ name: "userId", label: "Agent", kind: "select", required: true, initial: d.agent?.id ?? "", options: o.agents }, { name: "reason", label: "Reason", kind: "text" }],
    run: async (v) => { await run("assign", v); } })}>{d.agent ? "Reassign" : "Assign"}</Button>);
  if (d.can.status) for (const [to, label] of [["pending_customer", "Waiting on customer"], ["pending_internal", "Waiting on internal team"], ["open", "Back to open"]] as const)
    if (d.status !== to) actions.push(<Button key={to} variant="ghost" onPress={() => { run("status", { status: to }).catch(() => undefined); }}>{label}</Button>);
  if (d.can.resolve) actions.push(<Button key="resolve" variant="primary" onPress={() => setAsk({ title: "Resolve the ticket", confirm: "Resolve",
    fields: [{ name: "resolutionSummary", label: "Resolution", kind: "textarea", required: true }, { name: "resolutionCode", label: "Resolution code", kind: "text" }],
    run: async (v) => { await run("resolve", v); } })}>Resolve</Button>);
  if (d.can.close) actions.push(<Button key="close" variant="primary" onPress={() => { run("close").catch(() => undefined); }}>Close</Button>);
  if (d.can.reopen) actions.push(<Button key="reopen" variant="secondary" onPress={() => setAsk({ title: "Reopen the ticket", confirm: "Reopen",
    fields: [{ name: "reason", label: "Why is it reopened?", kind: "textarea", required: true }], run: async (v) => { await run("reopen", v); } })}>Reopen</Button>);
  if (d.can.cancel) actions.push(<Button key="cancel" variant="danger" onPress={() => setAsk({ title: "Cancel the ticket", confirm: "Cancel ticket", tone: "danger",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await run("cancel", v); } })}>Cancel</Button>);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${d.number} · ${d.subject}`} description={[d.customer?.name ?? d.customerName, d.customerPhone, d.customerEmail, d.contact?.name, d.mailbox ? `via ${d.mailbox.address}` : null].filter(Boolean).join(" · ")} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.statusLabel}</StatusBadge><StatusBadge tone={PRIORITY_TONE[d.priority] ?? "neutral"}>{d.priorityLabel}</StatusBadge>
        <span className="text-sm text-text-muted">Response</span>{clock(d.response, d.responseDue)}<span className="text-sm text-text-muted">Resolution</span>{clock(d.resolution, d.resolutionDue)}
        {d.followUpOf && <Link className="text-sm text-brand hover:underline" href={`${SUPPORT_BASE}/tickets/${d.followUpOf.id}`}>{`Follow-up of ${d.followUpOf.number}`}</Link>}
        <span className="ml-auto flex flex-wrap gap-2">{actions}</span>
      </div>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {d.unmatched && <UnmatchedNotice d={d} o={o} run={run} ask={setAsk} />}
      {d.status === "resolved" && <Notice tone="success">{`Resolved: ${d.resolutionSummary ?? ""}`}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => go(String(k))}>
        <TabList aria-label="Ticket sections">{TABS.map((t) => <Tab key={t.id} id={t.id}>{t.id === "files" ? `Files (${d.files.length})` : t.label}</Tab>)}</TabList>
      </Tabs>
      {tab === "conversation" && <Conversation d={d} o={o} run={run} />}
      {tab === "details" && <Details d={d} o={o} run={run} ask={setAsk} />}
      {tab === "files" && <Files d={d} />}
      {tab === "history" && <History d={d} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function UnmatchedNotice({ d, o, run, ask }: { d: TicketDetail; o?: Options; run: Run; ask: (a: Ask) => void }) {
  return (
    <Notice tone="warning"><span className="flex flex-wrap items-center gap-2">{`${d.customerEmail ?? "The sender"} isn't matched to exactly one customer${d.candidates.length ? ` (possible: ${d.candidates.map((x) => x.customer ?? x.contact).filter(Boolean).join(", ")})` : ""}. Link the right customer before relying on its records.`}
      {d.can.link && o && <Button size="compact" variant="secondary" onPress={() => ask({ title: "Link the customer", confirm: "Link", fields: [{ name: "customerId", label: "Customer", kind: "select", required: true, options: o.customers }],
        run: async (v) => { await run("link-customer", v); } })}>Link customer</Button>}</span></Notice>
  );
}
function Conversation({ d, o, run }: { d: TicketDetail; o?: Options; run: Run }) {
  const [mode, setMode] = useState<"reply" | "note">(d.can.reply ? "reply" : "note");
  const [body, setBody] = useState("");
  const [mailboxId, setMailboxId] = useState(d.mailbox?.id ?? "");
  const [wait, setWait] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const send = async () => {
    setBusy(true);
    try {
      if (mode === "reply") await run("reply", { body, mailboxId: mailboxId || undefined, waitForCustomer: wait, idempotencyKey: key });
      else await run("note", { body });
      setBody(""); setKey(newKey());
    } catch { /* shown above */ } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        <li className="rounded-md border border-border p-3"><span className="text-xs text-text-muted">{`${d.source === "EMAIL" ? "Email" : "Raised by hand"} · ${formatDateTime(d.createdAt)}`}</span>
          <p className="whitespace-pre-wrap text-sm">{d.description}</p></li>
        {d.messages.map((m) => (
          <li key={m.id} className={`rounded-md border p-3 ${m.private ? "border-warning bg-surface-muted" : m.kind === "CUSTOMER" ? "border-border" : "border-brand/40"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span className="font-medium text-text-primary">{m.from ?? "—"}</span><span>{m.kindLabel}</span><span>{formatDateTime(m.at)}</span>
              {m.private && <StatusBadge tone="warning">Private — not emailed</StatusBadge>}
              {m.delivery && m.kind !== "CUSTOMER" && <StatusBadge tone={DELIVERY_TONE[m.delivery] ?? "neutral"}>{m.deliveryLabel ?? m.delivery}</StatusBadge>}
              {m.to.length > 0 && <span>{`to ${m.to.join(", ")}${m.cc.length ? `, cc ${m.cc.join(", ")}` : ""}`}</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            {m.deliveryError && <p className="mt-1 text-xs text-danger">{m.deliveryError}</p>}
            {(m.delivery === "FAILED" || m.delivery === "BOUNCED") && d.can.reply && <Button size="compact" variant="secondary" onPress={() => { run("retry-reply", { messageId: m.id }).catch(() => undefined); }}>Send again</Button>}
            {m.files.length > 0 && <p className="mt-1 flex flex-wrap gap-2 text-xs">{m.files.map((f) => <a key={f.id} className="text-brand hover:underline" href={deskApi.fileHref(d.id, f.id)}>{f.fileName}</a>)}</p>}
          </li>))}
      </ol>
      {(d.can.reply || d.can.note) && (
        <Panel title={mode === "reply" ? "Reply to the customer" : "Private note"} description={mode === "reply" ? `Emailed to ${d.customerEmail ?? "the customer"} from the support mailbox; their answer joins this ticket.` : "Visible to staff only. It is never emailed."}
          actions={<span className="flex gap-1">{d.can.reply && <Button size="compact" variant={mode === "reply" ? "primary" : "ghost"} onPress={() => setMode("reply")}>Reply</Button>}
            {d.can.note && <Button size="compact" variant={mode === "note" ? "primary" : "ghost"} onPress={() => setMode("note")}>Private note</Button>}</span>}>
          <div className="flex flex-col gap-2">
            <TextArea label={mode === "reply" ? "Message" : "Note"} value={body} onChange={setBody} maxLength={20000} />
            {mode === "reply" && <div className="flex flex-wrap items-end gap-3">
              <Select label="Send from" selectedKey={mailboxId || null} onSelectionChange={(k) => setMailboxId(String(k))} options={o?.mailboxes ?? []} />
              <Checkbox isSelected={wait} onChange={setWait}>Then wait for the customer</Checkbox></div>}
            <span><Button variant="primary" isLoading={busy} isDisabled={!body.trim()} onPress={send}>{mode === "reply" ? "Send reply" : "Add note"}</Button></span>
          </div>
        </Panel>)}
      {!d.can.reply && d.can.note && !d.customerEmail && <p className="text-xs text-text-muted">The ticket has no customer email address, so replies can&apos;t be emailed. Add one on Details.</p>}
    </div>
  );
}
function Details({ d, o, run, ask }: { d: TicketDetail; o?: Options; run: Run; ask: (a: Ask) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Ticket" actions={d.can.edit && o ? <Button size="compact" variant="secondary" onPress={() => ask({ title: "Edit the ticket", confirm: "Save",
        fields: [{ name: "subject", label: "Subject", kind: "text", required: true, initial: d.subject }, { name: "categoryId", label: "Category", kind: "select", initial: d.category?.id ?? "", options: o.categories },
          { name: "priority", label: "Priority", kind: "select", initial: d.priority, options: o.priorities }],
        run: async (v) => { await run("update", { ...v, categoryId: v.categoryId || null }); } })}>Edit</Button> : undefined}>
        <FactList items={[["Ticket", d.number], ["Subject", d.subject], ["Customer", d.customer?.name ?? "—"], ["Contact", d.contact?.name ?? "—"], ["Email", d.customerEmail ?? "—"],
          ["Phone", d.customerPhone ?? "—"], ["Category", d.category?.name ?? "—"], ["Priority", d.priorityLabel], ["Agent", d.agent?.name ?? "Unassigned"], ["Source", d.source === "EMAIL" ? "Email" : "Raised by hand"],
          ["Mailbox", d.mailbox ? `${d.mailbox.name} <${d.mailbox.address}>` : "—"], ["Created", formatDateTime(d.createdAt)]]} />
      </Panel>
      <Panel title="Deadlines" description="From the active SLA policy for the priority, else the company's targets. The clock pauses while the ticket waits for the customer.">
        <FactList items={[["First response due", d.responseDue ? formatDateTime(d.responseDue) : "—"], ["First responded", d.firstRespondedAt ? formatDateTime(d.firstRespondedAt) : "—"],
          ["Resolution due", d.resolutionDue ? formatDateTime(d.resolutionDue) : "—"], ["Resolved", d.resolvedAt ? formatDateTime(d.resolvedAt) : "—"], ["Paused", `${d.pausedMinutes} min`],
          ["Closed", d.closedAt ? formatDateTime(d.closedAt) : "—"], ["Reopened", d.reopened ? `${d.reopened}× (last ${d.reopenedAt ? formatDateTime(d.reopenedAt) : "—"})` : "Never"]]} />
      </Panel>
      {d.followUps.length > 0 && <Panel title="Follow-up tickets"><ul className="text-sm">{d.followUps.map((f) => <li key={f.id}><Link className="text-brand hover:underline" href={`${SUPPORT_BASE}/tickets/${f.id}`}>{f.number}</Link> {f.status}</li>)}</ul></Panel>}
    </div>
  );
}
function Files({ d }: { d: TicketDetail }) {
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const [isPrivate, setPrivate] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {d.can.upload && <div className="flex flex-wrap items-center gap-3"><label className="text-sm">Add a file
        <input className="mt-1 block text-sm" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.csv,.txt,.xlsx,.docx" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          try { await deskApi.upload(d.id, file, { private: isPrivate }); await refresh(); } catch (failure) { setError(errorMessage(failure)); }
          e.target.value = "";
        }} /></label><Checkbox isSelected={isPrivate} onChange={setPrivate}>Private (staff only)</Checkbox></div>}
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["File", "With", "Visibility", "Added", ""]} empty={d.files.length ? undefined : "No files."}>
        {d.files.map((f) => <tr key={f.id}><Cell><a className="text-brand hover:underline" href={deskApi.fileHref(d.id, f.id)}>{f.fileName}</a></Cell>
          <Cell>{f.messageId ? (d.messages.find((m) => m.id === f.messageId)?.kindLabel ?? "Message") : "The ticket"}</Cell><Cell>{f.private ? "Private" : "Shared"}</Cell><Cell>{formatDateTime(f.at)}</Cell>
          <Cell>{d.can.upload && !f.messageId && <Button size="compact" variant="secondary" onPress={async () => { await deskApi.removeFile(d.id, f.id).catch((x) => setError(errorMessage(x))); await refresh(); }}>Remove</Button>}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}
function History({ d }: { d: TicketDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <HistoryList entries={d.history.map((e) => ({ summary: e.label, at: e.at, actor: e.actor, detail: e.detail ? <span className="text-sm text-text-secondary">{e.detail}</span> : undefined }))} />
      <Panel title="Assignments"><LinesTable columns={["From", "To", "By", "Reason", "When"]} empty={d.assignments.length ? undefined : "Never assigned."}>
        {d.assignments.map((a, i) => <tr key={i}><Cell>{a.from ?? "—"}</Cell><Cell>{a.to ?? "Unassigned"}</Cell><Cell>{a.by ?? "—"}</Cell><Cell>{a.reason ?? "—"}</Cell><Cell>{formatDateTime(a.at)}</Cell></tr>)}
      </LinesTable></Panel>
      <Panel title="Status history"><LinesTable columns={["From", "To", "Reason", "By", "When"]}>
        {d.statuses.map((s, i) => <tr key={i}><Cell>{s.from ?? "—"}</Cell><Cell>{s.to}</Cell><Cell>{s.reason ?? "—"}</Cell><Cell>{s.actor ?? "—"}</Cell><Cell>{formatDateTime(s.at)}</Cell></tr>)}
      </LinesTable></Panel>
    </div>
  );
}

// ------------------------------------------------------------------ settings
export function SupportSettingsScreen() {
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: useKey("settings"), queryFn: deskApi.settings, retry: false });
  const options = useOptions();
  if (q.isLoading) return <LoadingState label="Loading the settings" rows={4} />;
  if (q.isError) return <Denied error={q.error} what="the Support settings" />;
  const s = q.data!;
  const o = options.data;
  const save = async (body: Record<string, unknown>) => { setError(null); try { await deskApi.save(body); await refresh(); } catch (e) { setError(errorMessage(e)); throw e; } };
  const mailboxAsk = (m?: (typeof s.mailboxes)[number]): Ask => ({ title: m ? `Edit ${m.name}` : "Connect a support mailbox", confirm: "Save",
    description: "The support address customers write to. Connect it to an inbound-mail route (Settings › Integrations) for email-to-ticket; replies go out with this address as Reply-To.",
    fields: [{ name: "name", label: "Name", kind: "text", required: true, initial: m?.name ?? "" }, { name: "address", label: "Support address", kind: "text", required: true, initial: m?.address ?? "" },
      { name: "displayName", label: "Sender name", kind: "text", initial: m?.displayName ?? "" }, { name: "inboundRouteId", label: "Inbound-mail route", kind: "select", initial: m?.routeId ?? "", options: o?.routes ?? [] },
      { name: "defaultCategoryId", label: "Default category", kind: "select", initial: m?.categoryId ?? "", options: o?.categories ?? [] },
      { name: "defaultPriority", label: "Default priority", kind: "select", initial: m?.priority ?? "normal", options: o?.priorities ?? [] },
      { name: "defaultAgentUserId", label: "Default agent", kind: "select", initial: m?.agentId ?? "", options: o?.agents ?? [] },
      { name: "autoAcknowledge", label: "Acknowledge new email tickets", kind: "checkbox", initial: m?.autoAcknowledge ?? true },
      { name: "replyReopensResolved", label: "A customer's reply reopens a resolved ticket (within the reopen window)", kind: "checkbox", initial: m?.replyReopensResolved ?? true },
      { name: "blockedSenders", label: "Blocked senders (comma separated)", kind: "textarea", initial: m?.blockedSenders.join(", ") ?? "" },
      { name: "blockedDomains", label: "Blocked domains (comma separated)", kind: "textarea", initial: m?.blockedDomains.join(", ") ?? "" },
      { name: "signature", label: "Signature on replies", kind: "textarea", initial: m?.signature ?? "" }, { name: "disabled", label: "Disabled", kind: "checkbox", initial: m?.status === "disabled" }],
    run: async (v) => { await save({ what: "mailbox", id: m?.id, ...v, inboundRouteId: v.inboundRouteId || null, defaultCategoryId: v.defaultCategoryId || null, defaultAgentUserId: v.defaultAgentUserId || null,
      status: v.disabled ? "disabled" : "active" }); } });
  const targetsAsk = (): Ask => ({ title: "Response and resolution targets", confirm: "Save", description: "Minutes, by priority. An active SLA policy for a priority takes precedence.",
    fields: [...Object.entries(s.settings.targets).flatMap(([p, t]) => [{ name: `${p}.response`, label: `${p}: first response (minutes)`, kind: "quantity" as const, required: true, initial: String(t.response) },
      { name: `${p}.resolution`, label: `${p}: resolution (minutes)`, kind: "quantity" as const, required: true, initial: String(t.resolution) }]),
      { name: "reopenWindowDays", label: "Reopen window (days)", kind: "quantity", required: true, initial: String(s.settings.reopenWindowDays) },
      { name: "reopenOnCustomerReply", label: "A customer's reply may reopen a resolved ticket", kind: "checkbox", initial: s.settings.reopenOnCustomerReply }],
    run: async (v) => {
      const targets = Object.fromEntries(Object.keys(s.settings.targets).map((p) => [p, { response: Number(v[`${p}.response`]), resolution: Number(v[`${p}.resolution`]) }]));
      await save({ what: "settings", targets, reopenWindowDays: Number(v.reopenWindowDays), reopenOnCustomerReply: v.reopenOnCustomerReply, defaultPriority: s.settings.defaultPriority });
    } });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Support Settings" description="Support mailboxes and their spam controls, the response and resolution targets, the reopening policy and the issue categories." />
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Support mailboxes" actions={o?.can.mailboxes ? <Button size="compact" variant="primary" onPress={() => setAsk(mailboxAsk())}>Connect mailbox</Button> : undefined}>
        <LinesTable columns={["Mailbox", "Inbound route", "Defaults", "Acknowledge", "Blocked", "Status", ""]} empty={s.mailboxes.length ? undefined : "No support mailbox yet: replies can't be emailed until one is connected."}>
          {s.mailboxes.map((m) => <tr key={m.id}><Cell>{m.name}<span className="block text-xs text-text-muted">{m.address}</span></Cell><Cell>{m.route ? `${m.route.name} (${m.route.status})` : "Not connected"}</Cell>
            <Cell>{[m.category, m.priority, m.agent].filter(Boolean).join(" · ") || "—"}</Cell><Cell>{m.autoAcknowledge ? "Yes" : "No"}</Cell><Cell>{m.blockedSenders.length + m.blockedDomains.length}</Cell>
            <Cell>{m.status}</Cell><Cell>{o?.can.mailboxes && <Button size="compact" variant="secondary" onPress={() => setAsk(mailboxAsk(m))}>Edit</Button>}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <Panel title="Targets and reopening" actions={o?.can.settings ? <Button size="compact" variant="secondary" onPress={() => setAsk(targetsAsk())}>Edit</Button> : undefined}>
        <FactList items={[...Object.entries(s.settings.targets).map(([p, t]) => [p, `First response ${t.response} min · resolution ${t.resolution} min`] as [string, ReactNode]),
          ["Reopen window", `${s.settings.reopenWindowDays} days`], ["Customer's reply reopens a resolved ticket", s.settings.reopenOnCustomerReply ? "Yes" : "No — a follow-up ticket is opened"]]} />
      </Panel>
      <Panel title="Categories" actions={o?.can.settings ? <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Add a category", confirm: "Add",
        fields: [{ name: "code", label: "Code", kind: "text", required: true }, { name: "name", label: "Name", kind: "text", required: true },
          { name: "defaultPriority", label: "Default priority", kind: "select", initial: "normal", options: o.priorities }], run: async (v) => { await save({ what: "category", ...v }); } })}>Add category</Button> : undefined}>
        <LinesTable columns={["Code", "Name", "Default priority", "Active"]} empty={s.categories.length ? undefined : "No categories."}>
          {s.categories.map((x) => <tr key={x.id}><Cell>{x.code}</Cell><Cell>{x.name}</Cell><Cell>{x.defaultPriority}</Cell><Cell>{x.active ? "Yes" : "No"}</Cell></tr>)}
        </LinesTable>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
