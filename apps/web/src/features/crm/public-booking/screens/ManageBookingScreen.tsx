"use client";

import { useEffect, useState } from "react";
import { Button, TextArea } from "@vercentlabs/design-system";

import {
  cancelPublicMeetingBooking,
  getPublicMeetingBooking,
  PublicBookingApiError,
  reschedulePublicMeetingBooking,
  type PublicMeetingBookingDetail,
} from "../api/public-booking-api";

const guestTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// F014 Stage A2 §5. The manage-my-booking counterpart to BookMeetingScreen
// — the cancel/reschedule backend (cancelMeetingBooking/
// rescheduleMeetingBooking, already tested this session's F014 pass) had
// no public page reading it before this. A token's token_type already
// determines whether it authorizes cancel or reschedule (see
// bookings/[token]/route.ts's GET) — the UI never guesses which action a
// link grants.
export function ManageBookingScreen({ token }: { token: string }) {
  const [detail, setDetail] = useState<PublicMeetingBookingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [newStartsAt, setNewStartsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<"cancelled" | "rescheduled" | null>(null);

  useEffect(() => {
    getPublicMeetingBooking(token)
      .then((result) => setDetail(result.booking))
      .catch((error) => setLoadError(error instanceof PublicBookingApiError ? error.message : "This booking link could not be loaded."));
  }, [token]);

  async function handleCancel() {
    setSubmitting(true);
    setActionError(null);
    try {
      await cancelPublicMeetingBooking(token, reason || undefined);
      setDone("cancelled");
    } catch (error) {
      setActionError(error instanceof PublicBookingApiError ? error.message : "This booking could not be cancelled.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReschedule() {
    if (!newStartsAt) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await reschedulePublicMeetingBooking(token, new Date(newStartsAt).toISOString(), guestTimezone);
      setDone("rescheduled");
    } catch (error) {
      setActionError(error instanceof PublicBookingApiError ? error.message : "This booking could not be rescheduled.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!detail) return <p className="text-sm text-text-muted">Loading…</p>;

  if (done) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-text">{done === "cancelled" ? "Meeting cancelled" : "Meeting rescheduled"}</h1>
        <p className="text-sm text-text-muted">You can close this page.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-[var(--radius-control)] border border-border bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">{detail.meetingName}</h1>
        <p className="text-sm text-text-muted">
          Currently {new Date(detail.startsAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} ({guestTimezone}) · {detail.durationMinutes} minutes
        </p>
        <p className="text-xs text-text-muted capitalize">Status: {detail.status.replace("_", " ")}</p>
      </div>

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {detail.canCancel && detail.status === "confirmed" && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <TextArea label="Reason (optional)" value={reason} onChange={setReason} />
          <Button variant="danger" onPress={handleCancel} isLoading={submitting}>
            Cancel meeting
          </Button>
        </div>
      )}

      {detail.canReschedule && detail.status === "confirmed" && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="text-xs font-medium text-text-muted" htmlFor="reschedule-time">
            New date &amp; time
          </label>
          <input
            id="reschedule-time"
            type="datetime-local"
            value={newStartsAt}
            onChange={(event) => setNewStartsAt(event.target.value)}
            className="w-fit rounded-[var(--radius-control)] border border-border bg-canvas px-3 py-2 text-sm text-text"
          />
          <Button variant="primary" onPress={handleReschedule} isLoading={submitting} isDisabled={!newStartsAt}>
            Reschedule
          </Button>
        </div>
      )}

      {detail.status !== "confirmed" && <p className="text-sm text-text-muted">This booking is no longer active.</p>}
    </div>
  );
}
