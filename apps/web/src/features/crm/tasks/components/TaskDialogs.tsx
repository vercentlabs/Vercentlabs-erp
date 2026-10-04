"use client";

// The task actions that need a few words from the user: create or edit,
// complete (with an optional next follow-up), cancel, reassign. Each is one
// task operation on the server.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { DateInput, DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { RelatedRecordPicker, type RelatedValue } from "@/features/crm/shared/ui/RelatedRecordPicker";

import {
  assignTask, cancelTask, completeTask, createTask, errorMessage, updateTask, type Task, type TaskInput, type TaskOptions, type TaskPriority, type TaskRelatedType,
} from "../api/tasks-api";
import { ErrorBanner, PRIORITY_OPTIONS } from "../task-format";

const NONE = "none";
const CUSTOM = "custom";
const today = () => new Date().toISOString().slice(0, 10);
const FOLLOW_UP_LABELS: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", other: "Other" };

function Actions({ onCancel, onConfirm, label, isLoading, isDisabled, danger }: {
  onCancel: () => void; onConfirm: () => void; label: string; isLoading: boolean; isDisabled?: boolean; danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isLoading={isLoading} isDisabled={isDisabled}>{label}</Button>
    </div>
  );
}

// related: the record the task is created from (prefilled and fixed). task: the task being edited.
export function TaskFormDialog({ isOpen, onOpenChange, options, related, task, onSaved }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; options: TaskOptions; onSaved: (task: Task) => void;
  related?: { type: TaskRelatedType; id: string; name?: string | null }; task?: Task;
}) {
  const editing = Boolean(task);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? today());
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [reminder, setReminder] = useState(task?.reminderOffsetMinutes === null || task?.reminderOffsetMinutes === undefined ? NONE : String(task.reminderOffsetMinutes));
  const [reminderAt, setReminderAt] = useState("");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? options.currentUserId);
  const [link, setLink] = useState<RelatedValue>({
    entityType: (task?.relatedType && task.relatedType !== "campaign" ? task.relatedType : related?.type ?? "general") as RelatedValue["entityType"],
    entityId: task?.relatedId ?? related?.id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  // One key per form opening: a double click or a retry creates one task.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const canAssign = options.capabilities.assign;

  const mutation = useMutation({
    mutationFn: () => {
      const input: TaskInput = {
        title, description, priority, dueDate, dueTime,
        ...(reminder === CUSTOM ? { reminderAt: reminderAt || null } : { reminderOffsetMinutes: reminder === NONE ? null : Number(reminder) }),
      };
      if (!related) {
        input.relatedType = link.entityType === "general" || !link.entityId ? null : (link.entityType as TaskRelatedType);
        input.relatedId = link.entityType === "general" ? null : link.entityId || null;
      }
      if (task) return updateTask(task.id, { ...input, expectedUpdatedAt: task.updatedAt });
      return createTask({ ...input, ...(related ? { relatedType: related.type, relatedId: related.id } : {}), assignedTo, idempotencyKey });
    },
    onSuccess: (saved) => { setError(null); onSaved(saved); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={editing ? `Edit ${task?.number ?? "task"}` : "New task"} size="lg"
      description={related ? `For ${related.name ?? "this record"}. It also appears in CRM Tasks.` : "What needs to be done, by whom and by when."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Task" isRequired value={title} onChange={setTitle} placeholder="For example: Send revised quotation" />
        <div className="grid gap-4 sm:grid-cols-3">
          <DateInput label="Due date" isRequired value={dueDate} onChange={setDueDate} />
          <TextField label="Due time" type="time" description="Optional." value={dueTime} onChange={setDueTime} />
          <Select label="Priority" selectedKey={priority} onSelectionChange={(key) => setPriority(String(key) as TaskPriority)} options={PRIORITY_OPTIONS} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
            options={[{ value: NONE, label: "No reminder" }, ...options.reminderOptions.map((entry) => ({ value: String(entry.minutes), label: entry.label })), { value: CUSTOM, label: "Custom date and time" }]} />
          {reminder === CUSTOM && <DateTimeInput label="Remind me at" isRequired value={reminderAt} onChange={setReminderAt} />}
          {!editing && (
            <Select label="Assigned to" selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
              options={options.users.filter((user) => canAssign || user.id === options.currentUserId)
                .map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
          )}
        </div>
        {!related && <RelatedRecordPicker label="About" value={link} onChange={setLink} />}
        <TextArea label="Description" value={description} onChange={setDescription} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label={editing ? "Save" : "Create task"} isLoading={mutation.isPending}
          isDisabled={!title.trim() || !dueDate || (reminder === CUSTOM && !reminderAt)} />
      </div>
    </Dialog>
  );
}

// Completing can schedule the next contact with the customer: a follow-up on the same record, not another task.
export function CompleteTaskDialog({ isOpen, onOpenChange, task, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; task: Task; options: TaskOptions; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [type, setType] = useState("call");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => completeTask(task.id, { note: note.trim() || undefined, expectedUpdatedAt: task.updatedAt, ...(followUp ? { nextFollowUp: { type, dueAt } } : {}) }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Complete task" description={task.title}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextArea label="Outcome" description="Optional. What happened?" value={note} onChange={setNote} />
        {task.relatedId && (
          <>
            <Checkbox isSelected={followUp} onChange={setFollowUp}>Create the next follow-up with {task.relatedName ?? "this record"}</Checkbox>
            {followUp && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Follow-up by" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
                  options={options.followUpTypes.map((entry) => ({ value: entry, label: FOLLOW_UP_LABELS[entry] ?? entry }))} />
                <DateTimeInput label="When" isRequired value={dueAt} onChange={setDueAt} />
              </div>
            )}
          </>
        )}
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Complete" isLoading={mutation.isPending} isDisabled={followUp && !dueAt} />
      </div>
    </Dialog>
  );
}

export function CancelTaskDialog({ isOpen, onOpenChange, task, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; task: Task; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => cancelTask(task.id, { reason: reason.trim() || undefined, expectedUpdatedAt: task.updatedAt }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Cancel task" description="The task is kept with its history and can be reopened.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextArea label="Reason" description="Optional." value={reason} onChange={setReason} />
        <Actions danger onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Cancel task" isLoading={mutation.isPending} />
      </div>
    </Dialog>
  );
}

export function AssignTaskDialog({ isOpen, onOpenChange, task, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; task: Task; options: TaskOptions; onDone: () => void;
}) {
  const [assignedTo, setAssignedTo] = useState(task.assignedTo ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => assignTask(task.id, { assignedTo, reason: reason.trim() || undefined, expectedUpdatedAt: task.updatedAt }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Reassign task"
      description={`Assigned to ${task.assignedName ?? "nobody"}. Created by ${task.createdByName ?? "unknown"}, which does not change.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Assign to" selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
          options={options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
        <TextArea label="Reason" description="Optional. Kept in the task's history." value={reason} onChange={setReason} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Reassign" isLoading={mutation.isPending} isDisabled={!assignedTo || assignedTo === task.assignedTo} />
      </div>
    </Dialog>
  );
}
