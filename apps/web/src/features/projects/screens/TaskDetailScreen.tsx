"use client";

// One task: what needs doing, who is responsible, when it is due, where it stands, whether it can be completed (and why not) and the next
// step. Its checklist, the earlier tasks it waits for and the ones waiting for it, its blockers, reviews, discussion, files, the time and
// expenses other modules hold against it, and its history. The toolbar offers only what the task's state, the project's state and the
// person's access allow; every action is checked again on the server.
import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask, type Field } from "@/shared/ui/AskDialog";
import {
  MILESTONES_BASE, PROJECTS_BASE, TASKS_BASE, TASK_BLOCKER_LABEL, TASK_TONE, TASK_TYPE_LABEL, dateLabel, dueLabel, errorMessage, errorStatus, getMembers,
  getProjectTasks, getTask, getTaskActivity, minutesLabel, newKey, removeTaskFile, taskAction, taskFileHref, updateTask, uploadTaskFile, type TaskCheck, type TaskDetail,
} from "../api/projects-api";
import { AssignTaskDialog } from "../assignees/AssignTaskDialog";
import { AssignmentHistory } from "../assignees/AssigneeViews";
import { PriorityBadge, PriorityDialog, PriorityField, priorityReasonMissing } from "../priority/Priority";
import { CommentThread, CommentsTabLabel } from "../collaboration/CommentThread";

const TABS = [{ id: "overview", label: "Overview" }, { id: "checklist", label: "Checklist" }, { id: "dependencies", label: "Dependencies" }, { id: "comments", label: "Comments" },
  { id: "files", label: "Files" }, { id: "time", label: "Time & expenses" }, { id: "activity", label: "Activity" }];
const CHECK_TONE = { PASS: "success", FAIL: "danger", WAIVED: "warning" } as const;
const CHECK_LABEL = { PASS: "Done", FAIL: "Outstanding", WAIVED: "By exception" } as const;
const DECISION = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected" } as const;
type Act = (action: string, input: Record<string, unknown>, text: string) => Promise<unknown>;

export function TaskDetailScreen({ taskId }: { taskId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task", taskId), queryFn: () => getTask(taskId), retry: false });
  const [tab, setTab] = useState(TABS.some((row) => row.id === params.get("tab")) ? params.get("tab")! : "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"edit" | "assign" | "priority" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the task" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to this task" description="Ask an administrator for access to project tasks." />;
    return <ErrorState title="Task not found" description={errorStatus(query.error) === 404 ? "It does not exist, or you are not on its project." : errorMessage(query.error)}
      action={{ label: "All tasks", onPress: () => router.push(TASKS_BASE) }} />;
  }
  const task = query.data;
  const can = task.can;
  const refresh = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); };
  const act: Act = (action, input, text) => taskAction(task.id, action, { expectedVersion: task.version, idempotencyKey: newKey(), ...input }).then(async (result) => { await refresh(text); return result; });
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const unmet = task.prerequisites.filter((row) => row.status !== "DONE");
  const exception: Field[] = unmet.length && can.edit ? [{ name: "exception", label: `Proceed before ${unmet.map((row) => row.code).join(", ")} — the reason (an authorized exception)`, kind: "textarea" }] : [];
  const evidence: Field[] = task.evidenceRequired ? [{ name: "note", label: "Completion note", kind: "textarea", initial: task.completionNote ?? "" },
    { name: "reference", label: "Document reference (e.g. REC-0042)", kind: "text", initial: task.evidenceReference ?? "" }] : [];
  const evidenceInput = (values: Record<string, string | boolean>) => (task.evidenceRequired ? { note: values.note || undefined, reference: values.reference || undefined } : {});
  const steps = [
    { id: "start", label: "Start task", show: can.start || can.startByException, run: () => setAsk({ title: `Start ${task.code}`, confirm: "Start",
      description: unmet.length ? `Waiting for ${unmet.map((row) => `${row.code} ${row.title}`).join(", ")}.` : "Work on the task begins.",
      fields: unmet.length && can.startByException ? [{ name: "exception", label: "Start anyway — the reason (an authorized exception)", kind: "textarea", required: true }] : [],
      run: (values) => act("start", { exceptionReason: values.exception || undefined }, "The task is in progress.") }) },
    { id: "submit", label: "Submit for review", show: can.submit, run: () => setAsk({ title: `Submit ${task.code} for review`, confirm: "Submit",
      description: "The checklist, evidence and files are kept exactly as they are now. To change them afterwards, withdraw it from review.",
      fields: [{ name: "reviewNote", label: "Note for the reviewer", kind: "textarea" }, ...evidence, ...exception],
      run: (values) => act("submit", { note: values.reviewNote || undefined, ...evidenceInput(values), exceptionReason: values.exception || undefined }, "Submitted for review.") }) },
    { id: "review", label: "Review", show: can.approve || can.requestChanges, run: () => setAsk({ title: `Review ${task.code}`, confirm: "Record the decision",
      fields: [{ name: "decision", label: "Decision", kind: "select", required: true, initial: can.approve ? "APPROVED" : "CHANGES_REQUESTED",
        options: [...(can.approve ? [{ value: "APPROVED", label: "Approve — the task is done" }] : []), ...(can.requestChanges ? [{ value: "CHANGES_REQUESTED", label: "Request changes" }, { value: "REJECTED", label: "Reject" }] : [])] },
        { name: "reason", label: "Reason (required to request changes or reject)", kind: "textarea" }],
      run: (values) => act("decide", { decision: values.decision, reason: values.reason || undefined }, values.decision === "APPROVED" ? "Approved: the task is done." : "Returned to the assignee with your reason.") }) },
    { id: "complete", label: "Complete task", show: can.complete, run: () => setAsk({ title: `Complete ${task.code}`, confirm: "Complete",
      description: "Every requirement is checked again: the checklist, evidence, earlier tasks and blockers.", fields: [...evidence, ...exception],
      run: (values) => act("complete", { ...evidenceInput(values), exceptionReason: values.exception || undefined }, "The task is done.") }) },
    { id: "reopen", label: "Reopen", show: can.reopen, run: () => setAsk({ title: `Reopen ${task.code}`, confirm: "Reopen", tone: "danger",
      description: "Back in progress. The original completion and reviews stay in the history.",
      fields: [{ name: "reason", label: "Why it is reopened", kind: "textarea", required: true },
        ...(task.milestone && ["SUBMITTED", "COMPLETED"].includes(task.milestone.status) ? [{ name: "milestone", label: `I have reviewed the impact on ${task.milestone.code} (${task.milestone.statusLabel.toLowerCase()}) — it is flagged for review, not reversed`, kind: "checkbox" as const }] : [])],
      run: (values) => act("reopen", { reason: values.reason, acknowledgeMilestone: Boolean(values.milestone) }, "Reopened: the task is in progress.") }) },
  ];
  const next = steps.find((row) => row.show);
  const activeDependents = task.dependents.filter((row) => row.status !== "CANCELLED");
  const more: MoreAction[] = [
    { id: "edit", label: "Edit", show: can.edit, run: () => setDialog("edit") },
    { id: "assign", label: "Reassign", show: can.assign, run: () => setDialog("assign") },
    { id: "priority", label: "Change priority", show: can.edit && ["TO_DO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(task.status), run: () => setDialog("priority") },
    ...steps.filter((row) => row.show && row.id !== next?.id),
    { id: "block", label: "Mark blocked", show: can.block, run: () => setAsk({ title: `Block ${task.code}`, confirm: "Mark blocked",
      description: "The task shows as blocked until every blocker is resolved; it then resumes where it was. The project is not put on hold.",
      fields: [{ name: "reason", label: "Why", kind: "select", options: Object.entries(TASK_BLOCKER_LABEL).map(([value, label]) => ({ value, label })), initial: "OTHER" },
        { name: "description", label: "What is blocking it", kind: "textarea", required: true }],
      run: (values) => act("block", { reason: values.reason, description: values.description }, "Marked blocked: the Project Manager was told.") }) },
    { id: "withdraw", label: "Withdraw from review", show: can.withdraw, run: () => setAsk({ title: "Withdraw from review", confirm: "Withdraw", fields: [{ name: "reason", label: "Why", kind: "textarea" }],
      run: (values) => act("withdraw", { reason: values.reason || undefined }, "Withdrawn from review.") }) },
    { id: "evidence", label: "Record evidence", show: can.evidence && task.status !== "IN_REVIEW", run: () => setAsk({ title: "Completion evidence", confirm: "Save",
      fields: [{ name: "note", label: "Completion note", kind: "textarea", initial: task.completionNote ?? "" }, { name: "reference", label: "Document reference", kind: "text", initial: task.evidenceReference ?? "" }],
      run: (values) => act("evidence", { note: values.note, reference: values.reference }, "Evidence saved.") }) },
    { id: "cancel", label: "Cancel task", show: can.cancel, run: () => setAsk({ title: `Cancel ${task.code}`, confirm: "Cancel the task", tone: "danger",
      description: activeDependents.length ? `${activeDependents.map((row) => row.code).join(", ")} wait for it: they will no longer. Time and expenses recorded against it stay.` : "It stays on record as cancelled and never counts as done. Time and expenses recorded against it stay.",
      fields: [{ name: "reason", label: "Why it is cancelled", kind: "textarea", required: true }, ...(activeDependents.length ? [{ name: "dependents", label: "I reviewed the tasks that wait for it", kind: "checkbox" as const }] : [])],
      run: (values) => act("cancel", { reason: values.reason, acknowledgeDependents: Boolean(values.dependents) }, "The task is cancelled.") }) },
    { id: "archive", label: "Archive", show: can.archive, run: () => act("archive", {}, "Archived: found under Archived.") },
    { id: "restore", label: "Restore from archive", show: can.restore, run: () => act("archive", { restore: true }, "Restored.") },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{task.title} <span className="text-base font-normal whitespace-nowrap text-text-muted">{task.code} · {task.typeLabel}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={TASK_TONE[task.status]}>{task.statusLabel}</StatusBadge>
              {task.reviewRequired && <StatusBadge tone={task.approvalStatus === "APPROVED" ? "success" : task.approvalStatus === "PENDING" ? "warning" : task.approvalStatus === "NOT_SUBMITTED" ? "neutral" : "danger"}>{task.approvalLabel}</StatusBadge>}
              {task.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
              {task.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            </span>
          ),
          fields: [
            { label: "Project", value: <Link className="text-brand hover:underline" href={`${PROJECTS_BASE}/${task.projectId}?tab=tasks`}>{`${task.projectCode}${task.projectName ? ` · ${task.projectName}` : ""}`}</Link> },
            { label: "Milestone", value: task.milestone ? <Link className="text-brand hover:underline" href={`${MILESTONES_BASE}/${task.milestone.id}`}>{`${task.milestone.code} ${task.milestone.name}`}</Link> : "None" },
            { label: "Assigned to", value: task.assignee ?? "—" },
            { label: "Due", value: `${dateLabel(task.dueDate)}${dueLabel(task) ? ` · ${dueLabel(task)}` : ""}` },
            { label: "Priority", value: <PriorityBadge priority={task.priority} /> },
            { label: "Checklist", value: task.checklistProgress.total ? `${task.checklistProgress.done} of ${task.checklistProgress.total}` : "None" },
          ],
          primaryAction: next ? <Button variant="primary" onPress={next.run}>{next.label}</Button> : undefined,
          secondaryActions: <MoreActions actions={more} />,
        }}
        tabs={
          <div className="flex flex-col gap-3">
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            {task.projectStatus === "ON_HOLD" && <Notice tone="warning">The project is on hold: the task can be discussed and planned, but not worked on until it resumes.</Notice>}
            {["COMPLETED", "CANCELLED"].includes(task.projectStatus) && <Notice tone="neutral">The project is closed: this task is read-only.</Notice>}
            {task.status === "IN_REVIEW" && <Notice tone="info">{`In review${task.reviewer ? ` with ${task.reviewer}` : ""}. What was submitted is locked; withdraw it from review to change it.`}</Notice>}
            {task.status === "BLOCKED" && <Notice tone="danger">{`Blocked: ${task.blockers.filter((row) => row.status === "ACTIVE").map((row) => `${row.description} (owner: ${row.owner ?? "—"})`).join("; ")}`}</Notice>}
            {task.approvalStatus === "CHANGES_REQUESTED" && <Notice tone="warning">{`Changes requested: ${task.reviews.find((row) => row.decision)?.decision?.reason ?? ""}`}</Notice>}
            {task.status === "CANCELLED" && <Notice tone="neutral">{`Cancelled ${task.cancelledAt ? formatDateTime(task.cancelledAt) : ""}${task.cancelledBy ? ` by ${task.cancelledBy}` : ""}: ${task.cancelReason ?? ""}`}</Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Task sections">{TABS.map((row) => <Tab key={row.id} id={row.id}>{row.id === "comments" ? <CommentsTabLabel parentType="TASK" parentId={task.id} /> : row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <OverviewTab task={task} act={act} setAsk={setAsk} />}
          {tab === "checklist" && <ChecklistTab task={task} act={act} setAsk={setAsk} />}
          {tab === "dependencies" && <DependenciesTab task={task} act={act} />}
          {tab === "comments" && <CommentThread parentType="TASK" parentId={task.id} />}
          {tab === "files" && <FilesTab task={task} onChanged={refresh} />}
          {tab === "time" && <TimeTab task={task} />}
          {tab === "activity" && <ActivityTab task={task} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "edit" && <EditDialog task={task} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "priority" && <PriorityDialog target={{ kind: "task", id: task.id, code: task.code, name: task.title, priority: task.priority, version: task.version }} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "assign" && <AssignTaskDialog taskId={task.id} projectId={task.projectId} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

type TabProps = { task: TaskDetail; act: Act; setAsk: (ask: Ask | null) => void };

function ChecksList({ checks }: { checks: TaskCheck[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((row) => (
        <li key={row.key} className="flex flex-col gap-0.5 rounded-md border border-border p-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <span className="flex flex-col"><span className="text-sm font-medium">{row.label}</span><span className="text-xs text-text-secondary">{row.message}</span></span>
          <StatusBadge tone={CHECK_TONE[row.state]}>{CHECK_LABEL[row.state]}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

function OverviewTab({ task, act, setAsk }: TabProps) {
  const open = ["TO_DO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"].includes(task.status);
  return (
    <div className="flex flex-col gap-4">
      {open && <Panel title={task.reviewRequired && task.status !== "IN_REVIEW" ? "Ready to submit for review?" : "Ready to complete?"} description={task.readiness.ready ? "Every requirement holds." : "Each outstanding requirement, and what to do about it."}>
        <ChecksList checks={task.readiness.checks} />
      </Panel>}
      <Panel title="Description">
        {task.description ? <p className="whitespace-pre-wrap text-sm">{task.description}</p> : <p className="text-sm text-text-muted">No description.</p>}
      </Panel>
      {task.blockers.length > 0 && (
        <Panel title="Blockers">
          <ul className="flex flex-col gap-2">
            {task.blockers.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{`${row.reasonLabel}: ${row.description}`}</span>
                  <span className="text-xs text-text-muted">{`Raised ${formatDateTime(row.raisedAt)}${row.raisedBy ? ` by ${row.raisedBy}` : ""} · owner ${row.owner ?? "—"}`}</span>
                  {row.status === "RESOLVED" && <span className="text-xs text-text-secondary">{`Resolved ${row.resolvedAt ? formatDateTime(row.resolvedAt) : ""}${row.resolvedBy ? ` by ${row.resolvedBy}` : ""}: ${row.resolution ?? ""}`}</span>}
                </span>
                {row.status === "ACTIVE" && task.can.resolveBlocker && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Resolve the blocker", confirm: "Resolve",
                  fields: [{ name: "resolution", label: "How it was resolved", kind: "textarea", required: true }],
                  run: (values) => act("resolve-blocker", { blockerId: row.id, resolution: values.resolution }, "Blocker resolved.") })}>Resolve</Button>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <AssignmentHistory taskId={task.id} version={task.version} />
      <FactList title="Details" items={[
        ["Code", task.code], ["Type", TASK_TYPE_LABEL[task.type] ?? task.type], ["Assigned to", task.assignee ?? "—"], ["Reported by", task.reporter ?? "—"],
        ["Reviewer", task.reviewRequired ? task.reviewer ?? "Anyone who reviews on the project" : "No review"], ["Start date", dateLabel(task.plannedStartDate)],
        ["Due date", `${dateLabel(task.dueDate)}${task.rescheduled ? ` (originally ${dateLabel(task.originalDueDate)})` : ""}`], ["Estimated effort", minutesLabel(task.estimateMinutes)],
        ["Started", task.actualStartedAt ? formatDateTime(task.actualStartedAt) : "—"], ["Completed", task.completedAt ? `${formatDateTime(task.completedAt)}${task.completedBy ? ` by ${task.completedBy}` : ""}` : "—"],
        ["Evidence", task.evidenceRequired ? [task.completionNote, task.evidenceReference, task.files.length ? `${task.files.length} file(s)` : null].filter(Boolean).join(" · ") || "Required — not yet recorded" : "Not required"],
        ["Tags", task.tags.length ? task.tags.join(", ") : "—"], ...(task.customer ? [["Customer", `${task.customer.name}${task.customer.contact ? ` · ${task.customer.contact}` : ""}`] as [string, string]] : []),
        ["Project Manager", task.projectManager ?? "—"], ...(task.templateRef ? [["From template", task.templateRef] as [string, string]] : []), ["Created", formatDateTime(task.createdAt)],
      ]} />
      {task.reviews.length > 0 && (
        <Panel title="Reviews" description="Each submission and its decision, kept as they were.">
          <ul className="flex flex-col gap-2">
            {task.reviews.map((row) => (
              <li key={row.id} className="rounded-md border border-border p-2 text-sm">
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{`Submission ${row.number}`}</span>
                  {row.decision ? <StatusBadge tone={row.decision.decision === "APPROVED" ? "success" : "warning"}>{DECISION[row.decision.decision]}</StatusBadge> : <StatusBadge tone="info">Awaiting decision</StatusBadge>}
                  {row.stale && !row.decision && <StatusBadge tone="neutral">Superseded</StatusBadge>}</span>
                <span className="block text-xs text-text-muted">{`${formatDateTime(row.submittedAt)}${row.submittedBy ? ` by ${row.submittedBy}` : ""}${row.note ? ` — ${row.note}` : ""}`}</span>
                {row.decision && <span className="block text-xs text-text-secondary">{`${row.decision.decidedBy ?? ""} · ${formatDateTime(row.decision.decidedAt)}${row.decision.reason ? `: ${row.decision.reason}` : ""}`}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ChecklistTab({ task, act, setAsk }: TabProps) {
  const can = task.can;
  const items = task.checklist;
  const move = (index: number, delta: number) => {
    const order = items.map((row) => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    return act("checklist", { op: "reorder", order }, "Checklist reordered.");
  };
  return (
    <Panel title="Checklist" description="Steps within this task. Required ones must be done (or waived) before the task is completed; they never count as separate tasks."
      actions={can.manageChecklist ? <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Add a step", confirm: "Add",
        fields: [{ name: "title", label: "Step", kind: "text", required: true }, { name: "optional", label: "Optional", kind: "checkbox" }],
        run: (values) => act("checklist", { op: "add", title: values.title, isRequired: !values.optional }, "Step added.") })}>Add step</Button> : undefined}>
      {items.length === 0 ? <p className="text-sm text-text-muted">No checklist. When a step needs its own assignee, deadline or review, make it a separate task instead.</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((row, index) => (
            <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-start gap-2">
                <Checkbox aria-label={row.title} isDisabled={!can.checklist || row.status === "WAIVED"} isSelected={row.status !== "PENDING"}
                  onChange={(on) => act("checklist", { op: on ? "done" : "undo", itemId: row.id }, on ? "Step done." : "Step reopened.")} />
                <span className="flex flex-col">
                  <span className={`text-sm ${row.status !== "PENDING" ? "line-through text-text-muted" : ""}`}>{row.title}{row.required ? "" : " (optional)"}</span>
                  {row.status === "DONE" && <span className="text-xs text-text-muted">{`Done${row.completedBy ? ` by ${row.completedBy}` : ""} ${row.completedAt ? formatDateTime(row.completedAt) : ""}`}</span>}
                  {row.status === "WAIVED" && <span className="text-xs text-warning">{`Waived${row.waivedBy ? ` by ${row.waivedBy}` : ""}: ${row.waiverReference ?? ""}`}</span>}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {can.waive && row.status === "PENDING" && row.required && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Waive: ${row.title}`, confirm: "Waive", tone: "danger",
                  fields: [{ name: "reference", label: "Why (or what replaces it)", kind: "textarea", required: true }], run: (values) => act("checklist", { op: "waive", itemId: row.id, reference: values.reference }, "Step waived.") })}>Waive</Button>}
                {can.manageChecklist && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Change the step", confirm: "Save",
                  fields: [{ name: "title", label: "Step", kind: "text", required: true, initial: row.title }, { name: "optional", label: "Optional", kind: "checkbox", initial: !row.required }],
                  run: (values) => act("checklist", { op: "update", itemId: row.id, title: values.title, isRequired: !values.optional }, "Step changed.") })}>Change</Button>}
                {can.manageChecklist && index > 0 && <Button size="compact" variant="ghost" aria-label="Move up" onPress={() => move(index, -1)}>↑</Button>}
                {can.manageChecklist && index < items.length - 1 && <Button size="compact" variant="ghost" aria-label="Move down" onPress={() => move(index, 1)}>↓</Button>}
                {can.manageChecklist && <Button size="compact" variant="ghost" onPress={() => act("checklist", { op: "remove", itemId: row.id }, "Step removed.")}>Remove</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DependenciesTab({ task, act }: { task: TaskDetail; act: Act }) {
  const workspace = useWorkspaceContext();
  const siblings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-tasks", task.projectId, { view: "all" }), queryFn: () => getProjectTasks(task.projectId, { view: "all" }),
    enabled: task.can.dependencies });
  const [choice, setChoice] = useState<string | null>(null);
  const taken = new Set(task.prerequisites.map((row) => row.id));
  const options = (siblings.data?.rows ?? []).filter((row) => row.id !== task.id && row.status !== "CANCELLED" && !taken.has(row.id))
    .map((row) => ({ value: row.id, label: `${row.code} ${row.title} · ${row.statusLabel.toLowerCase()} · due ${dateLabel(row.dueDate)}` }));
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Waits for" description="Earlier tasks of this project that must be done before this one starts or completes (finish-to-start). Loops are refused.">
        <LinesTable columns={["Task", "Status", "Due", ""]} empty={task.prerequisites.length ? undefined : "Nothing — it can start any time."}>
          {task.prerequisites.map((row) => (
            <tr key={row.dependencyId}>
              <Cell><Link className="text-brand hover:underline" href={`${TASKS_BASE}/${row.id}`}>{`${row.code} ${row.title}`}</Link></Cell>
              <Cell><StatusBadge tone={TASK_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
              <Cell>{dateLabel(row.dueDate)}</Cell>
              <Cell>{task.can.dependencies && <Button size="compact" variant="ghost" onPress={() => act("dependency", { dependencyId: row.dependencyId, remove: true }, "No longer waits for it.")}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
        {task.can.dependencies && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select label="Add an earlier task" selectedKey={choice} onSelectionChange={(key) => setChoice(String(key))} options={options} className="sm:min-w-80" />
            <Button variant="secondary" isDisabled={!choice} onPress={async () => { await act("dependency", { prerequisiteId: choice }, "Dependency added."); setChoice(null); }}>Add</Button>
          </div>
        )}
      </Panel>
      <Panel title="Waiting for this">
        {task.dependents.length === 0 ? <p className="text-sm text-text-muted">No task waits for this one.</p> : (
          <ul className="flex flex-col gap-1 text-sm">{task.dependents.map((row) => (
            <li key={row.dependencyId}><Link className="text-brand hover:underline" href={`${TASKS_BASE}/${row.id}`}>{`${row.code} ${row.title}`}</Link>{` · ${row.statusLabel}`}</li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}

function FilesTab({ task, onChanged }: { task: TaskDetail; onChanged: (text: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setError(null);
    try { await work(); await onChanged(text); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const mayUpload = task.can.comment && task.status !== "DONE";
  const locked = ["DONE", "IN_REVIEW"].includes(task.status);
  return (
    <Panel title="Files" description="Instructions, deliverables and completion evidence. Files reviewed or on a done task stay with it."
      actions={mayUpload ? <>
        <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => uploadTaskFile(task.id, file), `${file.name} uploaded.`); }} />
        <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>Upload</Button>
      </> : undefined}>
      {error && <Notice tone="danger">{error}</Notice>}
      <LinesTable columns={["File", "Uploaded", ""]} empty={task.files.length ? undefined : "No files."}>
        {task.files.map((row) => (
          <tr key={row.id}>
            <Cell><a className="text-brand hover:underline" href={taskFileHref(task.id, row.id)}>{row.fileName}</a></Cell>
            <Cell>{`${formatDateTime(row.uploadedAt)}${row.uploadedBy ? ` · ${row.uploadedBy}` : ""}`}</Cell>
            <Cell>{task.can.comment && !locked && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeTaskFile(task.id, row.id), "File removed.")}>Remove</Button>}</Cell>
          </tr>
        ))}
      </LinesTable>
    </Panel>
  );
}

function TimeTab({ task }: { task: TaskDetail }) {
  return (
    <Panel title="Time and expenses" description="Recorded in their own modules against this task; reassigning or cancelling the task never changes them.">
      {task.records.length === 0 ? <p className="text-sm text-text-muted">Time tracking and project expenses are not available yet. When they are, what is logged against this task appears here.</p> : (
        <FactList columns={2} items={task.records.map((row) => [row.label, row.count ? `${row.count}${row.summary ? ` · ${row.summary}` : ""}` : "None"] as [string, string])} />
      )}
      <p className="text-sm text-text-secondary">{`Estimated effort: ${minutesLabel(task.estimateMinutes)}. An estimate is a plan, not time worked.`}</p>
    </Panel>
  );
}

function ActivityTab({ task }: { task: TaskDetail }) {
  const workspace = useWorkspaceContext();
  const activity = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "task-activity", task.id, task.version), queryFn: () => getTaskActivity(task.id) });
  if (activity.isLoading) return <LoadingState label="Loading activity" rows={5} />;
  return <HistoryList title="History" entries={(activity.data ?? []).map((row) => ({ summary: row.summary ?? row.action.toLowerCase().replace(/_/g, " "), at: row.at, actor: row.actor,
    label: row.action.toLowerCase().replace(/_/g, " "), detail: row.from && row.to && row.from !== row.to ? `${row.from.toLowerCase().replace(/_/g, " ")} → ${row.to.toLowerCase().replace(/_/g, " ")}` : undefined }))} />;
}

// ------------------------------------------------------------------ dialogs
function EditDialog({ task, onClose, onDone }: { task: TaskDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", task.projectId), queryFn: () => getMembers(task.projectId) });
  const tasks = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-tasks", task.projectId, { view: "all" }), queryFn: () => getProjectTasks(task.projectId, { view: "all" }) });
  const [form, setForm] = useState({ title: task.title, description: task.description ?? "", priority: task.priority, priorityReason: "", type: task.type, tags: task.tags.join(", "), plannedStartDate: task.plannedStartDate ?? "",
    dueDate: task.dueDate, dueDateReason: "", hours: task.estimateMinutes ? String(task.estimateMinutes / 60) : "", reviewerUserId: task.reviewerId ?? "", milestoneId: task.milestone?.id ?? "" });
  const [review, setReview] = useState(task.reviewRequired);
  const [evidence, setEvidence] = useState(task.evidenceRequired);
  const [withdraw, setWithdraw] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [name]: value }));
  const people = [{ value: "", label: "Anyone who reviews on the project" }, ...(team.data?.members ?? []).filter((row) => row.active && ["MANAGER", "MEMBER"].includes(row.role)).map((row) => ({ value: row.userId, label: row.name }))];
  const milestones = [{ value: "", label: "No milestone" }, ...(tasks.data?.milestones ?? []).filter((row) => row.linkable || row.id === task.milestone?.id).map((row) => ({ value: row.id, label: `${row.code} ${row.name}` }))];
  const moved = form.dueDate !== task.dueDate;
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Edit ${task.code}`} size="lg">
      <div className="flex flex-col gap-3">
        <TextField label="Task" value={form.title} onChange={set("title")} isRequired maxLength={200} />
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} />
        <div className="grid gap-3 sm:grid-cols-2">
          <PriorityField value={form.priority} onChange={(next) => set("priority")(next)} original={task.priority} reason={form.priorityReason} onReasonChange={set("priorityReason")} />
          <Select label="Type" selectedKey={form.type} onSelectionChange={(next) => set("type")(String(next))} options={Object.entries(TASK_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField label="Start date" type="date" value={form.plannedStartDate} onChange={set("plannedStartDate")} />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} isRequired description={`Originally ${dateLabel(task.originalDueDate)}; the original is kept.`} />
          <TextField label="Estimated effort (hours)" inputMode="decimal" value={form.hours} onChange={set("hours")} />
          <TextField label="Tags" value={form.tags} onChange={set("tags")} description="Comma separated." />
          <Select label="Milestone" selectedKey={form.milestoneId} onSelectionChange={(next) => set("milestoneId")(String(next ?? ""))} options={milestones} />
        </div>
        {moved && <TextField label="Why the due date changes" value={form.dueDateReason} onChange={set("dueDateReason")} />}
        <Checkbox isSelected={review} onChange={setReview}>Needs review before it is done</Checkbox>
        {review && <Select label="Reviewer" selectedKey={form.reviewerUserId} onSelectionChange={(next) => set("reviewerUserId")(String(next ?? ""))} options={people} />}
        <Checkbox isSelected={evidence} onChange={setEvidence}>Needs completion evidence</Checkbox>
        {task.status === "IN_REVIEW" && <Checkbox isSelected={withdraw} onChange={setWithdraw}>Withdraw it from review to change what is reviewed</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || form.title.trim().length < 2 || !form.dueDate || priorityReasonMissing(task.priority, form.priority, form.priorityReason)} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await updateTask(task.id, { expectedVersion: task.version, idempotencyKey: key, title: form.title, description: form.description, priority: form.priority, priorityReason: form.priorityReason.trim() || undefined, taskType: form.type,
                tags: form.tags, plannedStartDate: form.plannedStartDate || null, dueDate: form.dueDate, dueDateReason: moved ? form.dueDateReason || undefined : undefined,
                estimateMinutes: form.hours ? Math.round(Number(form.hours) * 60) : null, reviewRequired: review, reviewerUserId: review ? form.reviewerUserId || null : null, evidenceRequired: evidence,
                milestoneId: form.milestoneId || null, withdrawReview: withdraw || undefined });
              await onDone(result.changed?.length ? `Saved: ${result.changed.join(", ")}.` : "Nothing changed."); onClose();
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

