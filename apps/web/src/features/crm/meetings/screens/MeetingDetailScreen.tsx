"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { getMeeting, MeetingApiError, updateMeeting } from "../api/meetings-api";
import type { Meeting } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

// F014 Tranche J (Stage A) — dedicated Meeting detail view; getCrmMeeting/
// updateCrmMeeting (meeting-operations.js) were already real, already
// routed, with no frontend consumer. Attendees remain read-only plain
// text here (a real contact-picker UI is a separate, disclosed gap, not
// rebuilt in this edit dialog).
export function MeetingDetailScreen({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  const [editOpen, setEditOpen] = useState(false);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "meetings", meetingId), queryFn: () => getMeeting(meetingId) });
  const meeting = query.data?.record;

  if (query.isLoading) return <LoadingState label="Loading meeting" rows={3} />;
  if (query.isError) {
    if (query.error instanceof MeetingApiError && query.error.status === 403) return <PermissionState title="You don't have access to this meeting" />;
    return <ErrorState title="Meeting not found" action={{ label: "Back to Meetings", onPress: () => router.push("/crm/meetings") }} />;
  }
  if (!meeting) return null;

  return (
    <RecordDetailsPage
      header={{
        title: meeting.subject,
        status: <StatusBadge tone={meeting.status === "completed" ? "success" : meeting.status === "cancelled" ? "neutral" : "info"}>{meeting.status}</StatusBadge>,
        fields: [
          { label: "Location type", value: meeting.locationType ?? "—" },
          { label: "Assignee", value: meeting.assignedName ?? "Unassigned" },
        ],
        // updateCrmMeeting rejects any status other than planned/overdue —
        // hiding Edit outside that window avoids offering a rejected action.
        primaryAction: canManage && (meeting.status === "planned" || meeting.status === "overdue") ? (
          <Button variant="secondary" onPress={() => setEditOpen(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
      }}
    >
      <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
        <Field label="Start" value={meeting.startAt ? dateFormatter.format(new Date(meeting.startAt)) : null} />
        <Field label="End" value={meeting.endAt ? dateFormatter.format(new Date(meeting.endAt)) : null} />
        <Field label="Location" value={meeting.location} />
        <Field label="Meeting URL" value={meeting.meetingUrl} />
        <Field label="Priority" value={meeting.priority} />
        <Field label="Attendees" value={meeting.attendeeCount ?? meeting.attendees?.length ?? 0} />
        <Field label="Outcome" value={meeting.outcomeCode} />
        <Field label="Outcome notes" value={meeting.outcome} />
        <Field label="Completed at" value={meeting.completedAt ? dateFormatter.format(new Date(meeting.completedAt)) : null} />
      </div>
      {meeting.attendees && meeting.attendees.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="text-xs text-text-muted">Attendees</span>
          <ul className="text-sm text-text">
            {meeting.attendees.map((attendee, i) => (
              <li key={i}>
                {attendee.name} ({attendee.email}) {attendee.responseStatus ? `· ${attendee.responseStatus}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meeting.description && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <span className="text-xs text-text-muted">Description</span>
          <p className="text-sm text-text">{meeting.description}</p>
        </div>
      )}
      <EditMeetingDialog isOpen={editOpen} onOpenChange={setEditOpen} meeting={meeting} />
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
