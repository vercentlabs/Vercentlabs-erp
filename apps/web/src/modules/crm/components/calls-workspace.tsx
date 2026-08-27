"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";

type Option = { id: string; name: string; companyId?: string | null; partyId?: string | null };
type Options = Record<string, Option[]>;

type CallRow = {
  id: string;
  subject: string;
  description?: string | null;
  status: "planned" | "overdue" | "in_progress" | "completed" | "cancelled";
  priority: string;
  assignedTo?: string | null;
  assignedName?: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId?: string | null;
  direction?: "inbound" | "outbound" | null;
  phoneNumber?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  reminderAt?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  durationSeconds?: number | null;
  outcomeCode?: string | null;
  outcome?: string | null;
  updatedAt: string;
};

type CallEvent = {
  id: string;
  eventType: string;
  previousStatus?: string | null;
  nextStatus?: string | null;
  direction?: string | null;
  outcomeCode?: string | null;
  durationSeconds?: number | null;
  changedByName?: string | null;
  changedAt: string;
};

const OUTCOMES = [
  ["connected", "Connected"],
  ["no_answer", "No answer"],
  ["busy", "Busy"],
  ["voicemail", "Voicemail"],
  ["callback_requested", "Callback requested"],
  ["wrong_number", "Wrong number"],
  ["failed", "Failed"],
] as const;

const RELATION_OPTIONS: Record<CallRow["entityType"], string | null> = {
  lead: "leads",
  opportunity: "opportunities",
  party: "parties",
  contact: "contacts",
  campaign: "campaigns",
  general: null,
};

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function duration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function label(value?: string | null) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CallsWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  direction,
  due,
  options,
  canManage,
  startCreating = false,
}: {
  rows: CallRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  direction: string;
  due: string;
  options: Options;
  canManage: boolean;
  startCreating?: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ mode: "schedule" | "log" | "edit"; record?: CallRow } | null>(
    startCreating && canManage ? { mode: "schedule" } : null,
  );
  const [completion, setCompletion] = useState<CallRow | null>(null);
  const [eventsFor, setEventsFor] = useState<CallRow | null>(null);
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [relationType, setRelationType] = useState<CallRow["entityType"]>("lead");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const relationChoices = useMemo(() => {
    const key = RELATION_OPTIONS[relationType];
    return key ? options[key] || [] : [];
  }, [options, relationType]);

  function openEditor(mode: "schedule" | "log" | "edit", record?: CallRow) {
    setMessage("");
    setRelationType(record?.entityType || "lead");
    setEditor({ mode, record });
  }

  function queryHref(nextPage: number) {
    const query = new URLSearchParams();
    query.set("activityType", "call");
    if (due !== "all") query.set("due", due);
    if (search) query.set("search", search);
    if (status !== "all") query.set("status", status);
    if (direction !== "all") query.set("direction", direction);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/crm/activities?${query.toString()}`;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const mode = editor.mode;
    const record = editor.record;
    const entityType = String(form.get("entityType") || "general");
    const body: Record<string, unknown> = {
      subject: String(form.get("subject") || ""),
      description: String(form.get("description") || "").trim() || null,
      entityType,
      entityId: entityType === "general" ? null : String(form.get("entityId") || "").trim() || null,
      direction: String(form.get("direction") || "outbound"),
      phoneNumber: String(form.get("phoneNumber") || "").trim() || null,
      assignedTo: String(form.get("assignedTo") || "").trim() || null,
      priority: String(form.get("priority") || "medium"),
    };
    if (mode === "schedule" || mode === "edit") {
      body.startAt = String(form.get("startAt") || "").trim() || null;
      body.dueAt = String(form.get("dueAt") || "").trim() || null;
      body.reminderAt = String(form.get("reminderAt") || "").trim() || null;
    }
    if (mode === "schedule") body.mode = "schedule";
    if (mode === "log") {
      body.mode = "log";
      body.occurredAt = String(form.get("occurredAt") || "").trim() || new Date().toISOString();
      body.durationSeconds = Number(form.get("durationSeconds") || 0);
      body.outcomeCode = String(form.get("outcomeCode") || "");
      body.outcome = String(form.get("outcome") || "").trim() || null;
    }
    if (mode === "edit" && record) {
      body.expectedUpdatedAt = record.updatedAt;
      body.expectedStatus = record.status;
    }

    setBusy("save");
    setMessage("");
    const result = await requestJson(
      mode === "edit" && record ? `/api/crm/calls/${record.id}` : "/api/crm/calls",
      {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setBusy("");
    setMessage(result.message || (result.ok ? "Call saved." : "Call could not be saved."));
    if (result.ok) {
      setEditor(null);
      router.refresh();
    }
  }

  async function lifecycle(record: CallRow, action: "start" | "cancel") {
    if (action === "cancel" && !confirm(`Cancel ${record.subject}?`)) return;
    setBusy(`${action}:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/calls/${record.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? `Call ${action}ed.` : `Call could not be ${action}ed.`));
    if (result.ok) router.refresh();
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completion) return;
    const form = new FormData(event.currentTarget);
    setBusy(`complete:${completion.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/calls/${completion.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcomeCode: String(form.get("outcomeCode") || ""),
        outcome: String(form.get("outcome") || "").trim() || null,
        expectedUpdatedAt: completion.updatedAt,
        expectedStatus: completion.status,
      }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Call completed." : "Call could not be completed."));
    if (result.ok) {
      setCompletion(null);
      router.refresh();
    }
  }

  async function showEvents(record: CallRow) {
    setBusy(`events:${record.id}`);
    setMessage("");
    const result = await requestJson<{ events?: CallEvent[] }>(`/api/crm/calls/${record.id}`);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message || "Call history could not be loaded.");
      return;
    }
    setEvents(Array.isArray(result.events) ? result.events : []);
    setEventsFor(record);
  }

  return (
    <section className="crm-calls-workspace" aria-label="Calls workspace">
      <div className="crm-calls-toolbar">
        <form method="get" className="crm-calls-filters">
          <input type="hidden" name="activityType" value="call" />
          {due !== "all" ? <input type="hidden" name="due" value={due} /> : null}
          <label><span>Search Calls</span><input name="search" defaultValue={search} placeholder="Subject, notes or phone" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="all">All statuses</option>{["planned", "overdue", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label><span>Direction</span><select name="direction" defaultValue={direction}><option value="all">Any direction</option><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
          <button className="secondary-button" type="submit">Apply</button>
        </form>
        {canManage ? <div className="crm-calls-create-actions"><button className="primary-button" type="button" onClick={() => openEditor("schedule")}>Schedule Call</button><button className="secondary-button" type="button" onClick={() => openEditor("log")}>Log completed Call</button></div> : null}
      </div>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div className="crm-calls-summary"><strong>{total}</strong><span>matching Call{total === 1 ? "" : "s"}</span><span>Manual call logging only · no telephony/recording provider is implied.</span></div>

      <div className="crm-calls-list">
        {rows.length ? rows.map((record) => (
          <article key={record.id} className="crm-call-row">
            <div className="crm-call-row__main">
              <div className="crm-call-row__title"><strong>{record.subject}</strong><span className={`status-badge ${record.status === "completed" ? "success" : record.status === "cancelled" ? "danger" : "neutral"}`}>{label(record.status)}</span></div>
              <p>{label(record.direction)} · {record.phoneNumber || "No phone snapshot"} · {record.assignedName || "Unassigned"}</p>
              <small>{record.status === "completed" ? `Completed ${formatDate(record.actualEndedAt || record.dueAt)} · ${duration(record.durationSeconds)} · ${label(record.outcomeCode)}` : `Due ${formatDate(record.dueAt)} · ${label(record.priority)} priority`}</small>
            </div>
            <div className="crm-call-row__actions">
              {record.phoneNumber ? <a className="secondary-button" href={`tel:${record.phoneNumber}`}>Dial</a> : null}
              <button className="link-button" type="button" disabled={busy === `events:${record.id}`} onClick={() => void showEvents(record)}>History</button>
              {canManage && ["planned", "overdue"].includes(record.status) ? <button className="secondary-button" type="button" onClick={() => openEditor("edit", record)}>Edit</button> : null}
              {canManage && ["planned", "overdue"].includes(record.status) ? <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void lifecycle(record, "start")}>Start</button> : null}
              {canManage && !["completed", "cancelled"].includes(record.status) ? <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => setCompletion(record)}>Complete</button> : null}
              {canManage && !["completed", "cancelled"].includes(record.status) ? <button className="link-button" type="button" disabled={Boolean(busy)} onClick={() => void lifecycle(record, "cancel")}>Cancel</button> : null}
            </div>
          </article>
        )) : <div className="empty-state"><strong>No Calls match this view</strong><p>Schedule a Call, log a completed Call, or change the current filters.</p></div>}
      </div>

      {totalPages > 1 ? <nav className="crm-calls-pagination" aria-label="Call pages"><button className="secondary-button" disabled={page <= 1} onClick={() => router.push(queryHref(page - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary-button" disabled={page >= totalPages} onClick={() => router.push(queryHref(page + 1))}>Next</button></nav> : null}

      {editor ? (
        <div className="crm-call-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditor(null); }}>
          <section className="crm-call-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-call-editor-title">
            <div className="crm-call-dialog__heading"><div><p className="eyebrow">F013 · Calls</p><h2 id="crm-call-editor-title">{editor.mode === "edit" ? "Edit scheduled Call" : editor.mode === "log" ? "Log completed Call" : "Schedule Call"}</h2></div><button className="icon-button" aria-label="Close Call editor" disabled={Boolean(busy)} onClick={() => setEditor(null)}>×</button></div>
            <CallForm editor={editor} options={options} relationType={relationType} setRelationType={setRelationType} relationChoices={relationChoices} onSubmit={save} busy={busy === "save"} />
          </section>
        </div>
      ) : null}

      {completion ? (
        <div className="crm-call-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCompletion(null); }}>
          <section className="crm-call-dialog crm-call-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="crm-call-complete-title">
            <div className="crm-call-dialog__heading"><div><p className="eyebrow">Complete Call</p><h2 id="crm-call-complete-title">{completion.subject}</h2></div><button className="icon-button" aria-label="Close completion dialog" onClick={() => setCompletion(null)}>×</button></div>
            <form onSubmit={complete} className="crm-call-form"><label><span>Outcome</span><select name="outcomeCode" required defaultValue="connected">{OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className="crm-call-form__wide"><span>Outcome note</span><textarea name="outcome" maxLength={4000} rows={4} placeholder="Optional call notes" /></label><div className="crm-call-form__actions"><button className="secondary-button" type="button" onClick={() => setCompletion(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy === `complete:${completion.id}`}>{busy === `complete:${completion.id}` ? "Completing…" : "Complete Call"}</button></div></form>
          </section>
        </div>
      ) : null}

      {eventsFor ? (
        <div className="crm-call-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventsFor(null); }}>
          <section className="crm-call-dialog crm-call-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="crm-call-history-title"><div className="crm-call-dialog__heading"><div><p className="eyebrow">Immutable evidence</p><h2 id="crm-call-history-title">Call history</h2></div><button className="icon-button" aria-label="Close Call history" onClick={() => setEventsFor(null)}>×</button></div><div className="crm-call-history">{events.length ? events.map((entry) => <article key={entry.id}><strong>{label(entry.eventType)}</strong><span>{entry.previousStatus ? `${label(entry.previousStatus)} → ${label(entry.nextStatus)}` : label(entry.nextStatus)}</span><small>{entry.changedByName || "System"} · {formatDate(entry.changedAt)}{entry.outcomeCode ? ` · ${label(entry.outcomeCode)}` : ""}</small></article>) : <p>No Call events were recorded.</p>}</div></section>
        </div>
      ) : null}
    </section>
  );
}

function CallForm({ editor, options, relationType, setRelationType, relationChoices, onSubmit, busy }: {
  editor: { mode: "schedule" | "log" | "edit"; record?: CallRow };
  options: Options;
  relationType: CallRow["entityType"];
  setRelationType: (value: CallRow["entityType"]) => void;
  relationChoices: Option[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const record = editor.record;
  const logMode = editor.mode === "log";
  return (
    <form onSubmit={onSubmit} className="crm-call-form">
      <label className="crm-call-form__wide"><span>Subject</span><input name="subject" maxLength={300} required defaultValue={record?.subject || ""} /></label>
      <label><span>Direction</span><select name="direction" required defaultValue={record?.direction || "outbound"}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
      <label><span>Phone number</span><input name="phoneNumber" inputMode="tel" maxLength={40} defaultValue={record?.phoneNumber || ""} placeholder="Auto-resolves from related record when blank" /></label>
      <label><span>Related record type</span><select name="entityType" value={relationType} onChange={(event) => setRelationType(event.target.value as CallRow["entityType"])}>{["lead", "opportunity", "party", "contact", "campaign", "general"].map((value) => <option key={value} value={value}>{value === "party" ? "Account" : label(value)}</option>)}</select></label>
      <label><span>Related record</span><select name="entityId" disabled={relationType === "general"} required={relationType !== "general"} defaultValue={record?.entityType === relationType ? record.entityId || "" : ""}><option value="">{relationType === "general" ? "No related record" : "Select record"}</option>{relationChoices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label><span>Assigned to</span><select name="assignedTo" defaultValue={record?.assignedTo || ""}><option value="">Me</option>{(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label><span>Priority</span><select name="priority" defaultValue={record?.priority || "medium"}>{["low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      {logMode ? <><label><span>Occurred at</span><input name="occurredAt" type="datetime-local" defaultValue={localDateTime(new Date().toISOString())} required /></label><label><span>Duration (seconds)</span><input name="durationSeconds" type="number" min={0} max={86400} step={1} defaultValue={0} required /></label><label><span>Outcome</span><select name="outcomeCode" required defaultValue="connected">{OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></> : <><label><span>Start</span><input name="startAt" type="datetime-local" defaultValue={localDateTime(record?.startAt)} /></label><label><span>Due</span><input name="dueAt" type="datetime-local" required defaultValue={localDateTime(record?.dueAt)} /></label><label><span>Reminder</span><input name="reminderAt" type="datetime-local" defaultValue={localDateTime(record?.reminderAt)} /></label></>}
      <label className="crm-call-form__wide"><span>{logMode ? "Outcome note" : "Notes"}</span><textarea name={logMode ? "outcome" : "description"} maxLength={4000} rows={4} defaultValue={logMode ? "" : record?.description || ""} /></label>
      <div className="crm-call-form__actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : editor.mode === "log" ? "Log Call" : editor.mode === "edit" ? "Save changes" : "Schedule Call"}</button></div>
    </form>
  );
}
