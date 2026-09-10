"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  ActionLink,
  ConfirmDialog,
  Dialog,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

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
  const [cancelTarget, setCancelTarget] = useState<CallRow | null>(null);
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
    if (action === "cancel") {
      setCancelTarget(record);
      return;
    }
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

  async function confirmCancel() {
    if (!cancelTarget) return;
    const record = cancelTarget;
    setBusy(`cancel:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/calls/${record.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Call cancelled." : "Call could not be cancelled."));
    if (result.ok) {
      setCancelTarget(null);
      router.refresh();
    }
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
        {canManage ? <div className="crm-calls-create-actions"><ActionButton tone="primary" type="button" onClick={() => openEditor("schedule")}>Schedule Call</ActionButton><ActionButton type="button" onClick={() => openEditor("log")}>Log completed Call</ActionButton></div> : null}
      </div>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div className="crm-calls-summary"><strong>{total}</strong><span>matching Call{total === 1 ? "" : "s"}</span><span>Manual call logging only · no telephony/recording provider is implied.</span></div>

      {(() => {
        const statusTone = (record: CallRow) =>
          record.status === "completed"
            ? "success"
            : record.status === "cancelled"
              ? "danger"
              : "neutral";
        const actions = (record: CallRow) => (
          <>
            {record.phoneNumber ? (
              <ActionLink href={`tel:${record.phoneNumber}`}>Dial</ActionLink>
            ) : null}
            <ActionButton
              tone="quiet"
              type="button"
              // Deliberately not disabled while its own fetch is in
              // flight: disabling the very button that was just clicked
              // forces the browser to blur it immediately (a disabled
              // element cannot hold focus), which happens *before* the
              // History dialog mounts and captures "the previously
              // focused element" to restore focus to on close — silently
              // breaking focus restoration for this trigger specifically.
              // A duplicate click here only re-fetches read-only history,
              // which is harmless.
              onClick={() => void showEvents(record)}
            >
              History
            </ActionButton>
            {canManage && ["planned", "overdue"].includes(record.status) ? (
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
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
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
        const columns: DataGridColumn<CallRow>[] = [
          {
            id: "call",
            header: "Call",
            cell: (record) => (
              <>
                <strong>{record.subject}</strong>
                <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
              </>
            ),
          },
          {
            id: "detail",
            header: "Detail",
            cell: (record) => (
              <>
                <p>
                  {label(record.direction)} · {record.phoneNumber || "No phone snapshot"} ·{" "}
                  {record.assignedName || "Unassigned"}
                </p>
                <small>
                  {record.status === "completed"
                    ? `Completed ${formatDate(record.actualEndedAt || record.dueAt)} · ${duration(record.durationSeconds)} · ${label(record.outcomeCode)}`
                    : `Due ${formatDate(record.dueAt)} · ${label(record.priority)} priority`}
                </small>
              </>
            ),
          },
          {
            id: "actions",
            header: "Actions",
            cell: (record) => <div className="crm-call-row__actions">{actions(record)}</div>,
          },
        ];
        return (
          <EnterpriseDataGrid
            caption="Calls"
            rows={rows}
            rowKey={(record) => record.id}
            columns={columns}
            emptyState={
              <StatePanel
                title="No Calls match this view"
                description="Schedule a Call, log a completed Call, or change the current filters."
              />
            }
            renderMobileCard={(record) => (
              <article className="crm-call-row">
                <div className="crm-call-row__main">
                  <div className="crm-call-row__title">
                    <strong>{record.subject}</strong>
                    <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                  </div>
                  <p>
                    {label(record.direction)} · {record.phoneNumber || "No phone snapshot"} ·{" "}
                    {record.assignedName || "Unassigned"}
                  </p>
                  <small>
                    {record.status === "completed"
                      ? `Completed ${formatDate(record.actualEndedAt || record.dueAt)} · ${duration(record.durationSeconds)} · ${label(record.outcomeCode)}`
                      : `Due ${formatDate(record.dueAt)} · ${label(record.priority)} priority`}
                  </small>
                </div>
                <div className="crm-call-row__actions">{actions(record)}</div>
              </article>
            )}
          />
        );
      })()}

      {totalPages > 1 ? <nav className="crm-calls-pagination" aria-label="Call pages"><button className="secondary-button" disabled={page <= 1} onClick={() => router.push(queryHref(page - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary-button" disabled={page >= totalPages} onClick={() => router.push(queryHref(page + 1))}>Next</button></nav> : null}

      {editor ? (
        <Dialog
          title={editor.mode === "edit" ? "Edit scheduled Call" : editor.mode === "log" ? "Log completed Call" : "Schedule Call"}
          description="Calls"
          onClose={() => setEditor(null)}
          canDismiss={busy !== "save"}
          busy={busy === "save"}
        >
          <CallForm editor={editor} options={options} relationType={relationType} setRelationType={setRelationType} relationChoices={relationChoices} onSubmit={save} busy={busy === "save"} />
        </Dialog>
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          title="Cancel Call?"
          description={cancelTarget.subject}
          onClose={() => setCancelTarget(null)}
          onConfirm={() => void confirmCancel()}
          confirmLabel="Cancel Call"
          cancelLabel="Keep Call"
          busy={busy === `cancel:${cancelTarget.id}`}
        />
      ) : null}

      {completion ? (
        <Dialog
          title={completion.subject}
          onClose={() => setCompletion(null)}
          canDismiss={busy !== `complete:${completion.id}`}
          busy={busy === `complete:${completion.id}`}
        >
          <form onSubmit={complete} className="crm-call-form"><label><span>Outcome</span><select name="outcomeCode" required defaultValue="connected">{OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className="crm-call-form__wide"><span>Outcome note</span><textarea name="outcome" maxLength={4000} rows={4} placeholder="Optional call notes" /></label><div className="crm-call-form__actions"><button className="secondary-button" type="button" onClick={() => setCompletion(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy === `complete:${completion.id}`}>{busy === `complete:${completion.id}` ? "Completing…" : "Complete Call"}</button></div></form>
        </Dialog>
      ) : null}

      {eventsFor ? (
        <Dialog title="Call history" onClose={() => setEventsFor(null)}>
          <div className="crm-call-history">{events.length ? events.map((entry) => <article key={entry.id}><strong>{label(entry.eventType)}</strong><span>{entry.previousStatus ? `${label(entry.previousStatus)} → ${label(entry.nextStatus)}` : label(entry.nextStatus)}</span><small>{entry.changedByName || "System"} · {formatDate(entry.changedAt)}{entry.outcomeCode ? ` · ${label(entry.outcomeCode)}` : ""}</small></article>) : <p>No Call events were recorded.</p>}</div>
        </Dialog>
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
      <div className="crm-call-form__wide">
        <FormField label="Subject" htmlFor="call-form-subject" required>
          <input id="call-form-subject" name="subject" maxLength={300} required defaultValue={record?.subject || ""} />
        </FormField>
      </div>
      <FormField label="Direction" htmlFor="call-form-direction" required>
        <select id="call-form-direction" name="direction" required defaultValue={record?.direction || "outbound"}>
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
      </FormField>
      <FormField label="Phone number" htmlFor="call-form-phone">
        <input id="call-form-phone" name="phoneNumber" inputMode="tel" maxLength={40} defaultValue={record?.phoneNumber || ""} placeholder="Auto-resolves from related record when blank" />
      </FormField>
      <FormField label="Related record type" htmlFor="call-form-entity-type">
        <select
          id="call-form-entity-type"
          name="entityType"
          value={relationType}
          onChange={(event) => setRelationType(event.target.value as CallRow["entityType"])}
        >
          {["lead", "opportunity", "party", "contact", "campaign", "general"].map((value) => (
            <option key={value} value={value}>{value === "party" ? "Account" : label(value)}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Related record" htmlFor="call-form-entity-id" required={relationType !== "general"}>
        <select
          id="call-form-entity-id"
          name="entityId"
          disabled={relationType === "general"}
          required={relationType !== "general"}
          defaultValue={record?.entityType === relationType ? record.entityId || "" : ""}
        >
          <option value="">{relationType === "general" ? "No related record" : "Select record"}</option>
          {relationChoices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Assigned to" htmlFor="call-form-assigned-to">
        <select id="call-form-assigned-to" name="assignedTo" defaultValue={record?.assignedTo || ""}>
          <option value="">Me</option>
          {(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Priority" htmlFor="call-form-priority">
        <select id="call-form-priority" name="priority" defaultValue={record?.priority || "medium"}>
          {["low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </FormField>
      {logMode ? (
        <>
          <FormField label="Occurred at" htmlFor="call-form-occurred-at" required>
            <input id="call-form-occurred-at" name="occurredAt" type="datetime-local" defaultValue={localDateTime(new Date().toISOString())} required />
          </FormField>
          <FormField label="Duration (seconds)" htmlFor="call-form-duration" required>
            <input id="call-form-duration" name="durationSeconds" type="number" min={0} max={86400} step={1} defaultValue={0} required />
          </FormField>
          <FormField label="Outcome" htmlFor="call-form-outcome-code" required>
            <select id="call-form-outcome-code" name="outcomeCode" required defaultValue="connected">
              {OUTCOMES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Start" htmlFor="call-form-start-at">
            <input id="call-form-start-at" name="startAt" type="datetime-local" defaultValue={localDateTime(record?.startAt)} />
          </FormField>
          <FormField label="Due" htmlFor="call-form-due-at" required>
            <input id="call-form-due-at" name="dueAt" type="datetime-local" required defaultValue={localDateTime(record?.dueAt)} />
          </FormField>
          <FormField label="Reminder" htmlFor="call-form-reminder-at">
            <input id="call-form-reminder-at" name="reminderAt" type="datetime-local" defaultValue={localDateTime(record?.reminderAt)} />
          </FormField>
        </>
      )}
      <div className="crm-call-form__wide">
        <FormField label={logMode ? "Outcome note" : "Notes"} htmlFor="call-form-notes">
          <textarea
            id="call-form-notes"
            name={logMode ? "outcome" : "description"}
            maxLength={4000}
            rows={4}
            defaultValue={logMode ? "" : record?.description || ""}
          />
        </FormField>
      </div>
      <div className="crm-call-form__actions">
        <ActionButton tone="primary" type="submit" busy={busy}>
          {busy ? "Saving…" : editor.mode === "log" ? "Log Call" : editor.mode === "edit" ? "Save changes" : "Schedule Call"}
        </ActionButton>
      </div>
    </form>
  );
}
