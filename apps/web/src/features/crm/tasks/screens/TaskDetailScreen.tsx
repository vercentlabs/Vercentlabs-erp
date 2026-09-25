"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Play, Plus, UserMinus, UserPlus, X } from "lucide-react";
import { Button, Dialog, ErrorState, IconButton, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { dueLabel, dueState, formatDateTime, humanize } from "@/features/crm/shared/human";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { RelatedRecordCard } from "@/features/crm/shared/ui/RelatedRecordCard";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { addTaskDependency, cancelTask, claimTask, completeTask, getTask, listTaskDependencies, listTaskHistory, listTasks, releaseTask, removeTaskDependency, startTask, TaskApiError, updateTask } from "../api/tasks-api";
import { RecurrenceBuilder } from "../components/RecurrenceBuilder";
import type { RecurrenceConfig, Task } from "../types";


function describeRecurrence(config: RecurrenceConfig | null): string | null {
  if (!config) return null;
  const unit = config.freq === "daily" ? "day" : config.freq === "weekly" ? "week" : "month";
  let text = config.interval > 1 ? `Every ${config.interval} ${unit}s` : `Every ${unit}`;
  if (config.count) text += `, ${config.count} times`;
  else if (config.until) text += `, until ${config.until.slice(0, 10)}`;
  return text;
}

// F015 Tranche J (Stage A) — dedicated Task detail view; getCrmTask/
// updateCrmTask (task-operations.js) were already real, already routed,
// with no frontend consumer. Stage A2 §6 closeout: dependency management
// and a recurrence-config builder were genuine, confirmed gaps — the
// backend (addTaskDependency/removeTaskDependency/listTaskDependencies,
// cycle/self-dependency/completion-blocked all enforced server-side; and
// recurrenceConfig, the machine-readable field generateNextTaskOccurrence
// actually reads) already existed with zero frontend consumer. Both are
// now wired below, not invented.
export function TaskDetailScreen({ taskId }: { taskId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", taskId), queryFn: () => getTask(taskId) });
  const task = query.data?.record;
  // A task waiting on unfinished work cannot be completed (server rule
  // CRM_TASK_DEPENDENCY_BLOCKED); say so up front instead of offering the action.
  const blockingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", taskId, "dependencies"),
    queryFn: () => listTaskDependencies(taskId),
  });
  const blockedBy = (blockingQuery.data?.rows ?? []).filter((row) => row.dependsOnStatus !== "completed" && row.dependsOnStatus !== "cancelled");

  // F015 gap-closure — listCrmTaskHistory (the crm_task_events ledger)
  // existed with no route or frontend reader anywhere.
  const historyQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", taskId, "history"),
    queryFn: () => listTaskHistory(taskId),
    enabled: Boolean(task),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks", taskId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
  }
  function handleError(err: unknown) {
    setActionError(err instanceof TaskApiError ? err.message : "This action could not be completed.");
    if (err instanceof TaskApiError && (err.code === "CRM_TASK_STALE_WRITE" || err.code === "CRM_TASK_CONFLICT")) invalidate();
  }
  const onDone = () => { setActionError(null); invalidate(); };
  const startMutation = useMutation({ mutationFn: () => startTask(task!.id, task!.updatedAt), onSuccess: onDone, onError: handleError });
  const completeMutation = useMutation({ mutationFn: () => completeTask(task!.id, undefined, task!.updatedAt), onSuccess: onDone, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: () => cancelTask(task!.id, task!.updatedAt), onSuccess: onDone, onError: handleError });
  const claimMutation = useMutation({ mutationFn: () => claimTask(task!.id, task!.updatedAt), onSuccess: onDone, onError: handleError });
  const releaseMutation = useMutation({ mutationFn: () => releaseTask(task!.id, task!.updatedAt), onSuccess: onDone, onError: handleError });

  if (query.isLoading) return <LoadingState label="Loading task" rows={3} />;
  if (query.isError) {
    if (query.error instanceof TaskApiError && query.error.status === 403) return <PermissionState title="You don't have access to this task" />;
    return <ErrorState title="Task not found" action={{ label: "Back to Tasks", onPress: () => router.push("/crm/tasks") }} />;
  }
  if (!task) return null;

  const isTerminal = task.status === "completed" || task.status === "cancelled";
  const teamId = (task as { teamId?: string | null }).teamId ?? null;

  return (
    <RecordDetailsPage
      header={{
        title: task.subject,
        status: <StatusBadge tone={task.status === "completed" ? "success" : task.status === "cancelled" ? "neutral" : "info"}>{humanize(task.status)}</StatusBadge>,
        fields: [
          { label: "Due", value: task.dueAt ? `${formatDateTime(task.dueAt)}${task.status !== "completed" && task.status !== "cancelled" && dueState(task.dueAt) === "overdue" ? " (" + dueLabel(task.dueAt) + ")" : ""}` : "No due date" },
          { label: "Priority", value: humanize(task.priority) },
          { label: "Assignee", value: task.assignedName ?? "Unassigned" },
        ],
        // updateCrmTask rejects completed/cancelled (CRM_TASK_READ_ONLY) —
        // hiding Edit in those states avoids offering a rejected action.
        primaryAction: canManage && task.status !== "completed" && task.status !== "cancelled" ? (
          <Button variant="secondary" onPress={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
        secondaryActions:
          canManage && !isTerminal ? (
            <>
              {teamId && !task.assignedTo && (
                <Button variant="secondary" onPress={() => claimMutation.mutate()} isLoading={claimMutation.isPending}>
                  <UserPlus className="size-4" aria-hidden="true" />
                  Claim
                </Button>
              )}
              {teamId && task.assignedTo && (
                <Button variant="secondary" onPress={() => releaseMutation.mutate()} isLoading={releaseMutation.isPending}>
                  <UserMinus className="size-4" aria-hidden="true" />
                  Release
                </Button>
              )}
              {task.status !== "in_progress" && (
                <Button variant="secondary" onPress={() => startMutation.mutate()} isLoading={startMutation.isPending}>
                  <Play className="size-4" aria-hidden="true" />
                  Start
                </Button>
              )}
              <Button variant="secondary" onPress={() => completeMutation.mutate()} isLoading={completeMutation.isPending} isDisabled={blockedBy.length > 0} aria-describedby={blockedBy.length > 0 ? "task-blocked-note" : undefined}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Complete
              </Button>
              <Button variant="danger" onPress={() => cancelMutation.mutate()} isLoading={cancelMutation.isPending}>
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            </>
          ) : undefined,
      }}
    >
      <div className="flex flex-col gap-4 py-4">
        {!isTerminal && blockedBy.length > 0 && (
          <p id="task-blocked-note" role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {`Waiting on ${blockedBy.map((row) => `"${row.dependsOnSubject}"`).join(", ")}. This task can be completed once ${blockedBy.length === 1 ? "that is" : "those are"} done.`}
          </p>
        )}
        {actionError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        )}
        <PropertyList title="Related record" columns={1} items={[{ label: "Belongs to", value: <RelatedRecordCard entityType={(task as { entityType?: string }).entityType} entityId={(task as { entityId?: string | null }).entityId} /> }]} />
        <PropertyList title="Task" items={[
          { label: "Description", value: task.description, wide: true },
          { label: "Team queue", value: task.teamName },
          { label: "Starts", value: task.startAt ? formatDateTime(task.startAt) : null },
          { label: "Reminder", value: task.reminderAt ? formatDateTime(task.reminderAt) : null },
          { label: "Repeats", value: describeRecurrence(task.recurrenceConfig as RecurrenceConfig | null) ?? (task.recurringRule ? humanize(task.recurringRule) : null) },
          { label: "Completed", value: task.completedAt ? formatDateTime(task.completedAt) : null },
          { label: "Outcome", value: task.outcome, wide: true },
        ]} />
      </div>
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-text">Task history</p>
        {historyQuery.isLoading ? (
          <p className="text-sm text-text-secondary">Loading history…</p>
        ) : (historyQuery.data?.rows.length ?? 0) === 0 ? (
          <p className="text-sm text-text-muted">No history recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {historyQuery.data!.rows.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={event.eventType === "cancelled" ? "danger" : event.eventType === "completed" ? "success" : "neutral"}>{humanize(event.eventType)}</StatusBadge>
                  {event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus && <span className="text-text-secondary">{`${humanize(event.fromStatus)} → ${humanize(event.toStatus)}`}</span>}
                  <span className="text-xs text-text-muted">{formatDateTime(event.occurredAt)}</span>
                </div>
                <span className="text-xs text-text-secondary">{event.actorName ? `By ${event.actorName}` : "System"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <TaskDependenciesPanel task={task} canManage={canManage} />
      <EditTaskDialog isOpen={editOpen} onOpenChange={setEditOpen} task={task} />
    </RecordDetailsPage>
  );
}

// F015 Stage A2 §6. addTaskDependency/removeTaskDependency already
// enforce cycle prevention, self-dependency rejection and completion-
// while-blocked rejection server-side (CRM_TASK_DEPENDENCY_CYCLE/
// CRM_TASK_DEPENDENCY_INVALID/CRM_TASK_DEPENDENCY_BLOCKED) — this panel
// surfaces that state, it does not re-implement the rules.
function TaskDependenciesPanel({ task, canManage }: { task: Task; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidateId, setCandidateId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dependenciesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", task.id, "dependencies"),
    queryFn: () => listTaskDependencies(task.id),
  });
  const candidatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tasks", "dependency-candidates"),
    queryFn: () => listTasks({ limit: 200 }),
    enabled: pickerOpen,
  });

  const dependencies = useMemo(() => dependenciesQuery.data?.rows ?? [], [dependenciesQuery.data]);
  const candidateOptions: SelectOption[] = useMemo(
    () =>
      (candidatesQuery.data?.rows ?? [])
        .filter((row) => row.id !== task.id && !dependencies.some((dependency) => dependency.dependsOnTaskId === row.id))
        .map((row) => ({ value: row.id, label: row.subject })),
    [candidatesQuery.data, dependencies, task.id],
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks", task.id, "dependencies") });
  }

  const addMutation = useMutation({
    mutationFn: () => addTaskDependency(task.id, candidateId),
    onSuccess: () => {
      invalidate();
      setPickerOpen(false);
      setCandidateId("");
      setError(null);
    },
    onError: (err: unknown) => setError(err instanceof TaskApiError ? err.message : "This dependency could not be added."),
  });
  const removeMutation = useMutation({
    mutationFn: (dependsOnTaskId: string) => removeTaskDependency(task.id, dependsOnTaskId),
    onSuccess: invalidate,
    onError: (err: unknown) => setError(err instanceof TaskApiError ? err.message : "This dependency could not be removed."),
  });

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">Blocked by (must complete first)</span>
        {canManage && (
          <Button variant="secondary" size="compact" onPress={() => setPickerOpen((open) => !open)}>
            <Plus className="size-4" aria-hidden="true" />
            Add dependency
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {pickerOpen && (
        <div className="flex items-end gap-2">
          <Select aria-label="Task this depends on" options={candidateOptions} selectedKey={candidateId} onSelectionChange={(key) => setCandidateId(String(key ?? ""))} />
          <Button variant="primary" size="compact" onPress={() => addMutation.mutate()} isLoading={addMutation.isPending} isDisabled={!candidateId}>
            Add
          </Button>
        </div>
      )}
      {dependencies.length === 0 ? (
        <p className="text-sm text-text-muted">No dependencies.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {dependencies.map((dependency) => (
            <li key={dependency.id} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-1.5">
              <span className="text-sm text-text">{dependency.dependsOnSubject}</span>
              <div className="flex items-center gap-2">
                <StatusBadge tone={dependency.dependsOnStatus === "completed" ? "success" : "warning"}>{humanize(dependency.dependsOnStatus)}</StatusBadge>
                {canManage && (
                  <IconButton
                    aria-label={`Remove dependency on ${dependency.dependsOnSubject}`}
                    size="compact"
                    variant="ghost"
                    onPress={() => removeMutation.mutate(dependency.dependsOnTaskId)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditTaskDialog({ isOpen, onOpenChange, task }: { isOpen: boolean; onOpenChange: (open: boolean) => void; task: Task }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(task.subject);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ?? "");
  const [dueAt, setDueAt] = useState(task.dueAt ?? "");
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig | null>((task.recurrenceConfig as RecurrenceConfig | null) ?? null);
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () => updateTask(task.id, { subject, description: description || null, priority, assignedTo: assignedTo || null, dueAt: dueAt || null, recurrenceConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks", task.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "tasks") });
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof TaskApiError ? err.message : "This task could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Edit ${task.subject}`}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} />
        <Select
          label="Priority"
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]}
          selectedKey={priority}
          onSelectionChange={(key) => setPriority(String(key ?? "medium") as Task["priority"])}
        />
        <Select label="Assignee" options={assigneeOptions} selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key ?? ""))} />
        <DateTimeInput label="Due" value={dueAt} onChange={setDueAt} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <RecurrenceBuilder value={recurrenceConfig} onChange={setRecurrenceConfig} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!subject.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
