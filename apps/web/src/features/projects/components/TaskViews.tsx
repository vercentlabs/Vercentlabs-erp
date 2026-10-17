"use client";

// The pieces every task screen shares: the task table (optionally grouped by project, milestone or assignee), the status board, and the
// quick "Add task" dialog. The board moves a card through the same server transition as the task page — a move the rules refuse snaps back
// with the reason; nothing is skipped because it was dragged.
import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { Notice } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  TASKS_BASE, TASK_BLOCKER_LABEL, TASK_STATUS_TEXT, TASK_TONE, TASK_TYPE_LABEL, createTask, dateLabel, dueLabel, errorMessage, getMembers, newKey, taskAction,
  type ProjectTasks, type TaskRow, type TaskStatus, type Priority } from "../api/projects-api";
import { AssignTaskDialog } from "../assignees/AssignTaskDialog";
import { NeedsOwnerBadge } from "../assignees/AssigneeViews";
import { PriorityBadge, PriorityField } from "../priority/Priority";

export type GroupBy = "none" | "project" | "milestone" | "assignee";
export const GROUP_OPTIONS = [{ value: "none", label: "No grouping" }, { value: "project", label: "By project" }, { value: "milestone", label: "By milestone" }, { value: "assignee", label: "By assignee" }];

function DueText({ row }: { row: TaskRow }) {
  const due = dueLabel(row);
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">{dateLabel(row.dueDate)}</span>
      {row.rescheduled && <span className="text-xs text-text-muted">{`was ${dateLabel(row.originalDueDate)}`}</span>}
      {due && <span className={row.overdue ? "text-xs text-danger" : "text-xs text-text-muted"}>{due}</span>}
    </span>
  );
}

const groupKey = (row: TaskRow, by: GroupBy) => (by === "project" ? `${row.projectCode ?? ""} ${row.projectName ?? ""}`.trim() || "Project"
  : by === "milestone" ? (row.milestone ? `${row.milestone.code} ${row.milestone.name}` : "No milestone") : by === "assignee" ? row.assignee ?? "Unassigned" : "");

export function TaskTable({ rows, groupBy = "none", showProject = true }: { rows: TaskRow[]; groupBy?: GroupBy; showProject?: boolean }) {
  const [assigning, setAssigning] = useState<TaskRow | null>(null);
  const groups = groupBy === "none" ? [["", rows] as const] : [...rows.reduce((map, row) => map.set(groupKey(row, groupBy), [...(map.get(groupKey(row, groupBy)) ?? []), row]), new Map<string, TaskRow[]>()).entries()];
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([label, list]) => (
        <div key={label || "all"} className="flex flex-col gap-1">
          {label && <h3 className="text-sm font-semibold">{`${label} · ${list.length}`}</h3>}
          <LinesTable columns={["Task", ...(showProject ? ["Project"] : []), "Milestone", "Assigned to", "Status", "Priority", "Due", "Checklist", "Updated"]}>
            {list.map((row) => (
              <tr key={row.id} className={row.status === "CANCELLED" ? "opacity-60" : undefined}>
                <Cell><span className="flex flex-col"><Link className="font-medium text-brand hover:underline" href={`${TASKS_BASE}/${row.id}`}>{row.title}</Link>
                  <span className="text-xs text-text-muted">{`${row.code}${row.reviewRequired ? " · review" : ""}${row.tags.length ? ` · ${row.tags.join(", ")}` : ""}`}</span></span></Cell>
                {showProject && <Cell>{row.projectCode}</Cell>}
                <Cell>{row.milestone ? row.milestone.code : null}</Cell>
                <Cell><span className="flex flex-col items-start">
                  <span>{row.assignee}{row.needsOwner && <NeedsOwnerBadge />}</span>
                  {["TO_DO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(row.status) && <button type="button" className="text-xs text-brand hover:underline" onClick={() => setAssigning(row)}>Reassign</button>}
                </span></Cell>
                <Cell><StatusBadge tone={TASK_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
                <Cell><PriorityBadge priority={row.priority} /></Cell>
                <Cell><DueText row={row} /></Cell>
                <Cell>{row.checklist?.total ? `${row.checklist.done} / ${row.checklist.total}` : null}</Cell>
                <Cell>{dateLabel(row.updatedAt)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </div>
      ))}
      {assigning && <AssignTaskDialog taskId={assigning.id} projectId={assigning.projectId} onClose={() => setAssigning(null)} onDone={() => undefined} />}
    </div>
  );
}

// ------------------------------------------------------------------ the board
const COLUMNS: TaskStatus[] = ["TO_DO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE"];
const MOVE_OPTIONS = COLUMNS.map((status) => ({ value: status, label: `Move to ${TASK_STATUS_TEXT[status].toLowerCase()}` }));

export function TaskBoard({ rows, onChanged }: { rows: TaskRow[]; onChanged: () => Promise<void> }) {
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [assigning, setAssigning] = useState<TaskRow | null>(null);
  const statusOf = (row: TaskRow) => moved[row.id] ?? row.status;
  // The card moves at once and snaps back if the server refuses.
  const move = async (row: TaskRow, to: TaskStatus, input: Record<string, unknown> = {}) => {
    if (statusOf(row) === to) return;
    setMoved((current) => ({ ...current, [row.id]: to }));
    setMessage(null);
    try {
      await taskAction(row.id, "transition", { to, expectedVersion: row.version, idempotencyKey: newKey(), ...input });
      await onChanged();
      setMessage({ tone: "success", text: `${row.code} moved to ${TASK_STATUS_TEXT[to].toLowerCase()}.` });
    } catch (failure) {
      setMessage({ tone: "danger", text: `${row.code}: ${errorMessage(failure)}` });
    } finally {
      setMoved((current) => { const next = { ...current }; delete next[row.id]; return next; });
    }
  };
  const request = (row: TaskRow, to: TaskStatus) => {
    if (to === "BLOCKED") {
      setAsk({ title: `Block ${row.code}`, confirm: "Mark blocked", fields: [
        { name: "reason", label: "Why", kind: "select", options: Object.entries(TASK_BLOCKER_LABEL).map(([value, label]) => ({ value, label })), initial: "OTHER" },
        { name: "description", label: "What is blocking it", kind: "textarea", required: true }],
        run: (values) => move(row, "BLOCKED", { reason: values.reason, description: values.description }) });
      return;
    }
    if (to === "IN_PROGRESS" && row.status === "DONE") {
      setAsk({ title: `Reopen ${row.code}`, confirm: "Reopen", tone: "danger", fields: [{ name: "reason", label: "Why it is reopened", kind: "textarea", required: true }],
        run: (values) => move(row, "IN_PROGRESS", { reason: values.reason }) });
      return;
    }
    void move(row, to);
  };
  const drop = (event: DragEvent, to: TaskStatus) => {
    event.preventDefault();
    setOver(null);
    const row = rows.find((entry) => entry.id === event.dataTransfer.getData("text/plain"));
    if (row) request(row, to);
  };
  const visible = rows.filter((row) => row.status !== "CANCELLED");
  return (
    <div className="flex flex-col gap-2">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {COLUMNS.map((column) => {
          const cards = visible.filter((row) => statusOf(row) === column);
          return (
            <section key={column} aria-label={TASK_STATUS_TEXT[column]} onDragOver={(event) => { event.preventDefault(); setOver(column); }} onDragLeave={() => setOver(null)} onDrop={(event) => drop(event, column)}
              className={`flex min-h-32 min-w-56 flex-col gap-2 rounded-md border p-2 ${over === column ? "border-brand bg-surface-muted" : "border-border bg-surface"}`}>
              <h3 className="flex items-center justify-between text-sm font-semibold"><span>{TASK_STATUS_TEXT[column]}</span><span className="text-text-muted">{cards.length}</span></h3>
              {cards.map((row) => (
                <article key={row.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", row.id)}
                  className="flex cursor-grab flex-col gap-1 rounded-md border border-border bg-surface p-2 text-sm shadow-sm">
                  <Link className="font-medium text-brand hover:underline" href={`${TASKS_BASE}/${row.id}`}>{row.title}</Link>
                  <span className="text-xs text-text-muted">{[row.code, row.assignee, row.milestone?.code].filter(Boolean).join(" · ")}</span>
                  <span className="flex flex-wrap items-center gap-1 text-xs">
                    <PriorityBadge priority={row.priority} />
                    <span className={row.overdue ? "text-danger" : "text-text-muted"}>{dueLabel(row) ?? dateLabel(row.dueDate)}</span>
                    {row.checklist?.total ? <span className="text-text-muted">{`☑ ${row.checklist.done}/${row.checklist.total}`}</span> : null}
                    {row.reviewRequired && <span className="text-text-muted">review</span>}
                    {row.needsOwner && <NeedsOwnerBadge />}
                  </span>
                  {statusOf(row) !== "DONE" && <button type="button" className="self-start text-xs text-brand hover:underline" onClick={() => setAssigning(row)}>Reassign</button>}
                  <Select aria-label={`Move ${row.code}`} size="compact" placeholder="Move…" selectedKey={null} options={MOVE_OPTIONS.filter((option) => option.value !== statusOf(row))}
                    onSelectionChange={(key) => key && request(row, String(key) as TaskStatus)} />
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <p className="text-xs text-text-muted">Drag a card, or use its Move menu. Each move is checked like the task page: earlier tasks, the checklist, evidence and review all still apply.</p>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {assigning && <AssignTaskDialog taskId={assigning.id} projectId={assigning.projectId} onClose={() => setAssigning(null)} onDone={async (text) => { await onChanged(); setMessage({ tone: "success", text }); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ add a task
export function AddTaskDialog({ data, managerId, managerName, onClose }: { data: ProjectTasks; managerId: string | null; managerName: string | null; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const submit = useSubmitKey();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", data.projectId), queryFn: () => getMembers(data.projectId) });
  const [form, setForm] = useState({ title: "", assigneeUserId: "", dueDate: "", priority: "NORMAL", milestoneId: "", description: "", type: "GENERAL", plannedStartDate: "", hours: "",
    tags: "", reviewerUserId: "", checklist: "" });
  const [review, setReview] = useState(data.reviewDefault);
  const [evidence, setEvidence] = useState(false);
  const [more, setMore] = useState(false);
  const [another, setAnother] = useState(false);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const set = (name: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [name]: value }));
  const people = [...new Map([...(managerId ? [[managerId, managerName ?? "Project Manager"] as const] : []),
    ...(team.data?.members ?? []).filter((row) => row.active && ["MANAGER", "MEMBER"].includes(row.role) && row.accountActive !== false).map((row) => [row.userId, row.name] as const)]).entries()]
    .map(([value, label]) => ({ value, label }));
  const milestones = [{ value: "", label: "No milestone" }, ...data.milestones.filter((row) => row.linkable).map((row) => ({ value: row.id, label: `${row.code} ${row.name}` }))];
  const ready = form.title.trim().length >= 2 && Boolean(form.assigneeUserId) && Boolean(form.dueDate) && !busy && !done;
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Add task · ${data.projectCode}`} size="lg">
      <div className="flex flex-col gap-3">
        {added && <Notice tone="success">{`${added} added. Add the next one, or close.`}</Notice>}
        <TextField label="Task" value={form.title} onChange={set("title")} isRequired maxLength={200} description="What someone needs to do — e.g. Import customer master data." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Assigned to" selectedKey={form.assigneeUserId || null} onSelectionChange={(next) => set("assigneeUserId")(String(next))} options={people} isRequired
            description="The Project Manager or a project member." />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} isRequired />
          <PriorityField value={form.priority as Priority} onChange={(next) => set("priority")(next)} />
          <Select label="Milestone" selectedKey={form.milestoneId} onSelectionChange={(next) => set("milestoneId")(String(next ?? ""))} options={milestones} />
        </div>
        <Button variant="ghost" size="compact" onPress={() => setMore(!more)}>{more ? "Fewer details" : "More details"}</Button>
        {more && (
          <>
            <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} description="Instructions for whoever does it." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Type" selectedKey={form.type} onSelectionChange={(next) => set("type")(String(next))} options={Object.entries(TASK_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
              <TextField label="Start date" type="date" value={form.plannedStartDate} onChange={set("plannedStartDate")} />
              <TextField label="Estimated effort (hours)" inputMode="decimal" value={form.hours} onChange={set("hours")} />
              <TextField label="Tags" value={form.tags} onChange={set("tags")} description="Comma separated." />
            </div>
            <TextArea label="Checklist (one step per line)" value={form.checklist} onChange={set("checklist")} maxLength={5000} description="Each step is required; mark optional ones on the task." />
            <Checkbox isSelected={review} onChange={setReview}>Needs review before it is done</Checkbox>
            {review && <Select label="Reviewer" selectedKey={form.reviewerUserId || null} onSelectionChange={(next) => set("reviewerUserId")(String(next ?? ""))}
              options={[{ value: "", label: "Anyone who reviews on the project" }, ...people]} />}
            <Checkbox isSelected={evidence} onChange={setEvidence}>Needs completion evidence (a note, a file or a document reference)</Checkbox>
          </>
        )}
        <Checkbox isSelected={another} onChange={setAnother}>Add another after this one</Checkbox>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await submit.run(() => createTask(data.projectId, {
                idempotencyKey: key, title: form.title, assigneeUserId: form.assigneeUserId, dueDate: form.dueDate, priority: form.priority, milestoneId: form.milestoneId || undefined,
                description: form.description || undefined, taskType: form.type, plannedStartDate: form.plannedStartDate || undefined,
                estimateMinutes: form.hours ? Math.round(Number(form.hours) * 60) : undefined, tags: form.tags || undefined, reviewRequired: review,
                reviewerUserId: review && form.reviewerUserId ? form.reviewerUserId : undefined, evidenceRequired: evidence,
                checklist: form.checklist.split("\n").map((line) => line.trim()).filter(Boolean),
              }));
              await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
              if (another) {
                setAdded(result.taskCode); setKey(newKey());
                setForm((current) => ({ ...current, title: "", description: "", checklist: "" }));
              } else { setDone(true); router.push(`${TASKS_BASE}/${result.taskId}`); }
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Add task</Button>
        </div>
      </div>
    </Dialog>
  );
}
