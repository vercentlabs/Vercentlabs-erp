// F014 meeting booking: the one slot engine (time-zone conversion, slots,
// buffers, minimum notice), host availability, public guest input, and
// booking / cancel / reschedule. bookMeeting locks the meeting link FOR
// UPDATE, replays an exact retry, then re-checks availability before insert.

import { publishDomainEvent } from "../../../../core/platform/events/index.js";
import { CrmCommunicationsError, assertId } from "../communications/communications-error.js";
import { normalizeEmailAddress } from "../communications/email-address.js";
import { createRemindersForActivity, cancelPendingRemindersForActivity } from "../follow-ups/follow-up-operations.js";
import { enqueueCalendarPushJob, upsertMeetingCalendarEvent } from "./meeting-calendar.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) ? Number(value) : fallback;

// The instant at which a wall clock reads hour:minute on the given calendar date in an IANA time zone (DST-aware).
export function zonedWallTimeToUtc(date, hour, minute, timeZone) {
  const zone = text(timeZone) || "UTC";
  const [y, m, d] = String(date).split("-").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wanted;
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    for (let i = 0; i < 3; i += 1) {
      const parts = format.formatToParts(new Date(guess));
      const get = (type) => Number(parts.find((part) => part.type === type)?.value);
      guess += wanted - Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    }
  } catch {
    return new Date(wanted);
  }
  return new Date(guess);
}

// The calendar date (YYYY-MM-DD) an instant falls on in an IANA time zone: the host day a slot belongs to.
export function calendarDateInZone(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: text(timeZone) || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
  } catch {
    return new Date(instant).toISOString().slice(0, 10);
  }
}

export function calculateMeetingSlots({
  date,
  durationMinutes,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
  availability = {},
  busy = [],
  now = new Date(),
  minimumNoticeMinutes = 0,
  timeZone = "UTC",
}) {
  const day = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(day.getTime()))
    throw new CrmCommunicationsError(400, "Meeting date is invalid.");
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][day.getUTCDay()];
  const windows = array(object(availability)[weekday]);
  const duration = integer(durationMinutes);
  if (duration < 5 || duration > 480)
    throw new CrmCommunicationsError(400, "Meeting duration is invalid.");
  const result = [];
  const minimumStart = new Date(
    now.getTime() + integer(minimumNoticeMinutes) * 60000,
  );
  const busyRanges = array(busy).map((row) => ({
    start: new Date(row.start || row.startsAt),
    end: new Date(row.end || row.endsAt),
  }));
  for (const window of windows) {
    const [startHour, startMinute] = text(window.start).split(":").map(Number);
    const [endHour, endMinute] = text(window.end).split(":").map(Number);
    let cursor = zonedWallTimeToUtc(date, startHour, startMinute, timeZone);
    const windowEnd = zonedWallTimeToUtc(date, endHour, endMinute, timeZone);
    while (cursor.getTime() + duration * 60000 <= windowEnd.getTime()) {
      const end = new Date(cursor.getTime() + duration * 60000);
      const protectedStart = new Date(
        cursor.getTime() - integer(bufferBeforeMinutes) * 60000,
      );
      const protectedEnd = new Date(
        end.getTime() + integer(bufferAfterMinutes) * 60000,
      );
      const conflict = busyRanges.some(
        (range) => protectedStart < range.end && protectedEnd > range.start,
      );
      if (!conflict && cursor >= minimumStart)
        result.push({
          startsAt: cursor.toISOString(),
          endsAt: end.toISOString(),
        });
      cursor = new Date(cursor.getTime() + 15 * 60000);
    }
  }
  return result;
}

export async function getMeetingAvailability(
  client,
  context,
  meetingLinkId,
  date,
  input = {},
) {
  const link = await client.query(
    `SELECT * FROM tenant.crm_meeting_links WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, assertId(meetingLinkId, "Meeting link")],
  );
  if (!link.rows[0])
    throw new CrmCommunicationsError(404, "Meeting link not found.");
  const now = input.now ? new Date(input.now) : new Date();
  // Booking horizon: nothing before today or beyond maximum_days_ahead, both
  // in the link's own time zone (the setting was stored and shown to guests
  // but never enforced, so a guest could book years ahead).
  if (!isBookableDate(date, now, link.rows[0].timezone, link.rows[0].maximum_days_ahead)) return [];
  // The host day can start the previous UTC day and end the next, so look a day either side for conflicts.
  const dayStart = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - 86_400_000).toISOString();
  const dayEnd = new Date(new Date(`${date}T23:59:59.999Z`).getTime() + 86_400_000).toISOString();
  const excludeBookingId = input.excludeBookingId
    ? assertId(input.excludeBookingId, "Meeting booking")
    : null;
  // Busy time is the HOST's time only: events on the host's connected
  // calendars, the host's own CRM meetings, and bookings made with the host.
  // (Previously every event and booking in the organisation blocked every
  // host's page, so one seller's diary emptied everyone else's.)
  const busy = await client.query(
    `SELECT event.starts_at AS start,event.ends_at AS end
       FROM tenant.crm_calendar_events event
       JOIN tenant.crm_sync_accounts account
         ON account.organization_id=event.organization_id AND account.id=event.sync_account_id AND account.user_id=$5
      WHERE event.organization_id=$1 AND event.starts_at<$3 AND event.ends_at>$2
        AND event.provider_status NOT IN ('cancelled','cancelling')
        AND ($4::uuid IS NULL OR event.meeting_booking_id IS DISTINCT FROM $4::uuid)
     UNION ALL
     SELECT activity.start_at AS start,activity.end_at AS end
       FROM tenant.crm_activities activity
      WHERE activity.organization_id=$1 AND activity.activity_type='meeting' AND activity.assigned_to=$5
        AND activity.status NOT IN ('cancelled','completed','no_show')
        AND activity.start_at IS NOT NULL AND activity.end_at IS NOT NULL
        AND activity.start_at<$3 AND activity.end_at>$2
        AND ($4::uuid IS NULL OR activity.meeting_booking_id IS DISTINCT FROM $4::uuid)
     UNION ALL
     SELECT starts_at AS start,ends_at AS end
       FROM tenant.crm_meeting_bookings
      WHERE organization_id=$1 AND host_user_id=$5 AND starts_at<$3 AND ends_at>$2 AND status='confirmed'
        AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [context.organizationId, dayStart, dayEnd, excludeBookingId, link.rows[0].owner_user_id],
  );
  return calculateMeetingSlots({
    date,
    durationMinutes: link.rows[0].duration_minutes,
    bufferBeforeMinutes: link.rows[0].buffer_before_minutes,
    bufferAfterMinutes: link.rows[0].buffer_after_minutes,
    availability: link.rows[0].availability,
    busy: busy.rows,
    minimumNoticeMinutes: link.rows[0].minimum_notice_minutes,
    timeZone: link.rows[0].timezone,
    now,
  });
}

// True when `date` (YYYY-MM-DD) lies between today and today + maximumDaysAhead
// in the link's time zone.
export function isBookableDate(date, now, timeZone, maximumDaysAhead) {
  const today = calendarDateInZone(now, timeZone);
  const days = Math.max(0, Math.trunc(Number(maximumDaysAhead ?? 60)));
  const last = new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return String(date) >= today && String(date) <= last;
}

const GUEST_NAME_MAX = 200;
const BOOKING_NOTES_MAX = 2000;
const CANCELLATION_REASON_MAX = 1000;

function meetingTimeZone(value, fallback = "UTC") {
  const zone = text(value) || fallback;
  if (zone.length > 64) throw new CrmCommunicationsError(400, "Time zone is invalid.", "CRM_MEETING_TIMEZONE_INVALID");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new CrmCommunicationsError(400, "Time zone is invalid.", "CRM_MEETING_TIMEZONE_INVALID");
  }
  return zone;
}

// Everything a guest may type on a public booking page, bounded and checked
// before any row is written.
export function normalizeMeetingGuestInput(input = {}) {
  const guestName = text(input.guestName);
  if (!guestName || guestName.length > GUEST_NAME_MAX)
    throw new CrmCommunicationsError(400, `Enter your name (up to ${GUEST_NAME_MAX} characters).`, "CRM_MEETING_GUEST_NAME_INVALID");
  const rawEmail = text(input.guestEmail);
  if (rawEmail.length > 254) throw new CrmCommunicationsError(400, "Email address is invalid.", "CRM_EMAIL_INVALID");
  const guestEmail = normalizeEmailAddress(rawEmail);
  const notes = text(input.notes);
  if (notes.length > BOOKING_NOTES_MAX)
    throw new CrmCommunicationsError(400, `Notes can be up to ${BOOKING_NOTES_MAX} characters.`, "CRM_MEETING_NOTES_TOO_LONG");
  return { guestName, guestEmail, guestTimezone: meetingTimeZone(input.guestTimezone), notes: notes || null };
}

export async function bookMeeting(client, context, meetingLinkId, input = {}) {
  // Serialize booking decisions on the owning meeting-link row. This makes the
  // availability check + insert atomic for one public schedule and lets an
  // exact lost-response retry resolve to the booking that already committed.
  const link = await client.query(
    `SELECT * FROM tenant.crm_meeting_links WHERE organization_id=$1 AND id=$2 AND status='active' FOR UPDATE`,
    [context.organizationId, assertId(meetingLinkId, "Meeting link")],
  );
  if (!link.rows[0])
    throw new CrmCommunicationsError(404, "Meeting link not found.");
  const startsAt = new Date(text(input.startsAt));
  if (Number.isNaN(startsAt.getTime()))
    throw new CrmCommunicationsError(400, "Meeting start time is invalid.");
  const guest = normalizeMeetingGuestInput(input);
  const guestEmail = guest.guestEmail;
  const desiredStart = startsAt.toISOString();
  const existing = await client.query(
    `SELECT booking.*,
            (SELECT activity.id FROM tenant.crm_activities activity
              WHERE activity.organization_id=booking.organization_id
                AND activity.meeting_booking_id=booking.id
                AND activity.activity_type='meeting' LIMIT 1) AS meeting_activity_id
       FROM tenant.crm_meeting_bookings booking
      WHERE booking.organization_id=$1 AND booking.meeting_link_id=$2
        AND booking.guest_email=$3 AND booking.starts_at=$4 AND booking.status='confirmed'
      ORDER BY booking.created_at ASC LIMIT 1`,
    [context.organizationId, link.rows[0].id, guestEmail, desiredStart],
  );
  if (existing.rows[0]) return { ...existing.rows[0], replayed: true };
  const endsAt = new Date(
    startsAt.getTime() + Number(link.rows[0].duration_minutes) * 60000,
  );
  const slots = await getMeetingAvailability(
    client,
    context,
    meetingLinkId,
    calendarDateInZone(startsAt, link.rows[0].timezone),
    { now: input.now },
  );
  if (!slots.some((slot) => slot.startsAt === desiredStart))
    throw new CrmCommunicationsError(
      409,
      "Selected meeting time is no longer available.",
      "CRM_MEETING_SLOT_UNAVAILABLE",
    );
  const booking = await client.query(
    `INSERT INTO tenant.crm_meeting_bookings(organization_id,company_id,meeting_link_id,host_user_id,guest_name,guest_email,guest_timezone,starts_at,ends_at,status,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10) RETURNING *`,
    [
      context.organizationId,
      link.rows[0].company_id || context.activeCompanyId || null,
      link.rows[0].id,
      link.rows[0].owner_user_id,
      guest.guestName,
      guestEmail,
      guest.guestTimezone,
      desiredStart,
      endsAt.toISOString(),
      guest.notes,
    ],
  );
  // F014 bridge: every public booking also becomes the canonical CRM Meeting
  // activity so the host sees it in Daily Work and lifecycle/history use one
  // governed ledger. Guest PII stays only in scoped booking/attendee rows.
  const locationTemplate = text(link.rows[0].location_template) || null;
  const meetingProvider = text(link.rows[0].meeting_provider || "manual");
  const onlineLocation = meetingProvider !== "manual" || /^https?:\/\//i.test(locationTemplate || "");
  const meetingUrl = /^https?:\/\//i.test(locationTemplate || "") ? locationTemplate : null;
  const meetingActivity = await client.query(
    `INSERT INTO tenant.crm_activities(
       organization_id,company_id,entity_type,activity_type,subject,status,priority,assigned_to,start_at,due_at,end_at,location,
       meeting_location_type,meeting_url,meeting_booking_id,created_by,updated_by)
     VALUES($1,$2,'general','meeting',$3,'planned','medium',$4,$5,$5,$6,$7,$8,$9,$10,$4,$4)
     RETURNING *`,
    [
      context.organizationId,
      link.rows[0].company_id || context.activeCompanyId || null,
      link.rows[0].name,
      link.rows[0].owner_user_id,
      desiredStart,
      endsAt.toISOString(),
      locationTemplate,
      onlineLocation ? "online" : locationTemplate ? "in_person" : "other",
      meetingUrl,
      booking.rows[0].id,
    ],
  );
  // Same canonical calendar-sync-intent path ordinary Meeting create/update/
  // cancel now uses (meeting-operations.js) — a public booking is not a
  // second calendar representation, just another caller of the one
  // crm_calendar_events upsert.
  const calendarEventId = await upsertMeetingCalendarEvent(client, context, {
    id: meetingActivity.rows[0].id,
    companyId: link.rows[0].company_id || context.activeCompanyId || null,
    subject: link.rows[0].name,
    description: null,
    startAt: desiredStart,
    endAt: endsAt.toISOString(),
    location: locationTemplate,
    meetingUrl,
    entityType: null,
    entityId: null,
  });
  await client.query(
    `UPDATE tenant.crm_activities SET meeting_calendar_event_id=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, meetingActivity.rows[0].id, calendarEventId],
  );
  await client.query(
    `UPDATE tenant.crm_meeting_bookings SET calendar_event_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, booking.rows[0].id, calendarEventId],
  );
  await client.query(
    `INSERT INTO tenant.crm_calendar_attendees(organization_id,calendar_event_id,email_address,display_name,response_status) VALUES($1,$2,$3,$4,'accepted')`,
    [
      context.organizationId,
      calendarEventId,
      guestEmail,
      guest.guestName,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_activity_attendees(organization_id,activity_id,name,email,response_status)
     VALUES($1,$2,$3,$4,'accepted')`,
    [context.organizationId, meetingActivity.rows[0].id, guest.guestName, guestEmail],
  );
  await client.query(
    `INSERT INTO tenant.crm_meeting_events(
       organization_id,activity_id,event_type,next_status,location_type,attendee_count,changed_by)
     VALUES($1,$2,'booked','planned',$3,1,$4)`,
    [
      context.organizationId,
      meetingActivity.rows[0].id,
      onlineLocation ? "online" : locationTemplate ? "in_person" : "other",
      context.userId,
    ],
  );
  await publishDomainEvent(client, {
    organizationId: context.organizationId,
    moduleKey: "crm",
    eventType: "crm.meeting.booked",
    entityType: "meeting_booking",
    entityId: booking.rows[0].id,
    payload: { startsAt: desiredStart, meetingLinkId: link.rows[0].id, meetingActivityId: meetingActivity.rows[0].id },
  });
  // F014 closeout: push this newly-booked Meeting to the host's real
  // connected calendar (if any) instead of leaving provider='internal'
  // as the only record of it — see pushProviderCalendarEvent's own
  // comment. A no-op (not an error) when the host has no connected
  // outbound-capable account.
  await enqueueCalendarPushJob(client, context, meetingActivity.rows[0].id, "create", meetingActivity.rows[0].updated_at);
  // F014 Stage A2 closeout: a publicly-booked Meeting joins the same
  // shared reminder engine an internally-scheduled one does (see
  // createCrmMeeting) — the host still gets reminded even though no
  // authenticated user scheduled it.
  await createRemindersForActivity(client, context, meetingActivity.rows[0].id, desiredStart);
  return {
    ...booking.rows[0],
    calendar_event_id: calendarEventId,
    meeting_activity_id: meetingActivity.rows[0].id,
  };
}

export async function cancelMeetingBooking(
  client,
  context,
  bookingId,
  reason = null,
) {
  const id = assertId(bookingId, "Meeting booking");
  if (text(reason).length > CANCELLATION_REASON_MAX)
    throw new CrmCommunicationsError(400, `A cancellation reason can be up to ${CANCELLATION_REASON_MAX} characters.`, "CRM_MEETING_CANCEL_REASON_TOO_LONG");
  const current = await client.query(
    `SELECT * FROM tenant.crm_meeting_bookings
      WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!current.rows[0])
    throw new CrmCommunicationsError(404, "Meeting booking not found.");
  if (current.rows[0].status === "cancelled")
    return { ...current.rows[0], replayed: true };
  if (current.rows[0].status !== "confirmed")
    throw new CrmCommunicationsError(409, "Meeting booking cannot be cancelled.");
  const linkedActivity = await client.query(
    `SELECT id,status FROM tenant.crm_activities
      WHERE organization_id=$1 AND meeting_booking_id=$2 AND activity_type='meeting'
      LIMIT 1 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (linkedActivity.rows[0]?.status === "completed")
    throw new CrmCommunicationsError(409, "Completed Meeting bookings cannot be cancelled.", "CRM_MEETING_BOOKING_COMPLETED");

  const result = await client.query(
    `UPDATE tenant.crm_meeting_bookings
     SET status='cancelled',cancelled_at=now(),cancellation_reason=$3,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND status='confirmed'
     RETURNING *`,
    [context.organizationId, id, text(reason) || null],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(409, "Meeting booking changed. Refresh and try again.");
  await client.query(
    `UPDATE tenant.crm_calendar_events SET provider_status='cancelled',updated_at=now()
     WHERE organization_id=$1 AND meeting_booking_id=$2`,
    [context.organizationId, id],
  );
  const activity = await client.query(
    `UPDATE tenant.crm_activities
        SET status='cancelled',updated_by=$3,updated_at=now()
      WHERE organization_id=$1 AND meeting_booking_id=$2 AND activity_type='meeting' AND status <> 'cancelled'
      RETURNING *`,
    [context.organizationId, id, context.userId],
  );
  if (activity.rows[0]) {
    const attendeeCount = await client.query(
      `SELECT count(*)::int AS total FROM tenant.crm_activity_attendees
        WHERE organization_id=$1 AND activity_id=$2`,
      [context.organizationId, activity.rows[0].id],
    );
    await client.query(
      `INSERT INTO tenant.crm_meeting_events(
         organization_id,activity_id,event_type,previous_status,next_status,location_type,attendee_count,changed_by)
       VALUES($1,$2,'cancelled',$3,'cancelled',$4,$5,$6)`,
      [context.organizationId, activity.rows[0].id, current.rows[0].status === "confirmed" ? "planned" : current.rows[0].status,
        activity.rows[0].meeting_location_type, Number(attendeeCount.rows[0]?.total || 0), context.userId],
    );
    await enqueueCalendarPushJob(client, context, activity.rows[0].id, "cancel", activity.rows[0].updated_at);
    await cancelPendingRemindersForActivity(client, context, activity.rows[0].id);
  }
  return result.rows[0];
}

export async function rescheduleMeetingBooking(
  client,
  context,
  bookingId,
  input = {},
) {
  const id = assertId(bookingId, "Meeting booking");
  const current = await client.query(
    `SELECT booking.*,link.duration_minutes,link.timezone AS link_timezone
     FROM tenant.crm_meeting_bookings booking
     JOIN tenant.crm_meeting_links link
       ON link.organization_id=booking.organization_id AND link.id=booking.meeting_link_id
     WHERE booking.organization_id=$1 AND booking.id=$2 AND booking.status='confirmed'
     FOR UPDATE OF booking,link`,
    [context.organizationId, id],
  );
  if (!current.rows[0]) {
    throw new CrmCommunicationsError(404, "Meeting booking not found.");
  }
  const linkedActivity = await client.query(
    `SELECT id,status FROM tenant.crm_activities
      WHERE organization_id=$1 AND meeting_booking_id=$2 AND activity_type='meeting'
      LIMIT 1 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (linkedActivity.rows[0] && !["planned", "overdue"].includes(linkedActivity.rows[0].status))
    throw new CrmCommunicationsError(409, "Started or completed Meeting bookings cannot be rescheduled.", "CRM_MEETING_BOOKING_RESCHEDULE_INVALID");
  const startsAt = new Date(text(input.startsAt));
  if (Number.isNaN(startsAt.getTime())) {
    throw new CrmCommunicationsError(400, "Meeting start time is invalid.");
  }
  const desiredStart = startsAt.toISOString();
  const desiredTimezone = meetingTimeZone(input.guestTimezone, current.rows[0].guest_timezone);
  if (
    new Date(current.rows[0].starts_at).toISOString() === desiredStart &&
    String(current.rows[0].guest_timezone || "") === desiredTimezone
  ) {
    return { ...current.rows[0], replayed: true };
  }
  const slots = await getMeetingAvailability(
    client,
    context,
    current.rows[0].meeting_link_id,
    calendarDateInZone(startsAt, current.rows[0].link_timezone),
    { now: input.now, excludeBookingId: id },
  );
  if (!slots.some((slot) => slot.startsAt === desiredStart)) {
    throw new CrmCommunicationsError(
      409,
      "Selected meeting time is no longer available.",
      "CRM_MEETING_SLOT_UNAVAILABLE",
    );
  }
  const endsAt = new Date(
    startsAt.getTime() + Number(current.rows[0].duration_minutes) * 60000,
  );
  const result = await client.query(
    `UPDATE tenant.crm_meeting_bookings
     SET starts_at=$3,ends_at=$4,guest_timezone=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND status='confirmed' RETURNING *`,
    [context.organizationId, id, desiredStart, endsAt.toISOString(), desiredTimezone],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(409, "Meeting booking changed. Refresh and try again.");
  await client.query(
    `UPDATE tenant.crm_calendar_events
     SET starts_at=$3,ends_at=$4,updated_at=now()
     WHERE organization_id=$1 AND meeting_booking_id=$2`,
    [context.organizationId, id, desiredStart, endsAt.toISOString()],
  );
  const activity = await client.query(
    `UPDATE tenant.crm_activities
        SET start_at=$3,due_at=$3,end_at=$4,updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND meeting_booking_id=$2 AND activity_type='meeting' AND status IN ('planned','overdue')
      RETURNING *`,
    [context.organizationId, id, desiredStart, endsAt.toISOString(), context.userId],
  );
  if (activity.rows[0]) {
    const attendeeCount = await client.query(
      `SELECT count(*)::int AS total FROM tenant.crm_activity_attendees
        WHERE organization_id=$1 AND activity_id=$2`,
      [context.organizationId, activity.rows[0].id],
    );
    await client.query(
      `INSERT INTO tenant.crm_meeting_events(
         organization_id,activity_id,event_type,previous_status,next_status,location_type,attendee_count,changed_by)
       VALUES($1,$2,'rescheduled',$3,$3,$4,$5,$6)`,
      [context.organizationId, activity.rows[0].id, activity.rows[0].status,
        activity.rows[0].meeting_location_type, Number(attendeeCount.rows[0]?.total || 0), context.userId],
    );
    await enqueueCalendarPushJob(client, context, activity.rows[0].id, "update", activity.rows[0].updated_at);
    await cancelPendingRemindersForActivity(client, context, activity.rows[0].id);
    await createRemindersForActivity(client, context, activity.rows[0].id, desiredStart);
  }
  return result.rows[0];
}
