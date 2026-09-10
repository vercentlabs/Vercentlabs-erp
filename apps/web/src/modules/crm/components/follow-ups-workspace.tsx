"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import {
  ActionButton,
  ConfirmDialog,
  Dialog,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";
import styles from "./follow-ups-workspace.module.css";

type Option = { id: string; name: string; companyId?: string | null; partyId?: string | null };
type Options = Record<string, Option[]>;

type FollowUpRow = {
  id: string;
  subject: string;
  description?: string | null;
  status: "planned" | "overdue" | "in_progress" | "completed" | "cancelled";
  priority: string;
  assignedTo?: string | null;
  assignedName?: string | null;
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId?: string | null;
  dueAt: string;
  followUpReason?: string | null;
  followUpChannel?: string | null;
  followUpSnoozeCount?: number | null;
  followUpEscalateAfterMinutes?: number | null;
  followUpEscalatedAt?: string | null;
  updatedAt: string;
};

type FollowUpEvent = {
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  actorUserId?: string | null;
  occurredAt: string;
};

type Reminder = {
  id: string;
  offsetMinutes: number;
  channel: "in_app" | "email";
  fireAt: string;
  status: "pending" | "dispatching" | "sent" | "delivered" | "acknowledged" | "failed" | "cancelled";
};

const RELATION_OPTIONS: Record<FollowUpRow["entityType"], string | null> = {
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
function label(value?: string | null) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function offsetLabel(minutes: number) {
  if (minutes === 0) return "At due time";
  if (minutes % 1440 === 0) return `${minutes / 1440}d before`;
  if (minutes % 60 === 0) return `${minutes / 60}h before`;
  return `${minutes}m before`;
}

export default function FollowUpsWorkspace({
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
  rows: FollowUpRow[];
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
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; record?: FollowUpRow } | null>(
    startCreating && canManage ? { mode: "create" } : null,
  );
  const [snoozeTarget, setSnoozeTarget] = useState<FollowUpRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FollowUpRow | null>(null);
  const [detailFor, setDetailFor] = useState<FollowUpRow | null>(null);
  const [events, setEvents] = useState<FollowUpEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [relationType, setRelationType] = useState<FollowUpRow["entityType"]>("general");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const relationChoices = useMemo(() => {
    const key = RELATION_OPTIONS[relationType];
    return key ? options[key] || [] : [];
  }, [options, relationType]);

  function openEditor(mode: "create" | "edit", record?: FollowUpRow) {
    setMessage("");
    setRelationType(record?.entityType || "general");
    setEditor({ mode, record });
  }

  function queryHref(nextPage: number) {
    const query = new URLSearchParams();
    query.set("activityType", "follow_up");
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
    const record = editor.record;
    const entityType = String(form.get("entityType") || "general");
    const body: Record<string, unknown> = {
      subject: String(form.get("subject") || ""),
      description: String(form.get("description") || "").trim() || null,
      entityType,
      entityId: entityType === "general" ? null : String(form.get("entityId") || "").trim() || null,
      assignedTo: String(form.get("assignedTo") || "").trim() || null,
      dueAt: String(form.get("dueAt") || "").trim(),
      followUpReason: String(form.get("followUpReason") || "").trim() || null,
      followUpChannel: String(form.get("followUpChannel") || "").trim() || null,
      escalateAfterMinutes: String(form.get("escalateAfterMinutes") || "").trim() || null,
    };
    if (editor.mode === "create") {
      const offsets = String(form.get("reminderOffsets") || "")
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry));
      if (offsets.length) body.reminderOffsets = offsets;
      body.reminderChannel = String(form.get("reminderChannel") || "in_app");
    }
    if (editor.mode === "edit" && record) {
      body.expectedUpdatedAt = record.updatedAt;
      body.expectedStatus = record.status;
    }

    setBusy("save");
    setMessage("");
    const result = await requestJson(
      editor.mode === "edit" && record ? `/api/crm/follow-ups/${record.id}` : "/api/crm/follow-ups",
      {
        method: editor.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setBusy("");
    setMessage(result.message || (result.ok ? "Follow-up saved." : "Follow-up could not be saved."));
    if (result.ok) {
      setEditor(null);
      router.refresh();
    }
  }

  async function doSnooze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snoozeTarget) return;
    const form = new FormData(event.currentTarget);
    setBusy(`snooze:${snoozeTarget.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/follow-ups/${snoozeTarget.id}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dueAt: String(form.get("dueAt") || "").trim(),
        expectedUpdatedAt: snoozeTarget.updatedAt,
        expectedStatus: snoozeTarget.status,
      }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Follow-up rescheduled." : "Follow-up could not be rescheduled."));
    if (result.ok) {
      setSnoozeTarget(null);
      router.refresh();
    }
  }

  async function complete(record: FollowUpRow) {
    setBusy(`complete:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/follow-ups/${record.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Follow-up completed." : "Follow-up could not be completed."));
    if (result.ok) router.refresh();
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const record = cancelTarget;
    setBusy(`cancel:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/follow-ups/${record.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Follow-up cancelled." : "Follow-up could not be cancelled."));
    if (result.ok) {
      setCancelTarget(null);
      router.refresh();
    }
  }

  async function showDetail(record: FollowUpRow) {
    setBusy(`detail:${record.id}`);
    setMessage("");
    const [historyResult, recordResult] = await Promise.all([
      requestJson<{ events?: FollowUpEvent[] }>(`/api/crm/follow-ups/${record.id}/history`),
      requestJson<{ reminders?: Reminder[] }>(`/api/crm/follow-ups/${record.id}`),
    ]);
    setBusy("");
    if (!historyResult.ok || !recordResult.ok) {
      setMessage(historyResult.message || recordResult.message || "Follow-up detail could not be loaded.");
      return;
    }
    setEvents(Array.isArray(historyResult.events) ? historyResult.events : []);
    setReminders(Array.isArray(recordResult.reminders) ? recordResult.reminders : []);
    setDetailFor(record);
  }

  async function acknowledge(reminder: Reminder) {
    if (!detailFor) return;
    setBusy(`ack:${reminder.id}`);
    const result = await requestJson(`/api/crm/follow-ups/${detailFor.id}/reminders/${reminder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "acknowledge" }),
    });
    setBusy("");
    if (result.ok) {
      setReminders((current) => current.map((entry) => (entry.id === reminder.id ? { ...entry, status: "acknowledged" } : entry)));
    } else {
      setMessage(result.message || "Reminder could not be acknowledged.");
    }
  }

  return (
    <section className={styles.workspace} aria-label="Follow-ups workspace">
      <div className={styles.toolbar}>
        <form method="get" className={styles.filters}>
          <input type="hidden" name="activityType" value="follow_up" />
          {due !== "all" ? <input type="hidden" name="due" value={due} /> : null}
          <label><span>Search Follow-ups</span><input name="search" defaultValue={search} placeholder="Subject or notes" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="all">All statuses</option>{["planned", "overdue", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <button className="secondary-button" type="submit">Apply</button>
        </form>
        {canManage ? <div className={styles.createActions}><ActionButton tone="primary" type="button" onClick={() => openEditor("create")}>Schedule Follow-up</ActionButton></div> : null}
      </div>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div className={styles.summary}><strong>{total}</strong><span>matching Follow-up{total === 1 ? "" : "s"}</span><span>Reminders and escalation run automatically once scheduled.</span></div>

      {(() => {
        const statusTone = (record: FollowUpRow) =>
          record.status === "completed" ? "success" : record.status === "cancelled" ? "danger" : record.status === "overdue" ? "danger" : "neutral";
        const actions = (record: FollowUpRow) => (
          <>
            <ActionButton tone="quiet" type="button" disabled={busy === `detail:${record.id}`} onClick={() => void showDetail(record)}>
              Detail
            </ActionButton>
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton type="button" onClick={() => openEditor("edit", record)}>Edit</ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton type="button" disabled={Boolean(busy)} onClick={() => setSnoozeTarget(record)}>Snooze</ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton tone="primary" type="button" disabled={Boolean(busy)} onClick={() => void complete(record)}>Complete</ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton tone="quiet" type="button" disabled={Boolean(busy)} onClick={() => setCancelTarget(record)}>Cancel</ActionButton>
            ) : null}
          </>
        );
        const columns: DataGridColumn<FollowUpRow>[] = [
          {
            id: "followUp",
            header: "Follow-up",
            cell: (record) => (
              <>
                <strong>{record.subject}</strong>
                <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                {(record.followUpSnoozeCount || 0) > 0 ? <StatusBadge tone="neutral">Snoozed ×{record.followUpSnoozeCount}</StatusBadge> : null}
                {record.followUpEscalatedAt ? <StatusBadge tone="danger">Escalated</StatusBadge> : null}
              </>
            ),
          },
          {
            id: "detail",
            header: "Detail",
            cell: (record) => (
              <>
                <p>{label(record.followUpChannel)} · {record.assignedName || "Unassigned"}</p>
                <small>Due {formatDate(record.dueAt)}{record.followUpReason ? ` · ${record.followUpReason}` : ""}</small>
              </>
            ),
          },
          {
            id: "actions",
            header: "Actions",
            cell: (record) => <div className={styles.rowActions}>{actions(record)}</div>,
          },
        ];
        return (
          <EnterpriseDataGrid
            caption="Follow-ups"
            rows={rows}
            rowKey={(record) => record.id}
            columns={columns}
            emptyState={
              <StatePanel title="No Follow-ups match this view" description="Schedule a Follow-up, or change the current filters." />
            }
            renderMobileCard={(record) => (
              <article className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>
                    <strong>{record.subject}</strong>
                    <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                  </div>
                  <p>{label(record.followUpChannel)} · {record.assignedName || "Unassigned"}</p>
                  <small>Due {formatDate(record.dueAt)}{record.followUpReason ? ` · ${record.followUpReason}` : ""}</small>
                </div>
                <div className={styles.rowActions}>{actions(record)}</div>
              </article>
            )}
          />
        );
      })()}

      {totalPages > 1 ? <nav className={styles.pagination} aria-label="Follow-up pages"><button className="secondary-button" disabled={page <= 1} onClick={() => router.push(queryHref(page - 1))}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary-button" disabled={page >= totalPages} onClick={() => router.push(queryHref(page + 1))}>Next</button></nav> : null}

      {editor ? (
        <Dialog
          title={editor.mode === "edit" ? "Edit Follow-up" : "Schedule Follow-up"}
          description="Follow-ups"
          onClose={() => setEditor(null)}
          canDismiss={busy !== "save"}
          busy={busy === "save"}
        >
          <FollowUpForm editor={editor} options={options} relationType={relationType} setRelationType={setRelationType} relationChoices={relationChoices} onSubmit={save} busy={busy === "save"} />
        </Dialog>
      ) : null}

      {snoozeTarget ? (
        <Dialog
          title={snoozeTarget.subject}
          description="Snooze Follow-up"
          onClose={() => setSnoozeTarget(null)}
          canDismiss={busy !== `snooze:${snoozeTarget.id}`}
          busy={busy === `snooze:${snoozeTarget.id}`}
        >
          <form onSubmit={doSnooze} className={styles.form}>
            <FormField label="New date/time" htmlFor="follow-up-snooze-due-at" required>
              <input id="follow-up-snooze-due-at" name="dueAt" type="datetime-local" required defaultValue={localDateTime(snoozeTarget.dueAt)} />
            </FormField>
            <div className={styles.formActions}>
              <button className="secondary-button" type="button" onClick={() => setSnoozeTarget(null)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy === `snooze:${snoozeTarget.id}`}>
                {busy === `snooze:${snoozeTarget.id}` ? "Rescheduling…" : "Reschedule"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          title="Cancel Follow-up?"
          description={cancelTarget.subject}
          onClose={() => setCancelTarget(null)}
          onConfirm={() => void confirmCancel()}
          confirmLabel="Cancel Follow-up"
          cancelLabel="Keep Follow-up"
          busy={busy === `cancel:${cancelTarget.id}`}
        />
      ) : null}

      {detailFor ? (
        <Dialog title={detailFor.subject} description="Follow-up detail" onClose={() => setDetailFor(null)}>
          <div className={styles.detail}>
            <section>
              <h3>Reminders</h3>
              {reminders.length ? (
                <ul className={styles.reminders}>
                  {reminders.map((reminder) => (
                    <li key={reminder.id}>
                      <span>{offsetLabel(reminder.offsetMinutes)} · {label(reminder.channel)} · {formatDate(reminder.fireAt)}</span>
                      <StatusBadge tone={reminder.status === "failed" ? "danger" : reminder.status === "acknowledged" ? "success" : "neutral"}>{label(reminder.status)}</StatusBadge>
                      {["sent", "delivered"].includes(reminder.status) ? (
                        <button className="secondary-button" type="button" disabled={busy === `ack:${reminder.id}`} onClick={() => void acknowledge(reminder)}>
                          {busy === `ack:${reminder.id}` ? "Acknowledging…" : "Acknowledge"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No reminders were scheduled.</p>
              )}
            </section>
            <section>
              <h3>History</h3>
              <div className={styles.history}>
                {events.length ? events.map((entry, index) => (
                  <article key={index}>
                    <strong>{label(entry.eventType)}</strong>
                    <span>{entry.fromStatus ? `${label(entry.fromStatus)} → ${label(entry.toStatus)}` : label(entry.toStatus)}</span>
                    <small>{formatDate(entry.occurredAt)}</small>
                  </article>
                )) : <p>No Follow-up events were recorded.</p>}
              </div>
            </section>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function FollowUpForm({ editor, options, relationType, setRelationType, relationChoices, onSubmit, busy }: {
  editor: { mode: "create" | "edit"; record?: FollowUpRow };
  options: Options;
  relationType: FollowUpRow["entityType"];
  setRelationType: (value: FollowUpRow["entityType"]) => void;
  relationChoices: Option[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const record = editor.record;
  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <div className={styles.formWide}>
        <FormField label="Subject" htmlFor="follow-up-form-subject" required>
          <input id="follow-up-form-subject" name="subject" maxLength={300} required defaultValue={record?.subject || ""} />
        </FormField>
      </div>
      <FormField label="Related record type" htmlFor="follow-up-form-entity-type">
        <select id="follow-up-form-entity-type" name="entityType" value={relationType} onChange={(event) => setRelationType(event.target.value as FollowUpRow["entityType"])}>
          {["general", "lead", "opportunity", "party", "contact", "campaign"].map((value) => (
            <option key={value} value={value}>{value === "party" ? "Account" : label(value)}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Related record" htmlFor="follow-up-form-entity-id" required={relationType !== "general"}>
        <select id="follow-up-form-entity-id" name="entityId" disabled={relationType === "general"} required={relationType !== "general"} defaultValue={record?.entityType === relationType ? record.entityId || "" : ""}>
          <option value="">{relationType === "general" ? "No related record" : "Select record"}</option>
          {relationChoices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Assigned to" htmlFor="follow-up-form-assigned-to">
        <select id="follow-up-form-assigned-to" name="assignedTo" defaultValue={record?.assignedTo || ""}>
          <option value="">Me</option>
          {(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>
      <FormField label="Due" htmlFor="follow-up-form-due-at" required>
        <input id="follow-up-form-due-at" name="dueAt" type="datetime-local" required defaultValue={localDateTime(record?.dueAt)} />
      </FormField>
      <FormField label="Channel" htmlFor="follow-up-form-channel">
        <select id="follow-up-form-channel" name="followUpChannel" defaultValue={record?.followUpChannel || ""}>
          <option value="">Unspecified</option>
          {["call", "email", "meeting", "whatsapp", "sms", "other"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </FormField>
      <FormField label="Escalate if overdue after (minutes)" htmlFor="follow-up-form-escalate" hint="Leave blank to never escalate.">
        <input id="follow-up-form-escalate" name="escalateAfterMinutes" type="number" min={1} max={43200} defaultValue={record?.followUpEscalateAfterMinutes ?? ""} />
      </FormField>
      <div className={styles.formWide}>
        <FormField label="Reason" htmlFor="follow-up-form-reason">
          <input id="follow-up-form-reason" name="followUpReason" maxLength={1000} defaultValue={record?.followUpReason || ""} placeholder="Why this Follow-up is needed" />
        </FormField>
      </div>
      {editor.mode === "create" ? (
        <>
          <FormField label="Reminder offsets (minutes before due, comma-separated)" htmlFor="follow-up-form-reminder-offsets" hint="Defaults to 24h, 1h and at due time.">
            <input id="follow-up-form-reminder-offsets" name="reminderOffsets" placeholder="1440, 60, 0" />
          </FormField>
          <FormField label="Reminder channel" htmlFor="follow-up-form-reminder-channel">
            <select id="follow-up-form-reminder-channel" name="reminderChannel" defaultValue="in_app">
              <option value="in_app">In-app</option>
              <option value="email">Email</option>
            </select>
          </FormField>
        </>
      ) : null}
      <div className={styles.formWide}>
        <FormField label="Notes" htmlFor="follow-up-form-notes">
          <textarea id="follow-up-form-notes" name="description" maxLength={4000} rows={4} defaultValue={record?.description || ""} />
        </FormField>
      </div>
      <div className={styles.formActions}>
        <ActionButton tone="primary" type="submit" busy={busy}>
          {busy ? "Saving…" : editor.mode === "edit" ? "Save changes" : "Schedule Follow-up"}
        </ActionButton>
      </div>
    </form>
  );
}
