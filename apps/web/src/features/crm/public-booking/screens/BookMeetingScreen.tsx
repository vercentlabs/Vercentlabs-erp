"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, TextArea, TextField } from "@vercentlabs/design-system";

import {
  bookPublicMeeting,
  getPublicMeetingAvailability,
  getPublicMeetingLink,
  PublicBookingApiError,
  type PublicMeetingLinkInfo,
  type PublicMeetingSlot,
} from "../api/public-booking-api";

const guestTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// F014 Stage A2 §5. The genuinely missing half of F014-CAP-001's own
// canonical sentence ("schedule OR BOOK a meeting") — a rep could already
// create a bookable crm_meeting_links row (generic resource) and the
// backend already had a fully working, already-tested public booking
// engine (bookMeeting/getMeetingAvailability/calculateMeetingSlots), but
// no page existed for a guest to actually use it. Slot times are computed
// server-side and rendered here via Intl in the guest's own detected zone
// AND the host's declared link.timezone — no client-side slot arithmetic.
export function BookMeetingScreen({ token }: { token: string }) {
  const [link, setLink] = useState<PublicMeetingLinkInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState(() => toDateKey(new Date()));
  const [slots, setSlots] = useState<PublicMeetingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<PublicMeetingSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ startsAt: string; endsAt: string } | null>(null);

  useEffect(() => {
    getPublicMeetingLink(token)
      .then((result) => setLink(result.link))
      .catch((error) => setLoadError(error instanceof PublicBookingApiError ? error.message : "This booking link could not be loaded."));
  }, [token]);

  useEffect(() => {
    if (!link) return;
    getPublicMeetingAvailability(token, date)
      .then((result) => setSlots(result.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [token, date, link]);

  function selectDate(value: string) {
    if (!value) return;
    setDate(value);
    setSlotsLoading(true);
    setSelectedSlot(null);
  }

  const minDate = toDateKey(new Date());
  const maxDate = useMemo(() => {
    if (!link) return undefined;
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + link.maximumDaysAhead);
    return toDateKey(d);
  }, [link]);

  async function submitBooking() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await bookPublicMeeting(token, {
        startsAt: selectedSlot.startsAt,
        guestName,
        guestEmail,
        guestTimezone,
        notes: notes || undefined,
      });
      setConfirmed(selectedSlot);
    } catch (error) {
      setSubmitError(error instanceof PublicBookingApiError ? error.message : "This meeting could not be booked.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }
  if (!link) {
    return <p className="text-sm text-text-muted">Loading…</p>;
  }

  if (confirmed) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-text">Meeting confirmed</h1>
        <p className="text-sm text-text-muted">
          {link.name} with {link.ownerName || "your host"} is booked for{" "}
          {new Date(confirmed.startsAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} ({guestTimezone}).
        </p>
        <p className="text-xs text-text-muted">A confirmation was sent to {guestEmail}. Use the reschedule or cancel link from that email to change this booking.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-[var(--radius-control)] border border-border bg-surface p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">{link.name}</h1>
        <p className="text-sm text-text-muted">
          {link.ownerName ? `with ${link.ownerName} · ` : ""}
          {link.durationMinutes} minutes
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-text-muted" htmlFor="booking-date">
          Date
        </label>
        <input
          id="booking-date"
          type="date"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={(event) => selectDate(event.target.value)}
          className="w-fit rounded-[var(--radius-control)] border border-border bg-canvas px-3 py-2 text-sm text-text"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-text-muted">
          Available times ({link.timezone}, shown to you in {guestTimezone})
        </p>
        {slotsLoading ? (
          <p className="text-sm text-text-muted">Loading times…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-text-muted">No times available this day. Try another date.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => (
              <button
                key={slot.startsAt}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                className={`rounded-[var(--radius-control)] border px-2 py-2 text-sm transition-colors ${
                  selectedSlot?.startsAt === slot.startsAt
                    ? "border-accent bg-accent-soft text-accent-emphasis"
                    : "border-border bg-canvas text-text hover:border-accent"
                }`}
              >
                {new Date(slot.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedSlot && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <TextField label="Your name" isRequired value={guestName} onChange={setGuestName} />
          <TextField label="Email" type="email" isRequired value={guestEmail} onChange={setGuestEmail} />
          <TextArea label="Notes (optional)" value={notes} onChange={setNotes} />
          {submitError && <p className="text-sm text-danger">{submitError}</p>}
          <Button
            variant="primary"
            onPress={submitBooking}
            isLoading={submitting}
            isDisabled={!guestName.trim() || !guestEmail.trim()}
          >
            Confirm booking
          </Button>
        </div>
      )}
    </div>
  );
}
