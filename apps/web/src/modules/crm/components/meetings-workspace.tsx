"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  ActionLink,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

type Option = { id: string; name: string; companyId?: string | null; partyId?: string | null; email?: string | null };
type Options = Record<string, Option[]>;

type MeetingRow = {
  id: string;
  subject: string;
  description?: string | null;
  status: "planned" | "overdue" | "in_progress" | "completed" | "cancelled";
  priority: string;
  assignedTo?: string | null;
  assignedName?: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  locationType?: "in_person" | "online" | "phone" | "other" | null;
  location?: string | null;
  meetingUrl?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  durationSeconds?: number | null;
  outcomeCode?: "held" | "no_show" | null;
  outcome?: string | null;
  attendeeCount?: number | null;
  attendees?: Array<{ contactId?: string | null; email?: string | null; name?: string | null; responseStatus?: string | null }>;
  bookingId?: string | null;
  updatedAt: string;
};

type MeetingEvent = {
  id: string;
  eventType: string;
  previousStatus?: string | null;
  nextStatus?: string | null;
  locationType?: string | null;
  outcomeCode?: string | null;
  durationSeconds?: number | null;
  attendeeCount?: number | null;
  changedByName?: string | null;
  changedAt: string;
};

const OUTCOMES = [["held", "Held"], ["no_show", "No show"]] as const;
const RELATION_OPTIONS: Record<MeetingRow["entityType"], string | null> = {
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
function parseGuestEmails(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export default function MeetingsWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  due,
  options,
  canManage,
  startCreating = false,
}: {
  rows: MeetingRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  due: string;
  options: Options;
  canManage: boolean;
  startCreating?: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ mode: "schedule" | "log" | "edit"; record?: MeetingRow } | null>(
    startCreating && canManage ? { mode: "schedule" } : null,
  );
  const [completion, setCompletion] = useState<MeetingRow | null>(null);
  const [eventsFor, setEventsFor] = useState<MeetingRow | null>(null);
  const [events, setEvents] = useState<MeetingEvent[]>([]);
  const [relationType, setRelationType] = useState<MeetingRow["entityType"]>("lead");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const relationChoices = useMemo(() => {
    const key = RELATION_OPTIONS[relationType];
    return key ? options[key] || [] : [];
  }, [options, relationType]);

  function openEditor(mode: "schedule" | "log" | "edit", record?: MeetingRow) {
    setMessage("");
    setRelationType(record?.entityType || "lead");
    setEditor({ mode, record });
  }

  function queryHref(nextPage: number) {
    const query = new URLSearchParams();
    query.set("activityType", "meeting");
    if (due !== "all") query.set("due", due);
    if (search) query.set("search", search);
    if (status !== "all") query.set("status", status);
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
    const attendees = [
      ...form.getAll("attendeeContactId").map((value) => ({ contactId: String(value) })).filter((entry) => entry.contactId),
      ...parseGuestEmails(String(form.get("guestEmails") || "")).map((email) => ({ email })),
    ];
    const body: Record<string, unknown> = {
      subject: String(form.get("subject") || ""),
      description: String(form.get("description") || "").trim() || null,
      entityType,
      entityId: entityType === "general" ? null : String(form.get("entityId") || "").trim() || null,
      assignedTo: String(form.get("assignedTo") || "").trim() || null,
      priority: String(form.get("priority") || "medium"),
      locationType: String(form.get("locationType") || "other"),
      location: String(form.get("location") || "").trim() || null,
      meetingUrl: String(form.get("meetingUrl") || "").trim() || null,
      attendees,
    };
    if (mode === "schedule" || mode === "edit") {
      body.startAt = String(form.get("startAt") || "").trim() || null;
      body.endAt = String(form.get("endAt") || "").trim() || null;
    }
    if (mode === "schedule") body.mode = "schedule";
    if (mode === "log") {
      body.mode = "log";
      body.occurredAt = String(form.get("occurredAt") || "").trim() || new Date().toISOString();
      body.durationMinutes = Number(form.get("durationMinutes") || 0);
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
      mode === "edit" && record ? `/api/crm/meetings/${record.id}` : "/api/crm/meetings",
      {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setBusy("");
    setMessage(result.message || (result.ok ? "Meeting saved." : "Meeting could not be saved."));
    if (result.ok) {
      setEditor(null);
      router.refresh();
    }
  }

  async function lifecycle(record: MeetingRow, action: "start" | "cancel") {
    if (action === "cancel" && !confirm(`Cancel ${record.subject}?`)) return;
    setBusy(`${action}:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/meetings/${record.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? `Meeting ${action}ed.` : `Meeting could not be ${action}ed.`));
    if (result.ok) router.refresh();
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completion) return;
    const form = new FormData(event.currentTarget);
    setBusy(`complete:${completion.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/meetings/${completion.id}/complete`, {
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
    setMessage(result.message || (result.ok ? "Meeting completed." : "Meeting could not be completed."));
    if (result.ok) {
      setCompletion(null);
      router.refresh();
    }
  }

  async function showEvents(record: MeetingRow) {
    setBusy(`events:${record.id}`);
    setMessage("");
    const result = await requestJson<{ events?: MeetingEvent[] }>(`/api/crm/meetings/${record.id}`);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message || "Meeting history could not be loaded.");
      return;
    }
    setEvents(Array.isArray(result.events) ? result.events : []);
    setEventsFor(record);
  }

  return (
    <section className="crm-meetings-workspace" aria-label="Meetings workspace">
      <div className="crm-meetings-toolbar">
        <form method="get" className="crm-meetings-filters">
          <input type="hidden" name="activityType" value="meeting" />
          {due !== "all" ? <input type="hidden" name="due" value={due} /> : null}
          <label><span>Search Meetings</span><input name="search" defaultValue={search} placeholder="Subject, notes or location" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="all">All statuses</option>{["planned", "overdue", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <button className="secondary-button" type="submit">Apply</button>
        </form>
        {canManage ? <div className="crm-meetings-create-actions"><ActionButton tone="primary" type="button" onClick={() => openEditor("schedule")}>Schedule Meeting</ActionButton><ActionButton type="button" onClick={() => openEditor("log")}>Log completed Meeting</ActionButton></div> : null}
      </div>

      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className="crm-meetings-summary"><strong>{total}</strong><span>matching Meeting{total === 1 ? "" : "s"}</span><span>Manual Meetings and public bookings share the same governed CRM work queue.</span></div>

      {(() => {
        const statusTone = (record: MeetingRow) =>
          record.status === "completed"
            ? "success"
            : record.status === "cancelled"
              ? "danger"
              : "neutral";
        const actions = (record: MeetingRow) => (
          <>
            {record.meetingUrl ? (
              <ActionLink href={record.meetingUrl} target="_blank" rel="noreferrer">
                Join
              </ActionLink>
            ) : null}
            <ActionButton
              tone="quiet"
              type="button"
              disabled={busy === `events:${record.id}`}
              onClick={() => void showEvents(record)}
            >
              History
            </ActionButton>
            {canManage && !record.bookingId && ["planned", "overdue"].includes(record.status) ? (
              <ActionButton type="button" onClick={() => openEditor("edit", record)}>
                Edit
              </ActionButton>
            ) : null}
            {canManage && ["planned", "overdue"].includes(record.status) ? (
              <ActionButton
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void lifecycle(record, "start")}
              >
                Start
              </ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton
                tone="primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setCompletion(record)}
              >
                Complete
              </ActionButton>
            ) : null}
            {canManage && !record.bookingId && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton
                tone="quiet"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void lifecycle(record, "cancel")}
              >
                Cancel
              </ActionButton>
            ) : null}
          </>
        );
        const detail = (record: MeetingRow) => (
          <>
            <p>
              {label(record.locationType)} ·{" "}
              {record.location || (record.meetingUrl ? "Online" : "No location")} ·{" "}
              {record.assignedName || "Unassigned"} · {record.attendeeCount || 0} attendee
              {record.attendeeCount === 1 ? "" : "s"}
            </p>
            <small>
              {record.status === "completed"
                ? `Completed ${formatDate(record.actualEndedAt || record.endAt)} · ${duration(record.durationSeconds)} · ${label(record.outcomeCode)}`
                : `${formatDate(record.startAt)} → ${formatDate(record.endAt)} · ${label(record.priority)} priority`}
            </small>
          </>
        );
        const columns: DataGridColumn<MeetingRow>[] = [
          {
            id: "meeting",
            header: "Meeting",
            cell: (record) => (
              <>
                <strong>{record.subject}</strong>
                <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                {record.bookingId ? <StatusBadge tone="neutral">Booked</StatusBadge> : null}
              </>
            ),
          },
          {
            id: "detail",
            header: "Detail",
            cell: detail,
          },
          {
            id: "actions",
            header: "Actions",
            cell: (record) => <div className="crm-meeting-row__actions">{actions(record)}</div>,
          },
        ];
        return (
          <EnterpriseDataGrid
            caption="Meetings"
            rows={rows}
            rowKey={(record) => record.id}
            columns={columns}
            emptyState={
              <StatePanel
                title="No Meetings match this view"
                description="Schedule a Meeting, use a public booking link, log a completed Meeting, or change the current filters."
              />
            }
            renderMobileCard={(record) => (
              <article className="crm-meeting-row">
                <div className="crm-meeting-row__main">
                  <div className="crm-meeting-row__title">
                    <strong>{record.subject}</strong>
                    <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                    {record.bookingId ? <StatusBadge tone="neutral">Booked</StatusBadge> : null}
                  </div>
                  {detail(record)}
                </div>
                <div className="crm-meeting-row__actions">{actions(record)}</div>
              </article>
            )}
          />
        );
      })()}

      {totalPages > 1 ? <nav className="crm-meetings-pagination" aria-label="Meeting pages"><button className="secondary-button" disabled={page <= 1} onClick={() => router.push(queryHref(page - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary-button" disabled={page >= totalPages} onClick={() => router.push(queryHref(page + 1))}>Next</button></nav> : null}

      {editor ? <div className="crm-meeting-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditor(null); }}><section className="crm-meeting-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-meeting-editor-title"><div className="crm-meeting-dialog__heading"><div><p className="eyebrow">F014 · Meetings</p><h2 id="crm-meeting-editor-title">{editor.mode === "edit" ? "Edit scheduled Meeting" : editor.mode === "log" ? "Log completed Meeting" : "Schedule Meeting"}</h2></div><button className="icon-button" aria-label="Close Meeting editor" disabled={Boolean(busy)} onClick={() => setEditor(null)}>×</button></div><MeetingForm editor={editor} options={options} relationType={relationType} setRelationType={setRelationType} relationChoices={relationChoices} onSubmit={save} busy={busy === "save"} /></section></div> : null}

      {completion ? <div className="crm-meeting-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCompletion(null); }}><section className="crm-meeting-dialog crm-meeting-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="crm-meeting-complete-title"><div className="crm-meeting-dialog__heading"><div><p className="eyebrow">Complete Meeting</p><h2 id="crm-meeting-complete-title">{completion.subject}</h2></div><button className="icon-button" aria-label="Close completion dialog" onClick={() => setCompletion(null)}>×</button></div><form onSubmit={complete} className="crm-meeting-form"><label><span>Outcome</span><select name="outcomeCode" required defaultValue="held">{OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className="crm-meeting-form__wide"><span>Outcome note</span><textarea name="outcome" maxLength={4000} rows={4} placeholder="Optional Meeting notes" /></label><div className="crm-meeting-form__actions"><button className="secondary-button" type="button" onClick={() => setCompletion(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy === `complete:${completion.id}`}>{busy === `complete:${completion.id}` ? "Completing…" : "Complete Meeting"}</button></div></form></section></div> : null}

      {eventsFor ? <div className="crm-meeting-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventsFor(null); }}><section className="crm-meeting-dialog crm-meeting-dialog--compact" role="dialog" aria-modal="true" aria-labelledby="crm-meeting-history-title"><div className="crm-meeting-dialog__heading"><div><p className="eyebrow">Immutable evidence</p><h2 id="crm-meeting-history-title">Meeting history</h2></div><button className="icon-button" aria-label="Close Meeting history" onClick={() => setEventsFor(null)}>×</button></div><div className="crm-meeting-history">{events.length ? events.map((entry) => <article key={entry.id}><strong>{label(entry.eventType)}</strong><span>{entry.previousStatus ? `${label(entry.previousStatus)} → ${label(entry.nextStatus)}` : label(entry.nextStatus)}</span><small>{entry.changedByName || "System"} · {formatDate(entry.changedAt)}{entry.outcomeCode ? ` · ${label(entry.outcomeCode)}` : ""}{Number.isFinite(entry.attendeeCount) ? ` · ${entry.attendeeCount} attendee${entry.attendeeCount === 1 ? "" : "s"}` : ""}</small></article>) : <p>No Meeting events were recorded.</p>}</div></section></div> : null}
    </section>
  );
}

function MeetingForm({ editor, options, relationType, setRelationType, relationChoices, onSubmit, busy }: {
  editor: { mode: "schedule" | "log" | "edit"; record?: MeetingRow };
  options: Options;
  relationType: MeetingRow["entityType"];
  setRelationType: (value: MeetingRow["entityType"]) => void;
  relationChoices: Option[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const record = editor.record;
  const logMode = editor.mode === "log";
  const selectedContacts = new Set((record?.attendees || []).map((entry) => entry.contactId).filter((value): value is string => Boolean(value)));
  const guestEmails = (record?.attendees || []).filter((entry) => !entry.contactId && entry.email).map((entry) => entry.email).join(", ");
  return (
    <form onSubmit={onSubmit} className="crm-meeting-form">
      <div className="crm-meeting-form__wide">
        <FormField label="Subject" htmlFor="meeting-form-subject" required>
          <input id="meeting-form-subject" name="subject" maxLength={300} required defaultValue={record?.subject || ""} />
        </FormField>
      </div>
      <FormField label="Related record type" htmlFor="meeting-form-entity-type">
        <select
          id="meeting-form-entity-type"
          name="entityType"
          value={relationType}
          onChange={(event) => setRelationType(event.target.value as MeetingRow["entityType"])}
        >
          {["lead", "opportunity", "party", "contact", "campaign", "general"].map((value) => (
            <option key={value} value={value}>{value === "party" ? "Account" : label(value)}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Related record" htmlFor="meeting-form-entity-id" required={relationType !== "general"}>
        <select
          id="meeting-form-entity-id"
          name="entityId"
          disabled={relationType === "general"}
          required={relationType !== "general"}
          defaultValue={record?.entityType === relationType ? record.entityId || "" : ""}
        >
          <option value="">{relationType === "general" ? "No related record" : "Select record"}</option>
          {relationChoices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Assigned to" htmlFor="meeting-form-assigned-to">
        <select id="meeting-form-assigned-to" name="assignedTo" defaultValue={record?.assignedTo || ""}>
          <option value="">Me</option>
          {(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Priority" htmlFor="meeting-form-priority">
        <select id="meeting-form-priority" name="priority" defaultValue={record?.priority || "medium"}>
          {["low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </FormField>
      <FormField label="Location type" htmlFor="meeting-form-location-type" required>
        <select id="meeting-form-location-type" name="locationType" required defaultValue={record?.locationType || "other"}>
          {["in_person", "online", "phone", "other"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </FormField>
      <FormField label="Location" htmlFor="meeting-form-location">
        <input id="meeting-form-location" name="location" maxLength={500} defaultValue={record?.location || ""} placeholder="Office, customer site, room…" />
      </FormField>
      <div className="crm-meeting-form__wide">
        <FormField label="Meeting URL" htmlFor="meeting-form-url">
          <input id="meeting-form-url" name="meetingUrl" type="url" maxLength={2048} defaultValue={record?.meetingUrl || ""} placeholder="https://…" />
        </FormField>
      </div>
      {logMode ? (
        <>
          <FormField label="Occurred at" htmlFor="meeting-form-occurred-at" required>
            <input id="meeting-form-occurred-at" name="occurredAt" type="datetime-local" defaultValue={localDateTime(new Date().toISOString())} required />
          </FormField>
          <FormField label="Duration (minutes)" htmlFor="meeting-form-duration" required>
            <input id="meeting-form-duration" name="durationMinutes" type="number" min={0} max={1440} step={1} defaultValue={30} required />
          </FormField>
          <FormField label="Outcome" htmlFor="meeting-form-outcome-code" required>
            <select id="meeting-form-outcome-code" name="outcomeCode" required defaultValue="held">
              {OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Start" htmlFor="meeting-form-start-at" required>
            <input id="meeting-form-start-at" name="startAt" type="datetime-local" required defaultValue={localDateTime(record?.startAt)} />
          </FormField>
          <FormField label="End" htmlFor="meeting-form-end-at" required>
            <input id="meeting-form-end-at" name="endAt" type="datetime-local" required defaultValue={localDateTime(record?.endAt)} />
          </FormField>
        </>
      )}
      <div className="crm-meeting-form__wide">
        <FormField
          label="CRM Contact attendees"
          htmlFor="meeting-form-attendee-contact-id"
          hint="Ctrl/Cmd-click to select multiple contacts."
        >
          <select
            id="meeting-form-attendee-contact-id"
            name="attendeeContactId"
            multiple
            size={Math.min(6, Math.max(3, (options.contacts || []).length || 3))}
            defaultValue={[...selectedContacts] as string[]}
          >
            {(options.contacts || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </FormField>
      </div>
      <div className="crm-meeting-form__wide">
        <FormField label="Additional guest emails" htmlFor="meeting-form-guest-emails">
          <textarea id="meeting-form-guest-emails" name="guestEmails" rows={2} defaultValue={guestEmails} placeholder="guest@example.com, second@example.com" />
        </FormField>
      </div>
      <div className="crm-meeting-form__wide">
        <FormField label={logMode ? "Outcome note" : "Notes"} htmlFor="meeting-form-notes">
          <textarea
            id="meeting-form-notes"
            name={logMode ? "outcome" : "description"}
            maxLength={4000}
            rows={4}
            defaultValue={logMode ? "" : record?.description || ""}
          />
        </FormField>
      </div>
      <div className="crm-meeting-form__actions">
        <ActionButton tone="primary" type="submit" busy={busy}>
          {busy ? "Saving…" : editor.mode === "log" ? "Log Meeting" : editor.mode === "edit" ? "Save changes" : "Schedule Meeting"}
        </ActionButton>
      </div>
    </form>
  );
}
