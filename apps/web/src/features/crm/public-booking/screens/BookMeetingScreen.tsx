"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ErrorState, Skeleton, TextArea, TextField } from "@vercentlabs/design-system";

import { browserTimezone, canonicalTimezone, humanize, isoToLocalParts, timezoneLabel } from "@/shared/format/human";
import { TimezoneSelect } from "@/features/crm/shared/ui/TimezoneSelect";
import { BookingCalendar } from "../components/BookingCalendar";
import { BookingShell } from "../components/BookingShell";
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from "../components/calendar-links";
import { TimeSlotList, type Slot } from "../components/TimeSlotList";
import { bookPublicMeeting, getPublicMeetingAvailability, getPublicMeetingLink, PublicBookingApiError, type PublicMeetingLinkInfo } from "../api/public-booking-api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Customer-facing scheduling: pick a day, pick a time in your own time zone, tell us who you are, done. Slot times
// are computed by the server for the host's calendar; this page only presents them.
export function BookMeetingScreen({ token }: { token: string }) {
  const [link, setLink] = useState<PublicMeetingLinkInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zone, setZone] = useState(browserTimezone());
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(false);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);

  useEffect(() => {
    let live = true;
    getPublicMeetingLink(token)
      .then((r) => { if (live) setLink(r.link); })
      .catch((e) => { if (live) setLoadError(e instanceof PublicBookingApiError ? e.message : "This booking link could not be loaded."); });
    return () => { live = false; };
  }, [token]);

  const hostZone = canonicalTimezone(link?.timezone);
  const today = useMemo(() => (link ? isoToLocalParts(new Date().toISOString(), hostZone).date : ""), [link, hostZone]);
  const max = link ? addDays(today, link.maximumDaysAhead) : undefined;

  function loadSlots(day: string) {
    setDate(day);
    setSelected(null);
    setSlotsLoading(true);
    setSlotsError(false);
    getPublicMeetingAvailability(token, day)
      .then((r) => setSlots(r.slots))
      .catch(() => { setSlots([]); setSlotsError(true); })
      .finally(() => setSlotsLoading(false));
  }

  async function submit() {
    if (!selected) return;
    const next: typeof errors = {};
    if (!guestName.trim()) next.name = "Please tell us your name.";
    if (!EMAIL.test(guestEmail.trim())) next.email = "Enter a valid email address so we can send your confirmation.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await bookPublicMeeting(token, { startsAt: selected.startsAt, guestName: guestName.trim(), guestEmail: guestEmail.trim(), guestTimezone: zone, notes: notes || undefined });
      setConfirmed(selected);
    } catch (error) {
      setSubmitError(error instanceof PublicBookingApiError ? error.message : "We could not book this time. Please pick another.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <BookingShell title="This booking link is not available">
        <ErrorState title="We could not open this page" description={loadError} />
      </BookingShell>
    );
  }
  if (!link) {
    return (
      <BookingShell title="Loading">
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-56 w-full" />
        </div>
      </BookingShell>
    );
  }

  const event = (slot: Slot): CalendarEvent => ({ title: link.name, startsAt: slot.startsAt, endsAt: slot.endsAt, description: link.ownerName ? `Meeting with ${link.ownerName}` : undefined, location: link.locationTemplate ?? undefined, uid: `${token}-${slot.startsAt}` });

  if (confirmed) {
    return (
      <BookingShell host={link.ownerName} title="You are booked" meta={link.name}>
        <div role="status" className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-4 py-3">
          <p className="text-sm font-semibold text-success">Confirmed</p>
          <p className="text-sm text-text">{whenText(confirmed.startsAt, confirmed.endsAt, zone)}</p>
          <p className="text-xs text-text-secondary">{timezoneLabel(zone)}</p>
        </div>
        <p className="text-sm text-text-secondary">A confirmation is on its way to {guestEmail}. It has the links to change or cancel this meeting.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onPress={() => downloadIcs(event(confirmed))}>Add to calendar (.ics)</Button>
          <a href={googleCalendarUrl(event(confirmed))} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-text hover:bg-surface-muted">Open in Google Calendar</a>
        </div>
      </BookingShell>
    );
  }

  return (
    <BookingShell host={link.ownerName ? `Meet with ${link.ownerName}` : null} title={link.name} meta={`${link.durationMinutes} minutes${link.meetingProvider && !["none", "manual", "other"].includes(link.meetingProvider) ? ` · ${humanize(link.meetingProvider)}` : ""}`}>
      {step === "pick" ? (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <BookingCalendar value={date} onChange={loadSlots} min={today} max={max} />
              <TimezoneSelect value={zone} onChange={setZone} label="Your time zone" />
            </div>
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-text">{date ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "Pick a day"}</h2>
              {!date ? (
                <p className="text-sm text-text-secondary">Choose a date to see the times that are free.</p>
              ) : slotsError ? (
                <div className="flex flex-col gap-2"><p role="alert" className="text-sm text-danger">We could not load the times for this day.</p><Button variant="secondary" onPress={() => loadSlots(date)}>Try again</Button></div>
              ) : (
                <TimeSlotList slots={slots} loading={slotsLoading} selected={selected?.startsAt ?? null} onSelect={setSelected} timeZone={zone} />
              )}
              <p className="text-xs text-text-muted">{`Times are shown in ${timezoneLabel(zone)}.`}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" isDisabled={!selected} onPress={() => setStep("details")}>Continue</Button>
          </div>
        </>
      ) : (
        selected && (
          <>
            <div className="flex flex-col gap-0.5 rounded-[var(--radius-control)] bg-canvas-strong px-4 py-3">
              <p className="text-sm font-semibold text-text">{whenText(selected.startsAt, selected.endsAt, zone)}</p>
              <p className="text-xs text-text-secondary">{timezoneLabel(zone)}</p>
              <button type="button" onClick={() => setStep("pick")} className="w-fit text-xs font-medium text-brand hover:underline">Change time</button>
            </div>
            <div className="flex flex-col gap-4">
              <TextField label="Your name (required)" autoComplete="name" value={guestName} onChange={setGuestName} errorMessage={errors.name} />
              <TextField label="Email (required)" inputMode="email" autoComplete="email" value={guestEmail} onChange={setGuestEmail} errorMessage={errors.email} />
              <TextArea label="Anything we should know? (optional)" value={notes} onChange={setNotes} />
              {submitError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{submitError}</p>}
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onPress={() => setStep("pick")} isDisabled={submitting}>Back</Button>
                <Button variant="primary" onPress={submit} isLoading={submitting}>Confirm booking</Button>
              </div>
            </div>
          </>
        )
      )}
    </BookingShell>
  );
}
