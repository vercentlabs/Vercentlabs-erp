"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertDialog, Button, ErrorState, Skeleton, TextArea } from "@vercentlabs/design-system";

import { browserTimezone, isoToLocalParts, timezoneLabel } from "@/features/crm/shared/human";
import { TimezoneSelect } from "@/features/crm/shared/ui/TimezoneSelect";
import { BookingCalendar } from "../components/BookingCalendar";
import { BookingShell } from "../components/BookingShell";
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from "../components/calendar-links";
import { TimeSlotList, type Slot } from "../components/TimeSlotList";
import { cancelPublicMeetingBooking, getPublicMeetingBooking, getRescheduleAvailability, PublicBookingApiError, reschedulePublicMeetingBooking, type PublicMeetingBookingDetail } from "../api/public-booking-api";

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function whenText(startsAt: string, endsAt: string, zone: string) {
  const day = new Date(startsAt).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day}, ${time(startsAt)} to ${time(endsAt)}`;
}

// Manage a booking. Each emailed link authorizes exactly one change (reschedule or cancel), so this page offers the
// one this link allows: reschedule is presented as the main action, cancel as a separate, confirmed one. Adding the
// meeting to a calendar is always available.
export function ManageBookingScreen({ token }: { token: string }) {
  const [detail, setDetail] = useState<PublicMeetingBookingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zone, setZone] = useState(browserTimezone());
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: "cancelled" | "rescheduled"; slot?: Slot } | null>(null);

  useEffect(() => {
    let live = true;
    getPublicMeetingBooking(token)
      .then((r) => { if (live) setDetail(r.booking); })
      .catch((e) => { if (live) setLoadError(e instanceof PublicBookingApiError ? e.message : "This booking link could not be loaded."); });
    return () => { live = false; };
  }, [token]);

  const hostZone = detail?.timezone ?? "UTC";
  const today = useMemo(() => isoToLocalParts(new Date().toISOString(), hostZone).date, [hostZone]);

  function loadSlots(day: string) {
    setDate(day);
    setSelected(null);
    setSlotsLoading(true);
    getRescheduleAvailability(token, day)
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }

  async function reschedule() {
    if (!selected) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await reschedulePublicMeetingBooking(token, selected.startsAt, zone);
      setDone({ kind: "rescheduled", slot: selected });
    } catch (error) {
      setActionError(error instanceof PublicBookingApiError ? error.message : "We could not move this meeting. Please pick another time.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    setSubmitting(true);
    setActionError(null);
    try {
      await cancelPublicMeetingBooking(token, reason || undefined);
      setDone({ kind: "cancelled" });
    } catch (error) {
      setActionError(error instanceof PublicBookingApiError ? error.message : "We could not cancel this meeting.");
    } finally {
      setSubmitting(false);
      setConfirmCancel(false);
    }
  }

  if (loadError) {
    return (
      <BookingShell title="This link is not available">
        <ErrorState title="We could not open this booking" description={loadError} />
      </BookingShell>
    );
  }
  if (!detail) {
    return (
      <BookingShell title="Loading your booking">
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </BookingShell>
    );
  }

  const event = (startsAt: string, endsAt: string): CalendarEvent => ({ title: detail.meetingName, startsAt, endsAt, uid: `${token}-${startsAt}` });

  if (done) {
    const slot = done.slot;
    return (
      <BookingShell title={done.kind === "cancelled" ? "Meeting cancelled" : "Meeting rescheduled"} meta={detail.meetingName}>
        {done.kind === "rescheduled" && slot ? (
          <>
            <div role="status" className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-4 py-3">
              <p className="text-sm font-semibold text-success">New time confirmed</p>
              <p className="text-sm text-text">{whenText(slot.startsAt, slot.endsAt, zone)}</p>
              <p className="text-xs text-text-secondary">{timezoneLabel(zone)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onPress={() => downloadIcs(event(slot.startsAt, slot.endsAt))}>Add to calendar (.ics)</Button>
              <a href={googleCalendarUrl(event(slot.startsAt, slot.endsAt))} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-text hover:bg-surface-muted">Open in Google Calendar</a>
            </div>
          </>
        ) : (
          <p role="status" className="text-sm text-text-secondary">Your meeting has been cancelled. You can close this page.</p>
        )}
      </BookingShell>
    );
  }

  const active = detail.status === "confirmed";
  return (
    <BookingShell title={detail.meetingName} meta={`${detail.durationMinutes} minutes`}>
      <div className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-canvas-strong px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-text-muted">Your meeting</p>
        <p className="text-sm font-semibold text-text">{whenText(detail.startsAt, detail.endsAt, zone)}</p>
        <p className="text-xs text-text-secondary">{`${timezoneLabel(zone)} · ${active ? "Confirmed" : "No longer active"}`}</p>
      </div>

      {actionError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{actionError}</p>}

      {!active ? (
        <p className="text-sm text-text-secondary">This booking is no longer active, so there is nothing to change.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onPress={() => downloadIcs(event(detail.startsAt, detail.endsAt))}>Add to calendar (.ics)</Button>
            <a href={googleCalendarUrl(event(detail.startsAt, detail.endsAt))} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-text hover:bg-surface-muted">Open in Google Calendar</a>
          </div>

          {detail.canReschedule && (
            <section aria-label="Reschedule" className="flex flex-col gap-4 border-t border-border pt-5">
              <h2 className="text-base font-semibold text-text">Pick a new time</h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <BookingCalendar value={date} onChange={loadSlots} min={today} max={addDays(today, 60)} />
                  <TimezoneSelect value={zone} onChange={setZone} label="Your time zone" />
                </div>
                <div className="flex flex-col gap-3">
                  {date ? <TimeSlotList slots={slots} loading={slotsLoading} selected={selected?.startsAt ?? null} onSelect={setSelected} timeZone={zone} /> : <p className="text-sm text-text-secondary">Choose a date to see the free times.</p>}
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="primary" isDisabled={!selected} isLoading={submitting} onPress={reschedule}>Reschedule meeting</Button>
              </div>
            </section>
          )}

          {detail.canCancel && (
            <section aria-label="Cancel" className="flex flex-col gap-3 border-t border-border pt-5">
              <h2 className="text-sm font-semibold text-text">Cannot make it?</h2>
              <TextArea label="Reason (optional)" value={reason} onChange={setReason} />
              <div>
                <Button variant="secondary" onPress={() => setConfirmCancel(true)}>Cancel this meeting</Button>
              </div>
            </section>
          )}

          {detail.canReschedule && !detail.canCancel && <p className="text-xs text-text-muted">To cancel instead, use the cancel link in your confirmation email.</p>}
          {detail.canCancel && !detail.canReschedule && <p className="text-xs text-text-muted">To move the meeting instead, use the reschedule link in your confirmation email.</p>}
        </>
      )}

      {confirmCancel && (
        <AlertDialog isOpen onOpenChange={(open) => { if (!open) setConfirmCancel(false); }} title="Cancel this meeting?" description="The host is told, and the time is released. You would need to book again to meet." confirmLabel="Yes, cancel it" cancelLabel="Keep the meeting" isConfirming={submitting} onConfirm={cancel} />
      )}
    </BookingShell>
  );
}
