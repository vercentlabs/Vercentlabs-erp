"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  acknowledgeFollowUpReminder,
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

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

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
          { label: "Channel", value: followUp.followUpChannel ?? "—" },
          { label: "Assignee", value: followUp.assignedName ?? "Unassigned" },
        ],
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
      }}
    >
      <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
        <Field label="Due at" value={followUp.dueAt ? dateFormatter.format(new Date(followUp.dueAt)) : null} />
        <Field label="Reason" value={followUp.followUpReason} />
        <Field label="Snooze count" value={followUp.followUpSnoozeCount ?? 0} />
        <Field label="Escalate after (minutes)" value={followUp.escalateAfterMinutes} />
        <Field label="Escalated at" value={followUp.followUpEscalatedAt ? dateFormatter.format(new Date(followUp.followUpEscalatedAt)) : null} />
        <Field label="Completed at" value={followUp.completedAt ? dateFormatter.format(new Date(followUp.completedAt)) : null} />
      </div>
      {followUp.description && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="text-xs text-text-muted">Description</span>
          <p className="text-sm text-text">{followUp.description}</p>
        </div>
      )}
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
          <TextField label="New due date/time" isRequired placeholder="YYYY-MM-DDTHH:mm" value={snoozeAt} onChange={setSnoozeAt} />
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
  const timeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-xs text-text-muted">Reminders</span>
      {reminders.length === 0 ? (
        <p className="text-sm text-text-muted">No reminders scheduled.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-1.5">
              <span className="text-sm text-text">
                {reminder.channel} · {timeFormatter.format(new Date(reminder.fireAt))}
                {reminder.failureReason ? <span className="text-danger"> — {reminder.failureReason}</span> : null}
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
  const timeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-xs text-text-muted">History</span>
      {events.length === 0 ? (
        <p className="text-sm text-text-muted">No history yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {events.map((event, index) => (
            <li key={index} className="flex items-center justify-between text-sm">
              <span className="text-text capitalize">{event.eventType.replace(/_/g, " ")}</span>
              <span className="text-text-muted">{timeFormatter.format(new Date(event.occurredAt))}</span>
            </li>
          ))}
        </ul>
      )}
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
