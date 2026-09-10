"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

type Option = { id: string; name: string };
type Options = Record<string, Option[]>;
type Team = { id: string; name: string; managerUserId?: string | null };
type Member = { userId: string; fullName: string; memberRole: string };

type RecurrenceConfig = {
  freq: "daily" | "weekly" | "monthly";
  interval?: number;
  count?: number;
  until?: string | null;
  byWeekday?: number[];
} | null;

type TaskRow = {
  id: string;
  subject: string;
  description?: string | null;
  status: "planned" | "in_progress" | "overdue" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  entityType: "lead" | "opportunity" | "party" | "contact" | "campaign" | "general";
  entityId?: string | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  reminderAt?: string | null;
  recurringRule?: string | null;
  recurrenceConfig?: RecurrenceConfig;
  recurrenceParentId?: string | null;
  taskSource: string;
  outcome?: string | null;
  updatedAt: string;
};

type TaskEvent = { eventType: string; fromStatus?: string | null; toStatus?: string | null; actorUserId?: string | null; occurredAt: string };
type Dependency = { id: string; dependsOnTaskId: string; dependsOnStatus?: string | null; dependsOnSubject?: string | null };

const RELATION_OPTIONS: Record<TaskRow["entityType"], string | null> = {
  lead: "leads", opportunity: "opportunities", party: "parties", contact: "contacts", campaign: "campaigns", general: null,
};
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}
function label(value?: string | null) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function ordinal(day: number) {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}
// F015 §15 closeout — the recurrence backend already exists; this is the
// human-readable projection the dossier requires ("Every weekday", "Every
// 2 weeks on Monday and Thursday", "Monthly on the 15th"), never raw JSON.
function describeRecurrence(config: RecurrenceConfig | undefined, dueAt?: string | null) {
  if (!config) return "Does not repeat";
  const interval = Math.max(1, Number(config.interval) || 1);
  let base: string;
  if (config.freq === "daily") {
    base = interval === 1 ? "Every day" : `Every ${interval} days`;
  } else if (config.freq === "weekly") {
    const days = Array.isArray(config.byWeekday) ? [...config.byWeekday].sort((a, b) => a - b) : [];
    const isWeekdaySet = days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day));
    if (isWeekdaySet && interval === 1) {
      base = "Every weekday";
    } else if (days.length) {
      const dayNames = days.map((day) => WEEKDAY_NAMES[day] || "").join(" and ");
      base = interval === 1 ? `Every week on ${dayNames}` : `Every ${interval} weeks on ${dayNames}`;
    } else {
      base = interval === 1 ? "Every week" : `Every ${interval} weeks`;
    }
  } else {
    const day = dueAt ? new Date(dueAt).getUTCDate() : null;
    const dayLabel = day ? `the ${ordinal(day)}` : "the same day each month";
    base = interval === 1 ? `Monthly on ${dayLabel}` : `Every ${interval} months on ${dayLabel}`;
  }
  if (config.count) return `${base}, ${config.count} time${config.count === 1 ? "" : "s"}`;
  if (config.until) return `${base}, until ${new Date(config.until).toLocaleDateString()}`;
  return base;
}

export default function TasksWorkspace({
  rows,
  total,
  page,
  pageSize,
  search,
  status,
  due,
  view,
  teamId,
  options,
  myTeams,
  currentUserId,
  canManage,
  startCreating = false,
}: {
  rows: TaskRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  due: string;
  view: "mine" | "team" | "all";
  teamId: string;
  options: Options;
  myTeams: Team[];
  currentUserId: string;
  canManage: boolean;
  startCreating?: boolean;
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; record?: TaskRow } | null>(
    startCreating && canManage ? { mode: "create" } : null,
  );
  const [detailFor, setDetailFor] = useState<TaskRow | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [cancelTarget, setCancelTarget] = useState<TaskRow | null>(null);
  const [reassignTarget, setReassignTarget] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function queryHref(next: { nextPage?: number; nextView?: string; nextTeamId?: string; nextStatus?: string; nextDue?: string; nextSearch?: string } = {}) {
    const query = new URLSearchParams();
    query.set("activityType", "task");
    const v = next.nextView ?? view;
    const t = next.nextTeamId ?? teamId;
    const s = next.nextStatus ?? status;
    const d = next.nextDue ?? due;
    const q = next.nextSearch ?? search;
    if (v !== "mine") query.set("view", v);
    if (v === "team" && t) query.set("teamId", t);
    if (s !== "all") query.set("status", s);
    if (d !== "all") query.set("due", d);
    if (q) query.set("search", q);
    const p = next.nextPage ?? page;
    if (p > 1) query.set("page", String(p));
    return `/crm/activities?${query.toString()}`;
  }

  async function refresh() {
    router.refresh();
  }

  function openEditor(mode: "create" | "edit", record?: TaskRow) {
    setMessage("");
    setEditor({ mode, record });
  }

  async function save(body: Record<string, unknown>, id?: string) {
    setBusy("save");
    setMessage("");
    const result = await requestJson(id ? `/api/crm/tasks/${id}` : "/api/crm/tasks", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Task saved." : "Task could not be saved."));
    if (result.ok) {
      setEditor(null);
      await refresh();
    }
  }

  async function transition(record: TaskRow, action: "start" | "complete" | "cancel") {
    setBusy(`${action}:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/tasks/${record.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Task updated." : "Task could not be updated."));
    if (result.ok) await refresh();
  }

  async function claim(record: TaskRow) {
    setBusy(`claim:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/tasks/${record.id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt }),
    });
    setBusy("");
    if (!result.ok) {
      // F015 §4 closeout — a claim race must read as an understandable
      // conflict, not a generic failure.
      setMessage(
        result.status === 409
          ? "Someone else just claimed this Task. Refreshing the queue."
          : result.message || "This Task could not be claimed.",
      );
      await refresh();
      return;
    }
    setMessage("Task claimed.");
    await refresh();
  }

  async function release(record: TaskRow) {
    setBusy(`release:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/tasks/${record.id}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: record.updatedAt }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Task released back to the queue." : "Task could not be released."));
    if (result.ok) await refresh();
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    await transition(cancelTarget, "cancel");
    setCancelTarget(null);
  }

  async function showDetail(record: TaskRow) {
    setBusy(`detail:${record.id}`);
    setMessage("");
    const [historyResult, depsResult] = await Promise.all([
      requestJson<{ record?: TaskRow; events?: TaskEvent[] }>(`/api/crm/tasks/${record.id}`),
      requestJson<{ rows?: Dependency[] }>(`/api/crm/tasks/${record.id}/dependencies`),
    ]);
    setBusy("");
    if (!historyResult.ok || !depsResult.ok) {
      setMessage(historyResult.message || depsResult.message || "Task detail could not be loaded.");
      return;
    }
    setEvents(Array.isArray(historyResult.events) ? historyResult.events : []);
    setDependencies(Array.isArray(depsResult.rows) ? depsResult.rows : []);
    setDetailFor(record);
  }

  async function addDependency(dependsOnTaskId: string) {
    if (!detailFor) return;
    setBusy("add-dependency");
    const result = await requestJson<{ record?: Dependency }>(`/api/crm/tasks/${detailFor.id}/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dependsOnTaskId }),
    });
    setBusy("");
    if (!result.ok) {
      setMessage(result.message || "Dependency could not be added.");
      return;
    }
    const depsResult = await requestJson<{ rows?: Dependency[] }>(`/api/crm/tasks/${detailFor.id}/dependencies`);
    if (depsResult.ok) setDependencies(Array.isArray(depsResult.rows) ? depsResult.rows : []);
  }

  async function removeDependency(dependsOnTaskId: string) {
    if (!detailFor) return;
    setBusy(`remove-dependency:${dependsOnTaskId}`);
    const result = await requestJson(`/api/crm/tasks/${detailFor.id}/dependencies/${dependsOnTaskId}`, { method: "DELETE" });
    setBusy("");
    if (!result.ok) {
      setMessage(result.message || "Dependency could not be removed.");
      return;
    }
    setDependencies((current) => current.filter((dep) => dep.dependsOnTaskId !== dependsOnTaskId));
  }

  async function reassign(record: TaskRow, assignedTo: string) {
    setBusy(`reassign:${record.id}`);
    setMessage("");
    const result = await requestJson(`/api/crm/tasks/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo, expectedUpdatedAt: record.updatedAt, expectedStatus: record.status }),
    });
    setBusy("");
    setMessage(result.message || (result.ok ? "Task reassigned." : "Task could not be reassigned."));
    if (result.ok) {
      setReassignTarget(null);
      await refresh();
    }
  }

  return (
    <section className={styles.workspace} aria-label="Tasks workspace">
      <div className={styles.toolbar}>
        <nav aria-label="Task view" className={styles.filters}>
          {(["mine", "team", "all"] as const).map((value) => (
            <ActionButton
              key={value}
              type="button"
              tone={view === value ? "primary" : "quiet"}
              onClick={() => router.push(queryHref({ nextView: value, nextTeamId: value === "team" ? teamId || myTeams[0]?.id || "" : "", nextPage: 1 }))}
            >
              {value === "mine" ? "My Tasks" : value === "team" ? "Team/Queue Tasks" : "All authorized Tasks"}
            </ActionButton>
          ))}
        </nav>
        {view === "team" && myTeams.length ? (
          <FormField label="Team" htmlFor="tasks-team-picker">
            <select
              id="tasks-team-picker"
              value={teamId}
              onChange={(event) => router.push(queryHref({ nextTeamId: event.target.value, nextPage: 1 }))}
            >
              {myTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </FormField>
        ) : null}
        <form method="get" className={styles.filters}>
          <input type="hidden" name="activityType" value="task" />
          {view !== "mine" ? <input type="hidden" name="view" value={view} /> : null}
          {view === "team" && teamId ? <input type="hidden" name="teamId" value={teamId} /> : null}
          <label><span>Search Tasks</span><input name="search" defaultValue={search} placeholder="Subject or notes" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="all">All statuses</option>{["planned", "in_progress", "overdue", "completed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label><span>Due</span><select name="due" defaultValue={due}><option value="all">Any date</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option></select></label>
          <button className="secondary-button" type="submit">Apply</button>
        </form>
        {canManage ? <div className={styles.createActions}><ActionButton tone="primary" type="button" onClick={() => openEditor("create")}>New Task</ActionButton></div> : null}
      </div>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div className={styles.summary}>
        <strong>{total}</strong>
        <span>matching Task{total === 1 ? "" : "s"}</span>
        <span>{view === "team" ? "Unclaimed Tasks are visible to every authorized Team member." : "Switch views to see Team queues you belong to."}</span>
      </div>

      {(() => {
        const statusTone = (record: TaskRow) =>
          record.status === "completed" ? "success" : record.status === "cancelled" ? "danger" : record.status === "overdue" ? "danger" : "neutral";
        const isMine = (record: TaskRow) => record.assignedTo === currentUserId;
        const isQueued = (record: TaskRow) => Boolean(record.teamId) && !record.assignedTo;
        const canClaim = (record: TaskRow) => isQueued(record) && myTeams.some((team) => team.id === record.teamId);
        const canRelease = (record: TaskRow) => Boolean(record.teamId) && Boolean(record.assignedTo) && (isMine(record) || canManage || myTeams.some((team) => team.id === record.teamId && team.managerUserId === currentUserId));
        const actions = (record: TaskRow) => (
          <>
            <ActionButton tone="quiet" type="button" disabled={busy === `detail:${record.id}`} onClick={() => void showDetail(record)}>Detail</ActionButton>
            {canClaim(record) ? (
              <ActionButton tone="primary" type="button" disabled={Boolean(busy)} onClick={() => void claim(record)}>Claim</ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton type="button" onClick={() => openEditor("edit", record)}>Edit</ActionButton>
            ) : null}
            {(isMine(record) || canManage) && !["completed", "cancelled"].includes(record.status) && record.status === "planned" ? (
              <ActionButton type="button" disabled={Boolean(busy)} onClick={() => void transition(record, "start")}>Start</ActionButton>
            ) : null}
            {(isMine(record) || canManage) && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton tone="primary" type="button" disabled={Boolean(busy)} onClick={() => void transition(record, "complete")}>Complete</ActionButton>
            ) : null}
            {canRelease(record) ? (
              <ActionButton type="button" disabled={Boolean(busy)} onClick={() => void release(record)}>Release</ActionButton>
            ) : null}
            {canManage && record.assignedTo && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton type="button" disabled={Boolean(busy)} onClick={() => setReassignTarget(record)}>Reassign</ActionButton>
            ) : null}
            {canManage && !["completed", "cancelled"].includes(record.status) ? (
              <ActionButton tone="quiet" type="button" disabled={Boolean(busy)} onClick={() => setCancelTarget(record)}>Cancel</ActionButton>
            ) : null}
          </>
        );
        const columns: DataGridColumn<TaskRow>[] = [
          {
            id: "task",
            header: "Task",
            cell: (record) => (
              <>
                <strong>{record.subject}</strong>
                <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                <StatusBadge tone={record.priority === "urgent" || record.priority === "high" ? "danger" : "neutral"}>{label(record.priority)}</StatusBadge>
                {record.recurrenceConfig ? <StatusBadge tone="neutral">↻ Recurring</StatusBadge> : null}
                {record.taskSource !== "user_created" ? <StatusBadge tone="neutral">Auto-generated</StatusBadge> : null}
                {isQueued(record) ? <StatusBadge tone="warning">Unclaimed</StatusBadge> : null}
              </>
            ),
          },
          {
            id: "detail",
            header: "Detail",
            cell: (record) => (
              <>
                <p>
                  {record.teamId ? `Team: ${record.teamName || "—"}${record.assignedTo ? ` · ${record.assignedName || "Claimed"}` : " · Unclaimed"}` : record.assignedName || "Unassigned"}
                  {record.entityType !== "general" && record.entityId ? (
                    <> · <a href={`/crm/${RELATION_OPTIONS[record.entityType]}/${record.entityId}`}>{label(record.entityType === "party" ? "account" : record.entityType)}</a></>
                  ) : null}
                </p>
                <small>Due {formatDate(record.dueAt)}{record.recurrenceConfig ? ` · ${describeRecurrence(record.recurrenceConfig, record.dueAt)}` : ""}</small>
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
            caption="Tasks"
            rows={rows}
            rowKey={(record) => record.id}
            columns={columns}
            emptyState={<StatePanel title="No Tasks match this view" description="Create a Task, or change the current filters." />}
            renderMobileCard={(record) => (
              <article className={styles.row}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTitle}>
                    <strong>{record.subject}</strong>
                    <StatusBadge tone={statusTone(record)}>{label(record.status)}</StatusBadge>
                  </div>
                  <p>{record.teamId ? `Team: ${record.teamName || "—"}` : record.assignedName || "Unassigned"}</p>
                  <small>Due {formatDate(record.dueAt)}</small>
                </div>
                <div className={styles.rowActions}>{actions(record)}</div>
              </article>
            )}
          />
        );
      })()}

      {totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Task pages">
          <button className="secondary-button" disabled={page <= 1} onClick={() => router.push(queryHref({ nextPage: page - 1 }))}>Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button className="secondary-button" disabled={page >= totalPages} onClick={() => router.push(queryHref({ nextPage: page + 1 }))}>Next</button>
        </nav>
      ) : null}

      {editor ? (
        <Dialog title={editor.mode === "edit" ? "Edit Task" : "New Task"} description="Tasks" onClose={() => setEditor(null)} canDismiss={busy !== "save"} busy={busy === "save"}>
          <TaskForm editor={editor} options={options} myTeams={myTeams} onSave={save} busy={busy === "save"} />
        </Dialog>
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          title="Cancel Task?"
          description={cancelTarget.subject}
          onClose={() => setCancelTarget(null)}
          onConfirm={() => void confirmCancel()}
          confirmLabel="Cancel Task"
          cancelLabel="Keep Task"
          busy={busy === `cancel:${cancelTarget.id}`}
        />
      ) : null}

      {reassignTarget ? (
        <ReassignDialog
          record={reassignTarget}
          options={options}
          onClose={() => setReassignTarget(null)}
          onConfirm={(assignedTo) => void reassign(reassignTarget, assignedTo)}
          busy={busy === `reassign:${reassignTarget.id}`}
        />
      ) : null}

      {detailFor ? (
        <Dialog title={detailFor.subject} description="Task detail" onClose={() => setDetailFor(null)}>
          <div className={styles.detail}>
            <section>
              <h3>Recurrence</h3>
              <p>{describeRecurrence(detailFor.recurrenceConfig, detailFor.dueAt)}</p>
              {detailFor.recurrenceParentId ? <p><small>Part of a recurring series — this Task was generated from an earlier occurrence.</small></p> : null}
            </section>
            <section>
              <h3>Dependencies</h3>
              <DependencySection
                dependencies={dependencies}
                onAdd={addDependency}
                onRemove={removeDependency}
                busy={busy}
              />
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
                )) : <p>No Task events were recorded.</p>}
              </div>
            </section>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function ReassignDialog({ record, options, onClose, onConfirm, busy }: {
  record: TaskRow;
  options: Options;
  onClose: () => void;
  onConfirm: (assignedTo: string) => void;
  busy: boolean;
}) {
  const [assignedTo, setAssignedTo] = useState(record.assignedTo || "");
  return (
    <Dialog title={record.subject} description="Reassign Task" onClose={onClose} canDismiss={!busy} busy={busy}>
      <form onSubmit={(event) => { event.preventDefault(); if (assignedTo) onConfirm(assignedTo); }} className={styles.form}>
        <FormField label="New assignee" htmlFor="task-reassign-user" required>
          <select id="task-reassign-user" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} required>
            <option value="">Select a person</option>
            {(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </FormField>
        <div className={styles.formActions}>
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={busy || !assignedTo}>{busy ? "Reassigning…" : "Reassign"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function DependencySection({ dependencies, onAdd, onRemove, busy }: {
  dependencies: Dependency[];
  onAdd: (dependsOnTaskId: string) => void;
  onRemove: (dependsOnTaskId: string) => void;
  busy: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskRow[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // The short-query "clear" happens in the input's own onChange (a real
    // user event, not an effect) — this effect only ever runs the
    // debounced fetch itself, avoiding a synchronous setState at the top
    // of the effect body (react-hooks/set-state-in-effect).
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await requestJson<{ rows?: TaskRow[] }>(`/api/crm/tasks?search=${encodeURIComponent(query.trim())}&limit=8`);
      if (cancelled) return;
      setSearching(false);
      if (result.ok) setResults(Array.isArray(result.rows) ? result.rows : []);
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  return (
    <div>
      {dependencies.length ? (
        <ul className={styles.reminders}>
          {dependencies.map((dep) => (
            <li key={dep.id}>
              <span>
                {dep.dependsOnSubject || "Task"}
                {dep.dependsOnStatus ? <StatusBadge tone={["completed"].includes(dep.dependsOnStatus) ? "success" : "warning"}>{label(dep.dependsOnStatus)}</StatusBadge> : null}
              </span>
              <button className="secondary-button" type="button" disabled={busy === `remove-dependency:${dep.dependsOnTaskId}`} onClick={() => onRemove(dep.dependsOnTaskId)}>
                {busy === `remove-dependency:${dep.dependsOnTaskId}` ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No dependencies — this Task can be completed on its own.</p>
      )}
      <FormField label="Block this Task on another Task" htmlFor="task-dependency-search" hint="Search by subject; this Task cannot complete until the selected one does.">
        <input
          id="task-dependency-search"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length < 2) setResults([]);
          }}
          placeholder="Search Tasks…"
        />
      </FormField>
      {searching ? <p><small>Searching…</small></p> : null}
      {results.length ? (
        <ul className={styles.reminders}>
          {results.filter((row) => !dependencies.some((dep) => dep.dependsOnTaskId === row.id)).map((row) => (
            <li key={row.id}>
              <span>{row.subject}</span>
              <button className="secondary-button" type="button" disabled={busy === "add-dependency"} onClick={() => { onAdd(row.id); setQuery(""); setResults([]); }}>
                Add
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TaskForm({ editor, options, myTeams, onSave, busy }: {
  editor: { mode: "create" | "edit"; record?: TaskRow };
  options: Options;
  myTeams: Team[];
  onSave: (body: Record<string, unknown>, id?: string) => void;
  busy: boolean;
}) {
  const record = editor.record;
  const [relationType, setRelationType] = useState<TaskRow["entityType"]>(record?.entityType || "general");
  const [assignmentMode, setAssignmentMode] = useState<"me" | "person" | "queue">(
    record?.teamId ? "queue" : record?.assignedTo ? "person" : "me",
  );
  const [teamId, setTeamId] = useState(record?.teamId || myTeams[0]?.id || "");
  const [teamMembers, setTeamMembers] = useState<Member[]>([]);
  const [queueAssignee, setQueueAssignee] = useState(record?.assignedTo || "");
  const [freq, setFreq] = useState<"" | "daily" | "weekly" | "monthly">(record?.recurrenceConfig?.freq || "");
  const [interval, setIntervalValue] = useState(record?.recurrenceConfig?.interval || 1);
  const [byWeekday, setByWeekday] = useState<number[]>(record?.recurrenceConfig?.byWeekday || []);
  const [endMode, setEndMode] = useState<"never" | "count" | "until">(
    record?.recurrenceConfig?.count ? "count" : record?.recurrenceConfig?.until ? "until" : "never",
  );
  const [count, setCount] = useState(record?.recurrenceConfig?.count || 5);
  const [until, setUntil] = useState(record?.recurrenceConfig?.until ? record.recurrenceConfig.until.slice(0, 10) : "");
  const [dueAt, setDueAt] = useState(localDateTime(record?.dueAt));

  const relationChoices = useMemo(() => {
    const key = RELATION_OPTIONS[relationType];
    return key ? options[key] || [] : [];
  }, [options, relationType]);

  useEffect(() => {
    // Clearing on mode/team change happens in the radio/select onChange
    // handlers below (real user events) — this effect only ever runs the
    // fetch itself, avoiding a synchronous setState at the top of the
    // effect body (react-hooks/set-state-in-effect).
    if (assignmentMode !== "queue" || !teamId) return;
    let cancelled = false;
    void requestJson<{ members?: Member[] }>(`/api/crm/tasks/teams/${teamId}/members`).then((result) => {
      if (!cancelled && result.ok) setTeamMembers(Array.isArray(result.members) ? result.members : []);
    });
    return () => { cancelled = true; };
  }, [assignmentMode, teamId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const entityType = String(form.get("entityType") || "general");
    const recurrenceConfig = freq
      ? {
          freq,
          interval: Math.max(1, Number(interval) || 1),
          ...(freq === "weekly" && byWeekday.length ? { byWeekday } : {}),
          ...(endMode === "count" ? { count: Math.max(1, Number(count) || 1) } : {}),
          ...(endMode === "until" && until ? { until: new Date(until).toISOString() } : {}),
        }
      : null;
    const body: Record<string, unknown> = {
      subject: String(form.get("subject") || ""),
      description: String(form.get("description") || "").trim() || null,
      entityType,
      entityId: entityType === "general" ? null : String(form.get("entityId") || "").trim() || null,
      priority: String(form.get("priority") || "medium"),
      dueAt: dueAt || null,
      startAt: String(form.get("startAt") || "").trim() || null,
      reminderAt: String(form.get("reminderAt") || "").trim() || null,
      recurrenceConfig,
      assignedTo: assignmentMode === "queue" ? (queueAssignee || null) : assignmentMode === "person" ? String(form.get("assignedTo") || "") || null : null,
      teamId: assignmentMode === "queue" ? teamId : null,
    };
    if (editor.mode === "edit" && record) {
      body.expectedUpdatedAt = record.updatedAt;
      body.expectedStatus = record.status;
    }
    onSave(body, record?.id);
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.formWide}>
        <FormField label="Title" htmlFor="task-form-subject" required>
          <input id="task-form-subject" name="subject" maxLength={300} required defaultValue={record?.subject || ""} />
        </FormField>
      </div>
      <FormField label="Related record type" htmlFor="task-form-entity-type">
        <select id="task-form-entity-type" name="entityType" value={relationType} onChange={(event) => setRelationType(event.target.value as TaskRow["entityType"])}>
          {["general", "lead", "opportunity", "party", "contact", "campaign"].map((value) => (
            <option key={value} value={value}>{value === "party" ? "Account" : label(value)}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Related record" htmlFor="task-form-entity-id" required={relationType !== "general"}>
        <select id="task-form-entity-id" name="entityId" disabled={relationType === "general"} required={relationType !== "general"} defaultValue={record?.entityType === relationType ? record.entityId || "" : ""}>
          <option value="">{relationType === "general" ? "No related record" : "Select record"}</option>
          {relationChoices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </FormField>

      <fieldset className={styles.formWide}>
        <legend>Assignment</legend>
        <label className="crm-suite-check"><input type="radio" name="assignmentMode" checked={assignmentMode === "me"} onChange={() => { setAssignmentMode("me"); setTeamMembers([]); }} /> <span>Assign to me</span></label>
        <label className="crm-suite-check"><input type="radio" name="assignmentMode" checked={assignmentMode === "person"} onChange={() => { setAssignmentMode("person"); setTeamMembers([]); }} /> <span>Assign to a person</span></label>
        {myTeams.length ? (
          <label className="crm-suite-check"><input type="radio" name="assignmentMode" checked={assignmentMode === "queue"} onChange={() => setAssignmentMode("queue")} /> <span>Queue to a Team</span></label>
        ) : null}
      </fieldset>
      {assignmentMode === "person" ? (
        <FormField label="Assignee" htmlFor="task-form-assigned-to" required>
          <select id="task-form-assigned-to" name="assignedTo" required defaultValue={record?.assignedTo || ""}>
            <option value="">Select a person</option>
            {(options.users || []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </FormField>
      ) : null}
      {assignmentMode === "queue" ? (
        <>
          <FormField label="Team" htmlFor="task-form-team" required>
            <select id="task-form-team" value={teamId} onChange={(event) => { setTeamId(event.target.value); setQueueAssignee(""); setTeamMembers([]); }} required>
              {myTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </FormField>
          <FormField label="Assign directly to (optional)" htmlFor="task-form-queue-assignee" hint="Leave unclaimed so any authorized Team member can claim it.">
            <select id="task-form-queue-assignee" value={queueAssignee} onChange={(event) => setQueueAssignee(event.target.value)}>
              <option value="">Leave unclaimed</option>
              {teamMembers.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}
            </select>
          </FormField>
        </>
      ) : null}

      <FormField label="Priority" htmlFor="task-form-priority">
        <select id="task-form-priority" name="priority" defaultValue={record?.priority || "medium"}>
          {["low", "medium", "high", "urgent"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
        </select>
      </FormField>
      <FormField label="Due" htmlFor="task-form-due-at">
        <input id="task-form-due-at" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      </FormField>
      <FormField label="Start" htmlFor="task-form-start-at">
        <input id="task-form-start-at" name="startAt" type="datetime-local" defaultValue={localDateTime(record?.startAt)} />
      </FormField>
      <FormField label="Reminder" htmlFor="task-form-reminder-at">
        <input id="task-form-reminder-at" name="reminderAt" type="datetime-local" defaultValue={localDateTime(record?.reminderAt)} />
      </FormField>

      <fieldset className={styles.formWide}>
        <legend>Recurrence</legend>
        <FormField label="Repeats" htmlFor="task-form-recurrence-freq">
          <select id="task-form-recurrence-freq" value={freq} onChange={(event) => setFreq(event.target.value as typeof freq)}>
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </FormField>
        {freq ? (
          <>
            <FormField label={`Every N ${freq === "daily" ? "days" : freq === "weekly" ? "weeks" : "months"}`} htmlFor="task-form-recurrence-interval">
              <input id="task-form-recurrence-interval" type="number" min={1} max={365} value={interval} onChange={(event) => setIntervalValue(Number(event.target.value) || 1)} />
            </FormField>
            {freq === "weekly" ? (
              <div className={styles.formWide}>
                <span>On these days</span>
                {WEEKDAY_SHORT.map((day, index) => (
                  <label key={day} className="crm-suite-check">
                    <input
                      type="checkbox"
                      checked={byWeekday.includes(index)}
                      onChange={(event) => setByWeekday((current) => (event.target.checked ? [...current, index] : current.filter((d) => d !== index)))}
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <FormField label="Ends" htmlFor="task-form-recurrence-end">
              <select id="task-form-recurrence-end" value={endMode} onChange={(event) => setEndMode(event.target.value as typeof endMode)}>
                <option value="never">Never</option>
                <option value="count">After N occurrences</option>
                <option value="until">On date</option>
              </select>
            </FormField>
            {endMode === "count" ? (
              <FormField label="Occurrences" htmlFor="task-form-recurrence-count">
                <input id="task-form-recurrence-count" type="number" min={1} max={500} value={count} onChange={(event) => setCount(Number(event.target.value) || 1)} />
              </FormField>
            ) : null}
            {endMode === "until" ? (
              <FormField label="End date" htmlFor="task-form-recurrence-until">
                <input id="task-form-recurrence-until" type="date" value={until} onChange={(event) => setUntil(event.target.value)} />
              </FormField>
            ) : null}
            <p className={styles.formWide}><small>{describeRecurrence({ freq: freq as "daily" | "weekly" | "monthly", interval, byWeekday, count: endMode === "count" ? count : undefined, until: endMode === "until" ? until : undefined }, dueAt || record?.dueAt)}</small></p>
          </>
        ) : null}
      </fieldset>

      <div className={styles.formWide}>
        <FormField label="Description" htmlFor="task-form-description">
          <textarea id="task-form-description" name="description" maxLength={4000} rows={4} defaultValue={record?.description || ""} />
        </FormField>
      </div>
      <div className={styles.formActions}>
        <ActionButton tone="primary" type="submit" busy={busy}>{busy ? "Saving…" : editor.mode === "edit" ? "Save changes" : "Create Task"}</ActionButton>
      </div>
    </form>
  );
}
