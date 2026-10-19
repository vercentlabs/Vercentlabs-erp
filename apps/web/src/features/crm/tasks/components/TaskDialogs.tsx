"use client";

// The task actions that need a few words from the user: create or edit,
// complete (with an optional next follow-up), cancel, reassign. Each is one
// task operation on the server.
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { DateInput, DateTimeInput, TimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { RelatedRecordPicker, type RelatedValue } from "@/features/crm/shared/ui/RelatedRecordPicker";
import { localDate } from "@/features/crm/shared/ui/WorkQueues";

import {
  assignTask, cancelTask, completeTask, createTask, errorMessage, updateTask, type Task, type TaskInput, type TaskOptions, type TaskPriority, type TaskRelatedType,
} from "../api/tasks-api";
import { ErrorBanner, PRIORITY_OPTIONS } from "../task-format";
import { useSubmitKey } from "@/shared/http/submit-once";

const NONE = "none";
const CUSTOM = "custom";
// The local date: toISOString() is UTC, which is still yesterday before 5:30 in India.
const today = () => localDate();
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
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? options.defaults?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? today());
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [reminder, setReminder] = useState(task
    ? (task.reminderOffsetMinutes === null || task.reminderOffsetMinutes === undefined ? NONE : String(task.reminderOffsetMinutes))
    : options.defaults?.reminderOffsetMinutes === null || options.defaults?.reminderOffsetMinutes === undefined ? NONE : String(options.defaults.reminderOffsetMinutes));
  const [reminderAt, setReminderAt] = useState("");
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? options.currentUserId);
  const [link, setLink] = useState<RelatedValue>({
    entityType: (task?.relatedType ?? related?.type ?? "general") as RelatedValue["entityType"],
    entityId: task?.relatedId ?? related?.id ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  // One key per form opening: a double click or a retry creates one task.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const canAssign = options.capabilities.assign;

  const submit = useSubmitKey();
  const mutation = useMutation({
    mutationFn: () => submit.run(async () => {
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
    }),
    onSuccess: (saved) => { setError(null); onSaved(saved); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const assignees = options.users.filter((user) => canAssign || user.id === options.currentUserId);
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={editing ? `Edit ${task?.number ?? "task"}` : "New task"} size="lg"
      description={related ? `For ${related.name ?? "this record"}. It also appears in CRM Tasks.` : "What needs to be done, by whom and by when."}>
      <div className="flex flex-col gap-5">
        <ErrorBanner message={error} />
        <div className="flex flex-col gap-3">
          <TextField label="Task" isRequired value={title} onChange={setTitle} placeholder="For example: Send revised quotation" />
          <TextArea label="Details" rows={2} value={description} onChange={setDescription} placeholder="Optional: what to check, links, or what the customer asked for" />
        </div>

        <FormSection title="When">
          <div className="grid gap-4 sm:grid-cols-3">
            <DateInput label="Due date" isRequired value={dueDate} onChange={setDueDate} />
            <TimeInput label="Due time" description="Optional." value={dueTime} onChange={setDueTime} />
            <Select label="Reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
              options={[{ value: NONE, label: "No reminder" }, ...options.reminderOptions.map((entry) => ({ value: String(entry.minutes), label: entry.label })), { value: CUSTOM, label: "Custom date and time" }]} />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick due dates">
            {quickDates().map((choice) => (
              <button key={choice.label} type="button" aria-pressed={dueDate === choice.date} onClick={() => setDueDate(choice.date)}
                className={`rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${dueDate === choice.date ? "border-brand bg-brand-soft text-brand" : "border-border text-text-secondary hover:border-border-strong hover:text-text"}`}>
                {choice.label}
              </button>
            ))}
          </div>
          {reminder === CUSTOM && <DateTimeInput label="Remind me at" isRequired value={reminderAt} onChange={setReminderAt} />}
        </FormSection>

        <FormSection title="Priority and owner">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text" id="task-priority-label">Priority</span>
              <div role="radiogroup" aria-labelledby="task-priority-label" className="grid grid-cols-3 gap-2">
                {PRIORITY_OPTIONS.map((entry) => (
                  <button key={entry.value} type="button" role="radio" aria-checked={priority === entry.value} onClick={() => setPriority(entry.value)}
                    className={`flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${priority === entry.value ? PRIORITY_STYLE[entry.value].selected : "border-border text-text-secondary hover:border-border-strong hover:text-text"}`}>
                    <span className={`size-2 rounded-full ${PRIORITY_STYLE[entry.value].dot}`} aria-hidden="true" />{entry.label}
                  </button>
                ))}
              </div>
            </div>
            {!editing && (assignees.length > 1 ? (
              <Select label="Assigned to" selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
                options={assignees.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text">Assigned to</span>
                <span className="flex h-10 items-center gap-2 text-sm text-text-secondary">
                  <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">
                    {(assignees[0]?.name ?? "Me").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
                  </span>
                  {assignees[0] ? `${assignees[0].name} (me)` : "Me"}
                </span>
              </div>
            ))}
          </div>
        </FormSection>

        {!related && (
          <FormSection title="About">
            <RelatedRecordPicker label="Related record" value={link} onChange={setLink} />
          </FormSection>
        )}

        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label={editing ? "Save" : "Create task"} isLoading={mutation.isPending}
          isDisabled={!title.trim() || !dueDate || (reminder === CUSTOM && !reminderAt)} />
      </div>
    </Dialog>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

// Full class names so Tailwind keeps them; the colours match the priority badges in the list.
const PRIORITY_STYLE: Record<TaskPriority, { dot: string; selected: string }> = {
  low: { dot: "bg-text-muted", selected: "border-border-strong bg-surface-muted text-text" },
  medium: { dot: "bg-warning", selected: "border-warning bg-warning-soft text-warning" },
  high: { dot: "bg-danger", selected: "border-danger bg-danger-soft text-danger" },
};

// The usual due dates, one click each.
function quickDates() {
  const nextMonday = (8 - new Date().getDay()) % 7 || 7;
  return [{ label: "Today", date: localDate() }, { label: "Tomorrow", date: localDate(1) }, { label: "Next Monday", date: localDate(nextMonday) }, { label: "In a week", date: localDate(7) }];
}

// Completing can schedule the next contact with the customer: a follow-up on the same record, not another task.
export function CompleteTaskDialog({ isOpen, onOpenChange, task, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; task: Task; options: TaskOptions; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [type, setType] = useState("call");
  const [dueAt, setDueAt] = useState("");
  const [nextTask, setNextTask] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      await completeTask(task.id, { note: note.trim() || undefined, expectedUpdatedAt: task.updatedAt, ...(followUp ? { nextFollowUp: { type, dueAt } } : {}) });
      if (nextTask) await createTask({ title: nextTitle.trim(), dueDate: nextDue, priority: task.priority, relatedType: task.relatedType ?? null, relatedId: task.relatedId ?? null, assignedTo: task.assignedTo ?? undefined });
    },
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
            <Checkbox isSelected={followUp} onChange={setFollowUp}>Schedule the next follow-up with {task.relatedName ?? "this record"}</Checkbox>
            {followUp && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Follow-up by" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
                  options={options.followUpTypes.map((entry) => ({ value: entry, label: FOLLOW_UP_LABELS[entry] ?? entry }))} />
                <DateTimeInput label="When" isRequired value={dueAt} onChange={setDueAt} />
              </div>
            )}
          </>
        )}
        <Checkbox isSelected={nextTask} onChange={setNextTask}>Create a next task{task.relatedName ? ` for ${task.relatedName}` : ""}</Checkbox>
        {nextTask && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Next task" isRequired value={nextTitle} onChange={setNextTitle} />
            <DateInput label="Due" isRequired value={nextDue} onChange={setNextDue} />
          </div>
        )}
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Complete" isLoading={mutation.isPending}
          isDisabled={(followUp && !dueAt) || (nextTask && (!nextTitle.trim() || !nextDue))} />
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
