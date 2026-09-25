"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Play, X } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { dueLabel, dueState, formatDateTime, humanize } from "@/features/crm/shared/human";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { RelatedRecordCard } from "@/features/crm/shared/ui/RelatedRecordCard";
import { cancelMeeting, getMeeting, listMeetingEvents, MeetingApiError, startMeeting, updateMeeting } from "../api/meetings-api";
import { CompleteMeetingDialog } from "../components/CompleteMeetingDialog";
import type { Meeting } from "../types";

// F014 Tranche J (Stage A) — dedicated Meeting detail view; getCrmMeeting/
// updateCrmMeeting (meeting-operations.js) were already real, already
// routed, with no frontend consumer. Attendees remain read-only plain
// text here (a real contact-picker UI is a separate, disclosed gap, not
// rebuilt in this edit dialog).
export function MeetingDetailScreen({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "meetings", meetingId), queryFn: () => getMeeting(meetingId) });
  const meeting = query.data?.record;

  // F014 gap-closure — listCrmMeetingEvents (the immutable crm_meeting_events
  // ledger) existed, tested and routed with no frontend reader anywhere.
  const eventsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "meetings", meetingId, "events"),
    queryFn: () => listMeetingEvents(meetingId),
    enabled: Boolean(meeting),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings", meetingId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings") });
  }

  function handleError(err: unknown) {
    setActionError(err instanceof MeetingApiError ? err.message : "This action could not be completed.");
    if (err instanceof MeetingApiError && (err.code === "CRM_MEETING_STALE_WRITE" || err.code === "CRM_MEETING_CONFLICT")) invalidate();
  }

  const startMutation = useMutation({ mutationFn: () => startMeeting(meeting!.id, meeting!.updatedAt), onSuccess: invalidate, onError: handleError });
  const cancelMutation = useMutation({ mutationFn: () => cancelMeeting(meeting!.id, meeting!.updatedAt), onSuccess: invalidate, onError: handleError });

  if (query.isLoading) return <LoadingState label="Loading meeting" rows={3} />;
  if (query.isError) {
    if (query.error instanceof MeetingApiError && query.error.status === 403) return <PermissionState title="You don't have access to this meeting" />;
    return <ErrorState title="Meeting not found" action={{ label: "Back to Meetings", onPress: () => router.push("/crm/meetings") }} />;
  }
  if (!meeting) return null;

  const isTerminal = meeting.status === "completed" || meeting.status === "cancelled";
  // updateCrmMeeting/cancelCrmMeeting reject a booked meeting
  // (CRM_MEETING_BOOKING_MANAGED) — offering Edit/Cancel there would only
  // surface the backend's rejection.
  const isBooked = Boolean(meeting.bookingId);

  return (
    <RecordDetailsPage
      header={{
        title: meeting.subject,
        status: <StatusBadge tone={meeting.status === "completed" ? "success" : meeting.status === "cancelled" ? "neutral" : "info"}>{meeting.status}</StatusBadge>,
        fields: [
          { label: "When", value: meeting.startAt ? `${formatDateTime(meeting.startAt)}${(meeting.status === "planned" || meeting.status === "overdue") && dueState(meeting.startAt) === "overdue" ? " (" + dueLabel(meeting.startAt) + ")" : ""}` : "" },
          { label: "Where", value: meeting.locationType === "online" ? "Online" : meeting.locationType ? humanize(meeting.locationType) + (meeting.location ? ", " + meeting.location : "") : "" },
          { label: "Assignee", value: meeting.assignedName ?? "Unassigned" },
        ].filter((field) => field.value !== ""),
        // updateCrmMeeting rejects any status other than planned/overdue —
        // hiding Edit outside that window avoids offering a rejected action.
        primaryAction:
          meeting.meetingUrl && (meeting.status === "planned" || meeting.status === "overdue" || meeting.status === "in_progress") ? (
            <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex h-[var(--control-height-standard)] items-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover">
              Join meeting
            </a>
          ) : undefined,
        secondaryActions:
          canManage && !isTerminal ? (
            <>
              {(meeting.status === "planned" || meeting.status === "overdue") && !isBooked && (
                <Button variant="secondary" onPress={() => setEditOpen(true)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
              )}
              {meeting.status !== "in_progress" && (
                <Button variant="secondary" onPress={() => startMutation.mutate()} isLoading={startMutation.isPending}>
                  <Play className="size-4" aria-hidden="true" />
                  Start
                </Button>
              )}
              <Button variant="secondary" onPress={() => setCompleteOpen(true)}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Complete
              </Button>
              {!isBooked && (
                <Button variant="danger" onPress={() => cancelMutation.mutate()} isLoading={cancelMutation.isPending}>
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              )}
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
        <PropertyList title="Related record" columns={1} items={[{ label: "Belongs to", value: <RelatedRecordCard entityType={meeting.entityType} entityId={meeting.entityId} /> }]} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PropertyList title="Details" items={[
            { label: "Starts", value: meeting.startAt ? formatDateTime(meeting.startAt) : null },
            { label: "Ends", value: meeting.endAt ? formatDateTime(meeting.endAt) : null },
            { label: "Meeting link", value: meeting.meetingUrl ? <a className="break-all text-brand hover:underline" href={meeting.meetingUrl} target="_blank" rel="noreferrer">{meeting.meetingUrl}</a> : null, wide: true },
            { label: "Location", value: meeting.location },
            { label: "Priority", value: humanize(meeting.priority) },
            { label: "Agenda", value: meeting.description, wide: true },
          ]} />
          <PropertyList title="Outcome" description={meeting.status === "planned" || meeting.status === "overdue" ? "Recorded after the meeting." : undefined} items={[
            { label: "Result", value: humanize(meeting.outcomeCode) },
            { label: "Notes", value: meeting.outcome, wide: true },
            { label: "Completed", value: meeting.completedAt ? formatDateTime(meeting.completedAt) : null },
          ]} />
        </div>
        {meeting.attendees && meeting.attendees.length > 0 && (
          <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <h3 className="text-sm font-semibold text-text">{`Attendees (${meeting.attendees.length})`}</h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {meeting.attendees.map((attendee, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-text">{attendee.name && attendee.name !== attendee.email ? attendee.name : attendee.email}{attendee.name && attendee.name !== attendee.email ? <span className="text-text-muted">{` · ${attendee.email}`}</span> : null}</span>
                  {attendee.responseStatus && <StatusBadge tone={attendee.responseStatus === "accepted" ? "success" : attendee.responseStatus === "declined" ? "danger" : "neutral"}>{attendee.responseStatus}</StatusBadge>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text">Meeting history</p>
          {eventsQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading history…</p>
          ) : (eventsQuery.data?.rows.length ?? 0) === 0 ? (
            <p className="text-sm text-text-muted">No history recorded yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {eventsQuery.data!.rows.map((event) => (
                <li key={event.id} className="flex flex-col gap-0.5 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={event.eventType === "cancelled" ? "danger" : event.eventType === "completed" ? "success" : "neutral"}>{humanize(event.eventType)}</StatusBadge>
                    {event.outcomeCode && <span className="text-text-secondary">{humanize(event.outcomeCode)}</span>}
                    <span className="text-xs text-text-muted">{formatDateTime(event.changedAt)}</span>
                  </div>
                  <span className="text-xs text-text-secondary">{event.changedByName ? `By ${event.changedByName}` : "System"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <EditMeetingDialog isOpen={editOpen} onOpenChange={setEditOpen} meeting={meeting} />
      {completeOpen && (
        <CompleteMeetingDialog
          meeting={meeting}
          onOpenChange={setCompleteOpen}
          onDone={invalidate}
          onError={handleError}
        />
      )}
    </RecordDetailsPage>
  );
}

function EditMeetingDialog({ isOpen, onOpenChange, meeting }: { isOpen: boolean; onOpenChange: (open: boolean) => void; meeting: Meeting }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(meeting.subject);
  const [description, setDescription] = useState(meeting.description ?? "");
  const [locationType, setLocationType] = useState(meeting.locationType ?? "online");
  const [location, setLocation] = useState(meeting.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(meeting.meetingUrl ?? "");
  const [assignedTo, setAssignedTo] = useState(meeting.assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const assigneeOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "Unassigned" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateMeeting(meeting.id, {
        subject,
        description: description || null,
        locationType,
        location: location || null,
        meetingUrl: meetingUrl || null,
        assignedTo: assignedTo || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings", meeting.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings") });
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof MeetingApiError ? err.message : "This meeting could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Edit ${meeting.subject}`}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Subject" isRequired value={subject} onChange={setSubject} />
        <Select
          label="Location type"
          options={[
            { value: "online", label: "Online" },
            { value: "in_person", label: "In person" },
            { value: "phone", label: "Phone" },
            { value: "other", label: "Other" },
          ]}
          selectedKey={locationType}
          onSelectionChange={(key) => setLocationType(String(key ?? "online") as "online" | "in_person" | "phone" | "other")}
        />
        <TextField label="Location" value={location} onChange={setLocation} />
        <TextField label="Meeting URL" value={meetingUrl} onChange={setMeetingUrl} />
        <Select label="Assignee" options={assigneeOptions} selectedKey={assignedTo} onSelectionChange={(key) => setAssignedTo(String(key ?? ""))} />
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
