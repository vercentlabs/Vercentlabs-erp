"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Pencil, X } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, Timeline, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { dueLabel, dueState, formatDateTime, formatMinutes, humanize, reminderLabel } from "@/shared/format/human";
import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { RelatedRecordCard } from "@/features/crm/shared/ui/RelatedRecordCard";
import {
  acknowledgeFollowUpReminder,
  cancelFollowUp,
  completeFollowUp,
  FollowUpApiError,
  getFollowUp,
  listFollowUpHistory,
  listFollowUpReminders,
  snoozeFollowUp,
  updateFollowUp,
} from "../api/follow-ups-api";
import type { FollowUp } from "../types";

const REMINDER_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  dispatching: "info",
  sent: "success",
  acknowledged: "success",
  failed: "danger",
  cancelled: "neutral",
};


// F016 Tranche J (Stage A) — dedicated Follow-up detail view; getCrmFollowUp/
// updateCrmFollowUp (follow-up-operations.js) were already real, already
// routed, with no frontend consumer. Stage A2 §7 closeout: a custom
// snooze-duration control, reminder-plan editing, reminder delivery-status/
// retry-failure visibility and an escalation/lifecycle history timeline
// were all genuine, confirmed gaps — the backend (snoozeCrmFollowUp already
// took an arbitrary dueAt; listRemindersForActivity/acknowledgeReminder/
// listCrmFollowUpHistory already existed, already tested) had zero
// frontend consumer for any of them. All now wired below.
export function FollowUpDetailScreen({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeAt, setSnoozeAt] = useState("");
  const [snoozeError, setSnoozeError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId), queryFn: () => getFollowUp(followUpId) });
  const followUp = query.data?.record;

  const [actionError, setActionError] = useState<string | null>(null);
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
  }
  function handleActionError(err: unknown) {
    setActionError(err instanceof FollowUpApiError ? err.message : "This action could not be completed.");
    if (err instanceof FollowUpApiError && err.code?.includes("STALE")) invalidateAll();
  }
  const onActionDone = () => { setActionError(null); invalidateAll(); };
  // The list screen already offered Complete/Cancel as row actions; the
  // detail page only had Snooze and Edit.
  const completeMutation = useMutation({ mutationFn: () => completeFollowUp(followUpId, followUp?.updatedAt), onSuccess: onActionDone, onError: handleActionError });
  const cancelMutation = useMutation({ mutationFn: () => cancelFollowUp(followUpId, followUp?.updatedAt), onSuccess: onActionDone, onError: handleActionError });

  const snoozeMutation = useMutation({
    mutationFn: () => snoozeFollowUp(followUpId, new Date(snoozeAt).toISOString(), followUp?.updatedAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId) });
      setSnoozeOpen(false);
      setSnoozeError(null);
    },
    onError: (err: unknown) => setSnoozeError(err instanceof FollowUpApiError ? err.message : "This follow-up could not be snoozed."),
  });

  if (query.isLoading) return <LoadingState label="Loading follow-up" rows={3} />;
  if (query.isError) {
    if (query.error instanceof FollowUpApiError && query.error.status === 403) return <PermissionState title="You don't have access to this follow-up" />;
    return <ErrorState title="Follow-up not found" action={{ label: "Back to Follow-ups", onPress: () => router.push("/crm/follow-ups") }} />;
  }
  if (!followUp) return null;

  const canAct = canManage && followUp.status !== "completed" && followUp.status !== "cancelled";

  return (
    <RecordDetailsPage
      header={{
        title: followUp.subject,
        status: <StatusBadge tone={followUp.status === "completed" ? "success" : followUp.status === "cancelled" ? "neutral" : "info"}>{followUp.status}</StatusBadge>,
        fields: [
          { label: "Due", value: followUp.dueAt ? `${formatDateTime(followUp.dueAt)}${canAct && dueState(followUp.dueAt) === "overdue" ? " (" + dueLabel(followUp.dueAt) + ")" : ""}` : "" },
          { label: "Channel", value: humanize(followUp.followUpChannel) },
          { label: "Assignee", value: followUp.assignedName ?? "Unassigned" },
        ].filter((field) => field.value !== ""),
        // updateCrmFollowUp rejects completed/cancelled (CRM_FOLLOW_UP_READ_ONLY)
        // — hiding Edit/Snooze in those states avoids offering a rejected action.
        primaryAction: canAct ? (
          <div className="flex gap-2">
            <Button variant="secondary" onPress={() => { setSnoozeAt(""); setSnoozeError(null); setSnoozeOpen(true); }}>
              <Clock className="size-4" aria-hidden="true" />
              Snooze
            </Button>
            <Button variant="secondary" onPress={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          </div>
        ) : undefined,
        secondaryActions: canAct ? (
          <>
            <Button variant="secondary" onPress={() => completeMutation.mutate()} isLoading={completeMutation.isPending}>
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
        {actionError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        )}
        <PropertyList title="Related record" columns={1} items={[{ label: "Belongs to", value: <RelatedRecordCard entityType={followUp.entityType} entityId={followUp.entityId} /> }]} />
        <PropertyList title="Follow-up" items={[
          { label: "Reason", value: followUp.followUpReason },
          { label: "Notes", value: followUp.description, wide: true },
          { label: "Snoozed", value: followUp.followUpSnoozeCount ? `${followUp.followUpSnoozeCount} time${followUp.followUpSnoozeCount === 1 ? "" : "s"}` : null },
          { label: "Escalates after", value: followUp.escalateAfterMinutes ? formatMinutes(followUp.escalateAfterMinutes) + " overdue" : null },
          { label: "Escalated", value: followUp.followUpEscalatedAt ? formatDateTime(followUp.followUpEscalatedAt) : null },
          { label: "Completed", value: followUp.completedAt ? formatDateTime(followUp.completedAt) : null },
        ]} />
      </div>
      <RemindersPanel followUpId={followUp.id} />
      <HistoryPanel followUpId={followUp.id} />
      <EditFollowUpDialog isOpen={editOpen} onOpenChange={setEditOpen} followUp={followUp} />
      <Dialog isOpen={snoozeOpen} onOpenChange={setSnoozeOpen} title="Snooze follow-up">
        <div className="flex flex-col gap-4">
          {snoozeError && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {snoozeError}
            </p>
          )}
          <DateTimeInput label="New due date and time" isRequired value={snoozeAt} onChange={setSnoozeAt} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setSnoozeOpen(false)}>Cancel</Button>
            <Button variant="primary" onPress={() => snoozeMutation.mutate()} isLoading={snoozeMutation.isPending} isDisabled={!snoozeAt}>
              Snooze
            </Button>
          </div>
        </div>
      </Dialog>
    </RecordDetailsPage>
  );
}

// F016 Stage A2 §7. listRemindersForActivity/acknowledgeReminder already
// existed, fully tested — this surfaces the real delivery status
// (pending/dispatching/sent/failed/acknowledged) and failure_reason the
// dispatch worker (crm-follow-up-reminder-dispatch.js) already records.
function RemindersPanel({ followUpId }: { followUpId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const remindersQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId, "reminders"),
    queryFn: () => listFollowUpReminders(followUpId),
  });
  const acknowledgeMutation = useMutation({
    mutationFn: (reminderId: string) => acknowledgeFollowUpReminder(followUpId, reminderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId, "reminders") }),
  });
  const reminders = remindersQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-sm font-semibold text-text">Reminders</span>
      {reminders.length === 0 ? (
        <p className="text-sm text-text-muted">No reminders scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-1.5">
              <span className="text-sm text-text">
                {reminderLabel(reminder.offsetMinutes)} · {humanize(reminder.channel)} · {formatDateTime(reminder.fireAt)}
                {reminder.failureReason ? <span className="text-danger"> — {humanize(reminder.failureReason)}</span> : null}
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge tone={REMINDER_STATUS_TONE[reminder.status] ?? "neutral"}>{reminder.status}</StatusBadge>
                {reminder.status === "sent" && (
                  <Button variant="secondary" size="compact" onPress={() => acknowledgeMutation.mutate(reminder.id)} isLoading={acknowledgeMutation.isPending}>
                    Acknowledge
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// F016 Stage A2 §7. listCrmFollowUpHistory already existed — covers
// escalation history (escalateOverdueFollowUps writes an 'escalated'
// event into the same ledger) alongside the rest of the lifecycle.
function HistoryPanel({ followUpId }: { followUpId: string }) {
  const workspace = useWorkspaceContext();
  const historyQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUpId, "history"),
    queryFn: () => listFollowUpHistory(followUpId),
  });
  const events = historyQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-sm font-semibold text-text">History</span>
      <Timeline
        emptyMessage={historyQuery.isLoading ? "Loading history…" : historyQuery.isError ? "History could not be loaded. Refresh to try again." : "No history yet."}
        entries={events.map((event, index) => ({ id: String(index), tone: event.eventType === "escalated" ? "warning" : event.eventType === "completed" ? "success" : "neutral", title: humanize(event.eventType), description: event.eventType === "snoozed" && event.metadata?.previousDueAt ? `Was due ${formatDateTime(String(event.metadata.previousDueAt))}` : undefined, timestamp: formatDateTime(event.occurredAt) }))}
      />
    </div>
  );
}

function EditFollowUpDialog({ isOpen, onOpenChange, followUp }: { isOpen: boolean; onOpenChange: (open: boolean) => void; followUp: FollowUp }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(followUp.subject);
  const [description, setDescription] = useState(followUp.description ?? "");
  const [followUpReason, setFollowUpReason] = useState(followUp.followUpReason ?? "");
  const [followUpChannel, setFollowUpChannel] = useState(followUp.followUpChannel ?? "call");
  const [assignedTo, setAssignedTo] = useState(followUp.assignedTo ?? "");
  const [editReminderPlan, setEditReminderPlan] = useState(false);
  const [reminderOffsetsText, setReminderOffsetsText] = useState("1440, 60, 0");
  const [reminderChannel, setReminderChannel] = useState<"in_app" | "email">("in_app");
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateFollowUp(followUp.id, {
        subject,
        description: description || null,
        followUpReason: followUpReason || null,
        followUpChannel,
        assignedTo: assignedTo || null,
        ...(editReminderPlan
          ? {
              reminderOffsets: reminderOffsetsText
                .split(",")
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isFinite(value) && value >= 0),
              reminderChannel,
            }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUp.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
      if (editReminderPlan) queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", followUp.id, "reminders") });
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof FollowUpApiError ? err.message : "This follow-up could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Edit ${followUp.subject}`}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} />
        <Select
          label="Channel"
          options={[
            { value: "call", label: "Call" },
            { value: "email", label: "Email" },
            { value: "meeting", label: "Meeting" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "sms", label: "SMS" },
            { value: "other", label: "Other" },
          ]}
          selectedKey={followUpChannel}
          onSelectionChange={(key) => setFollowUpChannel(String(key ?? "call") as "call" | "email" | "meeting" | "whatsapp" | "sms" | "other")}
        />
        <TextField label="Reason" value={followUpReason} onChange={setFollowUpReason} />
        <Select label="Assignee" options={assigneeOptions} selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key ?? ""))} />
        <TextArea label="Description" value={description} onChange={setDescription} />

        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-text">
            <input type="checkbox" checked={editReminderPlan} onChange={(event) => setEditReminderPlan(event.target.checked)} />
            Change the reminder plan
          </label>
          {editReminderPlan && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <TextField
                label="Reminder offsets (minutes before due, comma-separated)"
                description="e.g. 1440, 60, 0 for a day before, an hour before, and at due time."
                value={reminderOffsetsText}
                onChange={setReminderOffsetsText}
              />
              <Select
                label="Reminder channel"
                options={[
                  { value: "in_app", label: "In-app" },
                  { value: "email", label: "Email" },
                ]}
                selectedKey={reminderChannel}
                onSelectionChange={(key) => setReminderChannel((key as "in_app" | "email") ?? "in_app")}
              />
            </div>
          )}
        </div>

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
