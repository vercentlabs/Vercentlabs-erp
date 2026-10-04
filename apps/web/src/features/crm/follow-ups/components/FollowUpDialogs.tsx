"use client";

// The follow-up actions that need a few words from the user: schedule,
// reschedule, complete (with outcome and the next step), cancel, reassign,
// snooze. Each is one follow-up operation on the server.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateInput, DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { RelatedRecordPicker, type RelatedValue } from "@/features/crm/shared/ui/RelatedRecordPicker";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  cancelFollowUp, completeFollowUp, errorMessage, reassignFollowUp, rescheduleFollowUp, scheduleFollowUp, updateFollowUp,
  type FollowUp, type FollowUpOptions, type FollowUpRelatedType, type FollowUpType,
} from "../api/follow-ups-api";
import { ErrorBanner, TYPE_LABELS } from "../follow-up-format";

const NONE = "none";
const CUSTOM = "custom";
const today = () => new Date().toISOString().slice(0, 10);

export type RelatedRecord = { type: FollowUpRelatedType; id: string; name?: string | null; accountId?: string | null };

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

function ReminderFields({ options, reminder, setReminder, reminderAt, setReminderAt }: {
  options: FollowUpOptions; reminder: string; setReminder: (value: string) => void; reminderAt: string; setReminderAt: (value: string) => void;
}) {
  return (
    <>
      <Select label="Reminder" selectedKey={reminder} onSelectionChange={(key) => setReminder(String(key))}
        options={[{ value: NONE, label: "No reminder" }, ...options.reminderOptions.map((entry) => ({ value: String(entry.minutes), label: entry.label })), { value: CUSTOM, label: "Custom date and time" }]} />
      {reminder === CUSTOM && <DateTimeInput label="Remind me at" isRequired value={reminderAt} onChange={setReminderAt} />}
    </>
  );
}
const reminderInput = (reminder: string, reminderAt: string) =>
  reminder === CUSTOM ? { reminderAt: reminderAt || null } : { reminderOffsetMinutes: reminder === NONE ? null : Number(reminder) };

// The people who can be the follow-up's contact: those at the record's account.
function useAccountContacts(accountId: string | null | undefined) {
  const workspace = useWorkspaceContext();
  return useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-contacts", accountId),
    queryFn: () => listContacts({ accountId: accountId ?? undefined, limit: 100 }),
    enabled: Boolean(accountId),
  });
}

// related: the record it is scheduled from (prefilled and fixed). followUp: the one being edited.
export function ScheduleFollowUpDialog({ isOpen, onOpenChange, options, related, followUp, onSaved }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; options: FollowUpOptions; onSaved: (followUp: FollowUp) => void; related?: RelatedRecord; followUp?: FollowUp;
}) {
  const editing = Boolean(followUp);
  const [type, setType] = useState<FollowUpType>(followUp?.type ?? "call");
  const [subject, setSubject] = useState(followUp?.subject ?? "");
  const [notes, setNotes] = useState(followUp?.notes ?? "");
  const [scheduledDate, setScheduledDate] = useState(today());
  const [scheduledTime, setScheduledTime] = useState("");
  const [reminder, setReminder] = useState(followUp ? (followUp.reminderOffsetMinutes === null ? NONE : String(followUp.reminderOffsetMinutes)) : "15");
  const [reminderAt, setReminderAt] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [contactId, setContactId] = useState(followUp?.contactId ?? NONE);
  const [link, setLink] = useState<RelatedValue>({ entityType: "general", entityId: "" });
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const accountId = followUp?.accountId ?? related?.accountId ?? (related?.type === "party" ? related.id : null);
  const contacts = useAccountContacts(related?.type === "contact" || followUp?.relatedType === "contact" ? null : accountId);
  const canPickContact = Boolean(accountId) && related?.type !== "contact" && followUp?.relatedType !== "contact";

  const mutation = useMutation({
    mutationFn: () => {
      const common = { type, subject, notes, ...reminderInput(reminder, reminderAt), ...(canPickContact ? { contactId: contactId === NONE ? null : contactId } : {}) };
      if (followUp) return updateFollowUp(followUp.id, { ...common, expectedUpdatedAt: followUp.updatedAt });
      const target = related ?? (link.entityType !== "general" && link.entityId ? { type: link.entityType as FollowUpRelatedType, id: link.entityId } : null);
      return scheduleFollowUp({ ...common, relatedType: target?.type, relatedId: target?.id, scheduledDate, scheduledTime, ...(assignedTo ? { assignedTo } : {}), idempotencyKey });
    },
    onSuccess: (saved) => { setError(null); onSaved(saved); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={editing ? `Edit ${followUp?.number ?? "follow-up"}` : "Schedule follow-up"} size="lg"
      description={related ? `With ${related.name ?? "this record"}. It also appears in CRM Follow-ups.` : "When to contact the customer again, how, and why."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {!related && !editing && <RelatedRecordPicker label="About" value={link} onChange={setLink} />}
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Type" selectedKey={type} onSelectionChange={(key) => setType(String(key) as FollowUpType)} options={options.types.map((entry) => ({ value: entry.code, label: entry.label }))} />
          {!editing && <DateInput label="Date" isRequired value={scheduledDate} onChange={setScheduledDate} />}
          {!editing && <TextField label="Time" type="time" description="Optional." value={scheduledTime} onChange={setScheduledTime} />}
        </div>
        <TextField label="Subject" description="Leave empty to use the type and the record's name." value={subject} onChange={setSubject} placeholder="For example: Follow up on ERP pricing" />
        <div className="grid gap-4 sm:grid-cols-2">
          {canPickContact && (
            <Select label="Contact" selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key ?? NONE))}
              options={[{ value: NONE, label: "No specific contact" }, ...(contacts.data?.rows ?? []).map((row) => ({ value: row.id, label: row.displayName }))]} />
          )}
          {!editing && (
            <Select label="Assigned to" selectedKey={assignedTo || "owner"} onSelectionChange={(key) => setAssignedTo(String(key) === "owner" ? "" : String(key))}
              options={[{ value: "owner", label: "The record's owner" }, ...options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))]} />
          )}
          <ReminderFields options={options} reminder={reminder} setReminder={setReminder} reminderAt={reminderAt} setReminderAt={setReminderAt} />
        </div>
        <TextArea label="Purpose / notes" value={notes} onChange={setNotes} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label={editing ? "Save" : "Schedule"} isLoading={mutation.isPending}
          isDisabled={(!editing && !scheduledDate) || (!related && !editing && !link.entityId) || (reminder === CUSTOM && !reminderAt)} />
      </div>
    </Dialog>
  );
}

export function RescheduleFollowUpDialog({ isOpen, onOpenChange, followUp, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp; onDone: () => void }) {
  const [scheduledDate, setScheduledDate] = useState(followUp.scheduledDate ?? today());
  const [scheduledTime, setScheduledTime] = useState(followUp.scheduledTime ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => rescheduleFollowUp(followUp.id, { scheduledDate, scheduledTime, reason: reason.trim() || undefined, expectedUpdatedAt: followUp.updatedAt }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Reschedule follow-up"
      description={`Now ${followUp.scheduledDate}${followUp.scheduledTime ? ` ${followUp.scheduledTime}` : ""}. The old time stays in the history; the reminder moves with it.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateInput label="New date" isRequired value={scheduledDate} onChange={setScheduledDate} />
          <TextField label="New time" type="time" description="Optional." value={scheduledTime} onChange={setScheduledTime} />
        </div>
        <TextField label="Reason" description="Optional." value={reason} onChange={setReason} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Reschedule" isLoading={mutation.isPending} isDisabled={!scheduledDate} />
      </div>
    </Dialog>
  );
}

// Completing records what happened, and can set the next step straight away:
// another follow-up ("No response → Friday 11 AM") or a task ("Prepare revised quotation").
export function CompleteFollowUpDialog({ isOpen, onOpenChange, followUp, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp; options: FollowUpOptions; onDone: () => void;
}) {
  const [outcome, setOutcome] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [nextFollowUp, setNextFollowUp] = useState(false);
  const [nextType, setNextType] = useState<FollowUpType>(followUp.type);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [nextTask, setNextTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => completeFollowUp(followUp.id, {
      outcome: outcome === NONE ? undefined : outcome, notes: notes.trim() || undefined, expectedUpdatedAt: followUp.updatedAt,
      ...(nextFollowUp ? { nextFollowUp: { type: nextType, scheduledDate: nextDate, scheduledTime: nextTime } } : {}),
      ...(nextTask ? { nextTask: { title: taskTitle, dueDate: taskDate } } : {}),
    }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Complete follow-up" size="lg"
      description={`${followUp.subject}${followUp.type !== "other" ? `. The ${TYPE_LABELS[followUp.type].toLowerCase()} is recorded on the timeline.` : ""}`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Outcome" selectedKey={outcome} onSelectionChange={(key) => setOutcome(String(key))}
          options={[{ value: NONE, label: "Not recorded" }, ...options.outcomes.map((entry) => ({ value: entry.code, label: entry.label }))]} />
        <TextArea label="Notes" description="What was said or agreed." value={notes} onChange={setNotes} />
        <Checkbox isSelected={nextFollowUp} onChange={setNextFollowUp}>Schedule the next follow-up</Checkbox>
        {nextFollowUp && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Type" selectedKey={nextType} onSelectionChange={(key) => setNextType(String(key) as FollowUpType)} options={options.types.map((entry) => ({ value: entry.code, label: entry.label }))} />
            <DateInput label="Date" isRequired value={nextDate} onChange={setNextDate} />
            <TextField label="Time" type="time" value={nextTime} onChange={setNextTime} />
          </div>
        )}
        <Checkbox isSelected={nextTask} onChange={setNextTask}>Create a task</Checkbox>
        {nextTask && (
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <TextField label="Task" isRequired value={taskTitle} onChange={setTaskTitle} placeholder="For example: Prepare revised quotation" />
            <DateInput label="Due" isRequired value={taskDate} onChange={setTaskDate} />
          </div>
        )}
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Complete" isLoading={mutation.isPending}
          isDisabled={(nextFollowUp && !nextDate) || (nextTask && (!taskTitle.trim() || !taskDate))} />
      </div>
    </Dialog>
  );
}

export function CancelFollowUpDialog({ isOpen, onOpenChange, followUp, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => cancelFollowUp(followUp.id, { reason: reason.trim() || undefined, expectedUpdatedAt: followUp.updatedAt }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Cancel follow-up" description="It is kept with its history; its reminder is cancelled.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Reason" description="Optional." value={reason} onChange={setReason} />
        <Actions danger onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Cancel follow-up" isLoading={mutation.isPending} />
      </div>
    </Dialog>
  );
}

export function ReassignFollowUpDialog({ isOpen, onOpenChange, followUp, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp; options: FollowUpOptions; onDone: () => void;
}) {
  const [assignedTo, setAssignedTo] = useState(followUp.assignedTo ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => reassignFollowUp(followUp.id, { assignedTo, reason: reason.trim() || undefined, expectedUpdatedAt: followUp.updatedAt }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Reassign follow-up" description={`Assigned to ${followUp.assignedName ?? "nobody"}.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Assign to" selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))}
          options={options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))} />
        <TextField label="Reason" description="Optional. Kept in the history." value={reason} onChange={setReason} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Reassign" isLoading={mutation.isPending} isDisabled={!assignedTo || assignedTo === followUp.assignedTo} />
      </div>
    </Dialog>
  );
}
