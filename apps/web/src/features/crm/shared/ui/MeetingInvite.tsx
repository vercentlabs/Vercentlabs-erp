"use client";

// Sending a planned meeting as a calendar invitation (CRM plan 4.5): the attendees, the place and how long; sending again after the
// meeting moved updates the same invitation, and Cancel invitation withdraws it from their calendars.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { Button, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { formatDateTime } from "@/shared/format/human";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

class MeetingApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(MeetingApiError, "body");
type Invitation = { attendees: Array<{ email: string; name: string | null }>; location: string | null; durationMinutes: number; status: string; sequence: number; sentAt: string } | null;
const getInvitation = (id: string) => request<{ invitation: Invitation }>(`/api/crm/meetings/${id}/invitation`).then((result) => result.invitation);
const sendInvitation = (id: string, input: Record<string, unknown>) => request<{ result: { updated: boolean } }>(`/api/crm/meetings/${id}/invitation`, { method: "POST", json: input });
const cancelInvitation = (id: string, message: string) => request<{ result: { cancelled: true } }>(`/api/crm/meetings/${id}/invitation`, { method: "DELETE", json: { message } });
const errorMessage = (error: unknown) => (error instanceof Error && error.message ? error.message : "Something went wrong. Try again.");

export function MeetingInviteButton({ activityId, defaultEmail }: { activityId: string; defaultEmail?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onPress={() => setOpen(true)}><CalendarPlus className="size-4" aria-hidden="true" />Invite</Button>
      {open && <InviteDialog activityId={activityId} defaultEmail={defaultEmail ?? ""} onClose={() => setOpen(false)} />}
    </>
  );
}

function InviteDialog({ activityId, defaultEmail, onClose }: { activityId: string; defaultEmail: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "meeting-invitation", activityId);
  const current = useQuery({ queryKey: key, queryFn: () => getInvitation(activityId) });
  return current.isLoading ? null : <InviteForm key={current.dataUpdatedAt} invitation={current.data ?? null} activityId={activityId} defaultEmail={defaultEmail}
    onClose={onClose} onDone={() => void queryClient.invalidateQueries({ queryKey: key })} />;
}

function InviteForm({ invitation, activityId, defaultEmail, onClose, onDone }: { invitation: Invitation; activityId: string; defaultEmail: string; onClose: () => void; onDone: () => void }) {
  const [attendees, setAttendees] = useState((invitation?.attendees.map((entry) => entry.email) ?? [defaultEmail]).filter(Boolean).join(", "));
  const [location, setLocation] = useState(invitation?.location ?? "");
  const [duration, setDuration] = useState(String(invitation?.durationMinutes ?? 30));
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const send = useMutation({
    mutationFn: () => sendInvitation(activityId, { attendees: attendees.split(/[,;\s]+/).filter(Boolean).map((email) => ({ email })), location, durationMinutes: Number(duration), message }),
    onSuccess: (result) => { setNotice({ tone: "success", text: result.result.updated ? "The update was sent." : "The invitation was sent." }); onDone(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });
  const cancel = useMutation({
    mutationFn: () => cancelInvitation(activityId, message),
    onSuccess: () => { setNotice({ tone: "success", text: "The invitation was cancelled." }); onDone(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });
  const sent = invitation && invitation.status === "sent";
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={sent ? "Meeting invitation" : "Invite to this meeting"} size="lg">
      <div className="flex flex-col gap-4">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {sent && <p className="text-sm text-text-secondary">Sent {formatDateTime(invitation.sentAt)}. If the meeting moved, send it again to update their calendars.</p>}
        <VideoCallPicker activityId={activityId} />
        <TextField label="Attendees" value={attendees} onChange={setAttendees} description="Email addresses, separated by commas." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Where" value={location} onChange={setLocation} placeholder="Office, address or video link" />
          <Select label="How long" selectedKey={duration} onSelectionChange={(value) => setDuration(String(value))}
            options={["15", "30", "45", "60", "90", "120"].map((value) => ({ value, label: `${value} minutes` }))} />
        </div>
        <TextArea label="Message (optional)" value={message} onChange={setMessage} />
        <div className="flex flex-wrap justify-between gap-2">
          {sent ? <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel invitation</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onPress={onClose}>Close</Button>
            <Button variant="primary" isLoading={send.isPending} isDisabled={!attendees.trim()} onPress={() => send.mutate()}>{sent ? "Send update" : "Send invitation"}</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

type VideoProvider = "google_meet" | "teams" | "zoom" | "link";
type MeetingVideo = { provider: VideoProvider | null; link: string | null; available: Record<VideoProvider, boolean> };
const VIDEO_LABELS: Record<VideoProvider, string> = { google_meet: "Google Meet", teams: "Microsoft Teams", zoom: "Zoom", link: "My own link" };
const NO_CALL = "none";

// The meeting's video call (CRM audit): Google Meet or Teams from the organizer's connected calendar, Zoom from the company's Zoom, or a
// pasted link. The link goes into the invitation and the calendar event.
function VideoCallPicker({ activityId }: { activityId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "meeting-video", activityId);
  const video = useQuery({ queryKey: key, queryFn: () => request<{ video: MeetingVideo }>(`/api/crm/meetings/${activityId}/video`).then((result) => result.video) });
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState("");
  const save = useMutation({
    mutationFn: (input: { provider: VideoProvider | null; link?: string }) => request(`/api/crm/meetings/${activityId}/video`, { method: "PUT", json: input }),
    onSuccess: () => { setPasting(false); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  if (!video.data) return null;
  const current = video.data;
  const options = [{ value: NO_CALL, label: "No video call" }, ...(Object.keys(VIDEO_LABELS) as VideoProvider[])
    .filter((provider) => current.available[provider] || provider === current.provider).map((provider) => ({ value: provider, label: VIDEO_LABELS[provider] }))];
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      {save.isError && <Notice>{errorMessage(save.error)}</Notice>}
      <Select label="Video call" selectedKey={pasting ? "link" : current.provider ?? NO_CALL} isDisabled={save.isPending}
        onSelectionChange={(value) => {
          const chosen = String(value);
          if (chosen === "link") { setPasting(true); setLink(current.link ?? ""); return; }
          setPasting(false);
          save.mutate({ provider: chosen === NO_CALL ? null : (chosen as VideoProvider) });
        }}
        description={current.available.google_meet || current.available.teams ? undefined : "Connect your calendar (Setup › My calendar) for Google Meet or Teams links."}
        options={options} />
      {pasting && (
        <div className="flex items-end gap-2">
          <TextField className="flex-1" label="Meeting link" value={link} onChange={setLink} placeholder="https://" />
          <Button variant="secondary" size="compact" isLoading={save.isPending} onPress={() => save.mutate({ provider: "link", link })}>Use this link</Button>
        </div>
      )}
      {current.link ? <a className="truncate text-sm text-brand underline" href={current.link} target="_blank" rel="noreferrer">{current.link}</a>
        : current.provider ? <p className="text-xs text-text-muted">The link is being made; it appears here and in the invitation shortly.</p> : null}
    </div>
  );
}
