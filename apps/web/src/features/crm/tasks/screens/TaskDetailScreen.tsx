"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { getTask, TaskApiError, updateTask } from "../api/tasks-api";
import type { Task } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

// F015 Tranche J (Stage A) — dedicated Task detail view; getCrmTask/
// updateCrmTask (task-operations.js) were already real, already routed,
// with no frontend consumer. Dependency management and a recurrence-
// config builder remain disclosed, not-built gaps — recurringRule is
// shown read-only here, editing it would need real RRULE authoring UX,
// a separate, larger piece of work than this dialog's scope.
export function TaskDetailScreen({ taskId }: { taskId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", taskId), queryFn: () => getTask(taskId) });
  const task = query.data?.record;

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading task…</p>;
  if (query.isError) {
    if (query.error instanceof TaskApiError && query.error.status === 403) return <PermissionState title="You don't have access to this task" />;
    return <ErrorState title="Task not found" action={{ label: "Back to Tasks", onPress: () => router.push("/crm/tasks") }} />;
  }
  if (!task) return null;

  return (
    <RecordDetailsPage
      header={{
        title: task.subject,
        status: <StatusBadge tone={task.status === "completed" ? "success" : task.status === "cancelled" ? "neutral" : "info"}>{task.status}</StatusBadge>,
        fields: [
          { label: "Priority", value: task.priority },
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
      }}
    >
      <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
        <Field label="Team" value={task.teamName} />
        <Field label="Start at" value={task.startAt ? dateFormatter.format(new Date(task.startAt)) : null} />
        <Field label="Due at" value={task.dueAt ? dateFormatter.format(new Date(task.dueAt)) : null} />
        <Field label="Reminder at" value={task.reminderAt ? dateFormatter.format(new Date(task.reminderAt)) : null} />
        <Field label="Recurring rule" value={task.recurringRule} />
        <Field label="Completed at" value={task.completedAt ? dateFormatter.format(new Date(task.completedAt)) : null} />
        <Field label="Outcome" value={task.outcome} />
      </div>
      {task.description && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="text-xs text-text-muted">Description</span>
          <p className="text-sm text-text">{task.description}</p>
        </div>
      )}
      <EditTaskDialog isOpen={editOpen} onOpenChange={setEditOpen} task={task} />
    </RecordDetailsPage>
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
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () => updateTask(task.id, { subject, description: description || null, priority, assignedTo: assignedTo || null, dueAt: dueAt || null }),
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
        <TextField label="Due at" placeholder="YYYY-MM-DDTHH:mm" value={dueAt} onChange={setDueAt} />
        <TextArea label="Description" value={description} onChange={setDescription} />
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
