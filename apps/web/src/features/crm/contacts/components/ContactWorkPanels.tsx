"use client";

// The work done and planned with a person: logged activities, tasks and
// follow-ups. A logged call or meeting can be about one of their
// opportunities; a task can belong to the contact or to an opportunity.
// Everything logged here also shows on the person's company.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { PRIORITY_OPTIONS } from "@/features/crm/leads/lead-format";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { completeFollowUp, snoozeFollowUp } from "@/features/crm/work/follow-ups/api/follow-ups-api";
import { completeTask, createTask, reopenTask } from "@/features/crm/work/tasks/api/tasks-api";
import { dueLabel, dueState, formatDateTime, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  errorMessage, listContactActivities, listContactRelated, logContactActivity, scheduleContactFollowUp,
  type ContactActivity, type ContactOptions,
} from "../api/contacts-api";
import { ErrorBanner, LIVE_CONTACT_QUERY } from "../contact-format";

const OPEN_STATUSES = new Set(["planned", "in_progress", "overdue"]);
const FOLLOW_UP_TYPE_LABELS: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", task: "Task", other: "Other" };
const NO_NEXT_ACTION = "none";
const NO_OPPORTUNITY = "__none__";
const ON_CONTACT = "__contact__";

type PanelProps = { contactId: string; options: ContactOptions; canEdit: boolean };

function useContactActivities(contactId: string) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "activities"), queryFn: () => listContactActivities(contactId), ...LIVE_CONTACT_QUERY });
  // A change here also moves the contact's (and company's) last activity, next follow-up, summary and timeline.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  return { query, refresh };
}

// The person's open opportunities, for "what was this about?" pickers.
function useOpportunityOptions(contactId: string, enabled: boolean) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "related", "opportunities"),
    queryFn: () => listContactRelated(contactId, "opportunities"),
    enabled,
  });
  return (query.data ?? []).filter((row) => row.status === "open");
}

function userOptions(options: ContactOptions) {
  return options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }));
}

function PanelShell({ title, action, query, isEmpty, emptyTitle, emptyDescription, children }: {
  title: string;
  action?: React.ReactNode;
  query: { isLoading: boolean; isError: boolean };
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {query.isLoading ? <LoadingState label={`Loading ${title.toLowerCase()}`} rows={3} />
        : query.isError ? <ErrorBanner message={`Could not load ${title.toLowerCase()}. Refresh the page.`} />
        : isEmpty ? <EmptyState title={emptyTitle} description={emptyDescription} />
        : <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">{children}</ul>}
    </section>
  );
}

// The company and opportunity the activity belongs to.
function SourceLine({ activity }: { activity: ContactActivity }) {
  const parts = [
    activity.accountName ? <Link key="a" href={`/crm/accounts/${activity.accountId}`} className="hover:underline">{activity.accountName}</Link> : null,
    activity.opportunityName ? <Link key="o" href={`/crm/opportunities/${activity.opportunityId}`} className="hover:underline">Opportunity: {activity.opportunityName}</Link> : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="flex flex-wrap gap-x-3 text-xs text-text-secondary">{parts}</p>;
}

function DueText({ activity }: { activity: ContactActivity }) {
  if (!activity.dueAt) return <span className="text-text-muted">No due date</span>;
  const open = OPEN_STATUSES.has(activity.status);
  const state = open ? dueState(activity.dueAt) : "none";
  return (
    <span className={state === "overdue" ? "font-medium text-danger" : state === "today" ? "font-medium text-warning" : "text-text-secondary"}>
      {open ? `${dueLabel(activity.dueAt)} · ` : ""}{formatDateTime(activity.dueAt)}
    </span>
  );
}

function statusTone(status: string): "success" | "danger" | "info" | "neutral" {
  return status === "completed" ? "success" : status === "overdue" ? "danger" : status === "cancelled" ? "neutral" : "info";
}

// ------------------------------------------------------------------ logged activities

export function ContactActivitiesPanel({ contactId, options, canEdit }: PanelProps) {
  const { query, refresh } = useContactActivities(contactId);
  const [isLogging, setLogging] = useState(false);
  const logged = (query.data ?? []).filter((activity) => activity.type !== "task" && activity.type !== "follow_up");

  return (
    <>
      <PanelShell
        title="Activities"
        action={canEdit && <Button variant="primary" size="compact" onPress={() => setLogging(true)}>Log activity</Button>}
        query={query}
        isEmpty={logged.length === 0}
        emptyTitle="No activities logged"
        emptyDescription="Log each call, email and meeting with this person so anyone can see what has happened."
      >
        {logged.map((activity) => (
          <li key={activity.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{activity.type === "other" ? "Activity" : humanize(activity.type)}</Badge>
              <span className="font-medium">{activity.subject}</span>
              <span className="text-text-muted">{formatDateTime(activity.completedAt ?? activity.createdAt)}</span>
            </div>
            <SourceLine activity={activity} />
            {activity.outcome && <p><span className="text-text-secondary">Outcome:</span> {activity.outcome}</p>}
            {activity.notes && <p className="whitespace-pre-wrap text-text-secondary">{activity.notes}</p>}
            <p className="text-xs text-text-muted">By {activity.assignedName ?? activity.createdByName ?? "Unknown"}</p>
          </li>
        ))}
      </PanelShell>
      <LogContactActivityDialog isOpen={isLogging} onOpenChange={setLogging} contactId={contactId} options={options} onDone={refresh} />
    </>
  );
}

export function LogContactActivityDialog({ isOpen, onOpenChange, contactId, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; contactId: string; options: ContactOptions; onDone: () => void;
}) {
  const opportunities = useOpportunityOptions(contactId, isOpen);
  const [type, setType] = useState("call");
  const [opportunityId, setOpportunityId] = useState(NO_OPPORTUNITY);
  const [subject, setSubject] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [nextType, setNextType] = useState(NO_NEXT_ACTION);
  const [nextDueAt, setNextDueAt] = useState("");
  const [nextNotes, setNextNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpportunityId(NO_OPPORTUNITY); setSubject(""); setOutcome(""); setNotes(""); setOccurredAt(""); setNextType(NO_NEXT_ACTION); setNextDueAt(""); setNextNotes(""); setError(null);
  };
  const mutation = useMutation({
    mutationFn: () => logContactActivity(contactId, {
      type, subject, outcome, notes, occurredAt: occurredAt || undefined, opportunityId: opportunityId === NO_OPPORTUNITY ? undefined : opportunityId,
      ...(nextType !== NO_NEXT_ACTION ? { nextAction: { type: nextType, dueAt: nextDueAt, notes: nextNotes } } : {}),
    }),
    onSuccess: () => { onDone(); reset(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const nextActionIncomplete = nextType !== NO_NEXT_ACTION && !nextDueAt;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Log activity" description="Record something that has already happened." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" isRequired selectedKey={type} onSelectionChange={(key) => setType(String(key))}
            options={options.activityTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <DateTimeInput label="When" description="Leave empty for now." value={occurredAt} onChange={setOccurredAt} />
        </div>
        <Select label="About an opportunity" selectedKey={opportunityId} onSelectionChange={(key) => setOpportunityId(String(key))}
          options={[{ value: NO_OPPORTUNITY, label: "No specific opportunity" }, ...opportunities.map((row) => ({ value: row.id, label: row.title ?? row.code ?? "Opportunity" }))]} />
        <TextField label="Subject" description="Leave empty to use the activity type and the person's name." value={subject} onChange={setSubject} />
        <TextField label="Outcome" value={outcome} onChange={setOutcome} placeholder="For example: Interested, wants a demo" />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-border p-3">
          <Select label="Next action" selectedKey={nextType} onSelectionChange={(key) => setNextType(String(key))}
            options={[{ value: NO_NEXT_ACTION, label: "None" }, ...options.followUpTypes.map((entry) => ({ value: entry, label: `Follow-up: ${FOLLOW_UP_TYPE_LABELS[entry] ?? entry}` }))]} />
          {nextType !== NO_NEXT_ACTION && (
            <>
              <DateTimeInput label="Follow-up date and time" isRequired value={nextDueAt} onChange={setNextDueAt} />
              <TextField label="Follow-up notes" value={nextNotes} onChange={setNextNotes} />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={nextActionIncomplete}>Log activity</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ follow-ups

export function ContactFollowUpsPanel({ contactId, options, canEdit }: PanelProps) {
  const { query, refresh } = useContactActivities(contactId);
  const [isScheduling, setScheduling] = useState(false);
  const [rescheduling, setRescheduling] = useState<ContactActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followUps = (query.data ?? []).filter((activity) => activity.type === "follow_up");
  const complete = useMutation({
    mutationFn: (activity: ContactActivity) => completeFollowUp(activity.id, activity.updatedAt),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <>
      <ErrorBanner message={error} />
      <PanelShell
        title="Follow-ups"
        action={canEdit && <Button variant="primary" size="compact" onPress={() => setScheduling(true)}>Schedule follow-up</Button>}
        query={query}
        isEmpty={followUps.length === 0}
        emptyTitle="No follow-ups"
        emptyDescription="Schedule the next conversation with this person. You are reminded when it is due."
      >
        {followUps.map((activity) => (
          <li key={activity.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{FOLLOW_UP_TYPE_LABELS[activity.channel ?? "other"] ?? "Follow-up"}</Badge>
                <Link href={`/crm/follow-ups/${activity.id}`} className="font-medium hover:underline">{activity.subject}</Link>
                <StatusBadge tone={statusTone(activity.status)}>{OPEN_STATUSES.has(activity.status) ? (activity.status === "overdue" ? "Overdue" : "Pending") : humanize(activity.status)}</StatusBadge>
              </div>
              <DueText activity={activity} />
              <SourceLine activity={activity} />
              {activity.notes && <p className="text-text-secondary">{activity.notes}</p>}
              <p className="text-xs text-text-muted">Assigned to {activity.assignedName ?? "nobody"}</p>
            </div>
            {canEdit && OPEN_STATUSES.has(activity.status) && (
              <div className="flex gap-2">
                <Button variant="secondary" size="compact" onPress={() => setRescheduling(activity)}>Reschedule</Button>
                <Button variant="primary" size="compact" onPress={() => complete.mutate(activity)} isLoading={complete.isPending && complete.variables?.id === activity.id}>Mark done</Button>
              </div>
            )}
          </li>
        ))}
      </PanelShell>
      <ScheduleContactFollowUpDialog isOpen={isScheduling} onOpenChange={setScheduling} contactId={contactId} options={options} onDone={refresh} />
      {rescheduling && <RescheduleDialog activity={rescheduling} onClose={() => setRescheduling(null)} onDone={refresh} />}
    </>
  );
}

export function ScheduleContactFollowUpDialog({ isOpen, onOpenChange, contactId, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; contactId: string; options: ContactOptions; onDone: () => void;
}) {
  const [type, setType] = useState("call");
  const [dueAt, setDueAt] = useState("");
  const [assignedTo, setAssignedTo] = useState(options.currentUserId);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => scheduleContactFollowUp(contactId, { type, dueAt, assignedTo, notes }),
    onSuccess: () => { onDone(); setDueAt(""); setNotes(""); setError(null); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Schedule follow-up">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Type" isRequired selectedKey={type} onSelectionChange={(key) => setType(String(key))}
          options={options.followUpTypes.map((entry) => ({ value: entry, label: FOLLOW_UP_TYPE_LABELS[entry] ?? entry }))} />
        <DateTimeInput label="Date and time" isRequired value={dueAt} onChange={setDueAt} />
        <Select label="Assigned to" isRequired selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))} options={userOptions(options)} />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dueAt || !assignedTo}>Schedule</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RescheduleDialog({ activity, onClose, onDone }: { activity: ContactActivity; onClose: () => void; onDone: () => void }) {
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => snoozeFollowUp(activity.id, dueAt, activity.updatedAt),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const snooze = (hours: number) => setDueAt(new Date(Date.now() + hours * 3_600_000).toISOString());

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Reschedule follow-up" description={activity.subject}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="compact" onPress={() => snooze(1)}>In 1 hour</Button>
          <Button variant="outline" size="compact" onPress={() => snooze(24)}>Tomorrow</Button>
          <Button variant="outline" size="compact" onPress={() => snooze(72)}>In 3 days</Button>
          <Button variant="outline" size="compact" onPress={() => snooze(168)}>Next week</Button>
        </div>
        <DateTimeInput label="New date and time" isRequired value={dueAt} onChange={setDueAt} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dueAt}>Reschedule</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ tasks

export function ContactTasksPanel({ contactId, options, canEdit }: PanelProps) {
  const { query, refresh } = useContactActivities(contactId);
  const [isCreating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tasks = (query.data ?? []).filter((activity) => activity.type === "task");
  const toggle = useMutation({
    mutationFn: (task: ContactActivity) => (OPEN_STATUSES.has(task.status) ? completeTask(task.id, undefined, task.updatedAt) : reopenTask(task.id, task.updatedAt)),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <>
      <ErrorBanner message={error} />
      <PanelShell
        title="Tasks"
        action={canEdit && <Button variant="primary" size="compact" onPress={() => setCreating(true)}>New task</Button>}
        query={query}
        isEmpty={tasks.length === 0}
        emptyTitle="No tasks"
        emptyDescription="Add the things that need doing for this person, such as sending a proposal. Tasks also appear in CRM Tasks."
      >
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/crm/tasks/${task.id}`} className="font-medium hover:underline">{task.subject}</Link>
                <StatusBadge tone={statusTone(task.status)}>{humanize(task.status)}</StatusBadge>
                <Badge tone={task.priority === "high" || task.priority === "urgent" ? "danger" : "neutral"}>{task.priority}</Badge>
              </div>
              <DueText activity={task} />
              <SourceLine activity={task} />
              {task.notes && <p className="text-text-secondary">{task.notes}</p>}
              <p className="text-xs text-text-muted">Assigned to {task.assignedName ?? "nobody"}</p>
            </div>
            {canEdit && task.status !== "cancelled" && (
              <Button variant={OPEN_STATUSES.has(task.status) ? "primary" : "secondary"} size="compact" onPress={() => toggle.mutate(task)} isLoading={toggle.isPending && toggle.variables?.id === task.id}>
                {OPEN_STATUSES.has(task.status) ? "Complete" : "Reopen"}
              </Button>
            )}
          </li>
        ))}
      </PanelShell>
      <NewTaskDialog isOpen={isCreating} onOpenChange={setCreating} contactId={contactId} options={options} onDone={refresh} />
    </>
  );
}

function NewTaskDialog({ isOpen, onOpenChange, contactId, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; contactId: string; options: ContactOptions; onDone: () => void;
}) {
  const openOpportunities = useOpportunityOptions(contactId, isOpen);
  const [relatedTo, setRelatedTo] = useState(ON_CONTACT);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState(options.currentUserId);
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    // A task with a due time notifies its assignee when it falls due.
    mutationFn: () => createTask({
      entityType: relatedTo === ON_CONTACT ? "contact" : "opportunity",
      entityId: relatedTo === ON_CONTACT ? contactId : relatedTo,
      subject, description: description || undefined, assignedTo, priority, ...(dueAt ? { dueAt } : {}),
    }),
    onSuccess: () => { onDone(); setSubject(""); setDescription(""); setDueAt(""); setRelatedTo(ON_CONTACT); setError(null); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New task">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Title" isRequired value={subject} onChange={setSubject} />
        <Select label="Related to" selectedKey={relatedTo} onSelectionChange={(key) => setRelatedTo(String(key))}
          options={[{ value: ON_CONTACT, label: "This contact" }, ...openOpportunities.map((row) => ({ value: row.id, label: `Opportunity: ${row.title ?? row.code}` }))]} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <Select label="Assigned to" isRequired selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key))} options={userOptions(options)} />
        <DateTimeInput label="Due date and time" description="The assignee is reminded when the task is due." value={dueAt} onChange={setDueAt} />
        <Select label="Priority" selectedKey={priority} onSelectionChange={(key) => setPriority(String(key))} options={PRIORITY_OPTIONS} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!subject.trim()}>Create task</Button>
        </div>
      </div>
    </Dialog>
  );
}
